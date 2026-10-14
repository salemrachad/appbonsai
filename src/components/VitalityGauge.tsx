import React from 'react';
import type { GaugeTone } from '../expression/expressionTypes';

interface VitalityGaugeProps {
  score: number;
  label: string; // decided upstream (species vitality bands, or "Paused" when frozen)
  tone: GaugeTone;
  onClick?: () => void;
}

// Colours per tone. The gauge never interprets the number itself.
const TONE: Record<GaugeTone, { arc: string; text: string; badge: string }> = {
  thriving: { arc: '#4A6741', text: 'text-[#4A6741]', badge: 'bg-[#4A6741]/15 text-[#334D2E] border-[#4A6741]/30' },
  happy: { arc: '#5A7A50', text: 'text-[#5A7A50]', badge: 'bg-[#5A7A50]/15 text-[#3E5C35] border-[#5A7A50]/30' },
  okay: { arc: '#D49B53', text: 'text-[#B87D33]', badge: 'bg-[#D49B53]/15 text-[#8F5E24] border-[#D49B53]/30' },
  stressed: { arc: '#D97757', text: 'text-[#C16345]', badge: 'bg-[#D97757]/15 text-[#A64F34] border-[#D97757]/30' },
  critical: { arc: '#C14B3D', text: 'text-[#A63629]', badge: 'bg-[#C14B3D]/15 text-[#87251A] border-[#C14B3D]/30' },
  // Frozen: no live assessment, so no health colour either
  paused: { arc: '#9AA3A0', text: 'text-[var(--ink)]/40', badge: 'bg-[var(--ink)]/5 text-[var(--ink)]/55 border-[var(--line-strong)] border-dashed' },
};

export const VitalityGauge: React.FC<VitalityGaugeProps> = ({ score, label, tone, onClick }) => {
  const paused = tone === 'paused';
  // SVG arc math for a clean 240-degree gauge
  const radius = 40;
  const strokeWidth = 5;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * (240 / 360);
  const strokeDashoffset = arcLength - (arcLength * Math.min(100, Math.max(0, score))) / 100;
  const { arc: arcColor, text: textColor, badge: badgeBg } = TONE[tone];

  return (
    <div
      id="vitality-gauge"
      onClick={onClick}
      className="flex flex-col items-center justify-center cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]"
      title={paused ? 'Vitality is paused at its last live value until the sensor answers again' : undefined}
    >
      <div className="relative w-36 h-36 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
          {/* Background Track */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            style={{ stroke: 'var(--line)', transform: 'rotate(150deg)', transformOrigin: '50% 50%' }}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
          {/* Progress Arc */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={arcColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
            style={{ transform: 'rotate(150deg)', transformOrigin: '50% 50%' }}
          />
        </svg>

        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pt-0.5">
          <div className="flex items-baseline justify-center">
            <span className={`gauge-score serif text-4xl sm:text-5xl font-bold ${textColor} tracking-tight`}>
              {score}
            </span>
            <span className="serif text-lg font-medium text-[var(--ink)]/50 ml-0.5">%</span>
          </div>
          <span className="sans text-[10px] uppercase font-bold text-[var(--ink)]/45 tracking-widest -mt-1">
            {paused ? 'Last known' : 'Vitality'}
          </span>
        </div>
      </div>

      {/* Qualitative Status Chip */}
      <div className={`gauge-score -mt-1.5 px-3.5 py-0.5 text-xs font-semibold rounded-full border ${badgeBg} shadow-2xs`}>
        {label}
      </div>
    </div>
  );
};

