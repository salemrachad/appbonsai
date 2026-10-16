import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, RefreshCw, History as HistoryIcon, Settings as SettingsIcon, X, Activity, Wrench } from 'lucide-react';
import { api } from './api/client';
import { BACKEND } from './config/backend';
import type { DailySummary } from './history/historyTypes';
import { importBrowserHistoryOnce } from './history/legacyBrowserHistory';
import { useLivingState } from './hooks/useLivingState';
import { useDevPreviews } from './hooks/useDevPreviews';
import { usePlantBehaviour } from './hooks/usePlantBehaviour';
import { usePlantHealth } from './hooks/usePlantHealth';
import { DEFAULT_SETTINGS, loadSettings, TreeSettings } from './settings/settings';
import { midSeasonState } from './perception/season';
import { ACTIVE_SPECIES } from './species';
import type { HourlyTelemetryPoint } from './telemetry/types';
import type { PetSession } from './components/avatar/usePetting';
import { DetailView } from './components/DetailView';
import { SceneBackdrop } from './components/scene/SceneBackdrop';
import { SeasonChip } from './components/scene/SeasonChip';
import { BackendBadge } from './components/developer/BackendBadge';
import { SensorDiagnostics } from './components/sensors/SensorDiagnostics';
import { Toast, ToastMessage } from './components/Toast';
import { Developer } from './pages/Developer';
import { Home } from './pages/Home';
import { History } from './pages/History';
import { Settings } from './pages/Settings';
import { hhmm } from './lib/time';

type Panel = 'history' | 'settings' | 'developer' | null;

const DEBUG_KEY = 'appbonsai_sensor_debug_v1';

