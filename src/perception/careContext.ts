import type { PlantEvent, PlantEventType } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';

// "What recently happened to the tree": structured, fading context from care events.
// Behaviour and health read these fields; nobody parses diary text.

const HOUR = 3600 * 1000;

export interface CareContextItem {
  type: PlantEventType;
  eventId: number;
  at: number;
  ageHours: number;
  windowHours: number; // how long this event stays part of the tree's context
  strength: number; // 1 right after, fading linearly to 0 at the end of the window
  note: string | null;
  metadata: PlantEvent['metadata'];
}

export interface CareContext {
  recentWatering: CareContextItem | null;
  recentPruning: CareContextItem | null;
  recentRepotting: CareContextItem | null;
  recentMove: CareContextItem | null;
  recentFertilizing: CareContextItem | null;
  // Derived phases (each with its own configurable window in the species profile)
  settling: number; // 0-1: repotted recently (fades over care.repotting.settlingDays)
  calm: number; // 0-1: pruned recently (fades over care.pruning.calmDays)
  relearningLight: boolean; // moved recently: light pattern of the new spot still being learned
  active: CareContextItem[]; // all events still inside their window, newest first
}

const WINDOW_DAYS: Record<PlantEventType, (s: SpeciesProfile) => number> = {
  watering: (s) => s.care.watering.contextDays,
  pruning: (s) => s.care.pruning.contextDays,
  repotting: (s) => s.care.repotting.contextDays,
  moved_location: (s) => s.care.moved_location.contextDays,
  fertilizing: (s) => s.care.fertilizing.contextDays,
  manual_note: () => 0,
};

const fade = (ageHours: number, windowHours: number) => (ageHours >= windowHours ? 0 : Math.round((1 - ageHours / windowHours) * 100) / 100);

export function computeCareContext(events: PlantEvent[], species: SpeciesProfile, now: number): CareContext {
  const items: CareContextItem[] = [];
  for (const e of [...events].sort((a, b) => b.timestamp - a.timestamp)) {
    if (e.timestamp > now) continue;
    const windowHours = WINDOW_DAYS[e.type](species) * 24;
    const ageHours = (now - e.timestamp) / HOUR;
    if (windowHours <= 0 || ageHours >= windowHours) continue;
    items.push({
      type: e.type,
      eventId: e.id,
      at: e.timestamp,
      ageHours: Math.round(ageHours * 10) / 10,
      windowHours,
      strength: fade(ageHours, windowHours),
      note: e.note,
      metadata: e.metadata,
    });
  }
  const latest = (t: PlantEventType) => items.find((i) => i.type === t) ?? null;
  const repot = latest('repotting');
  const prune = latest('pruning');
  const move = latest('moved_location');
  return {
    recentWatering: latest('watering'),
    recentPruning: prune,
    recentRepotting: repot,
    recentMove: move,
    recentFertilizing: latest('fertilizing'),
    settling: repot ? fade(repot.ageHours, species.care.repotting.settlingDays * 24) : 0,
    calm: prune ? fade(prune.ageHours, species.care.pruning.calmDays * 24) : 0,
    relearningLight: !!move && move.ageHours < species.care.moved_location.lightRelearnHours,
    active: items,
  };
}
