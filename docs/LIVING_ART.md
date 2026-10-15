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

One Ficus microcarpa/retusa (ginseng type) on a balcony: substantial trunk, exposed roots, two major upper branches.

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
- **Gesture.** Pointer Events, so mouse (held button), touch and pen all work.
  - A press that travels < 8 px is a tap. A longer one is a stroke, and only if it starts near the foliage.
  - `touch-action: pan-y` keeps vertical swipes scrolling the page.
  - Reduced motion: blink only.
  - One rAF loop runs while springs move. It writes transforms directly to three pad groups and a lean group,
    with no React render per frame.
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
  - It is excluded from `lastCareAt` and never read by mood, energy, responsiveness or health.
  - No streaks, no "you were away", no reward for frequency, and in V1 nothing is voiced.
- **Tested:** `npm run test:behaviour` P1–P6 (a petted and an unpetted tree evolve identically; state-dependent
  answers) and `npm run test:collector` A1–A5, M2 (session merging, refusals, no care events, migration).

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
