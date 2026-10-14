import { APP_CONFIG } from '../config/appConfig';
import type { PerceptionSample } from '../perception/perceptionTypes';
import { PlantTelemetry } from './types';

export type DataConfidence = 'high' | 'medium' | 'low';

export interface DataQuality {
  confidence: DataConfidence;
  score: number; // 0-1
  issues: string[]; // human-readable reasons, most important first
  missing: Array<'temperature' | 'humidity' | 'light'>;
  stale: boolean; // no reading recent enough to trust
  insufficientHistory: boolean;
  // Sensors whose values look physically suspicious. Health must not turn these into plant stress.
  suspect: { soil: boolean; light: boolean; air: boolean };
}

export interface DataQualityInput {
  telemetry: PlantTelemetry | null; // latest reading we have (may be old)
  previous: PlantTelemetry | null; // the reading before it, for impossible-jump checks
  recent?: PerceptionSample[]; // continuous recent samples, oldest first, ending with the latest reading
  gapMs?: number; // samples further apart than this are not continuous
  pollMs: number;
  historyMinutes: number; // how much continuous recent history we have
  deviceError: string | null; // last collector error (endpoint unavailable, …)
  now: number;
}

const SCORE: Record<DataConfidence, number> = { high: 1, medium: 0.7, low: 0.3 };

// Minutes `pred` has held over the most recent continuous samples (0 if the latest doesn't satisfy it).
function heldMinutes(samples: PerceptionSample[], pred: (s: PerceptionSample) => boolean, gapMs: number): number {
  const last = samples[samples.length - 1];
  if (!last || !pred(last)) return 0;
  let earliest = last.t;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (samples[i + 1].t - samples[i].t > gapMs || !pred(samples[i])) break;
    earliest = samples[i].t;
  }
  return (last.t - earliest) / 60000;
}

