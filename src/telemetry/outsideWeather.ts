import { APP_CONFIG } from '../config/appConfig';
import { off, step } from '../lib/latch';
import type { TreeSettings } from '../settings/settings';

// Outside weather (Open-Meteo, at the tree's location). The tree lives in a greenhouse: the ESP32 measures
// the inside, and that stays the only truth about the tree. Outside weather is CONTEXT only: it is stored,
// shown in the scene and mentioned in words, and it never reaches health, latches, vitality or the habitat.
// Never invented: a failed fetch keeps the last observation, which goes stale and is then shown as nothing.

export type OutsideSky = 'clear' | 'partly_cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain' | 'heavy_rain' | 'snow' | 'thunderstorm';
export const OUTSIDE_SKIES: OutsideSky[] = ['clear', 'partly_cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'heavy_rain', 'snow', 'thunderstorm'];

export interface OutsideObservation {
  at: number;
  sky: OutsideSky;
  code: number; // WMO weather code as received
  temperature: number | null; // °C
  humidity: number | null; // %
  precipitation: number | null; // mm in the last hour
  cloudCover: number | null; // %
  wind: number | null; // km/h
  gusts: number | null; // km/h
  isDay: boolean | null;
  sunrise?: number | null; // today's published sunrise at the location (ms)
  sunset?: number | null;
  // Beyond the sky (absent when unknown: older rows, a failed air-quality fetch)
  pressure?: number | null; // hPa at sea level
  aqi?: number | null; // European AQI (Open-Meteo CAMS model)
  pm25?: number | null; // µg/m³
  pm10?: number | null;
}

export type PressureTendency = 'falling_fast' | 'falling' | 'steady' | 'rising';
export type AirBand = 'good' | 'fair' | 'moderate' | 'poor' | 'very_poor' | 'extremely_poor';
export interface OutsideAir {
  aqi: number;
  pm25: number | null;
  pm10: number | null;
  band: AirBand;
}

// What perception passes on: the observation, or nothing once it is too old to describe "now".
export interface OutsideWeather extends OutsideObservation {
  windy: boolean;
  ageMs: number;
  rainEndedAt: number | null; // the first dry observation after rain, today (null: no rain, or still raining)
  // The barometer over the last 3 h and the air outside. Context only: never health. Absent when unknown.
  pressureTrend?: number; // hPa per 3 h
  pressureTendency?: PressureTendency;
  air?: OutsideAir;
  // The same with persistence (Schmitt latches with durations over the last hours): what the art reads, so a
  // value hovering at a threshold never flickers. Present only while on.
  weatherComing?: { since: number }; // the barometer falling fast for a while
  hazy?: { since: number }; // poor air for a while
}

// The barometer and the air with hysteresis, at time t, replayed over the observations given (the last
// hours). Each observation's pressure trend is the one known then; a gap of more than 45 min restarts the
// pending switches (nothing is learned from time not observed).
export function outsideLatches(observations: OutsideObservation[], t: number): { weatherComing: { since: number } | null; hazy: { since: number } | null } {
  const L = APP_CONFIG.outside.latches;
  const P = APP_CONFIG.outside.pressure;
  const obs = observations.filter((o) => o.at <= t).sort((a, b) => a.at - b.at);
  const coming = off();
  const hazy = off();
  let last: number | null = null;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (last !== null && o.at - last > 45 * 60 * 1000) coming.pending = hazy.pending = null;
    last = o.at;
    const trend = pressureTrend(obs.slice(0, i + 1), o.at);
    if (trend !== null) step(coming, o.at, trend <= P.fallingFast, trend > L.weatherComing.exitTrend, L.weatherComing.enterMin * 60_000, L.weatherComing.exitMin * 60_000);
    if (typeof o.aqi === 'number') step(hazy, o.at, o.aqi > L.hazy.enterAqi, o.aqi < L.hazy.exitAqi, L.hazy.enterMin * 60_000, L.hazy.exitMin * 60_000);
  }
  return { weatherComing: coming.on ? { since: coming.since! } : null, hazy: hazy.on ? { since: hazy.since! } : null };
}

// The barometer's change, as hPa per 3 h: a least-squares slope over the observations of the last 3 h.
// Null without at least 2 h of observations with a pressure.
export function pressureTrend(observations: OutsideObservation[], now: number): number | null {
  const P = APP_CONFIG.outside.pressure;
  const pts = observations.filter((o) => o.at <= now && o.at >= now - P.windowMs - 15 * 60 * 1000 && typeof o.pressure === 'number');
  if (pts.length < 2) return null;
  const t0 = Math.min(...pts.map((o) => o.at));
  if (Math.max(...pts.map((o) => o.at)) - t0 < P.minSpanMs) return null;
  const xs = pts.map((o) => (o.at - t0) / P.windowMs); // in units of 3 h
  const ys = pts.map((o) => o.pressure as number);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  return den === 0 ? null : Math.round((num / den) * 10) / 10;
}

