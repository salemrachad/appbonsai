import type { HealthCondition, HealthModifier } from '../health/healthTypes';
import type { PlantEventType } from '../history/historyTypes';
import type { Season } from '../perception/season';
import type { SeasonRule } from '../species/types';

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
  | 'morning_after_stress'
  | 'evening_after_heat'
  | 'evening_after_stress'
  // The first days of a season: said once per season
  | 'season_spring'
  | 'season_summer'
  | 'season_autumn'
  | 'season_winter';

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
  mood: Mood;
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
  reasons: string[]; // why the engine chose this behaviour (developer panel)
  evaluatedAt: number;
}
