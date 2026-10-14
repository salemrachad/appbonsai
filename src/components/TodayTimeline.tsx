import React from 'react';
import { TimelineEvent } from '../telemetry/types';
import { Sun, Moon, Sparkles, ThermometerSun, Wind, Droplets, Clock, Calendar } from 'lucide-react';

interface TodayTimelineProps {
  timeline: TimelineEvent[];
}

function getTimelineIcon(iconName: string, type: TimelineEvent['type']) {
  const props = { className: 'w-3.5 h-3.5' };
  switch (type) {
    case 'sunrise':
      return <Sun {...props} className="w-3.5 h-3.5 text-[#D97757]" />;
    case 'sunset':
      return <Moon {...props} className="w-3.5 h-3.5 text-[#356077]" />;
    case 'light_peak':
      return <Sparkles {...props} className="w-3.5 h-3.5 text-[#D49B53]" />;
    case 'heat_peak':
      return <ThermometerSun {...props} className="w-3.5 h-3.5 text-[#D97757]" />;
    case 'cooling':
      return <Wind {...props} className="w-3.5 h-3.5 text-[#4A6741]" />;
    case 'watering':
      return <Droplets {...props} className="w-3.5 h-3.5 text-[#356077]" />;
    default:
      return <Clock {...props} className="w-3.5 h-3.5 text-[#2D332A]/50" />;
  }
}

export const TodayTimeline: React.FC<TodayTimelineProps> = ({ timeline }) => {
  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center justify-between">
        <h3 className="serif text-lg font-medium text-[#2D332A] tracking-tight flex items-center gap-1.5">
          <span>The Bonsai's Day</span>
        </h3>
        <span className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50">Circadian rhythm</span>
      </div>

      <div className="relative pl-5 border-l-2 border-[#EAE6E1] space-y-3.5 my-1">
        {timeline.map((event, index) => {
          const isWatering = event.type === 'watering';
          return (
            <div key={event.id || index} className="relative group">
              {/* Dot on line */}
              <div
                className={`absolute -left-[27px] top-1 w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-xs ${
                  isWatering
                    ? 'bg-[#356077] text-white ring-2 ring-[#356077]/30'
                    : 'bg-[#F8F5F2] text-[#4A6741]'
                }`}
              >
                {getTimelineIcon(event.iconName, event.type)}
              </div>

              {/* Event Content */}
              <div className="flex flex-col glass p-3 rounded-2xl hover:bg-white/80 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="sans text-xs font-bold text-[#2D332A]">{event.title}</span>
                  <div className="flex items-center gap-1.5">
                    {event.badge && (
                      <span className="sans text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#4A6741]/15 text-[#3D5535]">
                        {event.badge}
                      </span>
                    )}
                    <span className="sans text-[11px] font-semibold text-[#2D332A]/50">{event.time}</span>
                  </div>
                </div>
                <p className="sans text-xs text-[#2D332A]/70 mt-0.5 leading-relaxed">{event.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

