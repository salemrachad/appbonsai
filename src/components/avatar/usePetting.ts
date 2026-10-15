import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APP_CONFIG } from '../../config/appConfig';
import type { TouchResponse } from '../../expression/expressionTypes';
import { PADS } from './Foliage';

// Petting: a stroke across the foliage. Attention, not care. This hook only animates the answer the
// Expression Engine chose (`expression.touch`) and reports finished SESSIONS; it decides nothing about
// the tree and never sends anything while the pointer moves.
//
// - Tap vs stroke: a press that travels less than STROKE_PX stays a tap (the existing tap reaction).
// - Mouse needs a held button; touch and pen work the same. `touch-action: pan-y` on the container keeps
//   vertical swipes scrolling the page; the browser then cancels the pointer and the stroke just ends.
// - Motion: one damped spring per foliage pad, driven from a single rAF loop that runs only while a
//   stroke or a spring is settling. Transforms are written straight to three <g> elements (no React
//   render per frame). Leaves bend sideways with the hand and may settle a little lower, never higher:
//   petting never lifts a droop.
// - prefers-reduced-motion: no movement, only the blink acknowledgement.

export interface PetSession {
  startedAt: number;
  endedAt: number;
  count: number; // strokes
  activeMs: number; // time with the hand actually on the tree
}

const STROKE_PX = 8; // screen px a press must travel to become a stroke
const MAX_BEND = 12; // svg units of sideways bend at full give
const REACH = 1.5; // how far beyond a pad's radius the hand still moves it

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface Spring {
  x: number;
  v: number;
}

