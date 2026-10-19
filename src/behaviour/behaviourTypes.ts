import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import type { PlantEventType } from '../history/historyTypes';
import type { Season } from '../perception/season';
import type { SeasonRule } from '../species/types';
import type { HikePlan } from './hike';

// Moods drive the face (subtly) on top of the condition's look; see expression/ExpressionEngine.ts.
export type Mood =
  | 'joyful'
  | 'content'
  | 'tired' // low energy: heavier eyelids, slower expression
  | 'watchful' // something is a bit off: more alert eyes
  | 'relieved'
  | 'grateful'
  | 'patient'
  | 'uncomfortable'
  | 'distressed'
  | 'uneasy'
  | 'concerned'
  | 'sleepy'
  | 'dazzled'
  | 'overwhelmed'
  | 'confused';

// What the tree wants to communicate. Structured: wording lives in messages.ts and can change freely.
export type MessageIntent =
  | 'joy'
  | 'content'
  | 'afterglow' // comfortable again shortly after a stress
  | 'watchful' // fine overall, but one reading is outside its comfort range (not a condition yet)
  | 'thirst'
  | 'very_dry'
  | 'overwatered'
  | 'heat'
  | 'heat_and_drought'
  | 'cold'
  | 'freezing'
  | 'needs_light'
  | 'dazzled'
  | 'dry_air'
  | 'humid_air'
  | 'recovery'
  | 'sleep'
  | 'overwhelmed'
  | 'sensor_confused'
  // Reactions to care (diffraction: same action, different history → different response)
  | 'watering_relief'
  | 'watering_enough'
  | 'watering_gentle_ack'
  | 'watering_thanks'
  | 'care_pruning'
  | 'care_fertilizing'
  | 'care_repotting'
  | 'care_moved';

export type ReactionKind = Extract<
  MessageIntent,
  'watering_relief' | 'watering_enough' | 'watering_gentle_ack' | 'watering_thanks' | 'care_pruning' | 'care_fertilizing' | 'care_repotting' | 'care_moved'
>;

// How strongly a state is felt: grows with severity and observed duration, never jumps straight to max.
export type IntensityTier = 'mild' | 'moderate' | 'strong';

// Recovery has its own progression: first relief, then perking up, then settling back to normal.
export type RecoveryStage = 'relief' | 'perking' | 'settling';

export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';

// One-off contextual lines tied to the time of day, spoken at most once per day.
export type DayLine =
  | 'morning_calm'
  | 'morning_dewy' // a calm night in near-saturated air (high humidity at night)
  | 'morning_after_stress'
  | 'evening_after_heat'
  | 'evening_after_stress'
  // The first days of a season: said once per season
  | 'season_spring'
  | 'season_summer'
  | 'season_autumn'
  | 'season_winter'
  // Outside weather in contrast with the calm inside (the tree is in a greenhouse): once a day each
  | 'weather_rain'
  | 'weather_storm'
  | 'weather_fog'
  | 'weather_snow'
  | 'weather_cold_outside'
  | 'weather_hazy'
  | 'weather_pressure_falling'
  // The sun's real moments (perception.sun times): once a day each, when calm
  | 'sunrise_greeting'
  | 'sunset_line'
  // The weekly hike (behaviour/hike.ts): a pick is said once (again when the forecast moves it), the day once
  | 'hike_picked'
  | 'hike_moved'
  | 'hike_chosen'
  | 'hike_today';

// Lines about recent care, spoken at most once a day while the context lasts.
export type CareLine = 'settling_in' | 'new_spot' | 'new_shape';

// Gentle relationship observations, by id (wording in messages.ts). Spoken once per episode.
export type ObservationId = 'thirsty_since_yesterday' | 'lots_of_water_today' | 'usually_notices_thirst' | 'typical_recovery';

