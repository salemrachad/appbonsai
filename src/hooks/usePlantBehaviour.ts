import { useMemo } from 'react';
import type { LivingSnapshot } from '../api/types';
import { evaluateBehaviour } from '../behaviour/BehaviourEngine';
import type { PlantBehaviourState } from '../behaviour/behaviourTypes';
import { expressBehaviour } from '../expression/ExpressionEngine';
import { encounterCues, visitorPlay, weatherLook } from '../expression/ExpressionEngine';
import type { DreyLook, ExpressionState, SlothPresentation, VisitorPresentation } from '../expression/expressionTypes';
import { meet } from '../behaviour/encounters';
import { dragonflyRoute } from '../behaviour/dragonfly';
import { APP_CONFIG } from '../config/appConfig';
import type { OutsideSky } from '../telemetry/outsideWeather';
import type { PlantHealthState } from '../health/healthTypes';
import { midSeasonState, type Season } from '../perception/season';
import { ACTIVE_SPECIES } from '../species';
import type { DevPreviews } from './useDevPreviews';

// Live behaviour + expression come from the server. A developer preview re-runs the same engines
// in the browser on the overridden health, without history or care events (so a real watering
// minutes ago doesn't mask the previewed state). Nothing is written anywhere.
// A season preview swaps only the perceived season (as on its middle day), the rest stays as perceived.
// A visitor preview puts the squirrel in the tree on top of whatever is shown (real visits need days of
// calm history, which a preview doesn't have).
// mode 'traces': no squirrel yet, only its signs (a nibbled leaf, a tail by the pot); 'peek': a new squirrel peeking.
export type VisitorPreview = { mode: VisitorPresentation['mode'] | 'traces'; spot: VisitorPresentation['spot']; action?: VisitorPresentation['action']; traces?: NonNullable<ExpressionState['squirrelTraces']> };
// A drey preview shows the nest in the crown at a stage (real dreys need weeks of a welcoming tree).
export type DreyPreview = DreyLook;
// A canopy preview shows the foliage after some weeks (real changes need weeks of history).
export type CanopyPreview = { fullness: number; refilling: number };
// A twilight preview places "now" this many minutes from today's sunrise or sunset (behaviour responds too).
export type TwilightPreview = { event: 'sunrise' | 'sunset'; minutes: number };
// A dragonfly preview puts it on a leaf tip or hovering (real visits need warm, bright, calm air).
// A sloth preview hangs it on a branch (real visits need warm, humid, still air).
export type SlothPreview = { pose: 'hanging' | 'climbing' | 'sleeping'; branch: 'left_branch' | 'right_branch'; grip?: SlothPresentation['grip'] };
// Visitors previewed together (or with live ones) meet, arranged by the same encounter rules as the server.
export type DragonflyPreview = { presence: 'hovering' | 'perched'; perch: 'left_tip' | 'right_tip' | 'crown_tip' | 'left_top' };
// A weather preview swaps only the outside weather layer (a sky, or 'windy' for a clear windy day).
export type WeatherPreview = OutsideSky | 'windy';

