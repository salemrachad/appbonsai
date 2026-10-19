import React from 'react';
import { weekdayName, withHikeDefaults, type HikeDayScore, type HikePlan } from '../../behaviour/hike';
import { hikeAdvice, hikeSays } from '../../behaviour/messages';
import { WEATHER_ICON } from './WeatherChip';

// The week's hike as the tree picked it, on Home under the Outside panel: what it says, the best hours of the
// day, and its two days as chips (🌱 on its own pick); tapping the other chooses it (onChoose)
export const HikePanel: React.FC<{ plan: HikePlan; preview?: boolean; onChoose?: (day: string) => void }> = ({ plan: raw, preview = false, onChoose }) => {
  const plan = withHikeDefaults(raw);
  const days = [...new Set([...plan.options, plan.day])];
  const treePick = plan.options[0] ?? plan.day;
  const choosable = !!onChoose && !plan.today && days.length > 1;
  const forecastOf = (date: string): HikeDayScore | null =>
    plan.week7.find((d) => d?.date === date) ?? (date === plan.day ? { date, score: 0, sky: plan.forecast.sky, tMax: plan.forecast.tMax, rainChance: plan.forecast.rainChance } : null);
  return (
    <div className="glass rounded-2xl px-4 py-2.5 border border-[#D97757]/20" title={`The tree reads the forecast and picks the best day of each week for your hike.${preview ? ' (preview)' : ''}`}>
      <p className="serif italic text-[14px] leading-snug text-[var(--ink)]/90">🥾 {hikeSays(plan, weekdayName)}</p>
      {plan.detail && <p className="sans text-[11px] leading-snug text-[var(--ink)]/60 mt-0.5">{hikeAdvice(plan.detail)}</p>}
      {!plan.today && (
        <div className="flex flex-wrap items-center gap-1 mt-1">
          {days.map((date, i) => {
            const d = forecastOf(date);
            const Icon = d ? WEATHER_ICON[d.sky] : null;
            const picked = date === plan.day;
            const mine = date === treePick;
            const canTap = choosable && !picked;
            const chip = (
              <>
                {Icon && <Icon className="w-3 h-3 text-[#356077]" />}
                <span className="font-semibold">{weekdayName(date).slice(0, 3)}</span>
                {d?.tMax != null && <span className="opacity-60 tabular-nums">{Math.round(d.tMax)}°</span>}
                {mine && <span aria-label="the tree's pick">🌱</span>}
              </>
            );
            const cls = `sans text-[11px] flex items-center gap-1 px-2 py-0.5 rounded-full ${
              picked ? 'bg-[#D97757]/15 ring-1 ring-[#D97757]/45 text-[#9E3E20]' : 'border border-dashed border-[var(--ink)]/25 text-[var(--ink)]/65'
            }`;
            const title = `${weekdayName(date)}${d?.rainChance != null ? `: ${Math.round(d.rainChance)}% rain` : ''}${mine ? ' · the tree’s pick' : ''}${canTap ? ' · tap to choose' : ''}`;
            return (
              <React.Fragment key={date}>
                {i > 0 && <span className="sans text-[10px] text-[var(--ink)]/35">or</span>}
                {canTap ? (
                  <button id={`hike-choose-${date}`} type="button" title={title} onClick={() => onChoose!(date)} className={`${cls} cursor-pointer hover:bg-[#D97757]/10 hover:border-[#D97757]/50`}>
                    {chip}
                  </button>
                ) : (
                  <span title={title} className={cls}>
                    {chip}
                  </span>
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};
