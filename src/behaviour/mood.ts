import { APP_CONFIG } from '../config/appConfig';
import type { HealthCondition, HealthModifier, Severity } from '../health/healthTypes';
import { CONDITION_SEVERITY, SEVERITY_RANK, STRESS_CONDITIONS } from '../health/statePriority';
import type { Interaction, PlantEvent } from '../history/historyTypes';
import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { HabitatState, Mood, MoodInfluence, MoodMemory, MoodState } from './behaviourTypes';
import { HOUR, MIN } from '../lib/time';

// Mood: its own slow layer (evidence class "art"). Two dimensions, valence (−1 unpleasant … 1 pleasant)
// and arousal (0 still … 1 lively), drift with inertia toward a target:
// - HEALTH anchors it: the categorical "base mood" (the condition, its tier, recovery, a care reaction) gives
//   the starting point, and the severity sets the band. A stressed tree can be comforted, never look happy.
// - The INSIDE ENVIRONMENT (swings, light, warmth, sunrise and sunset, the season), PETTING and CARE, the
//   VISITORS and the OUTSIDE WEATHER nudge it inside that band, each a little and capped.
// - The label is the nearest mood the health state allows, with hysteresis. Event moods are forced: no
//   trustworthy data (confused), asleep (sleepy), a care reaction (relieved, grateful, concerned…).
// One direction only: mood shapes the face and the tap label; health, vitality, energy, speech timing and
// the visitors never read it.

// Where each mood sits (valence, arousal)
export const MOOD_POINT: Record<Mood, [number, number]> = {
  joyful: [0.8, 0.7],
  content: [0.45, 0.35],
  tired: [0.05, 0.12],
  watchful: [0.15, 0.6],
  relieved: [0.55, 0.45],
  grateful: [0.6, 0.4],
  patient: [0.1, 0.2],
  uncomfortable: [-0.35, 0.45],
  distressed: [-0.75, 0.8],
  uneasy: [-0.15, 0.5],
  concerned: [-0.25, 0.55],
  sleepy: [0.3, 0.05],
  dazzled: [0.2, 0.85],
  overwhelmed: [-0.65, 0.9],
  confused: [-0.05, 0.4],
};
// Which moods a state may show: a calm tree's range, and a stressed tree's (under its ceiling)
const CALM_LABELS: Mood[] = ['joyful', 'content', 'tired', 'watchful', 'relieved', 'grateful'];
const STRESS_LABELS: Mood[] = ['patient', 'uneasy', 'uncomfortable', 'tired', 'distressed', 'overwhelmed'];
const RAINY = ['drizzle', 'rain', 'heavy_rain'];

