import React from 'react';
import { Leaf } from 'lucide-react';
import { weekdayName, withHikeDefaults, type HikeDayScore, type HikePlan, type HikeQuality } from '../../behaviour/hike';
import { WEATHER_ICON } from './WeatherChip';

const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// What the tree says about its pick, by how good the forecast is ({day}: "Saturday" or "next Saturday")
const SAYS: Record<HikeQuality, string> = {
  great: '{Day} looks perfect for your hike.',
  good: "I'd go on {day}. The sky looks kind.",
  fair: '{Day} is your best chance this week.',
  poor: '{Day} is the driest of a wet week.',
};

// The week's hike as the tree picked it (expression.hike.plan), in the tree's own voice: its pick, said like
// its thoughts, and its two days as chips. Tapping the other chip chooses it (onChoose); the leaf marks the
// tree's own pick. The forecast details stay in the tooltips.
export const HikePanel: React.FC<{ plan: HikePlan; preview?: boolean; onChoose?: (day: string) => void }> = ({ plan: raw, preview = false, onChoose }) => {
  const plan = withHikeDefaults(raw);
  const dayWord = (date: string) => `${plan.nextWeek ? 'next ' : ''}${weekdayName(date)}`;
  const fill = (s: string) => s.replace('{Day}', cap(dayWord(plan.day))).replace('{day}', dayWord(plan.day));
  const treePick = plan.options[0] ?? plan.day; // the tree's own pick comes first
  const says = plan.today
    ? "Today's the day! Your boots and water are by my pot."
    : plan.chosen
    ? fill('{Day} it is. I’ll keep an eye on the sky for you.')
    : plan.movedFrom
    ? fill(`I changed my mind: {day} looks better now.`)
    : fill(SAYS[plan.quality]);
  const label = plan.today ? 'Hike day' : plan.chosen ? 'Your hike day' : plan.nextWeek ? "I picked next week's hike" : 'I picked your hike day';
  // The chips: the tree's two days (and a chosen day the forecast has since passed over)
  const days = [...new Set([...plan.options, plan.day])];
  const forecastOf = (date: string): HikeDayScore | null =>
    plan.week7.find((d) => d?.date === date) ?? (date === plan.day ? { date, score: 0, sky: plan.forecast.sky, tMax: plan.forecast.tMax, rainChance: plan.forecast.rainChance } : null);
  const choosable = !!onChoose && !plan.today && days.length > 1;
  return (
    <div
      className={`glass rounded-2xl px-4 py-3 ${plan.today ? 'ring-2 ring-[#D97757]/40' : ''}`}
      title={`The tree reads the forecast and picks the best day of each week for your hike. ${preview ? 'Preview.' : `Forecast ${ago(Date.now() - plan.forecastAt)}.`}`}
    >
      <div className="flex items-start gap-3">
        {/* The tree is the one speaking */}
        <div className={`mt-0.5 w-8 h-8 rounded-full shrink-0 flex items-center justify-center ${plan.today ? 'bg-[#D97757]/15 text-[#9E3E20]' : 'bg-[#4A6741]/12 text-[#4A6741]'}`}>
          <Leaf className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="sans text-[10px] font-bold uppercase tracking-wider text-[var(--ink)]/45">
            {label} 🥾{preview && <span className="normal-case font-semibold tracking-normal"> · preview</span>}
          </div>
          <p className="serif text-lg italic leading-snug">“{says}”</p>
          {!plan.today && (
            <div className="flex flex-wrap items-center gap-1.5">
              {days.map((date, i) => {
                const d = forecastOf(date);
                const Icon = d ? WEATHER_ICON[d.sky] : null;
                const picked = date === plan.day;
                const mine = date === treePick;
                const canTap = choosable && !picked;
                const title = `${weekdayName(date)}${d?.tMax != null ? `: ${Math.round(d.tMax)}°` : ''}${d?.rainChance != null ? `, ${Math.round(d.rainChance)}% rain` : ''}${mine ? ' · the tree’s pick' : ''}${canTap ? ' · tap to choose' : ''}`;
                const chip = (
                  <>
                    {Icon && <Icon className="w-3.5 h-3.5 text-[#356077]" />}
                    <span className="font-semibold">{weekdayName(date).slice(0, 3)}</span>
                    {d?.tMax != null && <span className="opacity-60 tabular-nums">{Math.round(d.tMax)}°</span>}
                    {mine && <span aria-label="the tree's pick">🌱</span>}
                  </>
                );
                const cls = `sans text-xs flex items-center gap-1 px-2.5 py-1 rounded-full ${
                  picked ? 'bg-[#D97757]/15 ring-1 ring-[#D97757]/50 text-[#9E3E20]' : 'border border-dashed border-[var(--ink)]/25 text-[var(--ink)]/70'
                }`;
                return (
                  <React.Fragment key={date}>
                    {i > 0 && <span className="sans text-[11px] text-[var(--ink)]/40">or</span>}
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
              {choosable && <span className="sans text-[10.5px] text-[var(--ink)]/45 ml-1">{plan.chosen ? 'tap to change' : 'tap the other to choose it'}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
