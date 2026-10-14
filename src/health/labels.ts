import { HealthCondition } from './healthTypes';

export const CONDITION_LABELS: Record<HealthCondition, string> = {
  thriving: 'Thriving',
  comfortable: 'Comfortable',
  thirsty: 'Thirsty',
  very_dry: 'Very dry',
  too_wet: 'Too wet',
  hot: 'Hot',
  hot_and_dry: 'Hot & dry',
  cold: 'Cold',
  freezing_risk: 'Freezing risk',
  too_dark: 'Too dark',
  very_bright: 'Very bright',
  dry_air: 'Dry air',
  high_humidity: 'High humidity',
  recovering: 'Recovering',
  sleeping: 'Sleeping',
  multiple_stress: 'Multiple stresses',
  sensor_uncertain: 'Sensor uncertain',
};
