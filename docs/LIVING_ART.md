# Living Art

What Appbonsai is for, the principles it has to respect, how the code serves them today, and what is still open.
Read this before changing how the tree perceives, judges, behaves or speaks. CLAUDE.md covers the mechanics; this
document covers the intent.

> Status legend used throughout:
> **[Implemented]** in the code today (file given) · **[Partial]** exists but limited · **[Intention]** agreed design
> direction, not built · **[Open]** unresolved question.
> Evidence classes for biological claims: **science** (general plant biology), **calibration** (measured on this
> tree/pot), **inference** (reasonable but unmeasured), **art** (an expressive choice, not a biological claim).

Written 2026-10-15 from the owner's Living Art briefing and a read of the code at commit `617d337` (engine `living-2.0`).

## 1. The idea

Living Art explores the relationship between a living organism, its environment and the person caring for it.
The first subject is one real Ficus bonsai.

**The real plant is the artwork. The digital character is an expressive interpretation of its living state.**

The goal is not to monitor a plant or decorate measurements. It is a digital representation that perceives the
tree's environment, responds to change, keeps continuity over time, and expresses the tree's condition through a
character. The character should feel alive **without claiming the plant has human consciousness or emotions**.

The experience is the combination, and the tension, between:

```
physical organism + sensing + memory + interpretation + expression + human care
```

Two failure modes to avoid:
- **A dashboard with a face.** Numbers dressed up, with no memory, no continuity, no interpretation.
- **A fictional pet.** A Tamagotchi whose moods are disconnected from the real tree.

Personality must come from **real environmental patterns, remembered events and care history**, never from
random emotion or generic chatbot talk. When in doubt, biology wins over entertainment.

## 2. The tree

One Ficus microcarpa/retusa (ginseng type) in a greenhouse (the sensors measure inside it; outside weather is context, see "Outside weather"): substantial trunk, exposed roots, two major upper branches.

Its history (**caretaker-reported**, not recorded in the database):
- Significant green-leaf drop, likely from environmental stress.
- Moved to a brighter spot; recovery and new growth followed.
- New shoots broke from old wood and directly from the trunk.
- Selective pruning to encourage branching; some lower shoots left on purpose to build future structure.
- Scale insects, possibly with honeydew and ants.
- Organic, moisture-retentive soil; watering, fertilizing and seasonal change have all been part of its care.

The lesson this history teaches, and the core of the design: **a plant's condition cannot be read from one
sensor value. Its history matters.** A soil reading of 35 % means different things depending on what it was
before, how long it has been dry, a recent watering, temperature, season, whether the probe is trustworthy, and
how this particular pot is calibrated.

## 3. Biological principles

| Principle | Class | How the code honours it today |
|---|---|---|
| Soil moisture sensors measure the **substrate**, not the plant's internal hydration. | science | [Implemented] Soil % is labelled "PROTOTYPE: FC-28 % for this pot" (`src/species/ficus.ts`); conditions are named after the soil ("thirsty" is a latch on soil %, not a claim about tissue water). |
| An LDR is **not** a measure of biologically meaningful light. | science | [Implemented] Light is a relative LDR %, never lux; it's judged against sun elevation and as a daily share of useful light (`perception/dailyLight.ts`, `low_daily_light` latch). Bands are uncalibrated. |
| Temperature and humidity must be read **in context**. | science | [Partial] Ranges are general ficus guidance; stability (swings) feeds vitality. No VPD from the sensor, no microclimate learning. |
| A greenhouse night is humid: the air cools and relative humidity climbs. Only near-saturated air held for hours (leaves staying wet) is a risk. | inference | [Implemented] At night the `high_humidity` latch uses its `night` rule: ≥ 88 % for 3 h, exit ≤ 84 % (by day > 85 %, exit ≤ 80 %). The tree still sleeps (primary), and the night looks dewy: dew glinting on its leaves, a drop letting go now and then, a mist bank drifting low around the pot, leaves a little heavier and a slower sway (effects `dew`, `night_mist`; preview Combined → Asleep, humid night); after such a night a once-a-day "dewy night" morning line (`morning_dewy`), whose short recovery at dawn doesn't make it a hard night. Scenarios HN1–HN5, S8d–S8e. |
| Plants respond to **duration and accumulated stress**, not instants. | science | [Implemented] Hysteresis latches with enter/exit durations (`health/hysteresis.ts`), per-hour stress penalties with caps, exponential vitality smoothing, intensity tiers from *observed* duration. |
| **Seasonal** growth and water demand change. | science | [Partial] Season is perceived (`perception/season.ts`) and expressed in all three layers, but deliberately **does not change health or thresholds**: `seasons[*].waterNeed` is informational only. |
| Pruning response follows **apical dominance and bud activation**, and shows over days to weeks. | science | [Partial] Pruning gives a 3-day "calm" and a 21-day context window; pruning in the growing season gets a "new shoots" reaction. No model of bud break timing or where shoots appear. |
| A visible response can lag an event by **days or weeks**. | science | [Partial] Care context fades over 2–21 days (`perception/careContext.ts`). Nothing schedules a *later* visible response (e.g. new leaves weeks after moving to brighter light). |
| **Missing or unreliable data is not good health.** | science + design | [Implemented] Stale or suspect data freezes latches and vitality and shows `sensor_uncertain` ("Last known · Paused"); suspect sensors are excluded from health (`telemetry/dataQuality.ts`, continuity policy in CLAUDE.md). |
| Thresholds here are local and provisional. | calibration | [Open] Every soil/light number in `ficus.ts` is marked PROTOTYPE and still needs tuning against real dry/wet pot readings and real balcony light. |

Keep the evidence class visible when adding rules: a code comment saying *PROTOTYPE*, *general guidance* or
*expressive choice* is enough.

## 4. Architecture as it serves Living Art

```
ESP32 → collector → SQLite → Perception → Health → Behaviour → Expression → Avatar / Home
                                                                     ↑
                         care events (sensor-detected or logged by the caretaker)
```

