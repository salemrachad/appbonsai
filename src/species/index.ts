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

// Where a root-zone temperature sits for this species (the soil temperature probe), with what it means.
export type RootBandId = 'very_cold' | 'cold' | 'cool' | 'ideal' | 'warm' | 'hot' | 'too_hot';
export interface RootBand {
  id: RootBandId;
  word: string; // "cool"
  tone: 'good' | 'info' | 'caution' | 'alert';
  meaning: string; // what it does to the roots, for the Why
}
export function rootTemperatureBand(species: SpeciesProfile, c: number): RootBand {
  const r = species.rootTemperature;
  if (c < r.minCritical) return { id: 'very_cold', word: 'very cold', tone: 'alert', meaning: 'cold enough to damage roots; keep the soil on the dry side and the pot off cold surfaces' };
  if (c < r.minWarning) return { id: 'cold', word: 'cold', tone: 'caution', meaning: 'the roots are stressed and barely drink, so wet soil stays wet and rot gets likelier: water sparingly' };
  if (c < r.minOptimal) return { id: 'cool', word: 'cool', tone: 'info', meaning: 'the roots take up water more slowly and growth slows, so the soil stays wet longer' };
  if (c <= r.maxOptimal) return { id: 'ideal', word: 'ideal', tone: 'good', meaning: 'just right: the roots take up water and grow well' };
  if (c <= r.maxWarning) return { id: 'warm', word: 'warm', tone: 'info', meaning: 'on the warm side: the soil dries faster' };
  if (c <= r.maxCritical) return { id: 'hot', word: 'hot', tone: 'caution', meaning: 'hot for roots (a pot in the sun?): they are stressed and the soil dries fast; shade the pot' };
  return { id: 'too_hot', word: 'too hot', tone: 'alert', meaning: 'hot enough to harm roots: shade or move the pot now' };
}
