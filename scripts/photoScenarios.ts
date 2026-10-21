// The daily photos (npm run test:photos): reading a photo (src/vision/measure.ts) on synthetic images, what
// perception, health and the canopy make of the photos, and the photos through the real collector and routes.
import './tz'; // first: the tree's timezone (the build machines run in UTC)
import type { AddressInfo } from 'node:net';
import { apiApp } from '../server/app';
import type { PhotoStore } from '../server/photoStore';
import { evaluateCanopy } from '../src/behaviour/canopy';
import { interpretLeaves } from '../src/health/leaves';
import { photoDiary } from '../src/history/photoDiary';
import { ACTIVE_SPECIES } from '../src/species';
import { correlation, edgeSignature, fullnessOf, leafPixel, measurePhoto, roiPixels } from '../src/vision/measure';
import { observeLeaves } from '../src/vision/leaves';
import type { PhotoAnalysis, PhotoRecord, Rgba, Roi } from '../src/vision/visionTypes';
import { Bench, check, finish, HOUR, MIN } from './bench';

const DAY = 24 * HOUR;
const rules = ACTIVE_SPECIES.photo;

// ---- synthetic photos of a tree: a window behind, a pot, a trunk, a crown of textured leaves ----
type RGB = [number, number, number];
interface Scene {
  shift?: number; // the whole framing moved right, as a share of the width
  leaves?: (x: number, y: number) => boolean; // which crown pixels carry a leaf (default all)
  colour?: (x: number, y: number) => RGB | null; // a leaf's colour (default two textured greens)
  dim?: number; // light, 1 = normal
  smooth?: boolean; // no fine texture anywhere (an out-of-focus photo)
}
const W = 240;
const H = 180;
const ROI: Roi = { x: 0.2, y: 0.15, w: 0.6, h: 0.4 }; // bounds the crown ellipse exactly
function photo(s: Scene = {}): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  const dx = Math.round((s.shift ?? 0) * W);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const X = x - dx;
      const fine = s.smooth ? 0 : (x + y) % 2;
      // A window frame behind (large, strong edges: what keeps the framing recognisable), the wall
      let c: RGB = (X > 10 && X < 60) || (X > 180 && X < 230) ? (y < 120 ? [205, 210, 215] : [140, 135, 130]) : [140 - fine * 12, 135 - fine * 12, 130 - fine * 12];
      if (y > 120 && X > 85 && X < 155) c = [110, 90, 80]; // the pot (dull brown: not a dry leaf)
      else if (y > 100 && y <= 120 && X > 113 && X < 127) c = [70, 55, 45]; // the trunk
      const ex = (X - 0.5 * W) / (0.3 * W);
      const ey = (y - 0.35 * H) / (0.2 * H);
      if (ex * ex + ey * ey <= 1 && (s.leaves ?? (() => true))(X, y)) c = s.colour?.(X, y) ?? (fine ? [80, 150, 55] : [60, 130, 40]);
      const k = s.dim ?? 1;
      data.set([c[0] * k, c[1] * k, c[2] * k, 255], (y * W + x) * 4);
    }
  return { width: W, height: H, data };
}
const box = roiPixels({ width: W, height: H, data: [] }, ROI);
const crownPixels = (pred: (x: number, y: number) => boolean) => {
  let n = 0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const ex = (x - 0.5 * W) / (0.3 * W);
      const ey = (y - 0.35 * H) / (0.2 * H);
      if (ex * ex + ey * ey <= 1 && pred(x, y)) n++;
    }
  return n;
};
const boxPixels = (box.x1 - box.x0) * (box.y1 - box.y0);

