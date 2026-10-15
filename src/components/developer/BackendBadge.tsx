import React from 'react';
import type { BackendInfo } from '../../api/types';
import { BACKEND } from '../../config/backend';
import { describeBackend } from './BackendPanel';

// Development builds only: a small header badge saying which backend (and so which database) this is.
export const BackendBadge: React.FC<{ remote: boolean; mode: BackendInfo['mode'] | undefined; offline: boolean }> = ({ remote, mode, offline }) => {
  const d = describeBackend(remote, mode);
  const style =
    offline || d.tone === 'unknown'
      ? 'bg-[#C14B3D]/10 text-[#A63629] border-[#C14B3D]/30'
      : d.tone === 'dev'
      ? 'bg-[#D49B53]/15 text-[#8F5E24] border-[#D49B53]/40'
      : 'bg-[#4A6741]/10 text-[#334D2E] border-[#4A6741]/30';
  const label = d.tone === 'dev' ? 'LOCAL DEV DB' : remote ? `Pi · ${BACKEND.displayUrl.replace(/^https?:\/\//, '').replace(/\/api$/, '')}` : d.title;
  return (
    <span className={`sans text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0 ${style}`} title={`Backend: ${d.title}\n${BACKEND.displayUrl}\n${d.db}`}>
      {offline ? `${label} · offline` : label}
    </span>
  );
};
