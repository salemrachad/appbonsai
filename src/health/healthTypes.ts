import type { LatchId } from '../species';
import type { DataConfidence } from '../telemetry/dataQuality';
import type { LeafHealth } from './leaves';

export type HealthCondition =
  | 'thriving'
  | 'comfortable'
  | 'thirsty'
  | 'very_dry'
  | 'too_wet'
  | 'hot'
  | 'hot_and_dry'
  | 'cold'
  | 'freezing_risk'
  | 'too_dark'
  | 'very_bright'
  | 'dry_air'
  | 'high_humidity'
  | 'recovering'
  | 'sleeping'
  | 'multiple_stress'
  | 'sensor_uncertain';

// Secondary conditions that are active alongside the primary one.
export type HealthModifier = HealthCondition;

export type Severity = 'none' | 'mild' | 'moderate' | 'critical';

export type QualitativeState = 'Thriving' | 'Happy' | 'Okay' | 'Stressed' | 'Critical';

export type MetricId = 'soil' | 'light' | 'temperature' | 'humidity' | 'vpd';
export type MetricTone = 'good' | 'info' | 'caution' | 'alert' | 'off';

// How one measurement compares with what the species likes. Display-ready.
export interface MetricAssessment {
  id: MetricId;
  name: string;
  value: number | null; // in the displayed unit
  display: string; // e.g. "62%", "24.3°C", "Sensor not connected"
  unit?: string;
  status: string; // e.g. "Good", "Thirsty", "Very Bright"
  tone: MetricTone;
  idealRange: string;
  estimated: boolean;
  guide?: MetricGuide; // explanation of the best conditions and ranges (tooltips)
}

// What a sensor's value means for the tree, from the species profile. Display-ready.
export interface MetricGuide {
  title: string;
  best: string; // e.g. "45–80%"
  bands: { label: string; range: string; tone: MetricTone; current: boolean }[];
  notes: string[];
}

export type ScoreId = 'moisture' | 'temperature' | 'humidity' | 'light' | 'stability';

// 0-100 health score per aspect; null = neutral / not measured (left out of vitality).
export type HealthScores = Record<ScoreId, number | null>;

export interface ScoreComponent {
  id: ScoreId;
  label: string;
  score: number | null;
  weight: number;
  note: string; // e.g. "62% soil, optimal 45–80%" or "neutral — nighttime"
}

export interface PenaltyItem {
  label: string;
  points: number; // subtracted from vitality
  detail: string;
}

// Every step of the vitality calculation, for the developer Health Debug panel.
export interface VitalityBreakdown {
  components: ScoreComponent[];
  weightedBase: number;
  durationPenalties: PenaltyItem[];
  combinedMultiplier: number;
  combinedExtra: number;
  recoveryModifier: number;
  target: number; // where vitality is heading with today's conditions
  previous: number | null;
  smoothing: { tauHours: number; minutes: number; alpha: number } | null;
  final: number;
  frozen: boolean; // no fresh data: vitality kept as it was
  leafDropModifier?: number; // points off for leaf drop seen in the daily photos (absent without)
}

export interface LatchDebug {
  id: LatchId | 'data_uncertain';
  active: boolean;
  since: number | null; // active since
  pendingSince: number | null; // crossing the threshold since (not yet long enough)
  observedMinutes: number | null; // time active while observed
  value: number | null; // value the latch looked at
  rule: string; // "enter < 35 for 30 min · exit ≥ 40 for 5 min"
  gated: string | null; // why it is not evaluated right now (e.g. "night")
}

// Whether the tree is being observed right now (see the gap policy in appConfig.continuity).
export interface ObservationStatus {
  status: 'live' | 'unobserved' | 'unknown'; // live data · brief outage (state held) · uncertain for long
  lastLiveAt: number | null; // last fresh, trustworthy reading
  unobservedMinutes: number; // how long since then (0 when live)
  unobservedDeltaMs: number; // time since the previous evaluation that was NOT observed (for episodes)
}

// Durations below count observed time only: unobserved gaps are not confirmed stress.
export interface StressSummary {
  dryHours: number; // thirsty/very_dry latched this long
  wetHours: number;
  lowLightHours: number;
  hoursSinceWatering: number | null;
  recoveringFrom: HealthCondition | null;
  recoveringForHours: number | null;
  recoveryRemainingHours: number | null;
}

// The pot's usual moisture–VPD coupling, learned from live, confident dry-down segments (HealthMemory).
export interface CouplingMemory {
  baseline: number | null; // %/h per kPa, exponential average (~7 days)
  hours: number; // hours of confident segments it has learned from
  firstAt: number | null;
  updatedAt: number | null;
}

// Health's reading of the derived environmental metrics (see health/environment.ts).
export interface HealthEnvironment {
  // DIAGNOSTIC ONLY: never part of vitality, conditions, mood or expression until validated
  coupling: {
    current: number | null; // %/h per kPa of the current dry-down
    baseline: number | null;
    baselineHours: number;
    ratio: number | null; // current / baseline
    status: 'unavailable' | 'learning' | 'typical' | 'slower' | 'faster';
    note: string | null; // shown in the soil card's notes
  };
  // What the decayed exposure costs the existing temperature score (null without enough data)
  temperatureExposure: { heatDegreeHours: number; coldDegreeHours: number; penalty: number } | null;
}

export interface PlantHealthState {
  condition: HealthCondition;
  modifiers: HealthModifier[];
  vitality: number; // 0-100, accumulated wellbeing (changes gradually)
  qualitative: QualitativeState;
  severity: Severity;
  scores: HealthScores;
  confidence: DataConfidence;
  confidenceScore: number; // 0-1
  dataIssues: string[];
  metrics: MetricAssessment[];
  environment?: HealthEnvironment; // derived metrics as Health reads them (coupling: diagnostic only)
  leaves?: LeafHealth; // what the daily photos show (shedding: a fading vitality dip); absent without photos
  stress: StressSummary;
  activeSince: Partial<Record<HealthCondition, number>>; // when each active condition started
  observation: ObservationStatus;
  breakdown: VitalityBreakdown;
  hysteresis: LatchDebug[];
  evaluatedAt: number;
  isOverride: boolean; // true when a developer test preset is shown instead of live health
}
