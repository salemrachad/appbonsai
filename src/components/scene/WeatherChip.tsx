import React from 'react';
import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, Wind } from 'lucide-react';
import type { WeatherLook } from '../../expression/expressionTypes';
import type { OutsideSky } from '../../telemetry/outsideWeather';

const ICON: Record<OutsideSky, typeof Sun> = {
  clear: Sun,
  partly_cloudy: CloudSun,
  overcast: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  heavy_rain: CloudRain,
  snow: CloudSnow,
  thunderstorm: CloudLightning,
};

// Outside weather at the tree's location (context: the tree's own sensors are inside the greenhouse).
// Shows facts only; the label comes from the Expression Engine. Hidden when there is no fresh weather.
export const WeatherChip: React.FC<{ weather: WeatherLook | null }> = ({ weather }) => {
  if (!weather) return null;
  const Icon = weather.windy && weather.sky === 'clear' ? Wind : ICON[weather.sky];
  return (
    <span className="sans text-xs text-[var(--ink)]/55 flex items-center gap-1.5 shrink-0" title="Outside weather (Open-Meteo). The tree's sensors measure inside.">
      <Icon className="w-3 h-3 text-[#356077]" />
      <span className="font-medium">Outside</span>
      <span className="tabular-nums text-[var(--ink)]/40">· {weather.label}</span>
    </span>
  );
};
