import { outsideNow, type OutsideObservation } from '../telemetry/outsideWeather';
import { APP_CONFIG } from '../config/appConfig';
import type { PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import { assessDataQuality } from '../telemetry/dataQuality';
import type { PlantTelemetry } from '../telemetry/types';
import type { PerceivedReadings, PerceptionSample, PerceptionState } from './perceptionTypes';
import { computeCareContext } from './careContext';
import { computeDailyLight } from './dailyLight';
import { seasonState } from './season';
import { sunState } from './sun';

const HOUR = 3600 * 1000;
const EMPTY_READINGS: PerceivedReadings = {
  soilMoisture: null,
  soilRaw: null,
  temperature: null,
  humidity: null,
  vpd: null,
  lightPercent: null,
  lightRaw: null,
  radiation: null,
};

export interface PerceptionInput {
  latest: PlantTelemetry | null; // latest reading we have (may be stale)
  previous: PlantTelemetry | null; // reading before it
  recent: PerceptionSample[]; // past samples, oldest first (may or may not include `latest`)
  events: PlantEvent[]; // care events, any order
  location: { latitude: number | null; longitude: number | null };
  pollMs: number;
  deviceError: string | null;
  species: SpeciesProfile;
  now: number;
  outside?: OutsideObservation | null; // latest outside weather (context; health never reads it directly)
  outsideToday?: OutsideObservation[]; // today's outside observations: a grey sky explains dim light
}

export function toSample(t: PlantTelemetry, species: SpeciesProfile, location: PerceptionInput['location']): PerceptionSample {
  const sun = sunState(t.timestamp, location.latitude, location.longitude, species.lightExpectedAboveSunDeg);
  return {
    t: t.timestamp,
    soil: t.soilMoisture,
    soilRaw: t.soilRaw ?? null,
    temp: t.temperature,
    hum: t.humidity,
    light: t.source === 'esp32_sensor' ? t.lightPercent ?? null : null,
    radiation: t.source === 'weather_estimate' ? t.radiation ?? null : null,
    lightRaw: t.source === 'esp32_sensor' ? t.lightRaw ?? null : null,
    isDay: sun.isDay,
    lightExpected: sun.lightExpected,
  };
}

// Longest gap between readings that still counts as continuous observation.
export const continuityGapMs = (pollMs: number) => Math.max(APP_CONFIG.history.maxGapMs, pollMs * 2.5);

// Minutes of continuous history up to `now` (stops at the first gap longer than gapMs).
function continuousMinutes(samples: PerceptionSample[], now: number, gapMs: number): number {
  let since = now;
  let next = now;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (next - samples[i].t > gapMs) break;
    since = samples[i].t;
    next = samples[i].t;
  }
  return (now - since) / 60000;
}

// Change per hour over the last hour (null without at least 10 minutes of data).
function trend(samples: PerceptionSample[], pick: (s: PerceptionSample) => number | null, now: number): number | null {
  const pts = samples.filter((s) => s.t >= now - HOUR && pick(s) !== null);
  if (pts.length < 2) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const hours = (last.t - first.t) / HOUR;
  if (hours < 10 / 60) return null;
  return Math.round(((pick(last)! - pick(first)!) / hours) * 10) / 10;
}

// Everything the system currently knows about the tree and its surroundings, in one state.
// Sensors measure; perception gathers and qualifies; it never judges plant health.
export function perceive(input: PerceptionInput): PerceptionState {
  const { latest, previous, events, location, pollMs, deviceError, species, now } = input;
  const sun = sunState(now, location.latitude, location.longitude, species.lightExpectedAboveSunDeg);

  // Recent window (24h) including the latest reading
  const cutoff = now - 24 * HOUR;
  const recent = input.recent.filter((s) => s.t >= cutoff);
  if (latest && (recent.length === 0 || recent[recent.length - 1].t < latest.timestamp)) {
    recent.push(toSample(latest, species, location));
  }
  const gapMs = continuityGapMs(pollMs);
  const minutes = continuousMinutes(recent, now, gapMs);

  const quality = assessDataQuality({ telemetry: latest, previous, recent, gapMs, pollMs, historyMinutes: minutes, deviceError, now });
  const fresh = latest && !quality.stale ? latest : null;

  const readings: PerceivedReadings = fresh
    ? {
        soilMoisture: fresh.soilMoisture,
        soilRaw: fresh.soilRaw ?? null,
        temperature: fresh.temperature,
        humidity: fresh.humidity,
        vpd: fresh.vpd,
        lightPercent: fresh.source === 'esp32_sensor' ? fresh.lightPercent ?? null : null,
        lightRaw: fresh.lightRaw ?? null,
        radiation: fresh.source === 'weather_estimate' ? fresh.radiation ?? null : null,
      }
    : EMPTY_READINGS;

  const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
  const recentCare = sorted.filter((e) => e.timestamp >= now - 7 * 24 * HOUR && e.timestamp <= now);
  const careContext = computeCareContext(events, species, now);
  const cadenceMs = Math.max(APP_CONFIG.dataQuality.minStaleMs, pollMs * APP_CONFIG.dataQuality.staleAfterPolls);
  const light = computeDailyLight({ samples: recent, species, location, cadenceMs, movedAt: careContext.recentMove?.at ?? null, now, outside: input.outsideToday ?? [] });

  return {
    at: now,
    source: latest?.source ?? null,
    telemetry: fresh,
    lastReading: latest,
    readings,
    sun,
    season: seasonState(now, location.latitude),
    device: {
      online: !!fresh && !deviceError,
      lastError: deviceError,
      lastReadingAt: latest?.timestamp ?? null,
      ageMs: latest ? now - latest.timestamp : null,
      wifiRssi: latest?.wifiRssi ?? null,
    },
    trends: {
      soilPerHour: trend(recent, (s) => s.soil, now),
      temperaturePerHour: trend(recent, (s) => s.temp, now),
      humidityPerHour: trend(recent, (s) => s.hum, now),
    },
    history: {
      minutes: Math.round(minutes),
      samples: recent.length,
      gapMs,
      cadenceMs,
    },
    recent,
    care: {
      lastWatering: sorted.find((e) => e.type === 'watering' && e.timestamp <= now) ?? null,
      lastCare: sorted.find((e) => e.type !== 'manual_note' && e.timestamp <= now) ?? null,
      recent: recentCare,
      context: careContext,
    },
    light,
    quality,
    outside: outsideNow(input.outside ?? null, now, input.outsideToday ?? []),
  };
}