Each layer has one job (details in CLAUDE.md). The Living Art reading of them:

- **Perception** answers *what is happening around the tree, and how much can we trust it*. It includes sun,
  season, trends, data quality and a fading **care context** (`careContext.ts`: settling after repotting, calm
  after pruning, re-learning light after a move).
- **Health** answers *what condition is the tree in*, with memory (latches, vitality, recovery). No wording, no
  personality.
- **Behaviour** answers *how does that condition show up as a character*: mood, energy, responsiveness, recovery
  stage, care reactions, relationship memory, and when to speak or stay silent.
- **Expression** answers *what does the viewer see and read*.

### The three layers of expression

Every `ExpressionState` carries `layers` (`src/expression/expressionTypes.ts`), built in `ExpressionEngine.ts`:

| Layer | Meaning | Source | Where it shows |
|---|---|---|---|
| **Epidermal** | The immediate physical reaction: droop, sway, gaze, gestures, foliage tone, details, scene. | `LOOKS`, `describeBody()` in `ExpressionEngine.ts` | The avatar and scene itself; the text description only in the Behaviour Debug panel. |
| **Wording** | Emotional communication, in carefully chosen, sparse language. | `behaviour/messages.ts` via `speech.ts` | Home message + tip. |
| **Diffraction** | A response that comes from **history + context**, not from the current reading: the same care means different things depending on what came before and the season. | `careReaction` and `relationship.ts` in behaviour, `CareReaction.seasonal` | Folded into wording and look; the explicit text only in the Behaviour Debug panel. |

The diffraction layer is where Living Art differs most from a dashboard: watering a thirsty tree gives *relief*;
watering already-wet soil gives *watering_enough*, never a celebration; feeding in winter makes the tree *patient*.

## 5. Character principles

| Intention | Status |
|---|---|
| Sustained dryness lowers energy gradually. | [Implemented] Tier rises with observed duration; vitality declines with τ 2 h; leaf droop and sway follow energy. |
| After a reliable watering it **recovers over time**, not instantly happy. | [Implemented] relief → perking → settling recovery stages; `recovering` holds by severity (1–6 h); afterglow for 2 h after stress. |
| Quieter at night. | [Implemented] `night_rest` → sleeping, night scene, quiet-night speech rules. |
| Long favourable periods read as **sustained stability**. | [Partial] `thriving` latch (vitality ≥ 90 for 2 h) with the golden scene. Nothing marks weeks of stability differently from two good hours. |
| Sensor failure is communicated as **uncertainty**, not feeling. | [Implemented] `sensor_uncertain` overlay, static scene, paused gauge. |
| Speaks rarely, never repeats on refresh, no random moods. | [Implemented] Speech policy, stable variants, once-per-episode/day/season lines; scenario test proves wording never drives logic. |
| Not repetitive over weeks. | [Open] Two variants per line in many places; nothing tracks what was said last week. |

## 6. Care and relationship

Human care is part of the artwork: watering, pruning, fertilizing, repotting, relocation, pest treatment,
observation.

**Event certainty.** The briefing asks to separate three kinds of event:

| Kind | Status |
|---|---|
| Confirmed by sensors | [Implemented] Watering detection with confirmation, spike/probe-pull rejection, calibration pause and stored evidence (`perception/wateringDetector.ts`); `metadata.source = 'sensor'`. |
| Recorded manually by the caretaker | [Implemented] `POST /api/events`, `source = 'manual'`; manual and detected waterings within `manualMergeMinutes` merge. |
| Inferred but uncertain | [Open] There is no "uncertain" class: a rise is either confirmed and stored, or discarded. Candidates that fail confirmation leave no trace. |

Event types today: `watering`, `pruning`, `fertilizing`, `repotting`, `moved_location`, `manual_note`.
**Pest treatment and pest observation (the scale insects) have no event type** [Open]; they can only be a manual note.

**Relationship** is derived from episodes and events, never stored as a score (`behaviour/relationship.ts`):
thirst episodes in 30 days and how soon water followed, waterings today, waterings on wet soil in 7 days, typical
recovery time. It yields at most one gentle, non-judgmental observation (`thirsty_since_yesterday`,
`lots_of_water_today`, `usually_notices_thirst`, `typical_recovery`), spoken once per episode. [Implemented]

Rules:
- Relationship grows from **continuity**, not an affection score. Don't add one.
- Never blame the caretaker.
- **Relationship storytelling is not a biological effect.** "You usually notice when I'm dry" is a true statement
  about the record; it must never change health, vitality or thresholds.

### Mood: its own layer [Implemented, V1]

Mood used to be a first-match lookup on health with no memory. It is now its own slow layer
(`behaviour/mood.ts`, numbers in `APP_CONFIG.mood`, evidence class *art*):
- **Two dimensions** that drift with inertia: valence (−1 unpleasant … 1 pleasant) and arousal (0 still …
  1 lively). Each mood label has a point in that space.
- **Health anchors it.** The categorical mood from the condition, its tier, recovery and care reactions is
  the anchor point.
  - The severity sets a valence ceiling: calm 1, mild 0.3, moderate 0.05, critical −0.35. A concern caps it
    at 0.35.
  - A calm tree has a floor (−0.15), so weather can't make it miserable.
  - A stressed tree can be comforted, never look happy. This is the guardrail against the "Tamagotchi
    disconnected from the tree" anti-goal.
- **Nudges inside that band**, each small and capped:
  - the **inside environment:** swinging air unsettles; good light by day enlivens; pleasant warmth;
    sunrise and sunset; the season;
  - **petting:** a warmth that fades (τ 45 min) and saturates (more petting settles), full in calm or mild
    states, smaller in moderate ones, none in critical;
  - **care:** a warmth for a few hours after any care event;
  - the **visitors' company:** the squirrel, the dragonfly or the sloth (the sloth calms);
  - the **outside weather**, only for a calm tree: rain is cosy, a storm unsettles, fog quietens, a clear
    day or wind enlivens.