export function pressureTendency(trend: number | null): PressureTendency | null {
  if (trend === null) return null;
  const P = APP_CONFIG.outside.pressure;
  return trend <= P.fallingFast ? 'falling_fast' : trend <= P.falling ? 'falling' : trend >= P.rising ? 'rising' : 'steady';
}

export function airBand(aqi: number): AirBand {
  const b = APP_CONFIG.outside.aqiBands;
  return aqi <= b.good ? 'good' : aqi <= b.fair ? 'fair' : aqi <= b.moderate ? 'moderate' : aqi <= b.poor ? 'poor' : aqi <= b.very_poor ? 'very_poor' : 'extremely_poor';
}

const WET: OutsideSky[] = ['drizzle', 'rain', 'heavy_rain', 'thunderstorm', 'snow'];

// When the last wet spell (rain, storm, snow) ended: the first dry observation after a wet one.
export function rainEndedAt(observations: OutsideObservation[], now: number): number | null {
  let wetSeen = false;
  let endedAt: number | null = null;
  for (const o of [...observations].filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
    const wet = WET.includes(o.sky);
    if (wet) {
      wetSeen = true;
      endedAt = null;
    } else if (wetSeen && endedAt === null) endedAt = o.at;
  }
  return endedAt;
}

const WINDY_GUSTS_KMH = 40;
export const OUTSIDE_STALE_MS = 60 * 60 * 1000; // older than this: not shown

// WMO weather interpretation codes (Open-Meteo docs) → a small vocabulary the scene can draw.
export function skyFromCode(code: number): OutsideSky {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly_cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 66 || code === 80) return 'rain';
  if (code === 63 || code === 65 || code === 67 || code === 81 || code === 82) return 'heavy_rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'overcast';
}

// recent: the observations of the last hours (the barometer's tendency); without them, no tendency
export function outsideNow(o: OutsideObservation | null, now: number, today: OutsideObservation[] = [], recent: OutsideObservation[] = []): OutsideWeather | null {
  if (!o) return null;
  const ageMs = now - o.at;
  if (ageMs > OUTSIDE_STALE_MS || ageMs < -5 * 60 * 1000) return null;
  const w: OutsideWeather = { ...o, windy: (o.gusts ?? 0) >= WINDY_GUSTS_KMH, ageMs, rainEndedAt: rainEndedAt(today, now) };
  const trend = pressureTrend(recent, now);
  if (trend !== null) {
    w.pressureTrend = trend;
    w.pressureTendency = pressureTendency(trend)!;
  }
  if (typeof o.aqi === 'number') w.air = { aqi: o.aqi, pm25: o.pm25 ?? null, pm10: o.pm10 ?? null, band: airBand(o.aqi) };
  const latched = outsideLatches(recent, now);
  if (latched.weatherComing) w.weatherComing = latched.weatherComing;
  if (latched.hazy) w.hazy = latched.hazy;
  return w;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function fetchOutsideWeather(settings: TreeSettings, now = Date.now()): Promise<{ observation: OutsideObservation; raw: unknown }> {
  if (settings.latitude == null || settings.longitude == null) throw new Error('no location set');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${settings.latitude}&longitude=${settings.longitude}` +
    '&current=weather_code,temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day,pressure_msl&daily=sunrise,sunset&forecast_days=1&timezone=auto';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo responded with status ${response.status}`);
  const data: any = await response.json(); // Open-Meteo JSON, read field by field below
  const c = data?.current ?? {};
  // Daily times come as local wall-clock strings ("2026-10-16T06:42") plus the location's UTC offset
  const offset = num(data?.utc_offset_seconds) ?? 0;
  const local = (iso: unknown): number | null => {
    if (typeof iso !== 'string') return null;
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offset * 1000 : null;
  };
  const code = num(c.weather_code);
  if (code === null) throw new Error('Open-Meteo returned no current weather');
  // The air (a separate Open-Meteo API, modelled, so worldwide). Its failure leaves the weather as it is.
  let air: any = null;
  try {
    const aq = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${settings.latitude}&longitude=${settings.longitude}&current=european_aqi,pm2_5,pm10&timezone=auto`
    );
    if (aq.ok) air = ((await aq.json()) as any)?.current ?? null; // Open-Meteo JSON, read field by field below
  } catch {
    air = null;
  }
  const pressure = num(c.pressure_msl);
  const aqi = num(air?.european_aqi);
  return {
    raw: air ? { ...c, air } : c,
    observation: {
      ...(pressure !== null && { pressure }),
      ...(aqi !== null && { aqi, pm25: num(air?.pm2_5), pm10: num(air?.pm10) }),
      at: now,
      sky: skyFromCode(code),
      code,
      temperature: num(c.temperature_2m),
      humidity: num(c.relative_humidity_2m),
      precipitation: num(c.precipitation),
      cloudCover: num(c.cloud_cover),
      wind: num(c.wind_speed_10m),
      gusts: num(c.wind_gusts_10m),
      isDay: c.is_day == null ? null : c.is_day === 1,
      sunrise: local(data?.daily?.sunrise?.[0]),
      sunset: local(data?.daily?.sunset?.[0]),
    },
  };
}
