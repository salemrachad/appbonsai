import { TreeSettings } from '../settings/settings';
import { calculateVPD } from './telemetryNormalizer';
import { calculateEstimatedPotMoisture } from './weatherMoistureModel';
import { HourlyTelemetryPoint, ITelemetryProvider, PlantTelemetry, TelemetryFetchResult, TimelineEvent } from './types';
import { hhmm } from '../lib/time';

const round1 = (n: number) => Math.round(n * 10) / 10;

// Open-Meteo weather for the tree's location; soil moisture is modelled, not measured.
export class WeatherTelemetryProvider implements ITelemetryProvider {
  getName(): string {
    return 'Open-Meteo Weather Estimate';
  }

  async fetchTelemetry(settings: TreeSettings): Promise<TelemetryFetchResult> {
    const tz = encodeURIComponent(settings.timezone || 'UTC');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${settings.latitude}&longitude=${settings.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,soil_temperature_6cm,soil_moisture_1_to_3cm&hourly=temperature_2m,relative_humidity_2m,precipitation,vapour_pressure_deficit,shortwave_radiation,et0_fao_evapotranspiration,is_day&daily=sunrise,sunset&timezone=${tz}&forecast_days=2&past_days=1`;

    // No fallback data: if Open-Meteo is unreachable the caller shows "Offline".
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Open-Meteo responded with status ${response.status}`);
    const data = await response.json();

    const currentRaw = data.current || {};
    const hourlyRaw = data.hourly || {};
    const dailyRaw = data.daily || {};

    const temp: number | null = currentRaw.temperature_2m ?? null;
    const humidity: number | null = currentRaw.relative_humidity_2m ?? null;
    if (temp === null || humidity === null) throw new Error('Open-Meteo returned no current conditions');

    const isDay = currentRaw.is_day === 1;
    const precip = currentRaw.precipitation ?? 0;
    const rawSoilMoist = currentRaw.soil_moisture_1_to_3cm ?? undefined;

    // Current hour index in the hourly arrays (for radiation, VPD and ET0)
    const nowIso: string = currentRaw.time || new Date().toISOString();
    const times: string[] = Array.isArray(hourlyRaw.time) ? hourlyRaw.time : [];
    let hourIdx = times.findIndex((t) => t.startsWith(nowIso.slice(0, 13)));
    if (hourIdx === -1) hourIdx = Math.floor(times.length / 2);
    const at = (key: string, i: number) => (hourlyRaw[key] && hourlyRaw[key][i] != null ? hourlyRaw[key][i] : null);

    const radiation = at('shortwave_radiation', hourIdx) ?? 0;
    const vpd = at('vapour_pressure_deficit', hourIdx) ?? calculateVPD(temp, humidity);
    const et0 = at('et0_fao_evapotranspiration', hourIdx) ?? 0;

    const soilMoisture = calculateEstimatedPotMoisture(
      { airTemperature: temp, humidity, vpd, shortwaveRadiation: radiation, et0, precipitation: precip, rawSoilMoisture: rawSoilMoist },
      settings
    );

    const current: PlantTelemetry = {
      timestamp: Date.now(),
      source: 'weather_estimate',
      updatedAt: hhmm(new Date()),
      soilMoisture,
      temperature: round1(temp),
      humidity: Math.round(humidity),
      vpd: Math.round(vpd * 100) / 100,
      radiation: Math.round(radiation),
      lightPercent: null,
      isDay,
      soilTemperature: currentRaw.soil_temperature_6cm != null ? round1(currentRaw.soil_temperature_6cm) : null,
      precipitation: precip,
      weatherCode: currentRaw.weather_code ?? 0,
      et0,
      apparentTemperature: currentRaw.apparent_temperature != null ? round1(currentRaw.apparent_temperature) : undefined,
    };

    // 24 hourly points around now
    const hourly: HourlyTelemetryPoint[] = [];
    const start = Math.max(0, hourIdx - 8);
    for (let i = start; i < Math.min(times.length, start + 24); i++) {
      const d = new Date(times[i]);
      const hTemp = at('temperature_2m', i) ?? temp;
      const hHum = at('relative_humidity_2m', i) ?? humidity;
      const hLight = at('shortwave_radiation', i) ?? 0;
      const hVpd = at('vapour_pressure_deficit', i) ?? calculateVPD(hTemp, hHum);
      hourly.push({
        time: hhmm(d),
        hour: d.getHours(),
        timestamp: d.getTime(),
        temperature: round1(hTemp),
        humidity: Math.round(hHum),
        light: Math.round(hLight),
        soilMoisture: calculateEstimatedPotMoisture(
          {
            airTemperature: hTemp,
            humidity: hHum,
            vpd: hVpd,
            shortwaveRadiation: hLight,
            et0: at('et0_fao_evapotranspiration', i) ?? 0,
            precipitation: at('precipitation', i) ?? 0,
            rawSoilMoisture: rawSoilMoist,
          },
          settings,
          d.getTime()
        ),
        vpd: Math.round(hVpd * 100) / 100,
        isDay: at('is_day', i) != null ? at('is_day', i) === 1 : hLight > 10,
      });
    }

    return { current, hourly, timeline: buildTimeline(dailyRaw, nowIso, hourly) };
  }
}

// Today's rhythm from real sunrise/sunset and the hourly forecast.
function buildTimeline(dailyRaw: any, nowIso: string, hourly: HourlyTelemetryPoint[]): TimelineEvent[] {
  const days: string[] = Array.isArray(dailyRaw.time) ? dailyRaw.time : [];
  const today = Math.max(0, days.indexOf(nowIso.slice(0, 10)));
  const events: TimelineEvent[] = [];

  if (dailyRaw.sunrise?.[today]) {
    events.push({
      id: 'sunrise',
      time: hhmm(new Date(dailyRaw.sunrise[today])),
      type: 'sunrise',
      title: 'Sunrise',
      description: 'Photosynthesis begins with the morning light.',
      iconName: 'Sun',
    });
  }

  const todayHours = hourly.filter((h) => new Date(h.timestamp).toDateString() === new Date().toDateString());
  const peakLight = todayHours.reduce<HourlyTelemetryPoint | null>((m, h) => (!m || (h.light ?? 0) > (m.light ?? 0) ? h : m), null);
  if (peakLight && (peakLight.light ?? 0) > 0) {
    events.push({
      id: 'light-peak',
      time: peakLight.time,
      type: 'light_peak',
      title: 'Strongest light',
      description: `Solar radiation peaks around ${peakLight.light} W/m².`,
      iconName: 'Sparkles',
    });
  }
  const peakHeat = todayHours.reduce<HourlyTelemetryPoint | null>(
    (m, h) => (!m || (h.temperature ?? -99) > (m.temperature ?? -99) ? h : m),
    null
  );
  if (peakHeat && peakHeat.temperature !== null) {
    events.push({
      id: 'heat-peak',
      time: peakHeat.time,
      type: 'heat_peak',
      title: 'Warmest hour',
      description: `Air reaches about ${Math.round(peakHeat.temperature)}°C.`,
      iconName: 'ThermometerSun',
    });
  }

  if (dailyRaw.sunset?.[today]) {
    events.push({
      id: 'sunset',
      time: hhmm(new Date(dailyRaw.sunset[today])),
      type: 'sunset',
      title: 'Sunset & rest',
      description: 'Daylight ends; the tree rests overnight.',
      iconName: 'Moon',
    });
  }

  return events.sort((a, b) => a.time.localeCompare(b.time));
}