- **Inertia:** the collector persists where the mood was (`meta.mood_memory`).
  - It falls fast (τ 10 min) and rises slowly (τ 40 min).
  - Event moods switch in about 2 min: no trustworthy data (`confused`), asleep (`sleepy`), a care reaction.
- **The label** is the nearest mood the health state allows (a calm set or a stress set under the
  ceiling), with hysteresis so it doesn't flap.
- **One direction:** mood shapes the face, the tap label and the body description. Health, vitality,
  energy, speech timing and the visitors never read it. The Behaviour Debug panel shows valence, arousal,
  the anchor, the ceiling and every nudge.
- Tested: MO1–MO7 (anchored, petting fades, inertia, hysteresis, company, weather, restart); P1, DF5 and
  SL5 check that only the mood moves.

### Touch and attention (petting) [Implemented, V1]

Stroking the on-screen foliage is **attention: not care, and not biology** (evidence class *art*). Real mechanical
touch does affect plants (thigmomorphogenesis), but a finger on glass never reaches the ficus. So petting gets a
real, felt answer, it is remembered, and it changes nothing about the tree's state.

- **Response is decided upstream.** `ExpressionEngine.ts` sets `expression.touch` (`TouchResponse`: kind, give,
  spring stiffness/damping, lean, blink) from the condition and modifiers. `responsiveness` scales it.
  The avatar only animates it (`components/avatar/usePetting.ts`).

  | State | Touch kind | How it answers |
  |---|---|---|
  | comfortable / thriving | `lean_in` | soft follow, slight lean, soft eye-close |
  | recovering, wet, humid, dim, afterglow or concern | `gentle` | smaller and careful |
  | thirsty / very dry / hot / dry air / glare | `dry_rustle` | stiff, papery, no lean |
  | cold / freezing / multiple stress | `braced` | tight, small |
  | asleep (primary or modifier) | `slow_stir` | slow soft sway, eyes stay closed |
  | `sensor_uncertain` (primary **or overlay**) | `muted` | almost nothing: never a falsely healthy answer |

- **Nonverbal.** The answer is local spring motion and a blink or lean. No sentence follows a stroke. Thoughts
  surface only through the normal speech policy. A plain **tap** is unchanged: a brief perk-up plus the mood label.
- **Honest motion.** Leaves bend sideways with the hand and can only settle slightly lower, never higher, so
  petting never lifts a droop. A thirsty tree still looks thirsty afterwards.
- **Gesture.** Pointer Events, so mouse, touch and pen all work.
  - **Mouse:** simply moving over the leaves pets them, no click needed; a held-button drag (grab and shake)
    works too. Hover petting starts after 20 px of movement over the foliage and ends when the mouse rests
    (0.5 s) or leaves.
  - **Touch / pen:** a drag that starts on the foliage. `touch-action: pan-y` keeps vertical swipes scrolling.
  - A press that travels < 8 px is a tap.
  - Strokes shorter than 0.3 s (brushing past) show the hand but aren't counted or acknowledged.
- **Two kinds of feedback, kept apart.**
  - *Your hand* is the same in every state: an open-hand cursor over the foliage and a soft warm glow under
    the pointer while petting. It makes clear that you are petting, without claiming anything about the tree.
  - *The tree's answer* comes from `expression.touch`: leaves bend with the hand and rustle quickly while it
    moves, the tree leans, a blink. A thirsty, sleeping or unsure tree answers less, however clearly you pet it.
- **Performance and reduced motion.**
  - One rAF loop runs only while something moves. It writes transforms directly to three pad groups, a lean
    group and the glow, with no React render per frame.
  - Reduced motion: the hand glow and the blink only; leaves don't move.
- **Sessions, not movements.** The browser closes a session after `APP_CONFIG.attention.sessionIdleMs`
  without a stroke, then sends one `POST /api/interactions`. Nothing is sent during pointer movement, and nothing
  while a developer preview is active.
  - The server merges sessions within `mergeMs` into one row, clamps lengths and refuses unknown kinds.
  - It caps new rows per hour.
- **Storage is separate from care.** The `interactions` table (`kind, started_at, ended_at, count, metadata_json`)
  has a free-text `kind`, so future interactions (visits, …) need no table rebuild. V1 accepts only `pet`.
  It's not a `plant_events` type, so care counts, care context and the diary stay clean.
- **Relationship memory records it, without dependency.**
  - `relationship.attention = { petSessions7d, lastPetAt }`, shown in the Behaviour Debug panel.
  - It is excluded from `lastCareAt` and never read by energy, responsiveness or health. It reaches the mood
    only as a small, fading, saturating warmth inside the band health allows (see "Mood: its own layer").
  - No streaks, no "you were away", no reward for frequency, and in V1 nothing is voiced.
- **Familiarity (over weeks).** The more *days* someone pets the tree, the more at ease it becomes with the
  hand. `relationship.attention.familiarity` (0–1, `relationship.ts`) is built from the distinct days with
  petting, each fading with `APP_CONFIG.attention.familiarityTauDays`.
  - Fifty sessions in one day count the same as one stroke, so there's nothing to grind.
  - Two weeks of daily visits gives ≈ 0.9.
  - Absence only fades it back to neutral (exactly 0 after the 30-day window), never below. An untouched tree
    answers exactly as it did before any petting.
  - It warms **only the calm answers** (`lean_in`, `gentle`): up to +25 % give, +30 % lean, a 20 % softer spring
    and slower habituation. Thirsty, cold, asleep and unsure answers are identical at any familiarity.
  - It's invisible: no meter or level in the UI, only the Developer panel.
- **Habituation (within a session).** Continuous stroking lets the answer settle toward
  `touch.habituation.floor`, and a rest of a minute or two recovers it. The settled answer is calm acceptance,
  never a refusal: leaves still follow, just less, and blinks stop repeating.
  - The rates come from the Expression Engine per touch kind; the math is `habituate()` in
    `src/expression/touch.ts`.
  - It lives only in the open page, never stored or sent.
  - It's inspired by real plant habituation (*Mimosa pudica* stops folding after repeated harmless touch).
    Ficus does not do this; evidence class *art*.
