import { useCallback, useMemo, useState } from 'react';
import { DEV_PRESETS } from '../health/developerOverrides';
import { SEASONS, type Season } from '../perception/season';
import { OUTSIDE_SKIES } from '../telemetry/outsideWeather';
import type { CanopyPreview, DragonflyPreview, DreyPreview, HikePreview, SlothPreview, TwilightPreview, VisitorPreview, WeatherPreview } from './usePlantBehaviour';

// Every developer preview in one place: what is previewed, how the URL hash starts one, the toast when one
// changes and the line Home shows while previewing. Previews only change what is shown; nothing is written.
export interface DevPreviews {
  preset: string | null; // a health preset (DEV_PRESETS id)
  season: Season | null;
  visitor: VisitorPreview | null;
  sloth: SlothPreview | null;
  dragonfly: DragonflyPreview | null;
  twilight: TwilightPreview | null;
  canopy: CanopyPreview | null;
  drey: DreyPreview | null;
  weather: WeatherPreview | null;
  hike: HikePreview | null; // the week's hike pick (announced, moved, or today with the boots)
}
export type SetPreview = <K extends keyof DevPreviews>(key: K, value: DevPreviews[K]) => void;

export const NO_PREVIEWS: DevPreviews = { preset: null, season: null, visitor: null, sloth: null, dragonfly: null, twilight: null, canopy: null, drey: null, weather: null, hike: null };

// The URL hash can start any combination, e.g. #preview=very_dry&season=winter&visitor=hiding:crown (handy for screenshots)
export function previewsFromHash(hash: string): DevPreviews {
  const m = (re: RegExp) => hash.match(re);
  return {
    // #preview=<preset id>
    preset: (() => {
      const r = m(/preview=([a-z_]+)/);
      return r && DEV_PRESETS.some((p) => p.id === r[1]) ? r[1] : null;
    })(),
    // #season=winter (only the perceived season changes)
    season: (() => {
      const r = m(/season=([a-z]+)/);
      return r && (SEASONS as string[]).includes(r[1]) ? (r[1] as Season) : null;
    })(),
    // #visitor=visiting or #visitor=hiding:crown puts the squirrel in the tree (presentation only);
    // #visitor=peek (a new squirrel peeking) and #visitor=traces / traces:tail (only its signs)
    visitor: (() => {
      const r = m(/visitor=(visiting|peek|hiding|sleeping|drinking|inspecting|shaking|traces)(?::(left_branch|right_branch|crown|trunk|pot_rim|tail))?/);
      if (!r) return null;
      if (r[1] === 'traces') return { mode: 'traces', spot: 'left_branch', traces: r[2] === 'tail' ? 'tail_at_pot' : 'nibbled_leaf' };
      if (r[2] === 'tail') return null;
      const spot = (r[2] ?? 'left_branch') as VisitorPreview['spot'];
      if (r[1] === 'drinking') return { mode: 'visiting', spot: 'pot_rim', action: 'drinking' };
      if (r[1] === 'inspecting') return { mode: 'visiting', spot: 'left_branch', action: 'inspecting' };
      if (r[1] === 'shaking') return { mode: 'visiting', spot, action: 'shake_off' };
      if (r[1] === 'sleeping') return { mode: 'sleeping', spot: 'crown' };
      return { mode: r[1] as VisitorPreview['mode'], spot };
    })(),
    // #sloth=hanging, #sloth=climbing:right_branch, #sloth=hanging:left_branch:one_arm or #sloth=sleeping
    sloth: (() => {
      const r = m(/sloth=(hanging|climbing|sleeping)(?::(left_branch|right_branch))?(?::(four|arms|legs|one_arm|two_legs_one_arm))?/);
      return r ? { pose: r[1] as SlothPreview['pose'], branch: (r[2] ?? 'left_branch') as SlothPreview['branch'], grip: r[3] as SlothPreview['grip'] } : null;
    })(),
    // #dragonfly=perched or #dragonfly=hovering:crown_tip
    dragonfly: (() => {
      const r = m(/dragonfly=(hovering|perched)(?::(left_tip|right_tip|crown_tip|left_top))?/);
      return r ? { presence: r[1] as DragonflyPreview['presence'], perch: (r[2] ?? 'right_tip') as DragonflyPreview['perch'] } : null;
    })(),
    // #twilight=sunrise-10 (10 min before) or #twilight=sunset+5
    twilight: (() => {
      const r = m(/twilight=(sunrise|sunset)([+-]\d+)?/);
      return r ? { event: r[1] as 'sunrise' | 'sunset', minutes: Number(r[2] ?? 0) } : null;
    })(),
    // #canopy=0.7 (fullness) or #canopy=refilling: the foliage after some weeks
    canopy: (() => {
      const r = m(/canopy=(refilling|0?\.\d+|1)/);
      if (!r) return null;
      return r[1] === 'refilling' ? { fullness: 0.72, refilling: 0.8 } : { fullness: Math.max(0.6, Math.min(1, Number(r[1]))), refilling: 0 };
    })(),
    // #drey=started or #drey=built: the nest in the crown
    drey: (() => {
      const r = m(/drey=(none|started|built)/);
      return r ? (r[1] as DreyPreview) : null;
    })(),
    // #weather=rain: the outside weather layer
    weather: (() => {
      const r = m(/weather=([a-z_]+)/);
      return r && (r[1] === 'windy' || (OUTSIDE_SKIES as string[]).includes(r[1])) ? (r[1] as WeatherPreview) : null;
    })(),
    // #hike=today (the boots by the pot), #hike=announced or #hike=moved
    hike: (() => {
      const r = m(/hike=(today|announced|moved)/);
      return r ? (r[1] as HikePreview) : null;
    })(),
  };
}

