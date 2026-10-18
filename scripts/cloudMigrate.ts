import { APP_CONFIG } from '../src/config/appConfig';
import { dumpDatabase } from '../server/database';
import { nodeSqliteDriver } from '../server/nodeSqlite';
import { call, readDumpFile, status } from './cloudApi';

// npm run cf:migrate -- status | migrate [--file <backup>] | top-up
// Moves a tree to its Durable Object on Cloudflare (docs/HOSTING.md). Address and password: .env.cloud.
//   status   what the cloud tree has (devices, last push, readings)
//   migrate  replace the cloud tree's data with the laptop's: readings, episodes, events, petting, outside
//            weather, calibration history, settings, saved memories, devices (with their token hashes, so the
//            ESP32 keeps its token). Refused once the cloud tree has sensor readings of its own.
//            --file: from a backup instead (npm run cf:backup), e.g. into a new, empty tree after a disaster.
//   top-up   after the ESP32 has moved: the readings the laptop got in between
// The laptop's database: APPBONSAI_DB, else the dev database (npm run dev:local). Read only.

const args = process.argv.slice(2);
const cmd = args[0] ?? 'status';
const file = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

const local = () => {
  if (file) {
    const dump = readDumpFile(file);
    console.log(`backup ${file}: ${dump.tables.telemetry.length} readings, ${dump.tables.behaviour_episodes.length} episodes, ${dump.tables.devices.length} devices`);
    return dump;
  }
  const db = process.env.APPBONSAI_DB ?? APP_CONFIG.server.devDbPath;
  const sql = nodeSqliteDriver(db, { readOnly: true });
  const dump = dumpDatabase(sql);
  sql.close();
  console.log(`laptop database ${db}: ${dump.tables.telemetry.length} readings, ${dump.tables.behaviour_episodes.length} episodes, ${dump.tables.devices.length} devices`);
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
    console.error('Usage: npm run cf:migrate -- status | migrate [--file <backup>] | top-up');
    process.exitCode = 1;
  }
} catch (err: any) {
  console.error(`Failed: ${err?.message ?? err}`);
  process.exitCode = 1;
}
