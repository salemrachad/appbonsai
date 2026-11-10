import React, { useState } from 'react';
import { X, Droplets, Sun, Thermometer, Wind, Activity, Sparkles, Info, Radio, Cpu, ShieldCheck, ShieldAlert } from 'lucide-react';
import { PlantHealthState, MetricAssessment, MetricId } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { metricScale } from '../health/metricScale';
import { luxText } from '../health/metrics';
import type { DailySummary } from '../history/historyTypes';
import { SpeciesProfile } from '../species';
import { HourlyTelemetryPoint, PlantTelemetry, TimelineEvent } from '../telemetry/types';
import { METRIC_TONE_CLASS } from './sensors/SensorCard';
import { MetricBar } from './sensors/MetricBar';
import { TodayTimeline } from './TodayTimeline';
import { GuideBody } from './sensors/SensorGuide';
import { hhmmss } from '../lib/time';

interface DetailViewProps {
  health: PlantHealthState;
  message: string;
  tip: string;
  telemetry: PlantTelemetry | null; // latest reading (may be stale), for the lux and the sensor diagnostics
  species: SpeciesProfile;
  hourly: HourlyTelemetryPoint[]; // last 24h (forecast for weather, recorded history for sensors)
  days: DailySummary[];
  timeline: TimelineEvent[];
  locationName: string;
  onClose: () => void;
}

const METRIC_ICON: Record<MetricId, { Icon: typeof Droplets; color: string }> = {
  soil: { Icon: Droplets, color: '#3A86C8' },
  light: { Icon: Sun, color: '#E99E10' },
  temperature: { Icon: Thermometer, color: '#D65A31' },
  humidity: { Icon: Wind, color: '#52796F' },
  vpd: { Icon: Activity, color: '#457B9D' },
};

const r1 = (n: number) => Math.round(n * 10) / 10;

