import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Pause, Play, Star, Trash2, Crop, Leaf } from 'lucide-react';
import { api } from '../api/client';
import { CrownBoxEditor } from '../components/photos/CrownBoxEditor';
import { Viewfinder } from '../components/photos/Viewfinder';
import { loadImage, measureInBrowser, toUploadJpeg, type ImageSource } from '../vision/browserImage';
import { fullnessOf } from '../vision/measure';
import type { PhotoAnalysis, PhotoQuality, PhotoRecord, Roi } from '../vision/visionTypes';
import { civil, dayKey, hhmm, weekdayShort } from '../lib/time';

interface PhotosPageProps {
  onChanged: () => void; // a photo changes the canopy: the living state reloads
}

const QUALITY_WORDS: Record<Exclude<PhotoQuality, 'ok'>, string> = {
  too_dark: 'Too dark to read the leaves. Try again in better light.',
  blurry: 'Too blurry to read the leaves. Hold still and try again.',
  misaligned: 'Framed differently from the reference: line it up with the ghost and try again.',
  no_leaves: 'No leaves inside the crown box. Is the tree in the frame?',
};

// What the panel is doing: the list, the camera, drawing the crown box on a new reference or an existing photo
type Mode =
  | { kind: 'list' }
  | { kind: 'camera' }
  | { kind: 'box'; imageUrl: string; source: ImageSource; takenAt: number | null; photoId: number | null; initial: Roi | null };

// The tree's calendar (its timezone), like every date in the app
const dayLabel = (t: number) => {
  const c = civil(t);
  return `${weekdayShort(t)} ${c.d}/${c.m}`;
};
const pct = (v: number) => `${Math.round(v * 100)} %`;

