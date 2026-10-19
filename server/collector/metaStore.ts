import type { CollectorStatus } from '../../src/api/types';
import type { MoodMemory, PlantBehaviourState, SlothMemory } from '../../src/behaviour/behaviourTypes';
import type { HikeMemory } from '../../src/behaviour/hike';
import type { MessageMemory } from '../../src/behaviour/speech';
import type { ExpressionState } from '../../src/expression/expressionTypes';
import type { HealthMemory } from '../../src/health/HealthEngine';
import type { PlantHealthState } from '../../src/health/healthTypes';
import type { PerceptionSample, PerceptionState } from '../../src/perception/perceptionTypes';
import type { TreeSettings } from '../../src/settings/settings';
import type { SensorCalibration } from '../../src/telemetry/calibration';
import type { PlantTelemetry, TelemetrySource } from '../../src/telemetry/types';
import type { AppDatabase } from '../database';
import type { SavedWatering } from './watering';

// The health memory as saved: only usable again for the same engine version and data source
export interface SavedMemory {
  engineVersion: string;
  source: TelemetrySource;
  memory: HealthMemory;
}

// The collector between two steps (a reading, a timer): what it would otherwise lose on a restart. On
// Cloudflare a Durable Object is unloaded between requests, so every wake-up is a restart. Usable again only
// for the same engine version, data source and calibration.
export interface SavedRuntime {
  engineVersion: string;
  source: TelemetrySource;
  calibration: string; // JSON of the calibration it was saved with
  status: Pick<CollectorStatus, 'lastPollAt' | 'lastSuccessAt' | 'lastError' | 'consecutiveFailures'>;
  evaluatedAt: number;
  // The last two readings as they arrived (a stored row lacks e.g. the HTS221 flag and the sensor issues)
  latest: PlantTelemetry | null;
  previous: PlantTelemetry | null;
  due:{ poll: number | null; weather: number | null; hike: number | null }; // when each timer is next due (null: not scheduled)
  watering: SavedWatering;
  sloth: { key: string; memory: SlothMemory; history?: { sloth: { from: number; to: number }[]; dragonfly: { from: number; to: number }[] } } | null; // the air visitors' day memory
}

// The last 24 h of samples, as they were after the last step: a Durable Object load reads
// this one row instead of a day of readings (rows read are billed). Usable only for the same source,
// calibration and location, and only when it ends at the newest stored reading.
export interface SavedRecent {
  key: string; // JSON of [source, calibration, location]
  lastTs: number | null; // the newest sample's time
  samples: PerceptionSample[]; // as they arrived (a load sorts them and keeps one per timestamp, as the table does)
}

// The last evaluation, as the API shows it (perception without its 24 h of samples and today's skies)
export interface SavedState {
  perception: PerceptionState;
  health: PlantHealthState;
  behaviour: PlantBehaviourState;
  expression: ExpressionState;
}

// Everything the collector keeps in the `meta` table, by key. One place for the names and their shapes.
export interface MetaValues {
  collector_settings: TreeSettings;
  calibration: SensorCalibration;
  health_memory: SavedMemory;
  collector_runtime: SavedRuntime;
  collector_state: SavedState;
  collector_recent: SavedRecent;
  message_memory: MessageMemory; // what the tree said and when (speech.ts)
  mood_memory: MoodMemory; // where the mood was: it drifts from there (behaviour/mood.ts)
  watering_detection_suppressed_until: number;
  hike_memory: HikeMemory; // the latest daily forecast and the week's hike picks (behaviour/hike.ts)
}

export class MetaStore {
  constructor(private db: AppDatabase) {}

  get<K extends keyof MetaValues>(key: K): MetaValues[K] | null {
    return this.db.getMeta<MetaValues[K]>(key);
  }

  set<K extends keyof MetaValues>(key: K, value: MetaValues[K]) {
    this.db.setMeta(key, value);
  }
}
