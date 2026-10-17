import { APP_CONFIG } from '../config/appConfig';
import type { DayForecast, HikeForecast, HourForecast } from '../telemetry/hikeForecast';

// The weekly hike: once a week the tree picks the day with the best forecast for its people's hike.
// About the people, never the tree: health and the habitat never read it; the tree announces the pick
// (a day line), Home shows it, and on the day two pairs of hiking boots stand by the pot.
//
// - Weeks run Monday to Sunday. Only the week's remaining days (today on) compete.
// - The pick follows the forecast until its day arrives; then it is locked for that week.
// - Once this week's hike day has passed, next week's pick is shown (tentative, it follows the forecast).
// - A changed pick remembers where it moved from, so the tree can say so.
// - The tree offers two days a week: its pick and the next best. The people choose one on the calendar
//   (chooseHikeDay); their choice holds whatever the forecast does.

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
  locked: boolean; // its day has arrived, or the people chose it: the forecast no longer moves it
  chosen: boolean; // the people chose this day (of the tree's two)
  options: string[]; // the tree's two days for the week, its pick first (one when only one day is left)
  nextWeek: boolean; // this week's hike is behind us: next week's pick
  movedFrom: string | null; // the day it was picked before the forecast changed
  quality: HikeQuality;
  forecast: DayForecast; // that day's forecast (without its hours)
  detail?: HikeDetail | null; // the day's best hours and what comes after (absent: no hourly forecast)
  week7: (HikeDayScore | null)[]; // Monday … Sunday of the plan's week (null: passed, or no forecast)
  forecastAt: number; // when the forecast was fetched
}

export interface WeekPick {
  day: string;
  movedFrom: string | null;
  locked: boolean;
  chosen?: string | null; // the day the people chose (it wins over the tree's pick)
}

