import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BonsaiAvatar } from '../../src/components/avatar/BonsaiAvatar';
import type { ExpressionState } from '../../src/expression/expressionTypes';
import { animationOf, loadCss, type Anim } from './css';
import { hex, paintLeaf } from './leafRaster';
import { decodePng, encodePng, type Image } from './png';
import { mul, readRig, type Mat } from './rig';

// The display's tree from the real artwork (firmware/appbonsai_display, ESP32 #2 with the ILI9341).
//
//   npm run display:export [-- --state <file>] [-- --set avatar.eyes=happy] [-- --width 198] [-- --with-extras] [-- --no-dither]
//
// The website's own BonsaiAvatar is rendered to SVG markup (react-dom/server) for one ExpressionState. From it:
//  - the parts that move as one, as images: Chrome (headless, its own empty profile) draws the SVG once per part
//    with the rest hidden by CSS, at the tree's size on the 320×240 landscape screen (440×460 → 198×207 by
//    default, × 0.45, --width): the stand, pot and pillow; the trunk; the face, eyes open and closed (blinking);
//    the branches; each canopy pad without its leaves. Premultiplied RGBA, cropped, kept in flash.
//  - the 124 leaves, read from the markup React emitted (position, angle, tilt, scale, colour, edge, gloss,
//    quiver delay; src/display/rig.ts): the firmware draws each one, so each quivers on its own;
//  - the motions from the website's CSS (scripts/display/css.ts): the body's animation for this state, the
//    trunk's breathing, the two branch sways, the leaf quiver, with the state's sway speed, sway amount and
//    flutter, and its blink interval.
// The rest pose drawn the firmware's way (the parts composited, the leaves rasterized like the firmware does)
// is compared with Chrome's drawing of the whole tree: the report's "rest pose vs Chrome" is how close it is.
//
// The state: --state takes a saved GET /api/current (or a bare ExpressionState); without it, the golden
// master's last /current. --set changes one field (a dotted path; numbers, true/false/null are parsed).
// Visitors, effects, the dream and the hike/yoga props are left out unless --with-extras.
//
// Writes firmware/appbonsai_display/src/assets/tree_rig.h (gitignored, regenerated) and, in build/display/,
// chrome.png (Chrome's whole tree), device.png (it dithered to RGB565, as the panel shows it), rest.png (the
// rest pose drawn the firmware's way), the parts (part_*.png), *_x3.png enlargements and manifest.json.

const ROOT = resolve(import.meta.dirname, '../..');
const ASSETS = join(ROOT, 'firmware/appbonsai_display/src/assets');
const PREVIEW = join(ROOT, 'build/display');

const SCREEN = { w: 320, h: 240 }; // landscape
const VIEW = { w: 440, h: 460 }; // BonsaiAvatar's viewBox
const TREE = { w: 198, h: 0 }; // the tree's box on the screen (--width); its height follows the viewBox
// The page's paper colour (src/index.css --paper, day / night); the scene backdrops come later
const BACKGROUND = { day: [0xf8, 0xf5, 0xf2], night: [0x12, 0x18, 0x26] } as const;

