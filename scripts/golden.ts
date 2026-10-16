// Golden master: a scripted three days of the tree through the real collector, routes and engines,
// compared with the recorded run in scripts/golden/golden.json. Refactors must leave it identical.
//   npm run test:golden              compare
//   npm run test:golden -- --update  record a new golden (only for an intended change, after review)
//   npm run test:golden -- --dump d  also write every checkpoint in full to directory d (diff two commits)
import { followClock } from './golden/env'; // first: timezone, locale and the simulated clock
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { Bench, MIN, type Reading } from './bench';
import { eventRoutes } from '../server/routes/events';
import { historyRoutes } from '../server/routes/history';
import { interactionRoutes } from '../server/routes/interactions';
import { statusRoutes } from '../server/routes/status';

const GOLDEN = path.join(import.meta.dirname, 'golden', 'golden.json');
const args = process.argv.slice(2);
const update = args.includes('--update');
const dumpDir = args.includes('--dump') ? args[args.indexOf('--dump') + 1] : null;

// Key order and float noise (re-associated sums) are not behaviour: sort keys, keep 10 significant digits
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().flatMap((k) => ((v as any)[k] === undefined ? [] : [[k, canon((v as any)[k])]])))
      : typeof v === 'number' && !Number.isInteger(v)
        ? Number(v.toPrecision(10))
        : v;
const hash = (v: unknown) => createHash('sha1').update(JSON.stringify(canon(v)) ?? 'undefined').digest('hex').slice(0, 12);

const b = new Bench();
followClock(() => b.clock);
const at = (t: number) => new Date(t).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// ---- the tree's three days ----
// Day 1 (Mon 15 Jun, 09:00): comfortable, drying. Outage at 22:00. Day 2: thirsty → very dry, restart at 06:00,
// rain then grey, petting at 11:00, a big watering at 15:00 (sensor). Day 3: clear and windy, pruning at 10:00,
// a heat spell 13:00–15:30, a watering by hand at 16:00. Ends Thu 09:00, then a cold restart (replay) and a warm one.
const DAYS = 3;
let soil = 62;
const reading = (i: number): Reading | null => {
  if (i >= 780 && i < 805) return null;
  const d = new Date(b.clock);
  const h = d.getHours() + d.getMinutes() / 60;
  const sun = h >= 6 && h <= 19 ? Math.sin((Math.PI * (h - 6)) / 13) : 0;
  const heat = i >= 3120 && i < 3270;
  return {
    soil: Math.round(soil * 10) / 10,
    light: Math.round(70 * sun),
    temp: heat ? 35 : Math.round((22 + 5 * Math.sin((Math.PI * (h - 9)) / 12)) * 10) / 10,
    hum: heat ? 33 : Math.round(65 - 10 * Math.sin((Math.PI * (h - 9)) / 12)),
  };
};
const weatherFor = (i: number) =>
  i < 1200 ? { code: 0, temp: 24 } : i < 1440 ? { code: 61, temp: 17 } : i < 2880 ? { code: 3, temp: 20 } : { code: 0, temp: 27, gusts: 20 };

type Snapshot = ReturnType<typeof b.collector.snapshot>;
const SECTIONS = ['perception', 'health', 'behaviour', 'expression', 'liveReadings', 'recentEvents', 'recentEpisodes', 'forecast'] as const;
const summary = (s: Snapshot) => ({
  condition: s.health?.condition,
  modifiers: s.health?.modifiers.join(',') ?? '',
  vitality: s.health?.vitality,
  mood: s.behaviour?.mood,
  scene: s.expression?.atmosphere.scene,
  visitors: [
    s.expression?.visitor && `squirrel:${s.expression.visitor.mode}`,
    s.expression?.dragonfly && 'dragonfly',
    s.expression?.sloth && `sloth:${s.expression.sloth.pose}`,
  ]
    .filter(Boolean)
    .join(' '),
  says: s.expression?.message.visible ? s.expression.message.text : '',
});
// Every poll's state is folded into the next checkpoint's digest, so a difference lasting a single minute
// between two hourly checkpoints still shows (in the hour it happened)
let rolling = Object.fromEntries(SECTIONS.map((k) => [k, createHash('sha1')]));
const fold = () => {
  const s = b.collector.snapshot();
  for (const k of SECTIONS) rolling[k].update(hash(s[k]));
};
const checkpoint = (label: string) => {
  const s = b.collector.snapshot();
  for (const k of SECTIONS) rolling[k].update(hash(s[k]));
  const digest = Object.fromEntries(SECTIONS.map((k) => [k, rolling[k].digest('hex').slice(0, 12)]));
  rolling = Object.fromEntries(SECTIONS.map((k) => [k, createHash('sha1')]));
  return { at: at(b.clock), label, summary: summary(s), hash: digest, full: canon(s) };
};

