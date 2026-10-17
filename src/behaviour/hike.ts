import { APP_CONFIG } from '../config/appConfig';
import type { DayForecast, HikeForecast } from '../telemetry/hikeForecast';

// The weekly hike: once a week the tree picks the day with the best forecast for its people's hike.
// About the people, never the tree: health and the habitat never read it; the tree announces the pick
// (a day line), Home shows it, and on the day two pairs of hiking boots stand by the pot.
//
// - Weeks run Monday to Sunday. Only the week's remaining days (today on) compete.
// - The pick follows the forecast until its day arrives; then it is locked for that week.
// - Once this week's hike day has passed, next week's pick is shown (tentative, it follows the forecast).
// - A changed pick remembers where it moved from, so the tree can say so.

export type HikeQuality = 'great' | 'good' | 'fair' | 'poor';

export interface HikeDayScore {
  date: string;
  score: number; // 0-100
  sky: DayForecast['sky'];
  tMax: number | null;
  rainChance: number | null;
}

export interface HikePlan {
  week: string; // the week's Monday, "2026-10-12"
  day: string; // the chosen date
  today: boolean; // hike day is today: the boots are out
  locked: boolean; // its day has arrived: the forecast no longer moves it
  nextWeek: boolean; // this week's hike is behind us: next week's pick
  movedFrom: string | null; // the day it was picked before the forecast changed
  quality: HikeQuality;
  forecast: DayForecast; // that day's forecast
  week7: (HikeDayScore | null)[]; // Monday … Sunday of the plan's week (null: passed, or no forecast)
  forecastAt: number; // when the forecast was fetched
}

export interface WeekPick {
  day: string;
  movedFrom: string | null;
  locked: boolean;
}

// Persisted by the collector (meta.hike_memory)
export interface HikeMemory {
  version: 1;
  forecast: HikeForecast | null;
  weeks: Record<string, WeekPick>; // by the week's Monday
}

export const INITIAL_HIKE_MEMORY: HikeMemory = { version: 1, forecast: null, weeks: {} };

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
export const addDays = (k: string, n: number) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d.getTime());
};
export const weekOf = (k: string) => addDays(k, -((fromKey(k).getDay() + 6) % 7)); // its Monday

export const weekdayName = (k: string) => fromKey(k).toLocaleDateString('en-US', { weekday: 'long' });

// How good a day is for a hike, 0-100: comfortable warmth, little chance of rain, no storm, no gale.
export function hikeScore(f: DayForecast): number {
  const s = APP_CONFIG.hike.score;
  let score = 100 - s.sky[f.sky];
  const [lo, hi] = s.comfortableMax;
  if (f.tMax !== null) score -= f.tMax < lo ? (lo - f.tMax) * s.perDegreeCold : f.tMax > hi ? (f.tMax - hi) * s.perDegreeHot : 0;
  if (f.rainChance !== null) score -= f.rainChance * s.perRainChance;
  if (f.rainMm !== null) score -= Math.min(s.rainMmCap, f.rainMm * s.perRainMm);
  if (f.gustsMax !== null && f.gustsMax > s.gustsFrom) score -= (f.gustsMax - s.gustsFrom) * s.perGust;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function hikeQuality(score: number): HikeQuality {
  const q = APP_CONFIG.hike.quality;
  return score >= q.great ? 'great' : score >= q.good ? 'good' : score >= q.fair ? 'fair' : 'poor';
}

// The plan right now, and the memory to keep (picks move with the forecast until their day, then lock).
export function planHike(memory: HikeMemory, now: number): { plan: HikePlan | null; memory: HikeMemory } {
  const forecast = memory.forecast;
  if (!forecast?.days.length) return { plan: null, memory };
  const today = dateKey(now);
  const byDate = new Map(forecast.days.map((d) => [d.date, d]));
  const weeks = { ...memory.weeks };

  // The best remaining day of a week (ties: the earlier day)
  const pick = (week: string): string | null => {
    let best: { date: string; score: number } | null = null;
    for (let i = 0; i < 7; i++) {
      const date = addDays(week, i);
      const f = byDate.get(date);
      if (date < today || !f) continue;
      const score = hikeScore(f);
      if (!best || score > best.score) best = { date, score };
    }
    return best?.date ?? null;
  };
  const choose = (week: string): WeekPick | null => {
    const prev = weeks[week];
    if (prev?.locked) return prev;
    const day = pick(week);
    if (!day) return prev ?? null;
    const next: WeekPick = { day, movedFrom: prev && prev.day !== day ? prev.day : prev?.movedFrom ?? null, locked: day <= today };
    weeks[week] = next;
    return next;
  };

  let week = weekOf(today);
  let chosen = choose(week);
  let nextWeek = false;
  if (!chosen || chosen.day < today) {
    // This week's hike is behind us (or nothing is left to pick): next week's
    week = addDays(week, 7);
    chosen = choose(week);
    nextWeek = true;
  }
  // Forget old weeks
  const keepFrom = addDays(weekOf(today), -7 * APP_CONFIG.hike.weeksKept);
  for (const k of Object.keys(weeks)) if (k < keepFrom) delete weeks[k];
  const nextMemory = JSON.stringify(weeks) === JSON.stringify(memory.weeks) ? memory : { ...memory, weeks };

  const f = chosen ? byDate.get(chosen.day) : undefined;
  if (!chosen || !f) return { plan: null, memory: nextMemory };
  const week7 = Array.from({ length: 7 }, (_, i): HikeDayScore | null => {
    const date = addDays(week, i);
    const d = byDate.get(date);
    return d && date >= today ? { date, score: hikeScore(d), sky: d.sky, tMax: d.tMax, rainChance: d.rainChance } : null;
  });
  const score = hikeScore(f);
  return {
    plan: {
      week,
      day: chosen.day,
      today: chosen.day === today,
      locked: chosen.locked,
      nextWeek,
      movedFrom: chosen.movedFrom,
      quality: hikeQuality(score),
      forecast: f,
      week7,
      forecastAt: forecast.fetchedAt,
    },
    memory: nextMemory,
  };
}
