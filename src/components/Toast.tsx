import React, { useEffect, useState } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
}

const LEAVE_MS = 350; // matches .toast-out in index.css

// A small, calm confirmation pill at the bottom of the screen: rises in, sinks out (CSS, index.css).
// `raised` lifts it above the bottom sensor debug strip.
export const Toast: React.FC<{ toast: ToastMessage | null; raised?: boolean }> = ({ toast, raised }) => {
  // The last toast stays on screen while it fades out
  const [shown, setShown] = useState<{ toast: ToastMessage; leaving: boolean } | null>(toast && { toast, leaving: false });
  useEffect(() => {
    if (toast) {
      setShown({ toast, leaving: false });
      return;
    }
    setShown((s) => s && { ...s, leaving: true });
    const t = setTimeout(() => setShown(null), LEAVE_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 z-[60] flex justify-center transition-[bottom] duration-300 ${raised ? 'bottom-36' : 'bottom-8'}`}
    >
      {shown && (
        <div
          key={shown.toast.id}
          className={`${shown.leaving ? 'toast-out' : 'toast-in'} sans text-xs font-medium px-4 py-2 rounded-full bg-[#2D332A]/85 text-[#F8F5F2] shadow-lg backdrop-blur-md`}
        >
          {shown.toast.text}
        </div>
      )}
    </div>
  );
};