// How the season changes the meaning of a care action (diffraction: same action, different time of year).
export type SeasonalCare =
  | 'resting_drink' // watered during winter rest: drinks slowly
  | 'growing_drink' // a relieving drink in the summer growing season
  | 'resting_wet' // too much water while resting: it stays wet longer
  | 'growing_prune' // pruned during the spring flush or summer growth: regrows fast
  | 'resting_prune' // pruned while growth is slowing or resting: slow to regrow
  | 'in_season_feed'
  | 'off_season_feed' // fed while it isn't growing
  | 'growing_repot' // repotted while growing: roots settle sooner
  | 'resting_repot';

// The tree's response to something the human just did.
export interface CareReaction {
  kind: ReactionKind;
  seasonal: SeasonalCare | null;
  eventId: number;
  eventType: PlantEventType;
  at: number; // when the care happened
  why: string; // e.g. "watered while thirsty (soil 28% → 71%)"
}

// Gentle, non-judgmental facts about the care relationship.
export interface RelationshipContext {
  lastCareAt: number | null;
  hoursSinceCare: number | null;
  thirstEpisodes30d: number;
  thirstAnsweredWithin6h: number;
  typicalThirstHoursBeforeWatering: number | null; // median
  usuallyNoticesThirst: boolean;
  wateringsToday: number;
  overwateringEvents7d: number; // waterings while the soil was already wet
  typicalRecoveryHours: number | null; // median length of recovering episodes
  observation: { id: ObservationId; hours?: number } | null; // at most one gentle observation
  // Attention (petting the on-screen tree). Not care: excluded from lastCareAt/hoursSinceCare and never
  // read by mood, energy or responsiveness. Not voiced. `familiarity` (0-1, from days with petting) only
  // warms the calm touch answers in the Expression Engine.
  attention: { petSessions7d: number; lastPetAt: number | null; familiarity: number };
}

// Visitors (evidence class "art"; see behaviour/habitat.ts). Never read by health, mood, energy or speech.
export type VisitSpot = 'left_branch' | 'right_branch' | 'crown' | 'trunk' | 'pot_rim'; // visits start on the first three; play uses all
export interface HabitatVisit {
  kind: 'squirrel';
  id: string; // day:slot (or care:<event id>, drey:<day>), stable across refreshes
  startedAt: number;
  endsAt: number;
  spot: VisitSpot;
  carrying: 'nut' | null; // autumn caching
  cause: 'slot' | 'care' | 'drey'; // a visit of the day, an answer to care, or asleep in its drey
  action: 'drinking' | 'inspecting' | 'shake_off' | null; // after a watering, after a pruning, after rain
}
// The drey: weeks of a welcoming tree become a nest in the crown (art: accumulated care made visible)
export interface DreyState {
  value: number; // 0-1, rises over ~2 weeks of welcoming time, falls over days when not welcoming
  stage: 'none' | 'started' | 'built'; // with hysteresis
  builtAt: number | null; // when it last became built
}
// The dragonfly: the habitat's second wanderer (the air over hours, not the tree's history)
export type DragonflyPerch = 'left_tip' | 'right_tip' | 'crown_tip' | 'left_top' | 'on_sloth'; // on_sloth: only from an encounter
// One stop of its route: it arrives at `at` (having flown in during the flight time before) and stays
// until it leaves for the next stop. Perched on a tip, or hovering by it.
export interface DragonflyStop {
  at: number;
  perch: DragonflyPerch;
  mode: 'perched' | 'hovering';
}
export interface DragonflyState {
  value: number; // 0-1: how good the air has been lately (rises ~45 min, falls ~15 min)
  active: boolean; // latch (enter/exit) on value
  presence: 'none' | 'hovering' | 'perched';
  // perch: its home perch (it keeps coming back to it); route: where it goes during the visit
  visit: { id: string; startedAt: number; endsAt: number; perch: DragonflyPerch; style: 'perched' | 'hovering'; route: DragonflyStop[] } | null;
  visitsToday: { count: number; firstAt: number | null };
  insideTemp: number | null; // for its liveliness (wing tempo)
  why: string;
}

