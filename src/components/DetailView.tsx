import React, { useState } from 'react';
import {
  X, Droplets, Sun, Thermometer, Wind, Activity, Sparkles, Info, Radio, Cpu, ShieldCheck, ShieldAlert, HeartPulse, BookOpen,
  LineChart, Clock, Lightbulb, Sprout, Scissors, FlaskConical, Shovel, Flower2, Leaf, Snowflake, Wifi, WifiOff, LayoutGrid,
  TrendingUp, TrendingDown, Minus, CircleCheck, Waves,
} from 'lucide-react';
import { PlantHealthState, MetricAssessment, MetricId, MetricTone, ScoreId } from '../health/healthTypes';
import { CONDITION_LABELS } from '../health/labels';
import { metricScale, rootScale } from '../health/metricScale';
import { luxText } from '../health/metrics';
import { bonsaiBasics, LessonIcon } from '../explain/bonsaiBasics';
import type { DailySummary } from '../history/historyTypes';
import type { SeasonState } from '../perception/season';
import { SpeciesProfile } from '../species';
import { HourlyTelemetryPoint, PlantTelemetry, TimelineEvent } from '../telemetry/types';
import { MetricBar, RootsBar } from './sensors/MetricBar';
import { TodayTimeline } from './TodayTimeline';
import { GuideBody } from './sensors/SensorGuide';
import { hhmm } from '../lib/time';

interface DetailViewProps {
  health: PlantHealthState;
  message: string;
  tip: string;
  telemetry: PlantTelemetry | null; // latest reading (may be stale), for the lux and the sensors
  species: SpeciesProfile;
  season: SeasonState | null;
  lastWateringAt: number | null;
  hourly: HourlyTelemetryPoint[]; // last 24h (forecast for weather, recorded history for sensors)
  days: DailySummary[];
  timeline: TimelineEvent[];
  locationName: string;
  initialTab?: Tab;
  onClose: () => void;
}

type Icon = typeof Droplets;

const METRIC: Record<MetricId, { Icon: Icon; color: string; short: string }> = {
  soil: { Icon: Droplets, color: '#3A86C8', short: 'Soil' },
  light: { Icon: Sun, color: '#E0960F', short: 'Light' },
  temperature: { Icon: Thermometer, color: '#D65A31', short: 'Warmth' },
  humidity: { Icon: Wind, color: '#52796F', short: 'Air' },
  vpd: { Icon: Waves, color: '#457B9D', short: 'Drying pull' },
};
const SCORE_ICON: Record<ScoreId, { Icon: Icon; color: string }> = {
  moisture: { Icon: Droplets, color: '#3A86C8' },
  temperature: { Icon: Thermometer, color: '#D65A31' },
  humidity: { Icon: Wind, color: '#52796F' },
  light: { Icon: Sun, color: '#E0960F' },
  stability: { Icon: Activity, color: '#4A6741' },
};
const LESSON_ICON: Record<LessonIcon, { Icon: Icon; color: string }> = {
  water: { Icon: Droplets, color: '#3A86C8' },
  light: { Icon: Sun, color: '#E0960F' },
  temperature: { Icon: Thermometer, color: '#D65A31' },
  humidity: { Icon: Wind, color: '#52796F' },
  roots: { Icon: Sprout, color: '#8B6B43' },
  prune: { Icon: Scissors, color: '#4A6741' },
  feed: { Icon: FlaskConical, color: '#7A5BA6' },
  repot: { Icon: Shovel, color: '#8B6B43' },
};
const SEASON_ICON: Record<SeasonState['id'], Icon> = { spring: Flower2, summer: Sun, autumn: Leaf, winter: Snowflake };