const MetricRow: React.FC<{ m: MetricAssessment; lux: number | null; species: SpeciesProfile }> = ({ m, lux, species }) => {
  const { Icon, color } = METRIC_ICON[m.id];
  const scale = metricScale(m, species, { lux });
  return (
    <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}1A` }}>
            <Icon className="w-4 h-4" style={{ color }} />
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-wider font-bold text-[#2C302E]/55">
              {m.name}
              {m.estimated && <span className="ml-1.5 normal-case tracking-normal font-semibold text-[#8F5E24]">estimated</span>}
            </span>
            <span className={`text-[11px] ${METRIC_TONE_CLASS[m.tone]}`}>
              {m.status}
              {m.detail && (
                <span className="font-normal text-[#2C302E]/55">
                  {' · '}
                  {m.detail}
                  {m.detailStatus && <span className={METRIC_TONE_CLASS[m.detailTone ?? 'info']}> {m.detailStatus}</span>}
                </span>
              )}
            </span>
          </div>
        </div>
        <span className="serif text-xl font-medium text-[#2C302E] tracking-tight whitespace-nowrap">{m.tone === 'off' ? '–' : m.display}</span>
      </div>
      {scale && <MetricBar scale={scale} showZones />}
      <div className="text-[10px] text-[#7C827D]">
        Comfortable: <span className="font-semibold text-[#4A7C59]">{m.idealRange}</span>
        {m.id === 'light' && !m.estimated && (lux != null ? ' · the tree’s light scale (a log scale of the BH1750’s lux)' : ' · relative light %')}
      </div>
      {m.guide && (
        <details className="group/details">
          <summary className="text-[10.5px] font-semibold text-[#4A7C59] cursor-pointer select-none list-none">
            <span className="group-open/details:hidden">Best conditions & ranges ›</span>
            <span className="hidden group-open/details:inline">Hide ranges ‹</span>
          </summary>
          <GuideBody guide={m.guide} className="mt-2 p-3 rounded-xl bg-[#FAF7F2] border border-[#EBE4D7]" />
        </details>
      )}
    </div>
  );
};

const ringColor = (v: number) => (v >= 75 ? 'var(--tone-good)' : v >= 50 ? 'var(--tone-caution)' : 'var(--tone-alert)');

// Vitality as a ring; the faint arc is where it's heading
const VitalityRing: React.FC<{ value: number; target: number; size?: number }> = ({ value, target, size = 56 }) => {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = ringColor(value);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={`Vitality ${Math.round(value)}`}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E9E4DB" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="5" strokeDasharray={`${(Math.min(100, target) / 100) * c} ${c}`} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} className="transition-all duration-700" />
      </g>
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="sans" fontSize={size * 0.3} fontWeight="700" fill="#2D332A">
        {Math.round(value)}
      </text>
    </svg>
  );
};

const scoreColor = (n: number) => (n >= 85 ? 'var(--tone-good)' : n >= 60 ? 'var(--tone-info)' : n >= 40 ? 'var(--tone-caution)' : 'var(--tone-alert)');

// What vitality is made of: the live calculation, told plainly (Developer → Health debug has every step)
const VitalityTab: React.FC<{ health: PlantHealthState }> = ({ health }) => {
  const b = health.breakdown;
  const total = b.components.reduce((a, c) => a + (c.score === null ? 0 : c.weight), 0) || 1;
  const offs = [
    ...b.durationPenalties.map((x) => ({ label: x.label, detail: x.detail, points: x.points })),
    ...(b.combinedExtra > 0 ? [{ label: 'Hot and dry together', detail: 'the two stresses add up', points: b.combinedExtra }] : []),
    ...(b.recoveryModifier ? [{ label: 'Still recovering', detail: 'a dip that fades as it settles', points: b.recoveryModifier }] : []),
    ...(b.leafDropModifier ? [{ label: 'Leaf drop', detail: 'seen in the daily photos', points: b.leafDropModifier }] : []),
  ];
  const heading = b.frozen
    ? 'held: no fresh data'
    : Math.abs(b.target - b.final) < 1
    ? 'steady'
    : b.target > b.final
    ? `rising toward ${Math.round(b.target)}`
    : `easing toward ${Math.round(b.target)}`;
  return (
    <div className="space-y-3.5">
      <div className="p-4 rounded-2xl bg-white border border-[#ECE5D8] flex items-center gap-4">
        <VitalityRing value={health.vitality} target={b.target} size={72} />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-[#2D332A]">
            {health.qualitative} · {heading}
          </span>
          <span className="text-[11px] text-[#2D332A]/60 leading-relaxed">
            Vitality is accumulated wellbeing, not today’s readings averaged. It drifts toward its target over hours, so a short spell barely moves it.
          </span>
        </div>
      </div>

      <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[#2C302E]">What it’s made of</span>
          <span className="text-[10.5px] text-[#2C302E]/50 font-mono">base {r1(b.weightedBase)}</span>
        </div>
        {b.components.map((c) => (
          <div key={c.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="font-semibold text-[#2C302E]">
                {c.label}
                {c.score !== null && <span className="ml-1.5 font-normal text-[#2C302E]/45">{Math.round((c.weight / total) * 100)}% of the base</span>}
              </span>
              <span className="font-mono text-[#2C302E]/75">{c.score === null ? <span className="text-[#2C302E]/40">not counted</span> : c.score}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#E9E4DB] overflow-hidden">
              {c.score !== null && <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />}
            </div>
            <div className="text-[10px] text-[#2C302E]/50">{c.note}</div>
          </div>
        ))}
      </div>

      <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-1.5">
        <span className="text-xs font-bold text-[#2C302E]">What’s weighing on it</span>
        {offs.length === 0 ? (
          <p className="text-[11px] text-[#4A7C59]">Nothing: no lasting stress, no recovery dip.</p>
        ) : (
          offs.map((o) => (
            <div key={o.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span>
                <span className="font-semibold text-[#2C302E]">{o.label}</span> <span className="text-[#2C302E]/50">{o.detail}</span>
              </span>
              <span className="font-mono text-[var(--tone-alert)]">−{r1(o.points)}</span>
            </div>
          ))
        )}
        {b.combinedMultiplier > 1 && <p className="text-[10.5px] text-[#2C302E]/50">Several stresses at once: each weighs ×{b.combinedMultiplier}.</p>}
        <div className="flex items-baseline justify-between pt-1.5 mt-1 border-t border-[#F0ECE6] text-[11px]">
          <span className="font-semibold text-[#2C302E]">Target</span>
          <span className="font-mono font-bold text-[#2C302E]">{r1(b.target)}</span>
        </div>
      </div>
    </div>
  );
};

// One line of the sensor diagnostics
const Diag: React.FC<{ label: string; value: React.ReactNode; muted?: boolean }> = ({ label, value, muted }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-[#2C302E]/50">{label}</span>
    <span className={`font-mono ${muted ? 'text-[#2C302E]/35' : 'text-[#2C302E]/85'}`}>{value}</span>
  </div>
);

interface ChartProps {
  values: number[];
  labels: string[];
  unit: string;
  color: string;
  title?: string; // shown in the combined view
  compact?: boolean;
}

function Chart({ values, labels, unit, color, title, compact }: ChartProps) {
  if (values.length < 2)
    return (
      <div className="flex flex-col gap-1">
        {title && <span className="text-[11px] font-bold capitalize text-[#2C302E]">{title}</span>}
        <p className="text-xs text-neutral-400 py-6 text-center">Not enough data recorded yet</p>
      </div>
    );
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const w = 320;
  const h = 110;
  const p = 14;
  const pts = values.map((v, i) => `${p + (i / (values.length - 1)) * (w - 2 * p)},${h - p - ((v - min) / range) * (h - 2 * p)}`);
  const path = `M ${pts.join(' L ')}`;
  return (
    <div className="flex flex-col gap-1.5">
      {title && (
        <span className="text-[11px] font-bold capitalize flex items-center gap-1.5 text-[#2C302E]">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          {title}
        </span>
      )}
      <div className={`flex justify-between text-[#7A827B] ${compact ? 'text-[10.5px]' : 'text-xs'}`}>
        <span>Low: <strong className="text-[#2C302E]">{r1(min)}{unit}</strong></span>
        <span>High: <strong className="text-[#2C302E]">{r1(max)}{unit}</strong></span>
      </div>
      <div className="rounded-xl bg-[#FAF7F2] p-2 border border-[#EBE4D7]">
        <svg viewBox={`0 0 ${w} ${h}`} className={`w-full ${compact ? 'h-20' : 'h-28'}`} preserveAspectRatio="none">
          <path d={`${path} L ${w - p},${h - p} L ${p},${h - p} Z`} fill={color} opacity="0.12" />
          <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <div className="flex justify-between text-[10px] text-[#8A908A] px-2 pt-1 font-mono">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      </div>
    </div>
  );
}

