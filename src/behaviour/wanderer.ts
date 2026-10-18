import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import { CONDITION_SEVERITY } from '../health/statePriority';
import type { BehaviourEpisode, DiaryItem } from '../history/historyTypes';
import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { OutsideObservation } from '../telemetry/outsideWeather';
import { driftToward, schmitt, slotWindow } from './habitat';
import { stableVariant } from './speech';
import { addDays, DAY, HOUR, MIN, startOfDay } from '../lib/time';

// "Air wanderers": habitat visitors driven by the AIR of the last hours (the dragonfly, the sloth), as
// opposed to the squirrel, which reads the tree's history over days. One mechanism for all of them, built
// on the shared habitat helpers (observed-time drift, Schmitt latch, deterministic slots in habitat.ts).
// A species only brings its spec: what good air is for it, how fast it trusts and leaves, how often and
// how long it visits, and which tree states keep it away. Evidence class "art"; derived from perceived
// samples; nothing stored; never read by health, mood or energy.


export interface AirWandererSpec<Spot extends string, Style extends string> {
  key: string; // seeds its own slots (never shared with another species)
  // Good air for it at this sample? null = not enough data to say (held)
  suitable: (s: PerceptionSample, weather: OutsideObservation | null, species: SpeciesProfile) => boolean | null;
  latch: { riseMinutes: number; fallMinutes: number; enter: number; exit: number };
  slots: { slotMinutes: number; visitChance: { min: number; max: number }; visitMinutes: { min: number; max: number }; scale: (t: number) => number };
  spots: readonly Spot[];
  // Where a visit starts, when the species has a preference (a home branch, the day's territory); without
  // it, a stable roll over `spots`
  spot?: (w: { roll: (salt: string) => number; dayKey: string }) => Spot;
  style: (roll: (salt: string) => number, isDay: boolean) => Style;
  // Which tree states keep it away (null = welcome). The only way the tree's state reaches it.
  gate: (condition: HealthCondition, modifiers: HealthModifier[], isDay: boolean) => string | null;
}

export interface AirVisit<Spot extends string, Style extends string> {
  id: string;
  startedAt: number;
  endsAt: number;
  spot: Spot;
  style: Style;
}

// The outside weather around time t (nearest observation, at most 45 min before / 15 min after)
export function weatherAt(obs: OutsideObservation[], t: number): OutsideObservation | null {
  let best: OutsideObservation | null = null;
  for (const o of obs) {
    const d = t - o.at;
    if (d > 45 * MIN || d < -15 * MIN) continue;
    if (!best || Math.abs(d) < Math.abs(t - best.at)) best = o;
  }
  return best;
}

// The standard gate: no trustworthy data, a critical or multiple stress → nobody
export function baseGate(condition: HealthCondition, modifiers: HealthModifier[]): string | null {
  if (condition === 'sensor_uncertain' || modifiers.includes('sensor_uncertain')) return 'no trustworthy data: nobody shown';
  if (CONDITION_SEVERITY[condition] === 'critical' || condition === 'multiple_stress') return `${condition.replace(/_/g, ' ')}: it stays away`;
  return null;
}

// Replays the samples (oldest first, last 24 h) into its value and latch, observed time only
export function replayAir<S extends string, T extends string>(spec: AirWandererSpec<S, T>, samples: PerceptionSample[], obs: OutsideObservation[], species: SpeciesProfile, cadenceMs: number, now: number, trace = false) {
  const L = spec.latch;
  let value = 0;
  let active = false;
  const points: { t: number; value: number; active: boolean }[] = [];
  const pts = samples.filter((s) => s.t <= now && s.t >= now - DAY);
  for (let i = 0; i < pts.length; i++) {
    const s = pts[i];
    const end = Math.min(pts[i + 1]?.t ?? now, s.t + cadenceMs, now); // a reading stands for at most one cadence
    const dtH = Math.max(0, end - s.t) / HOUR;
    const ok = spec.suitable(s, weatherAt(obs, s.t), species);
    if (ok !== null && dtH > 0) {
      value = driftToward(value, ok ? 1 : 0, dtH, (ok ? L.riseMinutes : L.fallMinutes) / 60);
      active = schmitt(active, value, L.enter, L.exit);
    }
    if (trace) points.push({ t: s.t, value, active });
  }
  return { value: Math.round(value * 100) / 100, active, points };
}

export function airVisitAt<S extends string, T extends string>(spec: AirWandererSpec<S, T>, value: number, now: number, isDay: boolean): AirVisit<S, T> | null {
  const { slotMinutes, visitChance, visitMinutes, scale } = spec.slots;
  const f = Math.max(0, Math.min(1, (value - spec.latch.exit) / (1 - spec.latch.exit)));
  const chance = (visitChance.min + (visitChance.max - visitChance.min) * f) * scale(now);
  const w = slotWindow(spec.key, now, slotMinutes, chance, visitMinutes);
  if (!w) return null;
  return {
    id: `${spec.key}:${w.id}`,
    startedAt: w.startedAt,
    endsAt: w.endsAt,
    spot: spec.spot ? spec.spot(w) : spec.spots[stableVariant(`${spec.key}:${w.dayKey}:${w.slot}:perch`, spec.spots.length)],
    style: spec.style(w.roll, isDay),
  };
}

