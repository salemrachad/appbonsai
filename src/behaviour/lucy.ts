import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { DiaryItem } from '../history/historyTypes';
import type { OutsideObservation, OutsideSky } from '../telemetry/outsideWeather';
import type { LucyCue, LucyPose, LucySpot, LucyState, LucyStop, LucyVisit, LucyVisitKind, LucyWeather } from './behaviourTypes';
import type { HikeDetail } from './hike';
import { slotPlan } from './habitat';
import { stableVariant } from './speech';
import { addDays, civil, clockAt, DAY, dayKey, HOUR, MIN, startOfDay } from '../lib/time';

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
// - A VISIT is a route, like a real dog's (lucyRoute): up and about first (sniffing along the floor, sitting
//   in different places, looking at you, up at the tree, or around), then she settles at her resting place
//   (down, her look moving between you and the tree) and may doze off. How soon she settles comes from her
//   settle value at arrival (the time of day and the weather). Some nights she sleeps on the floor instead of
//   her pillow, and wakes now and then to lie looking at you.
//
// Derived and deterministic (nothing stored): a refresh or a restart shows the same Lucy. Health, energy,
// speech and the other visitors' engines never read her; her company calms the mood a little.

const C = () => APP_CONFIG.habitat.lucy;
// A stable 0-1 roll (a prime modulus: the hash's low bits alone repeat)
const roll = (key: string) => stableVariant(key, 997) / 997;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

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
export function lucySettle(t: number, w: LucyWeather): number {
  const s = C().settle;
  const now = civil(t);
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
export function lucyDay(t: number, hike?: Pick<HikeDetail, 'from' | 'to'> | null): LucyDay {
  const c = C();
  const day = startOfDay(t);
  const key = dayKey(day);
  const n = c.visitsPerDay.min + stableVariant(`lucy:${key}:count`, c.visitsPerDay.max - c.visitsPerDay.min + 1);
  const anchors = c.anchors
    .map((h, i) => ({ h, i, r: roll(`lucy:${key}:pick:${i}`) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, n)
    .sort((a, b) => a.h - b.h);
  let visits: LucyPlannedVisit[] = anchors.map(({ h, i }) => {
    const startedAt = clockAt(day, h + ((roll(`lucy:${key}:jitter:${i}`) * 2 - 1) * c.jitterMin) / 60);
    const minutes = c.visitMinutes.min + Math.round(roll(`lucy:${key}:len:${i}`) * (c.visitMinutes.max - c.visitMinutes.min));
    return { id: `lucy:${key}:${i}`, kind: 'day', startedAt, endsAt: startedAt + minutes * MIN };
  });
  let away: LucyDay['away'] = null;
  if (hike) {
    const from = clockAt(day, hike.from) - c.hike.marginMin * MIN;
    const to = clockAt(day, hike.to) + c.hike.marginMin * MIN;
    const nap = { id: `lucy:${key}:hike_nap`, kind: 'after_hike' as const, startedAt: to, endsAt: to + c.hike.napMinutes * MIN };
    visits = visits.filter((v) => v.endsAt <= from || v.startedAt >= nap.endsAt);
    visits.push(nap);
    away = { from, to };
  }
  if (roll(`lucy:night:${key}`) < c.nightChance) {
    const startedAt = clockAt(day, c.bedtime.hour + ((roll(`lucy:night:${key}:bed`) * 2 - 1) * c.bedtime.jitterMin) / 60);
    const endsAt = clockAt(addDays(day, 1), c.wake.hour + ((roll(`lucy:night:${key}:wake`) * 2 - 1) * c.wake.jitterMin) / 60);
    visits = visits.filter((v) => v.endsAt <= startedAt);
    visits.push({ id: `lucy:night:${key}`, kind: 'night', startedAt, endsAt });
  }
  visits.sort((a, b) => a.startedAt - b.startedAt);
  return { dayKey: key, visits, away };
}

// Her interest in a visitor lives with familiarity (behaviour/familiarity.ts): the habitat reads it too
export { lucyInterest, LUCY_INTEREST, type LucyInterestLevel } from './familiarity';

// Her day visits (not the night by the pot, not the hike: the squirrel learns her ordinary days) as plain
// windows, for the squirrel's memory of her (habitat.ts)
export const lucyDayVisits = (t: number) => lucyDay(t).visits.filter((v) => v.kind === 'day').map((v) => ({ id: v.id, from: v.startedAt, to: v.endsAt }));

// ---- Right now ----

export interface LucyInput {
  outsideToday: OutsideObservation[]; // today's observations (her weather latches)
  rainEndedAt: number | null; // outside: when the last rain ended today (she comes in with a shake)
  condition: HealthCondition;
  modifiers: HealthModifier[];
  hike?: { today: boolean; detail?: HikeDetail | null } | null;
  now: number;
}

// A trusted stress she stays close for: moderate or worse, with data the tree can stand behind
export function staysClose(condition: HealthCondition, modifiers: HealthModifier[]): boolean {
  if (condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain')) return false;
  const sev = CONDITION_SEVERITY[condition];
  return condition === 'multiple_stress' || sev === 'moderate' || sev === 'critical';
}

// The phases of a visit: walking in, up and about, settled (down), asleep, walking out. The phases only move
// one way; within "up and about" her route moves her around.
export function lucyPhases(kind: LucyVisitKind, startedAt: number, endsAt: number, settle: number, awake: boolean) {
  const c = C();
  const walkIn = startedAt + c.walkInMin * MIN;
  const walkOut = Math.max(walkIn, endsAt - c.walkOutMin * MIN);
  // Bedtime, and the nap after the hike: straight to her resting place, asleep within minutes
  const sleepy = kind === 'night' || kind === 'after_hike';
  const sitMs = sleepy ? 0 : lerp(c.sitMinutes.restless, c.sitMinutes.calm, settle) * MIN;
  const downMs = (sleepy ? 4 : lerp(c.downBeforeSleep.restless, c.downBeforeSleep.calm, settle)) * MIN;
  const lieDown = Math.min(walkIn + sitMs, walkOut);
  const canSleep = !awake && (sleepy || settle >= c.sleepFrom);
  const fallAsleep = canSleep ? Math.min(lieDown + downMs, walkOut) : null;
  return { walkIn, lieDown, fallAsleep, walkOut };
}

// Her phase at `now` (walking in → up and about (sitting) → down → asleep → walking out)
export function lucyPhase(kind: LucyVisitKind, startedAt: number, endsAt: number, settle: number, now: number, awake: boolean): { pose: LucyPose; phaseEndsAt: number } {
  const p = lucyPhases(kind, startedAt, endsAt, settle, awake);
  if (now < p.walkIn) return { pose: 'walking', phaseEndsAt: p.walkIn };
  if (now >= p.walkOut) return { pose: 'walking', phaseEndsAt: endsAt };
  if (now < p.lieDown) return { pose: 'sitting', phaseEndsAt: p.lieDown };
  if (p.fallAsleep === null || now < p.fallAsleep) return { pose: 'down', phaseEndsAt: p.fallAsleep ?? p.walkOut };
  return { pose: 'sleeping', phaseEndsAt: p.walkOut };
}

// Where she settles to lie down (and sleep). Nights: her pillow, or some nights the floor (cold: always the
// pillow; heat: the cool floor). Close to a struggling tree, or in a storm: right by the pot.
export function lucyRest(id: string, kind: LucyVisitKind, w: LucyWeather, close: boolean): LucySpot {
  if (kind === 'storm' || (close && kind !== 'night')) return 'by_pot';
  if (kind === 'after_hike') return 'pillow';
  if (w.cold) return 'pillow';
  if (w.heat) return 'floor_left'; // the cool floor
  if (kind === 'night') return roll(`${id}:rest`) < C().nightFloorChance ? 'floor_left' : 'pillow';
  if (w.rain) return 'pillow';
  return roll(`${id}:spot`) < 0.5 ? 'pillow' : 'floor_left';
}

// The floor from left to right
export const LUCY_SPOTS: LucySpot[] = ['pillow', 'floor_left', 'by_pot', 'pot_front', 'pot_right', 'floor_right'];
const CLOSE_SPOTS: LucySpot[] = ['by_pot', 'pot_front'];
const span2 = (r: number, [a, b]: readonly number[]) => (a + r * (b - a)) * 1000;

// Her route through a visit (deterministic per visit). Up and about: she sniffs along to a neighbouring
// spot, sits here or somewhere else looking at you, up at the tree or around, or stands about. Settled: down
// at her resting place, her look moving between you and the tree. Asleep on her pillow she sleeps; asleep on
// the floor she wakes now and then and lies looking at you. Close to a struggling tree (or in a storm) she
// keeps by the pot and mostly watches the tree.
export function lucyRoute(
  v: { id: string; kind: LucyVisitKind; startedAt: number; endsAt: number },
  o: { settle: number; rest: LucySpot; awake: boolean; close: boolean; avoid?: LucySpot[] }
): LucyStop[] {
  const c = C();
  const R = c.route;
  const watchful = o.close || v.kind === 'storm';
  const allowed = (watchful ? CLOSE_SPOTS : LUCY_SPOTS).filter((x) => !(o.avoid ?? []).includes(x));
  const p = lucyPhases(v.kind, v.startedAt, v.endsAt, o.settle, o.awake);
  const stops: LucyStop[] = [];
  let k = 0;
  const r = (salt: string) => roll(`${v.id}:route:${k}:${salt}`);
  const look = (): LucyStop['look'] => {
    const x = r('look');
    if (watchful) return x < 0.7 ? 'tree' : 'user';
    return x < R.lookUser ? 'user' : x < R.lookUser + R.lookTree ? 'tree' : 'around';
  };
  // She comes in from the left: her first stop is one of the left-hand spots she may use
  let i = Math.floor(r('entry') * Math.min(3, allowed.length));
  let t = v.startedAt;
  stops.push({ at: t, spot: allowed[i], act: 'sniff', look: 'around' });
  t += span2(r('len'), R.seconds.sniff);
  // Up and about
  while (t < p.lieDown) {
    k++;
    const x = r('act');
    if (x < R.sniff) {
      i = Math.max(0, Math.min(allowed.length - 1, i + (r('dir') < 0.5 ? -1 : 1)));
      stops.push({ at: t, spot: allowed[i], act: 'sniff', look: 'around' });
      t += span2(r('len'), R.seconds.sniff);
    } else if (x < R.sniff + R.sit) {
      if (r('move') < 0.5) i = Math.floor(r('where') * allowed.length);
      stops.push({ at: t, spot: allowed[i], act: 'sit', look: look() });
      t += span2(r('len'), R.seconds.sit);
    } else {
      stops.push({ at: t, spot: allowed[i], act: 'stand', look: r('look') < 0.5 ? 'around' : 'tree' });
      t += span2(r('len'), R.seconds.stand);
    }
  }
  // Settled: down at her resting place, her look moving between you and the tree
  const rest = allowed.includes(o.rest) ? o.rest : allowed[0];
  const downUntil = p.fallAsleep ?? p.walkOut;
  for (t = p.lieDown; t < downUntil; t += span2(r('len'), R.seconds.downLook)) {
    k++;
    stops.push({ at: t, spot: rest, act: 'down', look: k === 1 || v.kind === 'night' ? 'user' : look() === 'tree' ? 'tree' : 'user' });
  }
  // Asleep: on her pillow soundly; on the floor she wakes now and then and lies looking at you
  if (p.fallAsleep !== null) {
    const seg = c.floorWatch.segmentMinutes * MIN;
    for (t = p.fallAsleep; t < p.walkOut; t += seg) {
      k++;
      const watch = rest !== 'pillow' && t > p.fallAsleep && r('watch') < c.floorWatch.share;
      stops.push({ at: t, spot: rest, act: watch ? 'down' : 'sleep', look: 'user' });
      if (rest === 'pillow') break;
    }
  }
  // Getting up to go
  if (p.walkOut < v.endsAt) stops.push({ at: p.walkOut, spot: rest, act: 'stand', look: 'around' });
  // Merge repeats (the same spot, act and look in a row)
  return stops
    .filter((x) => x.at < v.endsAt)
    .filter((x, j, a) => j === 0 || x.spot !== a[j - 1].spot || x.act !== a[j - 1].act || x.look !== a[j - 1].look);
}

const POSE_OF: Record<LucyStop['act'], LucyPose> = { sniff: 'walking', stand: 'walking', sit: 'sitting', down: 'down', sleep: 'sleeping' };
// Where her route has her at `now` (the last stop begun)
export function lucyStopAt(route: LucyStop[], now: number): LucyStop {
  let cur = route[0];
  for (const x of route) if (x.at <= now) cur = x;
  return cur;
}

function cueFor(kind: LucyVisitKind, pose: LucyPose, startedAt: number, w: LucyWeather, close: boolean, rainEndedAt: number | null, arriving: boolean): LucyCue | null {
  const awake = pose !== 'sleeping';
  if (close && awake) return 'concern';
  if ((kind === 'storm' || w.storm) && awake) return 'storm';
  if (kind === 'after_hike') return 'tired';
  if (arriving && rainEndedAt !== null && startedAt >= rainEndedAt && startedAt - rainEndedAt <= C().shakeOffAfterRainMin * MIN) return 'shake_off';
  if (w.heat && awake) return 'panting';
  return null;
}

const SPOT_WORDS: Record<LucySpot, string> = { pillow: 'on her pillow', floor_left: 'on the cool floor', by_pot: 'by the pot', pot_front: 'in front of the pot', pot_right: 'by the pot, on its right', floor_right: 'right of the stand' };
const visitWords: Record<LucyVisitKind, string> = {
  day: 'one of her visits',
  night: 'her night by the pot',
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
  const today = lucyDay(now, hike);
  const lastNight = lucyDay(addDays(startOfDay(now), -1), null).visits.filter((v) => v.kind === 'night');
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
  const settle = lucySettle(found.startedAt, arrival);
  // Close to a struggling tree, or through a storm, she stays awake and watches over it
  const awake = close || found.kind === 'storm' || found.kind === 'check';
  const rest = lucyRest(found.id, found.kind, arrival, close);
  // Hike day: the boots stand right of the stand, so she keeps to the rest of the floor
  const route = lucyRoute(found, { settle, rest, awake, close, avoid: input.hike?.today ? ['floor_right'] : [] });
  const stop = lucyStopAt(route, now);
  const pose = POSE_OF[stop.act];
  const visit: LucyVisit = {
    ...found,
    spot: stop.spot,
    rest,
    pose,
    route,
    phaseEndsAt: route.find((x) => x.at > now)?.at ?? found.endsAt,
    cue: cueFor(found.kind, pose, found.startedAt, weather, close, input.rainEndedAt, now < found.startedAt + c.walkInMin * MIN), // arriving: a shake after rain
    settle,
  };
  return { presence: pose, visit, weather, visitsToday, why: `${visitWords[found.kind]}: ${pose} ${SPOT_WORDS[visit.spot]}${visit.cue ? ` (${visit.cue.replace('_', ' ')})` : ''}` };
}

// ---- The diary ----

const span = (min: number) => (min >= 90 ? `about ${Math.round((min / 60) * 10) / 10} h` : `about ${Math.round(min)} min`);

// Her days, replayed from the plan (hikes aren't remembered here, so a hike day counts its plan) and the
// stored outside weather (a storm she kept close through).
export function lucyDiary(obs: OutsideObservation[], now: number, days: number): DiaryItem[] {
  const items: DiaryItem[] = [];
  const since = now - days * DAY;
  for (let day = startOfDay(since); day <= now; day = addDays(day, 1)) {
    const plan = lucyDay(day, null);
    const visits = plan.visits.filter((v) => v.kind === 'day' && v.startedAt >= since && v.startedAt <= now);
    if (visits.length) {
      const minutes = visits.reduce((m, v) => m + (Math.min(now, v.endsAt) - v.startedAt) / MIN, 0);
      items.push({ at: visits[0].startedAt, kind: 'habitat', habitat: 'lucy', title: 'Lucy kept me company', detail: `${visits.length} visit${visits.length > 1 ? 's' : ''}, ${span(minutes)} in all` });
    }
    const night = plan.visits.find((v) => v.kind === 'night');
    if (night && night.startedAt >= since && night.startedAt <= now) {
      const floor = lucyRest(night.id, 'night', lucyWeather(obs, night.startedAt), false) !== 'pillow';
      items.push({ at: night.startedAt, kind: 'habitat', habitat: 'lucy', title: 'Lucy slept by the pot', detail: floor ? 'on the floor this time, now and then looking up at you' : 'on her pillow, through the night' });
    }
    // A storm she kept close through (the first time the latch came on that day)
    const dayObs = obs.filter((o) => o.at >= day && o.at < addDays(day, 1) && o.at <= now);
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
