import React, { useEffect, useMemo, useState } from 'react';
import type { SceneId, WeatherLook } from '../../expression/expressionTypes';
import type { OutsideSky } from '../../telemetry/outsideWeather';
import { TwilightSky } from './TwilightSky';
import type { Season } from '../../perception/season';

// The whole screen's backdrop for the tree's state, like night always did: gradient + ambient motion.
// Decided by the Expression Engine (atmosphere.scene); this only draws it. Scenes cross-fade.

interface SceneBackdropProps {
  scene: SceneId;
  season: Season;
  intensity: number; // 0-1: how strongly the scene shows
  weather?: WeatherLook | null; // outside weather: its own layer, on top of the state scene, behind the tree
  twilight?: { event: 'sunrise' | 'sunset' | null; minutes: number | null; at: number; muted: boolean } | null; // the sun's real moments
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ParticleSpec {
  kind: string; // CSS class suffix: .p-<kind>
  count: number;
  dur: [number, number]; // seconds
  size: [number, number]; // px
  top?: [number, number]; // % range (default 0-100)
  left?: [number, number];
  colors?: string[];
}

// Ambient particles per scene. Calm states take on the season instead.
const SEASON_PARTICLES: Record<Season, ParticleSpec[]> = {
  spring: [{ kind: 'petal', count: 12, dur: [12, 20], size: [6, 10], top: [-10, 0], colors: ['#F7C6D3', '#FBE1E8', '#F2B5C8'] }],
  summer: [{ kind: 'mote', count: 14, dur: [9, 16], size: [3, 5], top: [40, 100], colors: ['#F6D77A', '#FFF0B8'] }],
  autumn: [{ kind: 'leaf', count: 9, dur: [13, 22], size: [10, 15], top: [-10, 0], colors: ['#D98E3A', '#C2662D', '#E0B44C', '#9C5B2E'] }],
  winter: [{ kind: 'mote', count: 10, dur: [14, 22], size: [2, 4], top: [30, 100], colors: ['#FFFFFF', '#DCEAF4'] }],
};

const SCENE_PARTICLES: Partial<Record<SceneId, ParticleSpec[]>> = {
  golden: [
    { kind: 'ray', count: 4, dur: [9, 14], size: [120, 200], top: [-30, -20], left: [5, 45] },
    { kind: 'mote', count: 18, dur: [8, 14], size: [3, 6], top: [30, 100], colors: ['#FFD976', '#FFF3C4', '#F7C948'] },
  ],
  parched: [{ kind: 'dust', count: 14, dur: [10, 18], size: [3, 6], top: [35, 95], colors: ['#C9A878', '#D8BE93'] }],
  drought: [
    { kind: 'dust', count: 22, dur: [7, 13], size: [3, 7], top: [30, 95], colors: ['#B88F5A', '#CDAA78', '#A57B48'] },
    { kind: 'leaf', count: 3, dur: [14, 20], size: [12, 15], top: [-10, 0], colors: ['#A4794A', '#8E6232'] },
  ],
  scorching: [{ kind: 'haze', count: 8, dur: [3.5, 6], size: [60, 120], top: [55, 100], colors: ['rgba(255,170,110,0.5)'] }],
  sodden: [
    { kind: 'rain', count: 55, dur: [0.7, 1.2], size: [14, 26], top: [-20, -5], colors: ['rgba(90,130,170,0.45)'] },
    { kind: 'ripple', count: 6, dur: [2.4, 3.6], size: [30, 50], top: [86, 97], colors: ['rgba(90,130,170,0.5)'] },
  ],
  chill: [{ kind: 'snow', count: 30, dur: [10, 18], size: [3, 6], top: [-10, 0], colors: ['#FFFFFF'] }],
  frozen: [
    { kind: 'snow', count: 55, dur: [6, 11], size: [3, 7], top: [-10, 0], colors: ['#FFFFFF', '#EAF4FB'] },
    { kind: 'crystal', count: 6, dur: [6, 10], size: [10, 18], colors: ['#FFFFFF'] },
  ],
  dim: [{ kind: 'cloud', count: 4, dur: [60, 90], size: [320, 520], top: [-25, 10], colors: ['rgba(10,14,22,0.28)'] }],
  night: [
    { kind: 'star', count: 60, dur: [2.5, 6], size: [1, 3], top: [0, 70], colors: ['#FFFFFF', '#FFF4D6', '#DCE6FF'] },
    { kind: 'firefly', count: 8, dur: [9, 15], size: [3, 5], top: [55, 95], colors: ['#FFF09A'] },
  ],
  glare: [
    { kind: 'flare', count: 5, dur: [8, 14], size: [40, 110], top: [5, 70], left: [30, 95], colors: ['rgba(255,240,180,0.35)', 'rgba(255,255,255,0.4)'] },
  ],
  windy: [
    { kind: 'streak', count: 12, dur: [2.2, 4], size: [80, 180], left: [-30, -10], colors: ['rgba(160,140,110,0.35)'] },
    { kind: 'blown', count: 5, dur: [4, 7], size: [9, 13], left: [-15, -5], top: [20, 85], colors: ['#B9A27A', '#9DAA7A'] },
  ],
  fog: [{ kind: 'fog', count: 6, dur: [40, 70], size: [500, 900], top: [10, 90], left: [-40, 40], colors: ['rgba(255,255,255,0.55)'] }],
  renewal: [{ kind: 'rise', count: 16, dur: [9, 15], size: [3, 6], top: [70, 105], colors: ['#CFEFB9', '#FFFFFF', '#A9DC8E'] }],
  storm: [
    { kind: 'cloud', count: 4, dur: [45, 70], size: [360, 560], top: [-20, 15], colors: ['rgba(70,60,85,0.35)'] },
    { kind: 'rain', count: 24, dur: [1, 1.6], size: [12, 20], top: [-20, -5], colors: ['rgba(90,80,110,0.35)'] },
  ],
};

export const Particles: React.FC<{ spec: ParticleSpec; seed: number }> = ({ spec, seed }) => {
  const items = useMemo(() => {
    const r = rng(seed);
    const pick = (range: [number, number]) => range[0] + r() * (range[1] - range[0]);
    return Array.from({ length: spec.count }, () => ({
      left: pick(spec.left ?? [0, 100]),
      top: pick(spec.top ?? [0, 100]),
      size: pick(spec.size),
      dur: pick(spec.dur),
      delay: -r() * pick(spec.dur),
      color: spec.colors ? spec.colors[Math.floor(r() * spec.colors.length)] : undefined,
      drift: (r() - 0.5) * 2,
    }));
  }, [spec, seed]);
  return (
    <>
      {items.map((p, i) => (
        <span
          key={i}
          className={`particle p-${spec.kind}`}
          style={
            {
              left: `${p.left}%`,
              top: `${p.top}%`,
              '--size': `${p.size}px`,
              '--drift': p.drift,
              '--c': p.color,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </>
  );
}

const Layer: React.FC<{ scene: SceneId; season: Season; visible: boolean }> = ({ scene, season, visible }) => {
  const specs = scene === 'calm' ? SEASON_PARTICLES[season] : SCENE_PARTICLES[scene] ?? [];
  return (
    <div className={`scene-layer backdrop-${scene} season-${season}`} style={{ opacity: visible ? 1 : 0 }}>
      {scene === 'drought' && <div className="scene-cracks" />}
      {scene === 'scorching' && <div className="scene-sun" />}
      {scene === 'night' && <div className="scene-moon" />}
      {(scene === 'chill' || scene === 'frozen') && <div className="scene-frost" />}
      {scene === 'storm' && <div className="scene-lightning" />}
      {scene === 'static' && <div className="scene-scanlines" />}
      {scene === 'glare' && <div className="scene-bloom" />}
      {specs.map((s, i) => (
        <Particles key={`${scene}-${season}-${i}`} spec={s} seed={(scene.length * 131 + i * 17) ^ season.length} />
      ))}
    </div>
  );
}

// Outside weather (atmosphere.weather): a layer of its own over the tree's state scene. The tree is in a
// greenhouse, so this is the world outside it; the tree's look never changes for it. Counts scale with intensity.
const WEATHER_PARTICLES: Record<OutsideSky, ParticleSpec[]> = {
  clear: [],
  partly_cloudy: [{ kind: 'cloud', count: 3, dur: [70, 110], size: [260, 420], top: [-20, 5], colors: ['rgba(255,255,255,0.55)'] }],
  overcast: [{ kind: 'cloud', count: 5, dur: [60, 95], size: [360, 560], top: [-25, 10], colors: ['rgba(120,128,140,0.22)'] }],
  fog: [{ kind: 'fog', count: 9, dur: [40, 70], size: [600, 1000], top: [5, 95], left: [-40, 40], colors: ['rgba(255,255,255,0.75)', 'rgba(236,240,244,0.8)'] }],
  drizzle: [{ kind: 'rain', count: 40, dur: [1.1, 1.7], size: [12, 18], top: [-20, -5], colors: ['rgba(85,125,170,0.7)'] }],
  rain: [
    { kind: 'cloud', count: 3, dur: [60, 90], size: [360, 520], top: [-25, 5], colors: ['rgba(100,110,125,0.22)'] },
    { kind: 'rain', count: 80, dur: [0.75, 1.2], size: [22, 36], top: [-20, -5], colors: ['rgba(70,110,160,0.85)', 'rgba(95,135,185,0.8)'] },
  ],
  heavy_rain: [
    { kind: 'cloud', count: 4, dur: [50, 80], size: [380, 560], top: [-25, 5], colors: ['rgba(80,88,104,0.3)'] },
    { kind: 'rain', count: 120, dur: [0.55, 0.9], size: [28, 44], top: [-20, -5], colors: ['rgba(65,105,155,0.9)', 'rgba(90,130,180,0.85)'] },
  ],
  snow: [
    // Far away: many tiny soft flakes, slow (subtle depth)
    { kind: 'snowfar', count: 140, dur: [14, 24], size: [2, 4], top: [-10, 0], colors: ['rgba(255,255,255,0.85)', 'rgba(236,243,250,0.8)'] },
    { kind: 'snow', count: 80, dur: [9, 16], size: [4, 9], top: [-10, 0], colors: ['#FFFFFF', '#F2F7FC'] },
  ],
  thunderstorm: [
    { kind: 'cloud', count: 5, dur: [40, 65], size: [380, 580], top: [-25, 10], colors: ['rgba(60,55,75,0.38)'] },
    { kind: 'rain', count: 100, dur: [0.6, 1], size: [26, 42], top: [-20, -5], colors: ['rgba(95,100,145,0.9)', 'rgba(120,128,170,0.85)'] },
  ],
};
const WINDY: ParticleSpec = { kind: 'streak', count: 12, dur: [2.4, 4.2], size: [90, 190], left: [-30, -10], colors: ['rgba(130,135,145,0.5)'] };

const WeatherLayer: React.FC<{ weather: WeatherLook }> = ({ weather }) => {
  const scale = 0.5 + 0.5 * weather.intensity;
  const specs = [...WEATHER_PARTICLES[weather.sky], ...(weather.windy ? [WINDY] : [])].map((s) =>
    s.kind === 'cloud' || s.kind === 'fog' ? s : { ...s, count: Math.max(1, Math.round(s.count * scale)) }
  );
  return (
    <div className={`weather-layer weather-${weather.sky}${weather.windy ? ' weather-windy' : ''}`} style={{ '--weather-intensity': weather.intensity } as React.CSSProperties}>
      <div className="weather-tint" />
      {weather.sky === 'thunderstorm' && <div className="scene-lightning weather-lightning" />}
      {weather.sky === 'snow' && <div className="weather-snow-ground" />}
      {specs.map((s, i) => (
        <Particles key={`${weather.sky}-${i}`} spec={s} seed={weather.sky.length * 977 + i * 31} />
      ))}
    </div>
  );
};

const FADE_MS = 1600;

const SceneBackdropView: React.FC<SceneBackdropProps> = ({ scene, season, intensity, weather = null, twilight = null }) => {
  // Keep the previous scene for a moment so the new one fades in over it
  const [layers, setLayers] = useState<{ key: string; scene: SceneId; season: Season; visible: boolean }[]>([
    { key: `${scene}-${season}`, scene, season, visible: true },
  ]);
  useEffect(() => {
    const key = `${scene}-${season}`;
    setLayers((prev) => {
      if (prev[prev.length - 1]?.key === key) return prev;
      return [...prev.slice(-1).map((l) => ({ ...l, visible: true })), { key, scene, season, visible: false }];
    });
    // Mount invisible first, then fade in (one paint later, so the transition runs)
    const show = setTimeout(() => setLayers((prev) => prev.map((l) => (l.key === key ? { ...l, visible: true } : l))), 50);
    const t = setTimeout(() => setLayers((prev) => prev.filter((l) => l.key === key)), FADE_MS + 150);
    return () => {
      clearTimeout(show);
      clearTimeout(t);
    };
  }, [scene, season]);

  return (
    <div className="scene-backdrop" aria-hidden="true" style={{ '--scene-intensity': intensity } as React.CSSProperties}>
      {layers.map((l) => (
        <Layer key={l.key} scene={l.scene} season={l.season} visible={l.visible} />
      ))}
      <TwilightSky twilight={twilight} />
      {weather && (weather.sky !== 'clear' || weather.windy) && <WeatherLayer key={`${weather.sky}-${weather.windy}`} weather={weather} />}
      {/* Bad air outside: a warm-grey veil over any sky */}
      {weather?.haze ? <div className="weather-haze" style={{ '--haze': weather.haze } as React.CSSProperties} /> : null}
    </div>
  );
};

// Redrawn only when the scene, season, intensity, weather or twilight change
export const SceneBackdrop = React.memo(SceneBackdropView);
