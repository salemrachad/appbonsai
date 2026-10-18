import { APP_CONFIG } from '../config/appConfig';
import type { BehaviourEpisode, DiaryItem } from '../history/historyTypes';
import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { OutsideObservation, OutsideSky } from '../telemetry/outsideWeather';
import type { DragonflyPerch, DragonflyState, DragonflyStop } from './behaviourTypes';
import { stableVariant } from './speech';
import { airDiary, AirInput, AirWandererSpec, baseGate, evaluateAir, replayAir } from './wanderer';
import { hhmm, hourOf } from '../lib/time';

// The dragonfly: an air wanderer (see wanderer.ts). Where the squirrel reads the tree's HISTORY over days,
// the dragonfly reads the AIR over the last hours: warm inside, daylight with useful light, and calm, dry
// weather outside. Fast to come, fast to go, often. The tree's health only gates it (critical stress,
// night, no trustworthy data); a mildly thirsty tree can still get a dragonfly.

const WET: OutsideSky[] = ['drizzle', 'rain', 'heavy_rain', 'thunderstorm', 'snow'];
const PERCHES: DragonflyPerch[] = ['left_tip', 'right_tip', 'crown_tip', 'left_top'];

const C = () => APP_CONFIG.habitat.dragonfly;
// The day's territory: the tip it holds as its own today (the same all day, a new choice tomorrow)
export const territoryOf = (dayKey: string): DragonflyPerch => PERCHES[stableVariant(`dragonfly:territory:${dayKey}`, PERCHES.length)];

export const DRAGONFLY: AirWandererSpec<DragonflyPerch, 'perched' | 'hovering'> = {
  key: 'dragonfly',
  suitable: (s, w, species) => {
    const c = C();
    if (s.temp === null) return null;
    if (!s.lightExpected) return false; // night, dawn, dusk
    const lightOk = s.light !== null ? s.light >= species.light.usefulMinPercent * c.lightFactor : s.radiation !== null ? s.radiation >= c.radiationMin : null;
    if (lightOk === null) return null;
    const weatherOk = !w || (!WET.includes(w.sky) && (w.gusts ?? 0) < c.gustsMax); // unknown weather doesn't block
    return lightOk && weatherOk && s.temp >= c.tempMin && s.temp <= c.tempMax;
  },
  get latch() {
    const c = C();
    return { riseMinutes: c.riseMinutes, fallMinutes: c.fallMinutes, enter: c.enter, exit: c.exit };
  },
  get slots() {
    const c = C();
    return {
      slotMinutes: c.slotMinutes,
      visitChance: c.visitChance,
      visitMinutes: c.visitMinutes,
      // Busiest around midday, when the air is warmest
      scale: (t: number) => {
        const h = hourOf(t);
        return h >= c.midday.from && h < c.midday.to ? c.midday.scale : c.midday.otherScale;
      },
    };
  },
  spots: PERCHES,
  // Territory: within a day it holds one tip as its own; most visits start there. No memory across days.
  spot: (w) => (w.roll('territory') < C().territory.homeChance ? territoryOf(w.dayKey) : PERCHES[Math.floor(w.roll('perch') * PERCHES.length)]),
  style: (roll) => (roll('style') < C().perchedShare ? 'perched' : 'hovering'),
  gate: (condition, modifiers, isDay) => {
    const base = baseGate(condition, modifiers);
    if (base) return base;
    if (!isDay || condition === 'sleeping' || modifiers.includes('sleeping')) return 'night: dragonflies rest';
    return null;
  },
};

export const replayDragonfly = (samples: PerceptionSample[], obs: OutsideObservation[], species: SpeciesProfile, cadenceMs: number, now: number, trace = false) =>
  replayAir(DRAGONFLY, samples, obs, species, cadenceMs, now, trace);

export function evaluateDragonfly(input: AirInput & { insideTemp: number | null }): DragonflyState {
  const a = evaluateAir(DRAGONFLY, input, 'waiting for warm, bright, calm air');
  return {
    value: a.value,
    active: a.active,
    presence: a.visit ? a.visit.style : 'none',
    visit: a.visit
      ? { id: a.visit.id, startedAt: a.visit.startedAt, endsAt: a.visit.endsAt, perch: a.visit.spot, style: a.visit.style, route: dragonflyRoute(a.visit, { home: a.visit.spot, liveliness: livelinessOf(input.insideTemp) }) }
      : null,
    visitsToday: { count: a.visitsToday.count, firstAt: a.visitsToday.firstAt },
    insideTemp: input.insideTemp,
    why: a.visit ? `warm, bright and calm: ${a.why}` : a.why,
  };
}

