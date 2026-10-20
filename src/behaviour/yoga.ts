import { APP_CONFIG } from '../config/appConfig';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { DayForecast } from '../telemetry/hikeForecast';
import { HOUR, clockOn } from '../lib/time';
import type { DiaryItem } from '../history/historyTypes';
import { addDays, dateKey, hikeScore, weekOf, type HikeMemory, type HikePlan } from './hike';

// Yoga days: "yoga lifts us up". Twice a week the tree picks the two worst days ahead, for its people and for
// itself, and on those days everyone does yoga together by the pot (two mats where the boots stand on hike
// day). About the people, never the tree: health, mood, energy and the visitors never read it (evidence class
// art). Lucy finds the open mat; the tree says when; the diary keeps the days.
//
// - The same weeks (Monday to Sunday) and the same daily forecast as the hike (hike_memory.forecast).
// - Gloom of a day = for us, 100 − the hike score (rain, storm, cold or hot highs, gusts); for the tree, the
//   forecast's heat above its comfort, cold nights below it, a dark sky (little light for the leaves), and
//   the day its soil is forecast to reach thirsty if nobody waters (its dry-down at medium/high confidence).
// - The two gloomiest remaining days, never the hike day. Each follows the forecast until its day arrives,
//   then it is locked; a moved pick remembers where it moved from. A hike chosen on a yoga day moves yoga.

export interface YogaGloom {
  date: string;
  gloom: number; // higher = a worse day
  us: number; // 100 − hike score
  tree: { heat: number; cold: number; dark: number; thirsty: number };
}

// Persisted beside the hike's weeks (meta.hike_memory.yoga[week]), never inside them
export interface YogaPick {
  days: string[]; // the week's two yoga days, in date order
  movedFrom: string | null; // a day it was picked before the forecast changed
}

export interface YogaPlan {
  week: string; // the week's Monday
  days: string[];
  today: boolean; // a yoga day today: the mats are out
  nextWeek: boolean; // this week's yoga days are behind us: next week's
  movedFrom: string | null;
  week7: (YogaGloom | null)[]; // Monday … Sunday of the plan's week (null: passed, or no forecast)
}

// The tree's own outlook: the day its soil would reach thirsty if nobody waters (from the dry-down trend)
export function thirstyOutlook(p: Pick<PerceptionState, 'readings' | 'trends'>, species: SpeciesProfile, now: number): string | null {
  const soil = p.readings.soilMoisture;
  const dd = p.trends.soilDryDown;
  const enter = species.latches.thirsty.enter;
  if (soil === null) return null;
  if (soil < enter) return dateKey(now);
  if (!dd || dd.confidence === 'low' || dd.perHour >= 0) return null;
  return dateKey(now + ((soil - enter) / -dd.perHour) * HOUR);
}

export function yogaGloom(f: DayForecast, species: SpeciesProfile, thirstyOn: string | null): YogaGloom {
  const y = APP_CONFIG.yoga;
  const t = species.temperature;
  const r = (n: number) => Math.round(n);
  const tree = {
    heat: f.tMax !== null && f.tMax > t.maxOptimal ? r((f.tMax - t.maxOptimal) * y.perDegreeHot) : 0,
    cold: f.tMin !== null && f.tMin < t.minWarning ? r((t.minWarning - f.tMin) * y.perDegreeCold) : 0,
    dark: y.darkSky[f.sky] ?? 0,
    thirsty: thirstyOn === f.date ? y.thirstyDay : 0,
  };
  const us = 100 - hikeScore(f);
  return { date: f.date, gloom: us + tree.heat + tree.cold + tree.dark + tree.thirsty, us, tree };
}

// The week's yoga days right now, and the memory to keep (picks move with the forecast until their day)
export function planYoga(memory: HikeMemory, species: SpeciesProfile, thirstyOn: string | null, now: number): { plan: YogaPlan | null; memory: HikeMemory } {
  const forecast = memory.forecast;
  if (!forecast?.days.length) return { plan: null, memory };
  const today = dateKey(now);
  const byDate = new Map(forecast.days.map((d) => [d.date, d]));
  const weeks = memory.weeks; // the hike's (read only)
  const yoga: Record<string, YogaPick> = { ...(memory.yoga ?? {}) };
  const n = APP_CONFIG.yoga.daysPerWeek;
  const gloomOf = (date: string) => yogaGloom(byDate.get(date)!, species, thirstyOn);

  const plan = (week: string): YogaPick | null => {
    const w = weeks[week];
    const prev = yoga[week] ?? null;
    const hikeDay = w ? w.chosen ?? w.day : null;
    // Locked: today and the days behind us (a hike chosen on today's yoga day takes it)
    const fixed = (prev?.days ?? []).filter((d) => d <= today && d !== hikeDay);
    // Today is open to a first pick only (never made a yoga day mid-day by a new forecast)
    const from = prev ? addDays(today, 1) : today;
    const ranked = Array.from({ length: 7 }, (_, i) => addDays(week, i))
      .filter((d) => d >= from && byDate.has(d) && d !== hikeDay && !fixed.includes(d))
      .map(gloomOf)
      .sort((a, b) => b.gloom - a.gloom || (a.date < b.date ? -1 : 1))
      .map((g) => g.date);
    const days = [...fixed, ...ranked.slice(0, Math.max(0, n - fixed.length))].sort();
    if (!days.length) return prev;
    const lost = (prev?.days ?? []).find((d) => d > today && !days.includes(d)) ?? null;
    const next: YogaPick = { days, movedFrom: lost ?? (prev && JSON.stringify(prev.days) === JSON.stringify(days) ? prev.movedFrom : null) };
    if (JSON.stringify(next) !== JSON.stringify(prev)) yoga[week] = next;
    return next;
  };

  let week = weekOf(today);
  let pick = plan(week);
  let nextWeek = false;
  if (!pick || pick.days.every((d) => d < today)) {
    week = addDays(week, 7);
    pick = plan(week);
    nextWeek = true;
  }
  // Forget old weeks, as the hike does
  const keepFrom = addDays(weekOf(today), -7 * APP_CONFIG.hike.weeksKept);
  for (const k of Object.keys(yoga)) if (k < keepFrom) delete yoga[k];
  const nextMemory = JSON.stringify(yoga) === JSON.stringify(memory.yoga ?? {}) ? memory : { ...memory, yoga };
  if (!pick) return { plan: null, memory: nextMemory };
  const week7 = Array.from({ length: 7 }, (_, i): YogaGloom | null => {
    const date = addDays(week, i);
    return byDate.has(date) && date >= today ? gloomOf(date) : null;
  });
  return { plan: { week, days: pick.days, today: pick.days.includes(today), nextWeek, movedFrom: pick.movedFrom, week7 }, memory: nextMemory };
}

// The yoga days kept in the memory up to now (the diary): past and today's
export function yogaDaysOf(memory: HikeMemory, now: number): string[] {
  const today = dateKey(now);
  return Object.values(memory.yoga ?? {})
    .flatMap((w) => w.days)
    .filter((d) => d <= today)
    .sort();
}

// The diary: one line per yoga day (at 08:00, once that hour has come), from the days kept in the memory
export function yogaDiary(days: string[], since: number, now: number): DiaryItem[] {
  return days.flatMap((d) => {
    const [y, m, day] = d.split('-').map(Number);
    const at = clockOn(y, m, day, 8);
    return at >= since && at <= now ? [{ at, kind: 'habitat' as const, habitat: 'yoga' as const, title: 'Yoga by the tree', detail: 'one of the two greyest days of the week' }] : [];
  });
}