export function usePetting(svg: React.RefObject<SVGSVGElement | null>, touch: TouchResponse | null, onSession?: (s: PetSession) => void) {
  const pads = useRef<(SVGGElement | null)[]>([null, null, null]);
  const lean = useRef<SVGGElement | null>(null);
  const [blink, setBlink] = useState<{ kind: 'soft_close' | 'slow'; at: number } | null>(null);

  const touchRef = useRef(touch);
  touchRef.current = touch;
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  const press = useRef<{ id: number; x: number; y: number; stroking: boolean; startedAt: number } | null>(null);
  const hand = useRef<{ x: number; y: number; vx: number; t: number } | null>(null);
  const springs = useRef<Spring[]>(PADS.map(() => ({ x: 0, v: 0 })));
  const leanSpring = useRef<Spring>({ x: 0, v: 0 });
  const frame = useRef(0);
  const lastFrame = useRef(0);
  const suppressClick = useRef(false);
  const lastBlinkAt = useRef(0);
  const session = useRef<PetSession | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen → SVG viewBox coordinates (respects the viewBox scaling and letterboxing)
  const toSvg = useCallback(
    (clientX: number, clientY: number) => {
      const el = svg.current;
      const ctm = el?.getScreenCTM();
      if (!el || !ctm) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    },
    [svg]
  );

  const nearFoliage = (p: { x: number; y: number }) => PADS.some((pad) => Math.hypot((p.x - pad.cx) / pad.rx, (p.y - pad.cy) / pad.ry) <= REACH);

  const closeSession = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    const s = session.current;
    session.current = null;
    if (s && s.count > 0) onSessionRef.current?.(s);
  }, []);

  const write = () => {
    springs.current.forEach((s, i) => {
      const g = pads.current[i];
      if (!g) return;
      const pad = PADS[i];
      if (Math.abs(s.x) < 0.02) return g.removeAttribute('transform');
      // Sideways bend about the pad's base; a bend can only settle slightly lower, never lift
      g.setAttribute('transform', `translate(${s.x.toFixed(2)} ${(Math.abs(s.x) * 0.08).toFixed(2)}) rotate(${(s.x * 0.45).toFixed(2)} ${pad.cx} ${pad.cy + pad.ry})`);
    });
    const l = leanSpring.current;
    if (lean.current) {
      if (Math.abs(l.x) < 0.01) lean.current.removeAttribute('transform');
      else lean.current.setAttribute('transform', `rotate(${l.x.toFixed(3)} 220 374)`);
    }
  };

  const step = useCallback((t: number) => {
    const touch = touchRef.current;
    const dt = Math.min(1 / 30, Math.max(0.001, (t - (lastFrame.current || t)) / 1000));
    lastFrame.current = t;
    const h = press.current?.stroking ? hand.current : null;
    let moving = !!h;
    if (h) h.vx *= Math.pow(0.02, dt); // the hand's push fades when it rests

    const k = touch?.stiffness ?? 80;
    const c = touch?.damping ?? 14;
    const give = touch?.give ?? 0.5;
    springs.current.forEach((s, i) => {
      const pad = PADS[i];
      let target = 0;
      if (h) {
        const d = Math.hypot((h.x - pad.cx) / pad.rx, (h.y - pad.cy) / pad.ry);
        const falloff = Math.exp(-((d / REACH) ** 2) * 1.6);
        // Follow the hand's movement, and lean a little toward where it rests
        const push = h.vx * 0.06 + ((h.x - pad.cx) / pad.rx) * 2.5;
        target = Math.max(-MAX_BEND, Math.min(MAX_BEND, push)) * give * falloff;
      }
      s.v += (-k * (s.x - target) - c * s.v) * dt;
      s.x += s.v * dt;
      if (Math.abs(s.x - target) > 0.03 || Math.abs(s.v) > 0.03) moving = true;
    });
    const l = leanSpring.current;
    const leanTarget = h ? Math.sign(h.x - 220) * (touch?.lean ?? 0) * 1.4 : 0;
    l.v += (-k * 0.35 * (l.x - leanTarget) - c * 0.6 * l.v) * dt;
    l.x += l.v * dt;
    if (Math.abs(l.x - leanTarget) > 0.005 || Math.abs(l.v) > 0.005) moving = true;

    write();
    if (moving) frame.current = requestAnimationFrame(step);
    else {
      frame.current = 0;
      lastFrame.current = 0;
    }
  }, []);

  const kick = useCallback(() => {
    if (!frame.current && !reducedMotion()) frame.current = requestAnimationFrame(step);
  }, [step]);

  const startStroke = (now: number) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    if (!session.current) session.current = { startedAt: now, endedAt: now, count: 0, activeMs: 0 };
    const b = touchRef.current?.blink ?? 'none';
    if (b !== 'none' && now - lastBlinkAt.current > 2500) {
      lastBlinkAt.current = now;
      setBlink({ kind: b, at: now });
    }
  };

  const endStroke = (now: number) => {
    const p = press.current;
    press.current = null;
    if (!p?.stroking) return;
    const s = session.current;
    if (s) {
      s.count += 1;
      s.endedAt = now;
      s.activeMs += now - p.startedAt;
    }
    idleTimer.current = setTimeout(closeSession, APP_CONFIG.attention.sessionIdleMs);
    kick(); // let the springs settle back
  };

  const onPointerDown = (e: React.PointerEvent) => {
    suppressClick.current = false; // a touch stroke may end without a click: never swallow the next tap
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = toSvg(e.clientX, e.clientY);
    if (!p || !nearFoliage(p)) return;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, stroking: false, startedAt: Date.now() };
    hand.current = { x: p.x, y: p.y, vx: 0, t: performance.now() };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pr = press.current;
    if (!pr || pr.id !== e.pointerId) return;
    if (!pr.stroking) {
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < STROKE_PX) return;
      pr.stroking = true;
      pr.startedAt = Date.now();
      suppressClick.current = true;
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      startStroke(pr.startedAt);
    }
    const p = toSvg(e.clientX, e.clientY);
    const h = hand.current;
    if (!p || !h) return;
    const t = performance.now();
    const dt = Math.max(1, t - h.t) / 1000;
    const vx = (p.x - h.x) / dt; // svg units per second
    hand.current = { x: p.x, y: p.y, vx: h.vx * 0.6 + vx * 0.4, t };
    kick();
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (press.current?.id !== e.pointerId) return;
    endStroke(Date.now());
  };

  // The click that follows a stroke is not a tap
  const consumeClick = () => {
    const s = suppressClick.current;
    suppressClick.current = false;
    return s;
  };

  // Unmount or leaving the page closes an open session (one report, never a stream)
  useEffect(() => {
    const onHide = () => closeSession();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      cancelAnimationFrame(frame.current);
      closeSession();
    };
  }, [closeSession]);

  return {
    padRef: (i: number) => (el: SVGGElement | null) => {
      pads.current[i] = el;
    },
    leanRef: lean,
    blink,
    consumeClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}