const TONE: Record<MetricTone, string> = {
  good: 'var(--tone-good)',
  info: 'var(--tone-info)',
  caution: 'var(--tone-caution)',
  alert: 'var(--tone-alert)',
  off: '#B9B3A8',
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const card = 'rounded-2xl bg-white border border-[#ECE5D8]';

const IconBadge: React.FC<{ Icon: Icon; color: string; size?: 'sm' | 'md' }> = ({ Icon, color, size = 'md' }) => (
  <span className={`${size === 'sm' ? 'w-7 h-7 rounded-lg' : 'w-9 h-9 rounded-xl'} flex items-center justify-center shrink-0`} style={{ background: `${color}1A` }}>
    <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-[18px] h-[18px]'} style={{ color }} />
  </span>
);

const Dot: React.FC<{ tone: MetricTone }> = ({ tone }) => <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONE[tone] }} />;

// Vitality as a ring; the faint arc is where it's heading
const VitalityRing: React.FC<{ value: number; target: number; size?: number }> = ({ value, target, size = 64 }) => {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? 'var(--tone-good)' : value >= 50 ? 'var(--tone-caution)' : 'var(--tone-alert)';
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

// One measurement as a tile: icon, value, verdict, the range bar. Tap it for the ranges.
const MetricTile: React.FC<{ m: MetricAssessment; lux: number | null; species: SpeciesProfile; open: boolean; onToggle: () => void }> = ({ m, lux, species, open, onToggle }) => {
  const { Icon, color, short } = METRIC[m.id];
  const scale = metricScale(m, species, { lux });
  const off = m.tone === 'off';
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={`${card} p-3 text-left flex flex-col gap-2 cursor-pointer transition-shadow hover:shadow-sm ${open ? 'ring-2 ring-[#4A6741]/30' : ''} ${off ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2">
        <IconBadge Icon={Icon} color={off ? '#9A968E' : color} size="sm" />
        <span className="text-[10px] uppercase tracking-wider font-bold text-[#2C302E]/50">{short}</span>
        <Info className="w-3 h-3 ml-auto text-[#2C302E]/25" />
      </div>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="serif text-[22px] leading-none font-medium text-[#2C302E] tracking-tight">{off ? '–' : m.display}</span>
        <span className="flex items-center gap-1 text-[11px] font-semibold min-w-0" style={{ color: off ? '#9A968E' : TONE[m.tone] }}>
          <Dot tone={m.tone} />
          <span className="truncate">{off ? 'No sensor' : m.status}</span>
        </span>
      </div>
      {scale ? <MetricBar scale={scale} /> : <div className="h-[24px]" />}
      {m.detail && (
        <span className="flex items-center gap-1 text-[10.5px] text-[#2C302E]/60 -mt-1">
          <Sun className="w-3 h-3 text-[#E0960F]" />
          {m.detail}
          {m.detailStatus && <span style={{ color: TONE[m.detailTone ?? 'info'] }} className="font-semibold">{m.detailStatus}</span>}
        </span>
      )}
      {m.roots && <RootsBar roots={m.roots} scale={rootScale(m, species)} />}
    </button>
  );
};

// The sensors as icons: green = reporting, grey = not there
const SensorStrip: React.FC<{ t: PlantTelemetry }> = ({ t }) => {
  const lux = t.lightLux ?? null;
  const soilTemp = t.soilTemperature ?? null;
  const rssi = t.wifiRssi ?? null;
  const items: { Icon: Icon; name: string; value: string; ok: boolean }[] = [
    { Icon: Droplets, name: 'Soil probe (FC-28)', value: `${t.soilMoisture}%${t.soilRaw != null ? ` · raw ${t.soilRaw}` : ''}`, ok: true },
    { Icon: Sprout, name: 'Root probe (DS18B20)', value: soilTemp !== null ? `${soilTemp}°C` : 'not fitted', ok: soilTemp !== null },
    { Icon: Thermometer, name: 'Air (HTS221)', value: t.temperature !== null ? `${t.temperature}°C · ${t.humidity ?? '–'}%` : 'not connected', ok: t.htsConnected !== false && t.temperature !== null },
    { Icon: Sun, name: lux !== null ? 'Light (BH1750)' : 'Light (LDR)', value: lux !== null ? `${luxText(lux)} lux · ${t.lightPercent ?? '–'}%` : t.lightPercent != null ? `${t.lightPercent}%` : '–', ok: t.lightPercent != null },
  ];
  return (
    <div className={`${card} px-3 py-2.5 flex items-center gap-1.5 flex-wrap`}>
      <Cpu className="w-4 h-4 text-[#356077] mr-0.5" aria-label="Sensors" />
      {items.map(({ Icon, name, value, ok }) => (
        <span key={name} title={`${name}: ${value}`} className="relative inline-flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-lg bg-[#F6F2EC] text-[10.5px] font-mono text-[#2C302E]/75">
          <Icon className="w-3.5 h-3.5" style={{ color: ok ? 'var(--tone-good)' : '#B9B3A8' }} />
          {ok ? value.split(' · ')[0] : '–'}
        </span>
      ))}
      <span title={rssi !== null ? `Wi-Fi ${rssi} dBm` : 'Wi-Fi unknown'} className="ml-auto inline-flex items-center gap-1 text-[10.5px] font-mono text-[#2C302E]/55">
        {rssi !== null ? <Wifi className="w-3.5 h-3.5" style={{ color: rssi > -70 ? 'var(--tone-good)' : 'var(--tone-caution)' }} /> : <WifiOff className="w-3.5 h-3.5 text-[#B9B3A8]" />}
        <Clock className="w-3 h-3 ml-1" />
        {hhmm(t.timestamp)}
      </span>
      {t.sensorIssues && t.sensorIssues.length > 0 && <p className="w-full text-[10.5px] text-[#8F5E24]">{t.sensorIssues.join(' · ')}</p>}
    </div>
  );
};

const scoreColor = (n: number) => (n >= 85 ? 'var(--tone-good)' : n >= 60 ? 'var(--tone-info)' : n >= 40 ? 'var(--tone-caution)' : 'var(--tone-alert)');

const VitalityTab: React.FC<{ health: PlantHealthState }> = ({ health }) => {
  const b = health.breakdown;
  const total = b.components.reduce((a, c) => a + (c.score === null ? 0 : c.weight), 0) || 1;
  const offs = [
    ...b.durationPenalties.map((x) => ({ label: x.label, detail: x.detail, points: x.points })),
    ...(b.combinedExtra > 0 ? [{ label: 'Hot and dry together', detail: 'the two add up', points: b.combinedExtra }] : []),
    ...(b.recoveryModifier ? [{ label: 'Still recovering', detail: 'fades as it settles', points: b.recoveryModifier }] : []),
    ...(b.leafDropModifier ? [{ label: 'Leaf drop', detail: 'seen in the photos', points: b.leafDropModifier }] : []),
  ];
  const diff = b.target - b.final;
  const Trend = b.frozen || Math.abs(diff) < 1 ? Minus : diff > 0 ? TrendingUp : TrendingDown;
  const heading = b.frozen ? 'Held: no fresh data' : Math.abs(diff) < 1 ? 'Steady' : diff > 0 ? `Rising toward ${Math.round(b.target)}` : `Easing toward ${Math.round(b.target)}`;
  return (
    <div className="space-y-3">
      <div className={`${card} p-4 flex items-center gap-4`}>
        <VitalityRing value={health.vitality} target={b.target} size={76} />
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm font-bold text-[#2D332A]">
            <Trend className="w-4 h-4" style={{ color: diff < -1 ? 'var(--tone-caution)' : 'var(--tone-good)' }} />
            {heading}
          </span>
          <span className="text-[11px] text-[#2D332A]/60 leading-relaxed">
            Vitality is how well the tree has been over the last hours, not a snapshot. It moves slowly, so a short spell barely shows.
          </span>
        </div>
      </div>

      <div className={`${card} p-3.5 space-y-3`}>
        {b.components.map((c) => {
          const { Icon, color } = SCORE_ICON[c.id];
          return (
            <div key={c.id} className="flex items-center gap-3" title={c.note}>
              <IconBadge Icon={Icon} color={c.score === null ? '#9A968E' : color} size="sm" />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="font-semibold text-[#2C302E]">{c.label}</span>
                  <span className="font-mono text-[#2C302E]/70">
                    {c.score === null ? <span className="text-[#2C302E]/35">–</span> : c.score}
                    {c.score !== null && <span className="text-[#2C302E]/35"> · {Math.round((c.weight / total) * 100)}%</span>}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-[#EEE9E0] overflow-hidden">
                  {c.score !== null && <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.score}%`, background: scoreColor(c.score) }} />}
                </div>
                <div className="text-[10px] text-[#2C302E]/45 truncate">{c.note}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={`${card} p-3.5 space-y-1.5`}>
        {offs.length === 0 ? (
          <p className="flex items-center gap-2 text-[11.5px] text-[#4A7C59] font-semibold">
            <CircleCheck className="w-4 h-4" /> Nothing weighing on it
          </p>
        ) : (
          offs.map((o) => (
            <div key={o.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="flex items-center gap-1.5">
                <TrendingDown className="w-3.5 h-3.5 text-[var(--tone-alert)] self-center" />
                <span className="font-semibold text-[#2C302E]">{o.label}</span>
                <span className="text-[#2C302E]/45">{o.detail}</span>
              </span>
              <span className="font-mono text-[var(--tone-alert)]">−{r1(o.points)}</span>
            </div>
          ))
        )}
        <div className="flex items-baseline justify-between pt-1.5 mt-1 border-t border-[#F0ECE6] text-[11px] text-[#2C302E]/60">
          <span>Base {r1(b.weightedBase)}{offs.length > 0 && ' − the above'}</span>
          <span className="font-mono font-bold text-[#2C302E]">→ {r1(b.target)}</span>
        </div>
      </div>
    </div>
  );
};

