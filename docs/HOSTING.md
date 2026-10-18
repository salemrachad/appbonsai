# Hosting: from the Pi to the cloud

The Raspberry Pi that ran the collector is gone (2026-10-17: its Wi-Fi broke and its SD card got corrupted), and
with it the history in `data/appbonsai.db`. The goal now is a hosted setup that also works as a product later:
you sign in, add a plant, and scan the barcode that comes with the pot (the box: ESP32 and sensors already mounted).
For now: one prototype, one account, one tree. The design must still allow for many.

## Decided

- **Host: Cloudflare Workers + one Durable Object per tree** (free plan). Each object has its own SQLite, alarms
  for the timers and a live connection to the app: the shape of "one collector per tree", with no idle reclaim and
  no server to maintain. Free-plan limits checked on 2026-10-17: 100k requests and 100k rows written a day, 5M rows
  read, CPU 30 s per Durable Object request (the front Worker only 10 ms: it must only route), storage 1–5 GB (the
  docs disagree), so raw readings need a retention rule within a few years. Oracle Cloud Always Free was the other
  candidate (no rewrite, but idle VMs can be reclaimed); Supabase + Vercel would rewrite the server layer and fight
  the stateful loop.
- **Login: Cloudflare Access** for now (free, no code). Real accounts and the barcode claim come with phase 2.
- **The ESP32 pushes** (it is on someone's home network, which no server can reach). Protocol below.

## Steps

1. **Push protocol**: the server side (`POST /api/ingest`, the `devices` table, `npm run device`, Settings → "The
   ESP32 sends its readings", scenarios PU1–PU10) and firmware 1.1.0 (device id, push settings at `/settings`, a
   6 h RAM buffer). Firmware 1.2.0 can be updated over Wi-Fi (below). Running against the laptop since 2026-10-17.
2. **Database interface + the tree** (done 2026-10-18): `AppDatabase` keeps all the SQL but runs it through a
   `SqlDriver` (`exec`, `all`, `close`); `server/nodeSqlite.ts` is the laptop's driver, and a Durable Object's
   `ctx.storage.sql.exec` will be another (it is synchronous too). The SQL avoids what only node:sqlite has
   (`RETURNING` instead of changes / lastInsertRowid). A `trees` table holds the database's one tree, and
   `devices.tree_id` links each device to it (a tree is not a device: a replaced sensor keeps the tree's history).
   Readings, events and episodes carry no tree id: with one Durable Object per tree each tree already has its own
   database (decided 2026-10-18, instead of a `tree_id` on every table). The golden master stayed identical.
3. **The collector as one step per reading** (done 2026-10-18): after every step the collector saves what a restart
   would lose (`collector_runtime`: status, the last evaluation, the last two readings, the watering detector with
   a rise waiting for confirmation, the timers' due times, the day's sloth memory; `collector_state`: the last
   evaluated state). A resumed start in push mode evaluates nothing and fetches nothing that isn't due, so waking
   up changes nothing: scenario RS1 restarts the collector before every push and gets the same state, status,
   events and episodes every minute as one that never stops. One timer (`nextWakeAt()` → `wake()`) runs whatever is
   due: the Durable Object's alarm. A cold start still reads the last 24 h of readings (~1,440 rows); with a push
   every minute the object mostly stays loaded, so that happens rarely. If it shows up in the read quota, keep the
   samples in the saved state instead.
4. **Worker + Durable Object** (built 2026-10-18, see "On Cloudflare" below). Originally: running that step, the
   app served as static assets, Cloudflare Access in front. The
   ESP32's server URL changes to the Worker (HTTPS).

Later (product): accounts and "add plant" with the barcode claim, Bluetooth Wi-Fi setup, OTA firmware updates,
notifications, a capacitive soil probe (the FC-28 corrodes), more species.

## On Cloudflare

- **`worker/index.ts`**:
  - **The front Worker** checks a password (HTTP Basic, the secret `APP_PASSWORD`; any user name), except for
    `/api/ingest`, which has its device token. It then hands `/api/*` to the tree's Durable Object and the page to
    the static assets (`dist/`). The hashed `/assets/*` files skip it (`run_worker_first` in `wrangler.jsonc`).
    Without the secret it answers 503, so a fresh deploy exposes nothing.
  - **`TreeObject`** (one per tree, `idFromName('ficus')` for now) holds its own SQLite through
    `server/durableSqlite.ts`, the collector, and the same Express routes as the laptop (`server/app.ts`). The routes
    run on a `node:http` server inside the isolate (`handleAsNodeRequest`). Its alarm is the collector's timer
    (`nextWakeAt()` → `wake()`), and it waits for `collector.settled()` before answering. `/api/stream` is off there:
    an open stream keeps the object awake and billed, so the browser polls `/api/current` with its ETag.
- **Decided 2026-10-18: a password instead of Cloudflare Access for now.** It needs no Zero Trust setup and no
  bypass rule for the ESP32. Accounts come with the product.
- **Express in the Worker:** `express.json()` is replaced by a small JSON reader (`server/app.ts`). `iconv-lite`
  (Express → body-parser) is aliased to `worker/shims/iconv-lite.ts`, because its bundled form fails to start in the
  runtime.
- **Commands:**
  - `npm run cf:dev` runs the app, Worker and object locally on wrangler (password from the gitignored `.dev.vars`:
    `APP_PASSWORD=...`; storage in `.wrangler/`).
  - `npm run cf:deploy` builds and deploys.
  - `npx wrangler secret put APP_PASSWORD` sets the password.
  - `npm run cf:types` regenerates `worker/worker-configuration.d.ts` after a change to `wrangler.jsonc`.
  - `npm run lint` also type-checks the Worker (`worker/tsconfig.json`).
- **Moving the laptop's tree there:** `npm run cf:migrate -- migrate` (`scripts/cloudMigrate.ts`).
  - It reads the cloud address and password from the gitignored `.env.cloud` (`APPBONSAI_CLOUD_URL`,
    `APPBONSAI_CLOUD_PASSWORD`), so the password is never on a command line.
  - It sends a dump of the laptop's database (read only) to `POST /api/admin/restore`. The object stops its
    collector, replaces everything in one transaction (rows keep their ids, devices move to the cloud's tree with
    their token hashes) and rebuilds the collector. The tree then resumes as it was on the laptop (scenarios
    MV1–MV4).
  - A second `migrate` is refused once the cloud tree has sensor readings of its own.
  - `npm run cf:migrate -- top-up` adds the readings the laptop got before the ESP32 switched; `-- status` shows
    the devices and their last push.
- **Setting up a new tree by hand:** `PUT /api/config` with the settings (`dataSource: esp32_sensor`,
  `esp32Transport: push`), then `POST /api/devices {id, label, token}` with the token the ESP32 already has. Either
  way the ESP32 then only needs its server address changed at `http://<device>/settings`.
- **Checked locally (wrangler dev):**
  - the password works on the page and the API, and assets stay public;
  - a firmware-shaped push is accepted, a retry is dropped, a wrong token gets 401;
  - after a restart (the object unloaded) the state is back without a new evaluation;
  - the alarm notices a missing push on its own (90 s).

## Backups

Decided 2026-10-18. Two layers, because the likeliest loss is our own bug or a wrong deploy, and the
rarest but worst is losing the Cloudflare account (the Pi's history was lost for want of any copy).

1. **Nightly, automatic, in KV** (`server/backup.ts`, the object's alarm, about 05:00 in Beirut / 02:00 UTC; the
   first one two minutes after a deploy).
   - A series starts with a complete backup. Each next one holds the rows of `telemetry` and `outside_weather`
     added since the previous one (by id, so readings stored late from the device's buffer are still caught),
     plus the small tables and the memories whole. That's one gzip JSON value per night, under
     `backup/<tree id>/<series>/<seq>`.
   - A restore starts a new series (`backup_state` is never in a dump and is cleared by a restore).
   - Sizes: the first one is about 43 KB; a night is about 10 KB plus the day's readings.
   - KV is free without a card (1 GB, 1,000 writes a day), enough for one tree for decades. With many trees (the
     product) it moves to R2 on the paid plan: only `TreeObject.backup()` and the two routes touch KV.
   - A failed backup is retried an hour later.
2. **Monthly, by hand, outside Cloudflare:** `npm run cf:backup` saves the whole tree to
   `backups/appbonsai-<date>.json.gz` (gitignored), to keep in Google Drive.

**Commands and routes** (all behind the password):

| Command | What it does |
|---|---|
| `npm run cf:backup` | `GET /api/admin/dump`: the whole tree, saved to a file |
| `npm run cf:backup -- --nightly` | Rebuilds the tree from the latest series (`assemble()` refuses a gap) and compares it with the live tree: the proof that the nightly backups bring it back |
| `npm run cf:backup -- --now` | `POST /api/admin/backup-now`: a nightly backup now, e.g. before a risky change |
| `npm run cf:migrate -- migrate --file backups/<file>` | Restores a backup into an empty tree |

The routes `GET /api/admin/backups` and `/api/admin/backups/<key>` list the nightly backups and download one.

**Tested:**
- Scenarios BK1–BK3: three nights with buffered readings arriving late are rebuilt into a dump identical to the
  database, a missing night is refused, and a tree restored from them resumes as the same tree.
- On wrangler dev: migrate, two backups, the rebuild equal to the live tree, a full copy, then the tree wiped
  and restored from the file, identical in every table and memory.

## Push protocol v1

The device sends its readings to `POST /api/ingest` every interval (60 s by default):

```http
POST /api/ingest
Authorization: Bearer <device token>
Content-Type: application/json

{ "v": 1, "device_id": "a1b2c3d4e5f6", "fw": "1.3.0", "boot": "7f3a9c", "uptime_ms": 8700000,
  "readings": [
    { "seq": 1042, "uptime_ms": 8640000, "soil_moisture": 46, "soil_raw": 2310, "temperature": 23.4,
      "humidity": 61, "light_percent": 72, "light_raw": 2950, "hts221_connected": true, "wifi_rssi": -61 } ] }
```

- **A reading** is the JSON the device serves on `GET /api/telemetry`, plus `seq` and its time. The normalizer reads
  it unchanged.
- **Time:** `uptime_ms` of the reading against the request's `uptime_ms` puts it on the server's clock, so the
  device needs no clock. A reading may instead carry `t` (ms since epoch, e.g. from NTP; refused if more than 5 min
  in the future or older than 7 days). The newest reading without either is taken as "now".
- **`boot`** is random per start; within a boot `seq` only grows. The server keeps the highest `seq` per device and
  drops what it has seen, so a retried request is harmless.
- **Buffering:** while it can't reach the server, the device keeps its readings (in RAM: lost on a reboot) and sends
  them together, oldest first, at most 500 per request. They fill the history at the minute they were measured; the
  state the tree held through the outage is not rewritten.
- **Reply** `200 { "ok": true, "accepted": 1, "errors": [], "interval_s": 60, "commands": [] }`: `interval_s` is
  how often to send from now on (Settings; 3 s while a calibration captures). `commands` is reserved (e.g. a firmware
  update).
- **Errors:** `401` unknown device or wrong token, `400` bad body or another protocol version, `413` too many
  readings, `409` the server is not set to receive pushes (Settings → ESP32 → "The ESP32 sends its readings"; two
  collectors must never feed one tree). The device keeps its buffer and tries again at the next interval.

On the server, a push older than 1.5 intervals counts as a failed poll, exactly like a failed read in pull mode
(the reading goes stale, the state is held, then uncertain).

**Wireless firmware updates** (firmware 1.2.0): the device takes a new firmware on its own web server, protected
by the same device token, so it can stay mounted at the pot:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir <dir> firmware/appbonsai_esp32
curl -H "Authorization: Bearer <device token>" -F firmware=@<dir>/appbonsai_esp32.ino.bin http://<device ip>/update
```

`200` → it restarts into the new firmware (unsent readings in RAM are lost); `401` wrong or no token; `400` no file
or a bad image (the old firmware keeps running). This works on the device's own network only; updates from the
cloud (a `commands` entry in the push reply) come with the product.

**Devices:** `npm run device -- add <device id> [label]` prints the token once (only its SHA-256 is stored);
`token <id>` replaces it, `list`, `remove <id>`; `--local-dev` for the dev database.