type ChartMetric = 'soil' | 'temperature' | 'humidity' | 'light';
const CHART_METRICS: ChartMetric[] = ['soil', 'temperature', 'humidity', 'light'];

type Tab = 'health' | 'vitality' | 'trends' | 'today';

export const DetailView: React.FC<DetailViewProps> = ({ health, message, tip, telemetry, species, hourly, days, timeline, locationName, onClose }) => {
  const [tab, setTab] = useState<Tab>('health');
  const [chartMetric, setChartMetric] = useState<ChartMetric | 'all'>('soil');
  const [span, setSpan] = useState<'24h' | '7d'>('24h');
  const isSensor = telemetry?.source !== 'weather_estimate';
  const lux = isSensor ? telemetry?.lightLux ?? null : null;
  const hasLuxSensor = lux !== null;

  const chartData = (chartMetric: ChartMetric) => {
    const color = METRIC_ICON[chartMetric].color;
    const unit = chartMetric === 'temperature' ? '°C' : chartMetric === 'light' ? (isSensor ? '%' : ' W/m²') : '%';
    if (span === '24h') {
      const rows = hourly.flatMap((h) => {
        const v = chartMetric === 'soil' ? h.soilMoisture : chartMetric === 'temperature' ? h.temperature : chartMetric === 'humidity' ? h.humidity : h.light;
        return v === null ? [] : [{ v, label: h.time }];
      });
      return { values: rows.map((r) => r.v), labels: rows.map((r) => r.label), unit, color };
    }
    const rows = days.flatMap((d) => {
      const v = chartMetric === 'soil' ? d.avgSoil : chartMetric === 'temperature' ? d.avgTemp : chartMetric === 'humidity' ? d.avgHumidity : d.avgLight;
      return v === null ? [] : [{ v, label: d.dayLabel }];
    });
    return { values: rows.map((r) => r.v), labels: rows.map((r) => r.label), unit, color };
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`pb-2.5 px-3 sans text-xs font-semibold border-b-2 cursor-pointer ${
        tab === id ? 'border-[#4A6741] text-[#4A6741]' : 'border-transparent text-[#2D332A]/50 hover:text-[#2D332A]'
      }`}
    >
      {label}
    </button>
  );
  const pill = (active: boolean) =>
    `px-2.5 py-1 text-[11px] font-semibold rounded-lg capitalize cursor-pointer ${active ? 'bg-white text-[#2C302E] shadow-xs' : 'text-[#6C757D] hover:text-[#2C302E]'}`;

  const lightRawNote = hasLuxSensor ? 'log of lux' : 'ADC';
  const soilTemp = telemetry?.soilTemperature ?? null;

  return (
    <div id="bonsai-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="day w-full max-w-lg max-h-[88vh] bg-[#F8F5F2] text-[#2D332A] rounded-3xl border border-white/60 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[#EAE6E1] flex items-center justify-between gap-3 bg-white/70">
          <div className="flex items-center gap-3.5 min-w-0">
            <VitalityRing value={health.vitality} target={health.breakdown.target} />
            <div className="flex flex-col min-w-0">
              <h2 className="serif text-2xl font-medium text-[#2D332A] tracking-tight leading-tight">Tree Diagnostics</h2>
              <span className="sans text-xs font-semibold text-[#3D5535]">
                {health.qualitative} · {CONDITION_LABELS[health.condition]}
              </span>
              <div className="flex items-center gap-1.5 sans text-[11px] text-[#2D332A]/55 mt-0.5">
                <Radio className="w-3 h-3 text-[#4A6741] shrink-0" />
                <span className="truncate">
                  {!telemetry ? 'No reading yet' : isSensor ? `Live from the greenhouse ESP32 · ${hhmmss(telemetry.timestamp)}` : `Weather estimate · Open-Meteo (${locationName})`}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-neutral-200/50 text-[#2D332A]/70 cursor-pointer self-start">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-[#EAE6E1] px-4 pt-2">
          {tabBtn('health', 'Health')}
          {tabBtn('vitality', 'Vitality')}
          {tabBtn('trends', 'Charts')}
          {timeline.length > 0 && tabBtn('today', "Today's Rhythm")}
        </div>

        <div className="p-5 overflow-y-auto space-y-3.5 sans">
          {tab === 'health' && (
            <>
              <div className="p-3.5 rounded-2xl bg-[#4A7C59]/10 border border-[#4A7C59]/20 space-y-2">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-[#4A7C59] shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#2D5A3C]">{message}</span>
                    {tip && <span className="text-xs text-[#42614E] mt-0.5">{tip}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 pl-6">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#2D332A] text-white">{CONDITION_LABELS[health.condition]}</span>
                  {health.modifiers.map((m) => (
                    <span key={m} className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-[#D8D2C9] text-[#2D332A]/70">
                      + {CONDITION_LABELS[m]}
                    </span>
                  ))}
                  {health.isOverride && <span className="text-[11px] text-[#8F5E24]">(test preview)</span>}
                </div>
              </div>

              <div className="flex items-start gap-2 text-[11px] text-[#2D332A]/65 px-1">
                {health.confidence === 'high' ? (
                  <ShieldCheck className="w-4 h-4 text-[#4A7C59] shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-[#B87D33] shrink-0" />
                )}
                <span>
                  Data confidence: <strong className="capitalize">{health.confidence}</strong>
                  {health.dataIssues.length > 0 && ` · ${health.dataIssues.join(' · ')}`}
                </span>
              </div>

              {health.metrics.map((m) => (
                <MetricRow key={m.id} m={m} lux={m.id === 'light' ? lux : null} species={species} />
              ))}

              {isSensor && telemetry && (
                <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#356077]" />
                    <span className="text-xs font-bold text-[#2C302E]">Sensor diagnostics</span>
                    <span className="ml-auto text-[10px] font-mono text-[#2C302E]/45">{hhmmss(telemetry.timestamp)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-[11px]">
                    <Diag label="Soil (FC-28)" value={`${telemetry.soilMoisture}%`} />
                    <Diag label="Soil raw ADC" value={telemetry.soilRaw ?? '–'} muted={telemetry.soilRaw == null} />
                    <Diag label="Roots (DS18B20)" value={soilTemp !== null ? `${soilTemp}°C` : 'not fitted'} muted={soilTemp === null} />
                    <Diag
                      label="Air (HTS221)"
                      value={telemetry.htsConnected === false ? 'not connected' : telemetry.temperature !== null ? `${telemetry.temperature}°C · ${telemetry.humidity ?? '–'}%` : '–'}
                      muted={telemetry.htsConnected === false}
                    />
                    <Diag label={hasLuxSensor ? 'Light (BH1750)' : 'Light (LDR)'} value={hasLuxSensor ? `${luxText(lux)} lux` : telemetry.lightPercent != null ? `${telemetry.lightPercent}%` : '–'} />
                    <Diag label="Light scale" value={telemetry.lightPercent != null ? `${telemetry.lightPercent}% · ${telemetry.lightRaw ?? '–'} ${lightRawNote}` : '–'} />
                    <Diag label="VPD" value={telemetry.vpd !== null ? `${telemetry.vpd} kPa` : '–'} />
                    <Diag label="Wi-Fi" value={telemetry.wifiRssi != null ? `${telemetry.wifiRssi} dBm` : '–'} />
                  </div>
                  {telemetry.sensorIssues && telemetry.sensorIssues.length > 0 && (
                    <p className="text-[10.5px] text-[#8F5E24]">{telemetry.sensorIssues.join(' · ')}</p>
                  )}
                </div>
              )}
            </>
          )}

          {tab === 'vitality' && <VitalityTab health={health} />}

          {tab === 'today' && <TodayTimeline timeline={timeline} />}

          {tab === 'trends' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1 bg-[#ECE4D8]/60 p-1 rounded-xl">
                  {CHART_METRICS.map((m) => (
                    <button key={m} onClick={() => setChartMetric(m)} className={pill(chartMetric === m)}>
                      {m}
                    </button>
                  ))}
                  <button onClick={() => setChartMetric('all')} className={pill(chartMetric === 'all')}>
                    All
                  </button>
                </div>
                <div className="flex gap-1 bg-[#ECE4D8]/60 p-1 rounded-xl">
                  <button onClick={() => setSpan('24h')} className={pill(span === '24h')}>24h</button>
                  <button onClick={() => setSpan('7d')} className={pill(span === '7d')}>7 Days</button>
                </div>
              </div>
              {chartMetric === 'all' ? (
                <div className="grid grid-cols-2 gap-3">
                  {CHART_METRICS.map((m) => (
                    <div key={m}>
                      <Chart {...chartData(m)} title={m} compact />
                    </div>
                  ))}
                </div>
              ) : (
                <Chart {...chartData(chartMetric)} />
              )}
              <div className="p-3 rounded-xl bg-white/70 border border-[#ECE5D8] flex items-start gap-2 text-xs text-[#6A706B]">
                <Info className="w-4 h-4 text-[#4A7C59] shrink-0 mt-0.5" />
                <span>
                  {span === '24h' && !isSensor
                    ? 'Next/last hours from the Open-Meteo forecast and the moisture model.'
                    : 'Built from the readings the tree has stored (hourly averages).'}
                  {(chartMetric === 'light' || chartMetric === 'all') &&
                    isSensor &&
                    (hasLuxSensor
                      ? ' Light is the tree’s light scale: a log scale of the BH1750’s lux (1,000 lux ≈ 25 %, 40,000 lux ≈ 85 %).'
                      : ' Light is a relative %, not lux.')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