// Visits in [from, to) while the latch was on (the same slots as the live view)
export function airVisitsBetween<S extends string, T extends string>(spec: AirWandererSpec<S, T>, points: { t: number; value: number; active: boolean }[], from: number, to: number) {
  const slotMs = spec.slots.slotMinutes * MIN;
  let count = 0;
  let firstAt: number | null = null;
  let minutes = 0;
  const windows: { from: number; to: number }[] = [];
  const spots: Partial<Record<S, number>> = {}; // minutes per spot (where it spent its time)
  let pi = 0;
  for (let t = Math.ceil(from / slotMs) * slotMs; t + slotMs <= to; t += slotMs) {
    while (pi + 1 < points.length && points[pi + 1].t <= t) pi++;
    const p = points[pi];
    if (!p || p.t > t || !p.active) continue;
    let v: AirVisit<S, T> | null = null;
    for (let m = 0; m < spec.slots.slotMinutes && !v; m += 1) v = airVisitAt(spec, p.value, t + m * MIN, true);
    if (v) {
      count++;
      firstAt = firstAt ?? v.startedAt;
      minutes += (v.endsAt - v.startedAt) / MIN;
      spots[v.spot] = (spots[v.spot] ?? 0) + (v.endsAt - v.startedAt) / MIN;
      windows.push({ from: v.startedAt, to: v.endsAt });
    }
  }
  return { count, firstAt, minutes: Math.round(minutes), windows, spots };
}

export interface AirState<S extends string, T extends string> {
  value: number;
  active: boolean;
  visit: AirVisit<S, T> | null;
  visitsToday: { count: number; firstAt: number | null; minutes: number };
  why: string;
}

export interface AirInput {
  samples: PerceptionSample[];
  outsideToday: OutsideObservation[];
  species: SpeciesProfile;
  cadenceMs: number;
  condition: HealthCondition;
  modifiers: HealthModifier[];
  isDay: boolean;
  now: number;
}

export function evaluateAir<S extends string, T extends string>(spec: AirWandererSpec<S, T>, input: AirInput, notYet: string): AirState<S, T> {
  const { samples, outsideToday, species, cadenceMs, condition, modifiers, isDay, now } = input;
  const r = replayAir(spec, samples, outsideToday, species, cadenceMs, now, true);
  const { windows: _w, spots: _s, ...visitsToday } = airVisitsBetween(spec, r.points, startOfDay(now), now);
  const blocked = spec.gate(condition, modifiers, isDay);
  let why: string;
  let visit: AirVisit<S, T> | null = null;
  if (blocked) why = blocked;
  else if (!r.active) why = r.value > 0 ? `${notYet} (${r.value} < ${spec.latch.enter})` : notYet;
  else {
    visit = airVisitAt(spec, r.value, now, isDay);
    why = visit ? `${visit.style} at the ${String(visit.spot).replace(/_/g, ' ')}` : 'good air for it (none right now)';
  }
  return { value: r.value, active: r.active, visit, visitsToday, why };
}

// Its visits per day, from stored readings through the same replay and slots (the health gate from the
// episodes). Shared by its diary lines and the encounter diary (the windows). `specAt` gives the spec for a
// day from the days before it (a species with a memory, like the sloth's loyalty).
export type AirDay<S extends string> = ReturnType<typeof airVisitsBetween<S, string>> & { day: number };
export function airDays<S extends string, T extends string>(
  spec0: AirWandererSpec<S, T>,
  samples: PerceptionSample[],
  obs: OutsideObservation[],
  episodes: BehaviourEpisode[],
  species: SpeciesProfile,
  cadenceMs: number,
  now: number,
  days: number,
  specAt?: (day: number, before: AirDay<S>[]) => AirWandererSpec<S, T>
) {
  const since = now - days * DAY;
  const out: AirDay<S>[] = [];
  for (let day = startOfDay(since); day < now; day = addDays(day, 1)) {
    const end = Math.min(addDays(day, 1), now);
    const spec = specAt ? specAt(day, out) : spec0;
    // The latch is replayed per day from the readings of that day and the evening before
    const daySamples = samples.filter((s) => s.t >= day - 6 * HOUR && s.t < end);
    if (daySamples.length < 2) continue;
    const r = replayAir(spec, daySamples, obs, species, cadenceMs, end, true);
    const gated = r.points.map((p) => {
      const e = episodes.find((x) => x.startedAt <= p.t && p.t < (x.endedAt ?? now));
      return e && spec.gate(e.condition, [], e.condition !== 'sleeping') !== null ? { ...p, active: false } : p;
    });
    const v = airVisitsBetween(spec, gated, day, end);
    if (v.count > 0) out.push({ ...v, day });
  }
  return out;
}

export function airDiary<S extends string, T extends string>(
  spec: AirWandererSpec<S, T>,
  samples: PerceptionSample[],
  obs: OutsideObservation[],
  episodes: BehaviourEpisode[],
  species: SpeciesProfile,
  cadenceMs: number,
  now: number,
  days: number,
  line: (v: { count: number; firstAt: number; minutes: number }) => Pick<DiaryItem, 'title' | 'detail'>,
  tag: NonNullable<DiaryItem['habitat']>,
  windowsOut?: { from: number; to: number }[]
): DiaryItem[] {
  const since = now - days * DAY;
  const items: DiaryItem[] = [];
  for (const v of airDays(spec, samples, obs, episodes, species, cadenceMs, now, days)) {
    windowsOut?.push(...v.windows);
    if (v.firstAt! >= since) items.push({ at: v.firstAt!, kind: 'habitat', habitat: tag, ...line({ count: v.count, firstAt: v.firstAt!, minutes: v.minutes }) });
  }
  return items;
}
