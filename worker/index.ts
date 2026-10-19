import { handleAsNodeRequest } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { apiApp } from '../server/app';
import { backupDueAt, backupKey, backupSaved, lastBackupAt, nextBackup } from '../server/backup';
import { LivingCollector } from '../server/collector';
import { openDurableDatabase } from '../server/durableSqlite';
import type { AppDatabase } from '../server/database';

// Appbonsai on Cloudflare (docs/HOSTING.md):
//   the front Worker   checks a password (except the ESP32's /api/ingest, which has its device token), then
//                      hands /api/* to the tree's Durable Object and the page to the static assets (dist/).
//                      The hashed /assets/* files skip it (wrangler.jsonc: run_worker_first).
//   TreeObject         one per tree: its own SQLite, the collector (the living loop) and the same Express
//                      routes as the laptop server, run on a node:http server inside the object. Its alarm
//                      is the collector's timer (overdue pushes, outside weather, the hike forecast) and the
//                      nightly backup's (server/backup.ts → KV, about 05:00 in Beirut).

interface Env {
  TREE: DurableObjectNamespace<TreeObject>;
  ASSETS: Fetcher; // the built app (dist/)
  APP_PASSWORD?: string; // wrangler secret put APP_PASSWORD
  BACKUPS?: KVNamespace; // nightly backups
}

const PORT = 8787; // a routing key inside the object's isolate, not a network port
const TREE_NAME = 'ficus'; // one tree for now; later the tree a signed-in account claimed
const BACKUP_HOUR_UTC = 2; // 05:00 in Beirut: a quiet hour
const HOUR_MS = 60 * 60 * 1000;

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

// The node:http server belongs to the isolate, which can outlive an object instance (a new instance in the
// same isolate would find the port taken): created once, it always calls the current instance's routes.
// One tree per isolate for now; with many trees each would need its own port.
let routes: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let server: Server | null = null;
function serve(app: (req: IncomingMessage, res: ServerResponse) => void) {
  routes = app;
  if (!server) server = createServer((req, res) => routes!(req, res)).listen(PORT);
}

export class TreeObject extends DurableObject<Env> {
  private db: AppDatabase;
  private collector: LivingCollector;
  private ready: Promise<void>;
  private backupRetryAt = 0; // after a failed backup: not again before this
  private readonly firstBackupAt = Date.now() + 2 * 60 * 1000; // never backed up: two minutes after loading

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = openDurableDatabase(ctx.storage, `durable-object:${TREE_NAME}`);
    this.collector = this.load();
    console.log(`[tree] ${TREE_NAME} loaded`);
    // Resume (or start) before the first request is handled
    this.ready = ctx.blockConcurrencyWhile(() => this.begin());
  }

  // A collector and its routes over the database. No setTimeout timers: the object's alarm wakes it (it may be
  // unloaded between requests).
  private load(): LivingCollector {
    const collector = new LivingCollector(this.db, { autoSchedule: false });
    serve(
      apiApp(this.db, collector, {
        startedAt: Date.now(),
        stream: false,
        backend: { mode: 'cloud', hostname: 'cloudflare', host: 'workers.dev', port: 443, dbPath: this.db.path, collector: 'this server', servesApp: true },
        restore: (apply) => this.replaceData(apply),
      })
    );
    return collector;
  }

  private async begin() {
    await this.collector.start();
    await this.collector.settled();
    await this.arm();
  }

  // POST /api/admin/restore: the data changes under the collector, so it is stopped first and rebuilt after
  private async replaceData<T>(apply: () => T): Promise<T> {
    await this.collector.settled();
    this.collector.stop();
    const result = apply();
    this.collector = this.load();
    await this.begin();
    return result;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    // A backup now (to check it works, or before a risky change). The rest goes to the Express routes.
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/admin/backup-now') {
      const stored = await this.backup();
      await this.arm();
      return Response.json(stored ?? { error: 'No backup made (no BACKUPS binding, or it failed: see the logs)' }, { status: stored ? 200 : 500 });
    }
    const response = await handleAsNodeRequest(PORT, request);
    await this.collector.settled(); // a poll or a forecast started by the request
    await this.arm();
    return response;
  }

  async alarm(): Promise<void> {
    await this.ready;
    try {
      this.collector.wake();
      await this.collector.settled();
      if (Date.now() >= this.backupDueAt()) await this.backup();
    } finally {
      await this.arm(); // even when a job threw (e.g. the read quota): the next alarm must still be set
    }
  }

  private backupDueAt(): number {
    if (!this.env.BACKUPS) return Infinity;
    return Math.max(backupDueAt(lastBackupAt(this.db), this.firstBackupAt, BACKUP_HOUR_UTC), this.backupRetryAt);
  }

  // The rows added since the last backup, the rest whole, compressed into one KV value per night
  private async backup(): Promise<{ key: string; seq: number; readings: number; bytes: number } | null> {
    if (!this.env.BACKUPS) return null;
    try {
      const b = nextBackup(this.db, Date.now());
      const body = await gzip(JSON.stringify(b));
      const key = backupKey(b);
      await this.env.BACKUPS.put(key, body, { metadata: { seq: b.seq, series: b.series, createdAt: b.createdAt, readings: b.tables.telemetry.length } });
      backupSaved(this.db, b);
      console.log(`[tree] backup ${key}: ${b.tables.telemetry.length} new readings, ${body.byteLength} bytes`);
      return { key, seq: b.seq, readings: b.tables.telemetry.length, bytes: body.byteLength };
    } catch (err) {
      this.backupRetryAt = Date.now() + HOUR_MS;
      console.error(`[tree] backup failed, again in an hour: ${err}`);
      return null;
    }
  }

  // The alarm at the next due job, the collector's or the backup's (set only when it moves: each set is a
  // storage write). A stored alarm already in the past is never trusted: one whose run failed until its retries
  // ran out is still listed but never fires again (2026-10-18: weather, hike and backups stopped for a day).
  private async arm() {
    const at = Math.min(this.collector.nextWakeAt(), this.backupDueAt());
    if (!Number.isFinite(at)) return void (await this.ctx.storage.deleteAlarm());
    const now = Date.now();
    const target = Math.max(at, now + 1000);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current <= now || current !== target) await this.ctx.storage.setAlarm(target);
  }
}

