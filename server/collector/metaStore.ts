import type { MoodMemory } from '../../src/behaviour/behaviourTypes';
import type { HikeMemory } from '../../src/behaviour/hike';
import type { MessageMemory } from '../../src/behaviour/speech';
import type { HealthMemory } from '../../src/health/HealthEngine';
import type { TreeSettings } from '../../src/settings/settings';
import type { SensorCalibration } from '../../src/telemetry/calibration';
import type { TelemetrySource } from '../../src/telemetry/types';
import type { AppDatabase } from '../database';

// The health memory as saved: only usable again for the same engine version and data source
export interface SavedMemory {
  engineVersion: string;
  source: TelemetrySource;
  memory: HealthMemory;
}

// Everything the collector keeps in the `meta` table, by key. One place for the names and their shapes.
export interface MetaValues {
  collector_settings: TreeSettings;
  calibration: SensorCalibration;
  health_memory: SavedMemory;
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