// The best hours of the hike day and what the rest of the day brings (from the hourly forecast)
export interface HikeDetail {
  from: number; // hour the best window starts (local at the location)
  to: number; // hour it ends
  tLow: number | null; // °C over the window
  tHigh: number | null;
  rainChance: number | null; // the window's highest %
  sky: DayForecast['sky']; // the window's worst sky
  rainFrom: number | null; // later in the daylight, rain likely from this hour
  hotFrom: number | null; // it gets hot from this hour
  gustsMax: number | null; // km/h over the window, when windy
  uvMax: number | null; // over the window, when strong
  sunrise: string | null;
  sunset: string | null;
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

// How good an hour is for walking, 0-100 (the day's sky penalties, the hour's own warmth, rain, wind, sun)
export function hourScore(h: HourForecast): number {
  const w = APP_CONFIG.hike.window;
  const s = APP_CONFIG.hike.score;
  let score = 100 - s.sky[h.sky];
  const [lo, hi] = w.comfortable;
  if (h.temp !== null) score -= h.temp < lo ? (lo - h.temp) * w.perDegree : h.temp > hi ? (h.temp - hi) * w.perDegree : 0;
  if (h.rainChance !== null) score -= h.rainChance * w.perRainChance;
  if (h.rainMm !== null) score -= h.rainMm * w.perRainMm;
  if (h.gusts !== null && h.gusts > s.gustsFrom) score -= (h.gusts - s.gustsFrom) * s.perGust;
  if (h.uv !== null && h.uv > w.uvFrom) score -= (h.uv - w.uvFrom) * w.perUv;
  return score;
}

// The best stretch of daylight for the hike (ties: the earlier start), and what comes after it
export function hikeWindow(day: DayForecast): HikeDetail | null {
  const w = APP_CONFIG.hike.window;
  const byHour = new Map((day.hours ?? []).map((h) => [h.hour, h]));
  if (!byHour.size) return null;
  const hourOf = (t: string | null | undefined, up: boolean) => {
    if (!t) return null;
    const [hh, mm] = t.split(':').map(Number);
    return up && mm > 0 ? hh + 1 : hh;
  };
  const first = hourOf(day.sunrise, true) ?? w.daylightFallback[0];
  const last = hourOf(day.sunset, false) ?? w.daylightFallback[1]; // the window ends by sunset
  const length = Math.max(1, Math.min(w.hours, last - first));
  let best: { from: number; score: number } | null = null;
  for (let from = first; from + length <= Math.max(last, first + length); from++) {
    const hours = Array.from({ length }, (_, i) => byHour.get(from + i));
    if (hours.some((h) => !h)) continue;
    const score = hours.reduce((sum, h) => sum + hourScore(h!), 0) / length;
    if (!best || score > best.score) best = { from, score };
  }
  if (!best) return null;
  const inWindow = Array.from({ length }, (_, i) => byHour.get(best!.from + i)!);
  const values = (pick: (h: HourForecast) => number | null) => inWindow.map(pick).filter((v): v is number => v !== null);
  const temps = values((h) => h.temp);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
  const s = APP_CONFIG.hike.score;
  const sky = inWindow.reduce((worst, h) => (s.sky[h.sky] > s.sky[worst] ? h.sky : worst), inWindow[0].sky);
  // Later the same day, while it is light
  const after = Array.from({ length: Math.max(0, last - (best.from + length)) }, (_, i) => byHour.get(best!.from + length + i)).filter((h): h is HourForecast => !!h);
  const daylight = Array.from({ length: Math.max(0, last - first) }, (_, i) => byHour.get(first + i)).filter((h): h is HourForecast => !!h);
  const gusts = max(values((h) => h.gusts));
  const uv = max(values((h) => h.uv));
  return {
    from: best.from,
    to: best.from + length,
    tLow: temps.length ? Math.round(Math.min(...temps)) : null,
    tHigh: temps.length ? Math.round(Math.max(...temps)) : null,
    rainChance: max(values((h) => h.rainChance)),
    sky,
    rainFrom: after.find((h) => (h.rainChance ?? 0) >= w.rainChanceFrom || (h.rainMm ?? 0) >= w.rainMmFrom)?.hour ?? null,
    hotFrom: daylight.find((h) => (h.temp ?? -99) >= w.hotFrom)?.hour ?? null,
    gustsMax: gusts !== null && gusts >= w.windyFrom ? Math.round(gusts) : null,
    uvMax: uv !== null && uv > w.uvFrom ? Math.round(uv) : null,
    sunrise: day.sunrise ?? null,
    sunset: day.sunset ?? null,
  };
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

  // The week's remaining days, best first (ties: the earlier day)
  const ranked = (week: string): string[] =>
    Array.from({ length: 7 }, (_, i) => addDays(week, i))
      .filter((date) => date >= today && byDate.has(date))
      .map((date) => ({ date, score: hikeScore(byDate.get(date)!) }))
      .sort((a, b) => b.score - a.score || (a.date < b.date ? -1 : 1))
      .map((d) => d.date);
  const pick = (week: string): string | null => ranked(week)[0] ?? null;
  const choose = (week: string): WeekPick | null => {
    const prev = weeks[week];
    if (prev?.locked) return prev;
    const day = pick(week);
    if (!day) return prev ?? null;
    const next: WeekPick = { ...prev, day, movedFrom: prev && prev.day !== day ? prev.day : prev?.movedFrom ?? null, locked: day <= today };
    weeks[week] = next;
    return next;
  };

  const dayOf = (p: WeekPick) => p.chosen ?? p.day; // the people's choice wins
  let week = weekOf(today);
  let chosen = choose(week);
  let nextWeek = false;
  if (!chosen || dayOf(chosen) < today) {
    // This week's hike is behind us (or nothing is left to pick): next week's
    week = addDays(week, 7);
    chosen = choose(week);
    nextWeek = true;
  }
  // Forget old weeks
  const keepFrom = addDays(weekOf(today), -7 * APP_CONFIG.hike.weeksKept);
  for (const k of Object.keys(weeks)) if (k < keepFrom) delete weeks[k];
  const nextMemory = JSON.stringify(weeks) === JSON.stringify(memory.weeks) ? memory : { ...memory, weeks };

  const day = chosen && dayOf(chosen);
  const f = day ? byDate.get(day) : undefined;
  if (!chosen || !day || !f) return { plan: null, memory: nextMemory };
  // The two days on offer: the tree's pick and the best other remaining day
  const options = [...(chosen.day >= today ? [chosen.day] : []), ...ranked(week).filter((d) => d !== chosen!.day)].slice(0, 2);
  const week7 = Array.from({ length: 7 }, (_, i): HikeDayScore | null => {
    const date = addDays(week, i);
    const d = byDate.get(date);
    return d && date >= today ? { date, score: hikeScore(d), sky: d.sky, tMax: d.tMax, rainChance: d.rainChance } : null;
  });
  const score = hikeScore(f);
  const { hours: _hours, ...dayOnly } = f; // the plan carries the window, not the 24 hours
  return {
    plan: {
      week,
      day,
      today: day === today,
      locked: chosen.locked || !!chosen.chosen,
      chosen: !!chosen.chosen,
      options,
      nextWeek,
      movedFrom: chosen.chosen ? null : chosen.movedFrom,
      quality: hikeQuality(score),
      forecast: dayOnly,
      detail: hikeWindow(f),
      week7,
      forecastAt: forecast.fetchedAt,
    },
    memory: nextMemory,
  };
}

// A plan from an older server (before the two days on offer) lacks options and chosen: one day, not chosen
export function withHikeDefaults<T extends HikePlan | null | undefined>(plan: T): T {
  return plan && (!plan.options || plan.chosen === undefined) ? { ...plan, options: plan.options ?? [plan.day], chosen: plan.chosen ?? false } : plan;
}

// The people choose a day of the week's hike (one of the tree's two, on the calendar). Any remaining day of
// this week or next with a forecast is accepted; null when the day can't be chosen.
export function chooseHikeDay(memory: HikeMemory, day: string, now: number): HikeMemory | null {
  const today = dateKey(now);
  const week = /^\d{4}-\d{2}-\d{2}$/.test(day) ? weekOf(day) : null;
  const thisWeek = weekOf(today);
  if (!week || day < today || (week !== thisWeek && week !== addDays(thisWeek, 7))) return null;
  if (!memory.forecast?.days.some((d) => d.date === day)) return null;
  const prev = memory.weeks[week] ?? { day, movedFrom: null, locked: false };
  return { ...memory, weeks: { ...memory.weeks, [week]: { ...prev, chosen: day } } };
}
