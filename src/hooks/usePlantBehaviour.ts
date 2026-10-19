import { useMemo } from 'react';
import type { LivingSnapshot } from '../api/types';
import { evaluateBehaviour } from '../behaviour/BehaviourEngine';
import type { DreamMotif, PlantBehaviourState } from '../behaviour/behaviourTypes';
import { expressBehaviour } from '../expression/ExpressionEngine';
import { encounterCues, lucyPresentation, visitorPlay, weatherLook, withLucyInterest } from '../expression/ExpressionEngine';
import { lucyRoute } from '../behaviour/lucy';
import type { DreyLook, ExpressionState, LucyPresentation, SlothPresentation, VisitorPresentation } from '../expression/expressionTypes';
import { meet } from '../behaviour/encounters';
import { dragonflyRoute } from '../behaviour/dragonfly';
import { APP_CONFIG } from '../config/appConfig';
import type { OutsideSky } from '../telemetry/outsideWeather';
import type { HikeForecast, HourForecast } from '../telemetry/hikeForecast';
import { addDays, chooseHikeDay, withHikeDefaults, dateKey, INITIAL_HIKE_MEMORY, planHike, weekOf, type HikeMemory, type HikePlan } from '../behaviour/hike';
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
// A Lucy preview puts her on the floor in a pose (her real day follows the household clock and the weather).
export type LucyPreview = { pose: LucyPresentation['pose']; spot: LucyPresentation['spot']; cue?: NonNullable<LucyPresentation['cue']> };
// Visitors previewed together (or with live ones) meet, arranged by the same encounter rules as the server.
export type DragonflyPreview = { presence: 'hovering' | 'perched'; perch: 'left_tip' | 'right_tip' | 'crown_tip' | 'left_top' };
// A weather preview swaps only the outside weather layer (a sky, or 'windy' for a clear windy day).
export type WeatherPreview = OutsideSky | 'windy' | 'hazy';
// A hike preview runs the real planner on a sample forecast: a day picked later this week, a pick the
// forecast moved, or today as hike day (the boots by the pot). Behaviour responds too (the announcement).
export type HikePreview = 'announced' | 'moved' | 'today';
// A dream preview shows the image of one motif drifting by the crown (real dreams need a night and a day
// lived before it); restless: as when asleep under a stress.
export type DreamPreview = { motif: DreamMotif; with?: DreamMotif | null; restless: boolean };

