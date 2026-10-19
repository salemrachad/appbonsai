import React from 'react';
import { CloudRain, Droplets, Gauge, Thermometer, Wind } from 'lucide-react';
import type { WeatherLook } from '../../expression/expressionTypes';
import type { AirComparison } from '../../perception/perceptionTypes';
import type { OutsideWeather } from '../../telemetry/outsideWeather';
import { WEATHER_ICON } from './WeatherChip';

interface OutsidePanelProps {
  weather: WeatherLook | null; // the look (sky + label), as the Expression Engine decided (previews included)
  outside: OutsideWeather | null; // the observation's numbers (perception.outside)
  inside: { temperature: number | null; humidity: number | null }; // the greenhouse sensors (null without the ESP32: no inside to compare)
  air?: AirComparison | null; // inside vs outside by dew point (perception.air)
}

// The barometer's tendency over 3 h, and the European AQI bands, in plain words
const TENDENCY: Record<NonNullable<OutsideWeather['pressureTendency']>, { arrow: string; words: string }> = {
  falling_fast: { arrow: '↓↓', words: 'falling fast: weather coming' },
  falling: { arrow: '↓', words: 'falling' },
  steady: { arrow: '→', words: 'steady' },
  rising: { arrow: '↑', words: 'rising' },
};
const AIR_WORDS: Record<NonNullable<OutsideWeather['air']>['band'], string> = {
  good: 'good', fair: 'fair', moderate: 'moderate', poor: 'poor', very_poor: 'very poor', extremely_poor: 'extremely poor',
};

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
};

// A small dashboard of the weather OUTSIDE the greenhouse, next to what the sensors measure inside.
// Context only: facts, no verdicts (the tree's state comes from the sensors). Shows nothing it doesn't know.
export const OutsidePanel: React.FC<OutsidePanelProps> = ({ weather, outside, inside, air = null }) => {
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
      <div className="grid grid-cols-[1.15fr_0.95fr_1.35fr_0.85fr] gap-3 items-center">
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
            {tIn !== null ? `in ${Math.round(tIn)}°` : ''}
            {diff !== null && diff !== 0 ? ` (${diff > 0 ? '+' : '−'}${Math.abs(diff)}°)` : ''}
          </span>
        </div>
        {/* Humidity: outside vs inside */}
        <div
          className={tile}
          title={air ? 'Relative humidity depends on temperature. The dew point (outside / inside) shows the actual water in the air, so inside and outside compare honestly.' : undefined}
        >
          <span className={head}>
            <Droplets className="w-3 h-3 text-[#4A6741]" /> Humidity
          </span>
          <span className={big}>{hOut !== null ? `${Math.round(hOut)}%` : '–'}</span>
          <span className={small}>
            {hIn !== null ? `in ${Math.round(hIn)}%` : ''}
            {air ? ` · dew ${Math.round(air.outsideDewPoint)}°/${Math.round(air.insideDewPoint)}°` : ''}
          </span>
          {air && <span className={small}>{air.moistureRatio >= 1.2 ? `${air.moistureRatio}× more water inside` : air.moistureRatio <= 0.8 ? 'drier air inside' : 'same water in the air'}</span>}
          {air?.glassMayFog && <span className={`${small} text-[#356077]`}>glass may fog</span>}
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
      {/* Beyond the sky: the barometer and the air (each only when known) */}
      {(outside?.pressure != null || outside?.air) && (
        <div className="mt-2 pt-1.5 border-t border-[var(--ink)]/5 flex flex-wrap items-center gap-x-4 gap-y-0.5 sans text-[11px] text-[var(--ink)]/60 tabular-nums">
          {outside?.pressure != null && (
            <span
              className="flex items-center gap-1"
              title={outside.pressureTrend != null ? `Air pressure at sea level. ${outside.pressureTrend > 0 ? '+' : ''}${outside.pressureTrend} hPa over the last 3 hours.` : 'Air pressure at sea level.'}
            >
              <Gauge className="w-3 h-3 text-[#6B7A8F]" />
              {Math.round(outside.pressure)} hPa
              {outside.pressureTendency && (
                <span className={outside.pressureTendency === 'falling_fast' ? 'text-[#356077] font-semibold' : ''}>
                  {' '}
                  {TENDENCY[outside.pressureTendency].arrow} {TENDENCY[outside.pressureTendency].words}
                </span>
              )}
            </span>
          )}
          {outside?.air && (
            <span
              className={`flex items-center gap-1 ${['poor', 'very_poor', 'extremely_poor'].includes(outside.air.band) ? 'text-[#9E6B2E] font-semibold' : ''}`}
              title={`European air quality index (modelled by Copernicus CAMS).${outside.air.pm25 != null ? ` PM2.5 ${Math.round(outside.air.pm25)} µg/m³` : ''}${outside.air.pm10 != null ? ` · PM10 ${Math.round(outside.air.pm10)} µg/m³` : ''}`}
            >
              Air: {AIR_WORDS[outside.air.band]} · {Math.round(outside.air.aqi)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
