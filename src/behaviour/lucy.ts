import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { DiaryItem } from '../history/historyTypes';
import type { OutsideObservation, OutsideSky } from '../telemetry/outsideWeather';
import type { LucyCue, LucyPose, LucySpot, LucyState, LucyVisit, LucyVisitKind, LucyWeather } from './behaviourTypes';
import type { HikeDetail } from './hike';
import { slotPlan } from './habitat';
import { stableVariant } from './speech';
import { DAY, HOUR, MIN } from '../lib/time';

// Lucy: the household's Coton de Tuléar, a permanent companion by the pot. Evidence class "art + context".
// She is not a wild visitor: she doesn't have to trust the place, she lives here. So she follows other rules:
//
// - HER DAY follows the household clock (meals, walks), not the sun: 4–6 visits a day at jittered anchor
//   hours, and most nights asleep on her pillow by the pot. The plan is fixed per day (stable rolls on the
//   date), so the weather never moves a visit: it only changes how she spends it.
// - THE OUTSIDE WEATHER as she lives it: latches with enter/exit thresholds and durations, replayed from the
//   day's stored observations (heat, cold, storm, rain, a fine day). Heat: down sooner on the cool floor,
//   panting. Cold or rain: curled on her pillow. A storm brings her to the pot, close and awake. After rain
//   she comes in with a shake.
// - THE TREE never sends her away. A trusted moderate or worse stress makes her stay close: by the pot, chin
//   on her paws, watching it, longer visits and check-ins between them. Uncertain data: she's still here,
//   only neutral (no concern), so an unsure tree never looks falsely well cared for or falsely ill.
// - HIKE DAY: she goes along (away around the best hours), then comes back tired for a long nap.
// - Within a visit her poses only move one way: walking in → sitting → down → asleep → walking out. How
//   soon she settles comes from her settle value at arrival (the time of day and the weather).
//
// Derived and deterministic (nothing stored): a refresh or a restart shows the same Lucy. Health, energy,
// speech and the other visitors' engines never read her; her company calms the mood a little.

const C = () => APP_CONFIG.habitat.lucy;
// A stable 0-1 roll (a prime modulus: the hash's low bits alone repeat)
const roll = (key: string) => stableVariant(key, 997) / 997;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- The household clock: local time in the tree's timezone (settings), not the server's ----
// On Cloudflare the server runs in UTC; her bedtime is the household's. No timezone: the runtime's own.

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz?: string): Intl.DateTimeFormat {
  const key = tz ?? '';
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' };
    try {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz || undefined });
    } catch {
      f = new Intl.DateTimeFormat('en-US', opts); // an unknown timezone: the runtime's
    }
    formatters.set(key, f);
  }
  return f;
}
interface Civil {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  min: number;
}
function civil(t: number, tz?: string): Civil {
  const p: Record<string, number> = {};
  for (const x of formatter(tz).formatToParts(t)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour % 24, min: p.minute };
}
// How far the zone's wall clock is ahead of UTC at t
const offsetAt = (t: number, tz?: string) => {
  const c = civil(t, tz);
  return Date.UTC(c.y, c.m - 1, c.d, c.h, c.min) - Math.floor(t / MIN) * MIN;
};
// The instant of a wall-clock time (hours, fractional; past 24 runs into the next day), DST-safe
function clockOn(y: number, m: number, d: number, hour: number, tz?: string): number {
  const naive = Date.UTC(y, m - 1, d, 0, Math.round(hour * 60));
  const first = naive - offsetAt(naive, tz);
  return naive - offsetAt(first, tz);
}
const startOfDay = (t: number, tz?: string) => {
  const c = civil(t, tz);
  return clockOn(c.y, c.m, c.d, 0, tz);
};
const shiftDay = (day: number, by: number, tz?: string) => {
  const c = civil(day + 12 * HOUR, tz); // midday: clear of any DST edge
  return clockOn(c.y, c.m, c.d + by, 0, tz);
};
const clockAt = (day: number, hour: number, tz?: string) => {
  const c = civil(day + 12 * HOUR, tz);
  return clockOn(c.y, c.m, c.d, hour, tz);
};
const keyOf = (day: number, tz?: string) => {
  const c = civil(day + 12 * HOUR, tz);
  return `${c.y}-${c.m}-${c.d}`;
};

