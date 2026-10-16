import type { PerceptionState } from '../perception/perceptionTypes';
import type { SpeciesProfile } from '../species';
import type { CouplingMemory, HealthEnvironment } from './healthTypes';

// Health's interpretation of the derived environmental metrics that Perception calculated.
//
// - Moisture–VPD coupling: compared with THIS pot's own baseline (an exponential average over ~7 days,
//   kept in HealthMemory, learned only from live, confident segments). DIAGNOSTIC ONLY: the result is
//   shown in the developer panel and the soil card's notes; it never reaches vitality, conditions, mood
//   or the avatar until it has been validated against the real tree. Slow drying is not necessarily stress.
// - Temperature exposure: decayed degree-hours outside the optimal range lower the EXISTING temperature
//   score (same component, same weight), fading as the exposure decays. Provisional thresholds.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export const INITIAL_COUPLING: CouplingMemory = { baseline: null, hours: 0, firstAt: null, updatedAt: null };

// Learn the baseline from a live, confident segment. At most one hour of weight per evaluation step, so
// a restart or a gap never lands as a big jump.
export function updateCouplingBaseline(mem: CouplingMemory, p: PerceptionState, live: boolean, species: SpeciesProfile): CouplingMemory {
  const d = p.drying;
  const suspect = p.quality.suspect.soil || p.quality.suspect.air;
  if (!live || !d || suspect) return mem;
  const now = p.at;
  if (mem.baseline === null || mem.updatedAt === null) return { baseline: d.perHourPerKpa, hours: 0, firstAt: now, updatedAt: now };
  const dtMs = Math.min(HOUR, Math.max(0, now - mem.updatedAt));
  if (dtMs === 0) return mem;
  const a = 1 - Math.exp(-dtMs / (species.environment.coupling.baselineTauDays * DAY));
  return {
    baseline: Math.round((mem.baseline + (d.perHourPerKpa - mem.baseline) * a) * 10000) / 10000,
    hours: Math.round((mem.hours + dtMs / HOUR) * 100) / 100,
    firstAt: mem.firstAt ?? now,
    updatedAt: now,
  };
}

export function interpretEnvironment(p: PerceptionState, mem: CouplingMemory, species: SpeciesProfile): HealthEnvironment {
  const c = species.environment.coupling;
  const d = p.drying;
  const established = mem.baseline !== null && mem.firstAt !== null && p.at - mem.firstAt >= c.establishAfterDays * DAY && mem.hours >= c.establishAfterHours;
  let status: HealthEnvironment['coupling']['status'];
  let ratio: number | null = null;
  if (!d) status = 'unavailable';
  else if (!established) status = 'learning';
  else {
    ratio = Math.round((d.perHourPerKpa / mem.baseline!) * 100) / 100;
    status = ratio < c.slowerRatio ? 'slower' : ratio > c.fasterRatio ? 'faster' : 'typical';
  }
  const note =
    status === 'slower'
      ? `Drying ${Math.round((1 - ratio!) * 100)}% slower than this pot usually does for this air (diagnostic, not a health signal).`
      : status === 'faster'
      ? `Drying ${Math.round((ratio! - 1) * 100)}% faster than this pot usually does for this air (diagnostic).`
      : null;

  // Temperature exposure → the penalty the temperature score takes (see vitality.healthScores)
  const e = p.exposure?.temperature ?? null;
  const t = species.environment.temperatureExposure;
  const temperature = e
    ? {
        heatDegreeHours: e.heatDegreeHours,
        coldDegreeHours: e.coldDegreeHours,
        penalty: Math.round(Math.min(t.maxPenalty, (e.heatDegreeHours + e.coldDegreeHours) * t.scorePerDegreeHour) * 10) / 10,
      }
    : null;

  return {
    coupling: { current: d?.perHourPerKpa ?? null, baseline: mem.baseline, baselineHours: mem.hours, ratio, status, note },
    temperatureExposure: temperature,
  };
}
