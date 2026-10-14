import { FICUS } from './ficus';
import { RelativeLightBand, SpeciesProfile } from './types';

export type { SpeciesProfile, ComfortRange, RelativeLightBand, RelativeLightId, LatchId, LatchRule } from './types';

// Only one species for now; settings.species is free text.
export const ACTIVE_SPECIES: SpeciesProfile = FICUS;

export function relativeLightBand(species: SpeciesProfile, percent: number): RelativeLightBand {
  const bands = species.relativeLight;
  return bands.find((b) => percent <= b.max) ?? bands[bands.length - 1];
}

// "26–60%" style range for one band, for display.
export function relativeLightRange(species: SpeciesProfile, id: RelativeLightBand['id']): string {
  const bands = species.relativeLight;
  const i = bands.findIndex((b) => b.id === id);
  const min = i <= 0 ? 0 : bands[i - 1].max + 1;
  return `${min}–${bands[i].max}%`;
}
