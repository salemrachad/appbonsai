// A Schmitt trigger with durations, for the slow facts of the outside world (Lucy's weather, the barometer,
// the air): a switch waits for its duration, and a pending switch is only cancelled when the value goes back
// past the OTHER threshold, so readings hovering at a threshold neither flap nor block it. Replayed from
// stored observations (nothing kept between calls), so a restart gives the same answer.

export interface Latch {
  on: boolean;
  since: number | null; // when it switched on
  pending: number | null; // a switch waiting for its duration
}
export const off = (): Latch => ({ on: false, since: null, pending: null });

export function step(l: Latch, t: number, enterNow: boolean, exitNow: boolean, enterMs: number, exitMs: number) {
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
