import type { CollectorStatus, LivingSnapshot } from '../src/api/types';
import { evaluateBehaviour } from '../src/behaviour/BehaviourEngine';
import type { MoodMemory, PlantBehaviourState, SlothMemory } from '../src/behaviour/behaviourTypes';
import { slothLife } from '../src/behaviour/sloth';
import { decideSpeech, INITIAL_MESSAGE_MEMORY, MessageMemory } from '../src/behaviour/speech';
import { APP_CONFIG } from '../src/config/appConfig';
import { expressBehaviour } from '../src/expression/ExpressionEngine';
import type { ExpressionState } from '../src/expression/expressionTypes';
import { evaluatePlantHealth, HEALTH_MEMORY_VERSION, HealthMemory, initialHealthMemory } from '../src/health/HealthEngine';
import type { HealthCondition, PlantHealthState } from '../src/health/healthTypes';
import { INTERACTION_KINDS } from '../src/history/historyTypes';
import type { Interaction, InteractionKind, PlantEvent, PlantEventType, TelemetryRecord, WateringMetadata } from '../src/history/historyTypes';
import { continuityGapMs, perceive, toSample } from '../src/perception/PerceptionEngine';
import type { PerceptionSample, PerceptionState } from '../src/perception/perceptionTypes';
import { DetectorState, INITIAL_DETECTOR, stepWateringDetector, suppressDetection, WateringEvidence } from '../src/perception/wateringDetector';
import { DEFAULT_SETTINGS, TreeSettings } from '../src/settings/settings';
import { ACTIVE_SPECIES } from '../src/species';
import { lightPercentFromRaw, NO_CALIBRATION, SensorCalibration, soilPercentFromRaw } from '../src/telemetry/calibration';
import { assessDataQuality } from '../src/telemetry/dataQuality';
import { normalizeTelemetryEndpoint } from '../src/telemetry/ESP32TelemetryProvider';
import { calculateVPD } from '../src/telemetry/telemetryNormalizer';
import { fetchOutsideWeather, type OutsideObservation } from '../src/telemetry/outsideWeather';
import { telemetryManager } from '../src/telemetry/telemetryManager';
import type { HourlyTelemetryPoint, LiveReading, PlantTelemetry, TelemetryFetchResult, TelemetrySource, TimelineEvent } from '../src/telemetry/types';
import type { AppDatabase } from './database';
import { trackEpisode } from './episodes';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const SETTINGS_KEY = 'collector_settings';
const MEMORY_KEY = 'health_memory';
const SUPPRESS_KEY = 'watering_detection_suppressed_until';
const SPEECH_KEY = 'message_memory';
const MOOD_KEY = 'mood_memory'; // where the mood was: it drifts from there (behaviour/mood.ts)
const CALIBRATION_KEY = 'calibration';
// Settings that are NOT changed through a settings save (calibration has its own API and history)
const NOT_FROM_SETTINGS_SAVE = ['calibration', 'useAppSoilCalibration', 'soilRawDry', 'soilRawWet', 'lastSoilRaw'] as const;

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Stored row → the telemetry shape the engines read. Raw values are interpreted with the CURRENT
// calibration (so a new calibration applies to recent history too); the stored row is never changed.
export function fromRecord(r: TelemetryRecord, cal: SensorCalibration = NO_CALIBRATION): PlantTelemetry | null {
  if (r.soilMoisture === null) return null;
  const esp = r.source === 'esp32_sensor';
  return {
    timestamp: r.timestamp,
    source: r.source,
    updatedAt: fmtTime(r.timestamp),
    soilMoisture: esp && cal.soil && r.soilRaw !== null ? soilPercentFromRaw(r.soilRaw, cal.soil) : r.soilMoisture,
    soilRaw: r.soilRaw,
    apiSoilMoisture: r.apiSoilMoisture,
    temperature: r.temperature,
    humidity: r.humidity,
    vpd: r.temperature !== null && r.humidity !== null ? calculateVPD(r.temperature, r.humidity) : null,
    lightPercent: esp && cal.light && r.lightRaw !== null ? lightPercentFromRaw(r.lightRaw, cal.light) : r.lightPercent,
    lightRaw: r.lightRaw,
    radiation: r.radiation,
    isDay: true, // perception decides day/night from the sun
    wifiRssi: r.wifiRssi,
  };
}

