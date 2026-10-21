import { Router } from 'express';
import { APP_CONFIG } from '../../src/config/appConfig';
import type { PhotoAnalysis, PhotoQuality, PhotoRecord, Roi } from '../../src/vision/visionTypes';
import type { LivingCollector } from '../collector';
import type { AppDatabase, StoredPhoto } from '../database';
import { photoKey, type PhotoStore } from '../photoStore';
import { DAY } from '../../src/lib/time';

// The daily photos of the real tree. The browser shrinks and measures each one (src/vision/measure.ts) and
// sends the JPEG with what it measured; the image goes to the photo store, the row to the database, and the
// tree is evaluated again (the canopy follows the photo).
//   GET    /api/photos?days=60              {photos, storage}: newest first, the reference always included
//   POST   /api/photos {image (base64 JPEG), takenAt, width, height, analysis?, roi?, isReference?, note?}
//   PATCH  /api/photos/:id {isReference?: true, roi?, analysis?, note?}
//   GET    /api/photos/:id/image            the JPEG
//   DELETE /api/photos/:id
// Without a photo store (a Cloudflare preview has no PHOTOS binding) uploads answer 503.

const QUALITIES: PhotoQuality[] = ['ok', 'too_dark', 'blurry', 'misaligned', 'no_leaves'];
const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function parseRoi(v: unknown): Roi | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const r = v as Roi;
  if (!r || ![r.x, r.y, r.w, r.h].every(unit) || r.w < 0.02 || r.h < 0.02 || r.x + r.w > 1.0001 || r.y + r.h > 1.0001) throw new Error('roi must be {x, y, w, h} as fractions of the image');
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function parseAnalysis(v: unknown): PhotoAnalysis | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const a = v as PhotoAnalysis;
  if (!a || !QUALITIES.includes(a.quality) || ![a.foliage, a.green, a.yellow, a.brown].every(unit) || !finite(a.brightness) || !finite(a.sharpness) || !finite(a.analyzerVersion) || !(a.alignment === null || finite(a.alignment)))
    throw new Error('analysis is not a photo analysis');
  return { analyzerVersion: a.analyzerVersion, quality: a.quality, foliage: a.foliage, green: a.green, yellow: a.yellow, brown: a.brown, brightness: a.brightness, sharpness: a.sharpness, alignment: a.alignment };
}

const note = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
// The API never shows where the image is kept
const publicPhoto = ({ imageKey: _k, bytes: _b, ...p }: StoredPhoto): PhotoRecord => p;

export function photoRoutes(db: AppDatabase, collector: LivingCollector, store: PhotoStore | null): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 60));
    res.json({ photos: db.photosSince(Date.now() - days * DAY).map(publicPhoto), storage: !!store });
  });

  r.post('/', async (req, res) => {
    if (!store) return res.status(503).json({ error: 'No photo storage on this server' });
    const b = req.body ?? {};
    try {
      const takenAt = b.takenAt === undefined ? Date.now() : Number(b.takenAt);
      if (!Number.isFinite(takenAt) || takenAt > Date.now() + 60_000 || takenAt < Date.now() - 365 * DAY) throw new Error('takenAt must be a time within the last year, in ms');
      if (typeof b.image !== 'string') throw new Error('image must be a base64 JPEG');
      const bytes = new Uint8Array(Buffer.from(b.image.replace(/^data:image\/jpeg;base64,/, ''), 'base64'));
      if (bytes.length > APP_CONFIG.photos.maxBytes) throw new Error(`The image is over ${Math.round(APP_CONFIG.photos.maxBytes / 1024)} KB`);
      if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('The image is not a JPEG');
      const width = Number(b.width);
      const height = Number(b.height);
      if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8000 && height <= 8000)) throw new Error('width and height must be the image size in px');
      const roi = parseRoi(b.roi) ?? null;
      const analysis = parseAnalysis(b.analysis) ?? null;
      const isReference = b.isReference === true;
      if (isReference && !roi) throw new Error('A reference photo needs its crown box (roi)');
      const imageKey = photoKey(takenAt);
      await store.put(imageKey, bytes, 'image/jpeg');
      const photo = db.insertPhoto({ takenAt, uploadedAt: Date.now(), imageKey, width, height, bytes: bytes.length, isReference, roi, analysis, note: note(b.note) });
      collector.photosChanged();
      res.status(201).json(publicPhoto(photo));
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? String(err) });
    }
  });

  r.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    try {
      if (!db.getPhoto(id)) return res.status(404).json({ error: 'No such photo' });
      const change: Parameters<AppDatabase['updatePhoto']>[1] = {};
      const roi = parseRoi(b.roi);
      if (roi !== undefined) change.roi = roi;
      const analysis = parseAnalysis(b.analysis);
      if (analysis !== undefined) change.analysis = analysis;
      if ('note' in b) change.note = note(b.note);
      let photo = db.updatePhoto(id, change)!;
      if (b.isReference === true) {
        if (!photo.roi) throw new Error('A reference photo needs its crown box (roi)');
        db.setReferencePhoto(id);
        photo = db.getPhoto(id)!;
      }
      collector.photosChanged();
      res.json(publicPhoto(photo));
    } catch (err: any) {
      res.status(400).json({ error: err?.message ?? String(err) });
    }
  });

  r.get('/:id/image', async (req, res) => {
    const photo = db.getPhoto(Number(req.params.id));
    if (!photo || !store) return res.status(404).json({ error: 'No such photo' });
    const bytes = await store.get(photo.imageKey).catch(() => null);
    if (!bytes) return res.status(404).json({ error: 'The image is missing from the photo store' });
    // A photo's image never changes (a new photo gets a new id)
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' }).send(Buffer.from(bytes));
  });

  r.delete('/:id', async (req, res) => {
    const photo = db.deletePhoto(Number(req.params.id));
    if (!photo) return res.status(404).json({ error: 'No such photo' });
    await store?.delete(photo.imageKey).catch((err) => console.warn(`[photos] image ${photo.imageKey} not deleted: ${err}`));
    collector.photosChanged();
    res.status(204).end();
  });

  return r;
}
