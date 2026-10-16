import { Router } from 'express';
import { PLANT_EVENT_TYPES, PlantEventType } from '../../src/history/historyTypes';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';
import { DAY } from '../../src/lib/time';


// GET /api/events?days=30 · POST /api/events {type, note?, timestamp?} · DELETE /api/events/:id
export function eventRoutes(db: AppDatabase, collector: LivingCollector): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(req.query.days) || 30));
    res.json(db.eventsSince(Date.now() - days * DAY));
  });

  r.post('/', (req, res) => {
    const { type, note, timestamp } = req.body ?? {};
    if (!PLANT_EVENT_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${PLANT_EVENT_TYPES.join(', ')}` });
    const at = timestamp === undefined ? Date.now() : Number(timestamp);
    if (!Number.isFinite(at) || at > Date.now() + 60_000) return res.status(400).json({ error: 'timestamp must be a past time in ms' });
    const text = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
    if (type === 'manual_note' && !text) return res.status(400).json({ error: 'A note needs some text' });
    const event = collector.logEvent(type as PlantEventType, text, at);
    if (!event) return res.status(409).json({ error: 'An event of this type already exists at that time' });
    res.status(201).json(event);
  });

  r.delete('/:id', (req, res) => {
    const ok = collector.deleteEvent(Number(req.params.id));
    res.status(ok ? 204 : 404).end();
  });

  return r;
}
