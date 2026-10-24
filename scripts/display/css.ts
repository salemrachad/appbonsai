import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The website's avatar animations, read from its own CSS (src/index.css, src/styles/*.css), so the display
// moves by the same keyframes, durations and pivots. Each keyframe's transform is reduced to one form,
// translate · rotate · skewX · scale about the origin: the avatar's motions are a few pixels and a degree or
// two, where the order of the functions makes no visible difference.

export interface Key {
  at: number; // 0-1
  tx: number;
  ty: number;
  rot: number; // degrees (times the amplitude variable, if the animation has one)
  sx: number;
  sy: number;
  skew: number; // skewX, degrees
}

export interface Anim {
  cls: string;
  name: string; // the @keyframes
  dur: number; // seconds
  bySpeed: boolean; // calc(<dur> / var(--sway-speed)): faster with a livelier tree
  amp: 'none' | 'sway' | 'flutter'; // rotate(calc(<deg> * var(--sway-amp | --flutter-amp)))
  easing: 'ease-in-out' | 'linear' | 'ease';
  origin: [number, number] | null; // transform-origin in px (null: the element's own, e.g. 0 0)
  keys: Key[];
}

export function loadCss(root: string): string {
  const styles = join(root, 'src/styles');
  return [join(root, 'src/index.css'), ...readdirSync(styles).filter((f) => f.endsWith('.css')).map((f) => join(styles, f))]
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

// The block after `head {`, braces balanced
function block(css: string, head: RegExp): string | null {
  const m = head.exec(css);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(m.index + m[0].length, i);
  }
  return null;
}

// transform functions with their (possibly nested) arguments
function functions(value: string): { fn: string; args: string[] }[] {
  const out: { fn: string; args: string[] }[] = [];
  const re = /([a-zA-Z]+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < value.length && depth > 0; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
    }
    const inner = value.slice(re.lastIndex, i - 1);
    const args: string[] = [];
    let d = 0;
    let start = 0;
    for (let j = 0; j < inner.length; j++) {
      if (inner[j] === '(') d++;
      else if (inner[j] === ')') d--;
      else if (inner[j] === ',' && d === 0) {
        args.push(inner.slice(start, j).trim());
        start = j + 1;
      }
    }
    args.push(inner.slice(start).trim());
    out.push({ fn: m[1], args });
    re.lastIndex = i;
  }
  return out;
}

// A number from 1.2px, -0.5deg, 1.015, calc(-1.6deg * var(--sway-amp, 1)) or calc(1 + 0.03 * var(--flutter-amp, 1))
function num(arg: string, amp: { v: Anim['amp'] }): number {
  const scaled = /^calc\(\s*(-?[\d.]+)(?:deg|px)?\s*\*\s*var\(--(sway|flutter)-amp/.exec(arg);
  if (scaled) {
    amp.v = scaled[2] as Anim['amp'];
    return Number(scaled[1]);
  }
  const offset = /^calc\(\s*(-?[\d.]+)\s*\+\s*(-?[\d.]+)\s*\*\s*var\(--[\w-]+(?:,\s*([\d.]+))?\)\s*\)$/.exec(arg);
  if (offset) return Number(offset[1]) + Number(offset[2]) * Number(offset[3] ?? 1); // the variable at its default
  const n = /^(-?[\d.]+)(px|deg)?$/.exec(arg);
  if (!n) throw new Error(`Can't read the CSS value ${arg}`);
  return Number(n[1]);
}

function keyFrom(at: number, transform: string, amp: { v: Anim['amp'] }): Key {
  const k: Key = { at, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, skew: 0 };
  if (transform.trim() === 'none') return k;
  for (const { fn, args } of functions(transform)) {
    const v = args.map((a) => num(a, amp));
    if (fn === 'translate') (k.tx += v[0]), (k.ty += v[1] ?? 0);
    else if (fn === 'translateX') k.tx += v[0];
    else if (fn === 'translateY') k.ty += v[0];
    else if (fn === 'rotate') k.rot += v[0];
    else if (fn === 'scale') (k.sx *= v[0]), (k.sy *= v[1] ?? v[0]);
    else if (fn === 'scaleX') k.sx *= v[0];
    else if (fn === 'scaleY') k.sy *= v[0];
    else if (fn === 'skewX') k.skew += v[0];
    else throw new Error(`The display doesn't handle the transform function ${fn}()`);
  }
  return k;
}

// The animation a class runs: its keyframes, duration, easing, origin. null when the class has none.
export function animationOf(css: string, cls: string): Anim | null {
  const rule = block(css, new RegExp(`(?:^|[\\s,}])\\.${cls}\\s*\\{`, 'm'));
  if (!rule) return null;
  const a = /animation:\s*([\w-]+)\s+(calc\(\s*([\d.]+)s\s*\/\s*var\(--sway-speed[^)]*\)\s*\)|([\d.]+)s)\s*([\w-]+(?:\([^)]*\))?)?/.exec(rule);
  if (!a) return null;
  const origin = /transform-origin:\s*(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(rule);
  const frames = block(css, new RegExp(`@keyframes\\s+${a[1]}\\s*\\{`));
  if (!frames) throw new Error(`@keyframes ${a[1]} not found (for .${cls})`);
  const amp = { v: 'none' as Anim['amp'] };
  const keys: Key[] = [];
  for (const m of frames.matchAll(/([\d.%,\s]+|from|to)\s*\{([^}]*)\}/g)) {
    const transform = /transform:\s*([^;]+)/.exec(m[2])?.[1];
    if (!transform) continue; // a stop with only opacity: the transform interpolates across it
    for (const stop of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const at = stop === 'from' ? 0 : stop === 'to' ? 1 : Number(stop.replace('%', '')) / 100;
      keys.push(keyFrom(at, transform, amp));
    }
  }
  keys.sort((x, y) => x.at - y.at);
  const rest: Omit<Key, 'at'> = { tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, skew: 0 };
  if (!keys.length || keys[0].at > 0) keys.unshift({ at: 0, ...rest });
  if (keys[keys.length - 1].at < 1) keys.push({ at: 1, ...rest });
  const easing = (a[5] ?? 'ease') as string;
  return {
    cls,
    name: a[1],
    dur: Number(a[3] ?? a[4]),
    bySpeed: !!a[3],
    amp: amp.v,
    easing: easing === 'linear' ? 'linear' : easing === 'ease-in-out' ? 'ease-in-out' : 'ease',
    origin: origin ? [Number(origin[1]), Number(origin[2])] : null,
    keys,
  };
}