// ---- Weather latches (outside, context) ----

const RAINY: OutsideSky[] = ['drizzle', 'rain', 'heavy_rain'];
const FINE: OutsideSky[] = ['clear', 'partly_cloudy'];

interface Latch {
  on: boolean;
  since: number | null; // when it switched on
  pending: number | null; // a switch waiting for its duration
}
const off = (): Latch => ({ on: false, since: null, pending: null });

// A Schmitt trigger with durations: a pending switch is only cancelled when the value goes back past the
// other threshold, so readings hovering at a threshold neither flap nor block it.
function step(l: Latch, t: number, enterNow: boolean, exitNow: boolean, enterMs: number, exitMs: number) {
  if (!l.on) {
    if (enterNow) l.pending ??= t;
    else if (exitNow) l.pending = null;
    if (l.pending !== null && t - l.pending >= enterMs) Object.assign(l, { on: true, since: l.pending, pending: null });
  } else {
    if (exitNow) l.pending ??= t;
    else if (enterNow) l.pending = null;
    if (l.pending !== null && t - l.pending >= exitMs) Object.assign(l, { on: false, since: null, pending: null });
  }
}

export type LucyWeatherState = LucyWeather & { stormSince: number | null };

// The latches at time t, replayed over the observations up to t. A gap of more than 45 min restarts the
// pending switches (nothing is learned from time not observed); without observations nothing is on.
export function lucyWeather(obs: OutsideObservation[], t: number): LucyWeatherState {
  const L = C().latch;
  const s = { heat: off(), cold: off(), storm: off(), rain: off(), fineDay: off() };
  let last: number | null = null;
  for (const o of [...obs].filter((o) => o.at <= t).sort((a, b) => a.at - b.at)) {
    if (last !== null && o.at - last > 45 * MIN) for (const l of Object.values(s)) l.pending = null;
    last = o.at;
    const temp = o.temperature;
    if (temp !== null) {
      step(s.heat, o.at, temp >= L.heat.enter, temp <= L.heat.exit, L.heat.enterMin * MIN, L.heat.exitMin * MIN);
      step(s.cold, o.at, temp <= L.cold.enter, temp >= L.cold.exit, L.cold.enterMin * MIN, L.cold.exitMin * MIN);
    }
    const storm = o.sky === 'thunderstorm' || (o.gusts ?? 0) >= L.storm.gusts;
    step(s.storm, o.at, storm, !storm, L.storm.enterMin * MIN, L.storm.exitMin * MIN);
    const rain = RAINY.includes(o.sky);
    step(s.rain, o.at, rain, !rain, L.rain.enterMin * MIN, L.rain.exitMin * MIN);
    const fine = FINE.includes(o.sky) && temp !== null && temp >= L.fineDay.tempMin && temp <= L.fineDay.tempMax;
    step(s.fineDay, o.at, fine, !fine, L.fineDay.enterMin * MIN, L.fineDay.exitMin * MIN);
  }
  return { heat: s.heat.on, cold: s.cold.on, storm: s.storm.on, rain: s.rain.on, fineDay: s.fineDay.on, stormSince: s.storm.since };
}

// How ready to settle she is when she arrives (0 restless … 1 sleepy): after lunch and in the evening she
// settles sooner; rain, cold, heat and a storm bring her down sooner; a fine day keeps her up and about
export function lucySettle(t: number, w: LucyWeather, tz?: string): number {
  const s = C().settle;
  const now = civil(t, tz);
  const h = now.h + now.min / 60;
  let v = s.base;
  if (h >= 13 && h < 16.5) v += s.afterLunch;
  if (h >= 19 || h < 5) v += s.evening;
  if (h >= 5 && h < 10) v += s.morning;
  if (w.rain) v += s.rain;
  if (w.cold) v += s.cold;
  if (w.heat) v += s.heat;
  if (w.storm) v += s.storm;
  if (w.fineDay) v += s.fineDay;
  return Math.round(clamp01(v) * 100) / 100;
}

// ---- Her day ----

