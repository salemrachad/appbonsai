import React, { useState } from 'react';
import { TreeSettings } from '../settings/settings';
import { searchLocations, LocationSearchResult } from '../settings/locationSearch';
import { telemetryManager } from '../telemetry/telemetryManager';
import { normalizeTelemetryEndpoint, ESP32TestResult, isRunningInIframe } from '../telemetry/ESP32TelemetryProvider';
import { APP_CONFIG } from '../config/appConfig';
import { api } from '../api/client';
import type { ServerStatus } from '../api/types';
import { VisualHealthCard } from './VisualHealthCard';
import { CalibrationPanel } from './CalibrationPanel';
import {
  Settings as SettingsIcon,
  MapPin,
  CloudRain,
  Sliders,
  Cpu,
  Thermometer,
  Trees,
  Check,
  Search,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Code2,
  Copy,
  CheckCircle2,
  AlertCircle,
  Wifi,
} from 'lucide-react';

interface SettingsViewProps {
  settings: TreeSettings;
  onUpdateSettings: (newSettings: TreeSettings) => void;
  onRefreshTelemetry: () => void;
  serverStatus?: ServerStatus | null;
}

const SAMPLE_ESP32_CODE = `#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

WebServer server(80);

// FC-28 Soil Moisture Sensor connected to GPIO34 (ADC1_CH6)
const int FC28_PIN = 34;

// Calibration values: test raw ADC in dry air vs wet soil
const int AIR_RAW = 3400;   // Dry air raw reading
const int WATER_RAW = 1200; // Submerged / wet soil reading

// Browser Local Network Access (Private Network Access) CORS headers
void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void handleTelemetry() {
  addCorsHeaders();

  int raw = analogRead(FC28_PIN);
  int moisture = constrain(map(raw, AIR_RAW, WATER_RAW, 0, 100), 0, 100);

  StaticJsonDocument<256> doc;
  doc["soil_moisture"] = moisture;
  doc["soil_raw"] = raw;
  doc["temperature"] = nullptr;
  doc["humidity"] = nullptr;
  doc["light_lux"] = nullptr;
  doc["soil_temp"] = nullptr;

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12); // 12-bit ADC (0 - 4095)

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\\nConnected! IP: " + WiFi.localIP().toString());

  // Handle CORS preflight OPTIONS for browser Local Network Access (PNA)
  server.on("/api/telemetry", HTTP_OPTIONS, []() {
    addCorsHeaders();
    server.send(204);
  });

  server.on("/api/telemetry", HTTP_GET, handleTelemetry);
  server.begin();
}

void loop() {
  server.handleClient();
}`;

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onRefreshTelemetry,
  serverStatus,
}) => {
  const [treeName, setTreeName] = useState(settings.treeName);
  const [species, setSpecies] = useState(settings.species);
  const [rainReachesBonsai, setRainReachesBonsai] = useState(settings.rainReachesBonsai);
  const [temperatureUnit, setTemperatureUnit] = useState(settings.temperatureUnit);
  const [dataSource, setDataSource] = useState(settings.dataSource);
  const [drainageRate, setDrainageRate] = useState(settings.drainageRate);
  const [calibrationOffset, setCalibrationOffset] = useState(settings.calibrationOffset);
  const [esp32EndpointUrl, setEsp32EndpointUrl] = useState(settings.esp32EndpointUrl || '');
  const [telemetryIntervalMs, setTelemetryIntervalMs] = useState(settings.telemetryIntervalMs ?? APP_CONFIG.polling.telemetryMs);
  const [serverTest, setServerTest] = useState<{ ok: boolean; text: string } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showCodeGuide, setShowCodeGuide] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // ESP32 Test Link state
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testSuccessMessage, setTestSuccessMessage] = useState<string>('');
  const [testErrorMessage, setTestErrorMessage] = useState<string>('');
  const [testIsIframeBlocked, setTestIsIframeBlocked] = useState<boolean>(false);

  const handleSearchLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    const results = await searchLocations(searchQuery);
    setSearchResults(results);
    setIsSearching(false);
  };

  const handleSelectLocation = (loc: { name: string; lat: number; lon: number; tz?: string }) => {
    const updated: TreeSettings = {
      ...settings,
      locationName: loc.name,
      latitude: loc.lat,
      longitude: loc.lon,
      timezone: loc.tz || 'UTC',
      treeName,
      species,
      rainReachesBonsai,
      temperatureUnit,
      dataSource,
      drainageRate,
      calibrationOffset,
      telemetryIntervalMs,
      esp32EndpointUrl: esp32EndpointUrl.trim() ? normalizeTelemetryEndpoint(esp32EndpointUrl) : undefined,
    };
    onUpdateSettings(updated);
    setSearchResults([]);
    setSearchQuery('');
    showSaveToast();
  };

  const handleSaveAll = () => {
    // Automatically normalize endpoint if user entered a base URL
    const normalized = esp32EndpointUrl.trim()
      ? normalizeTelemetryEndpoint(esp32EndpointUrl)
      : undefined;

    const updated: TreeSettings = {
      ...settings,
      treeName,
      species,
      rainReachesBonsai,
      temperatureUnit,
      dataSource,
      drainageRate,
      calibrationOffset,
      telemetryIntervalMs,
      esp32EndpointUrl: normalized,
    };
    onUpdateSettings(updated);
    if (normalized) {
      setEsp32EndpointUrl(normalized);
    }
    showSaveToast();
  };

  const showSaveToast = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2400);
  };

  const handleTestESP32Ping = async () => {
    if (!esp32EndpointUrl.trim()) return;
    setPingStatus('testing');
    setTestSuccessMessage('');
    setTestErrorMessage('');
    setTestIsIframeBlocked(false);

    try {
      const result: ESP32TestResult = await telemetryManager.testESP32(esp32EndpointUrl);
      if (result.success) {
        setPingStatus('success');
        setTestIsIframeBlocked(false);
        const rawPart = result.soilRaw !== null && result.soilRaw !== undefined ? ` • Raw ${result.soilRaw}` : '';
        setTestSuccessMessage(`Connected • Soil ${result.soilMoisture ?? 0}%${rawPart}`);
        // Retain soil_raw and endpoint in settings
        if (result.soilRaw !== undefined && result.soilRaw !== null) {
          onUpdateSettings({
            ...settings,
            esp32EndpointUrl: result.normalizedUrl,
            lastSoilRaw: result.soilRaw,
          });
        }
      } else {
        setPingStatus('failed');
        setTestIsIframeBlocked(!!result.isIframeBlocked);
        setTestErrorMessage(result.error || 'Connection failed: Unable to reach ESP32 endpoint.');
      }
    } catch (err: any) {
      setPingStatus('failed');
      setTestIsIframeBlocked(isRunningInIframe());
      setTestErrorMessage(err?.message || 'Connection failed: Unable to reach endpoint.');
    }
  };

  const handleTestFromServer = async () => {
    if (!esp32EndpointUrl.trim()) return;
    setServerTest({ ok: true, text: 'Testing from the local server…' });
    try {
      const r = await api.testFromServer(esp32EndpointUrl);
      setServerTest(
        r.success
          ? { ok: true, text: `Server reached it • Soil ${r.soilMoisture ?? '–'}%${r.soilRaw != null ? ` • Raw ${r.soilRaw}` : ''}` }
          : { ok: false, text: r.error ?? 'Failed' }
      );
    } catch (err: any) {
      setServerTest({ ok: false, text: `Local server not reachable (${err?.message ?? err}). Is npm run dev running?` });
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(SAMPLE_ESP32_CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div id="settings-view" className="space-y-6 pb-16 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="serif text-3xl font-medium text-[#2D332A] tracking-tight flex items-center gap-2">
            <span>Companion Settings</span>
          </h2>
          <p className="sans text-xs text-[#2D332A]/60">
            Calibrate environmental models, location, and data providers.
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4A6741]/10 text-[#3D5535] sans text-xs font-semibold border border-[#4A6741]/20 animate-fadeIn">
            <Check className="w-3.5 h-3.5" />
            <span>Saved</span>
          </div>
        )}
      </div>

      {/* SECTION 1: TREE IDENTITY */}
      <div className="p-5 rounded-2xl glass space-y-4">
        <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50 flex items-center gap-1.5">
          <Trees className="w-4 h-4 text-[#4A6741]" />
          <span>Tree Profile</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="sans text-xs font-semibold text-[#2D332A]/70 block mb-1">Tree Nickname</label>
            <input
              type="text"
              value={treeName}
              onChange={(e) => setTreeName(e.target.value)}
              placeholder="e.g. Ficus, Midori"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/70 border border-[#EAE6E1] sans text-sm text-[#2D332A] focus:outline-none focus:border-[#4A6741]"
            />
          </div>

          <div>
            <label className="sans text-xs font-semibold text-[#2D332A]/70 block mb-1">Species</label>
            <input
              type="text"
              value={species}
              onChange={(e) => setSpecies(e.target.value)}
              placeholder="e.g. Ficus microcarpa"
              className="w-full px-3.5 py-2.5 rounded-xl bg-white/70 border border-[#EAE6E1] sans text-sm text-[#2D332A] focus:outline-none focus:border-[#4A6741]"
            />
          </div>
        </div>
      </div>

      {/* SECTION 2: LOCATION & MICROCLIMATE */}
      <div className="p-5 rounded-2xl glass space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50 flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-[#4A6741]" />
            <span>Location & Environmental Coordinates</span>
          </h3>
          <span className="serif text-sm font-bold text-[#3D5535]">{settings.locationName}</span>
        </div>

        {/* Location Search Input */}
        <form onSubmit={handleSearchLocation} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#2D332A]/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search any town or city (e.g. Feytroun, Tokyo, Zurich)..."
              className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-white/70 border border-[#EAE6E1] sans text-xs text-[#2D332A] focus:outline-none focus:border-[#4A6741]"
            />
          </div>
          <button
            type="submit"
            disabled={isSearching}
            className="px-4 py-2 rounded-xl bg-[#4A6741] text-white sans text-xs font-semibold hover:bg-[#3D5535] transition-colors cursor-pointer"
          >
            {isSearching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="space-y-1.5 p-2 rounded-xl bg-white/80 border border-[#EAE6E1]">
            <span className="sans text-[11px] font-semibold text-[#2D332A]/60 px-2">Select matching location:</span>
            {searchResults.map((loc) => (
              <button
                key={loc.id}
                onClick={() =>
                  handleSelectLocation({
                    name: `${loc.name}, ${loc.country}`,
                    lat: loc.latitude,
                    lon: loc.longitude,
                    tz: loc.timezone,
                  })
                }
                className="w-full text-left p-2 rounded-lg hover:bg-[#F8F5F2] sans text-xs font-medium text-[#2D332A] flex justify-between items-center transition-colors cursor-pointer"
              >
                <span>{loc.name}, {loc.admin1 ? `${loc.admin1}, ` : ''}{loc.country}</span>
                <span className="sans text-[10px] text-[#2D332A]/50 font-mono">{loc.latitude.toFixed(2)}, {loc.longitude.toFixed(2)}</span>
              </button>
            ))}
          </div>
        )}

        {/* Rain reach toggle */}
        <div className="pt-3 border-t border-[#EAE6E1] flex items-center justify-between">
          <div className="flex flex-col">
            <span className="sans text-xs font-bold text-[#2D332A]">Does rain reach this bonsai?</span>
            <span className="sans text-[11px] text-[#2D332A]/50">
              Leave No if placed indoors or under covered eaves.
            </span>
          </div>

          <div className="flex gap-1 bg-white/60 p-1 rounded-xl border border-[#EAE6E1]">
            <button
              onClick={() => setRainReachesBonsai(false)}
              className={`px-3 py-1 rounded-lg sans text-xs font-semibold transition-all cursor-pointer ${
                !rainReachesBonsai ? 'bg-[#4A6741] text-white shadow-xs' : 'text-[#2D332A]/60'
              }`}
            >
              No (Covered)
            </button>
            <button
              onClick={() => setRainReachesBonsai(true)}
              className={`px-3 py-1 rounded-lg sans text-xs font-semibold transition-all cursor-pointer ${
                rainReachesBonsai ? 'bg-[#4A6741] text-white shadow-xs' : 'text-[#2D332A]/60'
              }`}
            >
              Yes (Outdoor)
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 3: POT SOIL & CALIBRATION */}
      <div className="p-5 rounded-2xl glass space-y-4">
        <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50 flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-[#4A6741]" />
          <span>Moisture Model Calibration</span>
        </h3>

        {/* Drainage Rate */}
        <div className="space-y-2">
          <label className="sans text-xs font-semibold text-[#2D332A]/70">Pot Drainage & Soil Type</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'fast', name: 'Fast Draining', desc: '100% Akadama / Pumice' },
              { id: 'standard', name: 'Standard Mix', desc: 'Akadama + Peat' },
              { id: 'slow', name: 'Slow Retentive', desc: 'Organic potting soil' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setDrainageRate(d.id as any)}
                className={`p-2.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  drainageRate === d.id
                    ? 'border-[#4A6741] bg-[#4A6741]/10 text-[#3D5535]'
                    : 'border-[#EAE6E1] bg-white/60 text-[#2D332A]/70'
                }`}
              >
                <span className="sans text-xs font-bold">{d.name}</span>
                <span className="sans text-[10px] text-[#2D332A]/50 mt-0.5">{d.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Temperature Units */}
        <div className="pt-3 border-t border-[#EAE6E1] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-[#D97757]" />
            <span className="sans text-xs font-bold text-[#2D332A]">Temperature Unit</span>
          </div>

          <div className="flex gap-1 bg-white/60 p-1 rounded-xl border border-[#EAE6E1]">
            <button
              onClick={() => setTemperatureUnit('C')}
              className={`px-3 py-1 rounded-lg sans text-xs font-semibold transition-all cursor-pointer ${
                temperatureUnit === 'C' ? 'bg-[#4A6741] text-white shadow-xs' : 'text-[#2D332A]/60'
              }`}
            >
              °C (Celsius)
            </button>
            <button
              onClick={() => setTemperatureUnit('F')}
              className={`px-3 py-1 rounded-lg sans text-xs font-semibold transition-all cursor-pointer ${
                temperatureUnit === 'F' ? 'bg-[#4A6741] text-white shadow-xs' : 'text-[#2D332A]/60'
              }`}
            >
              °F (Fahrenheit)
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 4: DATA SOURCE ARCHITECTURE & ESP32 HARDWARE */}
      <div className="p-5 rounded-2xl glass space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50 flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-[#4A6741]" />
            <span>Telemetry Source Architecture</span>
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Internet Option */}
          <button
            onClick={() => setDataSource('weather_estimate')}
            className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between gap-2 transition-all cursor-pointer ${
              dataSource === 'weather_estimate'
                ? 'border-[#4A6741] bg-[#4A6741]/10 text-[#3D5535]'
                : 'border-[#EAE6E1] bg-white/60 text-[#2D332A]/70'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="sans text-xs font-bold">Internet Estimate</span>
              {dataSource === 'weather_estimate' && <Check className="w-4 h-4 text-[#4A6741]" />}
            </div>
            <span className="sans text-[11px] text-[#2D332A]/60">
              Open-Meteo solar radiation, VPD, and temperature models.
            </span>
          </button>

          {/* ESP32 Hardware Sensor Option */}
          <button
            onClick={() => setDataSource('esp32_sensor')}
            className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between gap-2 transition-all cursor-pointer ${
              dataSource === 'esp32_sensor'
                ? 'border-[#356077] bg-[#356077]/10 text-[#284B5D]'
                : 'border-[#EAE6E1] bg-white/60 text-[#2D332A]/70'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="sans text-xs font-bold">ESP32 Hardware Sensor</span>
              {dataSource === 'esp32_sensor' && <Check className="w-4 h-4 text-[#356077]" />}
            </div>
            <span className="sans text-[11px] text-[#2D332A]/60">
              Live soil moisture sensor via ESP32.
            </span>
          </button>
        </div>

        {/* ESP32 Physical Endpoint Configuration */}
        {dataSource === 'esp32_sensor' && (
          <div className="p-4 rounded-xl bg-white/80 border border-[#356077]/30 space-y-3 animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="sans text-xs font-bold text-[#2D332A] flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-[#356077]" />
                <span>ESP32 Wi-Fi / LAN Endpoint URL</span>
              </span>
              <button
                type="button"
                onClick={() => setShowCodeGuide(!showCodeGuide)}
                className="text-[11px] text-[#356077] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>{showCodeGuide ? 'Hide Arduino Code' : 'View Arduino Code'}</span>
              </button>
            </div>

            {isRunningInIframe() && (
              <div className="p-2.5 rounded-lg bg-[#356077]/5 border border-[#356077]/20 flex items-center justify-between gap-3 text-xs text-[#2D332A]">
                <div className="flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-[#356077] shrink-0" />
                  <span className="text-[11px] leading-tight">
                    <strong>Local Network Access:</strong> Preview iframes cannot access private LAN IPs (<code className="font-mono text-[10px]">192.168.x.x</code>). Open as a standalone top-level page to fetch from your ESP32.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#356077] text-white text-[10px] font-semibold hover:bg-[#284B5D] transition-all cursor-pointer shrink-0"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Open Standalone</span>
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={esp32EndpointUrl}
                onChange={(e) => {
                  setEsp32EndpointUrl(e.target.value);
                  setPingStatus('idle');
                  setTestSuccessMessage('');
                  setTestErrorMessage('');
                  setTestIsIframeBlocked(false);
                }}
                placeholder="http://192.168.1.123 or http://192.168.1.123/api/telemetry"
                className="flex-1 px-3.5 py-2 rounded-xl bg-white border border-[#EAE6E1] sans text-xs text-[#2D332A] font-mono focus:outline-none focus:border-[#356077]"
              />
              <button
                type="button"
                onClick={handleTestESP32Ping}
                disabled={!esp32EndpointUrl.trim() || pingStatus === 'testing'}
                className="px-3.5 py-2 rounded-xl bg-[#356077] text-white sans text-xs font-semibold hover:bg-[#284B5D] transition-all cursor-pointer disabled:opacity-50 shrink-0"
              >
                {pingStatus === 'testing' ? 'Testing...' : 'Test Link'}
              </button>
            </div>

            {/* Clear Success Result */}
            {pingStatus === 'success' && testSuccessMessage && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-xs text-emerald-800 font-semibold animate-fadeIn">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{testSuccessMessage}</span>
              </div>
            )}

            {/* Clear Failure Error Result */}
            {pingStatus === 'failed' && testErrorMessage && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200/90 space-y-2 text-xs text-amber-900 animate-fadeIn">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="leading-relaxed font-medium">{testErrorMessage}</span>
                </div>
                {testIsIframeBlocked && (
                  <div className="pt-2 flex flex-wrap items-center gap-2 border-t border-amber-200/70">
                    <button
                      type="button"
                      onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#356077] text-white font-medium text-[11px] hover:bg-[#284B5D] transition-all cursor-pointer shadow-xs"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open App as Standalone Page</span>
                    </button>
                    <span className="text-[11px] text-amber-800/80">
                      Bypasses Gemini preview iframe restrictions
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Local server: the collector that actually polls the ESP32 */}
            <div className="pt-3 border-t border-[#EAE6E1] space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="sans text-xs font-bold text-[#2D332A]">Local collector (Appbonsai server)</span>
                <button
                  type="button"
                  onClick={handleTestFromServer}
                  disabled={!esp32EndpointUrl.trim()}
                  className="px-2.5 py-1 rounded-lg border border-[#356077]/40 text-[#356077] sans text-[11px] font-semibold hover:bg-[#356077]/10 cursor-pointer disabled:opacity-50"
                >
                  Test from server
                </button>
              </div>
              {serverTest && (
                <p className={`sans text-[11px] font-medium ${serverTest.ok ? 'text-emerald-800' : 'text-amber-900'}`}>{serverTest.text}</p>
              )}
              <label className="flex items-center justify-between gap-2 sans text-[11px] text-[#2D332A]/75">
                <span>Read the ESP32 every</span>
                <select
                  value={telemetryIntervalMs}
                  onChange={(e) => setTelemetryIntervalMs(Number(e.target.value))}
                  className="px-2 py-1 rounded-lg bg-white border border-[#EAE6E1] sans text-[11px] focus:outline-none focus:border-[#356077]"
                >
                  {[10, 30, 60, 120, 300, 600].map((s) => (
                    <option key={s} value={s * 1000}>
                      {s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`}
                      {s === 60 ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="sans text-[10.5px] text-[#2D332A]/50 leading-relaxed">
                {serverStatus
                  ? serverStatus.collector.lastError
                    ? `Last poll failed: ${serverStatus.collector.lastError}`
                    : serverStatus.collector.lastSuccessAt
                    ? `Last reading ${new Date(serverStatus.collector.lastSuccessAt).toLocaleTimeString()} · ${serverStatus.counts.telemetry} readings stored`
                    : 'Waiting for the first reading'
                  : 'Local server not reachable. Start everything with npm run dev.'}{' '}
                Readings are only collected while the server runs.
              </p>
            </div>

            {/* Guided soil + light calibration (stored on the local server) */}
            <CalibrationPanel serverStatus={serverStatus ?? null} />

            <p className="sans text-[11px] text-[#2D332A]/60 leading-relaxed">
              Accepts base URL like <code className="bg-neutral-100 px-1 py-0.5 rounded font-mono text-[10px]">http://192.168.1.150</code> or full path <code className="bg-neutral-100 px-1 py-0.5 rounded font-mono text-[10px]">http://192.168.1.150/api/telemetry</code>. Supports browser Local Network Access (<code className="bg-neutral-100 px-1 py-0.5 rounded font-mono text-[10px]">Access-Control-Allow-Private-Network: true</code>). Only FC-28 on GPIO34 is active; unattached probes show as &quot;Sensor not connected&quot;.
            </p>

            {/* Arduino Code Drawer */}
            {showCodeGuide && (
              <div className="pt-2 border-t border-[#EAE6E1] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="sans text-[11px] font-bold text-[#2D332A]">
                    Arduino C++ Sketch (FC-28 Soil Sensor on GPIO34 + Local Network Access CORS)
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-[#EAE6E1] text-[10px] font-semibold text-[#2D332A] hover:border-[#356077] cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
                  </button>
                </div>
                <div className="p-2 rounded bg-blue-50 border border-blue-200 text-[10px] text-blue-800 leading-normal">
                  <strong>Local Network Access Ready:</strong> Includes <code className="bg-white/80 px-1 rounded font-mono">addCorsHeaders()</code> sending <code className="bg-white/80 px-1 rounded font-mono">Access-Control-Allow-Private-Network: true</code> and handles <code className="bg-white/80 px-1 rounded font-mono">HTTP_OPTIONS</code> preflight requests to satisfy Chrome/Chromium private network access specifications.
                </div>
                <pre className="p-3 rounded-lg bg-[#2D332A] text-[#F8F5F2] text-[10px] font-mono overflow-x-auto max-h-56 leading-relaxed">
                  {SAMPLE_ESP32_CODE}
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="p-3 rounded-xl bg-white/60 border border-[#EAE6E1] sans text-xs text-[#2D332A]/70">
          <strong className="text-[#2D332A] font-semibold">Live Prototype Mode:</strong> Single FC-28 soil moisture probe is prioritized for tree vitality, while unattached sensors report as disconnected.
        </div>
      </div>

      {/* SECTION 5: VISUAL HEALTH & FUTURE CAMERA */}
      <VisualHealthCard />

      {/* SAVE BUTTON & ATTRIBUTION */}
      <div className="space-y-4 pt-2">
        <button
          id="save-settings-btn"
          onClick={handleSaveAll}
          className="w-full py-4 px-6 rounded-full bg-[#4A6741] hover:bg-[#3D5535] active:scale-[0.98] text-white font-medium sans text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Save Settings & Calibrate Model</span>
        </button>

        {/* Attribution */}
        <div className="flex flex-col items-center justify-center text-center gap-1 sans text-[11px] text-[#2D332A]/50 pt-2">
          <span>
            Environmental data powered by{' '}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-[#4A6741] font-medium"
            >
              Open-Meteo
            </a>
          </span>
          <span>Appbonsai Companion • Warm Organic Cultural Edition</span>
        </div>
      </div>
    </div>
  );
};
