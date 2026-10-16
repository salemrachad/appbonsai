import React from 'react';
import { hhmm } from '../../lib/time';

// Small building blocks shared by the developer panels.

export const Section: React.FC<{ title: string; children: React.ReactNode; aside?: React.ReactNode }> = ({ title, children, aside }) => (
  <div className="p-4 rounded-2xl bg-white/80 border border-[#EAE6E1] space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h4 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/55">{title}</h4>
      {aside}
    </div>
    {children}
  </div>
);

export const Row: React.FC<{ label: string; value: React.ReactNode; strong?: boolean; tone?: 'minus' | 'plus' | 'muted' }> = ({ label, value, strong, tone }) => (
  <div className="flex items-baseline justify-between gap-3 sans text-[11px] leading-snug">
    <span className="text-[#2D332A]/60">{label}</span>
    <span
      className={`font-mono text-right ${strong ? 'font-bold text-[#2D332A] text-xs' : 'text-[#2D332A]/85'} ${
        tone === 'minus' ? 'text-[#A64F34]' : tone === 'plus' ? 'text-[#3D5535]' : tone === 'muted' ? 'text-[#2D332A]/40' : ''
      }`}
    >
      {value}
    </span>
  </div>
);

export const Pill: React.FC<{ children: React.ReactNode; dark?: boolean }> = ({ children, dark }) => (
  <span
    className={`sans text-[10.5px] px-2 py-0.5 rounded-full ${
      dark ? 'bg-[#2D332A] text-white font-bold' : 'bg-[#F8F5F2] border border-[#D8D2C9] text-[#2D332A]/75'
    }`}
  >
    {children}
  </span>
);

export function ago(t: number | null | undefined, now = Date.now()): string {
  if (t === null || t === undefined) return '–';
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 90) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m ago` : `${Math.round(h / 24)} days ago`;
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  return `${h}h ${Math.round(minutes % 60)}m`;
}

export const clock = (t: number | null | undefined) =>
  t ? hhmm(t) : '–';
