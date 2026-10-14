import React, { useState } from 'react';
import { X, Droplets, Sun, Thermometer, Wind, Activity, Sparkles, Info, Radio, Cpu, ShieldCheck, ShieldAlert } from 'lucide-react';
import { PlantHealthState, MetricAssessment, MetricId } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import type { DailySummary } from '../history/historyTypes';
import { SpeciesProfile } from '../species';
import { HourlyTelemetryPoint, PlantTelemetry, TimelineEvent } from '../telemetry/types';
import { METRIC_TONE_CLASS } from './sensors/SensorCard';
import { TodayTimeline } from './TodayTimeline';
import { GuideBody } from './sensors/SensorGuide';

interface DetailViewProps {
  health: PlantHealthState;
  message: string;
  tip: string;
  telemetry: PlantTelemetry | null; // latest reading (may be stale), for bars + diagnostics
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

// Scale + comfortable band for a metric's bar, from the species profile.
function barScale(m: MetricAssessment, t: PlantTelemetry | null, s: SpeciesProfile) {
  if (!t || m.tone === 'off') return null;
  switch (m.id) {
    case 'soil':
      return { min: 0, max: 100, optMin: s.soilMoisture.minOptimal, optMax: s.soilMoisture.maxOptimal, value: t.soilMoisture };
    case 'temperature':
      return t.temperature === null
        ? null
        : { min: s.temperature.minCritical - 5, max: s.temperature.maxCritical + 2, optMin: s.temperature.minOptimal, optMax: s.temperature.maxOptimal, value: t.temperature };
    case 'humidity':
      return t.humidity === null ? null : { min: 0, max: 100, optMin: s.humidity.minOptimal, optMax: s.humidity.maxOptimal, value: t.humidity };
    case 'light': {
      if (t.source === 'esp32_sensor') {
        if (t.lightPercent == null) return null;
        const low = s.relativeLight.find((b) => b.id === 'low')!.max;
        const bright = s.relativeLight.find((b) => b.id === 'bright')!.max;
        return { min: 0, max: 100, optMin: low + 1, optMax: bright, value: t.lightPercent };
      }
      return t.radiation == null ? null : { min: 0, max: s.radiation.maxWarning, optMin: s.radiation.minOptimal, optMax: s.radiation.maxOptimal, value: t.radiation };
    }
    case 'vpd':
      return t.vpd === null ? null : { min: 0, max: s.vpd.maxCritical, optMin: s.vpd.minOptimal, optMax: s.vpd.maxOptimal, value: t.vpd };
  }
}

const pct = (v: number, min: number, max: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

const MetricRow: React.FC<{ m: MetricAssessment; telemetry: PlantTelemetry | null; species: SpeciesProfile }> = ({ m, telemetry, species }) => {
  const { Icon, color } = METRIC_ICON[m.id];
  const scale = barScale(m, telemetry, species);
  return (
    <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-xs font-bold text-[#2C302E]">{m.name}</span>
          {m.estimated && <span className="text-[10px] text-[#8F5E24]">estimated</span>}
        </div>
        <span className="text-xs font-bold text-[#2C302E]">
          {m.display}
          {m.tone !== 'off' && <span className={`ml-2 text-[11px] ${METRIC_TONE_CLASS[m.tone]}`}>{m.status}</span>}
        </span>
      </div>
      {scale && (
        <>
          <div className="w-full h-2 bg-[#E9E4DB] rounded-full overflow-hidden relative">
            <div
              className="absolute top-0 bottom-0 bg-[#4A7C59]/30"
              style={{ left: `${pct(scale.optMin, scale.min, scale.max)}%`, right: `${100 - pct(scale.optMax, scale.min, scale.max)}%` }}
            />
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct(scale.value, scale.min, scale.max)}%`, background: color }} />
          </div>
          <div className="text-[10px] text-[#7C827D]">
            Comfortable: <span className="font-semibold text-[#4A7C59]">{m.idealRange}</span>
            {m.id === 'light' && telemetry?.source === 'esp32_sensor' && ' · relative photoresistor %, not lux'}
          </div>
        </>
      )}
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
        <span>Low: <strong className="text-[#2C302E]">{Math.round(min * 10) / 10}{unit}</strong></span>
        <span>High: <strong className="text-[#2C302E]">{Math.round(max * 10) / 10}{unit}</strong></span>
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

interface OverlaySeries {
  metric: ChartMetric;
  values: (number | null)[]; // aligned with the shared time labels; null = no reading then
  unit: string;
  color: string;
}

export const DetailView: React.FC<DetailViewProps> = ({ health, message, tip, telemetry, species, hourly, days, timeline, locationName, onClose }) => {
  const [tab, setTab] = useState<'health' | 'today' | 'trends'>('health');
  const [chartMetric, setChartMetric] = useState<ChartMetric | 'all'>('soil');
  const [span, setSpan] = useState<'24h' | '7d'>('24h');
  const isSensor = telemetry?.source !== 'weather_estimate';

  const chartData = (chartMetric: ChartMetric) => {
    const color = METRIC_ICON[chartMetric].color;
    if (span === '24h') {
      const rows = hourly.flatMap((h) => {
        const v = chartMetric === 'soil' ? h.soilMoisture : chartMetric === 'temperature' ? h.temperature : chartMetric === 'humidity' ? h.humidity : h.light;
        return v === null ? [] : [{ v, label: h.time }];
      });
      const unit = chartMetric === 'temperature' ? '°C' : chartMetric === 'light' ? (isSensor ? '%' : ' W/m²') : '%';
      return { values: rows.map((r) => r.v), labels: rows.map((r) => r.label), unit, color };
    }
    const rows = days.flatMap((d) => {
      const v = chartMetric === 'soil' ? d.avgSoil : chartMetric === 'temperature' ? d.avgTemp : chartMetric === 'humidity' ? d.avgHumidity : d.avgLight;
      return v === null ? [] : [{ v, label: d.dayLabel }];
    });
    return { values: rows.map((r) => r.v), labels: rows.map((r) => r.label), unit: chartMetric === 'temperature' ? '°C' : chartMetric === 'light' ? (isSensor ? '%' : ' W/m²') : '%', color };
  };

  const tabBtn = (id: typeof tab, label: string) => (
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

  return (
    <div id="bonsai-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="day w-full max-w-lg max-h-[88vh] bg-[#F8F5F2] text-[#2D332A] rounded-3xl border border-white/60 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-[#EAE6E1] flex items-center justify-between bg-white/70">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="serif text-2xl font-medium text-[#2D332A] tracking-tight">Tree Diagnostics</h2>
              <span className="sans text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#4A6741]/10 text-[#3D5535] border border-[#4A6741]/20">
                {health.qualitative} ({health.vitality}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5 sans text-xs text-[#2D332A]/55 mt-0.5">
              <Radio className="w-3 h-3 text-[#4A6741]" />
              <span>{!telemetry ? 'No reading yet' : isSensor ? `ESP32 sensors via local server · ${telemetry.updatedAt}` : `Weather estimate · Open-Meteo (${locationName})`}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-neutral-200/50 text-[#2D332A]/70 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-[#EAE6E1] px-4 pt-2">
          {tabBtn('health', 'Health')}
          {tabBtn('today', "Today's Rhythm")}
          {tabBtn('trends', 'Charts')}
        </div>

        <div className="p-5 overflow-y-auto space-y-3.5 sans">
          {tab === 'health' && (
            <>
              <div className="p-3.5 rounded-2xl bg-[#4A7C59]/10 border border-[#4A7C59]/20 space-y-2">
                <div className="flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-[#4A7C59] shrink-0 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#2D5A3C]">{message}</span>
                    <span className="text-xs text-[#42614E] mt-0.5">{tip}</span>
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
                <MetricRow key={m.id} m={m} telemetry={telemetry} species={species} />
              ))}

              {isSensor && telemetry && (
                <div className="p-3.5 rounded-2xl bg-white border border-[#ECE5D8] space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-[#356077]" />
                    <span className="text-xs font-bold text-[#2C302E]">ESP32 sensor diagnostics</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] font-mono text-[#2C302E]/75">
                    <span>Light: {telemetry.lightPercent != null ? `${telemetry.lightPercent}%` : '–'}</span>
                    <span>Raw light ADC: {telemetry.lightRaw ?? '–'}</span>
                    <span>Soil: {telemetry.soilMoisture}%</span>
                    <span>Raw soil ADC: {telemetry.soilRaw ?? '–'}</span>
                    <span>Wi-Fi: {telemetry.wifiRssi != null ? `${telemetry.wifiRssi} dBm` : '–'}</span>
                    <span>Updated: {telemetry.updatedAt}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'today' &&
            (timeline.length > 0 ? (
              <TodayTimeline timeline={timeline} />
            ) : (
              <p className="text-xs text-[#2D332A]/50 text-center py-6">The daily rhythm comes from the weather forecast and isn't available for sensor-only mode.</p>
            ))}

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
                    : 'Built from readings stored by the local server (hourly averages).'}
                  {(chartMetric === 'light' || chartMetric === 'all') && isSensor && ' Light is the relative photoresistor %, not lux.'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