export interface LucyPlannedVisit {
  id: string;
  kind: Extract<LucyVisitKind, 'day' | 'night' | 'after_hike'>;
  startedAt: number;
  endsAt: number;
}
export interface LucyDay {
  dayKey: string;
  visits: LucyPlannedVisit[]; // in time order; the night one (if any) starts this evening
  away: { from: number; to: number } | null; // on the hike
}

// The plan of the day containing `t`. A hike (its best hours, local) takes her away around them, drops the
// visits that would fall in that time and adds a long tired nap after.
export function lucyDay(t: number, hike?: Pick<HikeDetail, 'from' | 'to'> | null, tz?: string): LucyDay {
  const c = C();
  const day = startOfDay(t, tz);
  const key = keyOf(day, tz);
  const n = c.visitsPerDay.min + stableVariant(`lucy:${key}:count`, c.visitsPerDay.max - c.visitsPerDay.min + 1);
  const anchors = c.anchors
    .map((h, i) => ({ h, i, r: roll(`lucy:${key}:pick:${i}`) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .sort((a, b) => a.h - b.h);
  let visits: LucyPlannedVisit[] = anchors.map(({ h, i }) => {
    const startedAt = clockAt(day, h + ((roll(`lucy:${key}:jitter:${i}`) * 2 - 1) * c.jitterMin) / 60, tz);
    const minutes = c.visitMinutes.min + Math.round(roll(`lucy:${key}:len:${i}`) * (c.visitMinutes.max - c.visitMinutes.min));
    return { id: `lucy:${key}:${i}`, kind: 'day', startedAt, endsAt: startedAt + minutes * MIN };
  });
  let away: LucyDay['away'] = null;
  if (hike) {
    const from = clockAt(day, hike.from, tz) - c.hike.marginMin * MIN;
    const to = clockAt(day, hike.to, tz) + c.hike.marginMin * MIN;
    const nap = { id: `lucy:${key}:hike_nap`, kind: 'after_hike' as const, startedAt: to, endsAt: to + c.hike.napMinutes * MIN };
    visits = visits.filter((v) => v.endsAt <= from || v.startedAt >= nap.endsAt);
    visits.push(nap);
    away = { from, to };
  }
  if (roll(`lucy:night:${key}`) < c.nightChance) {
    const startedAt = clockAt(day, c.bedtime.hour + ((roll(`lucy:night:${key}:bed`) * 2 - 1) * c.bedtime.jitterMin) / 60, tz);
    const endsAt = clockAt(shiftDay(day, 1, tz), c.wake.hour + ((roll(`lucy:night:${key}:wake`) * 2 - 1) * c.wake.jitterMin) / 60, tz);
    visits = visits.filter((v) => v.endsAt <= startedAt);
    visits.push({ id: `lucy:night:${key}`, kind: 'night', startedAt, endsAt });
  }
  visits.sort((a, b) => a.startedAt - b.startedAt);
  return { dayKey: key, visits, away };
}

// ---- Right now ----

export interface LucyInput {
  outsideToday: OutsideObservation[]; // today's observations (her weather latches)
  rainEndedAt: number | null; // outside: when the last rain ended today (she comes in with a shake)
  condition: HealthCondition;
  modifiers: HealthModifier[];
  hike?: { today: boolean; detail?: HikeDetail | null } | null;
  timezone?: string; // the household clock (the tree's settings); none: the runtime's
  now: number;
}

// A trusted stress she stays close for: moderate or worse, with data the tree can stand behind
export function staysClose(condition: HealthCondition, modifiers: HealthModifier[]): boolean {
  if (condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain')) return false;
  const sev = CONDITION_SEVERITY[condition];
  return condition === 'multiple_stress' || sev === 'moderate' || sev === 'critical';
}

// Her pose within a visit, from its phases. Poses only move one way (no sitting back up once down).
export function lucyPhase(kind: LucyVisitKind, startedAt: number, endsAt: number, settle: number, now: number, awake: boolean): { pose: LucyPose; phaseEndsAt: number } {
  const c = C();
  const walkIn = startedAt + c.walkInMin * MIN;
  const walkOut = endsAt - c.walkOutMin * MIN;
  if (now < walkIn) return { pose: 'walking', phaseEndsAt: walkIn };
  if (now >= walkOut) return { pose: 'walking', phaseEndsAt: endsAt };
  // Bedtime, and the nap after the hike: straight down onto the pillow, asleep within minutes
  const sleepy = kind === 'night' || kind === 'after_hike';
  const sitMs = sleepy ? 0 : lerp(c.sitMinutes.restless, c.sitMinutes.calm, settle) * MIN;
  const downMs = (sleepy ? 4 : lerp(c.downBeforeSleep.restless, c.downBeforeSleep.calm, settle)) * MIN;
  const lieDown = Math.min(walkIn + sitMs, walkOut);
  if (now < lieDown) return { pose: 'sitting', phaseEndsAt: lieDown };
  const canSleep = !awake && (sleepy || settle >= c.sleepFrom);
  const fallAsleep = Math.min(lieDown + downMs, walkOut);
  if (!canSleep || now < fallAsleep) return { pose: 'down', phaseEndsAt: canSleep ? fallAsleep : walkOut };
  return { pose: 'sleeping', phaseEndsAt: walkOut };
}

function spotFor(id: string, kind: LucyVisitKind, w: LucyWeather, close: boolean): LucySpot {
  if (kind === 'night' || kind === 'after_hike') return 'pillow';
  if (kind === 'storm' || close) return 'by_pot';
  if (w.heat) return 'floor_left'; // the cool floor, never the pillow
  if (w.cold || w.rain) return 'pillow';
  return roll(`${id}:spot`) < 0.5 ? 'pillow' : 'floor_left';
}

function cueFor(kind: LucyVisitKind, pose: LucyPose, startedAt: number, w: LucyWeather, close: boolean, rainEndedAt: number | null): LucyCue | null {
  const awake = pose !== 'sleeping';
  if (close && awake) return 'concern';
  if ((kind === 'storm' || w.storm) && awake) return 'storm';
  if (kind === 'after_hike') return 'tired';
  if (pose === 'walking' && rainEndedAt !== null && startedAt >= rainEndedAt && startedAt - rainEndedAt <= C().shakeOffAfterRainMin * MIN) return 'shake_off';
  if (w.heat && awake) return 'panting';
  return null;
}

const SPOT_WORDS: Record<LucySpot, string> = { floor_left: 'on the cool floor', pillow: 'on her pillow', by_pot: 'by the pot' };
const visitWords: Record<LucyVisitKind, string> = {
  day: 'one of her visits',
  night: 'asleep for the night on her pillow',
  check: 'checking on the tree',
  storm: 'keeping close through the storm',
  after_hike: 'back from the hike, napping',
};

export function evaluateLucy(input: LucyInput): LucyState {
  const c = C();
  const { now } = input;
  const w = lucyWeather(input.outsideToday, now);
  const weather: LucyWeather = { heat: w.heat, cold: w.cold, storm: w.storm, rain: w.rain, fineDay: w.fineDay };
  const close = staysClose(input.condition, input.modifiers);
  const hike = input.hike?.today && input.hike.detail ? input.hike.detail : null;
  const tz = input.timezone;
  const today = lucyDay(now, hike, tz);
  const lastNight = lucyDay(shiftDay(startOfDay(now, tz), -1, tz), null, tz).visits.filter((v) => v.kind === 'night');
  const planned = [...lastNight, ...today.visits];

  // Staying close: a trusted stress makes her day visits longer
  const stretch = (v: LucyPlannedVisit) => (close && v.kind === 'day' ? { ...v, endsAt: v.startedAt + (v.endsAt - v.startedAt) * c.stress.longer } : v);
  let found: { id: string; kind: LucyVisitKind; startedAt: number; endsAt: number } | null = planned.map(stretch).find((v) => now >= v.startedAt && now < v.endsAt) ?? null;
  const away = today.away && now >= today.away.from && now < today.away.to;
  if (!found && !away && w.storm && w.stormSince !== null) {
    // A storm brings her to the pot for as long as it lasts (open-ended: it ends with the latch)
    found = { id: `lucy:storm:${w.stormSince}`, kind: 'storm', startedAt: w.stormSince, endsAt: now + HOUR };
  }
  if (!found && !away && close) {
    const p = slotPlan('lucy:check', now, c.stress.checkSlotMinutes, c.stress.checkChance, c.stress.checkMinutes);
    if (p && now >= p.startedAt && now < p.endsAt) found = { id: `lucy:check:${p.id}`, kind: 'check', startedAt: p.startedAt, endsAt: p.endsAt };
  }

  // Planned visits begun today (her day for the thoughts and the diary)
  const begun = today.visits.filter((v) => v.kind !== 'night' && v.startedAt <= now);
  const visitsToday = {
    count: begun.length,
    firstAt: begun[0]?.startedAt ?? null,
    minutes: Math.round(begun.reduce((m, v) => m + (Math.min(now, v.endsAt) - v.startedAt) / MIN, 0)),
  };

  if (!found) {
    return {
      presence: away ? 'away_hiking' : 'none',
      visit: null,
      weather,
      visitsToday,
      why: away ? 'out on the hike with her people' : 'elsewhere in the house',
    };
  }
  // How she spends it comes from the weather when she came (stable through the visit)
  const arrival = found.kind === 'storm' ? w : lucyWeather(input.outsideToday, found.startedAt);
  const settle = lucySettle(found.startedAt, arrival, tz);
  // Close to a struggling tree, or through a storm, she stays awake and watches over it
  const awake = close || found.kind === 'storm' || found.kind === 'check';
  const { pose, phaseEndsAt } = lucyPhase(found.kind, found.startedAt, found.endsAt, settle, now, awake);
  const visit: LucyVisit = {
    ...found,
    spot: spotFor(found.id, found.kind, arrival, close),
    pose,
    phaseEndsAt,
    cue: cueFor(found.kind, pose, found.startedAt, weather, close, input.rainEndedAt),
    settle,
  };
  return { presence: pose, visit, weather, visitsToday, why: `${visitWords[found.kind]}: ${pose} ${SPOT_WORDS[visit.spot]}${visit.cue ? ` (${visit.cue.replace('_', ' ')})` : ''}` };
}

// ---- The diary ----

const span = (min: number) => (min >= 90 ? `about ${Math.round((min / 60) * 10) / 10} h` : `about ${Math.round(min)} min`);

// Her days, replayed from the plan (hikes aren't remembered here, so a hike day counts its plan) and the
// stored outside weather (a storm she kept close through).
export function lucyDiary(obs: OutsideObservation[], now: number, days: number, tz?: string): DiaryItem[] {
  const items: DiaryItem[] = [];
  const since = now - days * DAY;
  for (let day = startOfDay(since, tz); day <= now; day = shiftDay(day, 1, tz)) {
    const plan = lucyDay(day, null, tz);
    const visits = plan.visits.filter((v) => v.kind === 'day' && v.startedAt >= since && v.startedAt <= now);
    if (visits.length) {
      const minutes = visits.reduce((m, v) => m + (Math.min(now, v.endsAt) - v.startedAt) / MIN, 0);
      items.push({ at: visits[0].startedAt, kind: 'habitat', habitat: 'lucy', title: 'Lucy kept me company', detail: `${visits.length} visit${visits.length > 1 ? 's' : ''}, ${span(minutes)} in all` });
    }
    const night = plan.visits.find((v) => v.kind === 'night');
    if (night && night.startedAt >= since && night.startedAt <= now) items.push({ at: night.startedAt, kind: 'habitat', habitat: 'lucy', title: 'Lucy slept by the pot', detail: 'on her pillow, through the night' });
    // A storm she kept close through (the first time the latch came on that day)
    const dayObs = obs.filter((o) => o.at >= day && o.at < shiftDay(day, 1, tz) && o.at <= now);
    let stormAt: number | null = null;
    for (const o of dayObs) {
      const s = lucyWeather(dayObs, o.at);
      if (s.storm) {
        stormAt = s.stormSince;
        break;
      }
    }
    if (stormAt !== null && stormAt >= since) items.push({ at: stormAt, kind: 'habitat', habitat: 'lucy', title: 'Lucy stayed close through the storm', detail: 'by the pot, ears down, calm' });
  }
  return items;
}