async function run() {
  const started = performance.now();
  b.weather = weatherFor(0);
  await b.boot();
  const checkpoints: ReturnType<typeof checkpoint>[] = [];
  for (let i = 0; i < DAYS * 24 * 60; i++) {
    if (i === 1260) await b.boot(); // restart: resumes the saved memory
    if (i === 1560) b.collector.recordInteraction({ kind: 'pet', startedAt: b.clock - 3 * MIN, endedAt: b.clock, count: 12, activeMs: 90_000 });
    if (i === 1800) soil = 76;
    if (i === 2940) b.collector.logEvent('pruning', 'golden prune');
    if (i === 3300) {
      b.collector.logEvent('watering', 'by hand');
      soil += 10;
    }
    if (i % 15 === 0) {
      b.weather = weatherFor(i);
      await b.collector.pollWeather();
    }
    soil = Math.max(0, soil - (i < 1800 ? 1.6 : 0.4) / 60);
    await b.poll(reading(i));
    if ((i + 1) % 60 === 0) checkpoints.push(checkpoint(`h${(i + 1) / 60}`));
    else fold();
  }

  // The routes, over HTTP, on the simulated clock
  const app = express();
  app.use(express.json());
  app.use('/api', statusRoutes(b.db, b.collector, 0));
  app.use('/api/events', eventRoutes(b.db, b.collector));
  app.use('/api/interactions', interactionRoutes(b.db, b.collector));
  app.use('/api/history', historyRoutes(b.db, b.collector));
  const server = await new Promise<ReturnType<typeof app.listen>>((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const get = async (p: string) => (await fetch(base + p)).json();
  const current = await get('/current');
  delete current.serverTime;
  delete current.status.startedAt;
  delete current.status.backend;
  delete current.status.dbPath;
  const routes = {
    current,
    diary: await get('/history/diary?days=3'),
    daily: await get('/history/daily?days=7'),
    hourly: await get('/history/hourly?hours=72'),
    episodes: await get('/history/episodes?days=30'),
    events: await get('/events?days=30'),
    interactions: await get('/interactions?days=30'),
  };
  server.close();

  // Restarts: without saved memory (replays stored telemetry), then with it
  b.db.setMeta('health_memory', null);
  await b.boot();
  checkpoints.push(checkpoint('cold restart (replay)'));
  await b.boot();
  checkpoints.push(checkpoint('warm restart'));

  return { checkpoints, routes: canon(routes) as Record<string, unknown>, logs: b.logs, ms: performance.now() - started };
}

// Up to `max` differing paths between two canonical values
function diff(a: unknown, c: unknown, p = '', out: string[] = [], max = 25): string[] {
  if (out.length >= max) return out;
  const show = (v: unknown) => (JSON.stringify(v) ?? 'undefined').slice(0, 120);
  if (a && c && typeof a === 'object' && typeof c === 'object') {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(c)])]) diff((a as any)[k], (c as any)[k], p ? `${p}.${k}` : k, out, max);
  } else if (JSON.stringify(a) !== JSON.stringify(c)) {
    out.push(`  ${p}: ${show(a)} → ${show(c)}`);
  }
  return out;
}

const result = await run();
const golden = {
  note: 'Recorded by scripts/golden.ts. Regenerate only for an intended behaviour change: npm run test:golden -- --update',
  checkpoints: result.checkpoints.map(({ full, ...c }) => c),
  routes: result.routes,
  logs: result.logs,
};
if (dumpDir) {
  fs.mkdirSync(dumpDir, { recursive: true });
  result.checkpoints.forEach((c, i) =>
    fs.writeFileSync(path.join(dumpDir, `${String(i).padStart(3, '0')}-${c.label.replace(/\W+/g, '_')}.json`), JSON.stringify(c.full, null, 1))
  );
  fs.writeFileSync(path.join(dumpDir, 'routes.json'), JSON.stringify(result.routes, null, 1));
  console.log(`dumped ${result.checkpoints.length} checkpoints to ${dumpDir}`);
}

const secs = (result.ms / 1000).toFixed(1);
if (update || !fs.existsSync(GOLDEN)) {
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
  console.log(`golden recorded: ${golden.checkpoints.length} checkpoints, ${Object.keys(golden.routes).length} routes (${secs}s) → ${path.relative(process.cwd(), GOLDEN)}`);
} else {
  const old = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as typeof golden;
  const problems: string[] = [];
  if (old.checkpoints.length !== golden.checkpoints.length) problems.push(`✗ ${old.checkpoints.length} checkpoints recorded, ${golden.checkpoints.length} now`);
  let shown = 0;
  golden.checkpoints.forEach((c, i) => {
    const o = old.checkpoints[i];
    if (!o) return;
    const sections = SECTIONS.filter((k) => o.hash[k] !== c.hash[k]);
    if (!sections.length && JSON.stringify(o.summary) === JSON.stringify(c.summary)) return;
    if (shown++ < 12) problems.push(`✗ ${c.label} (${c.at}) differs in ${sections.join(', ') || 'summary'}\n${diff(o.summary, c.summary).join('\n')}`);
    else if (shown === 13) problems.push('  … more checkpoints differ (--dump on both commits to compare in full)');
  });
  for (const k of Object.keys({ ...old.routes, ...golden.routes })) {
    const d = diff(old.routes[k], golden.routes[k]);
    if (d.length) problems.push(`✗ route ${k}\n${d.join('\n')}`);
  }
  const logs = diff(old.logs, golden.logs);
  if (logs.length) problems.push(`✗ collector log\n${logs.join('\n')}`);
  for (const p of problems) console.log(p);
  console.log(
    problems.length
      ? `\ngolden FAILED (${secs}s)`
      : `✓ golden: ${golden.checkpoints.length} checkpoints and ${Object.keys(golden.routes).length} routes identical (${secs}s)\n\nall passed`
  );
  process.exitCode = problems.length ? 1 : 0;
}
