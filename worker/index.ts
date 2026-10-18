import { handleAsNodeRequest } from 'cloudflare:node';
import { DurableObject } from 'cloudflare:workers';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { apiApp } from '../server/app';
import { LivingCollector } from '../server/collector';
import { openDurableDatabase } from '../server/durableSqlite';
import type { AppDatabase } from '../server/database';

// Appbonsai on Cloudflare (docs/HOSTING.md):
//   the front Worker   checks a password (except the ESP32's /api/ingest, which has its device token), then
//                      hands /api/* to the tree's Durable Object and the page to the static assets (dist/).
//                      The hashed /assets/* files skip it (wrangler.jsonc: run_worker_first).
//   TreeObject         one per tree: its own SQLite, the collector (the living loop) and the same Express
//                      routes as the laptop server, run on a node:http server inside the object. Its alarm
//                      is the collector's timer (overdue pushes, outside weather, the hike forecast).

interface Env {
  TREE: DurableObjectNamespace<TreeObject>;
  ASSETS: Fetcher; // the built app (dist/)
  APP_PASSWORD?: string; // wrangler secret put APP_PASSWORD
}

const PORT = 8787; // a routing key inside the object's isolate, not a network port
const TREE_NAME = 'ficus'; // one tree for now; later the tree a signed-in account claimed

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
    const response = await handleAsNodeRequest(PORT, request);
    await this.collector.settled(); // a poll or a forecast started by the request
    await this.arm();
    return response;
  }

  async alarm(): Promise<void> {
    await this.ready;
    this.collector.wake();
    await this.collector.settled();
    await this.arm();
  }

  // The alarm at the collector's next due job (set only when it moves: each set is a storage write)
  private async arm() {
    const at = this.collector.nextWakeAt();
    if (!Number.isFinite(at)) return void (await this.ctx.storage.deleteAlarm());
    const current = await this.ctx.storage.getAlarm();
    if (current !== at) await this.ctx.storage.setAlarm(Math.max(at, Date.now() + 1000));
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
    if (url.pathname.startsWith('/api/')) return env.TREE.get(env.TREE.idFromName(TREE_NAME)).fetch(request);
    return env.ASSETS.fetch(request);
  },
};
