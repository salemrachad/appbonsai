import { APP_CONFIG } from '../../src/config/appConfig';
import type { HealthCondition } from '../../src/health/healthTypes';
import type { PlantEvent, PlantEventType, WateringMetadata } from '../../src/history/historyTypes';
import type { AppDatabase } from '../database';

// A care event logged by hand. A watering near one the sensor already saw (or one logged twice) is
// merged, never counted twice. `now`: what the tree was like just before (stored with the event).
// Returns the event, and wateredAt when it is a new watering (the settings remember the last one).
export function logCareEvent(
  db: AppDatabase,
  e: { type: PlantEventType; note: string | null; timestamp: number },
  now: { soilMoisture: number | null; condition: HealthCondition | null }
): { event: PlantEvent | null; wateredAt: number | null } {
  const { type, note, timestamp } = e;
  if (type !== 'watering') {
    return { event: db.insertEvent({ timestamp, type, note, metadata: { conditionAtTime: now.condition } }), wateredAt: null };
  }
  const mergeMs = APP_CONFIG.watering.manualMergeMinutes * 60 * 1000;
  const nearby = db.eventsSince(timestamp - mergeMs).filter((x) => x.type === 'watering' && Math.abs(x.timestamp - timestamp) <= mergeMs);
  const sensor = nearby.find((x) => x.metadata.source === 'sensor');
  const manual = nearby.find((x) => x.metadata.source === 'manual');
  if (sensor) {
    // The sensor already saw this watering: add the note instead of logging it twice
    db.updateEvent(sensor.id, [sensor.note, note].filter(Boolean).join(' · ') || 'Confirmed by you', { ...sensor.metadata, confirmedByUser: true });
    return { event: db.getEvent(sensor.id), wateredAt: null };
  }
  if (manual) {
    // Logged twice by hand: keep one
    if (note) db.updateEvent(manual.id, [manual.note, note].filter(Boolean).join(' · '), manual.metadata);
    return { event: db.getEvent(manual.id), wateredAt: null };
  }
  const metadata: WateringMetadata = { source: 'manual', moistureBefore: now.soilMoisture, moistureAfter: null, conditionBefore: now.condition };
  return { event: db.insertEvent({ timestamp, type, note, metadata }), wateredAt: timestamp };
}
