import { Router } from 'express';
import type { InteractionKind } from '../../src/history/historyTypes';
import { INTERACTION_KINDS } from '../../src/history/historyTypes';
import type { LivingCollector } from '../collector';
import type { AppDatabase } from '../database';
import { DAY } from '../../src/lib/time';


// Attention, not care. GET /api/interactions?days=7&kind=pet
// POST /api/interactions {kind: 'pet', startedAt, endedAt, count, activeMs}: one call per petting SESSION
export function interactionRoutes(db: AppDatabase, collector: LivingCollector): Router {
  const r = Router();

  r.get('/', (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 7));
    const kind = INTERACTION_KINDS.includes(req.query.kind as InteractionKind) ? (req.query.kind as InteractionKind) : undefined;
    res.json(db.interactionsSince(Date.now() - days * DAY, kind));
  });

  r.post('/', (req, res) => {
    const result = collector.recordInteraction(req.body);
    if ('error' in result) return res.status(result.status).json({ error: result.error });
    res.status(result.merged ? 200 : 201).json(result.interaction);
  });

  return r;
}
