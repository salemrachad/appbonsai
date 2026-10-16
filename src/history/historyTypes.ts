import type { HealthCondition, Severity } from '../health/healthTypes';

// Shapes shared by the local server (SQLite) and the frontend.
// All timestamps are milliseconds since the Unix epoch (UTC).

export type PlantEventType = 'watering' | 'pruning' | 'fertilizing' | 'repotting' | 'moved_location' | 'manual_note';
export const PLANT_EVENT_TYPES: PlantEventType[] = ['watering', 'pruning', 'fertilizing', 'repotting', 'moved_location', 'manual_note'];

export interface WateringMetadata {
  source: 'sensor' | 'manual';
  moistureBefore: number | null;
  moistureAfter: number | null;
  conditionBefore: HealthCondition | null; // health condition just before the watering
  // Detection evidence (sensor waterings; added to a manual one when the sensor confirms it)
  rawBefore?: number | null;
  rawAfter?: number | null;
  accumulatedRise?: number;
  risingReadings?: number;
  confirmationReadings?: number;
  detectionMethod?: 'single_jump' | 'accumulated_rise';
  detectedAt?: number;
  confirmedBySensor?: boolean;
  confirmedByUser?: boolean;
}

// Care memory: something that happened to the physical tree.
export interface PlantEvent {
  id: number;
  timestamp: number;
  type: PlantEventType;
  note: string | null;
  metadata: Partial<WateringMetadata> & Record<string, unknown>;
}

// Attention memory: a moment someone spent with the DIGITAL tree. Not care, not biology: nothing here
// ever reaches health, vitality or the care context. Stored as sessions, never as pointer movements.
// V1 records only petting; the table is shaped so visits and other interactions fit later.
export type InteractionKind = 'pet';
export const INTERACTION_KINDS: InteractionKind[] = ['pet'];

export interface Interaction {
  id: number;
  kind: InteractionKind;
  startedAt: number;
  endedAt: number;
  count: number; // pet: strokes in the session
  metadata: Record<string, unknown>; // pet: { activeMs }
}

// One meaningful stretch of the tree's life: a primary condition from start to end.
export interface BehaviourEpisode {
  id: number;
  startedAt: number;
  endedAt: number | null; // null = still going
  lastSeenAt: number; // last evaluation that confirmed it (episodes close at this time after a long gap)
  unobservedMs: number; // time inside the episode without trustworthy data (sensor/server away)
  condition: HealthCondition;
  modifiers: HealthCondition[]; // every secondary condition seen during the episode
  peakSeverity: Severity;
  engineVersion: string;
}

// One stored observation, exactly as measured (the permanent truth).
export interface TelemetryRecord {
  id: number;
  timestamp: number;
  source: 'esp32_sensor' | 'weather_estimate';
  deviceId: string | null;
  soilMoisture: number | null; // % the app used (firmware value, or app-converted raw)
  apiSoilMoisture: number | null; // firmware soil_moisture as received
  soilRaw: number | null;
  temperature: number | null;
  humidity: number | null;
  lightPercent: number | null; // relative LDR %, never lux
  lightRaw: number | null;
  radiation: number | null; // weather mode W/m²
  wifiRssi: number | null;
  dataQuality: string | null;
}

export interface HourlyBucket {
  hourStart: number;
  samples: number;
  avgSoil: number | null;
  minSoil: number | null;
  avgTemp: number | null;
  avgHumidity: number | null;
  avgLight: number | null; // % (sensor) or W/m² (weather)
}

export interface DailySummary {
  date: string; // YYYY-MM-DD (local)
  dayLabel: string;
  samples: number;
  avgSoil: number | null;
  minSoil: number | null;
  avgTemp: number | null;
  avgHumidity: number | null;
  avgLight: number | null; // % (sensor) or W/m² (weather), all hours
  stressHours: number; // hours in stress episodes
  waterings: number;
}

// A line in the plant diary.
export interface DiaryItem {
  at: number;
  kind: 'episode_start' | 'episode_gap' | 'event' | 'weather' | 'habitat'; // weather: outside, context only; habitat: the squirrel
  title: string;
  detail?: string;
  condition?: HealthCondition;
  eventType?: PlantEventType;
  weather?: WeatherSpellKind;
  habitat?: 'visit' | 'returned' | 'left' | 'drey_built' | 'drey_gone' | 'dragonfly' | 'sloth' | 'encounter';
}

// A notable stretch of outside weather (the tree is in a greenhouse: context, never the tree's state).
export type WeatherSpellKind = 'rain' | 'storm' | 'snow' | 'fog' | 'frost';