// ---- Flying around: its route through a visit ----
// The rules (art, deterministic per visit, so every refresh and every screen sees the same flight):
// - it sits on a tip a while (25–70 s; shorter in warmer air, when it is livelier), then flies;
// - from its home perch: now and then a short hovering sortie, then it lands again (often on the same tip);
//   otherwise it moves to another tip, the high crown tip (where the light is) a little more often;
// - from anywhere else it mostly flies back home (perch fidelity, as real dragonflies do);
// - a hovering visit drifts from tip to tip in the air and only sometimes lands for a short stay;
// - it never goes to the tips in `avoid` (by the squirrel), and when it rests on the sloth, the sloth is
//   its home.
export interface RouteOptions {
  home: DragonflyPerch;
  avoid?: DragonflyPerch[];
  liveliness: number; // 0 (cool) … 1 (hot)
}
export const livelinessOf = (insideTemp: number | null) => Math.max(0, Math.min(1, ((insideTemp ?? 24) - 20) / 14));

export function dragonflyRoute(v: { id: string; startedAt: number; endsAt: number; style: 'perched' | 'hovering' }, o: RouteOptions): DragonflyStop[] {
  const R = C().route;
  const roll = (k: string) => stableVariant(`${v.id}:route:${k}`, 997) / 997;
  const span = (r: { min: number; max: number }, k: string) => (r.min + (r.max - r.min) * roll(k)) * (1.2 - 0.5 * o.liveliness) * 1000;
  const tips = PERCHES.filter((p) => !(o.avoid ?? []).includes(p));
  const home = o.home;
  // Another tip than `cur`, weighted (the crown tip a little more often)
  const elsewhere = (cur: DragonflyPerch, k: string): DragonflyPerch => {
    const opts = tips.filter((p) => p !== cur);
    if (!opts.length) return cur;
    const w = opts.map((p) => (p === 'crown_tip' ? R.crownBias : 1));
    let x = roll(k) * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) if ((x -= w[i]) < 0) return opts[i];
    return opts[opts.length - 1];
  };
  const stops: DragonflyStop[] = [{ at: v.startedAt, perch: home, mode: v.style }];
  for (let i = 1, t = v.startedAt; i < 500; i++) {
    const cur = stops[stops.length - 1];
    const short = v.style === 'hovering' && cur.mode === 'perched' ? 0.5 : 1; // landings on a hovering visit are brief
    t += (cur.mode === 'perched' ? span(R.perchSec, `${i}:stay`) * short : span(R.hoverSec, `${i}:stay`)) + R.flightMs;
    if (t >= v.endsAt) break;
    let next: Omit<DragonflyStop, 'at'>;
    if (v.style === 'hovering') next = { perch: elsewhere(cur.perch, `${i}:to`), mode: roll(`${i}:land`) < R.landChance ? 'perched' : 'hovering' };
    else if (cur.mode === 'hovering') next = { perch: roll(`${i}:back`) < R.fidelity ? cur.perch : elsewhere(cur.perch, `${i}:to`), mode: 'perched' }; // lands after a sortie
    else if (cur.perch !== home && roll(`${i}:home`) < R.fidelity) next = { perch: home, mode: 'perched' };
    else if (roll(`${i}:sortie`) < R.sortieChance) next = { perch: cur.perch, mode: 'hovering' };
    else next = { perch: elsewhere(cur.perch, `${i}:to`), mode: 'perched' };
    stops.push({ at: t, ...next });
  }
  return stops;
}

// Where it is at time t (the stop it last arrived at)
export function stopAt<S extends { at: number }>(route: S[], t: number): S | null {
  let cur: S | null = null;
  for (const s of route) if (s.at <= t) cur = s;
  return cur ?? route[0] ?? null;
}

export function dragonflyDiary(samples: PerceptionSample[], obs: OutsideObservation[], episodes: BehaviourEpisode[], species: SpeciesProfile, cadenceMs: number, now: number, days: number, windowsOut?: { from: number; to: number }[]): DiaryItem[] {
  return airDiary(DRAGONFLY, samples, obs, episodes, species, cadenceMs, now, days, (v) => ({ title: 'A dragonfly visited', detail: `${v.count} visit${v.count > 1 ? 's' : ''} · first at ${hhmm(v.firstAt)}` }), 'dragonfly', windowsOut);
}
