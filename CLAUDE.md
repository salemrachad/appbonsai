# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Appbonsai is a "digital living companion" for one real Ficus bonsai. An ESP32 on the balcony measures soil, air and light. A local Node server collects the readings into SQLite and runs the living loop:

```
physical bonsai → PERCEPTION → HEALTH → BEHAVIOUR → EXPRESSION → React UI → human care → physical bonsai
```

**Read `docs/LIVING_ART.md` before changing perception, health, behaviour, expression or wording.** It holds the Living Art philosophy (the real tree is the artwork; the character interprets it), the biological principles with their evidence class, the three expression layers (epidermal / wording / diffraction), care and relationship rules, and what is implemented vs intended vs open.

**The Raspberry Pi that was the authoritative collector and database is gone** (2026-10-17: broken Wi-Fi, corrupted SD card, history lost). Don't plan around it. The server is moving to Cloudflare (Workers + one Durable Object per tree), with the ESP32 pushing its readings; it should later work as a product (accounts, "add plant", a barcode on the pot). **Read `docs/HOSTING.md`** for the decisions, the steps and the push protocol. Until then the only running stack is `npm run dev:local` on the laptop. README.md still describes the Pi modes. It started from a Google AI Studio template (`README.md`, `metadata.json`, `.env.example`).

## Commands

- `npm install`: install dependencies (needs Node ≥ 22.5, which provides built-in `node:sqlite`; developed on Node 24)
- `npm run dev` = `npm run dev:remote`: **Vite only** (mode `remote`) on http://localhost:3000, talking straight to the Pi's API at `VITE_API_BASE_URL` (in the gitignored `.env.remote`, e.g. `http://192.168.10.195:3001`; prefer the IP: `ender3.local` costs ~300 ms per request on mDNS lookup and sometimes fails; the Pi's port 80 is Moonraker). No local collector or database. It refuses to start without the variable.
- `npm run dev:local`: the full stack on the laptop (Vite mode `fullstack` + `server/index.ts --local-dev` via `tsx watch`). **A separate collector and history** in `data/appbonsai-dev.db`, API on 127.0.0.1:3001 only, Vite proxies `/api` there. Only for server/collector work.
- `npm run server`: production (the Pi): API + collector + SQLite `data/appbonsai.db`, listens on `0.0.0.0:3001`, and serves `dist/` when built (`npm run build`). Everything is gzipped (`compression`); `dist/assets/*` (hashed) is cached as immutable and `index.html` is `no-cache`. `vite.config.ts` puts React and lucide in a `vendor` chunk. Fonts are self-hosted (`@fontsource-variable/*`, imported in `main.tsx`), with no Google Fonts requests.
- Server env vars: `APPBONSAI_API_PORT`, `APPBONSAI_HOST`, `APPBONSAI_DB`, `APPBONSAI_CORS_ORIGINS`, `APPBONSAI_SERVE_APP`, `APPBONSAI_MODE=local-dev` (= `--local-dev`); documented in `.env.example`.
- `npm run check`: `lint` + `npm test`. Run it before every commit; refactors must pass it unchanged.
- `npm test`: runs the three scenario suites and the golden master (there is no test framework; these are the regression checks). `scripts/bench.ts` is the shared bench: the real `LivingCollector`, in-memory SQLite, a fake ESP32 and a simulated clock.
  - `npm run test:scenarios` (`scripts/scenarios.ts`): pure engine checks: dry→thirsty→very dry, recovery, night vs too dark, brief vs sustained heat, watering reactions, outage overlay, dev override, season (date/latitude, energy, seasonal look, no jumps across boundaries all year, seasonal care reactions), every condition looking distinct, threshold hovering.
  - `npm run test:collector` (`scripts/collectorScenarios.ts`): watering detection (spikes, probe pulled, gradual, sessions, manual merge, saturation, calibration pause), sensor reality checks, outages, restarts, long gaps, DB migration, push (PU1–PU10: pushed and pulled readings give an identical state every minute, auth, retries, overdue pushes, buffered backfill, device clocks, calibration bursts), restarts between steps (RS1–RS3: restarted before every push = never stopped, every minute; a resumed start evaluates nothing; the timers are saved). The bench's fake ESP32 can push (`usePush()`, `push()`, `send()`). The normalizer stamps `updatedAt` from the wall clock, so comparisons across benches leave it out.
  - `npm run test:behaviour` (`scripts/behaviourScenarios.ts`): talking vs silence, thirst escalation, relief, recovery stages, concern on wet soil, quiet nights, morning lines, once-per-episode lines across refresh/restart, variants, rewording safety, same condition with different history.
  - `npm run test:golden` (`scripts/golden.ts`): the **golden master**. A scripted three days (comfortable → thirsty → very dry → sensor watering → recovering, an outage, restarts, rain, petting, pruning, a heat spell, a manual watering, then a cold restart that replays 48 h) through the real collector, and the routes over HTTP. Each hourly checkpoint holds a digest of every poll's perception/health/behaviour/expression/… plus a readable summary; the routes (`/current`, diary, daily, hourly, episodes, events, interactions) and the collector log are stored in full. It must stay identical across refactors. `scripts/golden/env.ts` pins the timezone (Asia/Beirut), the locale and `Date` to the simulated clock, so it is the same on the laptop and the Pi. Only for an intended behaviour change: `npm run test:golden -- --update`, and review the `scripts/golden/golden.json` diff. `-- --dump <dir>` writes every checkpoint in full (dump two commits and diff them).
- UI type-checking: `@types/react`/`@types/react-dom` are installed, so `npm run lint` checks `.tsx` props too. Still look at UI changes in the browser.
- `npm run device -- add <id> [label]` / `token <id>` / `list` / `remove <id>` (`--local-dev` for the dev DB): the ESP32s allowed to push (`server/device.ts`). The token is printed once; only its SHA-256 is stored.
- `npm run db:inspect`: read-only summary of `data/appbonsai.db` (counts, latest readings, episodes, events). `APPBONSAI_DB` points it (and the server) at another file.
- `npm run lint`: type-check only (`tsc --noEmit`, covers `src/`, `server/`, `scripts/`). There is no ESLint.
- `npm run build`: frontend production build (the server runs from source with tsx).

