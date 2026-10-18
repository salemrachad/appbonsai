import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { assemble, type NightlyBackup } from '../server/backup';
import { call, callGzip, t } from './cloudApi';

// npm run cf:backup [-- --nightly | --now]
// A copy of the tree on Cloudflare in backups/ (gitignored), to keep somewhere outside Cloudflare (Google Drive).
//   (nothing)  the whole tree as it is now → backups/appbonsai-<date>.json.gz
//   --nightly  rebuild the tree from the nightly backups in KV instead, and compare it with the live tree: the
//              proof that the nightly backups can bring it back
//   --now      make a nightly backup now (e.g. before a risky change), then list them
// Restoring a file: npm run cf:migrate -- migrate --file backups/<file> (into an empty tree).

const mode = process.argv[2] ?? '';
const day = new Date().toISOString().slice(0, 10);
const counts = (d: any) => `${d.tables.telemetry.length} readings, ${d.tables.behaviour_episodes.length} episodes, ${d.tables.plant_events.length} events, ${d.tables.interactions.length} petting, ${d.tables.outside_weather.length} weather, ${Object.keys(d.meta).length} memories`;

function save(name: string, dump: unknown) {
  fs.mkdirSync('backups', { recursive: true });
  const file = path.join('backups', name);
  const body = gzipSync(JSON.stringify(dump));
  fs.writeFileSync(file, body);
  console.log(`saved ${file} (${Math.round(body.length / 1024)} KB)`);
}

async function listNightly() {
  const keys: { name: string; metadata: any }[] = await call('/admin/backups');
  // The latest series (a restore starts a new one)
  const series = keys.map((k) => k.name.split('/')[2]).sort().at(-1);
  return { all: keys, latest: keys.filter((k) => k.name.split('/')[2] === series) };
}

try {
  if (mode === '') {
    const dump = await call('/admin/dump');
    console.log(`the tree now: ${counts(dump)}`);
    save(`appbonsai-${day}.json.gz`, dump);
  } else if (mode === '--nightly') {
    const { all, latest } = await listNightly();
    if (!latest.length) throw new Error('No nightly backups yet');
    console.log(`${all.length} nightly backups; the latest series has ${latest.length}, the last from ${t(latest.at(-1)!.metadata?.createdAt)}`);
    const backups: NightlyBackup[] = [];
    for (const k of latest) backups.push(await callGzip(`/admin/backups/${encodeURIComponent(k.name)}`));
    const rebuilt = assemble(backups);
    const live = await call('/admin/dump');
    console.log(`rebuilt from them: ${counts(rebuilt)}`);
    console.log(`the tree now:      ${counts(live)}`);
    const missing = live.tables.telemetry.filter((r: any) => r.id > backups.at(-1)!.cursor.telemetry).length;
    console.log(missing ? `(${missing} readings came in since the last nightly backup: the next one takes them)` : 'nothing came in since the last nightly backup');
    save(`appbonsai-nightly-${day}.json.gz`, rebuilt);
  } else if (mode === '--now') {
    const r = await call('/admin/backup-now', {});
    console.log(`backup ${r.key}: ${r.readings} new readings, ${Math.round(r.bytes / 1024)} KB`);
    const { all } = await listNightly();
    for (const k of all) console.log(`  ${k.name}  ${t(k.metadata?.createdAt)}  ${k.metadata?.readings ?? '?'} readings`);
  } else {
    console.error('Usage: npm run cf:backup [-- --nightly | --now]');
    process.exitCode = 1;
  }
} catch (err: any) {
  console.error(`Failed: ${err?.message ?? err}`);
  process.exitCode = 1;
}
