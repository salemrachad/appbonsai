import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

// Talking to the tree on Cloudflare from the laptop (npm run cf:migrate, cf:backup). The address and password
// come from .env.cloud (gitignored), never from the command line, and are never printed:
//   APPBONSAI_CLOUD_URL=https://appbonsai.<name>.workers.dev
//   APPBONSAI_CLOUD_PASSWORD=...
if (fs.existsSync('.env.cloud')) process.loadEnvFile('.env.cloud');
export const base = (process.env.APPBONSAI_CLOUD_URL ?? '').replace(/\/+$/, '');
const password = process.env.APPBONSAI_CLOUD_PASSWORD ?? '';
// https only, except a local wrangler dev (npm run cf:dev) for trying it out
if (!(/^https:\/\/[^/]+$/.test(base) || /^http:\/\/127\.0\.0\.1:\d+$/.test(base)) || !password) {
  console.error('Put APPBONSAI_CLOUD_URL (https://…) and APPBONSAI_CLOUD_PASSWORD in .env.cloud first.');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`appbonsai:${password}`).toString('base64')}`;

async function request(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('401: wrong password in .env.cloud');
  return res;
}

// JSON in, JSON out; an error status throws with the server's message
export async function call(path: string, body?: unknown): Promise<any> {
  const res = await request(path, body);
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status}: ${data?.error ?? text.slice(0, 200)}`);
  return data;
}

// A gzip JSON file from the server (a nightly backup), parsed
export async function callGzip(path: string): Promise<any> {
  const res = await request(path);
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
}

// A backup file written by cf:backup (.json.gz) or plain .json
export function readDumpFile(file: string): any {
  const bytes = fs.readFileSync(file);
  return JSON.parse((file.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8'));
}

export const t = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : '–');

export async function status() {
  const s = await call('/status');
  const c = s.collector;
  console.log(`${base}  (${s.backend?.mode ?? '?'}, ${s.dbPath})`);
  console.log(`source ${c.dataSource}, ${c.transport}, every ${Math.round(c.pollMs / 1000)} s · last error: ${c.lastError ?? 'none'}`);
  console.log(`readings ${s.counts.telemetry} since ${t(s.oldestTelemetryAt)} · episodes ${s.counts.episodes} · events ${s.counts.events} · petting ${s.counts.interactions}`);
  for (const d of c.devices ?? []) console.log(`device ${d.id} (${d.label ?? ''}): last push ${t(d.lastSeenAt)}, firmware ${d.firmware ?? '–'}`);
  if (!c.devices?.length) console.log('no devices yet');
}