const toLive = (t: PlantTelemetry): LiveReading => ({
  t: t.timestamp,
  moisture: t.soilMoisture,
  soilRaw: t.soilRaw ?? null,
  light: t.source === 'esp32_sensor' ? t.lightPercent ?? null : t.radiation ?? null,
  lightRaw: t.lightRaw ?? null,
  temperature: t.temperature,
  humidity: t.humidity,
});

export interface CollectorOptions {
  now?: () => number; // clock (scenario tests run simulated time)
  fetchTelemetry?: (settings: TreeSettings) => Promise<TelemetryFetchResult>;
  fetchOutsideWeather?: (settings: TreeSettings, now: number) => Promise<{ observation: OutsideObservation; raw: unknown }>;
  autoSchedule?: boolean; // false: only poll when pollNow() is called (tests)
  log?: (msg: string) => void;
}

interface SavedMemory {
  engineVersion: string;
  source: TelemetrySource;
  memory: HealthMemory;
}

// The living loop: ESP32 → SQLite → perception → health → episodes → behaviour → expression.
// Runs only while the local server runs; nothing is collected when the PC is off.
export class LivingCollector {
  private settings: TreeSettings;
  private configured: boolean;
  private memory: HealthMemory = initialHealthMemory();
  private recent: PerceptionSample[] = [];
  private latest: PlantTelemetry | null = null;
  private previous: PlantTelemetry | null = null;
  private liveReadings: LiveReading[] = [];
  private forecast: { hourly: HourlyTelemetryPoint[]; timeline: TimelineEvent[] } = { hourly: [], timeline: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private weatherTimer: ReturnType<typeof setTimeout> | undefined;
  private outside: OutsideObservation | null = null; // latest outside weather (context only)
  private outsideError: string | null = null;
  private polling: Promise<void> | null = null;
  private repoll = false;
  private detector: DetectorState = INITIAL_DETECTOR;
  private wateringSessionEventId: number | null = null;
  private lastDetectorDecision: string | null = null;
  private messageMemory: MessageMemory = INITIAL_MESSAGE_MEMORY;
  private calibration: SensorCalibration = NO_CALIBRATION;
  private status: Pick<CollectorStatus, 'lastPollAt' | 'lastSuccessAt' | 'lastError' | 'consecutiveFailures'> = {
    lastPollAt: null,
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
  };
  private state: { perception: PerceptionState; health: PlantHealthState; behaviour: PlantBehaviourState; expression: ExpressionState } | null = null;
  private readonly now: () => number;
  private readonly fetchTelemetry: (settings: TreeSettings) => Promise<TelemetryFetchResult>;
  private readonly fetchOutside: (settings: TreeSettings, now: number) => Promise<{ observation: OutsideObservation; raw: unknown }>;
  private readonly autoSchedule: boolean;
  private readonly log: (msg: string) => void;

  constructor(private db: AppDatabase, opts: CollectorOptions = {}) {
    const stored = db.getMeta<TreeSettings>(SETTINGS_KEY);
    this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
    this.configured = !!stored;
    this.now = opts.now ?? Date.now;
    this.fetchTelemetry = opts.fetchTelemetry ?? ((s) => telemetryManager.getTelemetry(s));
    this.fetchOutside = opts.fetchOutsideWeather ?? fetchOutsideWeather;
    this.autoSchedule = opts.autoSchedule ?? true;
    this.log = opts.log ?? ((m) => console.log(m));
    this.calibration = this.loadCalibration();
    const speech = db.getMeta<MessageMemory>(SPEECH_KEY);
    if (speech?.version === INITIAL_MESSAGE_MEMORY.version) this.messageMemory = { ...INITIAL_MESSAGE_MEMORY, ...speech };
  }

  // ---- lifecycle ----
  start(): Promise<void> {
    this.restore();
    this.outside = this.db.latestOutsideWeather();
    void this.pollWeather();
    return this.pollNow();
  }

  stop() {
    clearTimeout(this.timer);
    clearTimeout(this.weatherTimer);
  }

  // Outside weather: its own cadence (15 min) in every data source mode, independent of the ESP32.
  // Context only. A failure keeps the last observation, which goes stale on its own (never invented).
  async pollWeather(): Promise<void> {
    clearTimeout(this.weatherTimer);
    if (this.autoSchedule) this.weatherTimer = setTimeout(() => void this.pollWeather(), APP_CONFIG.polling.weatherMs);
    if (this.settings.latitude == null || this.settings.longitude == null) return;
    try {
      const { observation, raw } = await this.fetchOutside(this.settings, this.now());
      this.outside = observation;
      this.db.insertOutsideWeather(observation, raw);
      if (this.outsideError) this.log('[collector] outside weather back');
      this.outsideError = null;
    } catch (err: any) {
      const msg = err?.cause?.code ?? err?.message ?? String(err);
      if (!this.outsideError) this.log(`[collector] outside weather unavailable: ${msg}`);
      this.outsideError = msg;
    }
    if (this.state) this.evaluate(this.now());
  }

  // After importing old readings: rebuild state from the database.
  reloadHistory() {
    this.replay(this.now());
    this.evaluate(this.now());
  }

  private source(): TelemetrySource {
    return this.settings.dataSource === 'weather_estimate' ? 'weather_estimate' : 'esp32_sensor';
  }

  pollMs(): number {
    if (this.settings.dataSource === 'weather_estimate') return APP_CONFIG.polling.weatherMs;
    const p = APP_CONFIG.polling;
    return Math.min(p.telemetryMaxMs, Math.max(p.telemetryMinMs, this.settings.telemetryIntervalMs ?? p.telemetryMs));
  }

  private location() {
    return { latitude: this.settings.latitude ?? null, longitude: this.settings.longitude ?? null };
  }

  // The sloth's loyalty (art): derived from the stored readings of its last days, as of today's start. Kept
  // in memory for the day (a new day, source, location or calibration derives it again); never stored.
  private slothCache: { key: string; memory: SlothMemory } | null = null;
  private slothMemory(now: number, cadenceMs: number): SlothMemory {
    const today = new Date(now).setHours(0, 0, 0, 0);
    const loc = this.location();
    const key = JSON.stringify([today, this.source(), loc, this.calibration]);
    if (this.slothCache?.key === key) return this.slothCache.memory;
    const days = APP_CONFIG.habitat.sloth.loyalty.days;
    const from = today - days * DAY;
    const samples = this.db.telemetrySince(this.source(), from - 6 * HOUR, today).flatMap((r) => {
      const t = fromRecord(r, this.calibration);
      return t ? [toSample(t, ACTIVE_SPECIES, loc)] : [];
    });
    const { memory } = slothLife(samples, this.db.outsideWeatherSince(from - 6 * HOUR), this.db.episodesSince(from), ACTIVE_SPECIES, cadenceMs, today, days);
    this.slothCache = { key, memory };
    return memory;
  }

  // ---- continuity across restarts ----

  // Resume where the tree was: saved health memory (hysteresis, vitality, recovery, uncertainty),
  // the last 24 h of readings for perception, and the watering detector's recent context.
  // Without a usable saved memory, fall back to replaying stored telemetry.
  private restore() {
    const now = this.now();
    const saved = this.db.getMeta<SavedMemory>(MEMORY_KEY);
    const usable =
      saved && saved.engineVersion === APP_CONFIG.engineVersion && saved.source === this.source() && saved.memory?.version === HEALTH_MEMORY_VERSION;
    if (!usable) {
      this.replay(now);
    } else {
      this.memory = saved.memory;
      this.loadRecent(now);
      // Readings stored after the memory was saved (normally none): catch up
      const rows = this.db.telemetrySince(this.source(), (saved.memory.at ?? 0) + 1, now);
      if (rows.length) this.replayRows(rows, this.db.eventsSince(now - 30 * DAY));
      this.log(`[collector] resumed saved health memory from ${saved.memory.at ? new Date(saved.memory.at).toLocaleString() : 'never'}`);
    }
    this.restoreDetector(now);
  }

  private loadRecent(now: number) {
    const rows = this.db.telemetrySince(this.source(), now - DAY, now);
    const ts = rows.flatMap((r) => {
      const t = fromRecord(r, this.calibration);
      return t ? [t] : [];
    });
    this.recent = ts.map((t) => toSample(t, ACTIVE_SPECIES, this.location()));
    this.latest = ts[ts.length - 1] ?? null;
    this.previous = ts[ts.length - 2] ?? null;
    this.liveReadings = ts.slice(-APP_CONFIG.diagnostics.liveReadingsKept).map(toLive);
  }

  // Rebuild hysteresis + vitality from stored observations. Episodes are not rewritten.
  private replay(now: number) {
    const rows = this.db.telemetrySince(this.source(), now - APP_CONFIG.history.replayHours * HOUR, now);
    this.memory = initialHealthMemory();
    this.recent = [];
    this.latest = null;
    this.previous = null;
    this.replayRows(rows, this.db.eventsSince(now - 30 * DAY));
    this.liveReadings = rows.slice(-APP_CONFIG.diagnostics.liveReadingsKept).flatMap((r) => {
      const t = fromRecord(r, this.calibration);
      return t ? [toLive(t)] : [];
    });
    this.log(`[collector] replayed ${rows.length} readings from the last ${APP_CONFIG.history.replayHours}h`);
  }

  private replayRows(rows: TelemetryRecord[], events: PlantEvent[]) {
    for (const row of rows) {
      const t = fromRecord(row, this.calibration);
      if (!t) continue;
      this.previous = this.latest;
      this.latest = t;
      this.recent.push(toSample(t, ACTIVE_SPECIES, this.location()));
      const perception = this.perceiveAt(t.timestamp, events);
      this.memory = evaluatePlantHealth({ perception, species: ACTIVE_SPECIES, memory: this.memory, tempUnit: this.settings.temperatureUnit }).memory;
    }
  }

  private restoreDetector(now: number) {
    const window = this.db
      .telemetrySince('esp32_sensor', now - APP_CONFIG.watering.riseWindowMs, now)
      .flatMap((r) => {
        const t = fromRecord(r, this.calibration);
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
      suppressedUntil: this.db.getMeta<number>(SUPPRESS_KEY) ?? 0,
    };
    this.wateringSessionEventId = lastSensorWatering?.id ?? null;
  }

  private perceiveAt(now: number, events: PlantEvent[], deviceError: string | null = null, outside: OutsideObservation | null = null): PerceptionState {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    return perceive({
      outside,
      soilBreaks: this.soilBreaks(),
      // Today's skies: a grey day explains dim light (also on replay, from the stored observations)
      outsideToday: this.db.outsideWeatherSince(dayStart.getTime() - 3600_000).filter((o) => o.at <= now + 15 * 60_000),
      latest: this.latest,
      previous: this.previous,
      recent: this.recent,
      events: events.filter((e) => e.timestamp <= now),
      location: this.location(),
      pollMs: this.pollMs(),
      deviceError,
      species: ACTIVE_SPECIES,
      now,
    });
  }

  // Soil calibration changes and the detection pause (probe being handled): a dry-down never bridges them
  private soilBreaks(): number[] {
    const changes = this.db.calibrationHistory(20).filter((h) => h.sensor === 'soil').map((h) => h.timestamp);
    const pausedUntil = this.db.getMeta<number>(SUPPRESS_KEY) ?? 0;
    return pausedUntil > 0 ? [...changes, pausedUntil] : changes;
  }

  // ---- polling ----
  private schedule() {
    clearTimeout(this.timer);
    if (this.autoSchedule) this.timer = setTimeout(() => void this.pollNow(), this.pollMs());
  }

  // Read now. If a poll is already running (maybe with old settings), read again right after it.
  pollNow(): Promise<void> {
    if (this.polling) {
      this.repoll = true;
      return this.polling.then(() => this.polling ?? undefined);
    }
    this.polling = this.poll().finally(() => {
      this.polling = null;
      if (this.repoll) {
        this.repoll = false;
        void this.pollNow();
      } else {
        this.schedule();
      }
    });
    return this.polling;
  }

  private async poll() {
    this.status.lastPollAt = this.now();
    let result: TelemetryFetchResult;
    try {
      result = await this.fetchTelemetry(this.fetchSettings());
    } catch (err: any) {
      // Never invent a reading: the last one goes stale and the tree's state is held, then uncertain
      this.status.lastError = err?.cause?.code ?? err?.message ?? String(err);
      this.status.consecutiveFailures++;
      if (this.status.consecutiveFailures === 1) this.log(`[collector] poll failed: ${this.status.lastError}`);
      this.evaluate(this.now());
      return;
    }

    const t = result.current;
    if (this.status.consecutiveFailures > 0) this.log(`[collector] sensor back after ${this.status.consecutiveFailures} failed polls`);
    this.status.lastError = null;
    this.status.consecutiveFailures = 0;
    this.status.lastSuccessAt = t.timestamp;
    if (t.source === 'weather_estimate') this.forecast = { hourly: result.hourly, timeline: result.timeline };

    // Source changed (auto mode fell back, or settings changed): history continuity starts over
    if (this.latest && this.latest.source !== t.source) {
      this.latest = null;
      this.previous = null;
      this.recent = [];
    }

    const quality = assessDataQuality({ telemetry: t, previous: this.latest, pollMs: this.pollMs(), historyMinutes: 999, deviceError: null, now: t.timestamp });
    this.db.insertTelemetry(
      {
        timestamp: t.timestamp,
        source: t.source,
        deviceId: t.source === 'esp32_sensor' && this.settings.esp32EndpointUrl ? normalizeTelemetryEndpoint(this.settings.esp32EndpointUrl) : null,
        soilMoisture: t.soilMoisture,
        apiSoilMoisture: t.apiSoilMoisture ?? null,
        soilRaw: t.soilRaw ?? null,
        temperature: t.temperature,
        humidity: t.humidity,
        lightPercent: t.lightPercent ?? null,
        lightRaw: t.lightRaw ?? null,
        radiation: t.radiation ?? null,
        wifiRssi: t.wifiRssi ?? null,
        dataQuality: quality.confidence,
      },
      result.raw
    );

    if (t.source === 'esp32_sensor') this.detectWatering(t);

    this.previous = this.latest;
    this.latest = t;
    this.recent.push(toSample(t, ACTIVE_SPECIES, this.location()));
    if (this.recent.length > 3000) this.recent = this.recent.filter((s) => s.t >= t.timestamp - DAY);
    this.liveReadings = [...this.liveReadings, toLive(t)].slice(-APP_CONFIG.diagnostics.liveReadingsKept);

    this.evaluate(this.now());
  }

  // ---- watering detection ----
  private detectWatering(t: PlantTelemetry) {
    const conditionBefore: HealthCondition | null = this.state?.health.condition ?? null;
    const { state, out } = stepWateringDetector(
      this.detector,
      { t: t.timestamp, soil: t.soilMoisture, raw: t.soilRaw ?? null },
      { gapMs: continuityGapMs(this.pollMs()), context: conditionBefore }
    );
    this.detector = state;
    if (out.kind === 'none' || out.kind === 'suppressed') return;

    if (out.kind === 'candidate') {
      this.lastDetectorDecision = `candidate rise +${out.rise}% at ${fmtTime(t.timestamp)}, waiting for confirmation`;
    } else if (out.kind === 'rejected') {
      this.lastDetectorDecision = `ignored (${out.reason}): ${out.detail} at ${fmtTime(t.timestamp)}`;
      this.log(`[collector] watering ${this.lastDetectorDecision}`);
    } else if (out.kind === 'session_extended') {
      if (this.wateringSessionEventId !== null) {
        const ev = this.db.getEvent(this.wateringSessionEventId);
        if (ev) this.db.updateEvent(ev.id, ev.note, { ...ev.metadata, moistureAfter: out.peak.soil, rawAfter: out.peak.raw });
      }
      this.lastDetectorDecision = `same watering session, soil now ${out.peak.soil}%`;
    } else {
      this.recordSensorWatering(out.evidence, (out.context as HealthCondition | null) ?? null);
    }
  }

  private recordSensorWatering(e: WateringEvidence, conditionBefore: HealthCondition | null) {
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
      this.wateringSessionEventId = manual.id;
    } else {
      const metadata: WateringMetadata = { source: 'sensor', conditionBefore, ...evidence };
      const ev = this.db.insertEvent({ timestamp: e.crossedAt, type: 'watering', note: null, metadata });
      this.wateringSessionEventId = ev?.id ?? null;
    }
    this.settings = { ...this.settings, lastWateredTimestamp: e.crossedAt };
    this.db.setMeta(SETTINGS_KEY, this.settings);
    this.lastDetectorDecision = `watering recorded: soil ${e.moistureBefore}% → ${e.moistureAfter}% (${e.method.replace('_', ' ')}, confirmed by ${e.confirmationReadings} reading${e.confirmationReadings === 1 ? '' : 's'})`;
    this.log(`[collector] ${this.lastDetectorDecision}`);
  }

  // Pause watering detection while the probe is handled (calibration). minutes = 0 ends the pause.
  suppressWateringDetection(minutes = APP_CONFIG.watering.calibrationSuppressMs / 60000) {
    const now = this.now();
    const until = minutes > 0 ? now + minutes * 60 * 1000 : 0;
    this.detector = minutes > 0 ? suppressDetection(this.detector, until) : { ...this.detector, suppressedUntil: 0, window: this.detector.window.slice(-1) };
    this.db.setMeta(SUPPRESS_KEY, this.detector.suppressedUntil);
    this.lastDetectorDecision = minutes > 0 ? `paused for calibration until ${fmtTime(until)}` : 'resumed';
    return this.detector.suppressedUntil;
  }

  // Perception → health → episodes → behaviour → expression, for the current moment.
  private evaluate(now: number) {
    const events = this.db.eventsSince(now - 30 * DAY);
    const perception = this.perceiveAt(now, events, this.status.lastError, this.outside);
    const { state: health, memory } = evaluatePlantHealth({
      perception,
      species: ACTIVE_SPECIES,
      memory: this.memory,
      tempUnit: this.settings.temperatureUnit,
    });
    this.memory = memory;
    this.db.setMeta(MEMORY_KEY, { engineVersion: APP_CONFIG.engineVersion, source: this.source(), memory } satisfies SavedMemory);
    trackEpisode(this.db, health, now, { pollMs: this.pollMs(), gapMs: perception.history.gapMs });
    const episodes = this.db.episodesSince(now - 30 * DAY);
    // Attention goes only into relationship memory (never perception or health)
    const interactions = this.db.interactionsSince(now - 30 * DAY);
    const behaviour = evaluateBehaviour({
      health,
      perception,
      episodes,
      events,
      interactions,
      species: ACTIVE_SPECIES,
      now,
      location: this.location(),
      wanderers: { sloth: this.slothMemory(now, perception.history.cadenceMs) },
      moodMemory: this.db.getMeta<MoodMemory>(MOOD_KEY),
    });
    this.db.setMeta(MOOD_KEY, behaviour.moodState.memory);
    // When to speak or stay quiet; persisted so refreshes and restarts don't replay lines
    const speech = decideSpeech({ behaviour, severity: health.severity, memory: this.messageMemory, now });
    if (speech.memory !== this.messageMemory) {
      this.messageMemory = speech.memory;
      this.db.setMeta(SPEECH_KEY, speech.memory);
    }
    const expression = expressBehaviour({ behaviour, health, perception, speech: speech.decision, now });
    this.state = { perception, health, behaviour, expression };
  }

  // ---- settings ----
  getSettings(): { settings: TreeSettings; configured: boolean } {
    return { settings: this.settings, configured: this.configured };
  }

  updateSettings(next: Partial<TreeSettings>) {
    const before = this.settings;
    // Calibration never arrives through a settings save: a stale browser copy can't overwrite it
    const incoming: Partial<TreeSettings> = { ...next };
    for (const k of NOT_FROM_SETTINGS_SAVE) delete incoming[k];
    this.settings = { ...DEFAULT_SETTINGS, ...before, ...incoming };
    // The server knows the latest watering; an older browser copy must not roll it back
    this.settings.lastWateredTimestamp = Math.max(before.lastWateredTimestamp ?? 0, next.lastWateredTimestamp ?? 0);
    this.configured = true;
    this.db.setMeta(SETTINGS_KEY, this.settings);

    const changed = (k: keyof TreeSettings) => before[k] !== this.settings[k];
    if (changed('dataSource') || changed('latitude') || changed('longitude')) {
      this.replay(this.now());
    }
    if (changed('latitude') || changed('longitude')) {
      this.outside = null; // weather from the old place no longer describes this one
      void this.pollWeather();
    }
    // A new device or calibration changes the soil scale: that must never look like a watering
    if (changed('esp32EndpointUrl')) this.suppressWateringDetection();
    if (changed('dataSource') || changed('esp32EndpointUrl') || changed('telemetryIntervalMs')) {
      void this.pollNow();
    } else if (this.state) {
      this.evaluate(this.now());
    }
  }

  // ---- calibration (server-owned; changes interpretation, never stored raw telemetry) ----
  private loadCalibration(): SensorCalibration {
    const stored = this.db.getMeta<SensorCalibration>(CALIBRATION_KEY);
    if (stored) return { ...NO_CALIBRATION, ...stored };
    // One-time migration of the old browser-held "convert raw in the app" soil settings
    const s = this.settings;
    if (s.useAppSoilCalibration && s.soilRawDry !== undefined && s.soilRawWet !== undefined) {
      const migrated: SensorCalibration = {
        soil: { dryRaw: s.soilRawDry, wetRaw: s.soilRawWet, savedAt: this.now(), method: 'migrated' },
        light: null,
      };
      this.db.setMeta(CALIBRATION_KEY, migrated);
      this.db.insertCalibrationHistory({ timestamp: this.now(), sensor: 'soil', old: null, next: migrated.soil, note: 'Migrated from the old app-side soil conversion' });
      this.log('[collector] migrated existing soil calibration to the server');
      return migrated;
    }
    return NO_CALIBRATION;
  }

  private fetchSettings(): TreeSettings {
    return { ...this.settings, calibration: this.calibration };
  }

  getCalibration(): SensorCalibration {
    return this.calibration;
  }

  // Save a new calibration for one sensor (null = back to the firmware's own %), with history.
  applyCalibration(sensor: 'soil' | 'light', value: SensorCalibration['soil'] | SensorCalibration['light'], note: string | null) {
    const old = this.calibration[sensor];
    this.calibration = { ...this.calibration, [sensor]: value };
    this.db.setMeta(CALIBRATION_KEY, this.calibration);
    this.db.insertCalibrationHistory({ timestamp: this.now(), sensor, old, next: value, note });
    // The soil scale changed: that must not look like a watering, and recent state is re-read with it
    if (sensor === 'soil') this.suppressWateringDetection();
    this.replay(this.now());
    void this.pollNow();
  }

  // One raw reading straight from the device (calibration captures; not stored as telemetry).
  async readRaw(): Promise<{ soilRaw: number | null; lightRaw: number | null; soilPercent: number; lightPercent: number | null; at: number }> {
    const r = await this.fetchTelemetry(this.fetchSettings());
    const t = r.current;
    return { soilRaw: t.soilRaw ?? null, lightRaw: t.lightRaw ?? null, soilPercent: t.soilMoisture, lightPercent: t.lightPercent ?? null, at: t.timestamp };
  }

  // ---- attention (not care) ----
  // A petting session reported by the browser. Stored for relationship memory only: it never
  // triggers an evaluation and nothing in perception or health reads it.
  recordInteraction(body: unknown): { ok: true; interaction: Interaction; merged: boolean } | { ok: false; status: number; error: string } {
    const cfg = APP_CONFIG.attention;
    const b = (body ?? {}) as Record<string, unknown>;
    const kind = b.kind as InteractionKind;
    if (!INTERACTION_KINDS.includes(kind)) return { ok: false, status: 400, error: `kind must be one of ${INTERACTION_KINDS.join(', ')}` };
    const now = this.now();
    let endedAt = Number(b.endedAt);
    let startedAt = Number(b.startedAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt > endedAt) return { ok: false, status: 400, error: 'startedAt ≤ endedAt (ms) required' };
    if (endedAt > now + 60_000 || endedAt < now - DAY) return { ok: false, status: 400, error: 'session must have ended within the last day' };
    endedAt = Math.min(endedAt, now);
    startedAt = Math.max(startedAt, endedAt - cfg.maxSessionMs);
    const count = Math.max(1, Math.min(cfg.maxStrokesPerSession, Math.round(Number(b.count) || 1)));
    const activeMs = Math.max(0, Math.min(endedAt - startedAt, Math.round(Number(b.activeMs) || 0)));
    const recent = this.db.interactionsSince(now - 3600_000, kind).filter((i) => i.startedAt >= now - 3600_000).length;
    // Write cap: past it, a session can still extend the latest row but never add a new one
    const result = this.db.recordInteraction({ kind, startedAt, endedAt, count, activeMs }, cfg.mergeMs, recent < cfg.maxRowsPerHour);
    if (!result) return { ok: false, status: 429, error: 'Too many sessions this hour' };
    return { ok: true, ...result };
  }

  // ---- care events ----
  logEvent(type: PlantEventType, note: string | null, timestamp = this.now()): PlantEvent | null {
    let event: PlantEvent | null;
    if (type === 'watering') {
      const mergeMs = APP_CONFIG.watering.manualMergeMinutes * 60 * 1000;
      const nearby = this.db.eventsSince(timestamp - mergeMs).filter((e) => e.type === 'watering' && Math.abs(e.timestamp - timestamp) <= mergeMs);
      const sensor = nearby.find((e) => e.metadata.source === 'sensor');
      const manual = nearby.find((e) => e.metadata.source === 'manual');
      if (sensor) {
        // The sensor already saw this watering: add the note instead of logging it twice
        this.db.updateEvent(sensor.id, [sensor.note, note].filter(Boolean).join(' · ') || 'Confirmed by you', { ...sensor.metadata, confirmedByUser: true });
        event = this.db.getEvent(sensor.id);
      } else if (manual) {
        // Logged twice by hand: keep one
        if (note) this.db.updateEvent(manual.id, [manual.note, note].filter(Boolean).join(' · '), manual.metadata);
        event = this.db.getEvent(manual.id);
      } else {
        const metadata: WateringMetadata = {
          source: 'manual',
          moistureBefore: this.state?.perception.readings.soilMoisture ?? null,
          moistureAfter: null,
          conditionBefore: this.state?.health.condition ?? null,
        };
        event = this.db.insertEvent({ timestamp, type, note, metadata });
        this.settings = { ...this.settings, lastWateredTimestamp: timestamp };
        this.db.setMeta(SETTINGS_KEY, this.settings);
      }
    } else {
      event = this.db.insertEvent({ timestamp, type, note, metadata: { conditionAtTime: this.state?.health.condition ?? null } });
    }
    this.evaluate(this.now());
    return event;
  }

  deleteEvent(id: number): boolean {
    const ok = this.db.deleteEvent(id);
    if (ok) this.evaluate(this.now());
    return ok;
  }

  // ---- outputs ----
  collectorStatus(): CollectorStatus {
    return {
      dataSource: this.settings.dataSource,
      endpoint: this.settings.esp32EndpointUrl ? normalizeTelemetryEndpoint(this.settings.esp32EndpointUrl) : null,
      pollMs: this.pollMs(),
      ...this.status,
      wateringDetection: {
        suppressedUntil: this.detector.suppressedUntil > this.now() ? this.detector.suppressedUntil : null,
        lastDecision: this.lastDetectorDecision,
      },
    };
  }

  isConfigured() {
    return this.configured;
  }

  // For tests and diagnostics
  currentState() {
    return this.state;
  }

  snapshot(): Omit<LivingSnapshot, 'status' | 'serverTime'> {
    const now = this.now();
    const s = this.state;
    return {
      perception: s ? { ...s.perception, recent: [] } : null,
      health: s?.health ?? null,
      behaviour: s?.behaviour ?? null,
      expression: s?.expression ?? null,
      forecast: this.settings.dataSource === 'esp32_sensor' ? { hourly: [], timeline: [] } : this.forecast,
      liveReadings: this.liveReadings,
      recentEvents: this.db.eventsSince(now - 30 * DAY, 200),
      recentEpisodes: this.db.episodesSince(now - 30 * DAY),
    };
  }
}