// Judges how much the data can be trusted. Says nothing about plant health.
export function assessDataQuality({
  telemetry: t,
  previous,
  recent = [],
  gapMs = APP_CONFIG.history.maxGapMs,
  pollMs,
  historyMinutes,
  deviceError,
  now,
}: DataQualityInput): DataQuality {
  const q = APP_CONFIG.dataQuality;
  const issues: string[] = [];
  const missing: DataQuality['missing'] = [];
  const suspect = { soil: false, light: false, air: false };
  let confidence: DataConfidence = 'high';
  const lower = (to: DataConfidence) => {
    if (to === 'low' || (to === 'medium' && confidence === 'high')) confidence = to;
  };
  const done = (stale: boolean, insufficientHistory: boolean): DataQuality => ({
    confidence,
    score: SCORE[confidence],
    issues,
    missing,
    stale,
    insufficientHistory,
    suspect,
  });

  if (!t) {
    lower('low');
    issues.push(deviceError ? `No reading yet: ${deviceError}` : 'No reading yet');
    return done(true, true);
  }

  if (t.temperature === null) missing.push('temperature');
  if (t.humidity === null) missing.push('humidity');
  const hasLight = t.source === 'esp32_sensor' ? t.lightPercent != null : t.radiation != null;
  if (!hasLight) missing.push('light');

  if (t.source === 'weather_estimate') {
    lower('medium');
    issues.push('Soil moisture is estimated from weather, not measured');
    return done(false, false);
  }

  // Stale / unavailable
  const staleAfterMs = Math.max(q.minStaleMs, pollMs * q.staleAfterPolls);
  const age = now - t.timestamp;
  const stale = age > staleAfterMs;
  if (stale) {
    lower('low');
    issues.push(`No fresh sensor reading for ${formatAge(age)}${deviceError ? ` (${deviceError})` : ''}`);
  } else if (deviceError) {
    lower('medium');
    issues.push(`Last poll failed: ${deviceError}`);
  }

  // Values the device sent outside their physical range (found before clamping), hardware flags
  for (const issue of t.sensorIssues ?? []) {
    if (issue.startsWith('soil')) {
      suspect.soil = true;
      lower('low');
    } else if (issue.startsWith('light')) {
      suspect.light = true;
      lower('medium');
    } else {
      suspect.air = true;
      lower(issue.startsWith('HTS221') ? 'medium' : 'low');
    }
    issues.push(issue);
  }

  // Probe pinned at an ADC rail right now
  const rail = (raw: number | null | undefined) => raw != null && (raw <= q.adcRailMargin || raw >= q.adcMax - q.adcRailMargin);
  if (rail(t.soilRaw)) {
    suspect.soil = true;
    lower('low');
    issues.push(`Soil probe reads ${t.soilRaw} (ADC limit): check it is in the soil and connected`);
  }

  // Readings that should move but haven't (sustained over the recent continuous samples)
  if (!stale && recent.length > 1) {
    const latest = recent[recent.length - 1];
    if (latest.soilRaw !== null) {
      const stuck = heldMinutes(recent, (s) => s.soilRaw !== null && Math.abs(s.soilRaw - latest.soilRaw!) <= q.stuckRawTolerance, gapMs);
      if (stuck >= q.stuckRawMinutes) {
        suspect.soil = true;
        lower('low');
        issues.push(`Soil probe raw value hasn't changed (±${q.stuckRawTolerance}) for ${formatAge(stuck * 60000)}: probe may be stuck or disconnected`);
      }
    }
    if (latest.soil === 0 || latest.soil === 100) {
      const pinned = heldMinutes(recent, (s) => s.soil === latest.soil, gapMs);
      if (pinned >= q.pinnedSoilMinutes) {
        suspect.soil = true;
        lower('low');
        issues.push(`Soil reading pinned at ${latest.soil}% for ${formatAge(pinned * 60000)}: outside the calibrated range, check calibration`);
      }
    }
    if (latest.lightRaw !== null) {
      const darkInDaylight = heldMinutes(recent, (s) => s.lightExpected && s.lightRaw !== null && s.lightRaw <= q.adcRailMargin, gapMs);
      const saturated = heldMinutes(recent, (s) => s.lightRaw !== null && s.lightRaw >= q.adcMax - q.adcRailMargin, gapMs);
      if (darkInDaylight >= q.ldrRailMinutes || saturated >= q.ldrRailMinutes) {
        suspect.light = true;
        lower('medium');
        issues.push(
          darkInDaylight >= q.ldrRailMinutes
            ? `Light sensor reads 0 in daylight for ${formatAge(darkInDaylight * 60000)}: LDR may be disconnected`
            : `Light sensor saturated at ${latest.lightRaw} for ${formatAge(saturated * 60000)}: LDR may be shorted`
        );
      }
    }
  }

  // Impossible jumps between consecutive readings
  if (previous && previous.source === t.source && t.timestamp > previous.timestamp) {
    const minutes = Math.max(1, (t.timestamp - previous.timestamp) / 60000);
    if (t.temperature !== null && previous.temperature !== null) {
      const rate = Math.abs(t.temperature - previous.temperature) / minutes;
      if (rate > q.maxJumpPerMinute.temperature) {
        lower('medium');
        issues.push(`Temperature jumped ${round1(t.temperature - previous.temperature)}°C between readings`);
      }
    }
    if (t.humidity !== null && previous.humidity !== null) {
      const rate = Math.abs(t.humidity - previous.humidity) / minutes;
      if (rate > q.maxJumpPerMinute.humidity) {
        lower('medium');
        issues.push(`Humidity jumped ${round1(t.humidity - previous.humidity)}% between readings`);
      }
    }
  }

  if (missing.length > 0) {
    lower('medium');
    issues.push(`Not reported: ${missing.join(', ')}`);
  }

  const insufficientHistory = historyMinutes < q.minHistoryMinutes;
  if (insufficientHistory) {
    lower('medium');
    issues.push(`Only ${Math.round(historyMinutes)} min of recent history: still getting to know conditions`);
  }

  return done(stale, insufficientHistory);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function formatAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${Math.round(m / 6) / 10}h`;
}