For quick throwaway checks, a script run with `npx tsx` can call the pure engines directly. Testing the server against a scratch DB and port works well: `APPBONSAI_DB=<tmp>.db APPBONSAI_API_PORT=3011 npx tsx server/index.ts --local-dev`. To test remote mode without the Pi, run a production-mode server on a scratch DB and point Vite at it: `VITE_API_BASE_URL=http://<lan-ip>:3011 npx vite --mode remote --port 3060`.

### Backend boundary (laptop ↔ Pi)

- `src/config/backend.ts` is the only place that knows the API address (`apiUrl()`, `BACKEND`); `src/api/client.ts` is the only API caller. No other frontend code may build `/api` URLs or hardcode hosts/ports. `vite.config.ts` forces `VITE_API_BASE_URL` empty in every mode except `remote`, so builds and `dev:local` are always same-origin.
- `server/cors.ts`: the API answers CORS only for loopback, private IPv4 and `*.local` origins (+ `APPBONSAI_CORS_ORIGINS`); other origins get no headers and preflights are refused.
- `/api/status` includes `backend` (`BackendInfo`: mode, hostname, listen address, db path, who collects). The Developer panel's **Backend** box and the dev-build header badge (`components/developer/BackendPanel.tsx`, `BackendBadge.tsx`) show it.
- Against a remote backend the browser never seeds the Pi: the first-run settings push and the legacy localStorage history import are skipped (`App.tsx`).
- Settings → Test Link still fetches the ESP32 from the browser, but only when clicked; nothing in the frontend polls the ESP32.

## Template leftovers

- `GEMINI_API_KEY` (commented out in `.env.example`) and `metadata.json` come from the AI Studio template and are unused; its `@google/genai` and `dotenv` dependencies were removed. `express` **is** used, by the local server. Build tools (vite, its plugins, tsx) are devDependencies; the Pi needs a plain `npm install` (with dev) since `npm run server` runs through tsx.
- `vite.config.ts` reads `DISABLE_HMR`, which AI Studio sets to turn off HMR and file watching. Keep that logic.
- The `@/*` path alias points to the repo root, not `src/`. Existing code uses relative imports.

## Architecture

Each layer has one job. Keep them separate. Biological thresholds never go in React components, and the avatar never sees sensor values.

