import React, { useCallback, useEffect, useState } from 'react';
import { Droplet, Sun, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import type { CalibrationSaveResult, CalibrationState, CaptureResult, ServerStatus } from '../api/types';

type Sensor = 'soil' | 'light';
type Step = 'idle' | 'first' | 'second' | 'review' | 'manual';

// Wording for each sensor's two references. The workflow is the same; the meaning is honest per sensor.
const TEXT: Record<Sensor, { title: string; first: string; second: string; firstHelp: string; secondHelp: string; note: string; unitNote: string }> = {
  soil: {
    title: 'Soil probe',
    first: 'Dry reference',
    second: 'Wet reference',
    firstHelp:
      'Use the bonsai soil when it is genuinely dry enough that you would normally water it. Leave the probe where it lives in the pot and keep it still.',
    secondHelp: 'Now water thoroughly, let it drain for 10–15 minutes, and keep the probe in place. Don’t use a glass of water: it must be the real wet soil.',
    note: 'Watering detection is paused automatically while you calibrate.',
    unitNote: '0% = your dry reference, 100% = your watered-and-drained reference.',
  },
  light: {
    title: 'Light sensor (relative, not lux)',
    first: 'Dark reference',
    second: 'Bright reference',
    firstHelp: 'Cover the light sensor completely (a cup or your hand) so it reads true darkness.',
    secondHelp: 'Uncover it in normal bright daylight on the balcony, where the tree usually stands.',
    note: 'This makes the light % relative to this sensor and spot. It is not lux.',
    unitNote: '100% = relative to your bright reference, not “maximum sunlight” for the tree.',
  },
};

const time = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function CaptureLine({ c }: { c: CaptureResult }) {
  return (
    <div className="sans text-[11px] text-[#2D332A]/75">
      Raw <strong className="font-mono">{c.mean}</strong> from {c.n} readings ({c.min}–{c.max}, ±{c.stdev})
      {c.warnings.map((w) => (
        <div key={w} className="text-[#8F5E24]">⚠ {w}</div>
      ))}
    </div>
  );
}

// Guided calibration for one sensor: two captured references → review (preview of the current %) → save.
function SensorCalibration({ sensor, state, onChanged }: { sensor: Sensor; state: CalibrationState | null; onChanged: () => void }) {
  const t = TEXT[sensor];
  const [step, setStep] = useState<Step>('idle');
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState<CaptureResult | null>(null);
  const [b, setB] = useState<CaptureResult | null>(null);
  const [check, setCheck] = useState<CalibrationSaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = state?.calibration[sensor] ?? null;

  const capture = async (which: 'a' | 'b') => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.captureCalibration(sensor);
      which === 'a' ? setA(r) : setB(r);
    } catch (e: any) {
      setError(`Capture failed: ${e?.message ?? e}. Is the Appbonsai server running and the ESP32 reachable?`);
    } finally {
      setBusy(false);
    }
  };

  const body = (confirm: boolean, dryRun: boolean) =>
    sensor === 'soil'
      ? api.saveSoilCalibration({ dryRaw: a!.mean, wetRaw: b!.mean, dry: a!, wet: b!, confirm, dryRun })
      : api.saveLightCalibration({ darkRaw: a!.mean, brightRaw: b!.mean, dark: a!, bright: b!, confirm, dryRun });

  const review = async () => {
    setBusy(true);
    try {
      setCheck(await body(false, true));
      setStep('review');
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await body(true, false);
      setCheck(r);
      if (r.saved) {
        reset();
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep('idle');
    setA(null);
    setB(null);
    setCheck(null);
    setError(null);
  };

  const remove = async () => {
    await api.clearCalibration(sensor);
    onChanged();
  };

  const Icon = sensor === 'soil' ? Droplet : Sun;
  const btn = 'px-3 py-1.5 rounded-lg sans text-[11px] font-semibold cursor-pointer disabled:opacity-50';

  return (
    <div className="p-3 rounded-xl bg-white/70 border border-[#EAE6E1] space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="sans text-xs font-bold text-[#2D332A] flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-[#356077]" /> {t.title}
        </span>
        {step === 'idle' && (
          <div className="flex gap-1.5">
            {sensor === 'light' && (
              <button onClick={() => setStep('manual')} className={`${btn} border border-[#356077]/40 text-[#356077] hover:bg-[#356077]/10`}>
                Set min / max
              </button>
            )}
            <button onClick={() => setStep('first')} className={`${btn} bg-[#356077] text-white hover:bg-[#284B5D]`}>
              {current ? 'Recalibrate' : 'Calibrate'}
            </button>
          </div>
        )}
      </div>

      <p className="sans text-[11px] text-[#2D332A]/60">
        {current
          ? sensor === 'soil'
            ? `Calibrated (${'dryRaw' in current ? `dry ${current.dryRaw} · wet ${current.wetRaw}` : ''}, ${current.method}, ${time(current.savedAt)}).`
            : `Calibrated (${'darkRaw' in current ? `min ${current.darkRaw} · max ${current.brightRaw}` : ''}, ${current.method === 'manual' ? 'set by hand' : 'guided'}, ${time(current.savedAt)}).`
          : 'Using the ESP32 firmware’s own percentage.'}{' '}
        {current && step === 'idle' && (
          <button onClick={remove} className="underline text-[#A64F34] cursor-pointer">
            Use firmware % instead
          </button>
        )}
      </p>

      {step === 'manual' && sensor === 'light' && (
        <ManualLight current={current && 'darkRaw' in current ? current : null} onDone={() => { reset(); onChanged(); }} onCancel={reset} />
      )}

      {step !== 'idle' && step !== 'manual' && (
        <div className="space-y-2.5 pt-1">
          <p className="sans text-[10.5px] text-[#2D332A]/55">{t.note}</p>

          <div className={`space-y-1.5 ${step === 'first' ? '' : 'opacity-70'}`}>
            <div className="sans text-[11px] font-bold text-[#2D332A]">Step 1 · {t.first}</div>
            <p className="sans text-[11px] text-[#2D332A]/70 leading-relaxed">{t.firstHelp}</p>
            {a && <CaptureLine c={a} />}
            {step === 'first' && (
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => capture('a')} className={`${btn} border border-[#356077]/40 text-[#356077] hover:bg-[#356077]/10`}>
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : a ? 'Capture again' : `Record ${t.first.toLowerCase()} (~30 s)`}
                </button>
                {a && (
                  <button disabled={busy} onClick={() => setStep('second')} className={`${btn} bg-[#356077] text-white`}>
                    Next
                  </button>
                )}
              </div>
            )}
          </div>

          {(step === 'second' || step === 'review') && (
            <div className={`space-y-1.5 ${step === 'second' ? '' : 'opacity-70'}`}>
              <div className="sans text-[11px] font-bold text-[#2D332A]">Step 2 · {t.second}</div>
              <p className="sans text-[11px] text-[#2D332A]/70 leading-relaxed">{t.secondHelp}</p>
              {b && <CaptureLine c={b} />}
              {step === 'second' && (
                <div className="flex gap-2">
                  <button disabled={busy} onClick={() => capture('b')} className={`${btn} border border-[#356077]/40 text-[#356077] hover:bg-[#356077]/10`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : b ? 'Capture again' : `Record ${t.second.toLowerCase()} (~30 s)`}
                  </button>
                  {b && (
                    <button disabled={busy} onClick={review} className={`${btn} bg-[#356077] text-white`}>
                      Review
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'review' && a && b && check && (
            <div className="space-y-1.5 p-2.5 rounded-lg bg-[#FAF7F2] border border-[#EBE4D7]">
              <div className="sans text-[11px] font-bold text-[#2D332A]">Step 3 · Review</div>
              <div className="grid grid-cols-2 gap-x-3 sans text-[11px] text-[#2D332A]/75 font-mono">
                <span>{t.first.split(' ')[0]} raw: {a.mean}</span>
                <span>{t.second.split(' ')[0]} raw: {b.mean}</span>
                <span>Current raw: {check.preview?.raw ?? '–'}</span>
                <span>Current %: {check.preview?.percent ?? '–'}%</span>
              </div>
              <p className="sans text-[10.5px] text-[#2D332A]/55">{t.unitNote}</p>
              {check.errors.map((e) => (
                <div key={e} className="sans text-[11px] text-[#A63629]">✕ {e}</div>
              ))}
              {check.warnings.map((w) => (
                <div key={w} className="sans text-[11px] text-[#8F5E24]">⚠ {w}</div>
              ))}
              <div className="flex gap-2 pt-1">
                <button disabled={busy || check.errors.length > 0} onClick={save} className={`${btn} bg-[#4A6741] text-white hover:bg-[#3D5535]`}>
                  {check.warnings.length ? 'Save anyway' : 'Save'}
                </button>
                <button disabled={busy} onClick={() => { setA(null); setB(null); setCheck(null); setStep('first'); }} className={`${btn} border border-[#D8D2C9] text-[#2D332A]/75`}>
                  Redo
                </button>
                <button disabled={busy} onClick={reset} className={`${btn} text-[#2D332A]/60`}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {step !== 'review' && (
            <button onClick={reset} className="sans text-[11px] text-[#2D332A]/50 underline cursor-pointer">
              Cancel
            </button>
          )}
          {error && <p className="sans text-[11px] text-[#A63629]">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Light min / max typed in by hand (raw ADC): a stopgap until a better sensor, or when the guided capture
// can't be done. Same checks and live preview as the guided flow; saved as method "manual" with history.
function ManualLight({ current, onDone, onCancel }: { current: { darkRaw: number; brightRaw: number } | null; onDone: () => void; onCancel: () => void }) {
  const [min, setMin] = useState(String(current?.darkRaw ?? 0));
  const [max, setMax] = useState(String(current?.brightRaw ?? 4095));
  const [check, setCheck] = useState<CalibrationSaveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const btn = 'px-3 py-1.5 rounded-lg sans text-[11px] font-semibold cursor-pointer disabled:opacity-50';
  const values = { darkRaw: Number(min), brightRaw: Number(max), manual: true };
  const valid = min.trim() !== '' && max.trim() !== '' && Number.isFinite(values.darkRaw) && Number.isFinite(values.brightRaw);

  const run = async (confirm: boolean, dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.saveLightCalibration({ ...values, confirm, dryRun });
      setCheck(r);
      if (r.saved) onDone();
    } catch (e: any) {
      setError(`${e?.message ?? e}. Is the Appbonsai server running?`);
    } finally {
      setBusy(false);
    }
  };
  // Check (validation + preview with the live raw reading) whenever the numbers settle
  useEffect(() => {
    setCheck(null);
    if (!valid) return;
    const t = setTimeout(() => void run(false, true), 500);
    return () => clearTimeout(t);
  }, [min, max]); // eslint-disable-line react-hooks/exhaustive-deps

  const input = 'w-24 px-2 py-1 rounded-lg border border-[#D8D2C9] bg-white sans text-xs font-mono text-[#2D332A] focus:outline-none focus:border-[#356077]';
  return (
    <div className="space-y-2 pt-1">
      <p className="sans text-[11px] text-[#2D332A]/70 leading-relaxed">
        Raw LDR values (0–4095). <strong>Min</strong> reads as 0% (dark), <strong>max</strong> as 100% (your bright reference). Readings outside are clamped. Stored readings are never changed; only how they're read.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="sans text-[11px] text-[#2D332A]/75 space-y-0.5">
          <span className="block font-semibold">Min (dark)</span>
          <input type="number" inputMode="numeric" min={0} max={4095} value={min} onChange={(e) => setMin(e.target.value)} className={input} />
        </label>
        <label className="sans text-[11px] text-[#2D332A]/75 space-y-0.5">
          <span className="block font-semibold">Max (bright)</span>
          <input type="number" inputMode="numeric" min={0} max={4095} value={max} onChange={(e) => setMax(e.target.value)} className={input} />
        </label>
        <div className="sans text-[11px] text-[#2D332A]/70 font-mono pb-1">
          {busy && !check ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : check?.preview?.raw != null ? `now: raw ${check.preview.raw} → ${check.preview.percent}%` : check ? 'now: sensor not reachable' : 'now: –'}
        </div>
      </div>
      {check?.errors.map((e) => (
        <div key={e} className="sans text-[11px] text-[#A63629]">✕ {e}</div>
      ))}
      {check?.warnings.map((w) => (
        <div key={w} className="sans text-[11px] text-[#8F5E24]">⚠ {w}</div>
      ))}
      <p className="sans text-[10.5px] text-[#2D332A]/55">{TEXT.light.unitNote}</p>
      <div className="flex gap-2">
        <button disabled={busy || !valid || !check || check.errors.length > 0} onClick={() => run(true, false)} className={`${btn} bg-[#4A6741] text-white hover:bg-[#3D5535]`}>
          {check?.warnings.length ? 'Save anyway' : 'Save'}
        </button>
        <button disabled={busy} onClick={onCancel} className={`${btn} text-[#2D332A]/60`}>
          Cancel
        </button>
      </div>
      {error && <p className="sans text-[11px] text-[#A63629]">{error}</p>}
    </div>
  );
}

// Settings → ESP32: guided calibration for soil and light, stored on the Appbonsai server with history.
export const CalibrationPanel: React.FC<{ serverStatus: ServerStatus | null }> = ({ serverStatus }) => {
  const [state, setState] = useState<CalibrationState | null>(null);
  const load = useCallback(() => {
    api.calibration().then(setState).catch(() => setState(null));
  }, []);
  useEffect(load, [load]);

  const pausedUntil = serverStatus?.collector.wateringDetection?.suppressedUntil ?? null;
  const togglePause = () => api.pauseWateringDetection(pausedUntil ? 0 : 15).catch(() => {});

  return (
    <div className="pt-3 border-t border-[#EAE6E1] space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="sans text-xs font-bold text-[#2D332A]">Sensor calibration</span>
        <span className="sans text-[10.5px] text-[#2D332A]/45">stored on the Appbonsai server</span>
      </div>
      {!state && <p className="sans text-[11px] text-[#2D332A]/55">Local server not reachable.</p>}
      <SensorCalibration sensor="soil" state={state} onChanged={load} />
      <SensorCalibration sensor="light" state={state} onChanged={load} />

      <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[#D49B53]/8 border border-[#D49B53]/25">
        <span className="sans text-[11px] text-[#2D332A]/75">
          {pausedUntil
            ? `Watering detection paused until ${new Date(pausedUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
            : 'Handling the soil probe for another reason? Pause watering detection.'}
        </span>
        <button type="button" onClick={togglePause} className="px-2.5 py-1 rounded-lg border border-[#D49B53]/50 text-[#8F5E24] sans text-[11px] font-semibold hover:bg-[#D49B53]/15 cursor-pointer shrink-0">
          {pausedUntil ? 'Resume now' : 'Pause 15 min'}
        </button>
      </div>

      {state && state.history.length > 0 && (
        <details>
          <summary className="sans text-[11px] text-[#2D332A]/55 cursor-pointer">Calibration history ({state.history.length})</summary>
          <ul className="mt-1.5 space-y-1">
            {state.history.slice(0, 8).map((h) => (
              <li key={h.id} className="sans text-[10.5px] text-[#2D332A]/65">
                <span className="font-mono">{time(h.timestamp)}</span> · {h.sensor}: {h.note ?? (h.next ? 'calibrated' : 'removed')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
