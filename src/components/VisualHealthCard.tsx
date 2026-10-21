import React, { useEffect, useState } from 'react';
import { Camera, Sparkles, Layers, History, Leaf } from 'lucide-react';
import { api } from '../api/client';
import { fullnessOf } from '../vision/measure';
import type { PhotoRecord } from '../vision/visionTypes';
import { hhmm, weekdayShort } from '../lib/time';

// Settings: the daily photos (the phone is the camera). Where they stand, and the way to the Photos panel.
export const VisualHealthCard: React.FC<{ onOpenPhotos?: () => void }> = ({ onOpenPhotos }) => {
  const [state, setState] = useState<{ photos: PhotoRecord[]; storage: boolean } | null>(null);
  useEffect(() => {
    api.photos(30).then(setState).catch(() => setState(null));
  }, []);
  const photos = state?.photos ?? [];
  const reference = photos.find((p) => p.isReference) ?? null;
  const last = [...photos].sort((a, b) => b.takenAt - a.takenAt)[0] ?? null;
  const lastFull = last?.analysis?.quality === 'ok' ? (last.id === reference?.id ? 1 : fullnessOf(last.analysis.foliage, reference?.analysis?.foliage)) : null;
  const badge = !state ? 'Unknown' : !state.storage ? 'No photo storage' : !reference ? 'No reference yet' : 'Measuring';

  return (
    <div className="p-5 rounded-2xl glass space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#4A6741]/10 text-[#4A6741]">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h3 className="serif text-lg font-medium text-[#2D332A]">Visual Health & Canopy Vision</h3>
            <span className="sans text-[10px] uppercase tracking-widest text-[#2D332A]/50 font-bold">Daily photos from your phone</span>
          </div>
        </div>
        <span className="sans text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#EAE6E1] text-[#2D332A]/60">{badge}</span>
      </div>

      <p className="sans text-xs text-[#2D332A]/70 leading-relaxed">
        One photo a day from the same spot. The app measures how full the canopy is against your reference photo and how many leaves are yellowing; the tree's canopy follows it, and leaves dropped between photos count as a small, fading strain on its vitality.
      </p>
      {last && (
        <p className="sans text-xs text-[#2D332A]/70">
          Last photo {weekdayShort(last.takenAt)} {hhmm(last.takenAt)}
          {lastFull !== null ? ` · canopy ${Math.round(lastFull * 100)} %` : last.analysis ? ' · not measured' : ''}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          { Icon: Layers, label: 'Canopy fullness' },
          { Icon: Leaf, label: 'Yellowing leaves' },
          { Icon: Sparkles, label: 'Leaf drop between days' },
          { Icon: History, label: 'Before/after, time-lapse' },
        ].map(({ Icon, label }) => (
          <div key={label} className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1] flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-[#4A6741]" />
            <span className="sans text-[11px] font-medium text-[#2D332A]/80">{label}</span>
          </div>
        ))}
      </div>
      {onOpenPhotos && (
        <button onClick={onOpenPhotos} className="w-full py-2.5 rounded-full border border-[#4A6741]/40 sans text-xs font-semibold text-[#4A6741] hover:bg-[#4A6741]/8 flex items-center justify-center gap-2 cursor-pointer">
          <Camera className="w-4 h-4" />
          Open the photos
        </button>
      )}
    </div>
  );
};