const LearnTab: React.FC<{ species: SpeciesProfile; health: PlantHealthState; season: SeasonState | null; lastWateringAt: number | null }> = ({ species, health, season, lastWateringAt }) => {
  const { lessons, seasons } = bonsaiBasics({ species, metrics: health.metrics, season, lastWateringAt, now: Date.now() });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-1">
        <IconBadge Icon={Sprout} color="#4A6741" />
        <div className="flex flex-col">
          <span className="serif text-lg leading-tight text-[#2D332A]">Your {species.commonName}</span>
          <span className="text-[11px] italic text-[#2D332A]/50">{species.speciesName}</span>
        </div>
      </div>

      <div className={`${card} p-3`}>
        <div className="grid grid-cols-4 gap-1.5">
          {seasons.map((x) => {
            const Icon = SEASON_ICON[x.id];
            return (
              <div key={x.id} className={`rounded-xl p-2 flex flex-col items-center gap-1 text-center ${x.current ? 'bg-[#4A6741]/10 ring-1 ring-[#4A6741]/30' : ''}`}>
                <Icon className="w-4 h-4" style={{ color: x.current ? '#4A6741' : '#A8A296' }} />
                <span className={`text-[10.5px] font-bold ${x.current ? 'text-[#2D332A]' : 'text-[#2D332A]/45'}`}>{x.label}</span>
              </div>
            );
          })}
        </div>
        {seasons.filter((x) => x.current).map((x) => (
          <p key={x.id} className="text-[11px] text-[#2D332A]/70 mt-2 px-1 text-center">
            <strong className="text-[#2D332A]">{x.growth}.</strong> {x.care}
          </p>
        ))}
      </div>

      {lessons.map((l) => {
        const { Icon, color } = LESSON_ICON[l.id];
        return (
          <div key={l.id} className={`${card} p-3.5 flex gap-3`}>
            <IconBadge Icon={Icon} color={color} />
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-[#2C302E]/50">{l.title}</span>
                {l.yours && (
                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#F6F2EC] whitespace-nowrap" style={{ color: l.yours.tone === 'off' ? '#8A857C' : TONE[l.yours.tone] }}>
                    <Dot tone={l.yours.tone} />
                    {l.yours.text}
                  </span>
                )}
              </div>
              <p className="text-[12.5px] font-semibold text-[#2C302E] leading-snug">{l.rule}</p>
              <p className="text-[11px] text-[#2C302E]/55 leading-relaxed">{l.why}</p>
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-[#2D332A]/40 px-1">Ranges from this tree’s species profile; pruning, feeding and repotting are general ficus bonsai care.</p>
    </div>
  );
};

interface ChartProps {
  values: number[];
  labels: string[];
  unit: string;
  color: string;
  title?: string;
  Icon?: Icon;
  compact?: boolean;
}

function Chart({ values, labels, unit, color, title, Icon, compact }: ChartProps) {
  const head = title && (
    <span className="text-[11px] font-bold flex items-center gap-1.5 text-[#2C302E]">
      {Icon && <Icon className="w-3.5 h-3.5" style={{ color }} />}
      {title}
    </span>
  );
  if (values.length < 2)
    return (
      <div className="flex flex-col gap-1">
        {head}
        <p className="text-xs text-neutral-400 py-6 text-center">Not enough data yet</p>
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
      <div className="flex items-center justify-between">
        {head ?? <span />}
        <span className={`flex gap-2 text-[#7A827B] font-mono ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
          <span title="Low">↓ {r1(min)}{unit}</span>
          <span title="High">↑ {r1(max)}{unit}</span>
        </span>
      </div>
      <div className="rounded-xl bg-[#FAF7F2] p-2 border border-[#EBE4D7]">
        <svg viewBox={`0 0 ${w} ${h}`} className={`w-full ${compact ? 'h-20' : 'h-32'}`} preserveAspectRatio="none">
          <path d={`${path} L ${w - p},${h - p} L ${p},${h - p} Z`} fill={color} opacity="0.12" />
          <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
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
const CHART_METRICS: ChartMetric[] = ['soil', 'light', 'temperature', 'humidity'];
export type Tab = 'now' | 'vitality' | 'learn' | 'trends' | 'today';
const HOME_METRICS: MetricId[] = ['soil', 'light', 'temperature', 'humidity'];

export const DetailView: React.FC<DetailViewProps> = ({ health, message, tip, telemetry, species, season, lastWateringAt, hourly, days, timeline, locationName, initialTab = 'now', onClose }) => {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [chartMetric, setChartMetric] = useState<ChartMetric | 'all'>('soil');
  const [span, setSpan] = useState<'24h' | '7d'>('24h');
  const [openMetric, setOpenMetric] = useState<MetricId | null>(null);
  const isSensor = telemetry?.source !== 'weather_estimate';
  const lux = isSensor ? telemetry?.lightLux ?? null : null;

  const chartData = (cm: ChartMetric) => {
    const color = METRIC[cm].color;
    const unit = cm === 'temperature' ? '°' : cm === 'light' ? (isSensor ? '%' : ' W/m²') : '%';
    const rows =
      span === '24h'
        ? hourly.flatMap((h) => {
            const v = cm === 'soil' ? h.soilMoisture : cm === 'temperature' ? h.temperature : cm === 'humidity' ? h.humidity : h.light;
            return v === null ? [] : [{ v, label: h.time }];
          })
        : days.flatMap((d) => {
            const v = cm === 'soil' ? d.avgSoil : cm === 'temperature' ? d.avgTemp : cm === 'humidity' ? d.avgHumidity : d.avgLight;
            return v === null ? [] : [{ v, label: d.dayLabel }];
          });
    return { values: rows.map((r) => r.v), labels: rows.map((r) => r.label), unit, color, title: METRIC[cm].short, Icon: METRIC[cm].Icon };
  };

  const tabs: { id: Tab; Icon: Icon; label: string }[] = [
    { id: 'now', Icon: Activity, label: 'Now' },
    { id: 'vitality', Icon: HeartPulse, label: 'Vitality' },
    { id: 'learn', Icon: BookOpen, label: 'Learn' },
    { id: 'trends', Icon: LineChart, label: 'Charts' },
    ...(timeline.length > 0 ? [{ id: 'today' as Tab, Icon: Clock, label: 'Rhythm' }] : []),
  ];
  const pill = (active: boolean) =>
    `px-2 py-1 text-[11px] font-semibold rounded-lg cursor-pointer flex items-center gap-1 ${active ? 'bg-white text-[#2C302E] shadow-xs' : 'text-[#6C757D] hover:text-[#2C302E]'}`;

  const tiles = HOME_METRICS.map((id) => health.metrics.find((m) => m.id === id)).filter((m): m is MetricAssessment => !!m);
  const vpd = health.metrics.find((m) => m.id === 'vpd');
  const open = openMetric ? health.metrics.find((m) => m.id === openMetric) : null;

  return (
    <div id="bonsai-detail-modal" className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={onClose}>
      <div
        className="day w-full max-w-lg max-h-[90vh] bg-[#F8F5F2] text-[#2D332A] rounded-3xl border border-white/60 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* How it is, at a glance */}
        <div className="px-5 pt-5 pb-4 bg-white/75 border-b border-[#EAE6E1]">
          <div className="flex items-start gap-4">
            <VitalityRing value={health.vitality} target={health.breakdown.target} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-[#2D332A]/45">
                <Radio className="w-3 h-3 text-[#4A6741]" />
                {!telemetry ? 'No reading yet' : isSensor ? `Live · ${hhmm(telemetry.timestamp)}` : `Estimate · ${locationName}`}
              </div>
              <h2 className="serif text-2xl font-medium text-[#2D332A] tracking-tight leading-tight">{CONDITION_LABELS[health.condition]}</h2>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {tiles.map((m) => {
                  const { Icon } = METRIC[m.id];
                  return (
                    <span key={m.id} title={`${m.name}: ${m.display} · ${m.status}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#F6F2EC]">
                      <Icon className="w-3.5 h-3.5" style={{ color: TONE[m.tone] }} />
                      <Dot tone={m.tone} />
                    </span>
                  );
                })}
                <span title={`Data confidence: ${health.confidence}${health.dataIssues.length ? ` · ${health.dataIssues.join(' · ')}` : ''}`} className="inline-flex items-center px-1.5 py-0.5">
                  {health.confidence === 'high' ? <ShieldCheck className="w-4 h-4 text-[#4A7C59]" /> : <ShieldAlert className="w-4 h-4 text-[#B87D33]" />}
                </span>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-2 -mr-2 -mt-1 rounded-full hover:bg-neutral-200/50 text-[#2D332A]/60 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-[#EAE6E1] px-3 bg-white/40" role="tablist">
          {tabs.map(({ id, Icon, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 pt-2.5 pb-2 sans text-[10.5px] font-semibold border-b-2 cursor-pointer ${
                tab === id ? 'border-[#4A6741] text-[#4A6741]' : 'border-transparent text-[#2D332A]/45 hover:text-[#2D332A]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto space-y-3 sans">
          {tab === 'now' && (
            <>
              {message && (
                <div className="p-3.5 rounded-2xl bg-[#4A7C59]/10 border border-[#4A7C59]/20 space-y-1.5">
                  <p className="flex items-start gap-2 serif italic text-[15px] leading-snug text-[#2D5A3C]">
                    <Sparkles className="w-4 h-4 text-[#4A7C59] shrink-0 mt-1" />“{message}”
                  </p>
                  {tip && (
                    <p className="flex items-start gap-2 text-[11.5px] text-[#42614E]">
                      <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {tip}
                    </p>
                  )}
                  {(health.modifiers.length > 0 || health.isOverride) && (
                    <div className="flex flex-wrap gap-1.5 pl-6">
                      {health.modifiers.map((m) => (
                        <span key={m} className="text-[10.5px] px-2 py-0.5 rounded-full bg-white border border-[#D8D2C9] text-[#2D332A]/70">+ {CONDITION_LABELS[m]}</span>
                      ))}
                      {health.isOverride && <span className="text-[10.5px] text-[#8F5E24]">preview</span>}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                {tiles.map((m) => (
                  <MetricTile key={m.id} m={m} lux={m.id === 'light' ? lux : null} species={species} open={openMetric === m.id} onToggle={() => setOpenMetric(openMetric === m.id ? null : m.id)} />
                ))}
              </div>

              {open?.guide && (
                <div className={`${card} p-3.5 space-y-2`}>
                  {(() => {
                    const s = metricScale(open, species, { lux: open.id === 'light' ? lux : null });
                    return s && <MetricBar scale={s} showZones />;
                  })()}
                  {open.roots && (
                    <div className="pt-1">
                      <RootsBar roots={open.roots} scale={rootScale(open, species)} />
                      <p className="text-[10.5px] text-[#2C302E]/55 mt-1">Roots like {species.rootTemperature.minOptimal}–{species.rootTemperature.maxOptimal}°C. Cool soil drinks slowly and stays wet longer; a pot in the sun can overheat them.</p>
                    </div>
                  )}
                  <GuideBody guide={open.guide} />
                </div>
              )}

              {vpd && vpd.tone !== 'off' && (
                <button onClick={() => setOpenMetric(openMetric === 'vpd' ? null : 'vpd')} className={`${card} w-full px-3 py-2.5 flex items-center gap-3 text-left cursor-pointer hover:shadow-sm`} title="How strongly the air pulls water from the leaves (from warmth and humidity)">
                  <IconBadge Icon={Waves} color={METRIC.vpd.color} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="font-semibold text-[#2C302E]">Drying pull <span className="font-mono font-normal text-[#2C302E]/50">{vpd.display}</span></span>
                      <span className="flex items-center gap-1 font-semibold" style={{ color: TONE[vpd.tone] }}><Dot tone={vpd.tone} />{vpd.status}</span>
                    </div>
                    {(() => {
                      const s = metricScale(vpd, species);
                      return s && <div className="mt-1.5"><MetricBar scale={s} compact /></div>;
                    })()}
                  </div>
                </button>
              )}

              {isSensor && telemetry && <SensorStrip t={telemetry} />}
            </>
          )}

          {tab === 'vitality' && <VitalityTab health={health} />}

          {tab === 'learn' && <LearnTab species={species} health={health} season={season} lastWateringAt={lastWateringAt} />}

          {tab === 'today' && <TodayTimeline timeline={timeline} />}

          {tab === 'trends' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-0.5 bg-[#ECE4D8]/60 p-1 rounded-xl">
                  {CHART_METRICS.map((m) => {
                    const { Icon, color, short } = METRIC[m];
                    return (
                      <button key={m} onClick={() => setChartMetric(m)} className={pill(chartMetric === m)} title={short} aria-label={short}>
                        <Icon className="w-3.5 h-3.5" style={{ color: chartMetric === m ? color : undefined }} />
                      </button>
                    );
                  })}
                  <button onClick={() => setChartMetric('all')} className={pill(chartMetric === 'all')} title="All" aria-label="All">
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-0.5 bg-[#ECE4D8]/60 p-1 rounded-xl">
                  <button onClick={() => setSpan('24h')} className={pill(span === '24h')}>24h</button>
                  <button onClick={() => setSpan('7d')} className={pill(span === '7d')}>7d</button>
                </div>
              </div>
              {chartMetric === 'all' ? (
                <div className="grid grid-cols-2 gap-3">
                  {CHART_METRICS.map((m) => (
                    <Chart key={m} {...chartData(m)} compact />
                  ))}
                </div>
              ) : (
                <Chart {...chartData(chartMetric)} />
              )}
              <p className="flex items-start gap-2 text-[11px] text-[#6A706B] px-1">
                <Info className="w-3.5 h-3.5 text-[#4A7C59] shrink-0 mt-0.5" />
                <span>
                  {span === '24h' && !isSensor ? 'From the Open-Meteo forecast and the moisture model.' : 'Hourly averages of the readings the tree stored.'}
                  {(chartMetric === 'light' || chartMetric === 'all') &&
                    isSensor &&
                    (lux !== null ? ' Light is the tree’s light scale, a log scale of lux (1,000 lux ≈ 25 %, 40,000 lux ≈ 85 %).' : ' Light is a relative %, not lux.')}
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
