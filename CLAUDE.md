# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Appbonsai is a "digital living companion" for one real Ficus bonsai. An ESP32 on the balcony measures soil, air and light. A local Node server collects the readings into SQLite and runs the living loop:

```
physical bonsai → PERCEPTION → HEALTH → BEHAVIOUR → EXPRESSION → React UI → human care → physical bonsai
```

The project is local only: no cloud, no accounts. Data is only collected while the local server runs. It started from a Google AI Studio template (`README.md`, `metadata.json`, `.env.example`).

## Commands

- `npm install`: install dependencies (needs Node ≥ 22.5, which provides built-in `node:sqlite`; developed on Node 24)
- `npm run dev`: starts both with `concurrently`: Vite on **http://localhost:3000** (`dev:web`, bound to 0.0.0.0, `--strictPort`) and the local API + collector on **http://localhost:3001** (`dev:api`, `tsx watch server/index.ts`). Vite proxies `/api` to 3001 (`APPBONSAI_API_PORT` overrides the port for both).
- `npm test`: runs the three scenario suites (there is no test framework; these are the regression checks). `scripts/bench.ts` is the shared bench: the real `LivingCollector`, in-memory SQLite, a fake ESP32 and a simulated clock.
  - `npm run test:scenarios` (`scripts/scenarios.ts`): pure engine checks: dry→thirsty→very dry, recovery, night vs too dark, brief vs sustained heat, watering reactions, outage overlay, dev override, threshold hovering.
  - `npm run test:collector` (`scripts/collectorScenarios.ts`): watering detection (spikes, probe pulled, gradual, sessions, manual merge, saturation, calibration pause), sensor reality checks, outages, restarts, long gaps, DB migration.
  - `npm run test:behaviour` (`scripts/behaviourScenarios.ts`): talking vs silence, thirst escalation, relief, recovery stages, concern on wet soil, quiet nights, morning lines, once-per-episode lines across refresh/restart, variants, rewording safety, same condition with different history.
- **UI type-checking caveat:** `@types/react` is not installed, so `React.FC` is `any` and `.tsx` props aren't really type-checked. Check UI changes by hand (or install `@types/react`/`@types/react-dom` and fix what surfaces).
- `npm run db:inspect`: read-only summary of `data/appbonsai.db` (counts, latest readings, episodes, events). `APPBONSAI_DB` points it (and the server) at another file.
- `npm run lint`: type-check only (`tsc --noEmit`, covers `src/`, `server/`, `scripts/`). There is no ESLint.
- `npm run build`: frontend production build (the server runs from source with tsx).

For quick throwaway checks, a script run with `npx tsx` can call the pure engines directly. Testing the server against a scratch DB and port works well: `APPBONSAI_DB=<tmp>.db APPBONSAI_API_PORT=3011 npx tsx server/index.ts`.

## Template leftovers

- `@google/genai`, `dotenv` and `GEMINI_API_KEY` come from the AI Studio template and are unused. `express` **is** used now, by the local server.
- `vite.config.ts` reads `DISABLE_HMR`, which AI Studio sets to turn off HMR and file watching. Keep that logic.
- The `@/*` path alias points to the repo root, not `src/`. Existing code uses relative imports.

## Architecture

Each layer has one job. Keep them separate. Biological thresholds never go in React components, and the avatar never sees sensor values.