| Layer | Folder | Responsibility |
|---|---|---|
| Config | `src/config/appConfig.ts` | Ports, DB path, poll intervals, timeouts, data gap limits, watering-jump threshold, data-quality limits, engine version. No biology. |
| Time | `src/lib/time.ts` | `MIN`/`HOUR`/`DAY` in ms and the clock formats `hhmm`/`hhmmss` (device locale). Use these, never local copies. (`ficus.ts` keeps its own `MIN`/`HOUR`: its latch durations are in minutes.) |
| Species | `src/species/ficus.ts` (+ `types.ts`) | **Every tunable biological number in one place**: comfort ranges, relative light bands, hysteresis latch rules (enter/exit values and durations), vitality weights and time constants, stress penalties, recovery windows, seasonal rules (`seasons`: growth phase, energy factor, water need, feeding; `seasonalCycle`: yearly curves for new growth, yellowing, leaf drop). Soil % and LDR light % are labelled **prototype/local calibration**. |
| Telemetry | `src/telemetry/` | Get and normalize measurements (`telemetryNormalizer.ts` is the only ESP32 JSON reader). `dataQuality.ts` covers stale/unavailable data, missing sensors, impossible jumps and insufficient history. |
| Perception | `src/perception/` | `perceive()` → `PerceptionState`: fresh readings (all null when stale), sun position/phase (`sun.ts`, from the tree's lat/lon), season (`season.ts`: meteorological season by month, flipped south of the equator, stage, `blend` with the neighbouring season within 14 days of a boundary, `seasonalDay`, day length and its trend), trends, recent 24 h samples, care events, data quality. |
| Health | `src/health/` | `evaluatePlantHealth({perception, species, memory})` → `{state, memory}`: the biological condition, modifiers, health scores, vitality with a full breakdown, hysteresis debug. It decides no wording or personality. |
| Behaviour | `src/behaviour/` | `evaluateBehaviour()`: mood, energy, responsiveness, intensity + tier, recovery stage, afterglow, time of day, message intent, care reactions (diffraction), relationship memory (`relationship.ts`). `speech.ts` decides when to speak or stay silent; `messages.ts` is the only place with wording. |
| Expression | `src/expression/` | `expressBehaviour()` → `ExpressionState`: avatar look (eyes/mouth/foliage/gaze/gesture/filter/effects), sway speed, leaf droop, atmosphere (scene per condition, season, day/night theme), message + tip, and the three Living Art layers (epidermal / wording / diffraction). |
| Server | `server/` | `index.ts` (Express, modes production / local-dev, serves `dist/`), `cors.ts` (local-network CORS), `collector/` (the living loop, one job per file: `index.ts` the loop and `LivingCollector`, `settings.ts` settings + calibration storage, `watering.ts` sensor-detected waterings, `careEvents.ts`, `interactions.ts`, `metaStore.ts` the typed `meta` keys, `records.ts` row conversions), `calibration.ts` (guided calibration), `database.ts` (`AppDatabase`: all the SQL, over a `SqlDriver` with `exec`/`all`/`close`; no Node imports, so it can run on a Durable Object's own SQLite; writes use `RETURNING`, no transactions, no PRAGMA but `table_info`) + `nodeSqlite.ts` (`openDatabase(path)`: the node:sqlite driver, WAL, statement cache) + `schema.ts`, `episodes.ts`, `routes/*`. |
| UI | `src/App.tsx`, `src/pages/`, `src/components/`, `src/hooks/` | Show what the server concluded. `useLivingState` listens to `/api/stream` (the server pushes the state when it changes) only while the page is visible; if the stream never delivers (e.g. an older server answers 404), it falls back to polling `/api/current` every 5 s with the last `ETag` (`If-None-Match`; unchanged → 304, nothing re-renders); `usePlantHealth`/`usePlantBehaviour` apply developer previews. |

### The living loop (`server/collector/`)

Each poll (ESP32 every `telemetryIntervalMs`, 60 s by default and changeable in Settings; every 15 min in `weather_estimate` mode) does the following:
1. Fetch with `telemetryManager` (injectable, with the clock, via `CollectorOptions` for tests). On failure it never invents a reading.
   - **Push mode** (`esp32Transport: 'push'`, Settings → "The ESP32 sends its readings"): nothing is fetched. `POST /api/ingest` (`server/ingest.ts`: device token, protocol v1 in `docs/HOSTING.md`) hands the readings to `collector.ingest()`, which runs steps 2–4 for each one exactly as a poll (`accept()` is shared). The timer only calls `watchPush()`: a push overdue by 1.5 intervals is a failed poll. Buffered readings older than the last evaluation fill the history without being re-evaluated. `pushReply()` tells the device its interval (3 s while a calibration captures; `readRaw()` then waits for the next push and those captures aren't stored). A server not in push mode answers 409.
2. Insert the raw observation into `telemetry`, including the device JSON in `raw_json`.
3. Detect watering with `src/perception/wateringDetector.ts` (pure state machine, numbers in `appConfig.watering`):
   - A rise of `minRisePct` above the recent baseline (lowest reading in `riseWindowMs`, in one jump or accumulated) must be **confirmed** by the next reading.
   - Spikes, a probe pulled out (baseline ≈ 0%, or a sudden ≥ `probeDropPct` fall), and anything during a calibration pause are rejected.
   - More rises within `cooldownMs` extend the same watering session.
   - The event stores its evidence: before/after %, raw before/after, accumulated rise, rising/confirmation readings, method.
   - It merges with a manual watering within `manualMergeMinutes`.
   - Calibration changes (and `POST /api/collector/calibration`) pause detection.
4. Run perception → health (with `HealthMemory`) → `trackEpisode` → behaviour → expression, and keep the result for `/api/current`.

After every evaluation, `HealthMemory` (latches, vitality, recovery, uncertainty) is saved in `meta` (`health_memory`), with the **runtime** (`collector_runtime`: status counters, the last evaluation's time, the last two readings as they arrived, the watering detector including a rise waiting for confirmation, the timers' due times, the day's sloth memory) and the last evaluated state (`collector_state`, without the 24 h of samples). On startup they are restored with the last 24 h of readings (from `telemetry`), so a restart carries on exactly: a resumed start in push mode evaluates nothing until the next push or timer (pull mode still reads the sensor at once), and the weather and hike fetches wait until they are due. This is what lets a Durable Object be unloaded between requests (scenario RS1: a collector restarted before every push is identical to one that never stops). The runtime is usable only for the same engine version, source and calibration; otherwise the detector is rebuilt from the recent readings. Only when no usable saved memory exists does `replay()` re-run 48 h of telemetry. Changing the source or location replays. **Timers:** one `setTimeout` at `nextWakeAt()` (the earliest due time of poll / weather / hike) calls `wake()`, which runs what is due; a Durable Object's alarm will do the same. Tests (`autoSchedule: false`) call the jobs themselves.

### Continuity and gap policy

- **Data uncertainty is an overlay first.** Without trustworthy data (stale, or a suspect soil sensor), the biological state is **held**:
  - latches are frozen and vitality is frozen (the gauge shows "Last known · Paused");
  - `sensor_uncertain` appears as a modifier (overlay);
  - the episode continues, and the time is added to `unobserved_ms`.
- It only becomes the **primary** state after `continuity.uncertainPrimaryAfterMin` (its own hysteresis), or straight away if nothing has ever been observed.
- **Observed time** advances only between consecutive real readings at the normal cadence. Repeated readings during an outage and longer gaps never count as stress, duration or recovery progress.
- **Short gap** (≤ 15 min or 2.5 polls): hysteresis timers keep running. **Medium gap** (≤ `history.episodeGapMs`, 6 h): state held, episode kept open, gap marked unobserved. **Long gap**: the episode closes at `last_seen_at`.
- An episode starts when its condition becomes primary (never back-dated). Episodes shorter than 1.5 polls are deleted as artifacts; A → blip → A is stitched back into one episode.

### Data quality (`telemetry/dataQuality.ts`)

The normalizer flags out-of-range values **before** clamping and honours `hts221_connected: false`.

Data quality also catches, over recent continuous samples:
- a soil raw value frozen for 2 h;
- converted soil pinned at exactly 0/100% for 3 h;
- the LDR at 0 in daylight, or at 4095, for 1 h;
- ADC rails, stale data, impossible jumps, short history (medium confidence).

Suspicious sensors are reported in `quality.suspect`. Health leaves them out (no latches, no score), so a stuck or pinned probe becomes uncertainty, never plant stress.

### Health engine details

- **Hysteresis** (`src/health/hysteresis.ts`): every condition is a latch with separate enter and exit thresholds and durations (e.g. thirsty: enter < 35 % for 30 min, exit ≥ 40 % for 5 min). It works as a Schmitt trigger: a pending switch is only cancelled when the value goes back past the *other* threshold, so noise around a threshold neither flaps nor blocks the state. A data gap restarts pending timers. A rule may carry a `night` variant used while the sun is down (`stepLatch({ night })`): `high_humidity` at night is ≥ 88 % for 3 h, exit ≤ 84 % (a greenhouse night is humid); an active latch carries over at dusk without flapping. After such a night the morning line is `morning_dewy`.
- **Light is relative to the sun.** Light latches only run while the sun is above `lightExpectedAboveSunDeg`. At night `night_rest` gives `sleeping` (a lamp wakes the tree), and light health is neutral, not penalized.
- **Recovery**: when a stress latch ends, `recovering` holds until healthy conditions have lasted `recovery.hoursBySeverity`. **Thriving** is its own latch: no stress, no recovery, vitality ≥ 90 for 2 h. So the path is very dry → recovering → comfortable → thriving.
- **Vitality** (`vitality.ts`) is accumulated wellbeing, not an average of sensor %. Its steps are: health scores per aspect (moisture, temperature, humidity, light averaged over daylight, stability from swings) → weighted base → duration penalties for active stresses (×1.25 per extra stress, +5 for hot & dry) → fading recovery dip → exponential smoothing toward the target (decline τ 2 h, rise τ 4 h, ≤15 min per step) → frozen when there is no fresh data. Condition and vitality are independent: a healthy tree can be `thirsty` at 84.
- `statePriority.ts`: priority picks the primary condition and the rest become modifiers. Combined conditions (`hot_and_dry`, `multiple_stress`) are never modifiers and hide their parts. Severity drives intensity, episodes and recovery length.

### Behaviour, speech and expression

- **Behaviour** (`BehaviourEngine.ts`) works only with structured values: intents, tiers, observation ids, day lines. Wording never drives logic (a test rewrites every sentence and checks behaviour is identical).
  - **Intensity tier** comes from severity and *observed* duration (mild → moderate → strong).
  - **Recovery stage** is relief → perking → settling, from recovery progress.
  - **Afterglow:** comfortable but a stress ended < 2 h ago, so energy is still subdued.
  - **Energy** combines vitality, time of day, stress intensity and recovery.
  - **Mood** is its own slow layer (`behaviour/mood.ts`, `APP_CONFIG.mood`): valence + arousal with inertia (persisted in `meta.mood_memory`). Health anchors it: condition × tier × recovery × reaction × concern gives the point, and severity a valence ceiling (a stressed tree is never happy). The inside environment, petting (fading, saturating), care, the visitors' company and (for a calm tree) the outside weather nudge it inside that band. Event moods (confused, sleepy, care reactions) are forced; other labels have hysteresis. `behaviour.mood` is the label, `behaviour.moodState` the layer. Nothing reads mood back except the face, tap label and body text. Tests MO1–MO7.
  - **Responsiveness** sets how strongly touch and care register.
  - **Petting is attention, not care** (see `docs/LIVING_ART.md`, "Touch and attention"). `expression.touch` (`TouchResponse`) decides how a stroke registers per state, and `usePetting` only animates it. Sessions go to the `interactions` table and only feed `relationship.attention`; they never change health or behaviour state. `attention.familiarity` (from distinct days with petting, fading to neutral) warms only the calm touch answers; habituation within a session (`expression/touch.ts`, rates in `touch.habituation`) lets continuous stroking settle and recover after a rest.
- **Habitat / visitors** (`habitat.ts`, `APP_CONFIG.habitat`; see `docs/LIVING_ART.md`, "Visitors and habitat"): a slow value replayed from the last 14 days of episodes (calm raises it over days, stress lowers it within hours, sleeping/recovering/uncertain hold it) with an enter/exit latch. While welcoming, the squirrel visits in deterministic day slots: `visiting` when calm, `hiding` during a passing stress, gone when critical, at night or without trustworthy data. `expression.visitor` → `avatar/Visitor.tsx`. Petting while it visits is play (`useVisitorPlay`, UI only, never stored): it hops between perches (branches, crown, trunk, pot rim), sometimes hides for `play.returnMs` (10 s). How it plays is `visitor.play` from `visitorPlay()` (thriving playful, comfortable gentle, hiding shy = only ducks), and its tail wags at the tree's sway tempo/amplitude (`--wag-tempo`, `--wag-amp`). Continuous stroking settles it via `habituate()`. Also derived, never stored:
  - **Individuals** (see `docs/LIVING_ART.md`, "Individuals, not dice rolls"). Each visitor remembers in its own way; all derived, never stored:
    - **Squirrel:** trust (`APP_CONFIG.habitat.trust`) gives the stages traces → peeking → visiting → settled (`habitat.memory`, `habitat.traces` → `expression.squirrelTraces`, visitor mode `peek`). Broken trust (the latch flips off) means a wary, slower return.
    - **Squirrel habits** (`squirrelLife()`, `APP_CONFIG.habitat.habits`) come from its habit-free past visits: a usual hour and a favourite spot. Boldness (trust + petting during visits) only changes how it plays.
    - **Sloth loyalty:** `slothMemory()`/`withLoyalty()` gives a home branch, longer visits and slower leaving. The collector derives it once a day from the last 14 days of readings and passes it as `evaluateBehaviour({ wanderers: { sloth } })`.
    - **Dragonfly:** only a territory for the day (`territoryOf(dayKey)`).
    - Previews: `#visitor=peek`, `#visitor=traces` / `traces:tail`.
  - **Drey:** a second slow value in `replayHabitat` (30 days of episodes; `APP_CONFIG.habitat.drey`) builds a nest in the crown over ~12 welcoming days, and the squirrel sleeps in it at night (`presence: 'sleeping'`; `<Drey>` in the crown pad).
  - **Shelter:** rain, storm or snow outside makes a visiting squirrel hide; after rain it shakes off.
  - **Care answers:** a needed watering → drinking at the pot rim; a pruning → inspecting the cut.
  - **Diary:** `habitatDiary()` adds visits, comebacks, staying away and the drey to `/api/history/diary`.
  - **The dragonfly** (`behaviour/dragonfly.ts` → `habitat.dragonfly` → `expression.dragonfly` → `avatar/Dragonfly.tsx`): the same habitat helpers (`driftToward`, `schmitt`, `slotWindow` in `habitat.ts`) over `perception.recent` + `perception.outsideToday`. Warm, bright, calm air builds its latch in ~45 min and drains it in ~15. The health state only gates it. It visits often (15-min slots) and flies around by rules (`dragonflyRoute()`, `habitat.dragonfly.route`: sits 25–70 s, sorties, other tips with a crown-tip bias, mostly back to its home tip; never by the squirrel; the sloth as home when it rests there), played on the clock by `useDragonflyFlight` in `Dragonfly.tsx`; it darts off at a stroke and returns to where it was, has a "dragonfly_came" thought, and diary lines from stored readings. Preview `#dragonfly=perched:crown_tip` / `#dragonfly=hovering`.
  - **Air wanderers** (`behaviour/wanderer.ts`): one engine for visitors driven by the last hours of air (replay → latch → slots → gate → diary); a species only brings an `AirWandererSpec`. The dragonfly and the sloth are specs.
  - **The sloth** (`behaviour/sloth.ts` → `habitat.sloth` → `expression.sloth` → `avatar/Sloth.tsx`, numbers in `APP_CONFIG.habitat.sloth`): warm (≥ 22 °C), humid (≥ 55 %) and still air; rain is fine. Slow latch (~90 min in, ~60 min out), long frequent visits (60-min slots, 20–50 min). It sleeps the night through on one branch, and the cold, critical stress or uncertain data gate it. A stroke gets a slow look and blink. Its grip comes from its comfort (`slothGrip()`, `habitat.sloth.grip`): all four on arrival, then per ~12-min stretch four/arms (marginal), arms/two legs + one arm (comfortable), one arm/legs (long perfect air); climbing and asleep are always all four. "sloth_came" thought, diary lines. Preview `#sloth=hanging:left_branch:one_arm` / `climbing` / `sleeping`.
  - **Encounters** (`behaviour/encounters.ts`, `meet()` → `habitat.encounters` → `expression.encounters` + `encounterCues()`): when visitors coincide, the squirrel never shares the sloth's branch and they look at each other; the dragonfly never rests by the squirrel, which watches it; a perched dragonfly rests on the sloth about half the time (`perch: 'on_sloth'`, drawn as the sloth's rider; the sloth blinks slowly). A "visitors_met" thought while it happens, and `encounterDiary()` lines from overlapping visit windows. Previews meet by the same rules (`usePlantBehaviour`). Tests EN1–EN7.
  - Art only: computed before mood (the visitors' company lifts it a little); nothing else reads it.
- **Speech** (`speech.ts`, memory persisted in `meta.message_memory`):
  - It speaks on a new episode, new care, a stronger tier, or a critical state; a minor change waits a 10-minute cooldown.
  - A line stays visible for a while (quiet states 10 min, up to 60 min for critical), then the tree is "quiet" (no new line; Home still shows its current thought). The speech policy still decides when something new is said.
  - Only strong or critical states are repeated, with the next variant.
  - Observations are said once per episode; morning and evening lines once per day.
  - The variant is `stableVariant(episode | key)`, so it never reshuffles on refresh.
- **Canopy (the last weeks)** (`behaviour/canopy.ts`, numbers in `ficus.ts` `canopy`, evidence class *inference*): replayed from 30 days of episodes and care events.
  - Sustained stress past a grace period thins it; a move dips it; calm time refills it at the pace of the growth phase. Floor 0.6.
  - → `behaviour.canopy` → `avatar.canopy {fullness, refilling}` → `PadLeaves` (missing rim leaves, fresh tips) and `PadBranchlets` (more branches showing between the leaves).
  - Drawn only; nothing reads it. Preview `#canopy=0.7|refilling`.
- **Thoughts of the day** (`behaviour/voice.ts` → `behaviour.voice`; spoken by `speech.ts`; wording `MUSING_LINES`/`MUSING_TIPS` in `messages.ts`):
  - On a calm, awake day the tree shares a few thoughts, each grounded in today's data: soil steady with a thirst estimate from the trend, days since the last drink, brightest hour, good light day, days shorter/longer, a humid morning (glass may fog), warmest hour, warmer than outside, the squirrel came by, new tips, the drey.
  - The daily budget follows energy: `1 + 5 × vitality share × growth phase` (thriving summer ≈ 6, calm autumn ≈ 3, winter rest ≈ 2).
  - Spaced over the daylight (`gapMs`, ≥ 60 min). Each at most once a day (`message_memory.musingsSaid`). On screen 15 min.
  - Never over a stress, a care reaction, a concern or the night (budget 0). Tests T1–T5.
- **Derived environmental metrics** (`perception/environment.ts` calculates, `health/environment.ts` interprets; thresholds in `ficus.ts` `environment`, provisional; see `docs/LIVING_ART.md`):
  - **Soil dry-down** `trends.soilDryDown` (`trends.soilPerHour` = its slope): an OLS slope over one uninterrupted segment, bounded by waterings (+45 min settle), soil calibration changes / the detection pause (`soilBreaks` from the collector), reading gaps and a suspect sensor. Confidence from span and standard error; the voice predicts only at medium/high.
  - **Moisture–VPD coupling** `perception.drying`. Diagnostic only: `health.environment.coupling` against a ~7-day baseline in the optional `HealthMemory.environment` (no version bump), shown in the Health Debug panel and the soil card notes, never in vitality, mood or expression.
  - **Temperature exposure** `perception.exposure.temperature`: decayed degree-hours outside the optimal range (24 h, τ 6 h). It lowers the existing temperature component (min of now and recent) and recovers gradually.
  - VPD and prolonged wetness are unchanged.
- **Season** never changes health or thresholds (yet): `species.seasons[id].waterNeed` is informational, so it can't affect hysteresis. It is in all three Living Art layers:
  - *Gradual, never a cliff:* within 14 days of a boundary the neighbouring season is blended in (0.5 at the boundary). Behaviour's `season.energy` is the blended factor; `season.cycle` (newGrowth / yellowing / leafDrop, 0-1) comes from the species' yearly curves. Expression mixes the neighbouring foliage tone (`foliageBlend`) and passes `seasonalLeaves`, so leaves turn fresh, yellow and fall by amount.
  - *Epidermal:* the body description names the season, growth phase, an approaching season and its visible signs.
  - *Wording:* a `season_<id>` day line once per season (speech stamps it with `season.key`, not the date), a seasonal care tip on calm intents, and a seasonal line on care reactions.
  - *Diffraction:* `CareReaction.seasonal` (`SeasonalCare`) changes what the same care means: watering during winter rest (drinks slowly, smaller lift), relief in summer, wet soil while growth is slow, pruning/feeding/repotting in or out of the growing season. Off-season feeding or pruning makes the tree `patient` with no sparkles; pruning while growing brings new shoots.
  - Calm states (comfortable, thriving, sleeping) wear the season: spring tender foliage + new leaves, glossy summer, autumn yellowing/falling leaves, deep winter green. Ficus is evergreen, so no autumn colour.
- **Every condition has its own look** (a scenario check keeps them distinct): `LOOKS` in `ExpressionEngine.ts` sets eyes, mouth, foliage tone, gaze mode, a recurring gesture (sigh, shiver burst, fan, shake off, stretch toward light, nod off…), a whole-tree SVG filter (heat shimmer, frost, washed out, glare, gloom), a body animation class and details (falling leaves, drips, icicles, breath vapour, cracks, fireflies, leaf visor…). Mood shapes the whole face only in calm states; in stresses only the eyes.
- **Scenes:** `atmosphere.scene` (`SCENE` map) makes the whole Home screen take on the state, the way night does: `calm` (tinted by season), `golden`, `parched`, `drought`, `scorching`, `sodden`, `chill`, `frozen`, `dim` (daytime gloom, lanterns), `night`, `glare`, `windy`, `fog`, `renewal`, `storm`, `static`. `night` and `dim` are dark (`theme: 'night'`). A sleeping modifier makes it night; a relieving watering shows `renewal`.
- **Expression** (`ExpressionEngine.ts`) outputs everything the UI draws: the face (condition look, then a subtle mood face for mood-led states), continuous `leafDroop` (-0.2 lifted … 1 wilting, rendered on wrapper groups so it doesn't fight the sway animation), `motion` from energy (sway speed and amount, flutter and blink rate through CSS variables `--sway-speed`, `--sway-amp`, `--flutter-amp`), `reactionStrength`, gauge label/tone, tap label and message. `BonsaiAvatar` and `VitalityGauge` contain no thresholds. The avatar adds life on its own: idle eye saccades around the gaze mode, eyes following the pointer when the tree is responsive, irregular gestures and double blinks, individual leaves (`avatar/Foliage.tsx`: palettes per foliage tone, leaves that droop/curl/frost/yellow one by one).

### Behaviour details

- `watchful` covers a comfortable tree with a reading that's out of range but hasn't lasted long enough to be a condition ("I'm okay for now, but my soil feels very wet").
- **Care reactions** (`careReaction`) look at the latest care event within 20 min (watering) or 60 min (other care), and at the history before it. A watering while dry gives *relief* ("refreshing"). A watering while the soil was already wet or waterlogged gives *watering_enough*, never a celebration. A watering while recovering gives a gentle acknowledgement, and while comfortable a plain thanks.
- **Relationship memory** is derived from episodes and events, not stored. It covers thirst episodes and how soon water followed, waterings today, waterings on wet soil, and typical recovery time. It yields at most one gentle observation (by id), never judgmental.

### Developer previews

`DEV_PRESETS` (`health/developerOverrides.ts`) cover all 17 conditions plus combinations. A preview overrides only the displayed health. A squirrel preview (Developer panel, or `#visitor=visiting:crown` / `hiding` / `drinking` / `inspecting` / `shaking` / `sleeping`, and `#drey=started|built`) puts a visitor or a drey in the tree. A season preview (Developer panel, or `#season=winter`) swaps only the perceived season, computed as the middle day of that season at the tree's latitude (`midSeasonState`). `usePlantBehaviour` re-runs behaviour and expression in the browser with no history or events. Nothing is sent to the server: telemetry, the DB, events and episodes stay real. The Developer panel (wrench icon, or `#developer` in the URL) holds the state tester, the Health Debug panel (the live vitality calculation and latches) and the Behaviour Debug panel. The state tester (`developer/StateTester.tsx`) is grouped into collapsible sections:
- **Tree health:** presets sorted into Calm / Water / Air & heat / Light / Combined / Data; an unlisted preset lands in Other.
- **Time & season:** Season, Sun.
- **Outside:** Weather.
- **Hike:** Picked, Moved, Hike day.
- **The tree over time:** Canopy.
- **Visitors:** Squirrel and its drey, Dragonfly, Sloth.

A dot marks a group with a preview on, and **Reset all previews** clears every preview at once.

### Telemetry rules (unchanged)

- `soilMoisture` is the firmware's `soil_moisture` exactly as sent, unless `useAppSoilCalibration` is on (then `soil_raw` is converted with `soilRawDry`/`soilRawWet`).
- Light is `light_percent`, a relative LDR %. **Never lux**; `light_lux` is null.
- A missing measurement stays `null`.
- In ESP32 mode nothing fake, cached or weather-based ever stands in for the sensor. Weather as a *data source* is used only in `auto` mode, as a fallback.
- **Outside weather is separate, and context only.** The tree is in a greenhouse: the ESP32 measures inside. `src/telemetry/outsideWeather.ts` fetches Open-Meteo `current` (`OutsideSky` vocabulary from the WMO code, `windy` from gusts) on the collector's own 15-min timer (`pollWeather()`, injectable as `CollectorOptions.fetchOutsideWeather`; the bench fakes it via `Bench.weather`) in every data-source mode. Rows go to `outside_weather`; `perception.outside` is the latest observation, or null once older than 1 h (a failed fetch never invents one). Health and the habitat never read it directly (scenario O1); a calm tree's mood takes a small nudge from it (`behaviour/mood.ts`). The one interpretive effect: **a grey sky explains dim light**. `perceive({ outsideToday })` → `computeDailyLight` scales the useful/low LDR thresholds per reading by `species.light.skyFactor[skyAt(t)]`, so overcast-day dimness isn't `too_dark` and the light card says "Grey day". A clear sky or no weather changes nothing (scenarios D3–D6); the collector passes today's stored observations, replays included. It shows as `expression.atmosphere.weather` (`WeatherLook`) → a separate weather layer in `SceneBackdrop` behind the tree, plus `WeatherForeground` over the avatar on Home (fog drifting across the plant, rain falling past it, `pointer-events: none`). The tree art never changes for it. Also the **Outside panel** on Home above the vitality row (`components/scene/OutsidePanel.tsx`: sky, temperature and humidity outside next to the sensors' inside values (only with the ESP32 as source), wind or rain; with the ESP32 also `perception.air`: dew points outside/inside, how much more water the inside air holds, and "glass may fog" when the inside dew point reaches the outside temperature (`dewPoint`/`absoluteHumidity` in `telemetryNormalizer.ts`; scenarios H1–H4); facts only, a muted line when there's no fresh weather); as once-a-day `weather_*` day lines when the tree is calm (a fresh one counts as news for the speech policy); and as diary spells (`weatherSpells`, rain/storm/snow/fog/frost). Preview: Developer → Outside, or `#weather=rain|fog|thunderstorm|snow|overcast|heavy_rain|windy`.
- Settings → Test Link still fetches the ESP32 directly from the browser (Private Network Access headers, iframe detection). "Test from server" checks it from the collector's side.
- **The weekly hike** (see `docs/LIVING_ART.md`, "The weekly hike"): about the people, never the tree. The collector fetches Open-Meteo's 14-day daily forecast (with sunrise/sunset and the hourly forecast per day) every 3 h (`telemetry/hikeForecast.ts`, `pollHikeForecast()`, injectable as `CollectorOptions.fetchHikeForecast`; the bench's `hikeDays` is empty by default, so the golden master has no hike) and keeps it with the picks in `meta.hike_memory`. `planHike()` (`behaviour/hike.ts`, numbers in `APP_CONFIG.hike`) picks the best-scoring remaining day of the Monday–Sunday week; it follows the forecast until its day arrives, then locks; after it, next week's pick shows. It offers two days (`plan.options`: its pick + the next best); tapping one of the chips in its diary bubble chooses it (`POST /api/hike/choose {day}` → `chooseHikeDay()`, `WeekPick.chosen`), and a chosen day holds whatever the forecast does (during a hike preview the click only sets `previews.hikeChoice`). → `evaluateBehaviour({ hike })` → `behaviour.hike` (absent without a forecast) and the day lines `hike_picked` / `hike_moved` / `hike_chosen` / `hike_today` (lowest priority, calm and by day; speech stamps a pick with `week:day`, so a moved pick is said again) The plan's `detail` (`hikeWindow()`, numbers in `APP_CONFIG.hike.window`) is the day's best hours: the best-scoring stretch of daylight from the hourly forecast, plus rain-later / heat / gusts / UV and sunset; the plan carries only that, never the 24 hours. → `expression.hike {boots, plan}` → the hike bubble in `scene/TreeDiary.tsx`, and `avatar/HikingBoots.tsx` (two pairs and their two water bottles, together right of the stand) on the day. **TreeDiary** (Home, over the top-left of the scene, collapsible, folded state in localStorage `appbonsai_tree_diary_open_v1`): quiet chat bubbles, the hike pinned on top in the tree's voice (`hikeSays()` + `hikeAdvice()` in `messages.ts`, the two days as chips with 🌱 on its own pick), then the latest 3 lines of today's diary (`/api/history/diary?days=1`, every 10 min) in a narrow column left of the crown. The choice and hike-day lines add "Best from 7:00 to 11:00." (`hikeWindowShort`). Preview: Developer → Hike (Picked / Moved / Hike day; the real planner on a sample forecast), or `#hike=announced|moved|today`. Tests HK1–HK12.

### ESP32 firmware

`firmware/appbonsai_esp32/appbonsai_esp32.ino` is the sketch running on the device: FC-28 soil probe on GPIO34, LDR on GPIO35, HTS221 over I²C (SDA 21, SCL 22). It serves `GET /api/telemetry` (now with `device_id`, the chip's MAC in hex) and `http://bonsai.local` over mDNS. If no Wi-Fi credentials are saved, it opens a setup access point called `Appbonsai-Setup`. Firmware 1.1.0 can also **push** (protocol v1): with a server address and device token saved (`/settings`, or the setup page) it measures every `interval_s` from the server's reply, keeps up to 360 unsent readings in RAM, and sends them oldest first, at most 60 per request. HTTPS accepts any certificate for now (TODO before the cloud step: pin the root CA). Firmware 1.2.0 adds **wireless updates**: `POST /update` with the compiled `.bin` as the multipart field `firmware` and `Authorization: Bearer <device token>` (the same token as the pushes; no token saved = no updates); it restarts into the new firmware (the default partition scheme has the two OTA slots; the sketch is at 87 % of one). Build to a folder with `--output-dir <dir>` and send `<dir>/appbonsai_esp32.ino.bin` with curl (see `docs/HOSTING.md`). A wireless update loses the unsent readings in RAM, like any restart. It builds with the Arduino IDE's bundled `arduino-cli` (ESP32 core 3.3.12): `arduino-cli compile --fqbn esp32:esp32:esp32 firmware/appbonsai_esp32`; a struct used in function signatures must be declared before the first function (the Arduino build inserts its prototypes there). **Don't change it when the task is frontend or server only.**

### Persistence

**SQLite** (`data/appbonsai.db`, gitignored with its WAL files). All times are INTEGER ms since epoch.
- `telemetry`: raw observations (the permanent truth, re-evaluable), unique on (source, timestamp).
- `plant_events`: watering, pruning, fertilizing, repotting, moved_location, manual_note, with `metadata_json` (waterings: source sensor/manual, moistureBefore/After, conditionBefore).
- `behaviour_episodes`: opened when the primary condition changes and closed on transition (or at `last_seen_at` after a long gap), with `unobserved_ms`, `modifiers_json` (union seen, never `sensor_uncertain`), `peak_severity` and `engine_version`.
- `outside_weather`: outside observations every 15 min (sky, WMO code, temp, humidity, precipitation, cloud, wind, gusts, raw JSON). Context only, never read by perception's health inputs.
- `interactions`: attention sessions with the digital tree (V1: `kind = 'pet'`; free-text kind, validated by the API). Never care, never read by perception or health.
- `trees`: the one tree this database belongs to (`tree_<uuid>`, made with the database; later one Durable Object per tree, so the other tables carry no tree id). Its name, species and location are its settings.
- `devices`: ESP32s allowed to push: id, `tree_id` (the tree it measures; only this tree's devices may push, so a replaced device keeps the tree's history), SHA-256 of the token, label, last push, firmware, `boot` + `last_seq` (retries are dropped).
- `meta`: schema version, collector settings (`collector_settings`), saved health memory (`health_memory`), speech memory (`message_memory`), watering-detection pause (`watering_detection_suppressed_until`), the daily forecast and hike picks (`hike_memory`).
- Migrations: `server/schema.ts` `MIGRATIONS`, applied on open. Steps with a column check always verify the actual table shape.

**localStorage** (UI only):
- `appbonsai_settings_v1`: the browser copy of settings. It syncs with the server: on load, the server copy wins if it has one, and every save is PUT to `/api/config`.
- `appbonsai_sensor_debug_v1`: whether the live strip is visible.
- `appbonsai_tree_diary_open_v1`: whether the diary bubbles on Home are folded.
- The old `appbonsai_plant_history_v1` and `appbonsai_watering_history_v1` are imported into SQLite once (`legacyBrowserHistory.ts`, flag `appbonsai_sqlite_import_v1`) and then left untouched.

### API (port 3001; on the Pi http://ender3.local:3001)

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Server, collector and database status |
| `GET /api/current` | Everything the UI needs in one call: perception (without `recent` and `outsideToday`, which stay on the server), health, behaviour, expression, forecast, live readings, recent events and episodes. `ETag` = hash of all but `serverTime`; `If-None-Match` → 304 (CORS allows the header and exposes `ETag`) |
| `GET /api/stream` | The same state as Server-Sent Events (`event: state`, `id` = the ETag): on connect, after every collector evaluation (`collector.onChange`) when it differs, and from a check every `polling.streamCheckMs` (15 s; status counters change without an evaluation, else a `: ping`). Each write is flushed through `compression` |
| `GET /api/health`, `GET /api/behaviour` | Subsets of the current state |
| `POST /api/refresh` | Read the sensor now (push mode: re-evaluate; the device sends on its own interval) |
| `POST /api/ingest` | Readings pushed by the ESP32 (`Authorization: Bearer <device token>`, protocol v1 in `docs/HOSTING.md`) |
| `POST /api/calibration/light {darkRaw, brightRaw, manual?, dryRun?, confirm?}` | Light calibration; `manual: true` = min/max raw typed in Settings (stored as method `manual`, with history), same checks as the guided capture |
| `POST /api/calibration/soil {dryRaw, wetRaw, manual?, dryRun?, confirm?}` | Soil calibration; `manual: true` = dry (high raw → 0 %) / wet (low raw → 100 %) typed in Settings, same checks as the guided capture; pauses watering detection like any soil calibration change |
| `POST /api/collector/calibration {minutes}` | Pause watering detection while handling the probe (`0` resumes) |
| `GET`/`PUT /api/config` | Collector settings |
| `POST /api/hike/choose {day}` | Choose the week's hike day (one of the tree's two; 400 when the day can't be chosen) |
| `GET /api/events?days=`, `POST /api/events {type, note?, timestamp?}`, `DELETE /api/events/:id` | Care events |
| `GET /api/interactions?days=&kind=`, `POST /api/interactions {kind, startedAt, endedAt, count, activeMs}` | Attention sessions (petting); one POST per session, merged within 2 min |
| `GET /api/history?hours=`, `/hourly`, `/daily?days=`, `/diary?days=`, `/episodes?days=`, `/weather?hours=` | History, the plant diary, outside weather observations |
| `GET /api/telemetry/latest`, `POST /api/telemetry/test {url}`, `POST /api/telemetry/import-browser` | Raw readings, server-side link test, one-time import of browser history |

### UI

- Desktop single-screen layout (`h-screen`, no page scroll). The header has status, refresh (asks the server to read now), the live-sensor strip, Diary, Developer and Settings. Panels open in a side drawer, and `#history`, `#settings` or `#developer` in the URL opens one directly. The panels and the details modal are `React.lazy` chunks (`App.tsx`), loaded when first opened. Developer previews live in one object from `hooks/useDevPreviews.ts` (hash parsing, toasts, the preview line); any combination can start from the URL, e.g. `#preview=very_dry&season=winter&visitor=hiding:crown`.
- `pages/Home.tsx`: the avatar on the left; the Outside panel (weather outside vs the sensors inside), the gauge, the expression's message and tip, and the 2×2 `SensorCardGrid` on the right. Clicking a sensor card (or a column of the live strip) opens a popup with its best conditions and ranges (`SensorGuide`); the content is `MetricAssessment.guide`, built from the species profile in `health/metricGuides.ts`. The gauge opens Tree Diagnostics. `DetailView` is the modal with per-metric bars and charts. The charts use stored hourly averages for the sensor and the forecast for weather.
- `pages/History.tsx`: the plant diary (episodes + care events as narrative lines from `history/diary.ts`), a care log, and a compact 7-day strip.
- `BonsaiAvatar` takes an `ExpressionState`. A tap keeps the perk-up + mood label; moving the mouse over the foliage, a grab-and-drag, or a touch drag is petting (`components/avatar/usePetting.ts`: spring + rustle per pad, hand glow and open-hand cursor that are the same in every state, `touch-action: pan-y`, reduced motion = glow + blink only), reported via `onPetSession` → `App.tsx` (skipped during previews). The visual vocabulary types live in `expression/expressionTypes.ts`; `components/avatar/avatarStates.ts` only holds the posture transforms.
- **Sunrise / sunset at their real times:** the outside weather fetch also takes Open-Meteo's published `daily=sunrise,sunset` (stored on `outside_weather`, migration v6). `perception.sun.sunrise/sunset` uses them when they're today's, else `sunTimes()` in `perception/sun.ts` (−0.833° horizon, within ~1 min; scenarios R1–R3). Through the loop:
  - **Health** doesn't read the times; it already uses the sun's elevation and the LDR (TW5).
  - **Behaviour:** `twilight` (minutes from the nearest event, −45…+40), `timeOfDay` from the real times (morning until sunrise+3 h, evening from sunset−2 h), energy ×1.06 after sunrise / ×0.9 before sunset, and once-a-day `sunrise_greeting` / `sunset_line` day lines (news for the speech policy).
  - **Expression:** a calm, awake tree stretches toward the east (`gaze: 'east'`) at sunrise and yawns toward the west at sunset; stress and care looks win. `atmosphere.twilight {event, minutes, at, muted}`, with `muted` from a cloudy/foggy/rainy outside sky.
  - **`TwilightSky`** draws it (the glow builds before, the disk crosses the horizon at the minute, clipped there, then fades) and only advances the minutes with the clock between polls.
  - Preview: Developer → Test Tree State → **Sun** (jump to −20 / 0 / +15 around sunrise, −15 / 0 / +20 around sunset, or ▶ play the whole twilight in ~20 s, which keeps running when the panel closes), or `#twilight=sunrise-10` / `#twilight=sunset+5`. It shifts the perceived times, so behaviour and expression respond too (TW1–TW6).
- Scenes: the app root gets `scene-<id>` (theme tokens, `src/styles/scenes.css`) and `SceneBackdrop` (`components/scene/`) paints the scene with ambient particles, cross-fading on change. Dark scenes also get `night`. Drawers and the modal stay light (`day` class). The header shows the season (`SeasonChip`: season, stage, day length ↑/↓).
- Avatar animations live in `src/styles/avatar.css` (body motions, gestures, leaf quiver, details); everything respects `prefers-reduced-motion`.
- `components/ErrorScreen.tsx` wraps `<App />` in `main.tsx`: an error while rendering shows the error (with a Reload, and Reload without previews when the URL has a hash) instead of a blank page. A common cause is the laptop's frontend being newer than the Pi's server; read new server fields tolerantly (e.g. `withHikeDefaults()` in `behaviour/hike.ts`).
- Styling uses Tailwind with theme tokens (`--ink`, `--paper`, …) in `src/index.css`, `lucide-react` icons, and CSS toasts (`components/Toast.tsx`, `.toast-in`/`.toast-out` in `index.css`).
- `App.tsx` has a `TEMP DEBUG` console.log that traces the soil value from the ESP32 to Home. Remove it once no longer needed.
