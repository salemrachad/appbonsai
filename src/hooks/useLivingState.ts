import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { LivingSnapshot } from '../api/types';
import { APP_CONFIG } from '../config/appConfig';
import type { PlantEvent } from '../history/historyTypes';

interface Options {
  onNewWatering?: (e: PlantEvent) => void;
  onManualRefreshDone?: (ok: boolean) => void;
}

// Polls the local Appbonsai server for the whole living state (perception, health, behaviour,
// expression). The server does the sensor polling; this only asks "what's the latest?".
export function useLivingState({ onNewWatering, onManualRefreshDone }: Options = {}) {
  const [snapshot, setSnapshot] = useState<LivingSnapshot | null>(null);
  const [serverOffline, setServerOffline] = useState(false);
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const callbacks = useRef({ onNewWatering, onManualRefreshDone });
  callbacks.current = { onNewWatering, onManualRefreshDone };
  const lastWateringId = useRef<number | null | undefined>(undefined);
  const etag = useRef<string | null>(null); // the state shown; the server answers 304 while it's unchanged

  const accept = useCallback((s: LivingSnapshot) => {
    setSnapshot(s);
    setServerOffline(false);
    const w = s.recentEvents.find((e) => e.type === 'watering') ?? null;
    if (lastWateringId.current !== undefined && w && w.id !== lastWateringId.current) callbacks.current.onNewWatering?.(w);
    lastWateringId.current = w?.id ?? null;
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.current(etag.current);
      if (r) {
        etag.current = r.etag;
        accept(r.snapshot);
      } else {
        setServerOffline(false); // unchanged: nothing to render
      }
    } catch {
      setServerOffline(true);
    }
  }, [accept]);

  // Listens to the server's push stream while the page is visible (a background tab or locked phone
  // holds no connection) and catches up the moment it's shown again. If the stream never delivers
  // (an older server, a proxy), it falls back to polling /api/current with the ETag.
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout>;
    let closeStream: (() => void) | null = null;
    let streamWorks = false;
    let streamErrors = 0;
    let polling = false;

    const tick = async () => {
      clearTimeout(timer);
      running = true;
      await load();
      running = false;
      if (!cancelled && !document.hidden) timer = setTimeout(tick, APP_CONFIG.polling.frontendMs);
    };
    const stopStream = () => {
      closeStream?.();
      closeStream = null;
    };
    const fallBackToPolling = () => {
      stopStream();
      polling = true;
      tick();
    };
    const start = () => {
      clearTimeout(timer);
      if (closeStream) return;
      if (polling) {
        if (!running) tick();
        return;
      }
      closeStream = api.stream({
        onState: (s) => {
          streamWorks = true;
          streamErrors = 0;
          etag.current = null; // a later fallback poll fetches in full
          accept(s);
        },
        onOpen: () => setServerOffline(false),
        onError: (closed) => {
          setServerOffline(true);
          if (!streamWorks && (closed || ++streamErrors >= 3)) fallBackToPolling();
          else if (closed) {
            stopStream(); // it delivered before: reopen it ourselves
            timer = setTimeout(start, APP_CONFIG.polling.frontendMs);
          }
        },
      });
    };
    const onVisibility = () => {
      if (document.hidden) {
        stopStream();
        clearTimeout(timer);
      } else if (!closeStream) start();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopStream();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, accept]);

  // Ask the server to read the ESP32 right now
  const refreshNow = useCallback(async () => {
    setIsManualRefresh(true);
    try {
      const s = await api.refresh();
      etag.current = null; // shown without an ETag: the next poll fetches in full
      accept(s);
      callbacks.current.onManualRefreshDone?.(!s.status.collector.lastError);
    } catch {
      setServerOffline(true);
      callbacks.current.onManualRefreshDone?.(false);
    } finally {
      setIsManualRefresh(false);
    }
  }, [accept]);

  return { snapshot, serverOffline, isManualRefresh, refreshNow, reload: load };
}
