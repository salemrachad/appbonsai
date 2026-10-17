import { APP_CONFIG } from '../src/config/appConfig';
import { openDatabase } from './nodeSqlite';
import { addDevice, rotateDeviceToken } from './devices';

// npm run device -- add <id> [label] | token <id> | list | remove <id>     (--local-dev: the dev database)
// Adds the ESP32s allowed to push readings. The token is printed once: put it in the device's setup page.
// Safe while the server runs (SQLite WAL); the server sees a new device at its next push.
const args = process.argv.slice(2).filter((a) => a !== '--local-dev');
const localDev = process.argv.includes('--local-dev') || process.env.APPBONSAI_MODE === 'local-dev';
const db = openDatabase(process.env.APPBONSAI_DB ?? (localDev ? APP_CONFIG.server.devDbPath : APP_CONFIG.server.dbPath));
const [cmd, id, ...rest] = args;
const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : '–');

console.log(`database ${db.path} · tree ${db.tree().id}\n`);
if (cmd === 'add' && id) {
  const token = addDevice(db, id, rest.join(' ') || null);
  if (!token) {
    console.error(db.getDevice(id) ? `Device ${id} already exists (npm run device -- token ${id} gives it a new token)` : 'The device id must be 4–64 letters, digits, - or _');
    process.exitCode = 1;
  } else {
    console.log(`Added ${id}. Its token (shown only now):\n\n  ${token}\n`);
  }
} else if (cmd === 'token' && id) {
  const token = rotateDeviceToken(db, id);
  if (!token) {
    console.error(`No device ${id}`);
    process.exitCode = 1;
  } else {
    console.log(`New token for ${id} (the old one no longer works):\n\n  ${token}\n`);
  }
} else if (cmd === 'remove' && id) {
  console.log(db.deleteDevice(id) ? `Removed ${id}` : `No device ${id}`);
} else if (cmd === 'list' || !cmd) {
  const devices = db.devices();
  if (!devices.length) console.log('No devices yet: npm run device -- add <id>');
  else console.table(devices.map((d) => ({ id: d.id, label: d.label ?? '', added: t(d.createdAt), lastPush: t(d.lastSeenAt), firmware: d.firmware ?? '' })));
} else {
  console.error('Usage: npm run device -- add <id> [label] | token <id> | list | remove <id>   (add --local-dev for the dev database)');
  process.exitCode = 1;
}
db.close();
