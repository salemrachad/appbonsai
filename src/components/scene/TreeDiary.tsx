import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../api/client';
import { weekdayName, withHikeDefaults, type HikeDayScore, type HikePlan } from '../../behaviour/hike';
import { hikeAdvice, hikeSays } from '../../behaviour/messages';
import type { DiaryItem } from '../../history/historyTypes';
import { dayStartOf } from '../../history/moments';
import { hhmm, MIN } from '../../lib/time';
import { WEATHER_ICON } from './WeatherChip';

const OPEN_KEY = 'appbonsai_tree_diary_open_v1'; // per-viewer convenience: the diary folded or not
const REFRESH_MS = 5 * MIN; // besides reloadKey (something new was said or happened)

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

// The tree's diary as quiet chat bubbles over the left of the scene: the week's hike as the tree picked it
// (pinned on top, in the open sky above the crown) and ALL of today's diary (/api/history/diary: the same list
// as History) in a narrow column below it, left of the crown, oldest first, scrolling and kept at its newest
// line. Folds away to a small label. reloadKey: changes when the tree says something new or an episode or
// care event changes, so the column follows the tree at once.
export const TreeDiary: React.FC<{ hike: HikePlan | null; hikePreview?: boolean; onChooseHike?: (day: string) => void; reloadKey?: string; onOpenDiary?: () => void }> = ({
  hike,
  hikePreview = false,
  onChooseHike,
  reloadKey = '',
  onOpenDiary,
}) => {
  const [open, setOpen] = useState(readOpen);
  const [items, setItems] = useState<DiaryItem[]>([]);
  const column = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .diary(1)
        .then((d) => {
          const today = dayStartOf(Date.now());
          if (alive) setItems([...d].filter((i) => i.at >= today).sort((a, b) => a.at - b.at));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [reloadKey]);

  // Keep the column at its newest line
  useEffect(() => {
    const el = column.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, open]);

  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        /* private window: just this visit */
      }
      return !o;
    });
  };

  const count = items.length + (hike ? 1 : 0);
  if (!count) return null;
  return (
    <div className="absolute left-0 top-0 z-20 w-[min(15.5rem,62%)] flex flex-col items-start gap-1.5 opacity-80 hover:opacity-100 transition-opacity">
      <button
        id="tree-diary-toggle"
        type="button"
        onClick={toggle}
        className="sans text-[10px] font-semibold uppercase tracking-wider text-[var(--ink)]/40 hover:text-[var(--ink)]/70 flex items-center gap-1 cursor-pointer"
        title={open ? 'Fold the diary' : "Open the tree's diary"}
      >
        <BookOpen className="w-3 h-3" />
        Diary{!open && ` · ${count}`}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {open && (
        <>
          {hike && <HikeBubble plan={hike} preview={hikePreview} onChoose={onChooseHike} />}
          <div ref={column} className="max-w-[9.5rem] max-h-[min(24rem,48vh)] overflow-y-auto overscroll-contain pr-1 flex flex-col items-start gap-1">
            {items.map((item) => (
              <Bubble key={`${item.at}-${item.kind}-${item.title}`} at={item.at} title={item.detail} kind={item.kind}>
                {item.kind === 'said' ? `“${item.title}”` : item.kind === 'moment' && item.detail ? `${item.title} · ${item.detail}` : item.title}
              </Bubble>
            ))}
          </div>
          {onOpenDiary && (
            <button id="tree-diary-full" type="button" onClick={onOpenDiary} className="sans text-[10px] text-[var(--ink)]/45 hover:text-[var(--ink)]/75 pl-1 cursor-pointer">
              Full diary →
            </button>
          )}
        </>
      )}
    </div>
  );
};

// One line of the diary: a soft bubble, its time underneath. What the tree said is in its own voice (serif,
// in quotes); a moment from the readings is smaller and muted; the rest is the plain record.
const Bubble: React.FC<{ at?: number; title?: string; accent?: boolean; kind?: DiaryItem['kind']; children: React.ReactNode }> = ({ at, title, accent = false, kind, children }) => (
  <div className="max-w-full tree-diary-in" title={title}>
    <div
      className={`rounded-2xl rounded-tl-md backdrop-blur-md leading-snug ${
        accent
          ? 'px-3 py-1.5 text-[12.5px] text-[var(--ink)]/80 bg-[var(--paper)]/75 border border-[#D97757]/25 shadow-sm'
          : kind === 'said'
          ? 'px-2.5 py-1 serif italic text-[12.5px] text-[var(--ink)]/85 bg-[var(--paper)]/70 border border-[#4A6741]/15'
          : kind === 'moment'
          ? 'px-2.5 py-0.5 sans text-[10.5px] text-[var(--ink)]/55 bg-[var(--paper)]/45 border border-[var(--ink)]/5'
          : 'px-2.5 py-1 text-[11.5px] text-[var(--ink)]/80 bg-[var(--paper)]/60 border border-[var(--ink)]/5'
      }`}
    >
      {children}
    </div>
    {at !== undefined && <div className="sans text-[9px] text-[var(--ink)]/35 pl-2 tabular-nums">{hhmm(at)}</div>}
  </div>
);

// The week's hike as the tree picked it: what it says, the best hours of the day, and its two days as
// chips (🌱 on its own pick); tapping the other chooses it (onChoose)
const HikeBubble: React.FC<{ plan: HikePlan; preview: boolean; onChoose?: (day: string) => void }> = ({ plan: raw, preview, onChoose }) => {
  const plan = withHikeDefaults(raw);
  const days = [...new Set([...plan.options, plan.day])];
  const treePick = plan.options[0] ?? plan.day;
  const choosable = !!onChoose && !plan.today && days.length > 1;
  const forecastOf = (date: string): HikeDayScore | null =>
    plan.week7.find((d) => d?.date === date) ?? (date === plan.day ? { date, score: 0, sky: plan.forecast.sky, tMax: plan.forecast.tMax, rainChance: plan.forecast.rainChance } : null);
  return (
    <Bubble accent title={`The tree reads the forecast and picks the best day of each week for your hike.${preview ? ' (preview)' : ''}`}>
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
    </Bubble>
  );
};