export function usePlantBehaviour(snapshot: LivingSnapshot | null, display: PlantHealthState | null, previews: DevPreviews, latitude: number | null = null) {
  const { season: previewSeason, visitor: previewVisitor, weather: previewWeather, drey: previewDrey, canopy: previewCanopy, twilight: previewTwilight, dragonfly: previewDragonfly, sloth: previewSloth, lucy: previewLucy, hike: previewHike, hikeChoice: previewHikeChoice, dream: previewDream } = previews;
  return useMemo<{ behaviour: PlantBehaviourState | null; expression: ExpressionState | null }>(() => {
    let r = evaluate(snapshot, display, previewSeason, latitude, previewTwilight, previewHike, previewHikeChoice);
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
    if (previewLucy && r.expression) {
      // Settled for a while (walking: she walks in now)
      const startedAt = previewLucy.pose === 'walking' ? Date.now() : Date.now() - 10 * 60 * 1000;
      const id = `preview:lucy:${previewLucy.pose}:${previewLucy.spot}:${previewLucy.cue ?? ''}`;
      const visit = { id, kind: 'day' as const, startedAt, endsAt: startedAt + 2 * 3600 * 1000 };
      // Walking: a real, lively route (up and about for a long while); otherwise she stays put in the pose,
      // her look moving between you, the tree and around
      const act = ({ walking: 'sniff', sitting: 'sit', down: 'down', sleeping: 'sleep' } as const)[previewLucy.pose];
      const looks = previewLucy.pose === 'down' ? (['user', 'tree'] as const) : (['user', 'tree', 'around'] as const);
      const route =
        previewLucy.pose === 'walking'
          ? lucyRoute(visit, { settle: 0, rest: previewLucy.spot, awake: true, close: previewLucy.cue === 'concern' || previewLucy.cue === 'storm' })
          : act === 'sleep'
          ? [{ at: startedAt, spot: previewLucy.spot, act, look: 'user' as const }]
          : Array.from({ length: 480 }, (_, i) => ({ at: startedAt + i * 15_000, spot: previewLucy.spot, act, look: looks[i % looks.length] }));
      const lucy = lucyPresentation({ ...visit, pose: previewLucy.pose, spot: previewLucy.spot, rest: previewLucy.spot, route, cue: previewLucy.cue ?? null });
      r = { behaviour: r.behaviour, expression: { ...r.expression, lucy } };
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
        lucy: x.lucy ? { id: x.lucy.id, awake: x.lucy.pose !== 'sleeping' } : null, // previews know no history: it only watches her
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
    if ((previewLucy || previewVisitor || previewDragonfly || previewSloth) && r.expression?.lucy) {
      // Lucy looks up at a previewed visitor by the same rule
      const x = r.expression;
      r = { behaviour: r.behaviour, expression: { ...x, lucy: withLucyInterest(x.lucy ?? null, x.visitor, x.dragonfly, x.sloth) } };
    }
    if (previewCanopy && r.expression) {
      r = { behaviour: r.behaviour, expression: { ...r.expression, avatar: { ...r.expression.avatar, canopy: previewCanopy } } };
    }
    if (previewDream && r.expression) {
      const x = r.expression;
      const dream = { key: `preview:${previewDream.motif}:${previewDream.with ?? ''}:${previewDream.restless}`, phase: 'dreaming' as const, motif: previewDream.motif, with: previewDream.with ?? null, restless: previewDream.restless, endsAt: null };
      const running = [previewDream.motif, previewDream.with].some((m) => m === 'lucy' || m === 'squirrel' || m === 'drey');
      r = { behaviour: r.behaviour, expression: { ...x, dream, lucy: x.lucy && x.lucy.pose === 'sleeping' ? { ...x.lucy, dreamSync: running ? 'running' : 'with_tree' } : x.lucy } };
    }
    if (previewDrey && r.expression) {
      r = { behaviour: r.behaviour, expression: { ...r.expression, drey: previewDrey } };
    }
    if (previewWeather && r.expression) {
      const real = snapshot?.perception?.outside ?? null;
      const weather = weatherLook({
        at: Date.now(), ageMs: 0, code: 0, humidity: null, precipitation: null, cloudCover: null, wind: null, gusts: null, isDay: null,
        temperature: real?.temperature ?? null,
        sky: previewWeather === 'windy' || previewWeather === 'hazy' ? 'clear' : previewWeather,
        windy: previewWeather === 'windy',
        rainEndedAt: null,
        ...(previewWeather === 'hazy' && { air: { aqi: 90, pm25: 55, pm10: 120, band: 'very_poor' as const } }),
      });
      const muted = ['overcast', 'fog', 'drizzle', 'rain', 'heavy_rain', 'thunderstorm', 'snow'].includes(previewWeather);
      const twilight = { ...r.expression.atmosphere.twilight, muted };
      r = { behaviour: r.behaviour, expression: { ...r.expression, atmosphere: { ...r.expression.atmosphere, weather, twilight } } };
    }
    return r;
  }, [snapshot, display, previewSeason, latitude, previewVisitor, previewWeather, previewDrey, previewCanopy, previewTwilight, previewDragonfly, previewSloth, previewLucy, previewHike, previewHikeChoice, previewDream]);
}

function evaluate(snapshot: LivingSnapshot | null, display: PlantHealthState | null, previewSeason: Season | null, latitude: number | null, previewTwilight: TwilightPreview | null = null, previewHike: HikePreview | null = null, previewHikeChoice: string | null = null) {
  {
    if (!snapshot || !display) return { behaviour: null, expression: null };
    if ((!display.isOverride && !previewSeason && !previewTwilight && !previewHike) || !snapshot.perception) return { behaviour: snapshot.behaviour, expression: snapshot.expression };
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
      // The live pick stays, unless a hike is previewed
      hike: previewHike ? sampleHikePlan(previewHike, now, previewHikeChoice) : withHikeDefaults(snapshot.behaviour?.hike) ?? null,
    });
    return { behaviour, expression: expressBehaviour({ behaviour, health: display, perception, now }) };
  }
}