// The sloth: the third wanderer (warm, humid, still air; slow to come and go; stays the night)
export type SlothBranch = 'left_branch' | 'right_branch';
// How it holds on, from its comfort: all four when it has just arrived (or the air is marginal), relaxed
// grips (one arm, by the legs) after long warm, humid, still air. Asleep: always curled in all four.
export type SlothGrip = 'four' | 'arms' | 'legs' | 'one_arm' | 'two_legs_one_arm';
// The sloth's loyalty to the tree, from its last days (derived from the stored readings, art)
export interface SlothMemory {
  loyalty: number; // 0-1
  homeBranch: SlothBranch | null;
  daysWithIt: number; // days in the window it spent time in the tree
}
export interface SlothState {
  value: number; // 0-1: how warm, humid and still the air has been lately (rises ~90 min, falls ~60 min)
  active: boolean;
  presence: 'none' | 'hanging' | 'climbing' | 'sleeping';
  visit: { id: string; startedAt: number; endsAt: number; branch: SlothBranch; pose: 'hanging' | 'climbing' | 'sleeping'; grip: SlothGrip } | null;
  visitsToday: { count: number; firstAt: number | null; minutes: number };
  insideTemp: number | null;
  memory: SlothMemory;
  why: string;
}

// Lucy: the household's Coton de Tuléar, a permanent companion by the pot (not a wild visitor). She comes by
// 4–6 times a day on her household's clock, sleeps most nights on her pillow, takes her mood from the
// outside weather, stays close when the tree struggles, and goes along on hike day. Art + context.
// Floor spots from left to right: her pillow, the floor beside it, by the stand's left leg (close to the tree),
// in front of the pot, toward its right, and right of the stand (left alone on hike day: the boots are there)
export type LucySpot = 'pillow' | 'floor_left' | 'by_pot' | 'pot_front' | 'pot_right' | 'floor_right';
// One stop of her visit: from `at` she is at `spot` doing `act`, looking at `look` (the avatar walks her between
// stops on the clock, slowly while sniffing). Planned per visit, deterministic.
export interface LucyStop {
  at: number;
  spot: LucySpot;
  act: 'sniff' | 'stand' | 'sit' | 'down' | 'sleep';
  look: 'user' | 'tree' | 'around';
}
export type LucyPose = 'walking' | 'sitting' | 'down' | 'sleeping';
export type LucyCue = 'shake_off' | 'panting' | 'concern' | 'tired' | 'storm';
export type LucyVisitKind = 'day' | 'night' | 'check' | 'storm' | 'after_hike';
// The outside weather as she lives it: latches with enter/exit thresholds and durations (hysteresis)
export interface LucyWeather {
  heat: boolean;
  cold: boolean;
  storm: boolean;
  rain: boolean;
  fineDay: boolean;
}
export interface LucyVisit {
  id: string;
  kind: LucyVisitKind;
  startedAt: number;
  endsAt: number;
  spot: LucySpot; // where she is right now (from her route)
  rest: LucySpot; // where she settles to lie down and sleep
  pose: LucyPose; // right now: walking (sniffing, standing about), sitting, down or asleep
  route: LucyStop[];
  phaseEndsAt: number; // when the current pose gives way to the next
  cue: LucyCue | null;
  settle: number; // 0-1: how ready to settle she was when she came (weather and the time of day)
}
export interface LucyState {
  presence: 'none' | 'away_hiking' | LucyPose;
  visit: LucyVisit | null;
  weather: LucyWeather; // the latches now
  visitsToday: { count: number; firstAt: number | null; minutes: number }; // planned visits begun today
  why: string; // developer panel
}

// Two visitors in the tree at the same time (art): the squirrel peeks at the sloth, the squirrel watches the
// dragonfly, the dragonfly rests on the sloth
export type HabitatEncounter = 'squirrel_sloth' | 'squirrel_dragonfly' | 'dragonfly_sloth';

