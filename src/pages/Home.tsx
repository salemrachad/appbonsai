import React from 'react';
import { BonsaiAvatar } from '../components/avatar/BonsaiAvatar';
import type { PetSession } from '../components/avatar/usePetting';
import { SensorCardGrid } from '../components/sensors/SensorCard';
import { VitalityGauge } from '../components/VitalityGauge';
import type { ExpressionState } from '../expression/expressionTypes';
import { PlantHealthState } from '../health/healthTypes';

interface HomeProps {
  health: PlantHealthState | null; // for the sensor cards and the vitality number only
  expression: ExpressionState | null;
  offlineMessage: string | null;
  devPresetLabel: string | null;
  onReturnToLive: () => void;
  onOpenDetails: () => void;
  onPetSession?: (s: PetSession) => void; // attention: one report per petting session
}

// The companion screen: shows what the engines concluded, never recalculates it.
export const Home: React.FC<HomeProps> = ({ health, expression, offlineMessage, devPresetLabel, onReturnToLive, onOpenDetails, onPetSession }) => {
  const msg = expression?.message;

  return (
    <main className="relative z-10 flex-1 min-h-0 w-full max-w-6xl mx-auto px-8 py-6 grid grid-cols-1 md:grid-cols-2 gap-10 items-center overflow-y-auto md:overflow-hidden">
      <div className="h-full min-h-[320px] flex items-center justify-center">
        <BonsaiAvatar className="w-full h-full max-h-[620px]" expression={expression} onPetSession={onPetSession} />
      </div>

      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-6 min-h-[150px]">
          <div className="shrink-0">
            <VitalityGauge
              score={health?.vitality ?? 0}
              label={expression?.gauge.label ?? 'Waking up'}
              tone={expression?.gauge.tone ?? 'paused'}
              onClick={onOpenDetails}
            />
          </div>
          <div className="space-y-2 min-w-0">
            {offlineMessage ? (
              <p className="serif text-2xl italic leading-snug">{offlineMessage}</p>
            ) : !msg ? (
              <p className="serif text-2xl italic leading-snug">Waking up…</p>
            ) : (
              // The tree's current thought is always shown
              <div className="space-y-2">
                <p className="serif text-2xl italic leading-snug">"{msg.text}"</p>
                {msg.tip && <p className="sans text-xs text-[var(--ink)]/55 leading-relaxed">{msg.tip}</p>}
              </div>
            )}
          </div>
        </div>

        {health && <SensorCardGrid metrics={health.metrics} />}

        {devPresetLabel && (
          <div className="sans text-xs flex items-center justify-between px-4 py-2 rounded-xl bg-[#D49B53]/10 border border-[#D49B53]/30 text-[#8F5E24]">
            <span>Previewing “{devPresetLabel}”. Sensor values and history are still live.</span>
            <button onClick={onReturnToLive} className="font-semibold hover:underline cursor-pointer">
              Return to Live Data
            </button>
          </div>
        )}
      </div>
    </main>
  );
};