export interface MoodInput {
  base: Mood; // the health anchor (categorical)
  forced: boolean; // an event mood: shown as is (confused, sleepy, a care reaction)
  condition: HealthCondition;
  modifiers: HealthModifier[];
  concern: boolean;
  perception: PerceptionState;
  species: SpeciesProfile;
  interactions: Interaction[];
  events: PlantEvent[];
  habitat: HabitatState | null;
  twilight: { event: 'sunrise' | 'sunset' | null; minutes: number | null };
  seasonEnergy: number;
  memory: MoodMemory | null;
  now: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r2 = (x: number) => Math.round(x * 100) / 100;
const drift = (from: number, to: number, dtMin: number, tauMin: number) => to + (from - to) * Math.exp(-dtMin / tauMin);
const dist = (m: Mood, v: number, a: number) => Math.hypot(MOOD_POINT[m][0] - v, MOOD_POINT[m][1] - a);

// The worst stress severity among the condition and its modifiers (recovering, sleeping… are not stresses)
function stressSeverity(condition: HealthCondition, modifiers: HealthModifier[]): Severity {
  let worst: Severity = 'none';
  for (const c of [condition, ...modifiers] as HealthCondition[]) {
    if (!STRESS_CONDITIONS.includes(c)) continue;
    const s = CONDITION_SEVERITY[c];
    if (SEVERITY_RANK[s] > SEVERITY_RANK[worst]) worst = s;
  }
  return worst;
}

// A group of nudges, capped as a whole
function capped(source: MoodInfluence['source'], parts: [number, number, string][], cap: { v: number; a: number }): MoodInfluence | null {
  if (!parts.length) return null;
  const v = clamp(parts.reduce((s, p) => s + p[0], 0), -cap.v, cap.v);
  const a = clamp(parts.reduce((s, p) => s + p[1], 0), -cap.a, cap.a);
  return v === 0 && a === 0 ? null : { source, v: r2(v), a: r2(a), why: parts.map((p) => p[2]).join(', ') };
}

function environment(i: MoodInput): MoodInfluence | null {
  const E = APP_CONFIG.mood.environment;
  const p = i.perception;
  const parts: [number, number, string][] = [];
  const recent = p.recent.filter((s) => s.t >= i.now - 2 * HOUR);
  const range = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x !== null);
    return ok.length > 1 ? Math.max(...ok) - Math.min(...ok) : 0;
  };
  if (range(recent.map((s) => s.temp)) > E.swingTemp || range(recent.map((s) => s.hum)) > E.swingHum) parts.push([...(E.unsettled as [number, number]), 'swinging air: unsettled']);
  const light = p.readings.lightPercent;
  if (p.sun.lightExpected && light !== null) {
    if (light >= i.species.light.usefulMinPercent) parts.push([...(E.light as [number, number]), 'good light: livelier']);
    else parts.push([...(E.dim as [number, number]), 'a dim day: quieter']);
  }
  const t = p.readings.temperature;
  if (t !== null && t >= i.species.temperature.minOptimal && t <= i.species.temperature.maxOptimal) parts.push([...(E.warmth as [number, number]), 'pleasant warmth']);
  if (i.twilight.event === 'sunrise' && i.twilight.minutes !== null && i.twilight.minutes >= 0) parts.push([...(E.sunrise as [number, number]), 'the sun is up']);
  if (i.twilight.event === 'sunset' && i.twilight.minutes !== null && i.twilight.minutes <= 0) parts.push([...(E.sunset as [number, number]), 'toward sunset']);
  if (i.seasonEnergy !== 1) parts.push([0, (i.seasonEnergy - 1) * E.season, i.seasonEnergy > 1 ? 'the growing season' : 'the season at rest']);
  return capped('environment', parts, E.cap);
}

function petting(i: MoodInput, severity: Severity): MoodInfluence | null {
  const P = APP_CONFIG.mood.petting;
  const share = severity === 'critical' ? 0 : severity === 'moderate' ? P.moderateShare : 1;
  if (!share) return null;
  let w = 0;
  for (const s of i.interactions) {
    if (s.kind !== 'pet' || s.endedAt > i.now || i.now - s.endedAt > P.windowMin * MIN) continue;
    w += Math.exp(-(i.now - s.endedAt) / (P.tauMin * MIN)) * Math.min(1, s.count / P.strokesFull);
  }
  const warmth = 1 - Math.exp(-w); // more petting saturates (it settles, like touch)
  if (warmth < 0.02) return null;
  return { source: 'petting', v: r2(P.v * warmth * share), a: r2(P.a * warmth * share), why: severity === 'none' ? 'petted lately: warmer' : 'petted lately: a little comforted' };
}

function care(i: MoodInput): MoodInfluence | null {
  const C = APP_CONFIG.mood.care;
  const last = i.events
    .filter((e) => e.type !== 'manual_note' && e.timestamp <= i.now && i.now - e.timestamp < C.hours * HOUR)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!last) return null;
  const v = C.v * Math.exp(-(i.now - last.timestamp) / (C.tauHours * HOUR));
  return v < 0.005 ? null : { source: 'care', v: r2(v), a: 0, why: `cared for ${Math.round((i.now - last.timestamp) / MIN)} min ago` };
}

function visitors(i: MoodInput): MoodInfluence | null {
  const V = APP_CONFIG.mood.visitors;
  const h = i.habitat;
  if (!h) return null;
  const parts: [number, number, string][] = [];
  if (h.visit && (h.presence === 'visiting' || h.presence === 'peeking')) parts.push([...(V.squirrel as [number, number]), 'the squirrel is here']);
  if (h.dragonfly?.visit && h.dragonfly.presence !== 'none') parts.push([...(V.dragonfly as [number, number]), 'a dragonfly is here']);
  if (h.sloth?.visit && h.sloth.presence !== 'none') parts.push([...(V.sloth as [number, number]), 'the sloth is here']);
  return capped('visitors', parts, { v: V.cap, a: V.cap });
}

