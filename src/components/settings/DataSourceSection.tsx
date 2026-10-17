import React, { useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Code2, Copy, Cpu, ExternalLink, Wifi } from 'lucide-react';
import { api } from '../../api/client';
import type { ServerStatus } from '../../api/types';
import { apiUrl } from '../../config/backend';
import type { TreeSettings } from '../../settings/settings';
import { ESP32TestResult, isRunningInIframe } from '../../telemetry/ESP32TelemetryProvider';
import { telemetryManager } from '../../telemetry/telemetryManager';
import { CalibrationPanel } from '../CalibrationPanel';
import { SAMPLE_ESP32_CODE } from './esp32SampleSketch';

interface DataSourceSectionProps {
  settings: TreeSettings;
  onUpdateSettings: (s: TreeSettings) => void;
  serverStatus?: ServerStatus | null;
  // Draft fields of the settings form (saved with the rest by "Save Settings")
  dataSource: TreeSettings['dataSource'];
  setDataSource: (v: TreeSettings['dataSource']) => void;
  esp32EndpointUrl: string;
  setEsp32EndpointUrl: (v: string) => void;
  telemetryIntervalMs: number;
  setTelemetryIntervalMs: (v: number) => void;
  esp32Transport: 'pull' | 'push';
  setEsp32Transport: (v: 'pull' | 'push') => void;
}

// Settings → where the readings come from: weather estimate or the ESP32, its address, Test Link (from the
// browser) and Test from server (from the collector), the reading interval, calibration and the sample sketch.
export const DataSourceSection: React.FC<DataSourceSectionProps> = ({
  settings,
  onUpdateSettings,
  serverStatus,
  dataSource,
  setDataSource,
  esp32EndpointUrl,
  setEsp32EndpointUrl,
  telemetryIntervalMs,
  setTelemetryIntervalMs,
  esp32Transport,
  setEsp32Transport,
}) => {
  const push = esp32Transport === 'push';
  // Where the device sends its readings (with "localhost" the device needs this computer's address instead)
  const ingestUrl = new URL(apiUrl('/ingest'), window.location.href).href;
  const devices = serverStatus?.collector.devices ?? [];
  const [serverTest, setServerTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCodeGuide, setShowCodeGuide] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  // ESP32 Test Link state
  const [pingStatus, setPingStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [testSuccessMessage, setTestSuccessMessage] = useState<string>('');
  const [testErrorMessage, setTestErrorMessage] = useState<string>('');
  const [testIsIframeBlocked, setTestIsIframeBlocked] = useState<boolean>(false);

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
    setServerTest({ ok: true, text: 'Testing from the Appbonsai server…' });
    try {
      const r = await api.testFromServer(esp32EndpointUrl);
      setServerTest(
        r.success
          ? { ok: true, text: `Server reached it • Soil ${r.soilMoisture ?? '–'}%${r.soilRaw != null ? ` • Raw ${r.soilRaw}` : ''}` }
          : { ok: false, text: r.error ?? 'Failed' }
      );
    } catch (err: any) {
      setServerTest({ ok: false, text: `Appbonsai server not reachable (${err?.message ?? err}).` });
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(SAMPLE_ESP32_CODE);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
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
          <div className="space-y-1.5">
            <span className="sans text-xs font-bold text-[#2D332A]">How the readings arrive</span>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['pull', 'The server reads the ESP32', 'On the same network, at its address below.'],
                  ['push', 'The ESP32 sends its readings', 'To this server, with its device token. Works from anywhere.'],
                ] as const
              ).map(([value, title, note]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEsp32Transport(value)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    esp32Transport === value ? 'border-[#356077] bg-[#356077]/10 text-[#284B5D]' : 'border-[#EAE6E1] bg-white/60 text-[#2D332A]/70'
                  }`}
                >
                  <span className="sans text-[11px] font-bold flex items-center justify-between gap-1">
                    {title}
                    {esp32Transport === value && <Check className="w-3.5 h-3.5 text-[#356077] shrink-0" />}
                  </span>
                  <span className="sans text-[10.5px] text-[#2D332A]/60">{note}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="sans text-xs font-bold text-[#2D332A] flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-[#356077]" />
              <span>ESP32 Wi-Fi / LAN Endpoint URL{push ? ' (optional: Test Link only)' : ''}</span>
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

          {/* The Appbonsai server: the collector that reads the ESP32, or receives what it sends */}
          <div className="pt-3 border-t border-[#EAE6E1] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="sans text-xs font-bold text-[#2D332A]">Collector (Appbonsai server)</span>
              {!push && (
                <button
                  type="button"
                  onClick={handleTestFromServer}
                  disabled={!esp32EndpointUrl.trim()}
                  className="px-2.5 py-1 rounded-lg border border-[#356077]/40 text-[#356077] sans text-[11px] font-semibold hover:bg-[#356077]/10 cursor-pointer disabled:opacity-50"
                >
                  Test from server
                </button>
              )}
            </div>
            {push && (
              <div className="space-y-1.5 sans text-[11px] text-[#2D332A]/75">
                <p>
                  The device sends to <code className="bg-neutral-100 px-1 py-0.5 rounded font-mono text-[10px] break-all">{ingestUrl}</code>
                </p>
                {devices.length ? (
                  devices.map((d) => (
                    <p key={d.id}>
                      <span className="font-mono text-[10.5px]">{d.id}</span>
                      {d.label ? ` · ${d.label}` : ''} ·{' '}
                      {d.lastSeenAt ? `last push ${new Date(d.lastSeenAt).toLocaleTimeString()}` : 'nothing received yet'}
                      {d.firmware ? ` · firmware ${d.firmware}` : ''}
                    </p>
                  ))
                ) : (
                  <p className="text-amber-900">
                    No device added yet. On the server: <code className="bg-neutral-100 px-1 rounded font-mono text-[10px]">npm run device -- add &lt;device id&gt;</code>, then put the token in the device's setup page.
                  </p>
                )}
              </div>
            )}
            {serverTest && (
              <p className={`sans text-[11px] font-medium ${serverTest.ok ? 'text-emerald-800' : 'text-amber-900'}`}>{serverTest.text}</p>
            )}
            <label className="flex items-center justify-between gap-2 sans text-[11px] text-[#2D332A]/75">
              <span>{push ? 'The ESP32 sends every' : 'Read the ESP32 every'}</span>
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
                  ? push
                    ? `Nothing received lately (${serverStatus.collector.lastError})`
                    : `Last poll failed: ${serverStatus.collector.lastError}`
                  : serverStatus.collector.lastSuccessAt
                  ? `Last reading ${new Date(serverStatus.collector.lastSuccessAt).toLocaleTimeString()} · ${serverStatus.counts.telemetry} readings stored`
                  : 'Waiting for the first reading'
                : 'Appbonsai server not reachable. For local development use npm run dev:local.'}{' '}
              Readings are only collected while the server runs.
            </p>
          </div>

          {/* Guided soil + light calibration (stored on the Appbonsai server) */}
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
  );
};
