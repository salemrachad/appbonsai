import type { HealthCondition } from '../health/healthTypes';
import { CONDITION_SEVERITY, STRESS_CONDITIONS } from '../health/statePriority';
import type { BehaviourEpisode, PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import type { CanopyState } from './behaviourTypes';
import { DAY, HOUR } from '../lib/time';

// The canopy: how full the tree's foliage looks, from its LAST WEEKS (evidence class "inference").
// A ficus answers a long stress by dropping leaves, often drops some after being moved, and refills over
// weeks at the pace of the season. The app can't count the real leaves: this is an interpretation of the
// stored history, drawn by the avatar only. Health, vitality, mood and the habitat never read it.
// Derived from episodes and care events (nothing stored), deterministic.
//
//   a stress past its grace period (primary)    thins it, per observed hour (critical fastest)
//   a move to a new spot                         a small dip spread over the days after it
//   calm, recovering, asleep                     refills toward full (time constant × growth phase)
//   unsure data, gaps, unobserved time           held
//   never below the floor: the app can't know the real tree is bare

const REGROWS: HealthCondition[] = ['comfortable', 'thriving', 'recovering', 'sleeping', 'very_bright'];

export interface CanopyInput {
  episodes: BehaviourEpisode[]; // any order
  events: PlantEvent[];
  growth: SpeciesProfile['seasons'][keyof SpeciesProfile['seasons']]['growth']; // current growth phase
  species: SpeciesProfile;
  now: number;
}

export function evaluateCanopy({ episodes, events, growth, species, now }: CanopyInput): CanopyState {
  const c = species.canopy;
  const from = now - c.windowDays * DAY;
  const tau = c.regrowDays * DAY / c.growthFactor[growth];
  const moves = events.filter((e) => e.type === 'moved_location' && e.timestamp > from - c.moveDipDays * DAY && e.timestamp <= now).map((e) => e.timestamp);
  let full = 1;
  let thinnedBy: HealthCondition | null = null;
  const history: { t: number; full: number }[] = [];
  const sorted = [...episodes].filter((e) => (e.endedAt ?? now) > from && e.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt);
  for (const e of sorted) {
    const start = Math.max(e.startedAt, from);
    const end = Math.min(e.endedAt ?? now, now);
    const span = end - start;
    if (span <= 0 || e.condition === 'sensor_uncertain') continue;
    const fullSpan = Math.max(1, Math.min(e.endedAt ?? now, now) - e.startedAt);
    const observedShare = Math.max(0, 1 - e.unobservedMs / fullSpan);
    const stress = STRESS_CONDITIONS.includes(e.condition) || e.condition === 'multiple_stress';
    const sev = CONDITION_SEVERITY[e.condition];
    const grace = stress ? c.graceHours[sev === 'critical' ? 'critical' : sev === 'moderate' ? 'moderate' : 'mild'] * HOUR : 0;
    const rate = stress ? c.thinPerHour[sev === 'critical' ? 'critical' : sev === 'moderate' ? 'moderate' : 'mild'] : 0;
    // Hour steps; time into the episode (observed) decides when a stress starts to cost leaves
    const steps = Math.max(1, Math.ceil(span / HOUR));
    for (let i = 0; i < steps; i++) {
      const t0 = start + (span * i) / steps;
      const t1 = start + (span * (i + 1)) / steps;
      const dt = (t1 - t0) * observedShare;
      if (stress) {
        const into = (t1 - e.startedAt) * observedShare;
        if (into > grace) {
          full -= rate * (dt / HOUR);
          thinnedBy = e.condition;
        }
      } else if (REGROWS.includes(e.condition)) {
        full = 1 + (full - 1) * Math.exp(-dt / tau);
      }
      // A move: a small dip spread over the days after it
      for (const m of moves) {
        const overlap = Math.max(0, Math.min(t1, m + c.moveDipDays * DAY) - Math.max(t0, m));
        if (overlap > 0) full -= c.moveDip * (overlap / (c.moveDipDays * DAY));
      }
      full = Math.max(c.floor, Math.min(1, full));
      history.push({ t: t1, full });
    }
  }

  const at = (t: number) => {
    let v = 1;
    for (const h of history) {
      if (h.t > t) break;
      v = h.full;
    }
    return v;
  };
  const before = at(now - c.trendDays * DAY);
  const lowest = history.filter((h) => h.t >= now - c.refillLookbackDays * DAY).reduce((m, h) => Math.min(m, h.full), full);
  const trend: CanopyState['trend'] = full - before > 0.01 ? 'refilling' : before - full > 0.01 ? 'thinning' : 'steady';
  // Fresh tips show while it is coming back: the recent rise, as long as there is still a gap
  const refilling = full < 0.985 ? round2(Math.min(1, Math.max(0, (full - lowest) * c.refillVisibility))) : 0;
  const reasons: string[] = [];
  if (full < 0.985) {
    reasons.push(`${Math.round(full * 100)}% full${thinnedBy ? ` (thinned by ${thinnedBy.replace(/_/g, ' ')})` : ''}${moves.length ? ', settling after a move' : ''}`);
    reasons.push(trend === 'refilling' ? `refilling (${growth} season: time constant ${Math.round(tau / DAY)} days)` : trend === 'thinning' ? 'still thinning' : 'holding');
  } else reasons.push('full canopy');
  return { fullness: round2(full), refilling, trend, reasons };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
