# Appbonsai

A digital living companion for one real Ficus bonsai. An ESP32 on the balcony measures soil, air and light;
the Appbonsai server collects the readings into SQLite and runs the living loop
(perception → health → behaviour → expression); a React app shows the tree.

## One collector, one database: the Raspberry Pi

```
ESP32 (bonsai.local)
  ↓  polled every minute
Raspberry Pi: Appbonsai server (npm run server, systemd)
  ├─ collector         ← the ONLY process that polls the ESP32
  ├─ SQLite            ← data/appbonsai.db, the authoritative history
  ├─ Health + Behaviour engines
  └─ HTTP API on :3001 (+ the built app)
       ↓  HTTP only
Laptop: Vite dev frontend (npm run dev)
```

The laptop never opens the Pi's database and never polls the ESP32 in normal development. It only talks
to the Pi's HTTP API, so the Pi stays the authority. Care events you log or settings you save from the
laptop go through that API into the Pi's database, exactly as from the production app.

| Mode | Command | Polls the ESP32 | Writes telemetry / history | Database |
|---|---|---|---|---|
| **Production (Pi)** | `npm run server` (systemd) | **yes** | **yes** | `data/appbonsai.db` on the Pi |
| **Laptop dev against the Pi** (default) | `npm run dev` = `npm run dev:remote` | no | no (only via the Pi's API) | none on the laptop |
| **Local full stack** (only when needed) | `npm run dev:local` | **yes, a second collector** | **yes, a separate history** | `data/appbonsai-dev.db` on the laptop |

## Production on the Raspberry Pi

```bash
npm install
npm run build      # builds the frontend into dist/
npm run server     # API + ESP32 collector + SQLite, serves dist/ too
```

Normally systemd runs `npm run server` automatically at boot and restarts it, so you only rebuild and
restart after pulling changes:

```bash
git pull && npm install && npm run build && sudo systemctl restart appbonsai   # use your unit's name
```

- The server listens on `0.0.0.0:3001`, so the app is at **http://ender3.local:3001** and the laptop can
  reach the API. Port 80 on the Pi belongs to Mainsail/Moonraker, not Appbonsai.
- The API accepts browser requests only from this machine and the local network (localhost, private IPs,
  `*.local` names). There are no accounts: keep port 3001 off the internet.
- Optional settings for the systemd unit (`Environment=...`): `APPBONSAI_API_PORT`, `APPBONSAI_HOST`,
  `APPBONSAI_DB`, `APPBONSAI_CORS_ORIGINS`, `APPBONSAI_SERVE_APP` (see `.env.example`).

An example unit (`/etc/systemd/system/appbonsai.service`), in case you need to recreate it (adjust the user and path to your checkout):

```ini
[Unit]
Description=Appbonsai server (ESP32 collector + SQLite + API)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/rachad/appbonsai
ExecStart=/usr/bin/npm run server
Restart=always
User=rachad

[Install]
WantedBy=multi-user.target
```

## Laptop development against the Pi (normal)

Once: create `.env.remote` (gitignored) with the Pi's API address:

```bash
VITE_API_BASE_URL=http://ender3.local:3001
```

Then:

```bash
npm run dev        # same as npm run dev:remote
```

Open http://localhost:3000. This runs **only Vite**. There's no local API, no collector and no local
database. Every API call goes from your browser straight to the Pi. The terminal prints
`Backend: Raspberry Pi / remote → …`. In the app, a green `PI · …` badge in the header and the
**Backend** box in the Developer panel show the API address, who collects and which database it is.
If the Pi is off, the header says **Raspberry Pi offline** and the tree tells you which address it
couldn't reach.

Without `VITE_API_BASE_URL`, `npm run dev:remote` refuses to start rather than guessing.

## Local full-stack development (separate history)

```bash
npm run dev:local
```

Starts Vite **and a local development server** with its own collector and its own database,
`data/appbonsai-dev.db`. **This writes a separate development history**: it polls the ESP32 (if the
dev settings point at it) and records readings, care events and episodes that the Pi never sees.
The terminal shows a `LOCAL DEVELOPMENT BACKEND` banner, and the app shows a yellow **LOCAL DEV DB**
badge. The local server only listens on 127.0.0.1. Use it to test server or collector changes; for
everything else use `npm run dev`.

## Other commands

- `npm test`: the scenario suites (engines, collector, behaviour). They use in-memory databases.
- `npm run lint`: type-check.
- `npm run db:inspect`: read-only summary of `data/appbonsai.db` (`APPBONSAI_DB` picks another file).

Architecture details for contributors live in `CLAUDE.md`.
