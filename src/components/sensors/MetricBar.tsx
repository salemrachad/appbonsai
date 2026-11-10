import React from 'react';
import type { MetricScale } from '../../health/metricScale';
import type { MetricTone } from '../../health/healthTypes';

// Draws a metric's range bar (health/metricScale.ts decides the zones; nothing is judged here).
// Each zone in its tone, the one the reading is in a little stronger, and a pin at the reading.

const TONE_VAR: Record<MetricTone, string> = {
  good: 'var(--tone-good)',
  info: 'var(--tone-info)',
  caution: 'var(--tone-caution)',
  alert: 'var(--tone-alert)',
  off: 'var(--line-strong)',
};

const at = (v: number, s: MetricScale) => ((v - s.min) / (s.max - s.min)) * 100;

export const MetricBar: React.FC<{ scale: MetricScale; compact?: boolean; showZones?: boolean }> = ({ scale, compact, showZones }) => {
  const here = scale.zones.find((z) => scale.value >= z.from && scale.value <= z.to) ?? null;
  const pin = Math.max(1.5, Math.min(98.5, at(scale.value, scale)));
  return (
    <div className="w-full">
      <div className={`relative w-full ${compact ? 'h-1.5' : 'h-2.5'} rounded-full overflow-visible`}>
        <div className="absolute inset-0 rounded-full overflow-hidden flex">
          {scale.zones.map((z, i) => (
            <div
              key={i}
              title={z.label}
              className="h-full"
              style={{
                width: `${at(z.to, scale) - at(z.from, scale)}%`,
                background: TONE_VAR[z.tone],
                opacity: z === here ? 0.75 : z.tone === 'good' ? 0.32 : 0.2,
                borderRight: i < scale.zones.length - 1 ? '1px solid var(--paper)' : undefined,
              }}
            />
          ))}
        </div>
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-700 ease-out"
          style={{
            left: `${pin}%`,
            width: compact ? 9 : 13,
            height: compact ? 9 : 13,
            background: here ? TONE_VAR[here.tone] : 'var(--ink)',
            border: '2px solid var(--paper)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
          }}
        />
      </div>
      {!compact && (
        <div className="relative h-3.5 mt-1 text-[9.5px] font-mono text-[var(--ink)]/45">
          {scale.ticks.map((t) => (
            <span key={t.at} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${at(t.at, scale)}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      )}
      {showZones && (
        <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1 text-[10px] text-[var(--ink)]/55">
          {scale.zones.map((z, i) => (
            <span key={i} className={`inline-flex items-center gap-1 ${z === here ? 'font-semibold text-[var(--ink)]' : ''}`}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TONE_VAR[z.tone], opacity: z === here ? 1 : 0.55 }} />
              {z.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
