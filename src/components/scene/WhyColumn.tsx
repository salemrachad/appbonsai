import React, { useMemo, useState } from 'react';
import { ChevronDown, Clock, Eye, Globe, Heart, HelpCircle, Leaf, Moon, PanelLeftClose, Signal, Smile, Wind, X } from 'lucide-react';
import type { PlantBehaviourState } from '../../behaviour/behaviourTypes';
import { explainTree, type WhyCard, type WhyIcon } from '../../explain/why';
import type { ExpressionState } from '../../expression/expressionTypes';
import type { PlantHealthState } from '../../health/healthTypes';
import type { PerceptionState } from '../../perception/perceptionTypes';
import { ACTIVE_SPECIES } from '../../species';

const OPEN_KEY = 'appbonsai_why_open_v1'; // per-viewer convenience: the column folded or not

const ICON: Record<WhyIcon, typeof Leaf> = { leaf: Leaf, eye: Eye, heart: Heart, smile: Smile, wind: Wind, clock: Clock, globe: Globe, moon: Moon, signal: Signal };
const TINT: Record<WhyIcon, string> = { leaf: '#4A6741', eye: '#B87D33', heart: '#C9756D', smile: '#C99A3A', wind: '#5F8A7A', clock: '#8B7B66', globe: '#356077', moon: '#7A6FB8', signal: '#7C8FA3' };

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};
const saveOpen = (open: boolean) => {
  try {
    localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    /* private window: just this visit */
  }
};

interface Props {
  perception: PerceptionState | null;
  health: PlantHealthState | null;
  behaviour: PlantBehaviourState | null;
  expression: ExpressionState | null;
  previewing?: boolean;
}

// One card: an icon, a human title and a sentence or two; a tap opens the exact figures behind it
const Card: React.FC<{ card: WhyCard }> = ({ card }) => {
  const [open, setOpen] = useState(false);
  const Icon = ICON[card.icon];
  return (
    <button
      type="button"
      onClick={() => card.details.length && setOpen((o) => !o)}
      className="glass rounded-2xl px-3.5 py-3 text-left w-full cursor-pointer hover:brightness-[1.02] transition"
      aria-expanded={open}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: TINT[card.icon] }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="sans text-[12.5px] font-semibold text-[var(--ink)] leading-snug">{card.title}</h4>
            {card.details.length > 0 && <ChevronDown className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--ink)]/35 transition-transform ${open ? 'rotate-180' : ''}`} />}
          </div>
          <p className="serif text-[13.5px] leading-relaxed text-[var(--ink)]/75 mt-1">{card.body}</p>
          {open && (
            <ul className="mt-2 pt-2 border-t border-[var(--ink)]/10 space-y-0.5">
              {card.details.map((d, k) => (
                <li key={k} className="font-mono text-[10px] leading-snug text-[var(--ink)]/55 break-words">
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </button>
  );
};

// "Why": the tree explained, beside it on the left (src/explain/why.ts writes it; this only shows it). Its own
// scrolling column on wide screens, folding to a slim tab; on narrower ones a "Why?" button opens it as a drawer.
export const WhyColumn: React.FC<Props> = ({ perception, health, behaviour, expression, previewing = false }) => {
  const [open, setOpen] = useState(readOpen);
  const [drawer, setDrawer] = useState(false);
  const cards = useMemo(() => {
    if (!perception || !health || !behaviour || !expression) return [];
    try {
      return explainTree({ perception, health, behaviour, expression, species: ACTIVE_SPECIES, now: behaviour.evaluatedAt });
    } catch {
      return []; // an older server's state missing a field: no explanation rather than a broken page
    }
  }, [perception, health, behaviour, expression]);
  if (!cards.length) return null;

  const list = (
    <div className="flex flex-col gap-2.5 pb-6">
      {previewing && <p className="sans text-[10.5px] text-[#8F5E24] px-1">Explaining the preview, not the live tree.</p>}
      {cards.map((c) => (
        <Card key={c.id} card={c} />
      ))}
    </div>
  );
  const header = (onClose: () => void, closeIcon: typeof X, closeTitle: string) => {
    const Close = closeIcon;
    return (
      <div className="flex items-start justify-between gap-2 px-1 pb-2">
        <div>
          <h3 className="serif text-xl italic text-[var(--ink)] leading-none">Why</h3>
          <p className="sans text-[10.5px] text-[var(--ink)]/50 mt-1">What the tree is going through, and why</p>
        </div>
        <button type="button" onClick={onClose} title={closeTitle} className="p-1 rounded-md text-[var(--ink)]/40 hover:text-[var(--ink)]/75 cursor-pointer">
          <Close className="w-4 h-4" />
        </button>
      </div>
    );
  };
  const toggle = (o: boolean) => {
    setOpen(o);
    saveOpen(o);
  };

  return (
    <>
      {/* Wide screens: its own column */}
      <aside id="why-column" className="hidden xl:flex flex-col h-full min-h-0 self-stretch">
        {open ? (
          <>
            {header(() => toggle(false), PanelLeftClose, 'Fold the explanation')}
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">{list}</div>
          </>
        ) : (
          <button type="button" onClick={() => toggle(true)} className="glass rounded-2xl px-2 py-4 self-start flex flex-col items-center gap-2 cursor-pointer text-[var(--ink)]/60 hover:text-[var(--ink)]" title="Why is the tree like this?">
            <HelpCircle className="w-4 h-4" />
            <span className="sans text-[11px] font-semibold [writing-mode:vertical-rl] rotate-180">Why</span>
          </button>
        )}
      </aside>
      {/* Narrower screens: a button at the left edge, the same column in a drawer */}
      <button
        type="button"
        onClick={() => setDrawer(true)}
        className="xl:hidden fixed left-3 bottom-4 z-30 glass rounded-full px-3 py-1.5 sans text-xs font-semibold text-[var(--ink)]/75 flex items-center gap-1.5 cursor-pointer"
      >
        <HelpCircle className="w-3.5 h-3.5" /> Why?
      </button>
      {drawer && (
        <div className="xl:hidden fixed inset-0 z-40 flex" onClick={() => setDrawer(false)}>
          <div className="absolute inset-0 bg-black/20" />
          <div className="relative w-[min(22rem,88vw)] h-full bg-[var(--paper)] shadow-xl p-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
            {header(() => setDrawer(false), X, 'Close')}
            <div className="flex-1 min-h-0 overflow-y-auto">{list}</div>
          </div>
        </div>
      )}
    </>
  );
};
