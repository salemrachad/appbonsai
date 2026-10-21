import { APP_CONFIG } from '../config/appConfig';
import { DAY } from '../lib/time';
import { fullnessOf } from './measure';
import type { LeafObservation, PhotoRecord } from './visionTypes';

// The photos as perception sees them (perception.leaves): the readable ones of the last weeks, each one's
// fullness against the reference. Nothing without a reference or without a readable photo, so a tree nobody
// photographs is exactly as before.
export function observeLeaves(photos: PhotoRecord[], now: number): LeafObservation | null {
  const taken = photos.filter((p) => p.takenAt <= now);
  const reference = taken.filter((p) => p.isReference && p.analysis && p.analysis.quality === 'ok').sort((a, b) => b.takenAt - a.takenAt)[0];
  if (!reference) return null;
  const since = now - APP_CONFIG.photos.windowDays * DAY;
  const measured = taken
    .filter((p) => p.takenAt >= since && p.analysis?.quality === 'ok')
    .sort((a, b) => a.takenAt - b.takenAt || a.id - b.id)
    .flatMap((p) => {
      const fullness = p.id === reference.id ? 1 : fullnessOf(p.analysis!.foliage, reference.analysis!.foliage);
      return fullness === null ? [] : [{ id: p.id, at: p.takenAt, fullness, yellow: round2(p.analysis!.yellow + p.analysis!.brown) }];
    });
  const last = measured.at(-1);
  if (!last) return null;
  return {
    photoId: last.id,
    at: last.at,
    fullness: last.fullness,
    yellow: last.yellow,
    lastPhotoAt: Math.max(...taken.map((p) => p.takenAt)),
    measured,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