// A sample day hour by hour: warming from the morning low to the afternoon high; the fine day turns showery
// from mid-afternoon (so the best hours are the morning and the tree warns about the rain)
const sampleHours = (low: number, high: number, sky: HourForecast['sky'], code: number, rain: number, showersFrom: number | null): HourForecast[] =>
  Array.from({ length: 24 }, (_, hour) => {
    const warm = Math.max(0, Math.sin(((hour - 6) / 16) * Math.PI));
    const showers = showersFrom !== null && hour >= showersFrom && hour < 20;
    return { hour, code: showers ? 80 : code, sky: showers ? 'rain' : sky, temp: Math.round((low + (high - low) * warm) * 10) / 10, rainChance: showers ? 60 : rain, rainMm: showers ? 0.8 : 0, gusts: 20, uv: hour >= 10 && hour <= 14 ? 5 : 2 };
  });

// The real planner on a sample two weeks: a plain fair forecast with one fine day and a decent second one
// (moved: first another fine day). Late in the week there may be no later day left: then this week's hike is
// already behind us (yesterday) and the preview shows next week's pick. `chosen`: a day clicked on the
// calendar while previewing (the people's choice, applied like the collector does).
export function sampleHikePlan(kind: HikePreview, now: number, chosen: string | null = null): HikePlan | null {
  const today = dateKey(now);
  const monday = weekOf(today);
  const left = 6 - Math.round((new Date(`${today}T12:00`).getTime() - new Date(`${monday}T12:00`).getTime()) / 86400000); // days after today this week
  const forecast = (fine: string): HikeForecast => {
    const sunday = addDays(weekOf(fine), 6);
    const second = sunday === fine ? addDays(sunday, -1) : sunday;
    return {
      fetchedAt: now,
      days: Array.from({ length: 14 }, (_, i) => {
        const date = addDays(monday, i);
        const light = { sunrise: '06:20', sunset: '17:35' };
        return date === fine
          ? { date, code: 1, sky: 'clear', tMax: 22, tMin: 13, rainChance: 5, rainMm: 0, gustsMax: 18, ...light, hours: sampleHours(13, 22, 'clear', 1, 5, 15) }
          : date === second
          ? { date, code: 2, sky: 'partly_cloudy', tMax: 20, tMin: 12, rainChance: 20, rainMm: 0, gustsMax: 25, ...light, hours: sampleHours(12, 20, 'partly_cloudy', 2, 15, null) }
          : { date, code: 3, sky: 'overcast', tMax: 18, tMin: 12, rainChance: 40, rainMm: 0.6, gustsMax: 30, ...light, hours: sampleHours(12, 18, 'overcast', 3, 40, null) };
      }),
    };
  };
  const withChoice = (r: { plan: HikePlan | null; memory: HikeMemory }) => {
    const m = chosen ? chooseHikeDay(r.memory, chosen, now) : null;
    return m ? planHike(m, now).plan : r.plan;
  };
  if (kind === 'today') return withChoice(planHike({ ...INITIAL_HIKE_MEMORY, forecast: forecast(today) }, now));
  const need = kind === 'moved' ? 2 : 1;
  const nextWeek = left < need;
  const memory: HikeMemory = nextWeek ? { ...INITIAL_HIKE_MEMORY, weeks: { [monday]: { day: addDays(today, -1), movedFrom: null, locked: true } } } : INITIAL_HIKE_MEMORY;
  const base = nextWeek ? addDays(monday, 7) : today;
  if (kind === 'announced') return withChoice(planHike({ ...memory, forecast: forecast(addDays(base, nextWeek ? 2 : Math.min(left, 2))) }, now));
  const first = planHike({ ...memory, forecast: forecast(addDays(base, nextWeek ? 4 : left)) }, now).memory;
  return withChoice(planHike({ ...first, forecast: forecast(addDays(base, 1)) }, now));
}
