import { TreeSettings } from '../settings/settings';
import { ESP32TelemetryProvider, ESP32TestResult } from './ESP32TelemetryProvider';
import { ITelemetryProvider, TelemetryFetchResult } from './types';
import { WeatherTelemetryProvider } from './WeatherTelemetryProvider';

// Picks the data source. Measurement only: no health decisions here.
export class TelemetryManager {
  private weatherProvider = new WeatherTelemetryProvider();
  private esp32Provider = new ESP32TelemetryProvider();

  async getTelemetry(settings: TreeSettings): Promise<TelemetryFetchResult> {
    let provider: ITelemetryProvider = this.weatherProvider;

    if (settings.dataSource === 'esp32_sensor') {
      provider = this.esp32Provider;
    } else if (settings.dataSource === 'auto') {
      const ready = await this.esp32Provider.isAvailable(settings.esp32EndpointUrl);
      provider = ready ? this.esp32Provider : this.weatherProvider;
    }

    try {
      return await provider.fetchTelemetry(settings);
    } catch (e) {
      // Never substitute weather data when the hardware sensor was explicitly chosen.
      if (settings.dataSource === 'esp32_sensor' || provider === this.weatherProvider) throw e;
      console.warn('ESP32 fetch failed in auto mode, using weather estimate', e);
      return this.weatherProvider.fetchTelemetry(settings);
    }
  }

  testESP32(url: string): Promise<ESP32TestResult> {
    return this.esp32Provider.testEndpoint(url);
  }
}

export const telemetryManager = new TelemetryManager();
