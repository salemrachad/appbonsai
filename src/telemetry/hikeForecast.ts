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
  sunrise?: string | null; // local "06:12" at the location
  sunset?: string | null;
  hours?: HourForecast[]; // the day hour by hour (local hours), for the best time of the hike
}

// One hour of the day's forecast
export interface HourForecast {
  hour: number; // 0-23, local at the location
  code: number;
  sky: OutsideSky;
  temp: number | null; // °C
  rainChance: number | null; // %
  rainMm: number | null;
  gusts: number | null; // km/h
  uv: number | null;
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
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,sunrise,sunset' +
    '&hourly=weather_code,temperature_2m,precipitation_probability,precipitation,wind_gusts_10m,uv_index&forecast_days=14&timezone=auto';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Open-Meteo responded with status ${response.status}`);
  const json = await response.json();
  const d = json?.daily ?? {};
  // Hourly values grouped by their local date ("2026-10-18T08:00")
  const h = json?.hourly ?? {};
  const byDate = new Map<string, HourForecast[]>();
  (Array.isArray(h.time) ? h.time : []).forEach((t: unknown, i: number) => {
    const code = num(h.weather_code?.[i]);
    if (typeof t !== 'string' || code === null) return;
    const list = byDate.get(t.slice(0, 10)) ?? [];
    list.push({
      hour: Number(t.slice(11, 13)),
      code,
      sky: skyFromCode(code),
      temp: num(h.temperature_2m?.[i]),
      rainChance: num(h.precipitation_probability?.[i]),
      rainMm: num(h.precipitation?.[i]),
      gusts: num(h.wind_gusts_10m?.[i]),
      uv: num(h.uv_index?.[i]),
    });
    byDate.set(t.slice(0, 10), list);
  });
  const clock = (v: unknown) => (typeof v === 'string' && v.length >= 16 ? v.slice(11, 16) : null);
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
        sunrise: clock(d.sunrise?.[i]),
        sunset: clock(d.sunset?.[i]),
        ...(byDate.has(date) ? { hours: byDate.get(date) } : {}),
      },
    ];
  });
  if (!days.length) throw new Error('Open-Meteo returned no daily forecast');
  return { fetchedAt: now, days };
}
