import React from 'react';
import { RotateCcw, Wrench } from 'lucide-react';
import { DEV_PRESETS } from '../../health/developerOverrides';
import type { VisitorPreview, WeatherPreview } from '../../hooks/usePlantBehaviour';
import { SEASONS, type Season } from '../../perception/season';

interface StateTesterProps {
  activePresetId: string | null;
  onSelectPreset: (id: string | null) => void;
  activeSeason: Season | null;
  onSelectSeason: (season: Season | null) => void;
  activeVisitor: VisitorPreview | null;
  onSelectVisitor: (v: VisitorPreview | null) => void;
  activeWeather: WeatherPreview | null;
  onSelectWeather: (w: WeatherPreview | null) => void;
}

const WEATHER_PREVIEWS: { id: WeatherPreview; label: string }[] = [
  { id: 'rain', label: '🌧️ Rain' },
  { id: 'heavy_rain', label: 'Downpour' },
  { id: 'fog', label: '🌫️ Fog' },
  { id: 'thunderstorm', label: '⛈️ Storm' },
  { id: 'snow', label: '🌨️ Snow' },
  { id: 'overcast', label: '☁️ Overcast' },
  { id: 'windy', label: '💨 Windy' },
];

const SPOT_LABEL: Record<VisitorPreview['spot'], string> = { left_branch: 'Left', right_branch: 'Right', crown: 'Crown', trunk: 'Trunk', pot_rim: 'Pot' };
const chip = (active: boolean) =>
  `py-1 px-2 rounded-lg border text-[11px] font-medium sans cursor-pointer ${
    active ? 'bg-[#4A6741] text-white border-[#334A2C]' : 'bg-white text-[#2D332A] border-[#D8D2C9] hover:border-[#4A6741]'
  }`;

const SEASON_EMOJI: Record<Season, string> = { spring: '🌸', summer: '☀️', autumn: '🍂', winter: '❄️' };

// Preview any health state. Presentation only: telemetry, the database, care events and episodes are untouched.
export const StateTester: React.FC<StateTesterProps> = ({ activePresetId, onSelectPreset, activeSeason, onSelectSeason, activeVisitor, onSelectVisitor, activeWeather, onSelectWeather }) => (
  <div id="developer-test-mode" className="w-full bg-[#FAF8F5]/95 p-3.5 rounded-2xl border-2 border-[#D8D2C9] shadow-md space-y-2.5">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="p-1 rounded-md bg-[#4A6741]/10 text-[#4A6741]">
          <Wrench className="w-3.5 h-3.5" />
        </div>
        <span className="sans text-xs font-bold uppercase tracking-wider text-[#2D332A]">Test Tree State</span>
      </div>

      {activePresetId ? (
        <button
          id="return-to-live-header-btn"
          onClick={() => onSelectPreset(null)}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#D97757]/15 text-[#9E3E20] border border-[#D97757]/30 hover:bg-[#D97757] hover:text-white text-[11px] font-semibold cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Return to Live Data</span>
        </button>
      ) : (
        <span className="sans text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#4A6741]/15 text-[#334D2E] border border-[#4A6741]/30 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4A6741] animate-ping" />
          <span>Live Data</span>
        </span>
      )}
    </div>

    <div className="grid grid-cols-3 gap-1.5">
      {DEV_PRESETS.map((p) => {
        const active = activePresetId === p.id;
        return (
          <button
            key={p.id}
            id={`test-state-btn-${p.id}`}
            onClick={() => onSelectPreset(active ? null : p.id)}
            className={`py-2 px-2 rounded-xl border text-[11px] font-medium sans flex items-center gap-1.5 cursor-pointer select-none ${
              active
                ? 'bg-[#4A6741] text-white border-[#334A2C] shadow-md ring-2 ring-[#4A6741]/30'
                : 'bg-white text-[#2D332A] border-[#D8D2C9] hover:border-[#4A6741] hover:bg-[#4A6741]/5'
            }`}
            title={p.modifiers.length ? `${p.condition} + ${p.modifiers.join(', ')}` : p.condition}
          >
            <span className="text-sm">{p.emoji}</span>
            <span className="truncate">{p.label}</span>
          </button>
        );
      })}
    </div>

    <div className="flex items-center gap-1.5 pt-1">
      <span className="sans text-[10px] font-bold uppercase tracking-wider text-[#2D332A]/55 mr-1">Season</span>
      {[null, ...SEASONS].map((s) => {
        const active = activeSeason === s;
        return (
          <button
            key={s ?? 'live'}
            onClick={() => onSelectSeason(s)}
            className={`py-1 px-2 rounded-lg border text-[11px] font-medium sans cursor-pointer ${
              active ? 'bg-[#4A6741] text-white border-[#334A2C]' : 'bg-white text-[#2D332A] border-[#D8D2C9] hover:border-[#4A6741]'
            }`}
          >
            {s ? `${SEASON_EMOJI[s]} ${s[0].toUpperCase()}${s.slice(1)}` : 'Live'}
          </button>
        );
      })}
    </div>

    {/* Real visits need days of calm history; this shows the squirrel now */}
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="sans text-[10px] font-bold uppercase tracking-wider text-[#2D332A]/55 mr-1">Squirrel</span>
      <button onClick={() => onSelectVisitor(null)} className={chip(!activeVisitor)}>Live</button>
      {(['visiting', 'hiding'] as const).map((mode) => (
        <button
          key={mode}
          onClick={() => onSelectVisitor({ mode, spot: activeVisitor?.spot ?? 'left_branch' })}
          className={chip(activeVisitor?.mode === mode)}
        >
          {mode === 'visiting' ? '🐿️ Visiting' : '🍃 Hiding'}
        </button>
      ))}
      {activeVisitor &&
        (Object.keys(SPOT_LABEL) as VisitorPreview['spot'][]).map((spot) => (
          <button key={spot} onClick={() => onSelectVisitor({ ...activeVisitor, spot })} className={chip(activeVisitor.spot === spot)}>
            {SPOT_LABEL[spot]}
          </button>
        ))}
    </div>

    {/* Outside weather: only the background layer changes, never the tree */}
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="sans text-[10px] font-bold uppercase tracking-wider text-[#2D332A]/55 mr-1">Outside</span>
      <button onClick={() => onSelectWeather(null)} className={chip(!activeWeather)}>Live</button>
      {WEATHER_PREVIEWS.map((w) => (
        <button key={w.id} onClick={() => onSelectWeather(w.id)} className={chip(activeWeather === w.id)}>
          {w.label}
        </button>
      ))}
    </div>

    <p className="text-[11px] sans text-[#2D332A]/55 px-1">
      Changes only health, behaviour and expression on screen. Sensor values, the database, care events and episodes stay real.
    </p>
  </div>
);
