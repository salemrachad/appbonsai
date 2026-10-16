import React from 'react';
import { CloudRain, Droplets, Thermometer, Wind } from 'lucide-react';
import type { WeatherLook } from '../../expression/expressionTypes';
import type { OutsideWeather } from '../../telemetry/outsideWeather';
import { WEATHER_ICON } from './WeatherChip';

interface OutsidePanelProps {
  weather: WeatherLook | null; // the look (sky + label), as the Expression Engine decided (previews included)
  outside: OutsideWeather | null; // the observation's numbers (perception.outside)
  inside: { temperature: number | null; humidity: number | null }; // the greenhouse sensors (null without the ESP32: no inside to compare)
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
};

// A small dashboard of the weather OUTSIDE the greenhouse, next to what the sensors measure inside.
// Context only: facts, no verdicts (the tree's state comes from the sensors). Shows nothing it doesn't know.
export const OutsidePanel: React.FC<OutsidePanelProps> = ({ weather, outside, inside }) => {
  if (!weather) {
    return (
      <div className="glass rounded-2xl px-4 py-2.5 sans text-xs text-[var(--ink)]/45 flex items-center gap-2">
        <WEATHER_ICON.overcast className="w-3.5 h-3.5" /> Outside weather unavailable right now
      </div>
    );
  }
  const Icon = WEATHER_ICON[weather.sky];
  const tOut = outside?.temperature ?? null;
  const hOut = outside?.humidity ?? null;
  const tIn = inside.temperature;
  const hIn = inside.humidity;
  const diff = tOut !== null && tIn !== null ? Math.round(tIn - tOut) : null;
  const rain = outside?.precipitation ?? 0;
  const wind = outside?.wind ?? null;
  const gusts = outside?.gusts ?? null;
  const sky = weather.label.split(' · ')[0]; // "Rain, windy"

  const tile = 'flex flex-col min-w-0';
  const big = 'sans text-lg font-bold leading-tight text-[var(--ink)] tabular-nums';
  const small = 'sans text-[10.5px] text-[var(--ink)]/50 tabular-nums truncate';
  const head = 'sans text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]/45 flex items-center gap-1';

  return (
    <div className="glass rounded-2xl px-4 py-3" title="Outside weather at the tree's location (Open-Meteo). The tree's own sensors measure inside the greenhouse.">
      <div className="grid grid-cols-4 gap-3 items-center">
        {/* The sky */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Icon className="w-7 h-7 text-[#356077] shrink-0" />
          <div className="min-w-0">
            <div className="sans text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]/45">Outside</div>
            <div className="sans text-sm font-semibold text-[var(--ink)] truncate">{sky}</div>
            <div className={small}>{outside ? ago(outside.ageMs) : 'preview'}</div>
          </div>
        </div>
        {/* Temperature: outside vs inside */}
        <div className={tile}>
          <span className={head}>
            <Thermometer className="w-3 h-3 text-[#D97757]" /> Temp
          </span>
          <span className={big}>{tOut !== null ? `${Math.round(tOut)}°` : '–'}</span>
          <span className={small}>
            {tIn !== null ? `inside ${Math.round(tIn)}°` : ''}
            {diff !== null && diff !== 0 ? ` · ${Math.abs(diff)}° ${diff > 0 ? 'warmer' : 'cooler'} in` : ''}
          </span>
        </div>
        {/* Humidity: outside vs inside */}
        <div className={tile}>
          <span className={head}>
            <Droplets className="w-3 h-3 text-[#4A6741]" /> Humidity
          </span>
          <span className={big}>{hOut !== null ? `${Math.round(hOut)}%` : '–'}</span>
          <span className={small}>{hIn !== null ? `inside ${Math.round(hIn)}%` : ''}</span>
        </div>
        {/* Wind, or rain when it's raining */}
        <div className={tile}>
          {rain > 0 ? (
            <>
              <span className={head}>
                <CloudRain className="w-3 h-3 text-[#356077]" /> Rain
              </span>
              <span className={big}>{rain < 1 ? rain.toFixed(1) : Math.round(rain)} mm</span>
              <span className={small}>{wind !== null ? `wind ${Math.round(wind)} km/h` : 'last hour'}</span>
            </>
          ) : (
            <>
              <span className={head}>
                <Wind className="w-3 h-3 text-[#6B7A8F]" /> Wind
              </span>
              <span className={big}>{wind !== null ? `${Math.round(wind)}` : '–'}<span className="sans text-xs text-[var(--ink)]/50"> km/h</span></span>
              <span className={small}>{gusts !== null ? `gusts ${Math.round(gusts)}` : ''}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
