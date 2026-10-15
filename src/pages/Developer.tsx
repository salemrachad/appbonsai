import React from 'react';
import { Database } from 'lucide-react';
import type { LivingSnapshot } from '../api/types';
import type { PlantBehaviourState } from '../behaviour/behaviourTypes';
import { BehaviourDebugPanel } from '../components/developer/BehaviourDebugPanel';
import { ago, Row, Section } from '../components/developer/debugUi';
import { HealthDebugPanel } from '../components/developer/HealthDebugPanel';
import { StateTester } from '../components/developer/StateTester';
import type { ExpressionState } from '../expression/expressionTypes';
import type { Season } from '../perception/season';

interface DeveloperProps {
  snapshot: LivingSnapshot | null;
  behaviour: PlantBehaviourState | null; // shown (live or preview)
  expression: ExpressionState | null;
  devPresetId: string | null;
  onSelectDevPreset: (id: string | null) => void;
  devSeason: Season | null;
  onSelectDevSeason: (season: Season | null) => void;
}

const API_LINKS = ['/api/status', '/api/current', '/api/health', '/api/behaviour', '/api/events', '/api/history/diary?days=7', '/api/history/episodes?days=7', '/api/telemetry/latest?limit=20'];

// Developer tools: state previews, why vitality is what it is, and why the tree behaves as it does.
export const Developer: React.FC<DeveloperProps> = ({ snapshot, behaviour, expression, devPresetId, onSelectDevPreset, devSeason, onSelectDevSeason }) => {
  const st = snapshot?.status;
  return (
    <div className="space-y-5 pb-12">
      <div>
        <h2 className="serif text-3xl font-medium text-[#2D332A] tracking-tight">Developer</h2>
        <p className="sans text-xs text-[#2D332A]/60">Previews never touch telemetry, the database, care events or episodes.</p>
      </div>

      <StateTester activePresetId={devPresetId} onSelectPreset={onSelectDevPreset} activeSeason={devSeason} onSelectSeason={onSelectDevSeason} />

      <HealthDebugPanel live={snapshot?.health ?? null} perception={snapshot?.perception ?? null} previewing={!!devPresetId} />
      <BehaviourDebugPanel behaviour={behaviour} expression={expression} recentEvents={snapshot?.recentEvents ?? []} previewing={!!devPresetId} />

      <Section title="Local server & database" aside={<Database className="w-3.5 h-3.5 text-[#356077]" />}>
        {st ? (
          <>
            <Row label="Database" value={<span className="break-all">{st.dbPath}</span>} />
            <Row label="Rows" value={`${st.counts.telemetry} readings · ${st.counts.events} events · ${st.counts.episodes} episodes`} />
            <Row label="Oldest reading" value={st.oldestTelemetryAt ? new Date(st.oldestTelemetryAt).toLocaleString() : '–'} />
            <Row label="Collector" value={`${st.collector.dataSource} every ${Math.round(st.collector.pollMs / 1000)}s`} />
            <Row label="Endpoint" value={st.collector.endpoint ?? '–'} />
            <Row label="Last success" value={ago(st.collector.lastSuccessAt)} />
            <Row label="Watering detector" value={st.collector.wateringDetection?.lastDecision ?? 'no rises seen yet'} />
            <Row label="Last error" value={st.collector.lastError ?? '–'} tone={st.collector.lastError ? 'minus' : 'muted'} />
            <Row label="Engine" value={st.engineVersion} />
          </>
        ) : (
          <p className="sans text-xs text-[#2D332A]/60">Local server not reachable. Start it with npm run dev.</p>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {API_LINKS.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" className="sans text-[10.5px] font-mono px-2 py-0.5 rounded-md bg-[#356077]/8 text-[#356077] hover:underline">
              {u}
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
};
