import { ACTIVE_SPECIES } from '../species';
import { TreeSettings } from '../settings/settings';

export interface RawEnvironmentContext {
  airTemperature: number;
  humidity: number;
  vpd: number;
  shortwaveRadiation: number;
  et0: number;
  precipitation: number;
  rawSoilMoisture?: number; // Open-Meteo 0-1 scale e.g. 0.28 m³/m³
}

export function calculateEstimatedPotMoisture(
  env: RawEnvironmentContext,
  settings: TreeSettings,
  nowTimestamp: number = Date.now()
): number {
  const { potMoistureModel } = ACTIVE_SPECIES;
  const hoursSinceWatering = Math.max(0, (nowTimestamp - settings.lastWateredTimestamp) / (1000 * 60 * 60));

  // Drainage factor based on user soil mix
  const drainageMult = potMoistureModel.drainageFactors[settings.drainageRate] || 1.0;

  // Hourly dry rate calculation based on physics
  // High VPD (> 1.2 kPa), High Temp (> 25°C), High Sun (> 300 W/m²) increase drying
  const vpdFactor = 1 + Math.max(0, env.vpd - 0.8) * potMoistureModel.vpdMultiplier;
  const tempFactor = 1 + Math.max(0, env.airTemperature - 20) * potMoistureModel.tempMultiplier;
  const solarFactor = 1 + Math.min(1.5, env.shortwaveRadiation * potMoistureModel.solarMultiplier);
  const et0Factor = env.et0 > 0 ? 1 + (env.et0 / 5) * 0.3 : 1.0;

  const dynamicDryingRatePerHour = potMoistureModel.baselineDryingRatePerHour * drainageMult * vpdFactor * tempFactor * solarFactor * et0Factor;

  // Non-linear drying curve: dries quicker at first (free water drainage), then slower as moisture binds to akadama/soil particles
  // Moisture = Base - (Rate * hours^0.88)
  const moistureLoss = dynamicDryingRatePerHour * Math.pow(hoursSinceWatering, 0.91);
  let estimatedMoisture = potMoistureModel.baseWateringSaturation - moistureLoss;

  // Rain addition if bonsai is exposed to rain
  if (settings.rainReachesBonsai && env.precipitation > 0) {
    const rainBoost = Math.min(40, env.precipitation * 6);
    estimatedMoisture += rainBoost;
  }

  // Slight blend with ambient soil moisture to anchor with real regional climate conditions (15% weight)
  if (typeof env.rawSoilMoisture === 'number' && !isNaN(env.rawSoilMoisture)) {
    // Open-Meteo volumetric soil moisture usually 0.10 to 0.45 m³/m³ -> map to 20%-85%
    const regionalMoisturePct = Math.min(90, Math.max(15, env.rawSoilMoisture * 200));
    estimatedMoisture = estimatedMoisture * 0.82 + regionalMoisturePct * 0.18;
  }

  // Apply calibration offset
  estimatedMoisture += (settings.calibrationOffset || 0);

  // Clamp within reasonable physical bounds
  return Math.round(Math.min(96, Math.max(12, estimatedMoisture)));
}
