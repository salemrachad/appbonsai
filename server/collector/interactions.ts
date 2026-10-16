import { APP_CONFIG } from '../../src/config/appConfig';
import { INTERACTION_KINDS } from '../../src/history/historyTypes';
import type { Interaction, InteractionKind } from '../../src/history/historyTypes';
import type { AppDatabase } from '../database';
import { DAY } from '../../src/lib/time';


// ---- attention (not care) ----
// A petting session reported by the browser, checked and capped. Stored for relationship memory only: it
// never triggers an evaluation and nothing in perception or health reads it.
export function recordInteraction(
  db: AppDatabase,
  body: unknown,
  now: number
): { ok: true; interaction: Interaction; merged: boolean } | { ok: false; status: number; error: string } {
  const cfg = APP_CONFIG.attention;
  const b = (body ?? {}) as Record<string, unknown>;
  const kind = b.kind as InteractionKind;
  if (!INTERACTION_KINDS.includes(kind)) return { ok: false, status: 400, error: `kind must be one of ${INTERACTION_KINDS.join(', ')}` };
  let endedAt = Number(b.endedAt);
  let startedAt = Number(b.startedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt > endedAt) return { ok: false, status: 400, error: 'startedAt ≤ endedAt (ms) required' };
  if (endedAt > now + 60_000 || endedAt < now - DAY) return { ok: false, status: 400, error: 'session must have ended within the last day' };
  endedAt = Math.min(endedAt, now);
  startedAt = Math.max(startedAt, endedAt - cfg.maxSessionMs);
  const count = Math.max(1, Math.min(cfg.maxStrokesPerSession, Math.round(Number(b.count) || 1)));
  const activeMs = Math.max(0, Math.min(endedAt - startedAt, Math.round(Number(b.activeMs) || 0)));
  const recent = db.interactionsSince(now - 3600_000, kind).filter((i) => i.startedAt >= now - 3600_000).length;
  // Write cap: past it, a session can still extend the latest row but never add a new one
  const result = db.recordInteraction({ kind, startedAt, endedAt, count, activeMs }, cfg.mergeMs, recent < cfg.maxRowsPerHour);
  if (!result) return { ok: false, status: 429, error: 'Too many sessions this hour' };
  return { ok: true, ...result };
}
