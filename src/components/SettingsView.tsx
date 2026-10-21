import React, { useState } from 'react';
import { TreeSettings } from '../settings/settings';
import { searchLocations, LocationSearchResult } from '../settings/locationSearch';
import { normalizeTelemetryEndpoint } from '../telemetry/ESP32TelemetryProvider';
import { APP_CONFIG } from '../config/appConfig';
import type { ServerStatus } from '../api/types';
import { VisualHealthCard } from './VisualHealthCard';
import { DataSourceSection } from './settings/DataSourceSection';
import { MapPin, Sliders, Thermometer, Trees, Check, Search } from 'lucide-react';

interface SettingsViewProps {
  settings: TreeSettings;
  onUpdateSettings: (newSettings: TreeSettings) => void;
  onRefreshTelemetry: () => void;
  serverStatus?: ServerStatus | null;
  onOpenPhotos?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onUpdateSettings,
  onRefreshTelemetry,
  serverStatus,
  onOpenPhotos,
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
  const [esp32Transport, setEsp32Transport] = useState(settings.esp32Transport ?? 'pull');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocationSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

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
      esp32Transport,
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
      esp32Transport,
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
            {([
              { id: 'fast', name: 'Fast Draining', desc: '100% Akadama / Pumice' },
              { id: 'standard', name: 'Standard Mix', desc: 'Akadama + Peat' },
              { id: 'slow', name: 'Slow Retentive', desc: 'Organic potting soil' },
            ] as const).map((d) => (
              <button
                key={d.id}
                onClick={() => setDrainageRate(d.id)}
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

      <DataSourceSection
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        serverStatus={serverStatus}
        dataSource={dataSource}
        setDataSource={setDataSource}
        esp32EndpointUrl={esp32EndpointUrl}
        setEsp32EndpointUrl={setEsp32EndpointUrl}
        telemetryIntervalMs={telemetryIntervalMs}
        esp32Transport={esp32Transport}
        setEsp32Transport={setEsp32Transport}
        setTelemetryIntervalMs={setTelemetryIntervalMs}
      />

      {/* SECTION 5: DAILY PHOTOS (the phone is the camera) */}
      <VisualHealthCard onOpenPhotos={onOpenPhotos} />

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
