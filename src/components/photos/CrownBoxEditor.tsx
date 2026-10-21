import React, { useRef, useState } from 'react';
import type { Roi } from '../../vision/visionTypes';

interface CrownBoxEditorProps {
  imageUrl: string;
  initial: Roi | null;
  confirmLabel: string;
  onDone: (roi: Roi) => void;
  onCancel: () => void;
}

const DEFAULT_ROI: Roi = { x: 0.12, y: 0.05, w: 0.76, h: 0.6 };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// Draw a box around the crown (leaves only: not the pot, not what is behind): drag across the photo.
export const CrownBoxEditor: React.FC<CrownBoxEditorProps> = ({ imageUrl, initial, confirmLabel, onDone, onCancel }) => {
  const box = useRef<HTMLDivElement>(null);
  const [roi, setRoi] = useState<Roi>(initial ?? DEFAULT_ROI);
  const start = useRef<{ x: number; y: number } | null>(null);

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = at(e);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = at(e);
    const s = start.current;
    setRoi({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const up = () => {
    start.current = null;
  };
  const usable = roi.w >= 0.05 && roi.h >= 0.05;

  return (
    <div className="space-y-3">
      <p className="sans text-xs text-[#2D332A]/70">Drag a box around the crown: the leaves only, leaving out the pot and what is behind the tree. Leaves are counted inside it.</p>
      <div ref={box} className="relative w-full rounded-2xl overflow-hidden select-none" style={{ touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <img src={imageUrl} alt="" className="block w-full pointer-events-none" draggable={false} />
        <div className="absolute inset-0 bg-black/35 pointer-events-none" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${roi.y * 100}%, ${roi.x * 100}% ${roi.y * 100}%, ${roi.x * 100}% ${(roi.y + roi.h) * 100}%, ${(roi.x + roi.w) * 100}% ${(roi.y + roi.h) * 100}%, ${(roi.x + roi.w) * 100}% ${roi.y * 100}%, 0 ${roi.y * 100}%)` }} />
        <div
          className="absolute border-2 border-white rounded-md pointer-events-none shadow"
          style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }}
        />
      </div>
      <div className="flex gap-2">
        <button
          disabled={!usable}
          onClick={() => onDone({ x: round3(roi.x), y: round3(roi.y), w: round3(roi.w), h: round3(roi.h) })}
          className="flex-1 py-2.5 rounded-full bg-[#4A6741] text-white sans text-xs font-semibold disabled:opacity-40 cursor-pointer"
        >
          {confirmLabel}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 rounded-full border border-[#D8D2C9] sans text-xs font-semibold text-[#2D332A]/60 cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
