import type { PlantEvent } from '../history/historyTypes';
import type { SpeciesProfile } from '../species';
import { HOUR } from '../lib/time';

// Where the soil is in its wet-to-dry cycle (the owner's watering guidance, ficus.ts SOIL_SCALE): a ficus
// likes to be watered thoroughly, dry through its cycle, and be watered again once it reaches the watering
// window, never kept constantly saturated, never dried out. Read by the mood (it follows the cycle), the
// message (the window is a calm "ready"), and the Why. Health keeps its own latches (thirsty starts past the
// window).
export type SoilCyclePhase =
  | 'fresh' // watered in the last hours: a fresh drink in its roots
  | 'drying' // moist, drying as it should: wait to water
  | 'ready' // the watering window: the right moment
  | 'thirsty' // past the window
  | 'saturated'; // wetter than a fresh drink reads, with no drink to explain it

const FRESH_HOURS = 6;

export function soilCyclePhase(soil: number | null, species: SpeciesProfile, events: PlantEvent[], now: number): SoilCyclePhase | null {
  if (soil === null) return null;
  const s = species.soilMoisture;
  const watered = events.some((e) => e.type === 'watering' && e.timestamp <= now && now - e.timestamp < FRESH_HOURS * HOUR);
  if (soil < s.minOptimal) return 'thirsty';
  if (soil < species.soilCycle.readyBelow) return 'ready';
  if (watered) return 'fresh';
  if (soil > s.maxOptimal) return 'saturated';
  return 'drying';
}
