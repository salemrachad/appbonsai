import React from 'react';
import { Mountain } from 'lucide-react';
import { hikeQuality, weekdayName, type HikePlan, type HikeQuality } from '../../behaviour/hike';
import { WEATHER_ICON } from './WeatherChip';

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
};

const QUALITY: Record<HikeQuality, { label: string; dot: string }> = {
  great: { label: 'great forecast', dot: '#4A6741' },
  good: { label: 'good forecast', dot: '#7FA05A' },
  fair: { label: 'fair forecast', dot: '#D49B53' },
  poor: { label: 'best of a wet week', dot: '#B5654A' },
};

const SKY_WORD: Record<HikePlan['forecast']['sky'], string> = {
  clear: 'Sunny', partly_cloudy: 'Some clouds', overcast: 'Overcast', fog: 'Foggy', drizzle: 'Drizzle',
  rain: 'Rain', heavy_rain: 'Heavy rain', snow: 'Snow', thunderstorm: 'Storms',
};

// The week's hike as the tree picked it (expression.hike.plan): the day, its forecast, and the week at a
// glance. Facts from the forecast; the pick follows it until the day arrives.
export const HikePanel: React.FC<{ plan: HikePlan; preview?: boolean }> = ({ plan, preview = false }) => {
  const f = plan.forecast;
  const Icon = WEATHER_ICON[f.sky];
  const name = weekdayName(plan.day);
  const when = plan.today ? 'Today!' : plan.nextWeek ? `Next ${name}` : name;
  const q = QUALITY[plan.quality];
  const small = 'sans text-[10.5px] text-[var(--ink)]/50 tabular-nums truncate';
  const facts = [SKY_WORD[f.sky], f.tMax !== null && `${Math.round(f.tMax)}°`, f.rainChance !== null && `${Math.round(f.rainChance)}% rain`].filter(Boolean).join(' · ');
  return (
    <div
      className={`glass rounded-2xl px-4 py-2.5 ${plan.today ? 'ring-2 ring-[#D97757]/40' : ''}`}
      title="The tree picks the best forecast day of each week (Monday to Sunday) for your hike. It follows the forecast until the day arrives."
    >
      <div className="flex items-center gap-3">
        <Mountain className={`w-6 h-6 shrink-0 ${plan.today ? 'text-[#D97757]' : 'text-[#4A6741]'}`} />
        <div className="min-w-0 flex-1">
          <div className="sans text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]/45">
            {plan.nextWeek ? "Next week's hike" : 'Hike day'}
            {plan.movedFrom && !plan.today && <span className="normal-case font-semibold tracking-normal text-[#8F5E24]"> · moved from {weekdayName(plan.movedFrom).slice(0, 3)}</span>}
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="sans text-sm font-bold text-[var(--ink)]">{when}</span>
            <span className="sans text-xs text-[var(--ink)]/70 truncate flex items-center gap-1">
              <Icon className="w-3.5 h-3.5 text-[#356077] shrink-0" /> {facts}
            </span>
          </div>
          <div className={small}>
            <span style={{ color: q.dot }}>●</span> {q.label} · {preview ? 'preview' : `forecast ${ago(Date.now() - plan.forecastAt)}`}
          </div>
        </div>
        {/* The week at a glance: the picked day stands out */}
        <div className="flex gap-1 shrink-0" aria-label="This week's hiking forecast">
          {plan.week7.map((d, i) => {
            const picked = d?.date === plan.day;
            return (
              <div
                key={i}
                title={d ? `${weekdayName(d.date)}: ${SKY_WORD[d.sky]}${d.tMax !== null ? `, ${Math.round(d.tMax)}°` : ''}${d.rainChance !== null ? `, ${d.rainChance}% rain` : ''} (score ${d.score})` : 'passed'}
                className={`w-5 flex flex-col items-center rounded-md py-0.5 ${picked ? 'bg-[#D97757]/15 ring-1 ring-[#D97757]/50' : ''}`}
              >
                <span className={`sans text-[9px] font-bold ${picked ? 'text-[#9E3E20]' : 'text-[var(--ink)]/40'}`}>{'MTWTFSS'[i]}</span>
                <span className="w-1.5 h-1.5 rounded-full mt-0.5" style={{ background: d ? QUALITY[hikeQuality(d.score)].dot : 'transparent', border: d ? 'none' : '1px solid rgba(0,0,0,0.12)' }} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

