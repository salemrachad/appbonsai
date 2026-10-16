import React from 'react';
import type { WeatherLook } from '../../expression/expressionTypes';
import type { OutsideSky } from '../../telemetry/outsideWeather';
import { Particles, type ParticleSpec } from './SceneBackdrop';

// The outside weather in FRONT of the tree, so it feels like being in it: fog banks drift across the plant,
// big raindrops fall past it and splash by the pot, flakes pass in front. It draws over the avatar without
// touching it (the tree's art never changes for the weather) and never takes the pointer, so petting works.
// From atmosphere.weather only. The SceneBackdrop weather layer does the same behind the tree.

const FRONT: Record<OutsideSky, ParticleSpec[]> = {
  clear: [],
  partly_cloudy: [],
  overcast: [],
  fog: [],
  drizzle: [{ kind: 'drop', count: 10, dur: [1.2, 1.8], size: [14, 22], top: [-25, -5], colors: ['rgba(120,160,205,0.7)'] }],
  rain: [
    { kind: 'drop', count: 22, dur: [0.7, 1.05], size: [26, 40], top: [-30, -5], colors: ['rgba(90,135,190,0.85)', 'rgba(130,170,215,0.8)'] },
    { kind: 'splash', count: 6, dur: [1.4, 2.2], size: [14, 24], top: [84, 92], left: [22, 78], colors: ['rgba(110,150,200,0.75)'] },
  ],
  heavy_rain: [
    { kind: 'drop', count: 42, dur: [0.5, 0.8], size: [34, 52], top: [-30, -5], colors: ['rgba(80,125,185,0.9)', 'rgba(125,165,215,0.85)'] },
    { kind: 'splash', count: 11, dur: [1, 1.7], size: [16, 28], top: [83, 93], left: [18, 82], colors: ['rgba(100,145,200,0.8)'] },
  ],
  thunderstorm: [
    { kind: 'drop', count: 34, dur: [0.55, 0.85], size: [32, 50], top: [-30, -5], colors: ['rgba(110,120,170,0.9)', 'rgba(150,160,205,0.85)'] },
    { kind: 'splash', count: 9, dur: [1.1, 1.8], size: [16, 26], top: [83, 93], left: [18, 82], colors: ['rgba(120,130,180,0.8)'] },
  ],
  snow: [
    { kind: 'snow', count: 48, dur: [7, 12], size: [7, 14], top: [-10, 0], colors: ['#FFFFFF'] },
    { kind: 'snow', count: 34, dur: [4.5, 7], size: [3, 6], top: [-10, 0], colors: ['#FFFFFF', '#F4F8FC'] }, // nearer, quicker
  ],
};
const FRONT_WIND: ParticleSpec = { kind: 'streak', count: 5, dur: [2, 3.4], size: [120, 220], left: [-35, -15], top: [10, 85], colors: ['rgba(140,145,155,0.55)'] };

export const WeatherForeground: React.FC<{ weather: WeatherLook | null | undefined }> = ({ weather }) => {
  if (!weather || (weather.sky === 'clear' && !weather.windy)) return null;
  const specs = [...FRONT[weather.sky], ...(weather.windy ? [FRONT_WIND] : [])];
  const foggy = weather.sky === 'fog';
  return (
    <div
      key={`${weather.sky}-${weather.windy}`}
      className={`weather-front weather-front-${weather.sky}`}
      style={{ '--weather-intensity': weather.intensity } as React.CSSProperties}
      aria-hidden="true"
    >
      {foggy && (
        <>
          <div className="wf-veil" />
          {[
            { top: '12%', dur: 38, delay: 0, h: 26 },
            { top: '40%', dur: 52, delay: -18, h: 30 },
            { top: '66%', dur: 44, delay: -31, h: 24 },
          ].map((b, i) => (
            <div key={i} className="wf-bank" style={{ top: b.top, height: `${b.h}%`, animationDuration: `${b.dur}s`, animationDelay: `${b.delay}s` }} />
          ))}
        </>
      )}
      {specs.map((s, i) => (
        <Particles key={`${weather.sky}-${i}`} spec={s} seed={weather.sky.length * 613 + i * 47 + 5} />
      ))}
    </div>
  );
};
