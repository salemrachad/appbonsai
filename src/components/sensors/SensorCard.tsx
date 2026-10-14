import React from 'react';
import { Droplet, Sun, Thermometer, Wind, Activity } from 'lucide-react';
import { MetricAssessment, MetricId, MetricTone } from '../../health/healthTypes';
import { SensorGuide, useGuidePopup } from './SensorGuide';

const TONE_CLASS: Record<MetricTone, string> = {
  good: 'text-[var(--tone-good)] font-semibold',
  info: 'text-[var(--tone-info)] font-semibold',
  caution: 'text-[var(--tone-caution)] font-semibold',
  alert: 'text-[var(--tone-alert)] font-semibold',
  off: 'text-[var(--ink)]/40 font-normal',
};

const ICONS: Record<MetricId, { Icon: typeof Droplet; color: string }> = {
  soil: { Icon: Droplet, color: 'text-[#356077]' },
  light: { Icon: Sun, color: 'text-[#D49B53]' },
  temperature: { Icon: Thermometer, color: 'text-[#D97757]' },
  humidity: { Icon: Wind, color: 'text-[#4A6741]' },
  vpd: { Icon: Activity, color: 'text-[#4A6741]' },
};

interface SensorCardProps {
  metric: MetricAssessment;
  tooltipAlign?: 'left' | 'right';
}

// One measured value with the health engine's verdict on it. Click it to see the best conditions and ranges.
export const SensorCard: React.FC<SensorCardProps> = ({ metric, tooltipAlign = 'left' }) => {
  const off = metric.tone === 'off';
  const { Icon, color } = ICONS[metric.id];
  const popup = useGuidePopup();

  return (
    <div ref={popup.ref} className="relative flex w-full">
    <button
      id={`indicator-${metric.id}`}
      onClick={popup.toggle}
      aria-expanded={popup.open}
      title={popup.open ? undefined : 'Best conditions & ranges'}
      className={`glass rounded-2xl p-3.5 flex flex-col justify-between text-left hover:bg-[var(--card-hover)] group cursor-pointer w-full ${
        off ? 'opacity-80' : ''
      }`}
    >
      <div className="flex items-center justify-between w-full mb-1">
        <span className="sans text-[10px] uppercase font-bold opacity-60 tracking-wider text-[var(--ink)]">{metric.name}</span>
        <span
          className={`p-1 rounded-md border group-hover:scale-105 transition-transform ${
            off ? 'bg-[var(--paper)]/50 border-dashed border-[var(--line-strong)]' : 'bg-[var(--paper)]/80 border-[var(--line)]'
          }`}
        >
          <Icon className={`w-3.5 h-3.5 ${off ? 'text-[var(--ink)]/30' : color}`} />
        </span>
      </div>

      <div className="sans mt-1">
        {off ? (
          <div className="min-h-[42px] flex flex-col justify-center">
            <div className="text-[11px] font-medium text-[var(--ink)]/50 leading-tight">Sensor not connected</div>
            <div className="text-[10px] text-[var(--ink)]/35 mt-0.5 font-mono">Not reported</div>
          </div>
        ) : (
          <>
            <div className="font-bold text-lg text-[var(--ink)] tracking-tight flex items-baseline gap-1.5 flex-wrap">
              <span>{metric.display}</span>
              {/* Every measured value: live from the ESP32, or estimated in weather mode */}
              <span
                className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${
                  metric.estimated
                    ? 'text-[var(--tone-caution)] bg-[var(--tone-caution)]/10 border border-[var(--tone-caution)]/20'
                    : 'text-[var(--tone-good)] bg-[var(--tone-good)]/10 border border-[var(--tone-good)]/25'
                }`}
              >
                {metric.estimated ? 'Est.' : 'Live Sensor'}
              </span>
            </div>
            <div className={`text-[11px] mt-0.5 ${TONE_CLASS[metric.tone]}`}>{metric.status}</div>
          </>
        )}
      </div>
    </button>
    {metric.guide && <SensorGuide guide={metric.guide} open={popup.open} align={tooltipAlign} />}
    </div>
  );
};

const HOME_METRICS: MetricId[] = ['soil', 'light', 'temperature', 'humidity'];

export const SensorCardGrid: React.FC<{ metrics: MetricAssessment[] }> = ({ metrics }) => (
  <div id="quick-indicators-grid" className="grid grid-cols-2 gap-3 w-full">
    {HOME_METRICS.map((id, i) => {
      const metric = metrics.find((m) => m.id === id);
      // Right-hand cards open their popup leftwards so it stays on screen
      return metric ? (
        <div key={id} className="flex">
          <SensorCard metric={metric} tooltipAlign={i % 2 ? 'right' : 'left'} />
        </div>
      ) : null;
    })}
  </div>
);

export { TONE_CLASS as METRIC_TONE_CLASS };
