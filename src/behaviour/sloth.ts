import { APP_CONFIG } from '../config/appConfig';
import type { BehaviourEpisode, DiaryItem } from '../history/historyTypes';
import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { OutsideObservation } from '../telemetry/outsideWeather';
import type { SlothBranch, SlothGrip, SlothState } from './behaviourTypes';
import { stableVariant } from './speech';
import { airDiary, AirInput, AirWandererSpec, baseGate, evaluateAir, replayAir } from './wanderer';

// The sloth: the third wanderer, an air wanderer like the dragonfly (see wanderer.ts) with its own
// character. It loves warm, humid, still air (a greenhouse is perfect): warmth and humidity inside, no
// storm or strong gusts outside. Rain doesn't bother it. Slow in everything: ~90 min to settle in, ~60 min
// to leave, long visits (20–50 min) most hours. It stays the night, curled up asleep on its branch. The
// tree's state only gates it: no trustworthy data, a critical or multiple stress, or a cold tree keep it
// away. Petting gets a slow look and a slow blink (UI only); it never flees and never plays.

const BRANCHES: SlothBranch[] = ['left_branch', 'right_branch'];
const C = () => APP_CONFIG.habitat.sloth;

export const SLOTH: AirWandererSpec<SlothBranch, 'hanging' | 'climbing' | 'sleeping'> = {
  key: 'sloth',
  suitable: (s, w) => {
    const c = C();
    if (s.temp === null || s.hum === null) return null;
    const stillAir = !w || (w.sky !== 'thunderstorm' && (w.gusts ?? 0) < c.gustsMax); // rain is fine
    return stillAir && s.temp >= c.tempMin && s.temp <= c.tempMax && s.hum >= c.humidityMin;
  },
  get latch() {
    const c = C();
    return { riseMinutes: c.riseMinutes, fallMinutes: c.fallMinutes, enter: c.enter, exit: c.exit };
  },
  get slots() {
    const c = C();
    return { slotMinutes: c.slotMinutes, visitChance: c.visitChance, visitMinutes: c.visitMinutes, scale: () => 1 };
  },
  spots: BRANCHES,
  // At night it sleeps where it hangs; by day it mostly hangs, sometimes inches along the branch
  style: (roll, isDay) => (!isDay ? 'sleeping' : roll('style') < C().hangingShare ? 'hanging' : 'climbing'),
  gate: (condition, modifiers) => {
    const base = baseGate(condition, modifiers);
    if (base) return base;
    if (condition === 'cold' || modifiers.includes('cold')) return 'too cold for a sloth';
    return null;
  },
};

export const replaySloth = (samples: PerceptionSample[], obs: OutsideObservation[], species: SpeciesProfile, cadenceMs: number, now: number, trace = false) =>
  replayAir(SLOTH, samples, obs, species, cadenceMs, now, trace);

export function evaluateSloth(input: AirInput & { insideTemp: number | null }): SlothState {
  const a = evaluateAir(SLOTH, input, 'waiting for warm, humid, still air');
  // Night: once settled it doesn't come and go, it sleeps the night through on one branch
  const night = !input.isDay || input.condition === 'sleeping' || input.modifiers.includes('sleeping');
  if (night && a.active && !SLOTH.gate(input.condition, input.modifiers, input.isDay)) {
    const evening = new Date(input.now - 12 * 3600 * 1000);
    const key = `${evening.getFullYear()}-${evening.getMonth() + 1}-${evening.getDate()}`;
    const branch = BRANCHES[stableVariant(`sloth:night:${key}`, BRANCHES.length)];
    a.visit = { id: `sloth:night:${key}`, startedAt: input.now, endsAt: input.now + 3600 * 1000, spot: branch, style: 'sleeping' };
    a.why = `asleep for the night on the ${branch.replace('_', ' ')}`;
  }
  const grip = a.visit ? slothGrip(a.visit.id, a.visit.style, a.visit.startedAt, a.value, input.now) : 'four';
  return {
    value: a.value,
    active: a.active,
    presence: a.visit ? a.visit.style : 'none',
    visit: a.visit ? { id: a.visit.id, startedAt: a.visit.startedAt, endsAt: a.visit.endsAt, branch: a.visit.spot, pose: a.visit.style, grip } : null,
    visitsToday: a.visitsToday,
    insideTemp: input.insideTemp,
    why: a.visit ? `warm, humid and still: ${a.why}${a.visit.style === 'hanging' ? ` (${GRIP_WORDS[grip]})` : ''}` : a.why,
  };
}

// How it holds on. Comfort is its value (how long and how fully the air has been warm, humid and still).
// The first stretch of a visit it holds on with all four (just arrived); then every stretch rolls a grip
// from its comfort band, stable within the stretch (a refresh never changes it). Climbing uses all four
// limbs, and asleep it is always curled in all four.
const GRIP_BANDS: SlothGrip[][] = [
  ['four', 'arms'], // marginal air: secure
  ['arms', 'two_legs_one_arm'], // comfortable
  ['one_arm', 'legs'], // long, perfect air: lounging
];
export const GRIP_WORDS: Record<SlothGrip, string> = {
  four: 'holding on with all four',
  arms: 'hanging by both arms',
  legs: 'hanging upside down by its legs',
  one_arm: 'hanging by one arm',
  two_legs_one_arm: 'hanging by two legs and one arm',
};
export function slothGrip(visitId: string, pose: 'hanging' | 'climbing' | 'sleeping', startedAt: number, comfort: number, now: number): SlothGrip {
  if (pose !== 'hanging') return 'four';
  const g = C().grip;
  const segment = Math.max(0, Math.floor((now - startedAt) / (g.segmentMinutes * 60 * 1000)));
  if (segment === 0) return 'four';
  const band = GRIP_BANDS[comfort >= g.loungingFrom ? 2 : comfort >= g.relaxedFrom ? 1 : 0];
  return band[Math.floor((stableVariant(`${visitId}:grip:${segment}`, 997) / 997) * band.length)]; // a prime: the hash's low bits alone repeat
}

const span = (min: number) => (min >= 90 ? `about ${Math.round(min / 60 * 10) / 10} h` : `about ${Math.round(min)} min`);

export function slothDiary(samples: PerceptionSample[], obs: OutsideObservation[], episodes: BehaviourEpisode[], species: SpeciesProfile, cadenceMs: number, now: number, days: number, windowsOut?: { from: number; to: number }[]): DiaryItem[] {
  return airDiary(SLOTH, samples, obs, episodes, species, cadenceMs, now, days, (v) => ({ title: 'A sloth spent time in the tree', detail: `${span(v.minutes)} across ${v.count} visit${v.count > 1 ? 's' : ''}` }), 'sloth', windowsOut);
}
