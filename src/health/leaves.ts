import type { SpeciesProfile } from '../species';
import type { LeafObservation } from '../vision/visionTypes';
import { DAY } from '../lib/time';

// What the photos say about health (evidence class "observation"). A ficus drops leaves days AFTER a stress,
// so the leaves tell what the last weeks did, not how the tree is now (the sensors say that): a drop measured
// between two readable photos is shedding, a small vitality dip that fades over the days after the photo.
// It never becomes the condition, takes no latch and moves nothing else.
export interface LeafHealth {
  at: number; // the latest readable photo
  fullness: number; // against the reference
  yellow: number; // yellow + brown share of its leaves
  shedding: { drop: number; from: { at: number; fullness: number }; points: number } | null;
}

export function interpretLeaves(leaves: LeafObservation | undefined, species: SpeciesProfile, now: number): LeafHealth | null {
  if (!leaves) return null;
  const s = species.photo.shedding;
  const latest = leaves.measured.at(-1)!;
  const before = leaves.measured.filter((m) => m.at < latest.at && m.at >= latest.at - s.compareDays * DAY);
  const fullest = before.reduce<(typeof before)[number] | null>((best, m) => (!best || m.fullness > best.fullness ? m : best), null);
  const drop = fullest ? round2(fullest.fullness - latest.fullness) : 0;
  const fade = Math.max(0, 1 - (now - latest.at) / (s.fadeDays * DAY));
  const shedding =
    fullest && drop >= s.minDrop && fade > 0
      ? { drop, from: { at: fullest.at, fullness: fullest.fullness }, points: round1(Math.min(s.maxPoints, drop * s.pointsPerDrop) * fade) }
      : null;
  return { at: latest.at, fullness: latest.fullness, yellow: latest.yellow, shedding };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
