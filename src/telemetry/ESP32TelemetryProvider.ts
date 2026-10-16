import { APP_CONFIG } from '../config/appConfig';
import { TreeSettings } from '../settings/settings';
import { readSoilFields, normalizeESP32Payload } from './telemetryNormalizer';
import { ITelemetryProvider, TelemetryFetchResult } from './types';

export function normalizeTelemetryEndpoint(input: string): string {
  let url = input.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  if (!/\/api\/telemetry$/i.test(url)) {
    url = /\/api$/i.test(url) ? `${url}/telemetry` : `${url}${APP_CONFIG.esp32.telemetryPath}`;
  }
  return url;
}

export function isRunningInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true; // cross-origin restriction confirms running inside an iframe
  }
}

export function isPrivateAddress(inputUrl: string): boolean {
  try {
    const host = new URL(inputUrl).hostname;
    return (
      host === 'localhost' ||
      host.endsWith('.local') ||
      /^127\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    );
  } catch {
    return true;
  }
}

export interface ESP32TestResult {
  success: boolean;
  soilMoisture?: number;
  soilRaw?: number | null;
  error?: string;
  normalizedUrl: string;
  isIframeBlocked?: boolean;
}

// Browser fetch to a LAN device (Private Network Access). `targetAddressSpace` is Chrome-only and not in the DOM types.
function fetchLocal(url: string, timeoutMs: number) {
  const init: RequestInit & { targetAddressSpace: 'local' } = {
    method: 'GET',
    mode: 'cors',
    targetAddressSpace: 'local',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  };
  return fetch(url, init);
}

export class ESP32TelemetryProvider implements ITelemetryProvider {
  getName(): string {
    return 'Live sensors via ESP32';
  }

  async isAvailable(url?: string): Promise<boolean> {
    if (!url) return false;
    try {
      const res = await fetchLocal(normalizeTelemetryEndpoint(url), APP_CONFIG.esp32.probeTimeoutMs);
      return res.ok;
    } catch {
      return false;
    }
  }

  async testEndpoint(rawUrl: string): Promise<ESP32TestResult> {
    const normalizedUrl = normalizeTelemetryEndpoint(rawUrl);
    if (!normalizedUrl) {
      return {
        success: false,
        error: 'Please enter a valid IP address or URL (e.g. http://192.168.1.123 or http://192.168.1.123/api/telemetry)',
        normalizedUrl: '',
      };
    }

    try {
      const response = await fetchLocal(normalizedUrl, APP_CONFIG.esp32.testTimeoutMs);
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status} ${response.statusText || 'Error'} from ${normalizedUrl}`,
          normalizedUrl,
        };
      }
      const { apiSoilMoisture, soilRaw } = readSoilFields(await response.json());
      return { success: true, soilMoisture: apiSoilMoisture ?? undefined, soilRaw, normalizedUrl };
    } catch (err: any) {
      const rawMsg = err?.message || String(err);
      const isTimeout =
        err?.name === 'TimeoutError' || rawMsg.includes('aborted') || rawMsg.includes('timeout') || rawMsg.includes('Timed out');

      let message = rawMsg;
      let isIframeBlocked = false;

      if (isTimeout) {
        message = `Connection timed out reaching ${normalizedUrl}. Check that the ESP32 is powered on and connected to the same Wi-Fi.`;
      } else if (
        isRunningInIframe() &&
        (isPrivateAddress(normalizedUrl) ||
          ['Failed to fetch', 'NetworkError', 'Private Network', 'Local Network', 'targetAddressSpace', 'permission'].some(
            (s) => rawMsg.includes(s)
          ))
      ) {
        isIframeBlocked = true;
        message =
          'Local Network Access permission blocked by browser: Web browsers strictly prevent embedded preview iframes from connecting to local LAN devices (such as http://192.168.1.123). Please open the app as a standalone top-level page in a new browser tab rather than inside the Gemini preview iframe.';
      } else if (rawMsg.includes('Failed to fetch') || rawMsg.includes('NetworkError')) {
        message =
          'Failed to connect to ESP32. Ensure the IP address is correct, your device is on the same local network, and that addCorsHeaders() includes "Access-Control-Allow-Private-Network: true". If on HTTPS, check browser Site Settings (allow insecure local content).';
      }

      return { success: false, error: message, normalizedUrl, isIframeBlocked };
    }
  }

  // Returns only live readings. When the ESP32 can't be reached this throws, so no cached,
  // simulated or weather values are ever shown as if they came from the sensor.
  async fetchTelemetry(settings: TreeSettings): Promise<TelemetryFetchResult> {
    const normalizedUrl = settings.esp32EndpointUrl ? normalizeTelemetryEndpoint(settings.esp32EndpointUrl) : '';
    if (!normalizedUrl) throw new Error('No ESP32 endpoint configured');

    let response: Response;
    try {
      response = await fetchLocal(normalizedUrl, APP_CONFIG.esp32.fetchTimeoutMs);
    } catch (err) {
      if (isRunningInIframe()) {
        console.warn('ESP32 Local Network Access blocked inside iframe. Open the app as a standalone page.', err);
      }
      throw err;
    }
    if (!response.ok) throw new Error(`ESP32 responded with HTTP ${response.status}`);

    const raw = await response.json();
    return { current: normalizeESP32Payload(raw, settings), hourly: [], timeline: [], raw };
  }
}
