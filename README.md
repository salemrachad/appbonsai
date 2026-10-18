# Appbonsai

A digital living companion for one real Ficus bonsai. An ESP32 in the greenhouse measures soil, air and light
and sends its readings every minute; the server stores them and runs the living loop
(perception → health → behaviour → expression); a React app shows the tree.

## How it runs: Cloudflare

```
ESP32 (at the pot)
  ↓  HTTPS push every minute: POST /api/ingest with its device token
Cloudflare
  ├─ front Worker       ← a password for the app; /api/ingest takes the device token instead
  ├─ the app            ← the built frontend (static assets)
  └─ the tree's Durable Object
       ├─ its own SQLite: readings, care, episodes, memories, devices
       ├─ the collector (the living loop) and the API
       └─ an alarm: overdue pushes, outside weather, the hike forecast, the nightly backup (to KV)
```

- **The app:** https://appbonsai.appbonsai.workers.dev (any user name, the app's password). Works from anywhere.
- **Deploying:** a push to `main` runs the type-check, all tests and the build on Cloudflare (Workers Builds),
  then deploys. Other branches get a preview with its own empty tree. `npm run cf:deploy` is the manual fallback.
- **Backups:** nightly in KV, plus `npm run cf:backup` for a copy to keep elsewhere (e.g. Google Drive).
- Decisions, the push protocol, deploying and backups: [docs/HOSTING.md](docs/HOSTING.md).

The Raspberry Pi that used to collect everything is gone (2026-10-17); its history went with it.

## Developing on the laptop

```bash
npm install
npm run dev        # = npm run dev:local
```

Starts Vite on http://localhost:3000 **and a local development server** with its own collector and its own
database, `data/appbonsai-dev.db`: a separate history that the live tree never sees. The terminal shows a
`LOCAL DEVELOPMENT BACKEND` banner and the app a yellow **LOCAL DEV DB** badge. The local server listens on
127.0.0.1 only; Vite proxies `/api` to it.

To try the Cloudflare side itself on the laptop: `npm run cf:dev` (the Worker and the tree's object in
wrangler's local runtime; its password in the gitignored `.dev.vars`, e.g. `APP_PASSWORD=local-test`).

## Commands

| Command | What it does |
|---|---|
| `npm run check` | Type-check (app, server, Worker) + all tests. Run before every push: a push to main is a deploy |
| `npm test` | The scenario suites (engines, collector, behaviour) and the golden master (a scripted three days that must stay identical); in-memory databases |
| `npm run cf:deploy` | Build and deploy by hand (the fallback to Workers Builds) |
| `npm run cf:backup [-- --nightly \| --now]` | A copy of the live tree in `backups/` (gitignored), or rebuild it from the nightly backups, or back up now |
| `npm run cf:migrate -- status` | What the live tree has: devices, last push, readings. `migrate --file <backup>` restores a backup into an empty tree |
| `npm run device -- add <id> [label]` | An ESP32 allowed to push to the laptop's server (`--local-dev` for the dev database) |
| `npm run server` | A self-hosted Node server instead of Cloudflare: API + collector + `data/appbonsai.db`, serves `dist/` |
| `npm run db:inspect` | Read-only summary of a local database (`APPBONSAI_DB` picks the file) |

`npm run cf:migrate` and `cf:backup` read the app's address and password from `.env.cloud` (gitignored); see
`.env.example`.

## The ESP32

`firmware/appbonsai_esp32/` (firmware 1.2.x): FC-28 soil probe, LDR, HTS221. Its page on the home Wi-Fi
(`http://bonsai.local`) shows the readings and the push status; `/settings` holds the server address and the
device token. It takes firmware updates over Wi-Fi (`POST /update` with the device token, see
`docs/HOSTING.md`).

Architecture details for contributors live in `CLAUDE.md`.
