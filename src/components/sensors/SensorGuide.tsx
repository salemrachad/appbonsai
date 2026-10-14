import React, { useEffect, useRef, useState } from 'react';
import type { MetricGuide, MetricTone } from '../../health/healthTypes';

const DOT: Record<MetricTone, string> = {
  good: 'bg-[#4A6741]',
  info: 'bg-[#6B8FA8]',
  caution: 'bg-[#D49B53]',
  alert: 'bg-[#C14B3D]',
  off: 'bg-[#2D332A]/25',
};

// The explanation itself: best range, every band (the current one highlighted) and how conditions start.
export const GuideBody: React.FC<{ guide: MetricGuide; className?: string }> = ({ guide, className = '' }) => (
  <div className={`text-[#2D332A] space-y-2.5 sans text-left ${className}`}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-bold">{guide.title}</span>
      <span className="text-[11px] text-[#2D332A]/60">
        Best: <strong className="text-[#3D5535]">{guide.best}</strong>
      </span>
    </div>
    <div className="space-y-0.5">
      {guide.bands.map((b) => (
        <div
          key={b.label}
          className={`flex items-center justify-between gap-2 px-1.5 py-0.5 rounded-md text-[11px] ${b.current ? 'bg-[#2D332A]/[0.06] font-bold' : ''}`}
        >
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${DOT[b.tone]}`} />
            {b.label}
            {b.current && <span className="text-[10px] font-semibold text-[#2D332A]/50">← now</span>}
          </span>
          <span className="font-mono text-[10.5px] text-[#2D332A]/70">{b.range}</span>
        </div>
      ))}
    </div>
    <ul className="space-y-1 pt-1.5 border-t border-[#ECE5D8]">
      {guide.notes.map((n) => (
        <li key={n} className="text-[10.5px] leading-snug text-[#2D332A]/65">
          {n}
        </li>
      ))}
    </ul>
  </div>
);

// Click-to-open popup state: toggles on click, closes on a click elsewhere or Escape.
// Put `ref` on the element that holds both the trigger and the popup.
export function useGuidePopup() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, toggle: () => setOpen((o) => !o), ref };
}

// Popup explaining a sensor's best conditions and ranges. Content comes from the species
// profile via MetricAssessment.guide; this only lays it out. Place it inside a `relative` container.
export const SensorGuide: React.FC<{ guide: MetricGuide; open: boolean; align?: 'left' | 'right'; placement?: 'above' | 'below' }> = ({
  guide,
  open,
  align = 'left',
  placement = 'above',
}) => (
  <div
    role="dialog"
    aria-hidden={!open}
    onClick={(e) => e.stopPropagation()} // reading the popup doesn't toggle it
    className={`day absolute z-30 w-72 transition-all duration-200 ${open ? 'opacity-100 translate-y-0' : 'pointer-events-none opacity-0 translate-y-1'} ${
      align === 'right' ? 'right-0' : 'left-0'
    } ${placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
  >
    <GuideBody guide={guide} className="rounded-2xl bg-[#FBF9F6] border border-[#E4DDD2] shadow-xl p-3.5" />
  </div>
);
