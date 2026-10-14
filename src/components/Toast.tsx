import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface ToastMessage {
  id: number;
  text: string;
}

// A small, calm confirmation pill at the bottom of the screen.
// `raised` lifts it above the bottom sensor debug strip.
export const Toast: React.FC<{ toast: ToastMessage | null; raised?: boolean }> = ({ toast, raised }) => (
  <div
    className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center transition-[bottom] duration-300 ${raised ? 'bottom-36' : 'bottom-8'}`}
  >
    <AnimatePresence mode="wait">
      {toast && (
        <motion.div
          key={toast.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="sans text-xs font-medium px-4 py-2 rounded-full bg-[#2D332A]/85 text-[#F8F5F2] shadow-lg backdrop-blur-md"
        >
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);
