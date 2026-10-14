import { HealthCondition, Severity } from './healthTypes';

// Highest first. The first active condition becomes the primary state; the rest stay as modifiers.
// Critical biological conditions come before cosmetic ones.
export const CONDITION_PRIORITY: HealthCondition[] = [
  'sensor_uncertain',
  'freezing_risk',
  'very_dry',
  'hot_and_dry',
  'too_wet',
  'multiple_stress',
  'hot',
  'cold',
  'thirsty',
  'sleeping',
  'recovering',
  'too_dark',
  'dry_air',
  'high_humidity',
  'very_bright',
  'thriving',
  'comfortable',
];

export const CONDITION_SEVERITY: Record<HealthCondition, Severity> = {
  freezing_risk: 'critical',
  very_dry: 'critical',
  hot_and_dry: 'critical',
  too_wet: 'moderate',
  multiple_stress: 'moderate',
  hot: 'moderate',
  cold: 'moderate',
  thirsty: 'moderate',
  too_dark: 'mild',
  dry_air: 'mild',
  high_humidity: 'mild',
  recovering: 'mild',
  sensor_uncertain: 'mild',
  very_bright: 'none', // not treated as harmful until light needs are calibrated
  sleeping: 'none',
  comfortable: 'none',
  thriving: 'none',
};

export const SEVERITY_RANK: Record<Severity, number> = { none: 0, mild: 1, moderate: 2, critical: 3 };

// Conditions that count towards "multiple_stress" and that the tree recovers from.
export const STRESS_CONDITIONS: HealthCondition[] = [
  'freezing_risk',
  'very_dry',
  'hot_and_dry',
  'too_wet',
  'hot',
  'cold',
  'thirsty',
  'too_dark',
  'dry_air',
  'high_humidity',
];

// Summary conditions: never listed as modifiers (their parts already are).
export const COMBINED_CONDITIONS: HealthCondition[] = ['hot_and_dry', 'multiple_stress'];

// When a combined condition is primary, its parts are implied and not repeated as modifiers.
export const IMPLIED_BY: Partial<Record<HealthCondition, HealthCondition[]>> = {
  hot_and_dry: ['hot', 'thirsty', 'very_dry'],
  very_dry: ['thirsty'],
};

export function rankConditions(active: Iterable<HealthCondition>): HealthCondition[] {
  const set = new Set(active);
  return CONDITION_PRIORITY.filter((c) => set.has(c));
}
