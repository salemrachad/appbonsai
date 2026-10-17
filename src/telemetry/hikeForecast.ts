import type { TreeSettings } from '../settings/settings';
import { skyFromCode, type OutsideSky } from './outsideWeather';

// The daily forecast for the coming two weeks at the tree's location (Open-Meteo), for the weekly hike
// pick (behaviour/hike.ts). About the people, never the tree: nothing in perception or health reads it.
// Never invented: a failed fetch keeps the last forecast, and its age is shown with the plan.

export interface DayForecast {
  date: string; // local date at the location, "2026-10-17"
  code: number; // WMO weather code (the day's most significant)
  sky: OutsideSky;
  tMax: number | null; // °C
  tMin: number | null;
  rainChance: number | null; // %, the day's maximum
  rainMm: number | null; // mm over the day
  gustsMax: number | null; // km/h
}

export interface HikeForecast {
  fetchedAt: number;
  days: DayForecast[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export async function fetchHikeForecast(settings: TreeSettings, now = Date.now()): Promise<HikeForecast> {
  if (settings.latitude == null || settings.longitude == null) throw new Error('no location set');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${settings.latitude}&longitude=${settings.longitude}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max&forecast_days=14&timezone=auto';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo responded with status ${response.status}`);
  const d = (await response.json())?.daily ?? {};
  const dates: unknown[] = Array.isArray(d.time) ? d.time : [];
  const days = dates.flatMap((date, i): DayForecast[] => {
    const code = num(d.weather_code?.[i]);
    if (typeof date !== 'string' || code === null) return [];
    return [
      {
        date,
        code,
        sky: skyFromCode(code),
        tMax: num(d.temperature_2m_max?.[i]),
        tMin: num(d.temperature_2m_min?.[i]),
        rainChance: num(d.precipitation_probability_max?.[i]),
        rainMm: num(d.precipitation_sum?.[i]),
        gustsMax: num(d.wind_gusts_10m_max?.[i]),
      },
    ];
  });
  if (!days.length) throw new Error('Open-Meteo returned no daily forecast');
  return { fetchedAt: now, days };
}