// Mood as its own slow layer (behaviour/mood.ts, art): anchored by health, nudged by the environment,
// petting and care, the visitors and the outside weather, drifting with inertia
export interface MoodMemory {
  valence: number;
  arousal: number;
  label: Mood;
  at: number;
}
export interface MoodInfluence {
  source: 'health' | 'environment' | 'petting' | 'care' | 'visitors' | 'weather';
  v: number; // valence contribution
  a: number; // arousal contribution
  why: string;
}
export interface MoodState {
  label: Mood;
  valence: number; // -1 unpleasant … 1 pleasant (where it is now, after drifting)
  arousal: number; // 0 still … 1 lively
  target: { valence: number; arousal: number }; // where it is drifting to
  base: Mood; // the health anchor
  ceiling: number; // the highest valence health allows right now
  forced: boolean; // an event mood (confused, sleepy, a care reaction)
  influences: MoodInfluence[];
  memory: MoodMemory; // persisted by the collector
}

// The squirrel as an individual: how far it trusts the place, and the habits it formed (derived, art)
export type SquirrelStage = 'none' | 'traces' | 'peeking' | 'visiting' | 'settled';
export type SquirrelTraces = 'nibbled_leaf' | 'tail_at_pot';
export interface SquirrelMemory {
  trust: number; // 0-1: grows with welcoming time, cut when the place stops being welcoming
  stage: SquirrelStage; // with hysteresis
  brokenAt: number | null; // when trust last broke (the latch flipped off): it comes back warily
  usualHour: number | null; // the hour it tends to come (from its past visits), null = no habit yet
  favouriteSpot: VisitSpot | null;
  boldness: number; // 0-1, from trust and play: only how it plays
  pastVisits: number; // visits it remembers (the last weeks)
}

export interface HabitatState {
  value: number; // 0-1: how welcoming the tree has been (slow to rise, quick to fall)
  welcoming: boolean; // latch (enter/exit) on value: do visitors come at all
  // right now: out on a branch, a first-days peek from the leaves, tucked into the leaves, asleep in the drey
  presence: 'none' | 'visiting' | 'peeking' | 'hiding' | 'sleeping';
  traces: SquirrelTraces | null; // not here yet, but signs of it (stage traces)
  memory: SquirrelMemory;
  visit: HabitatVisit | null;
  drey: DreyState;
  visitsToday: { count: number; firstAt: number | null }; // squirrel visits so far today (for its thoughts)
  dragonfly?: DragonflyState; // the second wanderer (set by the behaviour engine)
  sloth?: SlothState; // the third wanderer
  lucy?: LucyState; // the household dog by the pot (not a wanderer: she lives here)
  encounters?: HabitatEncounter[]; // visitors in the tree together right now (behaviour/encounters.ts)
  calmHours14d: number; // observed hours that raised it
  stressHours14d: number; // observed hours that lowered it
  lastChangeAt: number | null; // when the latch last flipped
  why: string; // developer panel
}

// The tree's thoughts through a calm day, each grounded in today's data (wording in messages.ts by id)
export type MusingId =
  | 'soil_steady' // soil comfortable; facts: soil, hoursToThirsty (-1 = barely drying)
  | 'days_since_water' // days
  | 'brightest_hour' // peak (%)
  | 'good_light_day' // usefulHours
  | 'days_shorter' // minPerDay, daylight
  | 'days_longer'
  | 'humid_morning' // rh, fog (1 = the glass may fog)
  | 'warmest_hour' // temp
  | 'warmer_than_outside' // inside, outside
  | 'squirrel_came' // count, firstAt
  | 'dragonfly_came' // count, firstAt
  | 'sloth_came' // count, minutes
  | 'lucy_here' // count: Lucy lying by the pot right now (her visit of the day)
  | 'visitors_met' // pair (index in ENCOUNTER_PAIRS: 0 squirrel+sloth, 1 squirrel+dragonfly, 2 dragonfly+sloth)
  | 'new_tips' // fullness
  | 'drey_growing'
  | 'light_now' // light (%): useful light on the leaves right now
  | 'evening_cooling' // from, to (°C): cooler than two hours ago
  | 'cool_morning' // temp: a cool morning, still in range
  | 'air_gentle' // rh, vpd: humidity and VPD in their optimal ranges
  | 'settled_after_drink'; // soil, hours: back in range some hours after a watering
