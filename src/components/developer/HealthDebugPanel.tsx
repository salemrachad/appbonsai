import React from 'react';
import { Activity } from 'lucide-react';
import type { PlantHealthState } from '../../health/healthTypes';
import { CONDITION_LABELS } from '../../health/labels';
import type { PerceptionState } from '../../perception/perceptionTypes';
import { ago, clock, Pill, Row, Section } from './debugUi';

interface Props {
  live: PlantHealthState | null; // always the real calculation, even while a preview is shown
  perception: PerceptionState | null;
  previewing: boolean;
}

const fmt = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? '–' : `${v}${unit}`);
const sign = (n: number) => (n > 0 ? `-${Math.round(n * 10) / 10}` : '0');

// Why vitality has its value: every step of the live calculation, plus the hysteresis latches.
export const HealthDebugPanel: React.FC<Props> = ({ live, perception: p, previewing }) => {
  if (!live || !p) return <Section title="Health debug">Waiting for the first evaluation…</Section>;
  const b = live.breakdown;
  const r = p.readings;

  return (
    <div className="space-y-3" id="health-debug-panel">
      <h3 className="sans text-xs font-bold uppercase tracking-wider text-[#2D332A] flex items-center gap-2">
        <Activity className="w-4 h-4 text-[#4A6741]" /> Health debug
        {previewing && <span className="normal-case font-medium text-[#8F5E24]">(live calculation, not the preview)</span>}
      </h3>

      <Section title="Current sensor readings" aside={<span className="sans text-[10px] text-[#2D332A]/45">{p.source ?? 'no source'} · {ago(p.device.lastReadingAt)}</span>}>
        <div className="grid grid-cols-2 gap-x-5 gap-y-1">
          <Row label="Soil moisture" value={fmt(r.soilMoisture, '%')} />
          <Row label="Soil raw ADC" value={fmt(r.soilRaw)} />
          <Row label="Temperature" value={fmt(r.temperature, '°C')} />
          <Row label="Humidity" value={fmt(r.humidity, '%')} />
          <Row label="Light (relative)" value={fmt(r.lightPercent, '%')} />
          <Row label="Light raw ADC" value={fmt(r.lightRaw)} />
          <Row label="VPD" value={fmt(r.vpd, ' kPa')} />
          <Row label="Wi-Fi" value={fmt(p.device.wifiRssi, ' dBm')} />
        </div>
      </Section>

      <Section title="Perceived context">
        <Row label="Sun" value={`${p.sun.phase.replace('_', ' ')}${p.sun.elevation !== null ? ` · ${p.sun.elevation}°` : ''} (${p.sun.method})`} />
        <Row label="Daylight expected" value={p.sun.lightExpected ? 'yes' : 'no — light is neutral'} />
        <Row label="Trends / hour" value={`soil ${fmt(p.trends.soilPerHour, '%')} · temp ${fmt(p.trends.temperaturePerHour, '°')} · RH ${fmt(p.trends.humidityPerHour, '%')}`} />
        <Row label="Continuous history" value={`${p.history.minutes} min · ${p.history.samples} samples`} />
        <Row label="Last watering" value={p.care.lastWatering ? ago(p.care.lastWatering.timestamp) : '–'} />
        <Row label="Confidence" value={`${live.confidence} (${live.confidenceScore})`} strong />
        <Row
          label="Observation"
          value={`${live.observation.status}${live.observation.unobservedMinutes ? ` · ${live.observation.unobservedMinutes} min without live data` : ''}`}
          tone={live.observation.status === 'live' ? undefined : 'minus'}
        />
        <Row label="Suspect sensors" value={Object.entries(p.quality.suspect).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'} />
        {live.dataIssues.map((i) => (
          <p key={i} className="sans text-[10.5px] text-[#8F5E24]">• {i}</p>
        ))}
      </Section>

      <Section title="Component health scores">
        <table className="w-full sans text-[11px]">
          <thead>
            <tr className="text-[#2D332A]/45 text-left">
              <th className="font-semibold pb-1">Score</th>
              <th className="font-semibold pb-1 text-right">Health</th>
              <th className="font-semibold pb-1 text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {b.components.map((c) => (
              <tr key={c.id} className="align-top border-t border-[#F0ECE6]">
                <td className="py-1 pr-2">
                  <div className="font-semibold text-[#2D332A]">{c.label}</div>
                  <div className="text-[10px] text-[#2D332A]/50">{c.note}</div>
                </td>
                <td className="py-1 text-right font-mono">{c.score === null ? <span className="text-[#2D332A]/40">neutral</span> : `${c.score}/100`}</td>
                <td className="py-1 text-right font-mono text-[#2D332A]/60">{c.score === null ? '–' : c.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Vitality calculation">
        <Row label="Weighted base" value={b.weightedBase} />
        {b.durationPenalties.length === 0 && <Row label="Duration penalties" value="none" tone="muted" />}
        {b.durationPenalties.map((x) => (
          <Row key={x.label} label={`${x.label} (${x.detail})`} value={sign(x.points)} tone="minus" />
        ))}
        {b.combinedMultiplier > 1 && <Row label="Combined stressors" value={`× ${b.combinedMultiplier}`} tone="minus" />}
        {b.combinedExtra > 0 && <Row label="Hot + dry together" value={sign(b.combinedExtra)} tone="minus" />}
        <Row label="Recovery modifier" value={b.recoveryModifier ? sign(b.recoveryModifier) : '0'} tone={b.recoveryModifier ? 'minus' : 'muted'} />
        <Row label="Target (where it's heading)" value={b.target} />
        <Row
          label="Gradual change"
          value={
            b.frozen
              ? 'frozen — no fresh data'
              : b.smoothing
              ? `${b.previous?.toFixed(1)} → ${b.final.toFixed(1)} (τ ${b.smoothing.tauHours}h, ${b.smoothing.minutes} min, α ${b.smoothing.alpha})`
              : 'first evaluation'
          }
        />
        <div className="pt-1 border-t border-[#F0ECE6]">
          <Row label="Final vitality" value={`${live.vitality}%  (${live.qualitative})`} strong />
        </div>
      </Section>

      <Section title="State">
        <div className="flex flex-wrap gap-1.5">
          <Pill dark>{CONDITION_LABELS[live.condition]}</Pill>
          {live.modifiers.map((m) => (
            <Pill key={m}>+ {CONDITION_LABELS[m]}</Pill>
          ))}
        </div>
        <Row label="Severity" value={live.severity} />
        {(Object.entries(live.activeSince) as [string, number][]).map(([c, t]) => (
          <Row key={c} label={`${CONDITION_LABELS[c as keyof typeof CONDITION_LABELS]} since`} value={`${clock(t)} (${ago(t)})`} />
        ))}
      </Section>

      <Section title="Hysteresis">
        <table className="w-full sans text-[10.5px]">
          <tbody>
            {live.hysteresis.map((h) => (
              <tr key={h.id} className="align-top border-t border-[#F0ECE6] first:border-0">
                <td className="py-1 pr-2 font-semibold text-[#2D332A] whitespace-nowrap">{h.id.replace(/_/g, ' ')}</td>
                <td className="py-1 pr-2 font-mono whitespace-nowrap">
                  {h.active ? (
                    <span className="text-[#A64F34] font-bold">ON {clock(h.since)}{h.observedMinutes !== null ? ` · ${h.observedMinutes}m seen` : ''}</span>
                  ) : h.pendingSince ? (
                    <span className="text-[#B87D33]">pending {ago(h.pendingSince)}</span>
                  ) : (
                    <span className="text-[#2D332A]/35">off</span>
                  )}
                </td>
                <td className="py-1 pr-2 font-mono text-right">{h.value ?? '–'}</td>
                <td className="py-1 text-[#2D332A]/50">{h.gated ? `skipped: ${h.gated}` : h.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
};
