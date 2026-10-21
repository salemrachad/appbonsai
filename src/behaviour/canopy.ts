import type { HealthCondition } from '../health/healthTypes';
import { CONDITION_SEVERITY, STRESS_CONDITIONS } from '../health/statePriority';
import type { BehaviourEpisode, PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import type { CanopyState } from './behaviourTypes';
import { DAY, HOUR } from '../lib/time';

// The canopy: how full the tree's foliage looks, from its LAST WEEKS.
// A ficus answers a long stress by dropping leaves, often drops some after being moved, and refills over
// weeks at the pace of the season. Without photos this is an interpretation of the stored history (evidence
// class "inference"); with a readable daily photo it starts from what the photo measured (observation) and the
// same rules only carry it forward until the next photo. Drawn by the avatar only; health, vitality, mood and
// the habitat never read it (the photos' leaf drop reaches health on its own, health/leaves.ts).
// Derived from episodes, care events and photos (nothing stored), deterministic.
//
//   the latest readable photo                    the starting point (and the photos before it, the trend)
//   a stress past its grace period (primary)    thins it, per observed hour (critical fastest)
//   a move to a new spot                         a small dip spread over the days after it
//   calm, recovering, asleep                     refills toward full (time constant × growth phase)
//   unsure data, gaps, unobserved time           held
//   never below the floor (or what the last photo showed, if lower): the rules alone can't know it is barer

const REGROWS: HealthCondition[] = ['comfortable', 'thriving', 'recovering', 'sleeping', 'very_bright'];

export interface CanopyInput {
  episodes: BehaviourEpisode[]; // any order
  events: PlantEvent[];
  growth: SpeciesProfile['seasons'][keyof SpeciesProfile['seasons']]['growth']; // current growth phase
  species: SpeciesProfile;
  now: number;
  photos?: { at: number; fullness: number; yellow?: number }[]; // readable daily photos, oldest first (perception.leaves.measured)
}

export function evaluateCanopy({ episodes, events, growth, species, now, photos = [] }: CanopyInput): CanopyState {
  const c = species.canopy;
  const window = now - c.windowDays * DAY;
  const seen = photos.filter((p) => p.at <= now && p.at >= window);
  const anchor = seen.at(-1) ?? null;
  // With a photo: the rules run only from it (what came before is what the photos showed)
  const from = anchor ? anchor.at : window;
  const floor = anchor ? Math.min(c.floor, anchor.fullness) : c.floor;
  const tau = c.regrowDays * DAY / c.growthFactor[growth];
  const moves = events.filter((e) => e.type === 'moved_location' && e.timestamp > from - c.moveDipDays * DAY && e.timestamp <= now).map((e) => e.timestamp);
  let full = anchor ? Math.min(1, anchor.fullness) : 1;
  let thinnedBy: HealthCondition | null = null;
  const history: { t: number; full: number }[] = seen.map((p) => ({ t: p.at, full: Math.min(1, p.fullness) }));
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
      full = Math.max(floor, Math.min(1, full));
      history.push({ t: t1, full });
    }
  }

  const at = (t: number) => {
    let v = history[0] && anchor ? history[0].full : 1; // before the first photo: as it showed
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
  if (anchor) reasons.push(`measured ${Math.round(anchor.fullness * 100)}% in the photo of ${Math.round((now - anchor.at) / DAY * 10) / 10} days ago`);
  if (full < 0.985) {
    reasons.push(`${Math.round(full * 100)}% full${thinnedBy ? ` (thinned by ${thinnedBy.replace(/_/g, ' ')})` : ''}${moves.length ? ', settling after a move' : ''}`);
    reasons.push(trend === 'refilling' ? `refilling (${growth} season: time constant ${Math.round(tau / DAY)} days)` : trend === 'thinning' ? 'still thinning' : 'holding');
  } else reasons.push('full canopy');
  // The photo's yellow leaves show for a while after it was taken
  const yellow = anchor?.yellow && now - anchor.at <= species.photo.yellowShownDays * DAY ? round2(anchor.yellow) : undefined;
  return { fullness: round2(full), refilling, trend, reasons, ...(anchor && { measured: { at: anchor.at, fullness: anchor.fullness } }), ...(yellow && { yellow }) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
