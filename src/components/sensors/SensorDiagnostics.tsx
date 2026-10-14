import React, { useEffect, useState } from 'react';
import { X, Droplet, Sun, Thermometer, Wind } from 'lucide-react';
import type { MetricGuide, MetricId } from '../../health/healthTypes';
import { LiveReading } from '../../telemetry/types';
import { SensorGuide, useGuidePopup } from './SensorGuide';

interface SensorDiagnosticsProps {
  readings: LiveReading[];
  source: string;
  pollMs: number;
  tempUnit: 'C' | 'F';
  lightUnit: string;
  guides?: Partial<Record<MetricId, MetricGuide>>; // best conditions per sensor (hover tooltips)
  onClose: () => void;
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 240;
  const h = 40;
  if (values.length < 2) {
    return <div className="h-10 flex items-center text-[11px] text-[var(--ink)]/30">Waiting for readings…</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 4 - ((v - min) / span) * (h - 8)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-10" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtDelta = (d: number | null) => (d === null || d === 0 ? '±0' : d > 0 ? `+${round1(d)}` : `${round1(d)}`);

interface ChannelProps {
  name: string;
  icon: React.ReactNode;
  color: string;
  unit: string;
  values: (number | null)[];
  sub?: string;
  guide?: MetricGuide;
  align?: 'left' | 'right';
}

// One sensor column: live value, change since the previous reading, and its trend.
const Channel: React.FC<ChannelProps> = ({ name, icon, color, unit, values, sub, guide, align }) => {
  const series = values.filter((v): v is number => v !== null);
  const last = values[values.length - 1] ?? null;
  const prev = values[values.length - 2] ?? null;
  const delta = last !== null && prev !== null ? last - prev : null;
  const popup = useGuidePopup();

  return (
    <div
      ref={popup.ref}
      onClick={guide ? popup.toggle : undefined}
      className={`px-5 first:pl-0 last:pr-0 min-w-0 relative ${guide ? 'cursor-pointer' : ''}`}
      title={guide && !popup.open ? 'Best conditions & ranges' : undefined}
    >
      {guide && <SensorGuide guide={guide} open={popup.open} align={align} placement="above" />}
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-[var(--ink)]/45">
        {icon}
        {name}
      </div>
      {last === null ? (
        <>
          <div className="text-sm text-[var(--ink)]/35 mt-1.5 h-7 flex items-center">Sensor not connected</div>
          <div className="h-10" />
        </>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className="text-2xl font-semibold tabular-nums">
              {round1(last)}
              <span className="text-sm font-normal text-[var(--ink)]/50 ml-0.5">{unit}</span>
            </span>
            <span className="text-xs text-[var(--ink)]/45 tabular-nums">{fmtDelta(delta)}</span>
            {sub && <span className="ml-auto text-[10px] text-[var(--ink)]/40 tabular-nums truncate">{sub}</span>}
          </div>
          <Sparkline values={series} color={color} />
        </>
      )}
    </div>
  );
};

// Bottom strip with raw live sensor values and trends, to confirm readings are actually updating.
export const SensorDiagnostics: React.FC<SensorDiagnosticsProps> = ({ readings, source, pollMs, tempUnit, lightUnit, guides, onClose }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const last = readings[readings.length - 1];
  const ago = last ? Math.round((now - last.t) / 1000) : null;
  const late = ago !== null && ago * 1000 > pollMs * 2.5;
  const pollLabel = pollMs >= 60000 ? `${pollMs / 60000} min` : `${pollMs / 1000}s`;
  const toUnit = (c: number | null) => (c === null ? null : tempUnit === 'F' ? (c * 9) / 5 + 32 : c);

  return (
    <section className="shrink-0 border-t border-[var(--line)] bg-white/50 sans text-[var(--ink)]">
      <div className="max-w-6xl mx-auto px-8 pt-2.5 pb-3">
        <div className="flex items-center justify-between text-[11px] text-[var(--ink)]/50 mb-2">
          <div className="flex items-center gap-2 tabular-nums">
            <span className="font-semibold text-[var(--ink)]/70">Live sensors</span>
            <span>·</span>
            <span className={late ? 'text-[#A64F34] font-medium' : ''}>
              {ago === null ? 'no readings yet' : `last reading ${ago}s ago`}
            </span>
            <span>·</span>
            <span>{readings.length} readings</span>
            <span>·</span>
            <span>
              {source}, every {pollLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-[var(--ink)]/35 hover:text-[var(--ink)] cursor-pointer"
            title="Hide live sensors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-4 divide-x divide-[var(--line)]">
          <Channel
            name="Soil moisture"
            icon={<Droplet className="w-3 h-3 text-[#356077]" />}
            color="#356077"
            unit="%"
            values={readings.map((r) => r.moisture)}
            sub={last?.soilRaw != null ? `raw ${last.soilRaw}` : undefined}
            guide={guides?.soil}
          />
          <Channel
            name="Light"
            icon={<Sun className="w-3 h-3 text-[#D49B53]" />}
            color="#D49B53"
            unit={lightUnit}
            values={readings.map((r) => r.light)}
            sub={last?.lightRaw != null ? `raw ${last.lightRaw}` : undefined}
            guide={guides?.light}
          />
          <Channel
            name="Temperature"
            icon={<Thermometer className="w-3 h-3 text-[#D97757]" />}
            color="#D97757"
            unit={`°${tempUnit}`}
            values={readings.map((r) => toUnit(r.temperature))}
            guide={guides?.temperature}
            align="right"
          />
          <Channel
            name="Humidity"
            icon={<Wind className="w-3 h-3 text-[#4A6741]" />}
            color="#4A6741"
            unit="%"
            values={readings.map((r) => r.humidity)}
            guide={guides?.humidity}
            align="right"
          />
        </div>
      </div>
    </section>
  );
};
