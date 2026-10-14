import { useMemo } from 'react';
import type { LivingSnapshot } from '../api/types';
import { evaluateBehaviour } from '../behaviour/BehaviourEngine';
import type { PlantBehaviourState } from '../behaviour/behaviourTypes';
import { expressBehaviour } from '../expression/ExpressionEngine';
import type { ExpressionState } from '../expression/expressionTypes';
import type { PlantHealthState } from '../health/healthTypes';
import { ACTIVE_SPECIES } from '../species';

// Live behaviour + expression come from the server. A developer preview re-runs the same engines
// in the browser on the overridden health, without history or care events (so a real watering
// minutes ago doesn't mask the previewed state). Nothing is written anywhere.
export function usePlantBehaviour(snapshot: LivingSnapshot | null, display: PlantHealthState | null) {
  return useMemo<{ behaviour: PlantBehaviourState | null; expression: ExpressionState | null }>(() => {
    if (!snapshot || !display) return { behaviour: null, expression: null };
    if (!display.isOverride || !snapshot.perception) return { behaviour: snapshot.behaviour, expression: snapshot.expression };
    const now = Date.now();
    const behaviour = evaluateBehaviour({
      health: display,
      perception: snapshot.perception,
      episodes: [],
      events: [],
      species: ACTIVE_SPECIES,
      now,
    });
    return { behaviour, expression: expressBehaviour({ behaviour, health: display, perception: snapshot.perception, now }) };
  }, [snapshot, display]);
}