async function main() {
  console.log('— Reading a photo —');
  const refImg = photo();
  const ref = measurePhoto({ img: refImg, roi: ROI, rules });
  const reference = { img: refImg, sharpness: ref.sharpness };
  {
    const expected = crownPixels(() => true) / boxPixels;
    check('PH1 the reference: every crown pixel is a leaf, green; readable', ref.quality === 'ok' && Math.abs(ref.foliage - expected) < 0.002 && ref.green === 1 && ref.alignment === null, `${ref.foliage} vs ${expected.toFixed(4)}, ${JSON.stringify(ref)}`);
    check(
      'PH2 colours: green leaves, yellowing and dry leaves are leaves; the wall, the pot, the trunk and the window are not',
      leafPixel(60, 130, 40, rules) === 'green' && leafPixel(220, 190, 60, rules) === 'yellow' && leafPixel(150, 90, 30, rules) === 'brown' &&
        [[140, 135, 130], [110, 90, 80], [70, 55, 45], [205, 210, 215], [15, 22, 10]].every(([r, g, b]) => leafPixel(r, g, b, rules) === null)
    );
    const yellowed = measurePhoto({ img: photo({ colour: (x, y) => ((x * 7 + y * 3) % 10 < 2 ? [220, 190, 60] : (x * 7 + y * 3) % 10 === 2 ? [150, 90, 30] : null) }), roi: ROI, reference, rules });
    check('PH3 yellowing counted among the leaves, cover unchanged', yellowed.quality === 'ok' && Math.abs(yellowed.yellow - 0.2) < 0.02 && Math.abs(yellowed.brown - 0.1) < 0.02 && Math.abs(yellowed.foliage - ref.foliage) < 0.002, JSON.stringify(yellowed));
    const half = measurePhoto({ img: photo({ leaves: (x) => x < 0.5 * W }), roi: ROI, reference, rules });
    const f = fullnessOf(half.foliage, ref.foliage);
    check('PH4 half the leaves gone: fullness about half, still framed alike', half.quality === 'ok' && f !== null && Math.abs(f - 0.5) < 0.03 && (half.alignment ?? 0) >= 0.4, `fullness ${f}, alignment ${half.alignment}`);
    const dark = measurePhoto({ img: photo({ dim: 0.15 }), roi: ROI, reference, rules });
    check('PH5 too dark: not measured', dark.quality === 'too_dark', JSON.stringify(dark));
    const blurry = measurePhoto({ img: photo({ smooth: true }), roi: ROI, reference, rules });
    check('PH6 out of focus: not measured', blurry.quality === 'blurry', `${blurry.sharpness} vs reference ${ref.sharpness}`);
    const moved = measurePhoto({ img: photo({ shift: 0.3 }), roi: ROI, reference, rules });
    check('PH7 framed from elsewhere: not measured', moved.quality === 'misaligned', `alignment ${moved.alignment}`);
    const same = correlation(edgeSignature(photo()), edgeSignature(photo({ dim: 0.7 })));
    check('PH8 the same framing in softer light still lines up', same > 0.95, `${same.toFixed(3)}`);
    const empty = measurePhoto({ img: photo({ leaves: () => false }), roi: ROI, reference, rules });
    check('PH9 no leaves in the crown box: not measured', empty.quality === 'no_leaves' || empty.quality === 'misaligned', JSON.stringify(empty));
    check('PH10 deterministic', JSON.stringify(measurePhoto({ img: photo({ leaves: (x) => x < 0.5 * W }), roi: ROI, reference, rules })) === JSON.stringify(half));
  }

  console.log('\n— What the photos mean —');
  const t0 = Date.UTC(2026, 5, 1, 7);
  const analysis = (foliage: number, quality: PhotoAnalysis['quality'] = 'ok', yellow = 0): PhotoAnalysis => ({ analyzerVersion: 1, quality, foliage, green: 1 - yellow, yellow, brown: 0, brightness: 120, sharpness: 40, alignment: 0.9 });
  let id = 0;
  const rec = (at: number, a: PhotoAnalysis | null, isReference = false): PhotoRecord => ({ id: ++id, takenAt: at, uploadedAt: at, width: 1600, height: 1200, isReference, roi: isReference ? ROI : null, analysis: a, note: null });
  {
    check('PH11 no reference: nothing observed', observeLeaves([rec(t0, analysis(0.6))], t0 + HOUR) === null);
    const photos = [rec(t0 - 40 * DAY, analysis(0.8), true), rec(t0, analysis(0.72)), rec(t0 + DAY, analysis(0.6, 'too_dark')), rec(t0 + 5 * DAY, analysis(0.6, 'ok', 0.12)), rec(t0 + 9 * DAY, analysis(0.4))];
    const seen = observeLeaves(photos, t0 + 6 * DAY)!;
    check(
      'PH12 the latest readable photo against the reference (however old); unreadable and future photos left out',
      seen.fullness === 0.75 && seen.yellow === 0.12 && seen.measured.map((m) => m.fullness).join() === '0.9,0.75' && seen.lastPhotoAt === t0 + 5 * DAY,
      JSON.stringify(seen)
    );
    const shed = interpretLeaves(seen, ACTIVE_SPECIES, t0 + 5 * DAY);
    check('PH13 leaves dropped within a week (0.90 → 0.75): shedding, a dip of drop × 40 points (capped)', shed?.shedding?.drop === 0.15 && shed.shedding.points === 6, JSON.stringify(shed));
    const later = interpretLeaves(seen, ACTIVE_SPECIES, t0 + 5 * DAY + 3.5 * DAY);
    check('PH14 the dip fades over the days after the photo, then is gone', later?.shedding?.points === 3 && interpretLeaves(seen, ACTIVE_SPECIES, t0 + 13 * DAY)?.shedding === null, JSON.stringify(later?.shedding));
    const small = observeLeaves([photos[0], rec(t0, analysis(0.76)), rec(t0 + 2 * DAY, analysis(0.72))], t0 + 2 * DAY)!;
    check('PH15 a small difference between photos (5 %) is not shedding', interpretLeaves(small, ACTIVE_SPECIES, t0 + 2 * DAY)?.shedding === null);
    const apart = observeLeaves([photos[0], rec(t0, analysis(0.8)), rec(t0 + 10 * DAY, analysis(0.6))], t0 + 10 * DAY)!;
    check('PH16 photos more than a week apart are not compared', interpretLeaves(apart, ACTIVE_SPECIES, t0 + 10 * DAY)?.shedding === null);

    // The canopy starts from the photo, and the history carries it from there
    const ep = (condition: 'comfortable' | 'very_dry', startedAt: number, hours: number) => ({ id: ++id, startedAt, endedAt: startedAt + hours * HOUR, lastSeenAt: startedAt + hours * HOUR, unobservedMs: 0, condition, modifiers: [], peakSeverity: 'none' as const, engineVersion: 't' });
    const calm = Array.from({ length: 20 }, (_, d) => ep('comfortable', t0 + d * DAY, 24));
    const now = t0 + 20 * DAY;
    const plain = evaluateCanopy({ episodes: calm, events: [], growth: 'active', species: ACTIVE_SPECIES, now });
    const noPhotos = evaluateCanopy({ episodes: calm, events: [], growth: 'active', species: ACTIVE_SPECIES, now, photos: [] });
    check('PH17 without photos the canopy is exactly as before', JSON.stringify(plain) === JSON.stringify(noPhotos) && !('measured' in plain));
    const fresh = evaluateCanopy({ episodes: calm, events: [], growth: 'active', species: ACTIVE_SPECIES, now, photos: [{ at: now - HOUR, fullness: 0.5, yellow: 0.1 }] });
    check('PH18 a photo of a thin tree today: the canopy is what it shows (below the inference floor), its yellow leaves shown', fresh.fullness >= 0.5 && fresh.fullness < 0.52 && fresh.measured?.fullness === 0.5 && fresh.yellow === 0.1, JSON.stringify(fresh));
    const weeks = evaluateCanopy({ episodes: [...calm, ...Array.from({ length: 15 }, (_, d) => ep('comfortable', now + d * DAY, 24))], events: [], growth: 'active', species: ACTIVE_SPECIES, now: now + 15 * DAY, photos: [{ at: now, fullness: 0.6, yellow: 0.1 }] });
    check('PH19 calm days after the photo refill it (the rules carry it forward); old yellow leaves stop showing after two weeks', weeks.fullness > 0.6 && weeks.trend === 'refilling' && weeks.yellow === undefined, JSON.stringify(weeks));
    const drought = evaluateCanopy({ episodes: [...calm, ep('very_dry', now, 72)], events: [], growth: 'active', species: ACTIVE_SPECIES, now: now + 72 * HOUR, photos: [{ at: now, fullness: 0.55 }] });
    check('PH20 a long drought after the photo thins it further, never below what the photo showed or the floor, whichever is lower', drought.fullness === 0.55 && drought.trend === 'steady', JSON.stringify(drought));

    const diary = photoDiary(photos, t0 - 50 * DAY, t0 + 10 * DAY);
    check(
      'PH21 the diary: the reference, each photo against it with the change since the one before, why one was not read',
      diary.length === 5 && diary[0].title.startsWith('Reference photo') && diary[1].title === 'Photo: the canopy looks 90 % full' && diary[2].title.includes('too dark') && /15 % less/.test(diary[3].detail ?? '') && /a few yellow leaves/.test(diary[3].detail ?? ''),
      diary.map((d) => `${d.title} | ${d.detail ?? ''}`).join(' / ')
    );
  }

  console.log('\n— Photos through the collector —');
  {
    const plain = new Bench();
    await plain.boot();
    const b = new Bench();
    await b.boot();
    await plain.run(60, () => ({ soil: 50 }));
    await b.run(60, () => ({ soil: 50 }));
    const s0 = b.state()!;
    check('PH22 no photos: nothing about leaves anywhere in the state', !('leaves' in s0.perception) && !('leaves' in s0.health) && !('measured' in s0.behaviour.canopy) && s0.health.breakdown.leafDropModifier === undefined);
    const ins = (at: number, a: PhotoAnalysis, isReference = false) => b.db.insertPhoto({ takenAt: at, uploadedAt: at, imageKey: `k${at}`, width: 1600, height: 1200, bytes: 1000, isReference, roi: isReference ? ROI : null, analysis: a, note: null });
    ins(b.clock - 30 * DAY, analysis(0.8), true); // the reference, older than the window
    ins(b.clock - 3 * DAY, analysis(0.8));
    ins(b.clock - 10 * MIN, analysis(0.6, 'ok', 0.15));
    b.collector.photosChanged();
    await plain.run(10, () => ({ soil: 50 }));
    await b.run(10, () => ({ soil: 50 }));
    const s = b.state()!;
    const p = plain.state()!;
    check('PH23 the photos reach perception: the reference however old, the latest photo 75 % full', s.perception.leaves?.fullness === 0.75 && s.perception.leaves.measured.length === 2, JSON.stringify(s.perception.leaves));
    check('PH24 leaves dropped since three days ago: shedding lowers vitality a little; the condition stays the sensors\'', s.health.condition === p.health.condition && (s.health.breakdown.leafDropModifier ?? 0) > 5 && s.health.breakdown.target < p.health.breakdown.target && s.health.vitality <= p.health.vitality, `${s.health.condition} v${s.health.vitality} (target ${s.health.breakdown.target}, −${s.health.breakdown.leafDropModifier}) vs ${p.health.condition} v${p.health.vitality}`);
    check('PH25 the canopy is the photo\'s, its yellow leaves on the avatar; mood and energy unchanged', s.behaviour.canopy.measured?.fullness === 0.75 && s.expression.avatar.canopy.measured === true && s.expression.avatar.canopy.yellow === 0.15 && s.behaviour.mood === p.behaviour.mood, JSON.stringify(s.expression.avatar.canopy));
    const dump = b.db.dump();
    const c = new Bench();
    c.db.restore(dump);
    check('PH26 photos move with the tree (dump and restore), the reference kept', c.db.photosSince(b.clock - DAY).length === 2 && c.db.photosSince(b.clock - DAY).some((x) => x.isReference));
    // A load reads the photos window through the indexes: the reference and the window's rows, not the table
    for (let i = 0; i < 40; i++) ins(b.clock - 300 * DAY + i * DAY, analysis(0.7)); // a year back of old photos
    const fresh = new Bench(b.db);
    const before = b.db.rowsRead() ?? 0;
    fresh.db.photosSince(b.clock - 30 * DAY);
    const read = (b.db.rowsRead() ?? 0) - before;
    check('PH27 reading the photos window does not read the whole table', read <= 4, `${read} rows read`);
  }

  console.log('\n— The photo routes —');
  {
    const b = new Bench();
    await b.boot();
    await b.run(5, () => ({ soil: 50 }));
    const files = new Map<string, Uint8Array>();
    const store: PhotoStore = { where: 'memory', put: async (k, v) => void files.set(k, v), get: async (k) => files.get(k) ?? null, delete: async (k) => void files.delete(k) };
    const server = apiApp(b.db, b.collector, { startedAt: b.clock, backend: { mode: 'local-dev', hostname: 't', host: '127.0.0.1', port: 0, dbPath: ':memory:', collector: 'this server', servesApp: false }, photos: store }).listen(0);
    const none = apiApp(b.db, b.collector, { startedAt: b.clock, backend: { mode: 'local-dev', hostname: 't', host: '127.0.0.1', port: 0, dbPath: ':memory:', collector: 'this server', servesApp: false } }).listen(0);
    const url = (s: typeof server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}/api${p}`;
    const post = (s: typeof server, body: unknown) => fetch(url(s, '/photos'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]).toString('base64');
    try {
      const noRoi = await post(server, { image: jpeg, takenAt: Date.now() - MIN, width: 1600, height: 1200, analysis: analysis(0.8), isReference: true });
      const notJpeg = await post(server, { image: Buffer.from('hello').toString('base64'), width: 10, height: 10 });
      check('PH28 a reference needs its crown box; only JPEGs are taken', noRoi.status === 400 && notJpeg.status === 400);
      const made = await post(server, { image: jpeg, takenAt: Date.now() - MIN, width: 1600, height: 1200, analysis: analysis(0.8), roi: ROI, isReference: true });
      const photo = (await made.json()) as PhotoRecord & { imageKey?: string };
      const img = await fetch(url(server, `/photos/${photo.id}/image`));
      const bytes = Buffer.from(await img.arrayBuffer());
      check('PH29 stored: the row (without where the image is kept) and the same image back as a JPEG', made.status === 201 && photo.isReference && !('imageKey' in photo) && img.headers.get('content-type') === 'image/jpeg' && bytes.toString('base64') === jpeg && files.size === 1);
      const second = (await (await post(server, { image: jpeg, takenAt: Date.now(), width: 1600, height: 1200, analysis: analysis(0.6) })).json()) as PhotoRecord;
      const patched = await fetch(url(server, `/photos/${second.id}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isReference: true, roi: ROI }) });
      const list = (await (await fetch(url(server, '/photos'))).json()) as { photos: PhotoRecord[]; storage: boolean };
      check('PH30 one reference at a time', patched.status === 200 && list.photos.filter((x) => x.isReference).map((x) => x.id).join() === String(second.id) && list.storage === true);
      const del = await fetch(url(server, `/photos/${photo.id}`), { method: 'DELETE' });
      check('PH31 deleting a photo removes its image too', del.status === 204 && files.size === 1 && !b.db.getPhoto(photo.id));
      const refused = await post(none, { image: jpeg, width: 1600, height: 1200 });
      const listed = (await (await fetch(url(none, '/photos'))).json()) as { storage: boolean };
      check('PH32 without a photo store (a preview build): uploads refused, the list says so', refused.status === 503 && listed.storage === false);
    } finally {
      server.close();
      none.close();
    }
  }

  finish();
}

main();
