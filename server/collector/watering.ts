import { APP_CONFIG } from '../../src/config/appConfig';
import type { HealthCondition } from '../../src/health/healthTypes';
import type { WateringMetadata } from '../../src/history/historyTypes';
import { DetectorState, INITIAL_DETECTOR, stepWateringDetector, suppressDetection, WateringEvidence } from '../../src/perception/wateringDetector';
import type { SensorCalibration } from '../../src/telemetry/calibration';
import type { PlantTelemetry } from '../../src/telemetry/types';
import type { AppDatabase } from '../database';
import type { MetaStore } from './metaStore';
import { fromRecord } from './records';
import { hhmmss } from '../../src/lib/time';

// The detector as saved between steps: a restart (on Cloudflare: the object waking up) carries on with a rise
// that is waiting for its confirmation
export interface SavedWatering {
  detector: DetectorState;
  sessionEventId: number | null;
  lastDecision: string | null;
}

// Sensor-detected waterings: runs the pure detector (perception/wateringDetector.ts) on each ESP32 reading
// and turns its decisions into care events: a new watering, a longer session, or a merge with a watering
// logged by hand. Also the detection pause while the probe is handled (calibration).
export class WateringDetection {
  private detector: DetectorState = INITIAL_DETECTOR;
  private sessionEventId: number | null = null;
  lastDecision: string | null = null;

  constructor(
    private db: AppDatabase,
    private meta: MetaStore,
    private log: (msg: string) => void,
    private onWatered: (at: number) => void // a watering was recorded at this time
  ) {}

  get suppressedUntil(): number {
    return this.detector.suppressedUntil;
  }

  saved(): SavedWatering {
    return { detector: this.detector, sessionEventId: this.sessionEventId, lastDecision: this.lastDecision };
  }

  // Carry on from the saved detector. The pause is the meta key's (it is written the moment it changes).
  resume(s: SavedWatering) {
    this.detector = { ...s.detector, suppressedUntil: this.meta.get('watering_detection_suppressed_until') ?? 0 };
    this.sessionEventId = s.sessionEventId;
    this.lastDecision = s.lastDecision;
  }

  // Without a saved detector: rebuilt from the recent readings, a watering session still open, the pause
  restore(now: number, calibration: SensorCalibration) {
    const window = this.db
      .telemetrySince('esp32_sensor', now - APP_CONFIG.watering.riseWindowMs, now)
      .flatMap((r) => {
        const t = fromRecord(r, calibration, false);
        return t ? [{ t: t.timestamp, soil: t.soilMoisture, raw: t.soilRaw ?? null }] : [];
      });
    const lastSensorWatering = this.db
      .eventsSince(now - APP_CONFIG.watering.cooldownMs)
      .find((e) => e.type === 'watering' && e.metadata.source === 'sensor');
    this.detector = {
      window,
      pending: null,
      session: lastSensorWatering
        ? {
            at: lastSensorWatering.timestamp,
            until: lastSensorWatering.timestamp + APP_CONFIG.watering.cooldownMs,
            peak: { t: lastSensorWatering.timestamp, soil: lastSensorWatering.metadata.moistureAfter ?? 100, raw: lastSensorWatering.metadata.rawAfter ?? null },
          }
        : null,
      suppressedUntil: this.meta.get('watering_detection_suppressed_until') ?? 0,
    };
    this.sessionEventId = lastSensorWatering?.id ?? null;
  }

  // One new ESP32 reading. conditionBefore: the tree's condition before it (stored with a watering).
  step(t: PlantTelemetry, conditionBefore: HealthCondition | null, gapMs: number) {
    const { state, out } = stepWateringDetector(this.detector, { t: t.timestamp, soil: t.soilMoisture, raw: t.soilRaw ?? null }, { gapMs, context: conditionBefore });
    this.detector = state;
    if (out.kind === 'none' || out.kind === 'suppressed') return;

    if (out.kind === 'candidate') {
      this.lastDecision = `candidate rise +${out.rise}% at ${hhmmss(t.timestamp)}, waiting for confirmation`;
    } else if (out.kind === 'rejected') {
      this.lastDecision = `ignored (${out.reason}): ${out.detail} at ${hhmmss(t.timestamp)}`;
      this.log(`[collector] watering ${this.lastDecision}`);
    } else if (out.kind === 'session_extended') {
      if (this.sessionEventId !== null) {
        const ev = this.db.getEvent(this.sessionEventId);
        if (ev) this.db.updateEvent(ev.id, ev.note, { ...ev.metadata, moistureAfter: out.peak.soil, rawAfter: out.peak.raw });
      }
      this.lastDecision = `same watering session, soil now ${out.peak.soil}%`;
    } else {
      this.record(out.evidence, (out.context as HealthCondition | null) ?? null);
    }
  }

  private record(e: WateringEvidence, conditionBefore: HealthCondition | null) {
    const evidence = {
      moistureBefore: e.moistureBefore,
      moistureAfter: e.moistureAfter,
      rawBefore: e.rawBefore,
      rawAfter: e.rawAfter,
      accumulatedRise: e.accumulatedRise,
      risingReadings: e.risingReadings,
      confirmationReadings: e.confirmationReadings,
      detectionMethod: e.method,
      detectedAt: e.detectedAt,
    };
    // Already logged by hand around then: the same watering, now confirmed with sensor evidence
    const mergeMs = APP_CONFIG.watering.manualMergeMinutes * 60 * 1000;
    const manual = this.db
      .eventsSince(e.crossedAt - mergeMs)
      .find((x) => x.type === 'watering' && x.metadata.source === 'manual' && !x.metadata.confirmedBySensor && Math.abs(x.timestamp - e.crossedAt) <= mergeMs);
    if (manual) {
      this.db.updateEvent(manual.id, manual.note, { ...manual.metadata, ...evidence, confirmedBySensor: true });
      this.sessionEventId = manual.id;
    } else {
      const metadata: WateringMetadata = { source: 'sensor', conditionBefore, ...evidence };
      const ev = this.db.insertEvent({ timestamp: e.crossedAt, type: 'watering', note: null, metadata });
      this.sessionEventId = ev?.id ?? null;
    }
    this.onWatered(e.crossedAt);
    this.lastDecision = `watering recorded: soil ${e.moistureBefore}% → ${e.moistureAfter}% (${e.method.replace('_', ' ')}, confirmed by ${e.confirmationReadings} reading${e.confirmationReadings === 1 ? '' : 's'})`;
    this.log(`[collector] ${this.lastDecision}`);
  }

  // Pause detection while the probe is handled (calibration) until now + minutes. minutes = 0 ends the pause.
  suppress(now: number, minutes: number): number {
    const until = minutes > 0 ? now + minutes * 60 * 1000 : 0;
    this.detector = minutes > 0 ? suppressDetection(this.detector, until) : { ...this.detector, suppressedUntil: 0, window: this.detector.window.slice(-1) };
    this.meta.set('watering_detection_suppressed_until', this.detector.suppressedUntil);
    this.lastDecision = minutes > 0 ? `paused for calibration until ${hhmmss(until)}` : 'resumed';
    return this.detector.suppressedUntil;
  }
}
