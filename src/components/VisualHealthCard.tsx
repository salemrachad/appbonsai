import React from 'react';
import { Camera, Sparkles, Eye, History, Scissors, Layers } from 'lucide-react';

export const VisualHealthCard: React.FC = () => {
  return (
    <div className="p-5 rounded-2xl glass space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#4A6741]/10 text-[#4A6741]">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h3 className="serif text-lg font-medium text-[#2D332A]">Visual Health & Canopy Vision</h3>
            <span className="sans text-[10px] uppercase tracking-widest text-[#2D332A]/50 font-bold">Hardware Vision Module</span>
          </div>
        </div>

        <span className="sans text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#EAE6E1] text-[#2D332A]/60">
          Camera not connected
        </span>
      </div>

      <p className="sans text-xs text-[#2D332A]/70 leading-relaxed">
        Future integration with ESP32-CAM unlocks automated canopy computer vision analysis directly from your physical pot.
      </p>

      {/* Feature capabilities grid */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1] flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[#4A6741]" />
          <span className="sans text-[11px] font-medium text-[#2D332A]/80">New leaf detection</span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1] flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-[#4A6741]" />
          <span className="sans text-[11px] font-medium text-[#2D332A]/80">Canopy volume growth</span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1] flex items-center gap-2">
          <Scissors className="w-3.5 h-3.5 text-[#4A6741]" />
          <span className="sans text-[11px] font-medium text-[#2D332A]/80">Pruning before/after</span>
        </div>
        <div className="p-2.5 rounded-xl bg-white/60 border border-[#EAE6E1] flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-[#4A6741]" />
          <span className="sans text-[11px] font-medium text-[#2D332A]/80">Seasonal time-lapse</span>
        </div>
      </div>
    </div>
  );
};

