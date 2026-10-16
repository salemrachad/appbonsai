import { useMemo } from 'react';
import type { LivingSnapshot } from '../api/types';
import { evaluateBehaviour } from '../behaviour/BehaviourEngine';
import type { PlantBehaviourState } from '../behaviour/behaviourTypes';
import { expressBehaviour } from '../expression/ExpressionEngine';
import { visitorPlay, weatherLook } from '../expression/ExpressionEngine';
import type { DreyLook, ExpressionState, VisitorPresentation } from '../expression/expressionTypes';
import type { OutsideSky } from '../telemetry/outsideWeather';
import type { PlantHealthState } from '../health/healthTypes';
import { midSeasonState, type Season } from '../perception/season';
import { ACTIVE_SPECIES } from '../species';

// Live behaviour + expression come from the server. A developer preview re-runs the same engines
// in the browser on the overridden health, without history or care events (so a real watering
// minutes ago doesn't mask the previewed state). Nothing is written anywhere.
// A season preview swaps only the perceived season (as on its middle day), the rest stays as perceived.
// A visitor preview puts the squirrel in the tree on top of whatever is shown (real visits need days of
// calm history, which a preview doesn't have).
export type VisitorPreview = Pick<VisitorPresentation, 'mode' | 'spot'> & { action?: VisitorPresentation['action'] };
// A drey preview shows the nest in the crown at a stage (real dreys need weeks of a welcoming tree).
export type DreyPreview = DreyLook;
// A canopy preview shows the foliage after some weeks (real changes need weeks of history).
export type CanopyPreview = { fullness: number; refilling: number };
// A weather preview swaps only the outside weather layer (a sky, or 'windy' for a clear windy day).
export type WeatherPreview = OutsideSky | 'windy';

export function usePlantBehaviour(
  snapshot: LivingSnapshot | null,
  display: PlantHealthState | null,
  previewSeason: Season | null = null,
  latitude: number | null = null,
  previewVisitor: VisitorPreview | null = null,
  previewWeather: WeatherPreview | null = null,
  previewDrey: DreyPreview | null = null,
  previewCanopy: CanopyPreview | null = null
) {
  return useMemo<{ behaviour: PlantBehaviourState | null; expression: ExpressionState | null }>(() => {
    let r = evaluate(snapshot, display, previewSeason, latitude);
    if (previewVisitor && r.expression && r.behaviour) {
      const carrying = r.behaviour?.season.id === 'autumn' ? 'nut' : null;
      const play = visitorPlay(r.behaviour.primaryState, previewVisitor.mode, r.behaviour, r.expression.motion);
      const visitor: VisitorPresentation = {
        kind: 'squirrel',
        id: `preview:${previewVisitor.mode}:${previewVisitor.spot}:${previewVisitor.action ?? ''}`,
        ...previewVisitor,
        action: previewVisitor.action ?? null,
        carrying: previewVisitor.mode === 'sleeping' || previewVisitor.action ? null : carrying,
        play,
      };
      // Asleep means a drey to sleep in
      const drey = previewVisitor.mode === 'sleeping' ? 'built' : r.expression.drey;
      r = { behaviour: r.behaviour, expression: { ...r.expression, visitor, drey } };
    }
    if (previewCanopy && r.expression) {
      r = { behaviour: r.behaviour, expression: { ...r.expression, avatar: { ...r.expression.avatar, canopy: previewCanopy } } };
    }
    if (previewDrey && r.expression) {
      r = { behaviour: r.behaviour, expression: { ...r.expression, drey: previewDrey } };
    }
    if (previewWeather && r.expression) {
      const real = snapshot?.perception?.outside ?? null;
      const weather = weatherLook({
        at: Date.now(), ageMs: 0, code: 0, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: null,
        temperature: real?.temperature ?? null,
        sky: previewWeather === 'windy' ? 'clear' : previewWeather,
        windy: previewWeather === 'windy',
        rainEndedAt: null,
      });
      r = { behaviour: r.behaviour, expression: { ...r.expression, atmosphere: { ...r.expression.atmosphere, weather } } };
    }
    return r;
  }, [snapshot, display, previewSeason, latitude, previewVisitor, previewWeather, previewDrey, previewCanopy]);
}

function evaluate(snapshot: LivingSnapshot | null, display: PlantHealthState | null, previewSeason: Season | null, latitude: number | null) {
  {
    if (!snapshot || !display) return { behaviour: null, expression: null };
    if ((!display.isOverride && !previewSeason) || !snapshot.perception) return { behaviour: snapshot.behaviour, expression: snapshot.expression };
    const now = Date.now();
    const perception = previewSeason
      ? { ...snapshot.perception, season: midSeasonState(previewSeason, latitude) }
      : snapshot.perception;
    const behaviour = evaluateBehaviour({
      health: display,
      perception,
      episodes: [],
      events: [],
      species: ACTIVE_SPECIES,
      now,
    });
    return { behaviour, expression: expressBehaviour({ behaviour, health: display, perception, now }) };
  }
}