function weather(i: MoodInput, calm: boolean): MoodInfluence | null {
  const W = APP_CONFIG.mood.weather;
  const o = i.perception.outside;
  if (!o || !calm) return null;
  const parts: [number, number, string][] = [];
  if (RAINY.includes(o.sky)) parts.push([...(W.rain as [number, number]), 'rain on the glass: cosy']);
  else if (o.sky === 'thunderstorm') parts.push([...(W.thunderstorm as [number, number]), 'a storm outside: unsettled']);
  else if (o.sky === 'snow') parts.push([...(W.snow as [number, number]), 'snow outside: hushed']);
  else if (o.sky === 'fog') parts.push([...(W.fog as [number, number]), 'fog outside: quieter']);
  else if (o.sky === 'clear' && i.perception.sun.isDay) parts.push([...(W.clear as [number, number]), 'a clear day outside']);
  if (o.windy) parts.push([...(W.windy as [number, number]), 'wind outside']);
  return capped('weather', parts, { v: 0.08, a: 0.1 });
}

export function evaluateMood(i: MoodInput): MoodState {
  const M = APP_CONFIG.mood;
  const severity = stressSeverity(i.condition, i.modifiers);
  const ceiling = Math.min(M.ceiling[severity], i.concern ? M.concernCeiling : 1);
  const calm = severity === 'none' && !i.concern;
  const floor = calm ? M.calmFloor : -1;
  const sleeping = i.condition === 'sleeping' || i.modifiers.includes('sleeping');
  const aMax = sleeping ? M.sleepingArousalMax : 1;

  // The anchor, then the nudges (each capped), clamped into the band health allows
  const [bv, ba] = MOOD_POINT[i.base];
  const influences: MoodInfluence[] = [{ source: 'health', v: bv, a: ba, why: `${i.base} (${severity === 'none' ? 'calm' : `${severity} stress`})` }];
  for (const x of [environment(i), petting(i, severity), care(i), visitors(i), weather(i, calm)]) if (x) influences.push(x);
  const target = {
    valence: r2(clamp(influences.reduce((s, x) => s + x.v, 0), floor, ceiling)),
    arousal: r2(clamp(influences.reduce((s, x) => s + x.a, 0), 0, aMax)),
  };

  // Inertia: drift from where the mood was (no memory: start at the target)
  let valence = target.valence;
  let arousal = target.arousal;
  const mem = i.memory;
  if (mem && mem.at <= i.now) {
    const dt = Math.min(i.now - mem.at, M.maxStepMin * MIN) / MIN;
    const T = M.tauMin;
    const event = i.forced && mem.label !== i.base;
    valence = drift(mem.valence, target.valence, dt, event ? T.event : target.valence < mem.valence ? T.valenceDown : T.valenceUp);
    arousal = drift(mem.arousal, target.arousal, dt, event ? T.event : T.arousal);
  }
  valence = r2(valence);
  arousal = r2(arousal);

  // The label: forced for events; otherwise the nearest the health state allows, with hysteresis
  let label = i.base;
  if (!i.forced) {
    const pool = (calm ? CALM_LABELS : STRESS_LABELS).filter((m) => MOOD_POINT[m][0] <= ceiling + 0.1);
    if (!pool.includes(i.base)) pool.push(i.base);
    label = pool.reduce((best, m) => (dist(m, valence, arousal) < dist(best, valence, arousal) ? m : best), pool[0]);
    const prev = mem?.label;
    if (prev && prev !== label && pool.includes(prev) && dist(prev, valence, arousal) <= dist(label, valence, arousal) + M.labelHysteresis) label = prev;
  }
  return { label, valence, arousal, target, base: i.base, ceiling: r2(ceiling), forced: i.forced, influences, memory: { valence, arousal, label, at: i.now } };
}
