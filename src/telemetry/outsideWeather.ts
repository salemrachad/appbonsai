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
}

// What perception passes on: the observation, or nothing once it is too old to describe "now".
export interface OutsideWeather extends OutsideObservation {
  windy: boolean;
  ageMs: number;
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

export function outsideNow(o: OutsideObservation | null, now: number): OutsideWeather | null {
  if (!o) return null;
  const ageMs = now - o.at;
  if (ageMs > OUTSIDE_STALE_MS || ageMs < -5 * 60 * 1000) return null;
  return { ...o, windy: (o.gusts ?? 0) >= WINDY_GUSTS_KMH, ageMs };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function fetchOutsideWeather(settings: TreeSettings, now = Date.now()): Promise<{ observation: OutsideObservation; raw: unknown }> {
  if (settings.latitude == null || settings.longitude == null) throw new Error('no location set');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${settings.latitude}&longitude=${settings.longitude}` +
    '&current=weather_code,temperature_2m,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,wind_gusts_10m,is_day&timezone=auto';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo responded with status ${response.status}`);
  const data = await response.json();
  const c = data?.current ?? {};
  const code = num(c.weather_code);
  if (code === null) throw new Error('Open-Meteo returned no current weather');
  return {
    raw: c,
    observation: {
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
    },
  };
}