const CHROME_PATHS = [
  process.env.APPBONSAI_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

// The parts, in the firmware's SPR_* order (src/rig_types.h), and the CSS that leaves only that part visible
const ONLY = (sel: string) => `svg *{visibility:hidden} ${sel}, ${sel} *{visibility:visible}`;
const LEAVES = '#bonsai-foliage g[transform^="translate("]';
const PARTS: { id: string; css: string; closedEyes?: boolean }[] = [
  { id: 'base', css: '#bonsai-trunk, #bonsai-branches, #bonsai-foliage{visibility:hidden}' },
  { id: 'trunk', css: `${ONLY('#bonsai-trunk')} #bonsai-face, #bonsai-face *{visibility:hidden}` },
  { id: 'face', css: ONLY('#bonsai-face') },
  { id: 'face_closed', css: ONLY('#bonsai-face'), closedEyes: true },
  { id: 'branches', css: ONLY('#bonsai-branches') },
  ...[1, 2, 3].map((n) => ({ id: `pad${n - 1}`, css: `${ONLY(`#bonsai-foliage > g:nth-child(${n})`)} ${LEAVES}, ${LEAVES} *{visibility:hidden}` })),
];

function args() {
  const argv = process.argv.slice(2);
  const opts = { state: null as string | null, set: [] as string[], width: TREE.w, extras: false, dither: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') opts.state = argv[++i];
    else if (a === '--set') opts.set.push(argv[++i]);
    else if (a === '--width') opts.width = Number(argv[++i]);
    else if (a === '--with-extras') opts.extras = true;
    else if (a === '--no-dither') opts.dither = false;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

function loadState(file: string | null): { expression: ExpressionState; source: string } {
  const path = file ? resolve(file) : join(ROOT, 'scripts/golden/golden.json');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const current = file ? json : json.routes.current;
  const expression = current.expression ?? current.body?.expression ?? (current.avatar ? current : null);
  if (!expression?.avatar) throw new Error(`${path}: no ExpressionState (expected /api/current or an ExpressionState)`);
  return { expression, source: file ? path : 'golden master /current' };
}

function setPath(obj: any, assignment: string) {
  const eq = assignment.indexOf('=');
  if (eq < 0) throw new Error(`--set ${assignment}: expected path=value`);
  const keys = assignment.slice(0, eq).split('.');
  const raw = assignment.slice(eq + 1);
  const value = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
  let at = obj;
  for (const k of keys.slice(0, -1)) at = at[k] ??= {};
  at[keys[keys.length - 1]] = value;
}

// The tree alone: no visitors, effects, dream, boots or mats (they come once the budget is known)
function treeOnly(e: ExpressionState): ExpressionState {
  return {
    ...e,
    avatar: { ...e.avatar, effects: [] },
    visitor: null,
    squirrelTraces: null,
    dragonfly: null,
    sloth: null,
    lucy: null,
    dream: null,
    encounters: [],
    drey: 'none',
    hike: undefined,
    yoga: undefined,
  };
}

function svgOf(state: ExpressionState): string {
  const svg = /<svg[\s\S]*<\/svg>/.exec(renderToStaticMarkup(createElement(BonsaiAvatar, { expression: state })))?.[0];
  if (!svg) throw new Error('BonsaiAvatar rendered no <svg>');
  return svg;
}

// Chrome draws the cells side by side in one page, each its own SVG and CSS; one screenshot, cut apart
function rasterize(cells: { svg: string; css: string }[]): Image[] {
  const chrome = CHROME_PATHS.find((p) => p && existsSync(p));
  if (!chrome) throw new Error('No Chrome or Edge found: set APPBONSAI_CHROME to its executable');
  const dir = mkdtempSync(join(tmpdir(), 'appbonsai-display-'));
  const W = TREE.w * cells.length;
  try {
    const html = join(dir, 'tree.html');
    const png = join(dir, 'tree.png');
    const style = cells.map((c, i) => c.css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, close, sel) => `${close} ${sel.split(',').map((s: string) => `.c${i} ${s.trim()}`).join(', ')}{`)).join('\n');
    writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}` +
        `body{display:flex;width:${W}px}.cell{flex:none;width:${TREE.w}px;height:${TREE.h}px}` +
        `svg{display:block;width:${TREE.w}px;height:${TREE.h}px}\n${style}</style></head><body>` +
        cells.map((c, i) => `<div class="cell c${i}">${c.svg}</div>`).join('') +
        `</body></html>`
    );
    const run = spawnSync(
      chrome,
      [
        '--headless=new',
        `--user-data-dir=${join(dir, 'profile')}`, // never the user's own Chrome profile or running instance
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${W},${TREE.h}`,
        `--screenshot=${png}`,
        pathToFileURL(html).href,
      ],
      { timeout: 90_000, encoding: 'utf8' }
    );
    if (!existsSync(png)) throw new Error(`Chrome made no screenshot (${run.error?.message ?? run.stderr?.slice(-400)})`);
    const img = decodePng(readFileSync(png));
    if (img.width !== W || img.height !== TREE.h) throw new Error(`Chrome's screenshot is ${img.width}×${img.height}, expected ${W}×${TREE.h}`);
    return cells.map((_, i) => {
      const data = new Uint8Array(TREE.w * TREE.h * 4);
      for (let y = 0; y < TREE.h; y++) data.set(img.data.subarray((y * W + i * TREE.w) * 4, (y * W + (i + 1) * TREE.w) * 4), y * TREE.w * 4);
      return { width: TREE.w, height: TREE.h, data };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Sprite {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  px: Uint32Array; // premultiplied 0xAARRGGBB, its colour as RGB565 holds it (the firmware's copy)
}

const to5 = (v: number) => Math.round((v * 31) / 255);
const to6 = (v: number) => Math.round((v * 63) / 255);
const from5 = (v: number) => Math.round((v * 255) / 31);
const from6 = (v: number) => Math.round((v * 255) / 63);

// A part cropped to its pixels, premultiplied, its colour quantized to RGB565 as the firmware keeps it
function sprite(id: string, img: Image): Sprite {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3] > 0) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  if (x1 < 0) return { id, x: 0, y: 0, w: 0, h: 0, px: new Uint32Array(0) };
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * img.width + x0 + x) * 4;
      const a = img.data[i + 3];
      const pm = (c: number) => (img.data[i + c] * a) / 255;
      px[y * w + x] = ((a << 24) | (from5(to5(pm(0))) << 16) | (from6(to6(pm(1))) << 8) | from5(to5(pm(2)))) >>> 0;
    }
  return { id, x: x0, y: y0, w, h, px };
}

// SVG user units → tree-box pixels (preserveAspectRatio xMidYMid meet)
function viewToBox(): Mat {
  const s = Math.min(TREE.w / VIEW.w, TREE.h / VIEW.h);
  return [s, 0, 0, s, (TREE.w - VIEW.w * s) / 2, (TREE.h - VIEW.h * s) / 2];
}

// The rest pose the firmware's way: parts composited in its order, leaves rasterized like it
function restPose(sprites: Sprite[], rig: ReturnType<typeof readRig>, K: Mat, bg: readonly number[]): Image {
  const w = TREE.w, h = TREE.h;
  const img = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) img.set(bg, i * 3);
  const over = (s: Sprite) => {
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const p = s.px[y * s.w + x];
        const a = (p >>> 24) / 255;
        if (!a) continue;
        const i = ((s.y + y) * w + s.x + x) * 3;
        img[i] = ((p >> 16) & 255) + img[i] * (1 - a);
        img[i + 1] = ((p >> 8) & 255) + img[i + 1] * (1 - a);
        img[i + 2] = (p & 255) + img[i + 2] * (1 - a);
      }
  };
  const byId = (id: string) => sprites.find((s) => s.id === id)!;
  for (const id of ['base', 'trunk', 'face', 'branches']) over(byId(id));
  for (let p = 0; p < 3; p++) {
    over(byId(`pad${p}`));
    for (const l of rig.leaves.filter((l) => l.pad === p))
      paintLeaf(img, w, h, mul(K, l.m), { fill: hex(l.fill), edge: l.edge ? hex(l.edge) : null, edgeWidth: l.edgeWidth, rib: l.rib ? hex(l.rib) : null, gloss: l.gloss });
  }
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([Math.round(img[i * 3]), Math.round(img[i * 3 + 1]), Math.round(img[i * 3 + 2]), 255], i * 4);
  return { width: w, height: h, data };
}

