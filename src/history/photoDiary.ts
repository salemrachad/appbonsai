import { fullnessOf } from '../vision/measure';
import type { PhotoQuality, PhotoRecord } from '../vision/visionTypes';
import type { DiaryItem } from './historyTypes';
import { weekdayShort } from '../lib/time';

// The daily photos in the diary: what each showed (the canopy against the reference, yellow leaves, the change
// since the photo before), or why it couldn't be read. Facts from the photos only.
const UNREADABLE: Record<Exclude<PhotoQuality, 'ok'>, string> = {
  too_dark: 'too dark to read the leaves',
  blurry: 'too blurry to read the leaves',
  misaligned: 'framed differently from the reference',
  no_leaves: 'no leaves inside the crown box',
};

// photos: any order, the reference included (it may be older than `since`)
export function photoDiary(photos: PhotoRecord[], since: number, now: number): DiaryItem[] {
  const reference = photos.filter((p) => p.isReference).sort((a, b) => b.takenAt - a.takenAt)[0] ?? null;
  const refFoliage = reference?.analysis?.quality === 'ok' ? reference.analysis.foliage : null;
  const sorted = [...photos].filter((p) => p.takenAt <= now).sort((a, b) => a.takenAt - b.takenAt);
  const out: DiaryItem[] = [];
  let before: { at: number; fullness: number } | null = null;
  for (const p of sorted) {
    const a = p.analysis;
    const fullness = a?.quality === 'ok' ? (p.id === reference?.id ? 1 : fullnessOf(a.foliage, refFoliage)) : null;
    if (p.takenAt >= since) {
      const yellow = a?.quality === 'ok' ? a.yellow + a.brown : 0;
      const details = [
        yellow >= 0.05 ? `${yellow >= 0.15 ? 'several' : 'a few'} yellow leaves (${Math.round(yellow * 100)} %)` : null,
        fullness !== null && before && Math.abs(fullness - before.fullness) >= 0.03
          ? `${Math.round(Math.abs(fullness - before.fullness) * 100)} % ${fullness < before.fullness ? 'less' : 'more'} than on ${weekdayShort(before.at)}`
          : null,
        p.note,
      ].filter(Boolean);
      out.push({
        at: p.takenAt,
        kind: 'photo',
        photoId: p.id,
        title:
          p.id === reference?.id
            ? 'Reference photo: the tree at its fullest'
            : fullness !== null
            ? `Photo: the canopy looks ${Math.round(fullness * 100)} % full`
            : a && a.quality !== 'ok'
            ? `Photo (${UNREADABLE[a.quality]})`
            : 'Photo',
        ...(details.length && { detail: details.join(' · ') }),
      });
    }
    if (fullness !== null) before = { at: p.takenAt, fullness };
  }
  return out;
}