| Layer | Folder | Responsibility |
|---|---|---|
| Config | `src/config/appConfig.ts` | Ports, DB path, poll intervals, timeouts, data gap limits, watering-jump threshold, data-quality limits, engine version. No biology. |
| Species | `src/species/ficus.ts` (+ `types.ts`) | **Every tunable biological number in one place**: comfort ranges, relative light bands, hysteresis latch rules (enter/exit values and durations), vitality weights and time constants, stress penalties, recovery windows. Soil % and LDR light % are labelled **prototype/local calibration**. |
| Telemetry | `src/telemetry/` | Get and normalize measurements (`telemetryNormalizer.ts` is the only ESP32 JSON reader). `dataQuality.ts` covers stale/unavailable data, missing sensors, impossible jumps and insufficient history. |
| Perception | `src/perception/` | `perceive()` → `PerceptionState`: fresh readings (all null when stale), sun position/phase (`sun.ts`, from the tree's lat/lon), trends, recent 24 h samples, care events, data quality. |
| Health | `src/health/` | `evaluatePlantHealth({perception, species, memory})` → `{state, memory}`: the biological condition, modifiers, health scores, vitality with a full breakdown, hysteresis debug. It decides no wording or personality. |
| Behaviour | `src/behaviour/` | `evaluateBehaviour()`: mood, energy, responsiveness, intensity + tier, recovery stage, afterglow, time of day, message intent, care reactions (diffraction), relationship memory (`relationship.ts`). `speech.ts` decides when to speak or stay silent; `messages.ts` is the only place with wording. |
| Expression | `src/expression/` | `expressBehaviour()` → `ExpressionState`: avatar look (eyes/mouth/posture/effects), sway speed, leaf droop, day/night atmosphere, message + tip, and the three Living Art layers (epidermal / wording / diffraction). |
| Server | `server/` | `index.ts` (Express), `collector.ts` (the living loop), `database.ts` + `schema.ts` (node:sqlite), `episodes.ts`, `routes/*`. |
| UI | `src/App.tsx`, `src/pages/`, `src/components/`, `src/hooks/` | Show what the server concluded. `useLivingState` polls `/api/current` every 5 s; `usePlantHealth`/`usePlantBehaviour` apply developer previews. |

### The living loop (`server/collector.ts`)

Each poll (ESP32 every `telemetryIntervalMs`, 60 s by default and changeable in Settings; weather every 15 min) does the following:
1. Fetch with `telemetryManager` (injectable, with the clock, via `CollectorOptions` for tests). On failure it never invents a reading.
2. Insert the raw observation into `telemetry`, including the device JSON in `raw_json`.
3. Detect watering with `src/perception/wateringDetector.ts` (pure state machine, numbers in `appConfig.watering`):
   - A rise of `minRisePct` above the recent baseline (lowest reading in `riseWindowMs`, in one jump or accumulated) must be **confirmed** by the next reading.
   - Spikes, a probe pulled out (baseline ≈ 0%, or a sudden ≥ `probeDropPct` fall), and anything during a calibration pause are rejected.
   - More rises within `cooldownMs` extend the same watering session.
   - The event stores its evidence: before/after %, raw before/after, accumulated rise, rising/confirmation readings, method.
   - It merges with a manual watering within `manualMergeMinutes`.
   - Calibration changes (and `POST /api/collector/calibration`) pause detection.
4. Run perception → health (with `HealthMemory`) → `trackEpisode` → behaviour → expression, and keep the result for `/api/current`.

After every evaluation, `HealthMemory` (latches, vitality, recovery, uncertainty) is saved in `meta` (`health_memory`). On startup it is restored, along with the last 24 h of readings and the detector context. Only when no usable saved memory exists (other engine version or source) does `replay()` re-run 48 h of telemetry. Changing the source or location replays.

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

- **Hysteresis** (`src/health/hysteresis.ts`): every condition is a latch with separate enter and exit thresholds and durations (e.g. thirsty: enter < 35 % for 30 min, exit ≥ 40 % for 5 min). It works as a Schmitt trigger: a pending switch is only cancelled when the value goes back past the *other* threshold, so noise around a threshold neither flaps nor blocks the state. A data gap restarts pending timers.
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
  - **Mood** comes from condition × tier × recovery × reaction × concern.
  - **Responsiveness** sets how strongly touch and care register.
- **Speech** (`speech.ts`, memory persisted in `meta.message_memory`):
  - It speaks on a new episode, new care, a stronger tier, or a critical state; a minor change waits a 10-minute cooldown.
  - A line stays visible for a while (quiet states 10 min, up to 60 min for critical), then the tree is "quiet" (no new line; Home still shows its current thought). The speech policy still decides when something new is said.
  - Only strong or critical states are repeated, with the next variant.
  - Observations are said once per episode; morning and evening lines once per day.
  - The variant is `stableVariant(episode | key)`, so it never reshuffles on refresh.
- **Expression** (`ExpressionEngine.ts`) outputs everything the UI draws: the face (condition look, then a subtle mood face for mood-led states), continuous `leafDroop` (-0.2 lifted … 1 wilting, rendered on wrapper groups so it doesn't fight the sway animation), `motion` from energy (sway speed and amount, flutter and blink rate through CSS variables `--sway-speed`, `--sway-amp`, `--flutter-amp`), `reactionStrength`, gauge label/tone, tap label and message. `BonsaiAvatar` and `VitalityGauge` contain no thresholds.

### Behaviour details

- `watchful` covers a comfortable tree with a reading that's out of range but hasn't lasted long enough to be a condition ("I'm okay for now, but my soil feels very wet").
- **Care reactions** (`careReaction`) look at the latest care event within 20 min (watering) or 60 min (other care), and at the history before it. A watering while dry gives *relief* ("refreshing"). A watering while the soil was already wet or waterlogged gives *watering_enough*, never a celebration. A watering while recovering gives a gentle acknowledgement, and while comfortable a plain thanks.
- **Relationship memory** is derived from episodes and events, not stored. It covers thirst episodes and how soon water followed, waterings today, waterings on wet soil, and typical recovery time. It yields at most one gentle observation (by id), never judgmental.

### Developer previews

`DEV_PRESETS` (`health/developerOverrides.ts`) cover all 17 conditions plus combinations. A preview overrides only the displayed health. `usePlantBehaviour` re-runs behaviour and expression in the browser with no history or events. Nothing is sent to the server: telemetry, the DB, events and episodes stay real. The Developer panel (wrench icon, or `#developer` in the URL) holds the state tester, the Health Debug panel (the live vitality calculation and latches) and the Behaviour Debug panel.

### Telemetry rules (unchanged)

- `soilMoisture` is the firmware's `soil_moisture` exactly as sent, unless `useAppSoilCalibration` is on (then `soil_raw` is converted with `soilRawDry`/`soilRawWet`).
- Light is `light_percent`, a relative LDR %. **Never lux**; `light_lux` is null.
- A missing measurement stays `null`.
- In ESP32 mode nothing fake, cached or weather-based ever stands in for the sensor. Weather is used only in `auto` mode, as a fallback.
- Settings → Test Link still fetches the ESP32 directly from the browser (Private Network Access headers, iframe detection). "Test from server" checks it from the collector's side.

### ESP32 firmware

`firmware/appbonsai_esp32/appbonsai_esp32.ino` is the sketch running on the device: FC-28 soil probe on GPIO34, LDR on GPIO35, HTS221 over I²C (SDA 21, SCL 22). It serves `GET /api/telemetry` and `http://bonsai.local` over mDNS. If no Wi-Fi credentials are saved, it opens a setup access point called `Appbonsai-Setup`. **Don't change it when the task is frontend or server only.**

### Persistence

**SQLite** (`data/appbonsai.db`, gitignored with its WAL files). All times are INTEGER ms since epoch.
- `telemetry`: raw observations (the permanent truth, re-evaluable), unique on (source, timestamp).
- `plant_events`: watering, pruning, fertilizing, repotting, moved_location, manual_note, with `metadata_json` (waterings: source sensor/manual, moistureBefore/After, conditionBefore).
- `behaviour_episodes`: opened when the primary condition changes and closed on transition (or at `last_seen_at` after a long gap), with `unobserved_ms`, `modifiers_json` (union seen, never `sensor_uncertain`), `peak_severity` and `engine_version`.
- `meta`: schema version, collector settings (`collector_settings`), saved health memory (`health_memory`), speech memory (`message_memory`), watering-detection pause (`watering_detection_suppressed_until`).
- Migrations: `server/schema.ts` `MIGRATIONS`, applied on open. Steps with a column check always verify the actual table shape.

**localStorage** (UI only):
- `appbonsai_settings_v1`: the browser copy of settings. It syncs with the server: on load, the server copy wins if it has one, and every save is PUT to `/api/config`.
- `appbonsai_sensor_debug_v1`: whether the live strip is visible.
- The old `appbonsai_plant_history_v1` and `appbonsai_watering_history_v1` are imported into SQLite once (`legacyBrowserHistory.ts`, flag `appbonsai_sqlite_import_v1`) and then left untouched.

### Local API (port 3001)

| Endpoint | Purpose |
|---|---|
| `GET /api/status` | Server, collector and database status |
| `GET /api/current` | Everything the UI needs in one call: perception, health, behaviour, expression, forecast, live readings, recent events and episodes |
| `GET /api/health`, `GET /api/behaviour` | Subsets of the current state |
| `POST /api/refresh` | Read the sensor now |
| `POST /api/collector/calibration {minutes}` | Pause watering detection while handling the probe (`0` resumes) |
| `GET`/`PUT /api/config` | Collector settings |
| `GET /api/events?days=`, `POST /api/events {type, note?, timestamp?}`, `DELETE /api/events/:id` | Care events |
| `GET /api/history?hours=`, `/hourly`, `/daily?days=`, `/diary?days=`, `/episodes?days=` | History and the plant diary |
| `GET /api/telemetry/latest`, `POST /api/telemetry/test {url}`, `POST /api/telemetry/import-browser` | Raw readings, server-side link test, one-time import of browser history |

### UI

- Desktop single-screen layout (`h-screen`, no page scroll). The header has status, refresh (asks the server to read now), the live-sensor strip, Diary, Developer and Settings. Panels open in a side drawer, and `#history`, `#settings` or `#developer` in the URL opens one directly. `#preview=<preset id>` starts in a developer preview.
- `pages/Home.tsx`: the avatar on the left; the gauge, the expression's message and tip, and the 2×2 `SensorCardGrid` on the right. Clicking a sensor card (or a column of the live strip) opens a popup with its best conditions and ranges (`SensorGuide`); the content is `MetricAssessment.guide`, built from the species profile in `health/metricGuides.ts`. The gauge opens Tree Diagnostics. `DetailView` is the modal with per-metric bars and charts. The charts use stored hourly averages for the sensor and the forecast for weather.
- `pages/History.tsx`: the plant diary (episodes + care events as narrative lines from `history/diary.ts`), a care log, and a compact 7-day strip.
- `BonsaiAvatar` takes an `ExpressionState`. The visual vocabulary types live in `expression/expressionTypes.ts`; `components/avatar/avatarStates.ts` only holds the posture transforms.
- Night theme: when the expression's atmosphere is `night` (sleeping or too dark), the main screen goes dark with lanterns. Drawers and the modal stay light (`day` class).
- Styling uses Tailwind with theme tokens (`--ink`, `--paper`, …) in `src/index.css`, `lucide-react` icons, and `motion` toasts.
- `App.tsx` has a `TEMP DEBUG` console.log that traces the soil value from the ESP32 to Home. Remove it once no longer needed.
