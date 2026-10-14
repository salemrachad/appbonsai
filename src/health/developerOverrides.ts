import { SpeciesProfile } from '../species';
import { HealthCondition, HealthModifier, PlantHealthState } from './healthTypes';
import { CONDITION_SEVERITY } from './statePriority';
import { qualitativeFor } from './vitality';

// Manual health previews for testing. Presentation only: never touches telemetry, the database,
// care events or episodes. Behaviour and expression are then derived from the overridden state.
export interface DevPreset {
  id: string;
  label: string;
  emoji: string;
  condition: HealthCondition;
  modifiers: HealthModifier[];
  vitality: number;
}

export const DEV_PRESETS: DevPreset[] = [
  { id: 'thriving', label: 'Thriving', emoji: '🌿', condition: 'thriving', modifiers: [], vitality: 96 },
  { id: 'comfortable', label: 'Comfortable', emoji: '🙂', condition: 'comfortable', modifiers: [], vitality: 82 },
  { id: 'thirsty', label: 'Thirsty', emoji: '💧', condition: 'thirsty', modifiers: [], vitality: 74 },
  { id: 'very_dry', label: 'Very dry', emoji: '🏜️', condition: 'very_dry', modifiers: [], vitality: 38 },
  { id: 'too_wet', label: 'Too wet', emoji: '🌧', condition: 'too_wet', modifiers: [], vitality: 58 },
  { id: 'hot', label: 'Hot', emoji: '☀️', condition: 'hot', modifiers: [], vitality: 70 },
  { id: 'hot_and_dry', label: 'Hot & dry', emoji: '🔥', condition: 'hot_and_dry', modifiers: [], vitality: 34 },
  { id: 'cold', label: 'Cold', emoji: '❄️', condition: 'cold', modifiers: [], vitality: 66 },
  { id: 'freezing_risk', label: 'Freezing', emoji: '🥶', condition: 'freezing_risk', modifiers: [], vitality: 28 },
  { id: 'too_dark', label: 'Too dark', emoji: '🌑', condition: 'too_dark', modifiers: [], vitality: 74 },
  { id: 'very_bright', label: 'Very bright', emoji: '😎', condition: 'very_bright', modifiers: [], vitality: 90 },
  { id: 'dry_air', label: 'Dry air', emoji: '🍂', condition: 'dry_air', modifiers: [], vitality: 80 },
  { id: 'high_humidity', label: 'Humid', emoji: '💨', condition: 'high_humidity', modifiers: [], vitality: 80 },
  { id: 'recovering', label: 'Recovering', emoji: '🌱', condition: 'recovering', modifiers: [], vitality: 70 },
  { id: 'sleeping', label: 'Sleeping', emoji: '🌙', condition: 'sleeping', modifiers: [], vitality: 85 },
  { id: 'multiple_stress', label: 'Multi-stress', emoji: '😟', condition: 'multiple_stress', modifiers: ['hot', 'dry_air', 'thirsty'], vitality: 45 },
  { id: 'sensor_uncertain', label: 'Unsure', emoji: '🤔', condition: 'sensor_uncertain', modifiers: [], vitality: 70 },
  { id: 'thirsty_hot_dryair', label: 'Thirsty + hot air', emoji: '🥵', condition: 'thirsty', modifiers: ['hot', 'dry_air', 'very_bright'], vitality: 60 },
  { id: 'sleeping_thirsty', label: 'Asleep, dry soil', emoji: '😴', condition: 'thirsty', modifiers: ['sleeping'], vitality: 68 },
];

// The live state with the preset's condition shown on top. Measured metrics and the
// live vitality calculation (breakdown) stay real and visible in the debug panel.
export function applyDeveloperOverride(live: PlantHealthState, preset: DevPreset, species: SpeciesProfile): PlantHealthState {
  return {
    ...live,
    condition: preset.condition,
    modifiers: preset.modifiers,
    vitality: preset.vitality,
    qualitative: qualitativeFor(preset.vitality, species),
    severity: CONDITION_SEVERITY[preset.condition],
    confidence: preset.condition === 'sensor_uncertain' ? 'low' : live.confidence,
    confidenceScore: preset.condition === 'sensor_uncertain' ? 0.3 : live.confidenceScore,
    stress: {
      ...live.stress,
      dryHours: ['thirsty', 'very_dry', 'hot_and_dry'].includes(preset.condition) ? 1.5 : 0,
      recoveringFrom: preset.condition === 'recovering' ? 'thirsty' : null,
      recoveringForHours: preset.condition === 'recovering' ? 1 : null,
      recoveryRemainingHours: preset.condition === 'recovering' ? 1 : null,
    },
    isOverride: true,
  };
}