export function usePlantBehaviour(snapshot: LivingSnapshot | null, display: PlantHealthState | null, previews: DevPreviews, latitude: number | null = null) {
  const { season: previewSeason, visitor: previewVisitor, weather: previewWeather, drey: previewDrey, canopy: previewCanopy, twilight: previewTwilight, dragonfly: previewDragonfly, sloth: previewSloth } = previews;
  return useMemo<{ behaviour: PlantBehaviourState | null; expression: ExpressionState | null }>(() => {
    let r = evaluate(snapshot, display, previewSeason, latitude, previewTwilight);
    if (previewVisitor?.mode === 'traces' && r.expression) {
      r = { behaviour: r.behaviour, expression: { ...r.expression, visitor: null, squirrelTraces: previewVisitor.traces ?? 'nibbled_leaf' } };
    } else if (previewVisitor && previewVisitor.mode !== 'traces' && r.expression && r.behaviour) {
      const mode = previewVisitor.mode;
      const carrying = r.behaviour?.season.id === 'autumn' ? 'nut' : null;
      const play = visitorPlay(r.behaviour.primaryState, mode, r.behaviour, r.expression.motion);
      const visitor: VisitorPresentation = {
        kind: 'squirrel',
        id: `preview:${mode}:${previewVisitor.spot}:${previewVisitor.action ?? ''}`,
        mode,
        spot: previewVisitor.spot,
        action: previewVisitor.action ?? null,
        carrying: mode === 'sleeping' || previewVisitor.action ? null : carrying,
        play,
      };
      // Asleep means a drey to sleep in
      const drey = mode === 'sleeping' ? 'built' : r.expression.drey;
      r = { behaviour: r.behaviour, expression: { ...r.expression, visitor, drey, squirrelTraces: null } };
    }
    if (previewSloth && r.expression) {
      const grip = previewSloth.pose === 'hanging' ? previewSloth.grip ?? 'arms' : 'four';
      r = { behaviour: r.behaviour, expression: { ...r.expression, sloth: { id: `preview:${previewSloth.pose}:${previewSloth.branch}:${grip}`, ...previewSloth, grip, tempo: 0.55 } } };
    }
    if (previewDragonfly && r.expression) {
      // A preview visit runs through the current hour (and the next), on its own route
      const id = `preview:${previewDragonfly.presence}:${previewDragonfly.perch}`;
      const startedAt = new Date().setMinutes(0, 0, 0);
      const visit = { id, startedAt, endsAt: startedAt + 2 * 3600 * 1000, style: previewDragonfly.presence };
      const route = dragonflyRoute(visit, { home: previewDragonfly.perch, liveliness: 0.5 });
      r = { behaviour: r.behaviour, expression: { ...r.expression, dragonfly: { id, ...previewDragonfly, wingTempo: 1, route, flightMs: APP_CONFIG.habitat.dragonfly.route.flightMs } } };
    }
    if ((previewVisitor || previewSloth || previewDragonfly) && r.expression) {
      // Re-arrange with the previewed cast (the live arrangement didn't know about them)
      const x = r.expression;
      const v = x.visitor;
      const m = meet({
        squirrel: v ? { id: v.id, spot: v.spot, mode: v.mode === 'peek' ? 'hiding' : v.mode, fixed: !!v.action } : null,
        dragonfly: x.dragonfly ? { id: x.dragonfly.id, perch: x.dragonfly.perch === 'on_sloth' ? 'left_tip' : x.dragonfly.perch, perched: x.dragonfly.presence === 'perched' } : null,
        sloth: x.sloth ? { id: x.sloth.id, branch: x.sloth.branch, asleep: x.sloth.pose === 'sleeping' } : null,
      });
      const cast = encounterCues(
        {
          visitor: v && m.squirrelSpot ? { ...v, spot: m.squirrelSpot, lookAt: null, avoid: [] } : v,
          dragonfly:
            x.dragonfly && m.dragonflyPerch
              ? {
                  ...x.dragonfly,
                  perch: m.dragonflyPerch,
                  route: dragonflyRoute({ id: x.dragonfly.id, startedAt: x.dragonfly.route[0]?.at ?? Date.now(), endsAt: (x.dragonfly.route[0]?.at ?? Date.now()) + 2 * 3600 * 1000, style: x.dragonfly.presence }, { home: m.dragonflyPerch, avoid: m.dragonflyAvoid, liveliness: 0.5 }),
                }
              : x.dragonfly,
          sloth: x.sloth && m.slothBranch ? { ...x.sloth, branch: m.slothBranch, lookAt: null, rider: false } : x.sloth,
        },
        m.encounters
      );
      r = { behaviour: r.behaviour, expression: { ...x, ...cast, encounters: m.encounters } };
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
      const muted = ['overcast', 'fog', 'drizzle', 'rain', 'heavy_rain', 'thunderstorm', 'snow'].includes(previewWeather);
      const twilight = { ...r.expression.atmosphere.twilight, muted };
      r = { behaviour: r.behaviour, expression: { ...r.expression, atmosphere: { ...r.expression.atmosphere, weather, twilight } } };
    }
    return r;
  }, [snapshot, display, previewSeason, latitude, previewVisitor, previewWeather, previewDrey, previewCanopy, previewTwilight, previewDragonfly, previewSloth]);
}

function evaluate(snapshot: LivingSnapshot | null, display: PlantHealthState | null, previewSeason: Season | null, latitude: number | null, previewTwilight: TwilightPreview | null = null) {
  {
    if (!snapshot || !display) return { behaviour: null, expression: null };
    if ((!display.isOverride && !previewSeason && !previewTwilight) || !snapshot.perception) return { behaviour: snapshot.behaviour, expression: snapshot.expression };
    const now = Date.now();
    let perception = previewSeason
      ? { ...snapshot.perception, season: midSeasonState(previewSeason, latitude) }
      : snapshot.perception;
    if (previewTwilight) {
      // Today's moment placed `minutes` from now; the sun is up after sunrise and before sunset
      const at = now - previewTwilight.minutes * 60000;
      const up = previewTwilight.event === 'sunrise' ? previewTwilight.minutes >= 0 : previewTwilight.minutes <= 0;
      perception = {
        ...perception,
        sun: { ...perception.sun, [previewTwilight.event]: at, isDay: up, phase: up ? 'low_sun' : previewTwilight.event === 'sunrise' ? 'dawn' : 'dusk' },
      };
    }
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
