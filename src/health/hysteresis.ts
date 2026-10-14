import type { LatchRule } from '../species';

// Hysteresis for health conditions.
//
// A condition is a latch with separate entry and exit thresholds, each of which must hold for a
// while. The path into stress is therefore different from the path out of it, and a value hovering
// around a threshold (29.9 → 30.1 → 29.9 …) does not flip the state every reading.

export interface LatchState {
  active: boolean;
  since: number | null; // when it became active
  pendingSince: number | null; // when the value first crossed the threshold it is waiting on
  lastEndedAt: number | null; // when it last switched off (for recovery)
  observedMs?: number; // time active while actually observed (unobserved gaps don't count)
}

export const INITIAL_LATCH: LatchState = { active: false, since: null, pendingSince: null, lastEndedAt: null, observedMs: 0 };

export interface LatchStep {
  value: number | null; // null = no data: hold the current state, restart any pending timer
  now: number;
  continuous: boolean; // false after a data gap: pending timers restart (be conservative)
  gate?: boolean; // false = the latch doesn't apply right now (e.g. light at night): reset to inactive
}

const crossedEnter = (r: LatchRule, v: number) => (r.direction === 'below' ? v < r.enter : v > r.enter);
const crossedExit = (r: LatchRule, v: number) => (r.direction === 'below' ? v >= r.exit : v <= r.exit);

export function stepLatch(prev: LatchState, rule: LatchRule, { value, now, continuous, gate = true }: LatchStep): LatchState {
  if (!gate) {
    return prev.active ? { active: false, since: null, pendingSince: null, lastEndedAt: now, observedMs: 0 } : { ...prev, pendingSince: null };
  }
  if (value === null) return { ...prev, pendingSince: null };

  // Schmitt trigger with timers: a pending switch starts when the value crosses the threshold it
  // waits on, and is only cancelled when the value goes back past the *other* threshold.
  // Noise inside the band between the two neither starts nor cancels anything.
  const crossed = prev.active ? crossedExit(rule, value) : crossedEnter(rule, value);
  const backPastOther = prev.active ? crossedEnter(rule, value) : crossedExit(rule, value);
  if (backPastOther || !continuous) return { ...prev, pendingSince: crossed ? now : null };
  if (!crossed && prev.pendingSince === null) return prev;

  const pendingSince = prev.pendingSince ?? now;
  const neededMs = (prev.active ? rule.exitAfterMin : rule.enterAfterMin) * 60 * 1000;
  if (now - pendingSince < neededMs) return { ...prev, pendingSince };

  // Held long enough: switch. Entering counts from when the threshold was first crossed.
  return prev.active
    ? { active: false, since: null, pendingSince: null, lastEndedAt: now, observedMs: 0 }
    : { active: true, since: pendingSince, pendingSince: null, lastEndedAt: prev.lastEndedAt, observedMs: now - pendingSince };
}

export function describeRule(r: LatchRule, unit = ''): string {
  const op = r.direction === 'below' ? ['<', '≥'] : ['>', '≤'];
  const dur = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m} min`);
  return `enter ${op[0]} ${r.enter}${unit} for ${dur(r.enterAfterMin)} · exit ${op[1]} ${r.exit}${unit} for ${dur(r.exitAfterMin)}`;
}