export default function App() {
  // UI copy of the settings (localStorage); the local server keeps the collector's copy in SQLite.
  // Plant settings belong to the local server; the browser only shows them (defaults until loaded)
  const [settings, setSettings] = useState<TreeSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // #history, #settings or #developer in the URL opens that panel (handy for bookmarks)
  const [panel, setPanel] = useState<Panel>(() => {
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return h === 'history' || h === 'settings' || h === 'developer' ? h : null;
  });
  const [showDetail, setShowDetail] = useState(false);
  // Calm confirmation toasts
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  // Developer previews (#preview=very_dry, #season=winter, … in the URL start one): presentation only, never written
  const { previews, setPreview, clearAll: clearPreviews, previewing, label: previewLabel } = useDevPreviews(notify);
  const devPresetId = previews.preset;

  // Live sensor strip at the bottom, remembered per browser
  const [showDiagnostics, setShowDiagnostics] = useState(() => {
    try {
      return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleDiagnostics = () => {
    const next = !showDiagnostics;
    setShowDiagnostics(next);
    try {
      localStorage.setItem(DEBUG_KEY, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };

  const updateSettings = useCallback((next: TreeSettings) => {
    settingsRef.current = next;
    setSettings(next);
    api.putConfig(next).catch(() => notify(`Saved here, but ${BACKEND.label.toLowerCase()} is offline`));
  }, [notify]);

  // ---- Data flow: local server (perception → health → behaviour → expression) → screen ----
  const { snapshot, serverOffline, isManualRefresh, refreshNow, reload } = useLivingState({
    onNewWatering: (e) => notify(e.metadata.source === 'manual' ? 'Watering logged 💧' : 'Watering detected 💧'),
    onManualRefreshDone: (ok) => notify(ok ? 'Up to date' : "Couldn't reach the sensor"),
  });

  // First contact with the server: share settings if it has none, else adopt its copy;
  // then move any old browser-only history into the database (once).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings: serverSettings, configured } = await api.getConfig();
        if (cancelled) return;
        if (configured || BACKEND.remote) {
          // Against the Pi, the Pi's settings always win: a dev browser never seeds them
          const merged = { ...DEFAULT_SETTINGS, ...serverSettings };
          settingsRef.current = merged;
          setSettings(merged);
        } else {
          // First run only: move the settings this browser used to keep into the server, then forget them
          const legacy = loadSettings();
          await api.putConfig(legacy);
          setSettings(legacy);
          try {
            localStorage.removeItem('appbonsai_settings_v1');
          } catch {
            /* storage unavailable */
          }
        }
        // Old browser-only history is moved into the server that served this page, never into the Pi
        // from a development browser (its localStorage would be the laptop's, not the tree's)
        if (BACKEND.remote) return;
        const imported = await importBrowserHistoryOnce();
        if (imported && (imported.telemetry || imported.events)) {
          notify(`Moved ${imported.telemetry} readings and ${imported.events} waterings into the local database`);
          reload();
        }
      } catch {
        /* server offline: the header says so; retried on next page load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverOffline]); // eslint-disable-line react-hooks/exhaustive-deps

  const { live, display } = usePlantHealth(snapshot?.health ?? null, devPresetId);
  const { behaviour, expression } = usePlantBehaviour(snapshot, display, previews, settings.latitude);
  const perception = snapshot?.perception ?? null;
  const reading = perception?.lastReading ?? null;

  // TEMP DEBUG: trace the soil value from ESP32 to Home tile. Remove once verified.
  useEffect(() => {
    if (!reading) return;
    console.log({
      apiSoilMoisture: reading.apiSoilMoisture ?? null,
      normalizedSoilMoisture: reading.soilMoisture,
      displayedSoilMoisture: display?.metrics.find((m) => m.id === 'soil')?.value ?? null,
      soilRaw: reading.soilRaw ?? null,
      source: reading.source,
      condition: display?.condition,
      modifiers: display?.modifiers,
      devPreset: devPresetId,
    });
  }, [reading?.timestamp, display?.condition, devPresetId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Charts for the detail view: forecast (weather) or stored hourly averages (sensor)
  const [charts, setCharts] = useState<{ hourly: HourlyTelemetryPoint[]; days: DailySummary[] }>({ hourly: [], days: [] });
  useEffect(() => {
    if (!showDetail) return;
    Promise.all([api.hourly(24), api.daily(7)])
      .then(([buckets, days]) =>
        setCharts({
          days,
          hourly: buckets.map((b) => ({
            time: hhmm(b.hourStart),
            hour: new Date(b.hourStart).getHours(),
            timestamp: b.hourStart,
            temperature: b.avgTemp,
            humidity: b.avgHumidity,
            light: b.avgLight,
            soilMoisture: Math.round(b.avgSoil ?? 0),
            vpd: null,
            isDay: true,
          })),
        })
      )
      .catch(() => {});
  }, [showDetail]);
  const isEstimate = reading?.source === 'weather_estimate';
  const hourly = isEstimate && snapshot?.forecast.hourly.length ? snapshot.forecast.hourly : charts.hourly;

  // ---- Header status ----
  const collector = snapshot?.status.collector;
  const sensorDown = !!perception && !perception.telemetry;
  // Petting is attention, not care: one record per session, and none during a developer preview
  // (previews never write to the server)
  const recordPetSession = useCallback(
    (s: PetSession) => {
      if (previewing) return;
      api.recordInteraction({ kind: 'pet', ...s }).catch(() => {});
    },
    [previewing]
  );
  const statusLabel = previewing
    ? 'Test mode'
    : serverOffline
    ? BACKEND.remote
      ? 'Raspberry Pi offline'
      : 'Server offline'
    : !snapshot
    ? 'Connecting…'
    : sensorDown
    ? collector?.lastError
      ? 'Sensor offline'
      : 'Waiting for sensor'
    : isEstimate
    ? 'Weather estimate'
    : 'Live';
  const statusDot = previewing
    ? 'bg-[#D49B53]'
    : serverOffline || sensorDown || !snapshot
    ? 'bg-[var(--ink)]/25'
    : isEstimate
    ? 'bg-[#D49B53]'
    : 'bg-[#4A6741] animate-pulse';
  const iconButton = 'p-2 rounded-full text-[var(--ink)]/55 hover:text-[#4A6741] hover:bg-white/70 transition-colors cursor-pointer';
  // The main screen takes on the tree's state (a scene per condition; sleeping and too-dark are dark).
  // Settings, History and details stay light.
  const atmosphere = expression?.atmosphere;
  const isNight = atmosphere?.theme === 'night';
  const scene = atmosphere?.scene ?? 'calm';
  const offlineMessage = serverOffline
    ? BACKEND.remote
      ? `I can't reach the Raspberry Pi (${BACKEND.displayUrl}). Is it on, and is the Appbonsai service running?`
      : "I can't reach my server. Is it running (npm run server, or npm run dev:local for development)?"
    : null;
  const backendMode = snapshot?.status.backend?.mode;
  const changeKey = `${snapshot?.status.counts.episodes ?? 0}-${snapshot?.status.counts.events ?? 0}-${snapshot?.recentEpisodes[0]?.id ?? 0}`;

  return (
    <div
      className={`relative h-screen overflow-hidden flex flex-col text-[var(--ink)] bg-[var(--paper)] transition-colors duration-1000 scene-${scene} ${
        isNight ? 'night' : ''
      }`}
    >
      <SceneBackdrop
        scene={scene}
        season={atmosphere?.season ?? perception?.season?.id ?? 'summer'}
        intensity={atmosphere?.intensity ?? 0.5}
        weather={atmosphere?.weather ?? null}
        twilight={atmosphere?.twilight ?? null}
      />
      <header className="relative z-10 shrink-0 h-16 px-8 flex items-center justify-between border-b border-[var(--line)]">
        <div className="flex items-baseline gap-4 min-w-0">
          <h1 className="serif text-3xl font-medium tracking-tight">{settings.treeName || 'Ficus'}</h1>
          <span className="sans text-xs text-[var(--ink)]/50 flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 text-[#4A6741]" />
            {settings.locationName}
          </span>
          {BACKEND.devBuild && <BackendBadge remote={BACKEND.remote} mode={backendMode} offline={serverOffline} />}
          {perception?.season && <SeasonChip season={previews.season ? midSeasonState(previews.season, settings.latitude) : perception.season} />}
        </div>

        <div className="flex items-center gap-2">
          <div className="sans text-xs text-[var(--ink)]/60 flex items-center gap-2 mr-2" title={collector?.lastError ?? undefined}>
            <span className={`w-2 h-2 rounded-full ${statusDot}`} />
            <span className="font-medium">{statusLabel}</span>
            {!devPresetId && reading && !sensorDown && !isEstimate && <span className="text-[var(--ink)]/40 tabular-nums">· {reading.updatedAt}</span>}
          </div>
          <button onClick={refreshNow} className={iconButton} title="Read the sensor now">
            <RefreshCw className={`w-4 h-4 ${isManualRefresh ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={toggleDiagnostics}
            className={`${iconButton} ${showDiagnostics ? 'text-[#4A6741] bg-white/70' : ''}`}
            title="Live sensors"
          >
            <Activity className="w-4 h-4" />
          </button>
          <button onClick={() => setPanel('history')} className={iconButton} title="Diary">
            <HistoryIcon className="w-4 h-4" />
          </button>
          <button onClick={() => setPanel('developer')} className={`${iconButton} ${devPresetId ? 'text-[#D49B53]' : ''}`} title="Developer tools">
            <Wrench className="w-4 h-4" />
          </button>
          <button onClick={() => setPanel('settings')} className={iconButton} title="Settings">
            <SettingsIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      <Home
        health={display}
        expression={expression}
        offlineMessage={offlineMessage}
        devPresetLabel={previewLabel}
        onReturnToLive={clearPreviews}
        onOpenDetails={() => setShowDetail(true)}
        onPetSession={recordPetSession}
        outside={perception?.outside ?? null}
        air={perception?.air ?? null}
        // Inside vs outside only with the real sensor (in weather mode the 'inside' values ARE the outside estimate)
        inside={perception?.source === 'esp32_sensor' ? { temperature: perception.readings.temperature, humidity: perception.readings.humidity } : { temperature: null, humidity: null }}
      />

      {showDiagnostics && (
        <SensorDiagnostics
          readings={snapshot?.liveReadings ?? []}
          source={isEstimate ? 'Weather' : 'ESP32'}
          pollMs={collector?.pollMs ?? 60000}
          tempUnit={settings.temperatureUnit}
          lightUnit={isEstimate ? 'W/m²' : '%'}
          guides={Object.fromEntries((display?.metrics ?? []).filter((m) => m.guide).map((m) => [m.id, m.guide!]))}
          onClose={toggleDiagnostics}
        />
      )}

      {panel && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/25" onClick={() => setPanel(null)}>
          <aside className="day w-full max-w-xl h-full overflow-y-auto bg-[var(--paper)] text-[var(--ink)] shadow-2xl px-6 pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end">
              <button onClick={() => setPanel(null)} className={iconButton} title="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            {panel === 'history' ? (
              <History treeName={settings.treeName} changeKey={changeKey} onCareLogged={() => reload()} />
            ) : panel === 'developer' ? (
              <Developer
                snapshot={snapshot}
                behaviour={behaviour}
                expression={expression}
                previews={previews}
                onPreview={setPreview}
                onClearPreviews={clearPreviews}
              />
            ) : (
              <Settings
                settings={settings}
                onUpdateSettings={(next) => {
                  updateSettings(next);
                  notify('Settings saved');
                }}
                onRefreshTelemetry={refreshNow}
                serverStatus={snapshot?.status ?? null}
                onOpenDeveloper={() => setPanel('developer')}
              />
            )}
          </aside>
        </div>
      )}

      {showDetail && display && (
        <DetailView
          health={display}
          message={expression?.message.text ?? ''}
          tip={expression?.message.tip ?? ''}
          telemetry={reading}
          species={ACTIVE_SPECIES}
          hourly={hourly}
          days={charts.days}
          timeline={snapshot?.forecast.timeline ?? []}
          locationName={settings.locationName}
          onClose={() => setShowDetail(false)}
        />
      )}

      <Toast toast={toast} raised={showDiagnostics} />
    </div>
  );
}