export interface Musing {
  id: MusingId;
  facts: Record<string, number>;
  weight: number; // how much it matters today (higher first)
}
// How much the tree has to say today, and what is true right now
export interface VoiceState {
  budget: number; // thoughts for the day (0 = not musing now)
  gapMs: number; // at least this long between two thoughts (spreads them over the daylight)
  musings: Musing[]; // candidates, most relevant first
  why: string; // developer panel
}

// The canopy over the last weeks (inference, drawn only): never read by health, mood or the habitat
export interface CanopyState {
  fullness: number; // 0.6-1: share of the foliage showing
  refilling: number; // 0-1: share of the gap coming back as fresh tips
  trend: 'thinning' | 'refilling' | 'steady';
  reasons: string[]; // developer panel
}

export interface Concern {
  metric: 'soil' | 'temperature' | 'humidity' | 'light';
  status: string; // the metric's status label, e.g. "Waterlogged"
}

export interface PlantBehaviourState {
  primaryState: HealthCondition;
  modifiers: HealthModifier[];
  previousState: HealthCondition | null;
  episode: { id: number | null; condition: HealthCondition; startedAt: number; minutes: number };
  mood: Mood; // the label (from moodState)
  moodState: MoodState; // the mood as its own layer: valence/arousal, anchor, nudges (behaviour/mood.ts)
  energy: number; // 0-1 → movement: sway speed/amount, blinking, leaf flutter
  responsiveness: number; // 0-1 → how strongly reactions to care and touch show (never biology)
  expressionIntensity: number; // 0-1 → droop, wilt, how much the state shows
  intensityTier: IntensityTier;
  recoveryStage: RecoveryStage | null;
  afterglow: boolean; // comfortable, but a stress ended recently: still a little subdued
  timeOfDay: TimeOfDay;
  season: {
    id: Season;
    key: string;
    stage: 'early' | 'mid' | 'late';
    growth: SeasonRule['growth'];
    daylightTrend: 'lengthening' | 'shortening';
    blend: { with: Season; amount: number } | null; // the neighbouring season, felt near a boundary
    energy: number; // seasonal energy factor, blended across boundaries
    cycle: { newGrowth: number; yellowing: number; leafDrop: number }; // 0-1, where the tree is in its year
  };
  dayLine: DayLine | null; // a time-of-day line that fits right now (speech policy decides if it's said)
  careLine: CareLine | null; // a line about recent care that fits right now (once a day)
  care: {
    settling: number; // 0-1 repotted recently: quieter, minor stress not dramatised
    calm: number; // 0-1 pruned recently: gentler movement
    relearningLight: boolean; // moved recently: the new spot's light is still being learned
    effects: string[]; // how recent care shaped this behaviour (developer panel)
  };
  messageIntent: MessageIntent;
  reaction: CareReaction | null;
  concern: Concern | null;
  relationship: RelationshipContext;
  habitat: HabitatState; // visitors: expressive only, nothing above reads it
  canopy: CanopyState; // the foliage over the last weeks: expressive only, nothing above reads it
  voice: VoiceState; // the day's thoughts (the speech policy decides when one is said)
  // Where the day is relative to the real sunrise / sunset (null outside their windows)
  twilight: { event: 'sunrise' | 'sunset' | null; minutes: number | null };
  hike?: HikePlan; // the week's hike pick (about the people, nothing reads it back; absent without a forecast)
  reasons: string[]; // why the engine chose this behaviour (developer panel)
  evaluatedAt: number;
}