// The toast when a preview is set or cleared (twilight has none: the play button steps it many times)
const toastFor = <K extends keyof DevPreviews>(key: K, v: DevPreviews[K]): string | null => {
  switch (key) {
    case 'preset': {
      const preset = DEV_PRESETS.find((p) => p.id === v);
      return preset ? `Previewing “${preset.label}”` : 'Back to live data';
    }
    case 'season':
      return v ? `Previewing ${v}` : 'Back to the real season';
    case 'visitor': {
      const x = v as VisitorPreview | null;
      return x ? `Squirrel ${x.mode} (${x.spot.replace('_', ' ')})` : 'Back to real visitors';
    }
    case 'sloth':
      return v ? `Sloth ${(v as SlothPreview).pose}` : 'Back to real sloths';
    case 'dragonfly':
      return v ? `Dragonfly ${(v as DragonflyPreview).presence}` : 'Back to real dragonflies';
    case 'canopy': {
      const c = v as CanopyPreview | null;
      return c ? `Canopy ${Math.round(c.fullness * 100)}%${c.refilling ? ', refilling' : ''}` : 'Back to the real canopy';
    }
    case 'drey':
      return v ? `Drey: ${v}` : 'Back to the real drey';
    case 'weather':
      return v ? `Outside: ${(v as string).replace('_', ' ')}` : 'Back to the real weather';
    case 'hike':
      return v ? (v === 'today' ? 'Hike day: boots out' : `Hike ${v}`) : 'Back to the real hike plan';
    default:
      return null;
  }
};

// What Home shows while previewing, e.g. "Thirsty · Winter season · Squirrel visiting"
function labelOf(p: DevPreviews): string | null {
  const preset = DEV_PRESETS.find((x) => x.id === p.preset) ?? null;
  return (
    [
      preset?.label,
      p.season && `${p.season[0].toUpperCase()}${p.season.slice(1)} season`,
      p.visitor && `Squirrel ${p.visitor.action ?? p.visitor.mode}`,
      p.drey && `Drey ${p.drey}`,
      p.dragonfly && `Dragonfly ${p.dragonfly.presence}`,
      p.sloth && `Sloth ${p.sloth.pose}`,
      p.canopy && `Canopy ${Math.round(p.canopy.fullness * 100)}%${p.canopy.refilling ? ' refilling' : ''}`,
      p.twilight && `${p.twilight.event === 'sunrise' ? 'Sunrise' : 'Sunset'} ${p.twilight.minutes >= 0 ? '+' : ''}${p.twilight.minutes} min`,
      p.weather && `Outside: ${p.weather.replace('_', ' ')}`,
      p.hike && (p.hike === 'today' ? 'Hike day' : `Hike ${p.hike}`),
    ]
      .filter(Boolean)
      .join(' · ') || null
  );
}

export function useDevPreviews(notify: (text: string) => void) {
  const [previews, setPreviews] = useState<DevPreviews>(() => (typeof window !== 'undefined' ? previewsFromHash(window.location.hash) : NO_PREVIEWS));

  const setPreview: SetPreview = useCallback(
    (key, value) => {
      setPreviews((p) => ({ ...p, [key]: value }));
      const toast = toastFor(key, value);
      if (toast) notify(toast);
    },
    [notify]
  );

  const clearAll = useCallback(() => {
    setPreviews(NO_PREVIEWS);
    notify('Back to live data');
  }, [notify]);

  const previewing = useMemo(() => Object.values(previews).some((v) => v !== null), [previews]);
  const label = useMemo(() => labelOf(previews), [previews]);

  return { previews, setPreview, clearAll, previewing, label };
}