- **Tested:**
  - `npm run test:behaviour` P1–P6: a petted and an unpetted tree evolve identically; answers depend on the state.
  - `npm run test:behaviour` F1–F6: familiarity counts days, fades back to neutral, and never changes stressed or
    unsure answers.
  - `npm run test:behaviour` H1–H3: habituation settles above its floor and recovers after a rest.
  - `npm run test:collector` A1–A5, M2: session merging, refusals, no care events, migration.

### Derived environmental metrics [Implemented, V1]

Five derived metrics, each owned by one engine and interpreted through the existing contracts. No second
health score and no parallel decision system. Thresholds are in `ficus.ts` `environment` and are
**provisional** (evidence class *inference*) until calibrated against this tree.

| Metric | Perception (calculates) | Health (interprets) | Behaviour / Expression |
|---|---|---|---|
| **VPD** (unchanged) | per reading, from temperature + humidity | metric card only (diagnostic); not in vitality, since air is already scored | none |
| **Soil dry-down** | least-squares slope over ONE uninterrupted segment: never across a watering (restarts once drained), a calibration change or pause, a reading gap or a suspect sensor. With a confidence (span, samples, standard error) | not used directly | the voice predicts thirst only at medium/high confidence |
| **Moisture–VPD coupling** | drying per kPa of mean VPD, only from a high-confidence drying segment with VPD ≥ 0.5 kPa | **diagnostic only**: compared with this pot's own ~7-day baseline (HealthMemory, learned only from live, confident segments; "learning" for the first 3 days). Shown in the developer panel and the soil card's notes. It never reaches vitality, conditions, mood, watchfulness or the avatar, because slow drying is not necessarily stress | none (until validated) |
| **Temperature exposure** | decayed degree-hours outside the optimal range over 24 h (τ 6 h), observed time only | lowers the **existing** temperature score (same component, same weight): the worse of "now" and "recently". It builds with sustained heat or cold below the latch thresholds and fades gradually (no permanent penalty, no abrupt reset) | through vitality → energy and mood, as before |
| **Prolonged wetness** (unchanged) | soil readings | the `too_wet` latch, observed `wetHours`, the vitality penalty | tiers, looks, the watering-on-wet-soil reaction |

- **Memory:** the coupling baseline is an optional field of HealthMemory, so older saved memories load
  unchanged (no version bump, no replay). A soil recalibration replays health from telemetry and the
  baseline starts over, which is right because the % scale changed. Care history, episodes, attention and
  speech memory are never touched by a replay.
- **Tested:** `npm run test:scenarios` DD1–DD8, CP1–CP4, TX1–TX5; `npm run test:collector` MG1–MG3b.
- **Open:** validate coupling against the real pot (and possibly the new sensor) before it may inform
  health; calibrate the exposure rate.

### Sunrise and sunset [Implemented, V1]

