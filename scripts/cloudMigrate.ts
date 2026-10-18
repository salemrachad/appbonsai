import fs from 'node:fs';
import { APP_CONFIG } from '../src/config/appConfig';
import { dumpDatabase } from '../server/database';
import { nodeSqliteDriver } from '../server/nodeSqlite';

// npm run cf:migrate -- status | migrate | top-up
// Moves the tree from the laptop's database to its Durable Object on Cloudflare (docs/HOSTING.md).
//   status   what the cloud tree has (devices, last push, readings)
//   migrate  replace the cloud tree's data with the laptop's: readings, episodes, events, petting, outside
//            weather, calibration history, settings, saved memories, devices (with their token hashes, so the
//            ESP32 keeps its token). Refused once the cloud tree has sensor readings of its own.
//   top-up   after the ESP32 has moved: the readings the laptop got in between
// The address and password come from .env.cloud (gitignored), never from the command line:
//   APPBONSAI_CLOUD_URL=https://appbonsai.<name>.workers.dev
//   APPBONSAI_CLOUD_PASSWORD=...
// The laptop's database: APPBONSAI_DB, else the dev database (npm run dev:local). Read only.

if (fs.existsSync('.env.cloud')) process.loadEnvFile('.env.cloud');
const base = (process.env.APPBONSAI_CLOUD_URL ?? '').replace(/\/+$/, '');
const password = process.env.APPBONSAI_CLOUD_PASSWORD ?? '';
const cmd = process.argv[2] ?? 'status';
// https only, except a local wrangler dev (npm run cf:dev) for trying it out
if (!(/^https:\/\/[^/]+$/.test(base) || /^http:\/\/127\.0\.0\.1:\d+$/.test(base)) || !password) {
  console.error('Put APPBONSAI_CLOUD_URL (https://…) and APPBONSAI_CLOUD_PASSWORD in .env.cloud first.');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`appbonsai:${password}`).toString('base64')}`;
const t = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : '–');

async function call(path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 401) throw new Error('401: wrong password in .env.cloud');
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status}: ${data?.error ?? text.slice(0, 200)}`);
  return data;
}

async function status() {
  const s = await call('/status');
  const c = s.collector;
  console.log(`${base}  (${s.backend?.mode ?? '?'}, ${s.dbPath})`);
  console.log(`source ${c.dataSource}, ${c.transport}, every ${Math.round(c.pollMs / 1000)} s · last error: ${c.lastError ?? 'none'}`);
  console.log(`readings ${s.counts.telemetry} since ${t(s.oldestTelemetryAt)} · episodes ${s.counts.episodes} · events ${s.counts.events} · petting ${s.counts.interactions}`);
  for (const d of c.devices ?? []) console.log(`device ${d.id} (${d.label ?? ''}): last push ${t(d.lastSeenAt)}, firmware ${d.firmware ?? '–'}`);
  if (!c.devices?.length) console.log('no devices yet');
}

const local = () => {
  const file = process.env.APPBONSAI_DB ?? APP_CONFIG.server.devDbPath;
  const sql = nodeSqliteDriver(file, { readOnly: true });
  const dump = dumpDatabase(sql);
  sql.close();
  console.log(`laptop database ${file}: ${dump.tables.telemetry.length} readings, ${dump.tables.behaviour_episodes.length} episodes, ${dump.tables.devices.length} devices`);
  return dump;
};

try {
  if (cmd === 'status') await status();
  else if (cmd === 'migrate') {
    const r = await call('/admin/restore', { dump: local() });
    console.log('restored:', Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(', '));
    await status();
  } else if (cmd === 'top-up') {
    const r = await call('/admin/restore', { dump: local(), topUp: true });
    console.log(`added ${r.added} readings the cloud didn't have`);
    await status();
  } else {
    console.error('Usage: npm run cf:migrate -- status | migrate | top-up');
    process.exitCode = 1;
  }
} catch (err: any) {
  console.error(`Failed: ${err?.message ?? err}`);
  process.exitCode = 1;
}
