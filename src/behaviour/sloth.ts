import { APP_CONFIG } from '../config/appConfig';
import type { BehaviourEpisode, DiaryItem } from '../history/historyTypes';
import type { PerceptionSample } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { OutsideObservation } from '../telemetry/outsideWeather';
import type { SlothBranch, SlothGrip, SlothMemory, SlothState } from './behaviourTypes';
import { stableVariant } from './speech';
import { AirDay, airDays, AirInput, AirWandererSpec, baseGate, evaluateAir, replayAir } from './wanderer';
import { DAY, dayKey, startOfDay } from '../lib/time';

// The sloth: the third wanderer, an air wanderer like the dragonfly (see wanderer.ts) with its own
// character. It loves warm, humid, still air (a greenhouse is perfect): warmth and humidity inside, no
// storm or strong gusts outside. Rain doesn't bother it. Slow in everything: ~90 min to settle in, ~60 min
// to leave, long visits (20–50 min) most hours. It stays the night, curled up asleep on its branch. The
// tree's state only gates it: no trustworthy data, a critical or multiple stress, or a cold tree keep it
// away. Petting gets a slow look and a slow blink (UI only); it never flees and never plays.
//
// LOYALTY (its memory, derived from the last days of readings): days it spent long in the tree make the
// tree its tree. A loyal sloth has a home branch (it hangs there and sleeps there), stays longer and is
// slow to give up when the air turns. Unlike the squirrel it has no stages: it doesn't scout, it turns up.

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

const L = () => C().loyalty;
export const NO_SLOTH_MEMORY: SlothMemory = { loyalty: 0, homeBranch: null, daysWithIt: 0 };

// Its loyalty as of the start of the day of `at`, from its days before (oldest first). A full day with it
// moves loyalty `riseRate` of the way to 1; every day decays it (`fallDays`), so days without it fade it.
export function slothMemory(days: Pick<AirDay<SlothBranch>, 'day' | 'minutes' | 'spots'>[], at: number): SlothMemory {
  const l = L();
  const today = startOfDay(at);
  let loyalty = 0;
  let last: number | null = null;
  let count = 0;
  const branch: Record<SlothBranch, number> = { left_branch: 0, right_branch: 0 };
  for (const d of days) {
    if (d.day >= today || d.day < today - l.days * DAY) continue;
    const decay = last === null ? 1 : Math.exp(-Math.round((d.day - last) / DAY) / l.fallDays);
    loyalty = loyalty * decay + (1 - loyalty * decay) * l.riseRate * Math.min(1, d.minutes / l.fullDayMinutes);
    for (const b of BRANCHES) branch[b] = branch[b] * decay + (d.spots[b] ?? 0);
    last = d.day;
    count++;
  }
  if (last !== null) loyalty *= Math.exp(-Math.max(0, Math.round((today - last) / DAY) - 1) / l.fallDays); // days since, beyond yesterday
  const home: SlothBranch | null = count === 0 ? null : branch.left_branch >= branch.right_branch ? 'left_branch' : 'right_branch';
  return { loyalty: Math.round(loyalty * 100) / 100, homeBranch: home, daysWithIt: count };
}

// The spec for a sloth with this loyalty: slower to give up, longer visits, mostly on its home branch.
// No loyalty → exactly SLOTH.
export function withLoyalty(m: SlothMemory | null | undefined): AirWandererSpec<SlothBranch, 'hanging' | 'climbing' | 'sleeping'> {
  if (!m || (m.loyalty <= 0 && !m.homeBranch)) return SLOTH;
  const l = L();
  const x = m.loyalty;
  const home = m.homeBranch;
  return {
    ...SLOTH,
    get latch() {
      const c = SLOTH.latch;
      return { ...c, exit: Math.max(0.05, c.exit - l.exitDrop * x), fallMinutes: c.fallMinutes * (1 + x) };
    },
    get slots() {
      const c = SLOTH.slots;
      const k = 1 + l.visitLonger * x;
      return { ...c, visitMinutes: { min: Math.round(c.visitMinutes.min * k), max: Math.round(c.visitMinutes.max * k) } };
    },
    spot: home ? (w) => (w.roll('home') < l.homeBase + l.homePerLoyalty * x ? home : home === 'left_branch' ? 'right_branch' : 'left_branch') : undefined,
  };
}

// Its days over the readings given (each day with the loyalty of the days before it) and its memory now
export function slothLife(samples: PerceptionSample[], obs: OutsideObservation[], episodes: BehaviourEpisode[], species: SpeciesProfile, cadenceMs: number, now: number, days: number) {
  const list = airDays(SLOTH, samples, obs, episodes, species, cadenceMs, now, days, (day, before) => withLoyalty(slothMemory(before, day)));
  return { days: list, memory: slothMemory(list, now) };
}

export const replaySloth = (samples: PerceptionSample[], obs: OutsideObservation[], species: SpeciesProfile, cadenceMs: number, now: number, trace = false) =>
  replayAir(SLOTH, samples, obs, species, cadenceMs, now, trace);

export function evaluateSloth(input: AirInput & { insideTemp: number | null; memory?: SlothMemory }): SlothState {
  const memory = input.memory ?? NO_SLOTH_MEMORY;
  const spec = withLoyalty(memory);
  const a = evaluateAir(spec, input, 'waiting for warm, humid, still air');
  // Night: once settled it doesn't come and go, it sleeps the night through on one branch
  const night = !input.isDay || input.condition === 'sleeping' || input.modifiers.includes('sleeping');
  if (night && a.active && !SLOTH.gate(input.condition, input.modifiers, input.isDay)) {
    const key = dayKey(input.now - 12 * 3600 * 1000); // the evening's day
    // A loyal sloth sleeps on its home branch
    const branch = memory.homeBranch && memory.loyalty >= L().homeNightFrom ? memory.homeBranch : BRANCHES[stableVariant(`sloth:night:${key}`, BRANCHES.length)];
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
    memory,
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

// Its days in the diary (each with the loyalty of the days before it, as in the live view). Give it readings
// from `loyalty.days` before the diary range so its loyalty matches the live one. A loyal sloth back after
// days away is back on its branch.
export function slothDiary(samples: PerceptionSample[], obs: OutsideObservation[], episodes: BehaviourEpisode[], species: SpeciesProfile, cadenceMs: number, now: number, days: number, windowsOut?: { from: number; to: number }[]): DiaryItem[] {
  const since = now - days * DAY;
  const covered = samples.length ? Math.ceil((now - samples[0].t) / DAY) : days;
  const { days: list } = slothLife(samples, obs, episodes, species, cadenceMs, now, Math.max(days, covered));
  const items: DiaryItem[] = [];
  let prev: number | null = null;
  for (const v of list) {
    if (v.day + DAY > since) windowsOut?.push(...v.windows);
    const m = slothMemory(list, v.day);
    const top: SlothBranch = (v.spots.left_branch ?? 0) >= (v.spots.right_branch ?? 0) ? 'left_branch' : 'right_branch';
    if (v.firstAt! >= since) {
      if (prev !== null && v.day - prev >= 2 * DAY && m.loyalty >= 0.5 && m.homeBranch === top)
        items.push({ at: v.firstAt!, kind: 'habitat', habitat: 'sloth_home', title: 'The sloth is back on its branch', detail: `after ${Math.round((v.day - prev) / DAY) - 1} days away` });
      items.push({ at: v.firstAt!, kind: 'habitat', habitat: 'sloth', title: 'A sloth spent time in the tree', detail: `${span(v.minutes)} across ${v.count} visit${v.count > 1 ? 's' : ''}` });
    }
    prev = v.day;
  }
  return items;
}