The sun's real moments at the tree's location (Open-Meteo's published times, else computed to about a minute)
run through the whole loop:
- **Perception** knows them (`perception.sun`).
- **Health** deliberately doesn't use them. It is biology from measurements, and the sun's elevation plus the
  light sensor already say what matters (is light expected, is it night).
- **Behaviour** lives by them: morning and evening follow the real sunrise and sunset, the tree is a little
  livelier as the sun comes up and quieter toward dusk, and it says so once a day ("The sun is up. Good
  morning." / "The sun is going down.") when calm.
- **Expression** shows it:
  - a calm tree stretches toward the rising sun and yawns toward the setting one, and a stressed tree keeps
    its stress look;
  - the sky glows and the sun's disk crosses the horizon at the minute, muted when it's cloudy, foggy or
    raining outside.

### Thoughts of the day [Implemented, V1]

A calm day is not one sentence long. The tree shares a few thoughts through the day, but only things it can
back with today's data. Its personality comes from real patterns, never filler.

- **How much it has to say follows its energy:** vitality × the growth phase of the season. A thriving
  summer day has about 6 thoughts, a calm autumn day about 3, a winter rest day about 2
  (`behaviour/voice.ts`).
- **What it says is grounded:**
  - soil still comfortable, with the estimate from its trend ("at this pace, thirsty in about 2 days");
  - days since the last drink;
  - the brightest hour, a good light day, the days getting shorter or longer;
  - a humid morning (and whether the glass may fog);
  - the warmest hour, warmer inside than outside;
  - the squirrel's visit, new leaf tips while the canopy refills, the drey taking shape.
  No data, no thought.
- **When:** spread over the daylight (at least an hour apart), each at most once a day, shown for 15 min,
  so a calm tree stays mostly silent. Never over something more important: a stress, a care reaction, a
  reading being watched. At night it rests.
- Wording lives in `messages.ts` by id with facts, so it can be rewritten freely without changing behaviour.

### Canopy: the last weeks [Implemented, V1]

The tree's look has three timescales:
- **Now:** the state's look (thirsty grey-green, wilting, frost…).
- **The year:** calm states wear the season (fresh tips in spring, glossy summer, a few yellowing leaves in
  autumn, deep winter green). Ficus is evergreen, so it stays subtle.
- **The last weeks:** how full the canopy is.

A real ficus answers a sustained stress by dropping leaves, often drops some after being moved, and refills
over weeks, slowly in winter. This tree's own history is exactly that: green-leaf drop, then new shoots after
moving to a brighter spot.

- **An interpretation, not a measurement** (evidence class *inference*, PROTOTYPE numbers in `ficus.ts`
  `canopy`). The app can't count leaves; it reads the stored episodes and care events
  (`behaviour/canopy.ts`). Nothing is stored, and health, vitality, mood and the habitat never read it.
- **Rules:**
  - A stress costs leaves only past a grace period (critical 2 h, moderate 6 h, mild 24 h). A passing
    thirst leaves no gap.
  - Two days very dry ≈ a quarter of the canopy.
  - A move → a small dip over the next days.
  - Calm, recovering and asleep time refill it with a time constant of ~12 days, scaled by the growth phase
    (spring 1.4×, winter 0.3×).
  - Unobserved time and gaps hold it.
  - It never goes below 60%: the app can't know the real tree is bare.
- **Drawn:** missing leaves at the rim first, more of the pad's branchlets showing between the leaves (no shading), lighter
  highlights; while it refills, small fresh tips. The state and season looks stay on top.
- **Preview:** Developer → Canopy, or `#canopy=0.7` / `#canopy=refilling`. Tested:
  `npm run test:behaviour` C1–C8.
- **Limitation:** the current season's growth phase is used for the whole window. **Open:** calibrate
  against photos of the real tree, and possibly let the caretaker note leaf drop.

### Outside weather [Implemented, V1]

The tree lives in a greenhouse. Outside it still rains, fogs, storms and freezes, and that is part of the
tree's world, but **not its condition**: the ESP32 inside says how the tree is. Evidence class *context*.

- **Source:** Open-Meteo at the tree's location, every 15 min, in every data-source mode
  (`telemetry/outsideWeather.ts`, `outside_weather` table). A failed fetch invents nothing. After an hour
  without a new observation, nothing is shown.
- **Not the tree's condition, with one exception: it explains dim light.** Perception carries it as
  `outside`. Health, energy and the habitat never read it. A calm tree's mood takes a small nudge from it
  (rain cosy, a storm unsettling; see "Mood: its own layer").
  - Light is judged relative to the sky as well as the sun. Each daylight LDR reading is compared with
    thresholds scaled by `species.light.skyFactor` for the sky outside at that moment (`dailyLight.ts`,
    `skyAt()`). Overcast is 0.55, fog and rain 0.5, a storm 0.35 (evidence class *inference*, PROTOTYPE).
  - So a grey day's dim reading counts as a fair share of what there was. It is not "too dark", and the
    light card says "Grey day".
  - The same reading under a clear sky is a dim spot. A reading darker than even the grey sky explains is
    still too dark. With no weather data, nothing changes.
  - Replays use the stored observations, so the judgement is the same after a restart.
  - Tested: `npm run test:scenarios` D3–D6. Scenario O1 runs a storm against calm weather with good light
    and requires an identical tree.
- **Around the tree, never on it:** `atmosphere.weather` paints a layer behind the tree, over the state
  scene: rain, a downpour, drizzle, fog, grey overcast, snow, a storm with lightning, wind streaks. A
  thirsty tree on a rainy day shows both.
  - `WeatherForeground` (on Home, over the avatar, never taking the pointer) adds the weather *in front*:
    fog banks drifting across the plant under a white veil, big raindrops falling past it and splashing by
    the pot, flakes passing in front.
  - **The tree art itself never changes for the weather.**
  The header chip names it ("Outside · Rain · 9°C").
- **Wording:** a calm, awake tree mentions a notable contrast once a day (rain, storm, fog, snow, or cold
  outside while it is warm inside), e.g. "Rain outside. Dry and calm in here." The lines never claim the
  tree is wet or cold. A stressed tree talks about its own state instead.
- **Diary:** one line per notable spell ("Rain outside, 14:00–17:30", "Frost outside · down to -3°C").
- **Inside vs outside air (the Outside panel).** Relative humidity depends on temperature, so 81 % inside
  next to 55 % outside isn't a contradiction: the plant and the damp soil add water that the glass keeps
  in. The panel compares the **dew points** and the water the air holds (`perception.air`, only with the
  real sensor), and notes when the glass may fog. These are facts, never health.
- **Open:** tuning `skyFactor` against this LDR on real grey days; outside forecasts ("rain tonight").

### The weekly hike [Implemented, V1]

The tree looks out for its people too: once a week it picks the day with the best forecast for their hike.
Evidence class *context*, about the people, **never the tree**: health, vitality, mood and the habitat never
read it.

- **Source:** Open-Meteo's daily forecast (14 days) at the tree's location, every 3 h
  (`telemetry/hikeForecast.ts`, kept in `meta.hike_memory`). A failed fetch keeps the last forecast, and
  the panel shows how old it is.
- **The pick** (`behaviour/hike.ts`, numbers in `APP_CONFIG.hike`): weeks run Monday to Sunday, and only
  the week's remaining days compete. A day scores 0-100: a comfortable high (16-25 °C), little chance of
  rain, no storm, snow or gale. It follows the forecast until its day arrives, then locks. Once it has
  passed, next week's pick shows.
- **Two days, the people choose:** the tree offers its pick and the next best remaining day
  (`plan.options`). Tapping one on the week strip chooses it (`POST /api/hike/choose`, `chooseHikeDay()`,
  stored as `WeekPick.chosen`). A chosen day holds whatever the forecast does (it is theirs, not the
  tree's); once it has passed, next week's two days show.
- **Wording:** the tree offers the two days once ("Good days for a hike: Saturday or Wednesday. Pick one on
  the calendar."), again when the forecast moves its pick ("The forecast changed: the hike moves to
  Thursday."), answers a choice ("Wednesday it is!"), and greets the day itself.
  Only calm and by day; a stressed tree talks about itself.
- **Art:** on hike day two pairs of hiking boots stand on the ground by the stand, one each side, each with
  a water bottle at its heels (`avatar/HikingBoots.tsx`). Home shows the plan under the Outside panel with the week at a glance.
- **Tested:** `npm run test:scenarios` HK1–HK10.
- **Open:** preferring weekends, and remembering hikes that happened in the diary.

### Visitors and habitat (the squirrel) [Implemented, V1]

A squirrel that visits the digital tree is **art, not biology**, and not a pet. It is shown only because
the real tree has been a good place to be for a while. Wild animals behave like the health latches: slow to
trust a place, quick to leave it.

- **Habitat value** (`behaviour/habitat.ts`, numbers in `APP_CONFIG.habitat`). It is derived from the stored
  episodes of the last 14 days, so nothing new is persisted and it survives restarts.
  - Comfortable or thriving time raises it toward 1, over days of **observed** time (τ 36 h, or 20 h when
    thriving).
  - A primary stress lowers it toward 0: τ 1 h when critical, 4 h when moderate, 12 h when mild.
  - Sleeping, recovering, very bright and sensor-uncertain episodes hold it. So do gaps and unobserved time.
- **Latch:** visitors come above 0.6 and stop below 0.4 (a Schmitt trigger). In practice, about three calm
  days bring them, and a thirst of a few hours sends them away.
- **Right now:**
  - When it is calm, the squirrel **visits** a branch or the crown.
  - During a passing mild or moderate stress (and while recovering or in glare), it **hides** behind a pad
    and peeks.
  - During a critical stress or multiple stress, it is gone.
  - At night, while asleep or with no trustworthy data (primary or overlay), nothing is shown. An unsure tree
    never looks falsely healthy.
- **Visits are occasional.** The day is cut into 30-minute slots, and each slot may hold one visit of
  4–12 min. Visits are more likely the more welcoming the tree is, are busier in the morning and late
  afternoon, and are fewer at winter rest. In autumn the squirrel carries a nut. Visits are chosen with
  `stableVariant(day:slot)`, so a refresh never reshuffles them.
- **Petting is play** (attention, never stored; the petting session is recorded exactly as before). While it
  visits, stroking the leaves makes the squirrel play around the tree:
  - It hops between the branches, the crown, the trunk and the pot rim.
  - Sometimes it dives behind a pad and comes back out after 10 s.
  - Play ends a few seconds after the last stroke, and it stays where it ended up.
- **How it plays comes from the tree, never from the squirrel's own mood.** `expression.visitor.play`
  (`visitorPlay()` in `ExpressionEngine.ts`, numbers in `APP_CONFIG.habitat.play`) decides it:
  - **thriving** → playful (hops every ~2.5 s)
  - **comfortable** → gentle (~4 s; slower and hides more in an afterglow or while a reading is watched)
  - **hiding through a stress** → shy: it only ducks and peeks again, and never comes out to play
- **The tail wags in the tree's rhythm.** `play.wag` takes the tree's own sway speed and amplitude: fast and
  wide when the tree is lively, slow and soft when it's tired, small quick flicks when it's hiding.
- **No reward loop.** Continuous stroking settles the play toward the touch habituation floor, and a rest
  recovers it. Petting never brings more visits or changes the habitat (V13).
- **Reduced motion:** no hopping; the squirrel stays where it is.
- **The drey: weeks of care made visible.** The same replay (30 days of episodes) builds a second slow value:
  - It rises while the habitat is welcoming, sleeping time included (τ 10 days). A few twigs appear after
    about a week; the nest is **built** after about 12 days.
  - It falls while the habitat is not welcoming (τ 3 days), with hysteresis on both stages.
  - A one-day drought thins it, a week of trouble takes it apart.
  - With a built drey the squirrel **sleeps in it at night**, only its tail draped over the edge, breathing
    in the tree's slow night rhythm. A stroke only makes the tail twitch; it never wakes up to play.
  - Without a drey, nights stay empty. With no trustworthy data, nobody is shown.
- **Shelter from the outside weather (context).** Rain, a downpour, a storm or snow outside sends a visiting
  squirrel into the leaves to peek, so play is shy. Within 30 min after the rain it comes out and shakes off
  (`outside.rainEndedAt`). Fog needs nothing extra: the fog layer veils it. **The habitat value, the latch
  and the drey never see the weather** (V17).
- **Answers to care (diffraction, never care itself).** On a calm, welcoming tree:
  - A *needed* watering (relief, thanks, gentle acknowledgement) brings it to the pot rim to drink for
    10 min.
  - A pruning brings it to inspect the cut (8 min; 3 min out of season).
  - One care visit per event (`care:<id>`). Watering on wet soil gets no answer: more water is never
    rewarded. A stressed tree, or a place that isn't welcoming yet, gets none either.
- **The dragonfly: the habitat's second wanderer** (`behaviour/dragonfly.ts`, numbers in `APP_CONFIG.habitat.dragonfly`). The same mechanism as the squirrel (observed-time drift, a Schmitt latch, deterministic slots: shared helpers in `habitat.ts`), with a different character:
  - **The air, not the tree's history:** it rises over ~45 min of warm (20–34 °C inside), bright (daylight with useful light) and calm (no rain, storm, snow or strong gusts outside) air, and falls within ~15 min of anything else. Enter 0.6, exit 0.35, so a few cool minutes don't drop it, while 25 min of rain does. Gaps hold it.
  - **Looser rules:** the tree's health only gates it (none at night, in a critical or multiple stress, or without trustworthy data). A thirsty tree can still get a dragonfly.
  - **More often:** 15-min slots, 35–70% chance (busier around midday), 2–6 min each. A warm day brings about 25–35 visits.
  - **Expression:** perched on a leaf tip (wings flat, a small bob) or hovering near it; wings beat faster in warmer air. Petting: it darts off and lands back where it was after ~4 s. It never plays.
  - **It flies around, by rules** (`dragonflyRoute()`, numbers in `APP_CONFIG.habitat.dragonfly.route`). Behaviour plans each visit's route; the avatar flies it on the clock between polls (`useDragonflyFlight`, ~1.4 s per flight, facing where it flies):
    - it sits on a tip 25–70 s (shorter in warmer air, when it is livelier), then flies;
    - from its **home tip** (where the visit started): now and then a short hovering sortie and it lands again, otherwise it moves to another tip, the high crown tip (where the light is) a little more often;
    - from anywhere else it mostly flies **back home** (perch fidelity: about half of its landings are on the home tip);
    - a hovering visit drifts in the air from tip to tip and lands only now and then, briefly;
    - with the squirrel there, the route never reaches the tips by the squirrel; resting on the sloth makes **the sloth its home**: it flies off, hovers, visits a tip, and comes back to the sloth (it shrinks to its resting size as it lands, and the sloth draws it from then on).

    Deterministic per visit (every refresh and every screen sees the same flight). Reduced motion: no flights, it is just where it is. Tested: DF7.
  - **Words and diary:** a "dragonfly came by" thought of the day; "A dragonfly visited (n visits)" per day, replayed from the stored readings.
  - Nothing is stored; health, energy and the squirrel never read it (its company lifts the mood a little). Tested: `npm run test:behaviour` DF1–DF7.
- **The sloth: the third wanderer** (`behaviour/sloth.ts`, numbers in `APP_CONFIG.habitat.sloth`). The dragonfly and the sloth are both *air wanderers*: one shared engine (`behaviour/wanderer.ts`, on the habitat helpers) where each species only brings its spec. The sloth's character:
  - **Warm, humid, still air** (≥ 22 °C and ≥ 55 % RH inside, no storm or strong gusts outside). **Rain doesn't bother it**: a greenhouse in the rain is perfect sloth weather.
  - **Slow in everything:** ~90 min to settle in, ~60 min to leave (half an hour of dry air doesn't move it). Visits are long (20–50 min) and come most hours, so a warm, humid day brings ~10 visits and 5–7 hours of sloth.
  - **It stays the night:** once settled, it sleeps the night through on one branch instead of coming and going.
  - **Looser rules:** the tree's state only gates it. No trustworthy data, a critical or multiple stress, or a **cold** tree keep it away; a thirsty tree still gets its sloth.
  - **Expression:** hanging under a branch (slow sway), inching along it (all four limbs), or curled up asleep in all four. Its tempo rises a little in warmer air. Its eyes are open (pale rims on the dark eye stripes) except asleep.
  - **Grips from comfort** (`slothGrip()`, `APP_CONFIG.habitat.sloth.grip`): a hanging sloth holds on with all four for the first stretch of a visit (it has just arrived). After that, every ~12-min stretch rolls a grip from its comfort band (its value, i.e. how long and how fully the air has been warm, humid and still):
    - marginal air: four limbs or both arms;
    - comfortable: both arms, or two legs and one arm;
    - long, perfect air: one arm (a wider, slower swing) or upside down by its legs.

    Stable within a stretch (a refresh never changes it); a new grip fades in slowly. Preview `#sloth=hanging:left_branch:one_arm`, or the grip chips in Developer → Visitors.
  - **Petting:** a slow look toward you and a long, slow blink (at most every 6 s). It never flees and never plays: the squirrel plays, the dragonfly darts, the sloth just looks at you.
  - **Words and diary:** a "sloth came" thought of the day; "A sloth spent time in the tree · about 5.3 h across 8 visits" per day.
  - Nothing is stored; health, energy, the squirrel and the dragonfly never read it (its company lifts the mood a little). Tested: `npm run test:behaviour` SL1–SL7.
- **Encounters: visitors in the tree together** (`behaviour/encounters.ts`, evidence class *art*). Each visitor's own engine decides whether it comes; when two coincide, `meet()` only arranges who sits where and names the encounter (`habitat.encounters` → `expression.encounters` plus cues on the presentations):
  - **The squirrel peeks at the sloth.** It never sits on the sloth's branch: it takes the other branch or the crown, and its play never hops there. If it came for that spot (a care answer), the sloth hangs on the other branch instead. They look at each other: the squirrel faces it, and the sloth turns its head slowly toward the squirrel and keeps it there (not while asleep).
  - **The squirrel watches the dragonfly.** The dragonfly never rests on the leaves right by the squirrel; the squirrel's head follows it.
  - **The dragonfly rests on the sloth.** In about half of its perched visits while a sloth is there (`APP_CONFIG.habitat.encounters`), it lands on the sloth's head, back or flank (drawn as the sloth's rider, so it sways with it; a stroke makes it dart and land back on the sloth). The sloth blinks slowly while it rests there.
  - **Remembered in words:** a rare "visitors met" thought of the day, only while it happens and at most once a day ("The squirrel and the sloth are sharing my branches."). In the diary, one line per pair and day where their visit windows overlapped ("The squirrel and the sloth shared the tree · 2 times").
  - Deterministic (stable rolls on visit ids), derived, nothing stored; health, mood and energy never read it. Previews of two visitors meet by the same rules. Tested: EN1–EN7.
- **Individuals, not dice rolls: each visitor has its own kind of memory.** A score, a latch and a roll per
  slot made every visit a fresh animal with no yesterday. Now each creature remembers in its own way. It is
  still derived (nothing stored), deterministic and art only: health, mood, energy and speech never read it.
  The three are deliberately different temperaments, not one machine in three costumes.
  - **The squirrel: trust in stages, habits, boldness** (`habitat.ts`, `APP_CONFIG.habitat.trust` and `.habits`).
    - **Trust** grows with welcoming time (τ 4 days, held time included, like the drey). It sets the stage,
      each with hysteresis:
      - **traces:** the habitat value rises past 0.35 before visits. A nibbled leaf at the left branch tip,
        or a tail tip over the back of the pot now and then. No animal yet.
      - **peeking:** welcoming, but trust < 0.3. Short peeks from behind a pad (half-length visits). It
        doesn't play (petting makes it duck) and doesn't come down for care answers.
      - **visiting:** as before.
      - **settled:** trust ≥ 0.75. Visits are 1.4× longer, and it also starts on the trunk and the pot rim.

      With calm days: traces on day 2, peeks on day 3, visits from day 4, settled from about day 8.
    - **Broken trust:** when the latch flips off, trust is cut to a quarter and rebuilds 1.6× slower for
      14 days. It comes back warily, peeking first, and settles later than the first time.
    - **Habits** come from its own past visits. They are taken from the habit-free replay, so a habit never
      feeds on itself:
      - its **usual hour** (the 2-hour band most of its recent visits fell in, recency-weighted over a
        week): visits are 1.4× likelier within an hour of it and 0.85× elsewhere;
      - its **favourite spot**: visits start there with chance 0.4 + 0.4 × trust.
    - **Boldness** comes from trust and from play (petting sessions during its visits). It only changes how
      it plays (sooner hops, fewer dives). More petting never brings more visits or other times.
  - **The sloth: loyalty, no stages** (`sloth.ts` `slothMemory()` / `withLoyalty()`, `APP_CONFIG.habitat.sloth.loyalty`).
    - Days with long visits (from the stored readings of the last 14 days, each day replayed with the
      loyalty of the days before it) make the tree its tree. Days away fade it (τ 5 days).
    - A loyal sloth has a **home branch**: it hangs there most of the time and sleeps there at night.
    - It **stays longer** (up to 1.3× visits) and is **slow to give up**: the latch exit is lower and its
      fall time longer, so it holds on through a 90-minute cool spell that sends a new sloth away.
    - It doesn't scout and has no stages: it just turns up. The collector derives its memory once a day
      (perception only has 24 h).
  - **The dragonfly: a territory for the day, no memory** (`dragonfly.ts` `territoryOf()`).
    - Within a day it holds one leaf tip as its own: 70 % of its visits start there, and its route keeps
      coming back to it.
    - Tomorrow is a new choice. A creature of the moment, by contrast with the other two.
  - Tested: V21–V25 (stages, broken trust, habits, boldness, restart), SL8, DF8.
- **Remembered in the diary.** `habitatDiary()` replays the same history:
  - "Signs of a squirrel: a nibbled leaf" (traces), "A squirrel peeked out from the leaves" (a day of peeks),
    "The squirrel has made itself at home" (settled), "The squirrel came back, warily" (after broken trust)
  - "The sloth is back on its branch" (a loyal sloth after days away, on its home branch)
  - "A squirrel visited" (once a day, with the count and the first time)
  - "The squirrel came back" (after 7+ days away)
  - "The squirrels stayed away" (naming what the tree went through)
  - "A squirrel built a drey in the crown" / "The drey was abandoned"
  - Nothing is stored for it.
- **Boundaries:** the habitat is computed just before mood in `evaluateBehaviour` (the visitors' company
  lifts the mood a little), and health, energy, speech and
  touch never read it. It is nonverbal: no lines.
- **Previews:** Developer → Test Tree State → Squirrel, or `#visitor=visiting:crown` / `#visitor=hiding` /
  `#visitor=peek` / `#visitor=traces` (`traces:tail` for the tail by the pot). The Behaviour Debug panel
  shows the value, the latch, the calm and stress hours, why nobody is visiting, the squirrel's trust, stage
  and habits, and the sloth's loyalty.
- **Tested:** `npm run test:behaviour` V1–V25 (V11–V13 play; V14–V16 the drey; V17 shelter; V18–V19 care
  answers; V20 the diary; V21–V25 the individual).
- **Open:** whether the thriving butterfly should join this system (arriving after a while, not on the latch
  minute), and other visitors (dawn birds; real ants once a pest observation can be logged).

## 7. Known gaps

The owner's **Living Art V1 audit** listed the gaps below. **The audit document itself is not in this repository**
(not found in the repo, Claude memory, or the owner's Drive as of 2026-10-15). If it turns up, put it at
`docs/LIVING_ART_V1_AUDIT.md` and link it here. Treat it as a dated assessment. Status against the code at `617d337`:

| Audit finding | Status now |
|---|---|
| Watering detection produced false positives. | Addressed in design: confirmation, spike and probe-pull rejection, sessions, calibration pause, all covered by `npm run test:collector`. **Not yet validated against weeks of real Pi data.** |
| Sensor thresholds and biological durations need validation. | Still open: all soil/light numbers are PROTOTYPE. |
| Seasonal behaviour is incomplete. | Partial: season is perceived, blended and expressed in all three layers; it still doesn't affect health or water need. |
| Some behaviour/expression values never reach the avatar. | Partly fixed: motion, gaze, gesture, filter, droop, reactionStrength, seasonal leaves and scenes are rendered. The `layers.epidermal` and `layers.diffraction` text only reaches the debug panel. Re-audit the rest. |
| Reactions are too repetitive. | Partial: stable variants and once-per rules; the line catalogue is still small. |
| Care events have little lasting effect. | Partial: care context fades over 2–21 days and changes energy, motion and light judgement. No lagged biological response (e.g. growth weeks after pruning or a move). |
| Relationship memory isn't expressed meaningfully. | Partial: one observation per episode in the wording; no visual or long-term expression. |
| Long-term patterns and individual baselines are underused. | Open: memory windows are 24–48 h for health and 30 days for relationship; no per-tree baselines (typical drying rate, usual light, normal day/night range). |

## 8. Unresolved questions

- Should season ever change health (e.g. scale thirst thresholds by `waterNeed`), and on what evidence?
- How to calibrate soil % and LDR % for this pot and balcony, and how to record the calibration's provenance?
- Should uncertain watering candidates be stored (with low confidence) rather than discarded?
- How should pests be modelled: an event, a condition the caretaker sets, or both? What should the tree show?
- How to represent slow responses (bud break, new leaves, leaf drop) that appear days to weeks after a cause, without inventing them?
- What per-tree baselines are worth learning, and over what window?
- How should weeks of stability, or long neglect, be expressed differently from hours of it?
- Should the epidermal/diffraction text be visible to the viewer (e.g. on tap), or stay implicit in the look?
- Should attention ever be voiced, and how, without guilt about absence or rewarding compulsive petting?
- What other interactions belong in `interactions` (visits, looking closely, a real-tree check-in), and which of
  them are really care (a real observation of leaves or pests) that should become a `plant_events` type instead?

## 9. Rules for future changes

1. Keep the real tree at the centre. Every expression must trace back to perception, memory or care.
2. New biology goes in `src/species/ficus.ts` with its evidence class; never in components.
3. Uncertain data is shown as uncertainty, never as health.
4. Wording lives only in `messages.ts` and never drives logic.
5. Relationship and storytelling never feed back into health.
6. Prefer slow, continuous change (blends, fades, smoothing) over jumps.
7. Attention (touch, visits) is never care and never biology: separate table, no effect on state.
8. Update the status tables in this file when you implement or drop something.
