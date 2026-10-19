import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../api/client';
import type { DiaryItem } from '../../history/historyTypes';
import { dayStartOf } from '../../history/moments';
import { hhmm, MIN } from '../../lib/time';

const OPEN_KEY = 'appbonsai_tree_diary_open_v1'; // per-viewer convenience: the diary folded or not
const SHOWN = 5; // diary lines visible at once on Home (newest first); the rest by scrolling
const REFRESH_MS = 5 * MIN; // besides reloadKey (something new was said or happened)

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

// The tree's diary as quiet chat bubbles over the left of the scene: ALL of today's diary (/api/history/diary:
// the same list as History) in a narrow column left of the crown: newest first, the column as tall as its first
// SHOWN lines, the rest by scrolling. Folds away to a small label. reloadKey: changes when the tree says
// something new or an episode or care event changes, so the column follows the tree at once. (The week's hike
// is its own panel on the right, under the Outside panel: HikePanel.)
export const TreeDiary: React.FC<{ reloadKey?: string; onOpenDiary?: () => void }> = ({ reloadKey = '', onOpenDiary }) => {
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
          if (alive) setItems([...d].filter((i) => i.at >= today).sort((a, b) => b.at - a.at));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [reloadKey]);

  // The column shows the newest SHOWN lines (bubbles differ in height: measured), the rest by scrolling; a new
  // line brings it back to the top
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = column.current;
    if (!el) return;
    const last = el.children[Math.min(SHOWN, el.children.length) - 1] as HTMLElement | undefined;
    // The column is position: relative, so a bubble's offsetTop is measured from the column's own top
    setHeight(el.children.length > SHOWN && last ? last.offsetTop + last.offsetHeight : undefined);
    el.scrollTop = 0;
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

  const count = items.length;
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
          <div ref={column} style={{ maxHeight: height }} className="relative max-w-[9.5rem] overflow-y-auto overscroll-contain pr-1 flex flex-col items-start gap-1">
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
const Bubble: React.FC<{ at?: number; title?: string; kind?: DiaryItem['kind']; children: React.ReactNode }> = ({ at, title, kind, children }) => (
  <div className="max-w-full tree-diary-in" title={title}>
    <div
      className={`rounded-2xl rounded-tl-md backdrop-blur-md leading-snug ${
        kind === 'said'
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
