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
3. **The collector as one step per reading** with all its state saved (today the 24 h of readings and the watering
   detector context live in memory). A Durable Object is unloaded between requests, so a step must load a compact
   state, not re-read 1,440 rows each time.
4. **Worker + Durable Object** running that step, the app served as static assets, Cloudflare Access in front. The
   ESP32's server URL changes to the Worker (HTTPS).

Later (product): accounts and "add plant" with the barcode claim, Bluetooth Wi-Fi setup, OTA firmware updates,
notifications, a capacitive soil probe (the FC-28 corrodes), more species.

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
