import React from 'react';
import { Server } from 'lucide-react';
import type { BackendInfo, ServerStatus } from '../../api/types';
import { BACKEND } from '../../config/backend';
import { Row, Section } from './debugUi';

// Which backend the UI is talking to, so it's never unclear whose collector and database these are.
export function describeBackend(mode: BackendInfo['mode'] | undefined) {
  if (mode === 'local-dev') return { title: 'Local Development', tone: 'dev' as const, db: 'Separate development database (not the live tree’s)' };
  if (mode === 'cloud') return { title: 'Cloudflare (the tree’s Durable Object)', tone: 'live' as const, db: 'The tree’s own database on Cloudflare (authoritative)' };
  if (mode === 'production') return { title: 'Self-hosted server (npm run server)', tone: 'live' as const, db: 'This server’s database' };
  return { title: 'Unknown (server not reachable or too old)', tone: 'unknown' as const, db: 'Unknown' };
}

export const BackendPanel: React.FC<{ status: ServerStatus | null }> = ({ status }) => {
  const b = status?.backend;
  const d = describeBackend(b?.mode);
  const color = d.tone === 'dev' ? 'text-[#8F5E24]' : d.tone === 'live' ? 'text-[#334D2E]' : 'text-[#A63629]';
  return (
    <Section title="Backend" aside={<Server className="w-3.5 h-3.5 text-[#356077]" />}>
      <Row label="Backend" value={<span className={`font-semibold ${color}`}>{d.title}</span>} />
      <Row label="API base URL" value={<span className="break-all font-mono">{BACKEND.displayUrl}</span>} />
      <Row label="Frontend" value={BACKEND.devBuild ? 'Local dev (npm run dev)' : 'Served by the backend'} />
      <Row label="Collector" value={b ? `${b.hostname}: ${b.collector}` : status ? 'Server does not report it (update the server)' : 'Not reachable'} tone={b ? undefined : 'minus'} />
      <Row label="Database" value={b ? `${d.db} · ${b.dbPath}` : '–'} tone={b?.mode === 'local-dev' ? 'minus' : undefined} />
      <Row label="Server" value={b ? `${b.hostname} · listening on ${b.host}:${b.port}${b.servesApp ? ' · serves the app' : ''}` : '–'} />
      {b?.mode === 'local-dev' && (
        <p className="sans text-[11px] text-[#8F5E24] bg-[#D49B53]/10 border border-[#D49B53]/30 rounded-lg px-2.5 py-1.5">
          Readings, care events and history you create now go to the local development database only. The live tree on Cloudflare doesn’t see them.
        </p>
      )}
    </Section>
  );
};
