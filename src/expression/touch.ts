import type { TouchResponse } from './expressionTypes';

// Habituation within one petting session: continuous stroking makes the answer settle toward
// `floor` (calm acceptance, never a refusal); a rest lets it recover. Pure, so the scenario tests can
// check it; the avatar calls it every animation frame. Expressive choice inspired by real plant
// habituation (Mimosa pudica stops folding after repeated harmless touch), not a claim about ficus.
//
// level: 1 = full, fresh answer … floor = settled. Nothing here is stored between sessions.
export function habituate(level: number, h: TouchResponse['habituation'], dtMs: number, stroking: boolean): number {
  if (dtMs <= 0) return level;
  if (stroking) {
    if (h.settlePerSec <= 0) return level;
    return level + (h.floor - level) * (1 - Math.exp(-h.settlePerSec * (dtMs / 1000)));
  }
  return level + (1 - level) * (1 - Math.exp(-dtMs / h.recoverMs));
}