function over(img: Image, bg: readonly number[]): Image {
  const data = new Uint8Array(img.data.length);
  for (let p = 0; p < img.width * img.height; p++) {
    const a = img.data[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(img.data[p * 4 + c] * a + bg[c] * (1 - a));
    data[p * 4 + 3] = 255;
  }
  return { width: img.width, height: img.height, data };
}

// How far the rest pose is from Chrome's drawing: mean absolute difference (0-255) and the share of pixels
// that differ by more than 24 in any channel
function compare(a: Image, b: Image): { mean: number; off: number } {
  let sum = 0, off = 0;
  for (let p = 0; p < a.width * a.height; p++) {
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c]);
      sum += d;
      worst = Math.max(worst, d);
    }
    if (worst > 24) off++;
  }
  return { mean: sum / (a.width * a.height * 3), off: off / (a.width * a.height) };
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Ordered dithering to RGB565, shown back as RGB (what the panel shows)
function dithered(img: Image, dither: boolean): Image {
  const out: Image = { width: img.width, height: img.height, data: new Uint8Array(img.data.length) };
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const p = y * img.width + x;
      const t = dither ? (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 : 0.5;
      const level = (c: number, max: number) => Math.min(max, Math.floor((img.data[p * 4 + c] * max) / 255 + t));
      const r = level(0, 31), g = level(1, 63), b = level(2, 31);
      out.data.set([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255], p * 4);
    }
  return out;
}

// C source

