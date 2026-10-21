import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { loadImage } from '../../vision/browserImage';
import type { Roi } from '../../vision/visionTypes';

interface ViewfinderProps {
  ghostUrl: string | null; // the reference photo, shown faintly over the camera so every day is framed alike
  roi: Roi | null; // the crown box, outlined
  onCapture: (source: HTMLCanvasElement | HTMLImageElement, takenAt: number) => void;
  onCancel: () => void;
}

// The phone's back camera with the reference photo as a ghost over it. Without camera access (refused, or an
// old browser) the phone's own camera app or a picked file does the same job, just without the ghost.
export const Viewfinder: React.FC<ViewfinderProps> = ({ ghostUrl, roi, onCapture, onCancel }) => {
  const video = useRef<HTMLVideoElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(3 / 4);
  const [ghost, setGhost] = useState(0.35);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot open the camera here.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        v.onloadedmetadata = () => {
          if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
          v.play().catch(() => {});
        };
      })
      .catch(() => setError('No camera access: allow it in the browser, or use the camera app below.'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    onCapture(c, Date.now());
  };

  const picked = async (f: File | undefined) => {
    if (!f) return;
    try {
      const img = await loadImage(f);
      // A photo from the camera app keeps the time it was taken; never in the future
      onCapture(img, Math.min(Date.now(), f.lastModified || Date.now()));
    } catch {
      setError("Couldn't open that image.");
    }
  };

  return (
    <div className="space-y-3">
      {!error && (
        <div className="relative w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: String(aspect) }}>
          <video ref={video} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-fill" />
          {ghostUrl && <img src={ghostUrl} alt="" className="absolute inset-0 w-full h-full object-fill pointer-events-none" style={{ opacity: ghost }} />}
          {roi && (
            <div
              className="absolute border-2 border-dashed border-white/80 rounded-md pointer-events-none"
              style={{ left: `${roi.x * 100}%`, top: `${roi.y * 100}%`, width: `${roi.w * 100}%`, height: `${roi.h * 100}%` }}
            />
          )}
          <button onClick={onCancel} className="absolute top-2 right-2 p-2 rounded-full bg-black/45 text-white cursor-pointer" title="Close the camera">
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={capture}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full bg-white/90 border-4 border-white shadow-lg flex items-center justify-center cursor-pointer active:scale-95"
            title="Take the photo"
          >
            <Camera className="w-6 h-6 text-[#2D332A]" />
          </button>
        </div>
      )}
      {!error && ghostUrl && (
        <label className="flex items-center gap-3 sans text-[11px] text-[#2D332A]/60">
          Ghost
          <input type="range" min={0} max={0.7} step={0.05} value={ghost} onChange={(e) => setGhost(Number(e.target.value))} className="flex-1 accent-[#4A6741]" />
        </label>
      )}
      {!error && ghostUrl && <p className="sans text-[11px] text-[#2D332A]/55">Line the pot and trunk up with the faint reference photo, then take it.</p>}
      {error && <p className="sans text-xs text-[#2D332A]/65">{error}</p>}
      <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => picked(e.target.files?.[0])} />
      <div className="flex gap-2">
        <button onClick={() => file.current?.click()} className="flex-1 py-2.5 rounded-full border border-[#D8D2C9] sans text-xs font-semibold text-[#2D332A]/70 hover:border-[#4A6741] hover:text-[#4A6741] flex items-center justify-center gap-2 cursor-pointer">
          <ImagePlus className="w-4 h-4" />
          Camera app or a saved photo
        </button>
        {error && (
          <button onClick={onCancel} className="px-4 py-2.5 rounded-full border border-[#D8D2C9] sans text-xs font-semibold text-[#2D332A]/60 cursor-pointer">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