// The daily photos of the real tree: take one (framed by the ghost of the reference), see what it showed, compare
// two days, play them as a time-lapse. Measuring happens here, in the browser; the server stores the photo.
export const Photos: React.FC<PhotosPageProps> = ({ onChanged }) => {
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [storage, setStorage] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [split, setSplit] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.photos(365);
      setPhotos(r.photos);
      setStorage(r.storage);
      return r.photos;
    } catch {
      setStorage((s) => s ?? false);
      return null;
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const reference = photos.find((p) => p.isReference) ?? null;
  const refFoliage = reference?.analysis?.quality === 'ok' ? reference.analysis.foliage : null;
  const fullness = (p: PhotoRecord) => (p.analysis?.quality === 'ok' ? (p.id === reference?.id ? 1 : fullnessOf(p.analysis.foliage, refFoliage)) : null);
  const newestFirst = useMemo(() => [...photos].sort((a, b) => b.takenAt - a.takenAt), [photos]);
  const readable = useMemo(() => [...photos].filter((p) => fullness(p) !== null).sort((a, b) => a.takenAt - b.takenAt), [photos, refFoliage]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = photos.find((p) => p.id === selectedId) ?? newestFirst[0] ?? null;
  // Compared with: the chosen photo, else the reference (-1: nothing)
  const compare = compareId === -1 ? null : photos.find((p) => p.id === compareId) ?? (selected && reference && selected.id !== reference.id ? reference : null);

  // Time-lapse: the readable photos, oldest first
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    clearInterval(timer.current);
    if (!playing || readable.length < 2) return;
    timer.current = setInterval(() => setFrame((f) => (f + 1) % readable.length), 600);
    return () => clearInterval(timer.current);
  }, [playing, readable.length]);

  // Measure every photo again against the reference (after it or its crown box changed)
  const remeasure = async (ref: PhotoRecord, roi: Roi, all: PhotoRecord[]) => {
    const refImg = await loadImage(api.photoUrl(ref.id));
    const others = all.filter((p) => p.id !== ref.id);
    for (let i = 0; i < others.length; i++) {
      setBusy(`Measuring the photos again (${i + 1}/${others.length})…`);
      try {
        const img = await loadImage(api.photoUrl(others[i].id));
        await api.updatePhoto(others[i].id, { analysis: measureInBrowser(img, roi, refImg) });
      } catch {
        /* a missing image stays as it was */
      }
    }
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    setMessage(null);
    try {
      await job();
    } catch (err: any) {
      setMessage(`Something went wrong: ${err?.message ?? err}`);
    } finally {
      setBusy(null);
      await load();
      onChanged();
    }
  };

  // A new photo from the camera: with a reference, measured against it and stored; without, it becomes the
  // reference once its crown box is drawn
  const captured = (source: ImageSource, takenAt: number) => {
    if (!reference?.roi) {
      const { canvas } = toUploadJpeg(source);
      return setMode({ kind: 'box', imageUrl: canvas.toDataURL('image/jpeg', 0.8), source, takenAt, photoId: null, initial: null });
    }
    setMode({ kind: 'list' });
    run('Reading the leaves…', async () => {
      const refImg = await loadImage(api.photoUrl(reference.id));
      const analysis = measureInBrowser(source, reference.roi!, refImg);
      const jpeg = toUploadJpeg(source);
      const photo = await api.uploadPhoto({ image: jpeg.base64, takenAt, width: jpeg.width, height: jpeg.height, analysis });
      setSelectedId(photo.id);
      setCompareId(null);
      setMessage(resultLine(analysis, fullnessOf(analysis.foliage, refFoliage)));
    });
  };

  // The crown box drawn: a new reference photo, or an existing photo made the reference (or its box redrawn)
  const boxDone = (m: Extract<Mode, { kind: 'box' }>, roi: Roi) => {
    setMode({ kind: 'list' });
    run('Setting the reference…', async () => {
      const analysis = measureInBrowser(m.source, roi, null);
      if (analysis.quality !== 'ok') throw new Error(QUALITY_WORDS[analysis.quality as Exclude<PhotoQuality, 'ok'>]);
      let ref: PhotoRecord;
      if (m.photoId === null) {
        const jpeg = toUploadJpeg(m.source);
        ref = await api.uploadPhoto({ image: jpeg.base64, takenAt: m.takenAt ?? Date.now(), width: jpeg.width, height: jpeg.height, analysis, roi, isReference: true });
      } else ref = await api.updatePhoto(m.photoId, { roi, analysis, isReference: true });
      setSelectedId(ref.id);
      const all = await load();
      if (all && all.length > 1) await remeasure(ref, roi, all);
      setMessage('Reference set: every photo is now measured against this one.');
    });
  };

  const editBox = async (p: PhotoRecord) => {
    const img = await loadImage(api.photoUrl(p.id));
    setMode({ kind: 'box', imageUrl: api.photoUrl(p.id), source: img, takenAt: null, photoId: p.id, initial: reference?.roi ?? null });
  };

  const remove = (p: PhotoRecord) => {
    if (!window.confirm(p.isReference ? 'Delete the reference photo? Photos are not measured until a new one is set.' : 'Delete this photo?')) return;
    run('Deleting…', async () => {
      await api.deletePhoto(p.id);
      setSelectedId(null);
      setCompareId(null);
    });
  };

  if (storage === false)
    return (
      <div className="pb-10 space-y-3">
        <h2 className="serif text-2xl font-medium text-[#2D332A]">Daily photos</h2>
        <p className="sans text-xs text-[#2D332A]/65">This server has no photo storage (a preview build, or it is unreachable).</p>
      </div>
    );

  if (mode.kind === 'camera')
    return (
      <div className="pb-10 space-y-3">
        <h2 className="serif text-2xl font-medium text-[#2D332A]">{reference ? "Today's photo" : 'The first photo'}</h2>
        <Viewfinder ghostUrl={reference ? api.photoUrl(reference.id) : null} roi={reference?.roi ?? null} onCapture={captured} onCancel={() => setMode({ kind: 'list' })} />
      </div>
    );

  if (mode.kind === 'box')
    return (
      <div className="pb-10 space-y-3">
        <h2 className="serif text-2xl font-medium text-[#2D332A]">The crown box</h2>
        <CrownBoxEditor
          imageUrl={mode.imageUrl}
          initial={mode.initial}
          confirmLabel={mode.photoId === null || mode.photoId !== reference?.id ? 'Use as the reference' : 'Save the box'}
          onDone={(roi) => boxDone(mode, roi)}
          onCancel={() => setMode({ kind: 'list' })}
        />
      </div>
    );

  const lapse = playing ? readable[frame % Math.max(1, readable.length)] : null;
  const shown = lapse ?? selected;
  const takenToday = !!newestFirst[0] && dayKey(newestFirst[0].takenAt) === dayKey(Date.now());

  return (
    <div className="pb-10 space-y-5">
      <div className="space-y-1">
        <h2 className="serif text-2xl font-medium text-[#2D332A]">Daily photos</h2>
        <p className="sans text-xs text-[#2D332A]/60">
          One photo a day from the same spot. The app reads the leaves: how full the canopy is against the reference, and how many are yellowing. The tree's canopy follows it, and leaves dropped between photos count as a small, fading strain.
        </p>
      </div>

      <button
        disabled={!!busy || storage === null}
        onClick={() => setMode({ kind: 'camera' })}
        className="w-full py-3.5 rounded-full bg-[#4A6741] hover:bg-[#3D5535] text-white sans text-sm font-medium shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
      >
        <Camera className="w-4 h-4" />
        {!reference ? 'Take the first photo (the reference)' : takenToday ? 'Take another photo' : "Take today's photo"}
      </button>
      {busy && <p className="sans text-xs text-[#4A6741]">{busy}</p>}
      {message && <p className="sans text-xs text-[#2D332A]/75 p-3 rounded-xl bg-[#4A6741]/8 border border-[#4A6741]/15">{message}</p>}
      {!reference && photos.length === 0 && (
        <p className="sans text-[11px] text-[#2D332A]/55">
          Start with a photo of the tree at its fullest, from a spot you can stand at every day (mark it on the floor). You then draw a box around the crown; every later photo is measured inside that box and framed with the help of a faint ghost of this one.
        </p>
      )}

      {shown && (
        <div className="space-y-2">
          <div className="relative w-full rounded-2xl overflow-hidden bg-black/5">
            <img src={api.photoUrl(shown.id)} alt={`The tree on ${dayLabel(shown.takenAt)}`} className="block w-full" />
            {!lapse && compare && compare.id !== shown.id && (
              <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                <img src={api.photoUrl(compare.id)} alt="" className="block w-full h-full object-fill" />
              </div>
            )}
            {!lapse && compare && compare.id !== shown.id && <div className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none" style={{ left: `${split}%` }} />}
            {reference?.roi && !lapse && (
              <div className="absolute border border-dashed border-white/70 rounded pointer-events-none" style={{ left: `${reference.roi.x * 100}%`, top: `${reference.roi.y * 100}%`, width: `${reference.roi.w * 100}%`, height: `${reference.roi.h * 100}%` }} />
            )}
            <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white sans text-[11px]">
              {dayLabel(shown.takenAt)} {hhmm(shown.takenAt)}
              {fullness(shown) !== null ? ` · ${pct(fullness(shown)!)}` : ''}
            </span>
          </div>
          {!lapse && photos.length > 1 && (
            <label className="flex items-center gap-2 sans text-[11px] text-[#2D332A]/60">
              Compare with
              <select
                value={compare && compare.id !== shown.id ? compare.id : ''}
                onChange={(e) => setCompareId(e.target.value ? Number(e.target.value) : -1)}
                className="flex-1 px-2 py-1 rounded-lg border border-[#D8D2C9] bg-white/70 sans text-[11px]"
              >
                <option value="">nothing</option>
                {newestFirst
                  .filter((p) => p.id !== shown.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {dayLabel(p.takenAt)} {hhmm(p.takenAt)}
                      {p.isReference ? ' (reference)' : ''}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!lapse && compare && compare.id !== shown.id && (
            <label className="flex items-center gap-3 sans text-[11px] text-[#2D332A]/60">
              <span className="whitespace-nowrap">{dayLabel(compare.takenAt)}</span>
              <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} className="flex-1 accent-[#4A6741]" />
              <span className="whitespace-nowrap">{dayLabel(shown.takenAt)}</span>
            </label>
          )}
          {!lapse && <PhotoFacts photo={shown} fullness={fullness(shown)} isReference={shown.id === reference?.id} />}
          {!lapse && (
            <div className="flex flex-wrap gap-2">
              {shown.id !== reference?.id && (
                <button disabled={!!busy} onClick={() => editBox(shown)} className={chip}>
                  <Star className="w-3.5 h-3.5" /> Make this the reference
                </button>
              )}
              {shown.id === reference?.id && (
                <button disabled={!!busy} onClick={() => editBox(shown)} className={chip}>
                  <Crop className="w-3.5 h-3.5" /> Redraw the crown box
                </button>
              )}
              <button disabled={!!busy} onClick={() => remove(shown)} className={chip}>
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              {readable.length >= 2 && (
                <button
                  onClick={() => {
                    setFrame(0);
                    setPlaying(true);
                  }}
                  className={chip}
                >
                  <Play className="w-3.5 h-3.5" /> Time-lapse
                </button>
              )}
            </div>
          )}
          {lapse && (
            <button onClick={() => setPlaying(false)} className={chip}>
              <Pause className="w-3.5 h-3.5" /> Stop the time-lapse
            </button>
          )}
        </div>
      )}

      {newestFirst.length > 0 && (
        <div className="space-y-2">
          <h3 className="sans text-[10px] font-bold uppercase tracking-widest text-[#2D332A]/50">All photos</h3>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {newestFirst.map((p) => {
              const f = fullness(p);
              const on = p.id === shown?.id;
              const cmp = p.id === compare?.id && !on;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setPlaying(false);
                    setSelectedId(p.id);
                  }}
                  className={`relative shrink-0 w-20 rounded-xl overflow-hidden border-2 cursor-pointer ${on ? 'border-[#4A6741]' : cmp ? 'border-[#D49B53]' : 'border-transparent'}`}
                  title={cmp ? 'Compared with' : undefined}
                >
                  <img src={api.photoUrl(p.id)} alt="" loading="lazy" className="block w-full h-20 object-cover" />
                  <span className="absolute bottom-0 inset-x-0 bg-black/45 text-white sans text-[9.5px] py-0.5">
                    {dayLabel(p.takenAt)}
                    {p.isReference ? ' ★' : f !== null ? ` · ${pct(f)}` : ' · –'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const chip = 'px-3 py-1.5 rounded-full border border-[#D8D2C9] sans text-[11px] font-semibold text-[#2D332A]/70 hover:border-[#4A6741] hover:text-[#4A6741] flex items-center gap-1.5 disabled:opacity-40 cursor-pointer';

function resultLine(a: PhotoAnalysis, fullness: number | null): string {
  if (a.quality !== 'ok') return `Saved, but not measured. ${QUALITY_WORDS[a.quality]}`;
  const yellow = a.yellow + a.brown;
  return `Saved. The canopy looks ${fullness !== null ? pct(fullness) : '?'} full${yellow >= 0.05 ? `, with ${yellow >= 0.15 ? 'several' : 'a few'} yellow leaves (${pct(yellow)})` : ', no yellow leaves to speak of'}.`;
}

const PhotoFacts: React.FC<{ photo: PhotoRecord; fullness: number | null; isReference: boolean }> = ({ photo, fullness, isReference }) => {
  const a = photo.analysis;
  if (!a) return <p className="sans text-[11px] text-[#2D332A]/55">Not measured.</p>;
  if (a.quality !== 'ok') return <p className="sans text-[11px] text-[#2D332A]/60">Not measured: {QUALITY_WORDS[a.quality].toLowerCase()}</p>;
  return (
    <div className="grid grid-cols-3 gap-2">
      <Fact label="Canopy" value={isReference ? 'reference' : fullness !== null ? pct(fullness) : '–'} />
      <Fact label="Yellowing" value={pct(a.yellow + a.brown)} />
      <Fact label="Leaf cover" value={pct(a.foliage)} hint="share of the crown box" />
    </div>
  );
};

const Fact: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1]" title={hint}>
    <div className="sans text-[10px] uppercase tracking-widest font-bold text-[#2D332A]/45 flex items-center gap-1">
      <Leaf className="w-3 h-3 text-[#4A6741]" />
      {label}
    </div>
    <div className="serif text-lg text-[#2D332A]">{value}</div>
  </div>
);
