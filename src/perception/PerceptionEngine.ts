import { outsideNow, type OutsideObservation } from '../telemetry/outsideWeather';
import { APP_CONFIG } from '../config/appConfig';
import type { PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import { assessDataQuality } from '../telemetry/dataQuality';
import type { PlantTelemetry } from '../telemetry/types';
import type { AirComparison, PerceivedReadings, PerceptionSample, PerceptionState } from './perceptionTypes';
import { absoluteHumidity, dewPoint } from '../telemetry/telemetryNormalizer';
import { computeCareContext } from './careContext';
import { computeDailyLight } from './dailyLight';
import { dryingCoupling, soilDryDown, temperatureExposure } from './environment';
import { seasonState } from './season';
import { sunState, sunTimes, type SunState } from './sun';

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
  soilBreaks?: number[]; // calibration changes / detection pauses: a dry-down segment never bridges them
}

// Inside vs outside air by dew point and absolute humidity. Only with the real inside sensor (in weather
// mode the "inside" readings ARE the outside estimate) and fresh outside weather.
function compareAir(r: PerceivedReadings, source: string | null, o: { temperature: number | null; humidity: number | null } | null): AirComparison | null {
  if (source !== 'esp32_sensor' || !o) return null;
  const inside = dewPoint(r.temperature, r.humidity);
  const outside = dewPoint(o.temperature, o.humidity);
  const ahIn = absoluteHumidity(r.temperature, r.humidity);
  const ahOut = absoluteHumidity(o.temperature, o.humidity);
  if (inside === null || outside === null || ahIn === null || !ahOut || o.temperature === null) return null;
  return {
    insideDewPoint: inside,
    outsideDewPoint: outside,
    moistureRatio: Math.round((ahIn / ahOut) * 10) / 10,
    // The glass sits near the outside temperature: inside air that would condense at or above it fogs it
    glassMayFog: inside >= o.temperature,
  };
}

// Today's sunrise and sunset: Open-Meteo's published times when the latest observation carries today's,
// else our own calculation from the location.
function withSunTimes(sun: SunState, o: OutsideObservation | null, location: PerceptionInput['location'], now: number): SunState {
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const sameDay = (t: number | null | undefined) => t != null && t >= dayStart && t < dayStart + 24 * 3600 * 1000;
  if (o && sameDay(o.sunrise) && sameDay(o.sunset)) return { ...sun, sunrise: o.sunrise!, sunset: o.sunset!, timesFrom: 'open-meteo' };
  if (location.latitude == null || location.longitude == null) return sun;
  const t = sunTimes(now, location.latitude, location.longitude);
  return { ...sun, sunrise: t.sunrise, sunset: t.sunset, timesFrom: 'solar' };
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
  // Soil dry-down: one uninterrupted segment (never across a watering, calibration, gap or suspect sensor)
  const dryDown = soilDryDown({ samples: recent, events, breaks: input.soilBreaks ?? [], gapMs, soilSuspect: quality.suspect.soil, now });
  const light = computeDailyLight({ samples: recent, species, location, cadenceMs, movedAt: careContext.recentMove?.at ?? null, now, outside: input.outsideToday ?? [] });

  return {
    at: now,
    source: latest?.source ?? null,
    telemetry: fresh,
    lastReading: latest,
    readings,
    sun: withSunTimes(sun, input.outside ?? null, location, now),
    season: seasonState(now, location.latitude),
    device: {
      online: !!fresh && !deviceError,
      lastError: deviceError,
      lastReadingAt: latest?.timestamp ?? null,
      ageMs: latest ? now - latest.timestamp : null,
      wifiRssi: latest?.wifiRssi ?? null,
    },
    trends: {
      soilPerHour: dryDown?.perHour ?? null,
      soilDryDown: dryDown,
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
    drying: dryingCoupling(dryDown, recent, species, now),
    exposure: { temperature: temperatureExposure(recent, species, cadenceMs, now) },
    outside: outsideNow(input.outside ?? null, now, input.outsideToday ?? []),
    outsideToday: input.outsideToday ?? [],
    air: compareAir(readings, latest?.source ?? null, outsideNow(input.outside ?? null, now)),
  };
}