const f = (v: number) => {
  const s = (Math.round(v * 1e5) / 1e5).toString();
  return (s.includes('.') || s.includes('e') ? s : `${s}.0`) + 'f';
};
const mat = (m: Mat) => `{${m.map(f).join(', ')}}`;
const rgb = (c: string | null) => (c ? `0x${c.slice(1).toLowerCase()}` : '0');

function animC(name: string, a: Anim | null): string {
  if (!a) return `static const RigAnim ${name} = {0, 0, 0, 0, 0, nullptr}; // none\n`;
  const keys = a.keys.map((k) => `{${[k.at, k.tx, k.ty, k.rot, k.sx, k.sy, k.skew].map(f).join(', ')}}`).join(', ');
  const amp = { none: 'AMP_NONE', sway: 'AMP_SWAY', flutter: 'AMP_FLUTTER' }[a.amp];
  const easing = { 'ease-in-out': 'EASE_IN_OUT', linear: 'EASE_LINEAR', ease: 'EASE' }[a.easing];
  return (
    `// .${a.cls}: @keyframes ${a.name}, ${a.dur}s${a.bySpeed ? ' / sway speed' : ''}, ${a.easing}\n` +
    `static const RigKey ${name}_KEYS[] = {${keys}};\n` +
    `static const RigAnim ${name} = {${f(a.dur)}, ${a.bySpeed ? 1 : 0}, ${amp}, ${easing}, ${a.keys.length}, ${name}_KEYS};\n`
  );
}

function header(o: {
  sprites: Sprite[];
  rig: ReturnType<typeof readRig>;
  anims: { body: Anim | null; trunk: Anim | null; left: Anim | null; right: Anim | null; quiver: Anim | null; fresh: Anim | null };
  K: Mat;
  bg: readonly number[];
  state: ExpressionState;
  hash: string;
  look: string;
  source: string;
}): string {
  const { sprites, rig, anims, K, bg, state } = o;
  // Each row's span from its first to its last visible pixel: premultiplied RGB565 and alpha, packed
  const spriteData = sprites
    .map((s) => {
      const id = s.id.toUpperCase();
      const rows: string[] = [];
      const colour: string[] = [];
      const alpha: string[] = [];
      let off = 0;
      for (let y = 0; y < s.h; y++) {
        const row = s.px.subarray(y * s.w, (y + 1) * s.w);
        let lo = row.findIndex((p) => p >>> 24 > 0);
        let hi = lo < 0 ? -1 : s.w - 1 - [...row].reverse().findIndex((p) => p >>> 24 > 0);
        if (lo < 0) (lo = 0), (hi = -1);
        rows.push(`{${lo}, ${hi - lo + 1}, ${off}}`);
        const span = [...row.subarray(lo, hi + 1)];
        colour.push(span.map((p) => `0x${((to5((p >> 16) & 255) << 11) | (to6((p >> 8) & 255) << 5) | to5(p & 255)).toString(16)}`).join(','));
        alpha.push(span.map((p) => p >>> 24).join(','));
        off += span.length;
      }
      return (
        `// ${s.id}: ${s.w}x${s.h} at (${s.x}, ${s.y}), ${off} pixels in its rows' spans\n` +
        `static const RigRow RIG_ROWS_${id}[] = {${rows.join(', ') || '{0, 0, 0}'}};\n` +
        `static const uint16_t RIG_RGB_${id}[] = {\n${colour.filter(Boolean).join(',\n') || '0'}\n};\n` +
        `static const uint8_t RIG_A_${id}[] = {\n${alpha.filter(Boolean).join(',\n') || '0'}\n};\n`
      );
    })
    .join('\n');
  const swayPivot = (p: (typeof rig.pads)[number]) => p.pivot ?? (p.sway === 'left' ? anims.left : anims.right)?.origin ?? [0, 0];
  const leaves = rig.leaves
    .map((l) => {
      const flags = [l.edge && 'LEAF_EDGE', l.rib && 'LEAF_RIB', l.gloss && 'LEAF_GLOSS', l.fresh && 'LEAF_FRESH'].filter(Boolean).join(' | ') || '0';
      return `  {${mat(l.m)}, ${rgb(l.fill)}, ${rgb(l.edge)}, ${rgb(l.rib)}, ${f(l.edgeWidth)}, ${f(l.delay)}, ${l.pad}, ${flags}}`;
    })
    .join(',\n');
  const m = state.motion;
  return `// Generated by scripts/display/export.ts (npm run display:export). Do not edit.
// The website's BonsaiAvatar for one ExpressionState, as a rig: parts drawn by Chrome, leaves and motions read
// from the website's own markup and CSS. Source: ${o.source}. Look: ${o.look}.
#pragma once
#include <stdint.h>
#include "../rig_types.h"

#define RIG_W ${TREE.w}
#define RIG_H ${TREE.h}
#define RIG_BG_R ${bg[0]}
#define RIG_BG_G ${bg[1]}
#define RIG_BG_B ${bg[2]}
#define RIG_LEAF_COUNT ${rig.leaves.length}
static const char RIG_HASH[] = "${o.hash}";
static const char RIG_LOOK[] = "${o.look.replace(/"/g, "'")}";

// SVG user units -> tree-box pixels
static const float RIG_K[6] = ${mat(K)};

// The state's motion (ExpressionState.motion) and the pivots of the body and the trunk (SVG units)
static const float RIG_SWAY_SPEED = ${f(m.swaySpeed)};
static const float RIG_SWAY_AMOUNT = ${f(m.swayAmount)};
static const float RIG_FLUTTER = ${f(m.flutter)};
static const int32_t RIG_BLINK_MS = ${m.blinkEveryMs ?? 0}; // 0: eyes closed, no blinking
static const float RIG_BODY_ORIGIN[2] = {${rig.bodyOrigin.map(f).join(', ')}};
static const float RIG_TRUNK_ORIGIN[2] = {${rig.trunkOrigin.map(f).join(', ')}};

${animC('RIG_ANIM_BODY', anims.body)}
${animC('RIG_ANIM_TRUNK', anims.trunk)}
${animC('RIG_ANIM_SWAY_LEFT', anims.left)}
${animC('RIG_ANIM_SWAY_RIGHT', anims.right)}
${animC('RIG_ANIM_QUIVER', anims.quiver)}
${animC('RIG_ANIM_QUIVER_FRESH', anims.fresh)}
// The pads: droop, sway (0 left, 1 right), pivot
static const RigPad RIG_PADS[3] = {
${rig.pads.map((p) => `  {${mat(p.droop)}, ${p.sway === 'left' ? 0 : 1}, ${swayPivot(p).map(f).join(', ')}}`).join(',\n')}
};

// The leaves, in the website's drawing order
static const RigLeaf RIG_LEAVES[RIG_LEAF_COUNT] = {
${leaves}
};

${spriteData}
static const RigSprite RIG_SPRITES[SPR_COUNT] = {
${sprites.map((s) => `  {${s.x}, ${s.y}, ${s.w}, ${s.h}, RIG_ROWS_${s.id.toUpperCase()}, RIG_RGB_${s.id.toUpperCase()}, RIG_A_${s.id.toUpperCase()}, sizeof(RIG_A_${s.id.toUpperCase()})}`).join(',\n')}
};
`;
}