// HTTP Basic: the browser asks once and remembers it for the site. Any user name, the password is the secret.
function authorized(request: Request, password: string): boolean {
  const m = /^Basic\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '');
  if (!m) return false;
  let decoded = '';
  try {
    decoded = atob(m[1]);
  } catch {
    return false;
  }
  const given = decoded.slice(decoded.indexOf(':') + 1);
  // Compare every character, so the time taken doesn't tell how much was right
  let diff = given.length ^ password.length;
  for (let i = 0; i < password.length; i++) diff |= password.charCodeAt(i) ^ (given.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api/ingest') {
      if (!env.APP_PASSWORD) return new Response('Not set up yet: wrangler secret put APP_PASSWORD', { status: 503 });
      if (!authorized(request, env.APP_PASSWORD))
        return new Response('Appbonsai: sign in', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Appbonsai", charset="UTF-8"' } });
    }
    // The nightly backups: GET /api/admin/backups lists them, GET /api/admin/backups/<key> is one (gzip JSON)
    if (url.pathname === '/api/admin/backups' || url.pathname.startsWith('/api/admin/backups/')) return backups(url, env);
    if (url.pathname.startsWith('/api/')) return env.TREE.get(env.TREE.idFromName(TREE_NAME)).fetch(request);
    return env.ASSETS.fetch(request);
  },
};

async function backups(url: URL, env: Env): Promise<Response> {
  if (!env.BACKUPS) return Response.json({ error: 'No BACKUPS binding' }, { status: 404 });
  const key = decodeURIComponent(url.pathname.slice('/api/admin/backups/'.length));
  if (url.pathname !== '/api/admin/backups') {
    if (!key.startsWith('backup/')) return Response.json({ error: 'Not a backup' }, { status: 404 });
    const body = await env.BACKUPS.get(key, 'arrayBuffer');
    return body ? new Response(body, { headers: { 'Content-Type': 'application/gzip' } }) : Response.json({ error: 'No such backup' }, { status: 404 });
  }
  const keys: { name: string; metadata: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: 'backup/', cursor });
    keys.push(...page.keys.map((k) => ({ name: k.name, metadata: k.metadata ?? null })));
    cursor = 'cursor' in page ? page.cursor : undefined; // only on an incomplete page
  } while (cursor);
  return Response.json(keys);
}