function main() {
  const opts = args();
  if (!Number.isInteger(opts.width) || opts.width < 60 || opts.width > SCREEN.w) throw new Error(`--width: a whole number of pixels, 60 to ${SCREEN.w}`);
  TREE.w = opts.width;
  TREE.h = Math.round((TREE.w * VIEW.h) / VIEW.w);

  const { expression, source } = loadState(opts.state);
  const state: ExpressionState = structuredClone(opts.extras ? expression : treeOnly(expression));
  for (const s of opts.set) setPath(state, s);
  const closed: ExpressionState = structuredClone(state);
  closed.avatar.eyes = 'closed'; // what a blink shows (AvatarFace draws the same lids)

  const svg = svgOf(state);
  const rig = readRig(svg);
  const css = loadCss(ROOT);
  const bodyClass = state.avatar.animation.split(/\s+/).find((c) => animationOf(css, c)) ?? null;
  const anims = {
    body: bodyClass ? animationOf(css, bodyClass) : null,
    trunk: animationOf(css, 'trunk-breathe'),
    left: animationOf(css, 'animate-branch-left'),
    right: animationOf(css, 'animate-branch-right'),
    quiver: animationOf(css, 'leaf-quiver'),
    fresh: animationOf(css, 'leaf-fresh'),
  };

  const svgClosed = svgOf(closed);
  const images = rasterize([{ svg, css: '' }, ...PARTS.map((p) => ({ svg: p.closedEyes ? svgClosed : svg, css: p.css }))]);
  const [full, ...parts] = images;
  const sprites = PARTS.map((p, i) => sprite(p.id, parts[i]));

  const bg = BACKGROUND[state.atmosphere?.theme === 'night' ? 'night' : 'day'];
  const K = viewToBox();
  const chrome = over(full, bg);
  const rest = restPose(sprites, rig, K, bg);
  const fidelity = compare(rest, chrome);

  const a = state.avatar;
  const look = `${a.foliage} foliage, eyes ${a.eyes}, mouth ${a.mouth}, droop ${state.leafDroop}, ${a.animation}, ${state.atmosphere?.theme ?? 'day'}${opts.extras ? ', with extras' : ', tree only'}`;
  // In the firmware's RAM: each row's span (3 bytes a pixel: RGB565 + alpha) and 8 bytes a row
  const spanOf = (s: Sprite) => {
    let n = 0;
    for (let y = 0; y < s.h; y++) {
      const row = [...s.px.subarray(y * s.w, (y + 1) * s.w)].map((p) => p >>> 24);
      const lo = row.findIndex(Boolean);
      if (lo >= 0) n += s.w - row.reverse().findIndex(Boolean) - lo;
    }
    return n;
  };
  const ramOf = (s: Sprite) => spanOf(s) * 3 + s.h * 8;
  const bytes = sprites.reduce((n, s) => n + ramOf(s), 0);
  const hash = createHash('sha1')
    .update(JSON.stringify({ rig, anims, K, bg, motion: state.motion }))
    .update(Buffer.concat(sprites.map((s) => Buffer.from(s.px.buffer))))
    .digest('hex')
    .slice(0, 12);

  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(PREVIEW, { recursive: true });
  rmSync(join(ASSETS, 'tree_static.h'), { force: true }); // the static test's image, replaced by the rig
  const out = join(ASSETS, 'tree_rig.h');
  writeFileSync(out, header({ sprites, rig, anims, K, bg, state, hash, look, source: source.replace(ROOT, '.').replace(/\\/g, '/') }));
  writeFileSync(join(PREVIEW, 'chrome.png'), encodePng(chrome));
  writeFileSync(join(PREVIEW, 'device.png'), encodePng(dithered(chrome, opts.dither)));
  writeFileSync(join(PREVIEW, 'device_x3.png'), encodePng(dithered(chrome, opts.dither), 3));
  writeFileSync(join(PREVIEW, 'rest.png'), encodePng(rest));
  writeFileSync(join(PREVIEW, 'rest_x3.png'), encodePng(dithered(rest, opts.dither), 3));
  for (let i = 0; i < PARTS.length; i++) writeFileSync(join(PREVIEW, `part_${PARTS[i].id}.png`), encodePng(parts[i]));
  writeFileSync(join(PREVIEW, 'tree.svg'), svg);
  const manifest = {
    screen: SCREEN,
    tree: TREE,
    scale: K[0],
    look,
    source,
    hash,
    set: opts.set,
    dither: opts.dither,
    background: bg,
    motion: state.motion,
    parts: sprites.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h, spanPixels: spanOf(s), bytes: ramOf(s) })),
    partBytes: bytes,
    leaves: rig.leaves.length,
    animations: Object.fromEntries(Object.entries(anims).map(([k, v]) => [k, v ? `${v.cls} (${v.name}, ${v.dur}s${v.bySpeed ? ' / speed' : ''})` : null])),
    restVsChrome: fidelity,
  };
  writeFileSync(join(PREVIEW, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[display] ${look}`);
  console.log(`[display] ${sprites.length} parts ${(bytes / 1024).toFixed(1)} KB, ${rig.leaves.length} leaves; tree ${TREE.w}x${TREE.h}, hash ${hash}`);
  console.log(`[display] motions: ${Object.values(manifest.animations).filter(Boolean).join(', ')}`);
  console.log(`[display] rest pose vs Chrome: mean difference ${fidelity.mean.toFixed(2)}/255, ${(fidelity.off * 100).toFixed(2)} % of pixels off by more than 24`);
  console.log(`[display] ${out.replace(ROOT, '.')}`);
  console.log(`[display] previews in ${PREVIEW.replace(ROOT, '.')} (chrome.png, rest.png, device_x3.png, rest_x3.png, part_*.png)`);
}

try {
  main();
} catch (err: any) {
  console.error(`[display] ${err?.message ?? err}`);
  process.exit(1);
}
