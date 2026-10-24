import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AvatarFace } from '../../src/components/avatar/AvatarFace';
import { GAZE_BASE } from '../../src/components/avatar/BonsaiAvatar';
import { PALETTES } from '../../src/components/avatar/Foliage';
import type { AvatarPresentation, ExpressionState } from '../../src/expression/expressionTypes';
import { checkPupils, checkRules, svgOf, sweep } from './checks';
import { animationOf, loadCss, type Anim } from './css';
import { hex, paintLeaf } from './leafRaster';
import { BLUSHES, brownsOf, curlOf, DROOP_ORIGINS, droopOf, EYES, GAZES, leafLook, lookOf, MOUTHS, pupilOffset, SOILS, SPECS, TONES } from './look';
import { decodePng, encodePng, type Image } from './png';
import { apply, invert, mul, readRig, translate, type Mat } from './rig';

// The display's tree from the real artwork (firmware/appbonsai_display, ESP32 #2 with the ILI9341).
//
//   npm run display:export [-- --state <file>] [-- --set avatar.eyes=happy] [-- --width 198] [-- --no-dither]
//
// A library of the website's BonsaiAvatar, so the display can draw whatever the live ExpressionState asks:
//  - parts that only move, drawn by Chrome (headless, its own empty profile) once each at the tree's size on
//    the 320×240 landscape screen (440×460 → 198×207 by default, × 0.45, --width): the stand, pot and pillow;
//    the trunk; the branches;
//  - parts per look, also by Chrome: each canopy pad without its leaves in all 14 foliage tones (one shape,
//    a colour per tone), the soil per kind, the moss per tone, and the face's layers as AvatarFace draws them
//    (blush per style, sweat, each eye style split around its pupils, each mouth);
//  - the 124 leaves as Foliage.tsx places them (leavesFor), and the website's look rules, which the firmware
//    runs (scripts/display/look.ts, the same in C): the pads' droop, each leaf's tilt, curl, colour and
//    freshness, the pupils for a gaze;
//  - the motions from the website's CSS (scripts/display/css.ts): every body animation, the trunk's breathing,
//    the branch sways, the leaf quiver.
// Checked as it exports: the look rules against React's markup for a sweep of states (every leaf), and the
// library composed the firmware's way against Chrome's drawing of whole trees for a few contrasting states.
//
// --state (a saved GET /api/current, or a bare ExpressionState; default: the golden master's last /current)
// and --set (a dotted path) give the look the display shows until the server's first answer.
//
// Writes firmware/appbonsai_display/src/assets/tree_rig.h (gitignored, regenerated) and, in build/display/,
// for each checked state chrome_<n>.png / device_<n>.png (Chrome's tree, and composed from the library the
// firmware's way), the parts (part_*.png), *_x3.png enlargements and manifest.json.

const ROOT = resolve(import.meta.dirname, '../..');
const ASSETS = join(ROOT, 'firmware/appbonsai_display/src/assets');
const PREVIEW = join(ROOT, 'build/display');

const SCREEN = { w: 320, h: 240 }; // landscape
const VIEW = { w: 440, h: 460 }; // BonsaiAvatar's viewBox
const TREE = { w: 198, h: 0 }; // the tree's box on the screen (--width); its height follows the viewBox
// The page's paper colour (src/index.css --paper, day / night); the scene backdrops come later
const BACKGROUND = { day: [0xf8, 0xf5, 0xf2], night: [0x12, 0x18, 0x26] } as const;
const GRID = 16; // cells a row in Chrome's page

const CHROME_PATHS = [
  process.env.APPBONSAI_CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const ONLY = (sel: string) => `svg *{visibility:hidden} ${sel}, ${sel} *{visibility:visible}`;
const LEAVES = '#bonsai-foliage g[transform^="translate("]';
const SOIL = '#bonsai-pot > ellipse:nth-of-type(1)';
const MOSS = '#bonsai-pot > ellipse:nth-of-type(n+2)';
const CSS = {
  base: `#bonsai-trunk, #bonsai-branches, #bonsai-foliage, ${SOIL}, ${MOSS}{visibility:hidden}`,
  soil: ONLY(SOIL),
  moss: ONLY(MOSS),
  trunk: `${ONLY('#bonsai-trunk')} #bonsai-face, #bonsai-face *{visibility:hidden}`,
  branches: ONLY('#bonsai-branches'),
  pad: (n: number) => `${ONLY(`#bonsai-foliage > g:nth-child(${n + 1})`)} ${LEAVES}, ${LEAVES} *{visibility:hidden}`,
};

function args() {
  const argv = process.argv.slice(2);
  const opts = { state: null as string | null, set: [] as string[], width: TREE.w, dither: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--state') opts.state = argv[++i];
    else if (a === '--set') opts.set.push(argv[++i]);
    else if (a === '--width') opts.width = Number(argv[++i]);
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

// The tree alone: no visitors, effects (but the leaves' own), dream, boots or mats (later, within the budget)
const LEAF_EFFECTS = ['yellow_leaves', 'new_leaves'];
function treeOnly(e: ExpressionState): ExpressionState {
  return {
    ...e,
    avatar: { ...e.avatar, effects: e.avatar.effects.filter((x) => LEAF_EFFECTS.includes(x)), gesture: null, filter: null },
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

function variant(base: ExpressionState, change: (s: ExpressionState) => void): ExpressionState {
  const s = structuredClone(base);
  change(s);
  return s;
}

// --------------------------------------------------------------------------------------------- the face

// The top-level elements of a piece of SVG markup
function elements(s: string): string[] {
  const out: string[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g;
  let depth = 0, start = -1;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
    if (depth === 0) start = m.index;
    if (m[1]) depth--;
    else if (!m[3]) depth++;
    if (depth === 0) out.push(s.slice(start, re.lastIndex));
  }
  return out;
}
const startTag = (el: string) => el.slice(0, el.indexOf('>') + 1);
const inner = (el: string) => el.slice(el.indexOf('>') + 1, el.lastIndexOf('</'));
const svgWrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}">${body}</svg>`;

// AvatarFace's children: defs, [blush ×2], [sweat], eyes, mouth
function faceOf(look: AvatarPresentation, blinking = false) {
  const html = renderToStaticMarkup(createElement('svg', null, createElement(AvatarFace, { look, blinking, gaze: { x: 0, y: 0 } })));
  const face = elements(inner(elements(html)[0]))[0];
  const kids = elements(inner(face));
  return { defs: kids[0], kids };
}

interface EyeLayers {
  under: string;
  pupils: string | null;
  over: string;
  clip: [number, number] | null; // SVG y range the pupils are clipped to
}

// One eye style around its pupils: what lies under them, the pupils (at gaze 0), what lies over them
function eyeLayers(base: AvatarPresentation, style: AvatarPresentation['eyes'], blinking = false): EyeLayers & { defs: string } {
  const { defs, kids } = faceOf({ ...base, eyes: style, blush: 'none', sweat: false }, blinking);
  const eyes = kids[kids.length - 2];
  const isPupils = (el: string) => /^<g style="transform:translate\(/.test(el);
  const isClip = (el: string) => /^<g clip-path="url\(#lidLow\)"/.test(el);
  if (isPupils(eyes)) return { defs, under: '', pupils: eyes, over: '', clip: null };
  const parts = elements(inner(eyes));
  const k = parts.findIndex((e) => isPupils(e) || isClip(e));
  const wrap = (els: string[]) => (els.length ? startTag(eyes) + els.join('') + '</g>' : '');
  if (k < 0) return { defs, under: eyes, pupils: null, over: '', clip: null };
  let pupils = parts[k];
  let clip: [number, number] | null = null;
  if (isClip(pupils)) {
    const rect = /<clipPath id="lidLow"><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/.exec(defs);
    if (!rect) throw new Error("AvatarFace's lidLow clip has changed");
    clip = [Number(rect[1]), Number(rect[1]) + Number(rect[2])];
    pupils = inner(pupils); // drawn whole: the display clips them where they are
  }
  return { defs, under: wrap(parts.slice(0, k)), pupils: wrap([pupils]), over: wrap(parts.slice(k + 1)), clip };
}

// ------------------------------------------------------------------------------------------- Chrome

// Each cell's own ids: in one page the first gradient or clip of a name serves every SVG
function ownIds(svg: string, i: number): string {
  const used = new Set([...svg.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map((m) => m[1])); // not the parts' ids the CSS selects
  return svg
    .replace(/\bid="([^"]+)"/g, (m, id) => (used.has(id) ? `id="${id}-c${i}"` : m))
    .replace(/url\(#([^)]+)\)/g, `url(#$1-c${i})`)
    .replace(/href="#([^"]+)"/g, `href="#$1-c${i}"`);
}

// Chrome draws the cells in a grid, each its own SVG and CSS; one screenshot, cut apart
function rasterize(cells: { svg: string; css: string }[]): Image[] {
  const chrome = CHROME_PATHS.find((p) => p && existsSync(p));
  if (!chrome) throw new Error('No Chrome or Edge found: set APPBONSAI_CHROME to its executable');
  const dir = mkdtempSync(join(tmpdir(), 'appbonsai-display-'));
  const cols = Math.min(GRID, cells.length);
  const rows = Math.ceil(cells.length / cols);
  const W = TREE.w * cols, H = TREE.h * rows;
  try {
    const html = join(dir, 'tree.html');
    const png = join(dir, 'tree.png');
    const style = cells.map((c, i) => c.css.replace(/(^|\})\s*([^{}]+)\{/g, (_m, close, sel) => `${close} ${sel.split(',').map((s: string) => `.c${i} ${s.trim()}`).join(', ')}{`)).join('\n');
    writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}` +
        `body{display:grid;grid-template-columns:repeat(${cols},${TREE.w}px);width:${W}px}.cell{width:${TREE.w}px;height:${TREE.h}px}` +
        `svg{display:block;width:${TREE.w}px;height:${TREE.h}px}\n${style}</style></head><body>` +
        cells.map((c, i) => `<div class="cell c${i}">${ownIds(c.svg, i)}</div>`).join('') +
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
        `--window-size=${W},${H}`,
        `--screenshot=${png}`,
        pathToFileURL(html).href,
      ],
      { timeout: 180_000, encoding: 'utf8' }
    );
    if (!existsSync(png)) throw new Error(`Chrome made no screenshot (${run.error?.message ?? run.stderr?.slice(-400)})`);
    const img = decodePng(readFileSync(png));
    if (img.width !== W || img.height !== H) throw new Error(`Chrome's screenshot is ${img.width}×${img.height}, expected ${W}×${H}`);
    return cells.map((_, i) => {
      const cx = (i % cols) * TREE.w, cy = Math.floor(i / cols) * TREE.h;
      const data = new Uint8Array(TREE.w * TREE.h * 4);
      for (let y = 0; y < TREE.h; y++) data.set(img.data.subarray(((cy + y) * W + cx) * 4, ((cy + y) * W + cx + TREE.w) * 4), y * TREE.w * 4);
      return { width: TREE.w, height: TREE.h, data };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// -------------------------------------------------------------------------------------------- sprites

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

// A part cropped to its pixels (or to `box`), premultiplied, its colour quantized to RGB565 as the firmware keeps it
function sprite(id: string, img: Image, box?: { x: number; y: number; w: number; h: number }): Sprite {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  if (box) (x0 = box.x), (y0 = box.y), (x1 = box.x + box.w - 1), (y1 = box.y + box.h - 1);
  else
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

// The union of several images' visible pixels: one box for a part drawn in every tone
function unionBox(imgs: Image[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const img of imgs)
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++)
        if (img.data[(y * img.width + x) * 4 + 3] > 0) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// SVG user units → tree-box pixels (preserveAspectRatio xMidYMid meet)
function viewToBox(): Mat {
  const s = Math.min(TREE.w / VIEW.w, TREE.h / VIEW.h);
  return [s, 0, 0, s, (TREE.w - VIEW.w * s) / 2, (TREE.h - VIEW.h * s) / 2];
}

// ------------------------------------------------------------------------------------ the library

interface Library {
  base: Sprite;
  trunk: Sprite;
  branches: Sprite;
  pads: Sprite[][]; // [pad][tone], one shape
  soils: Sprite[]; // SOILS, then moist while watering
  moss: Sprite[]; // per tone
  blush: Sprite[]; // BLUSHES
  sweat: Sprite;
  eyes: { under: Sprite; pupils: Sprite; over: Sprite; clip: [number, number] | null; hasPupils: boolean }[]; // EYES
  mouths: Sprite[]; // MOUTHS
}

// The firmware's way of drawing a look at rest (no motion): the library composited, leaves rasterised
interface Face {
  eyes: number;
  mouth: number;
  blush: number;
  sweat: boolean;
  gaze: { x: number; y: number };
  soil: number;
}

function faceFor(a: AvatarPresentation, gaze = { x: 0, y: 0 }): Face {
  const soil = a.soil === 'moist' && a.effects.includes('rain') ? SOILS.length : SOILS.indexOf(a.soil);
  return { eyes: EYES.indexOf(a.eyes), mouth: MOUTHS.indexOf(a.mouth), blush: BLUSHES.indexOf(a.blush), sweat: a.sweat, gaze, soil };
}

// Bilinear, premultiplied, like the firmware; m: the sprite's rest pixels → the box's pixels now
function drawSprite(img: Float32Array, s: Sprite, m: Mat, clip?: [number, number]) {
  if (!s.w) return;
  const inv = invert(m);
  const corners = [apply(m, s.x, s.y), apply(m, s.x + s.w, s.y), apply(m, s.x, s.y + s.h), apply(m, s.x + s.w, s.y + s.h)];
  const X0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 1), X1 = Math.min(TREE.w, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 1);
  const Y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 1), Y1 = Math.min(TREE.h, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 1);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.px[y * s.w + x]);
  for (let Y = Y0; Y < Y1; Y++)
    for (let X = X0; X < X1; X++) {
      const [u, v] = apply(inv, X + 0.5, Y + 0.5);
      if (clip && (v < clip[0] || v >= clip[1])) continue;
      const fu = u - s.x - 0.5, fv = v - s.y - 0.5;
      const iu = Math.floor(fu), iv = Math.floor(fv), tx = fu - iu, ty = fv - iv;
      const p = [at(iu, iv), at(iu + 1, iv), at(iu, iv + 1), at(iu + 1, iv + 1)];
      const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let a = 0, r = 0, g = 0, b = 0;
      p.forEach((q, i) => ((a += (q >>> 24) * w[i]), (r += ((q >> 16) & 255) * w[i]), (g += ((q >> 8) & 255) * w[i]), (b += (q & 255) * w[i])));
      if (!a) continue;
      const k = 1 - a / 255, i = (Y * TREE.w + X) * 3;
      img[i] = Math.min(255, r + img[i] * k);
      img[i + 1] = Math.min(255, g + img[i + 1] * k);
      img[i + 2] = Math.min(255, b + img[i + 2] * k);
    }
}

function compose(lib: Library, e: ExpressionState, K: Mat, bg: readonly number[]): Image {
  const w = TREE.w, h = TREE.h;
  const img = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) img.set(bg, i * 3);
  const look = lookOf(e);
  const face = faceFor(e.avatar);
  const Kinv = invert(K);
  const rest: Mat = [1, 0, 0, 1, 0, 0];
  const tone = TONES.indexOf(look.foliage);
  if (look.blend) throw new Error('compose() draws one tone (the firmware blends two)');
  drawSprite(img, lib.base, rest);
  drawSprite(img, lib.soils[face.soil], rest);
  drawSprite(img, lib.moss[tone], rest);
  drawSprite(img, lib.trunk, rest);
  drawSprite(img, lib.blush[face.blush], rest);
  if (face.sweat) drawSprite(img, lib.sweat, rest);
  const eyes = lib.eyes[face.eyes];
  drawSprite(img, eyes.under, rest);
  if (eyes.hasPupils) {
    // Relative to gaze 0 (the pupils' drawing); the lids' clip stays put (in the pupils' own pixels: less the move)
    const o = pupilOffset(EYES[face.eyes], face.gaze)!, o0 = pupilOffset(EYES[face.eyes], { x: 0, y: 0 })!;
    const dy = (o[1] - o0[1]) * K[3];
    drawSprite(img, eyes.pupils, mul(K, mul(translate(o[0] - o0[0], o[1] - o0[1]), Kinv)), eyes.clip ? [eyes.clip[0] * K[3] + K[5] - dy, eyes.clip[1] * K[3] + K[5] - dy] : undefined);
  }
  drawSprite(img, eyes.over, rest);
  drawSprite(img, lib.mouths[face.mouth], rest);
  drawSprite(img, lib.branches, rest);
  for (let p = 0; p < 3; p++) {
    const droop = droopOf(p, look.droop, look.shrink);
    drawSprite(img, lib.pads[p][tone], mul(K, mul(droop, Kinv)));
    for (const l of SPECS) {
      if (l.pad !== p) continue;
      const n = leafLook(l, look);
      if (n) paintLeaf(img, w, h, mul(K, mul(droop, n.local)), { fill: hex(n.fill), edge: n.edge ? hex(n.edge) : null, edgeWidth: n.edgeWidth, rib: n.rib ? hex(n.rib) : null, gloss: n.gloss });
    }
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

// How far two drawings are: mean absolute difference (0-255) and the share of pixels off by more than 24
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

// ------------------------------------------------------------------------------------------ C source

const f = (v: number) => {
  const s = (Math.round(v * 1e5) / 1e5).toString();
  return (s.includes('.') || s.includes('e') ? s : `${s}.0`) + 'f';
};
const mat = (m: Mat) => `{${m.map(f).join(', ')}}`;
const rgb = (c: string | null | undefined) => (c ? `0x${c.slice(1).toLowerCase()}` : '0');
const cName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');
const names = (list: string[]) => `{${list.map((n) => `"${n}"`).join(', ')}}`;

function animC(name: string, a: Anim | null): string {
  if (!a) return `static const RigAnim ${name} = {0, 0, 0, 0, 0, nullptr}; // none\n`;
  return `${animKeys(name, a)}static const RigAnim ${name} = ${animInit(name, a)};\n`;
}
function animKeys(name: string, a: Anim): string {
  const keys = a.keys.map((k) => `{${[k.at, k.tx, k.ty, k.rot, k.sx, k.sy, k.skew].map(f).join(', ')}}`).join(', ');
  return `// .${a.cls}: @keyframes ${a.name}, ${a.dur}s${a.bySpeed ? ' / sway speed' : ''}, ${a.easing}\nstatic const RigKey ${name}_KEYS[] = {${keys}};\n`;
}
function animInit(name: string, a: Anim): string {
  const amp = { none: 'AMP_NONE', sway: 'AMP_SWAY', flutter: 'AMP_FLUTTER' }[a.amp];
  const easing = { 'ease-in-out': 'EASE_IN_OUT', linear: 'EASE_LINEAR', ease: 'EASE' }[a.easing];
  return `{${f(a.dur)}, ${a.bySpeed ? 1 : 0}, ${amp}, ${easing}, ${a.keys.length}, ${name}_KEYS}`;
}

// Each row's span from its first to its last visible pixel; alpha (and the shape) shared, colour per sprite
function spans(s: Sprite) {
  const rows: string[] = [];
  const ranges: [number, number][] = [];
  let off = 0;
  for (let y = 0; y < s.h; y++) {
    const row = s.px.subarray(y * s.w, (y + 1) * s.w);
    let lo = row.findIndex((p) => p >>> 24 > 0);
    let hi = lo < 0 ? -1 : s.w - 1 - [...row].reverse().findIndex((p) => p >>> 24 > 0);
    if (lo < 0) (lo = 0), (hi = -1);
    rows.push(`{${lo}, ${hi - lo + 1}, ${off}}`);
    ranges.push([lo, hi]);
    off += hi - lo + 1;
  }
  return { rows, ranges, count: off };
}
function colours(s: Sprite, ranges: [number, number][]): string {
  const out: string[] = [];
  ranges.forEach(([lo, hi], y) => {
    const span = [...s.px.subarray(y * s.w + lo, y * s.w + hi + 1)];
    if (span.length) out.push(span.map((p) => `0x${((to5((p >> 16) & 255) << 11) | (to6((p >> 8) & 255) << 5) | to5(p & 255)).toString(16)}`).join(','));
  });
  return out.join(',\n') || '0';
}
function alphas(s: Sprite, ranges: [number, number][]): string {
  const out: string[] = [];
  ranges.forEach(([lo, hi], y) => {
    const span = [...s.px.subarray(y * s.w + lo, y * s.w + hi + 1)];
    if (span.length) out.push(span.map((p) => p >>> 24).join(','));
  });
  return out.join(',\n') || '0';
}

// One sprite's arrays and its RigSprite initializer
function spriteC(s: Sprite): { code: string; init: string; bytes: number } {
  const id = cName(s.id);
  const { rows, ranges, count } = spans(s);
  return {
    code:
      `// ${s.id}: ${s.w}x${s.h} at (${s.x}, ${s.y}), ${count} pixels in its rows' spans\n` +
      `static const RigRow RIG_ROWS_${id}[] = {${rows.join(', ') || '{0, 0, 0}'}};\n` +
      `static const uint16_t RIG_RGB_${id}[] = {\n${colours(s, ranges)}\n};\n` +
      `static const uint8_t RIG_A_${id}[] = {\n${alphas(s, ranges)}\n};\n`,
    init: `{${s.x}, ${s.y}, ${s.w}, ${s.h}, RIG_ROWS_${id}, RIG_RGB_${id}, RIG_A_${id}, ${count}}`,
    bytes: count * 3 + s.h * 8,
  };
}

// The look the display shows until the server answers: the same fields it reads from GET /api/current
function defaultState(e: ExpressionState) {
  const a = e.avatar;
  return {
    expression: {
      avatar: {
        eyes: a.eyes, mouth: a.mouth, blush: a.blush, sweat: a.sweat, posture: a.posture, gaze: a.gaze, foliage: a.foliage, foliageBlend: a.foliageBlend,
        seasonalLeaves: a.seasonalLeaves, canopy: a.canopy, soil: a.soil, effects: a.effects, animation: a.animation,
      },
      leafDroop: e.leafDroop,
      motion: e.motion,
      atmosphere: { scene: e.atmosphere.scene, theme: e.atmosphere.theme },
      tapLabel: e.tapLabel,
    },
  };
}

function header(o: { lib: Library; anims: Record<string, Anim | null>; body: Anim[]; K: Mat; rig: ReturnType<typeof readRig>; state: ExpressionState; hash: string; source: string }) {
  const { lib, anims, body, K, rig } = o;
  let flash = 0;
  const parts: string[] = [];
  const one = (s: Sprite) => {
    const c = spriteC(s);
    parts.push(c.code);
    flash += c.bytes;
    return c.init;
  };
  const fixed = [lib.base, lib.trunk, lib.branches].map(one);
  // The pads: one shape and alpha, a colour array per tone
  const pads = lib.pads.map((tones, p) => {
    const shape = tones[0];
    const { rows, ranges, count } = spans(shape);
    const id = `PAD${p}`;
    parts.push(
      `// pad${p}: ${shape.w}x${shape.h} at (${shape.x}, ${shape.y}), ${count} pixels, ${tones.length} tones\n` +
        `static const RigRow RIG_ROWS_${id}[] = {${rows.join(', ')}};\n` +
        `static const uint8_t RIG_A_${id}[] = {\n${alphas(shape, ranges)}\n};\n` +
        tones.map((t, i) => `static const uint16_t RIG_RGB_${id}_${cName(TONES[i])}[] = {\n${colours(t, ranges)}\n};\n`).join('')
    );
    flash += count * (1 + 2 * tones.length) + shape.h * 8;
    return {
      init: `{${shape.x}, ${shape.y}, ${shape.w}, ${shape.h}, RIG_ROWS_${id}, RIG_RGB_${id}_${cName(TONES[0])}, RIG_A_${id}, ${count}}`,
      tones: `{${TONES.map((t) => `RIG_RGB_${id}_${cName(t)}`).join(', ')}}`,
    };
  });
  const soils = lib.soils.map(one);
  const moss = lib.moss.map(one);
  const blush = lib.blush.map(one);
  const sweat = one(lib.sweat);
  const eyes = lib.eyes.map((e) => `{${one(e.under)}, ${one(e.pupils)}, ${one(e.over)}, ${e.hasPupils ? 1 : 0}, ${e.clip ? 1 : 0}, ${f(e.clip?.[0] ?? 0)}, ${f(e.clip?.[1] ?? 0)}}`);
  const mouths = lib.mouths.map(one);
  const swayPivot = (p: (typeof rig.pads)[number]) => p.pivot ?? (p.sway === 'left' ? anims.left : anims.right)?.origin ?? [0, 0];
  const specs = SPECS.map((l) => `  {${[l.x, l.y, l.angle, l.size, l.r, l.gap, l.delay].map(f).join(', ')}, ${l.pad}, ${l.shade}, ${l.rim ? 1 : 0}}`).join(',\n');
  const palettes = TONES.map((t) => {
    const p = PALETTES[t];
    return `  {{${p.leaf.map(rgb).join(', ')}}, ${rgb(p.shadow)}, ${rgb(p.edge)}, ${p.edge ? 1 : 0}, ${p.gloss ? 1 : 0}, ${brownsOf(t) ? 1 : 0}, ${f(curlOf(t))}}, // ${t}`;
  }).join('\n');
  const code = `// Generated by scripts/display/export.ts (npm run display:export). Do not edit.
// The website's BonsaiAvatar as a library: parts drawn by Chrome, in every look the ExpressionState can ask for,
// leaves placed as Foliage.tsx places them, motions from the website's CSS. Default look: ${o.source}.
#pragma once
#include <stdint.h>
#include "../rig_types.h"

#define RIG_W ${TREE.w}
#define RIG_H ${TREE.h}
#define RIG_LEAF_COUNT ${SPECS.length}
#define RIG_TONES ${TONES.length}
#define RIG_EYES ${EYES.length}
#define RIG_MOUTHS ${MOUTHS.length}
#define RIG_BLUSHES ${BLUSHES.length}
#define RIG_GAZES ${GAZES.length}
#define RIG_SOILS ${SOILS.length + 1}
#define RIG_BODY_ANIMS ${body.length}
static const char RIG_HASH[] = "${o.hash}";
static const uint8_t RIG_BG_DAY[3] = {${BACKGROUND.day.join(', ')}};
static const uint8_t RIG_BG_NIGHT[3] = {${BACKGROUND.night.join(', ')}};

// SVG user units -> tree-box pixels
static const float RIG_K[6] = ${mat(K)};
static const float RIG_BODY_ORIGIN[2] = {${rig.bodyOrigin.map(f).join(', ')}};
static const float RIG_TRUNK_ORIGIN[2] = {${rig.trunkOrigin.map(f).join(', ')}};

// The names the ExpressionState uses, in the library's order (the moist soil while watering is the last soil)
static const char* const RIG_TONE_NAMES[RIG_TONES] = ${names(TONES)};
static const char* const RIG_EYE_NAMES[RIG_EYES] = ${names(EYES)};
static const char* const RIG_MOUTH_NAMES[RIG_MOUTHS] = ${names(MOUTHS)};
static const char* const RIG_BLUSH_NAMES[RIG_BLUSHES] = ${names(BLUSHES)};
static const char* const RIG_SOIL_NAMES[RIG_SOILS - 1] = ${names(SOILS)};
static const char* const RIG_GAZE_NAMES[RIG_GAZES] = ${names(GAZES)};
// Where the eyes rest for each gaze (BonsaiAvatar's GAZE_BASE, px), and how far they wander (later: saccades)
static const float RIG_GAZE_BASE[RIG_GAZES][3] = {${GAZES.map((g) => `{${f(GAZE_BASE[g].x)}, ${f(GAZE_BASE[g].y)}, ${f(GAZE_BASE[g].spread)}}`).join(', ')}};

${animC('RIG_ANIM_TRUNK', anims.trunk)}
${animC('RIG_ANIM_SWAY_LEFT', anims.left)}
${animC('RIG_ANIM_SWAY_RIGHT', anims.right)}
${animC('RIG_ANIM_QUIVER', anims.quiver)}
${animC('RIG_ANIM_QUIVER_FRESH', anims.fresh)}
// The body's motions, by class
${body.map((a) => animKeys(`RIG_BODY_${cName(a.cls)}`, a)).join('')}static const RigNamedAnim RIG_BODY[RIG_BODY_ANIMS] = {
${body.map((a) => `  {"${a.cls}", ${animInit(`RIG_BODY_${cName(a.cls)}`, a)}}`).join(',\n')}
};

// Where each pad droops about (SVG units; BonsaiAvatar's droopTransforms, look.ts DROOP_ORIGINS)
static const float RIG_DROOP_ORIGINS[3][2] = {${DROOP_ORIGINS.map((o) => `{${o.map(f).join(', ')}}`).join(', ')}};
// The pads' sways (0 left, 1 right) and their pivots (SVG units); the droop is the firmware's (droopOf)
static const RigPad RIG_PADS[3] = {
${rig.pads.map((p) => `  {${p.sway === 'left' ? 0 : 1}, ${swayPivot(p).map(f).join(', ')}}`).join(',\n')}
};

// The leaves as Foliage.tsx's leavesFor places them, in drawing order
static const RigLeafSpec RIG_LEAVES[RIG_LEAF_COUNT] = {
${specs}
};
// The foliage palettes the leaves take (Foliage.tsx PALETTES), with the tone's curl and dry brown leaves
static const RigPalette RIG_PALETTES[RIG_TONES] = {
${palettes}
};

${parts.join('\n')}
static const RigSprite RIG_BASE = ${fixed[0]};
static const RigSprite RIG_TRUNK = ${fixed[1]};
static const RigSprite RIG_BRANCHES = ${fixed[2]};
static const RigSprite RIG_PAD_SHAPES[3] = {${pads.map((p) => p.init).join(', ')}};
static const uint16_t* const RIG_PAD_TONES[3][RIG_TONES] = {${pads.map((p) => p.tones).join(', ')}};
static const RigSprite RIG_SOIL[RIG_SOILS] = {${soils.join(', ')}};
static const RigSprite RIG_MOSS[RIG_TONES] = {${moss.join(', ')}};
static const RigSprite RIG_BLUSH[RIG_BLUSHES] = {${blush.join(', ')}};
static const RigSprite RIG_SWEAT = ${sweat};
static const RigEyes RIG_EYES_ART[RIG_EYES] = {${eyes.join(',\n  ')}};
static const RigSprite RIG_MOUTH[RIG_MOUTHS] = {${mouths.join(', ')}};

// The look shown until the server answers (the fields the firmware reads from GET /api/current)
static const char RIG_DEFAULT_STATE[] = ${JSON.stringify(JSON.stringify(defaultState(o.state)))};
`;
  return { code, flash };
}

// ------------------------------------------------------------------------------------------------ main

function main() {
  const opts = args();
  if (!Number.isInteger(opts.width) || opts.width < 60 || opts.width > SCREEN.w) throw new Error(`--width: a whole number of pixels, 60 to ${SCREEN.w}`);
  TREE.w = opts.width;
  TREE.h = Math.round((TREE.w * VIEW.h) / VIEW.w);

  const { expression, source } = loadState(opts.state);
  const state: ExpressionState = treeOnly(structuredClone(expression));
  for (const s of opts.set) setPath(state, s);

  // The rules first: React's markup for a sweep of states against look.ts (no Chrome)
  const neutral = variant(state, (s) => {
    s.avatar = { ...s.avatar, foliage: 'lush', foliageBlend: null, effects: [], posture: 'normal', soil: 'moist', canopy: { fullness: 1, refilling: 0 }, seasonalLeaves: { newGrowth: 0, yellowing: 0, leafDrop: 0 } };
    s.leafDroop = 0;
  });
  const rules = checkRules([...sweep(neutral), state]);
  const pupils = checkPupils(neutral);

  const css = loadCss(ROOT);
  const body = [...new Set([...css.matchAll(/\.(animate-tree-[\w-]+)\s*\{/g)].map((m) => m[1]))].map((c) => animationOf(css, c)).filter((a): a is Anim => !!a);
  const anims = {
    trunk: animationOf(css, 'trunk-breathe'),
    left: animationOf(css, 'animate-branch-left'),
    right: animationOf(css, 'animate-branch-right'),
    quiver: animationOf(css, 'leaf-quiver'),
    fresh: animationOf(css, 'leaf-fresh'),
  };

  // The checked states: the default look, and contrasting ones (droop, shrink, tones, faces, soils, night)
  const checked: ExpressionState[] = [
    state,
    variant(neutral, (s) => Object.assign(s.avatar, { foliage: 'thirsty', eyes: 'sad', mouth: 'frown', blush: 'pale', soil: 'dry' }) && (s.leafDroop = 0.62)),
    variant(neutral, (s) => Object.assign(s.avatar, { foliage: 'frozen', eyes: 'wide', mouth: 'chatter', blush: 'cold', soil: 'frozen', posture: 'shrink' }) && (s.leafDroop = 0.3)),
    variant(neutral, (s) => Object.assign(s.avatar, { foliage: 'tender', eyes: 'worried', mouth: 'wobble', blush: 'normal', effects: ['yellow_leaves'], gaze: 'down' }) && (s.leafDroop = -0.2)),
    variant(neutral, (s) => Object.assign(s.avatar, { foliage: 'deep', eyes: 'drowsy', mouth: 'sleep', blush: 'none', soil: 'wet', sweat: true }) && (s.atmosphere = { ...s.atmosphere, theme: 'night' })),
    variant(neutral, (s) => Object.assign(s.avatar, { foliage: 'scorched', eyes: 'heavy', mouth: 'pant', blush: 'hot', canopy: { fullness: 0.75, refilling: 0.5 } }) && (s.leafDroop = 1)),
  ].map((s) => (s.avatar.foliageBlend ? variant(s, (x) => (x.avatar.foliageBlend = null)) : s));

  // The library's cells for Chrome
  const cells: { svg: string; css: string }[] = [];
  const cell = (svg: string, c = '') => cells.push({ svg, css: c }) - 1;
  const neutralSvg = svgOf(neutral);
  const at = {
    base: cell(neutralSvg, CSS.base),
    trunk: cell(neutralSvg, CSS.trunk),
    branches: cell(neutralSvg, CSS.branches),
    pads: TONES.map((t) => {
      const svg = svgOf(variant(neutral, (s) => (s.avatar.foliage = t)));
      return [0, 1, 2].map((p) => cell(svg, CSS.pad(p)));
    }),
    soils: [...SOILS.map((soil) => cell(svgOf(variant(neutral, (s) => (s.avatar.soil = soil))), CSS.soil)), cell(svgOf(variant(neutral, (s) => (s.avatar.effects = ['rain']))), CSS.soil)],
    moss: TONES.map((t) => cell(svgOf(variant(neutral, (s) => (s.avatar.foliage = t))), CSS.moss)),
    blush: BLUSHES.map((b) => {
      const { defs, kids } = faceOf({ ...neutral.avatar, blush: b, sweat: false });
      return cell(svgWrap(defs + kids.filter((k) => k.startsWith('<circle')).join('')));
    }),
    sweat: (() => {
      const { defs, kids } = faceOf({ ...neutral.avatar, blush: 'none', sweat: true });
      return cell(svgWrap(defs + kids.filter((k) => k.includes('animate-sweat')).join('')));
    })(),
    eyes: EYES.map((style) => {
      const l = eyeLayers(neutral.avatar, style);
      return { under: cell(svgWrap(l.defs + l.under)), pupils: cell(svgWrap(l.defs + (l.pupils ?? ''))), over: cell(svgWrap(l.defs + l.over)), clip: l.clip, hasPupils: !!l.pupils };
    }),
    mouths: MOUTHS.map((mouth) => {
      const { defs, kids } = faceOf({ ...neutral.avatar, mouth, blush: 'none', sweat: false });
      return cell(svgWrap(defs + kids[kids.length - 1]));
    }),
    checked: checked.map((s) => cell(svgOf(s))),
  };
  const images = rasterize(cells);
  const padBoxes = [0, 1, 2].map((p) => unionBox(at.pads.map((t) => images[t[p]])));
  const lib: Library = {
    base: sprite('base', images[at.base]),
    trunk: sprite('trunk', images[at.trunk]),
    branches: sprite('branches', images[at.branches]),
    pads: [0, 1, 2].map((p) => at.pads.map((t, i) => sprite(`pad${p}_${TONES[i]}`, images[t[p]], padBoxes[p]))),
    soils: at.soils.map((c, i) => sprite(`soil_${i < SOILS.length ? SOILS[i] : 'watering'}`, images[c])),
    moss: at.moss.map((c, i) => sprite(`moss_${TONES[i]}`, images[c])),
    blush: at.blush.map((c, i) => sprite(`blush_${BLUSHES[i]}`, images[c])),
    sweat: sprite('sweat', images[at.sweat]),
    eyes: at.eyes.map((e, i) => ({
      under: sprite(`eyes_${EYES[i]}_under`, images[e.under]),
      pupils: sprite(`eyes_${EYES[i]}_pupils`, images[e.pupils]),
      over: sprite(`eyes_${EYES[i]}_over`, images[e.over]),
      clip: e.clip,
      hasPupils: e.hasPupils,
    })),
    mouths: at.mouths.map((c, i) => sprite(`mouth_${MOUTHS[i]}`, images[c])),
  };
  // One shape for every tone of a pad: the colour changes, the coverage doesn't (Chrome's anti-aliasing differs
  // by a few levels at the edges between drawings: the mean is shared, each tone's colour premultiplied by it)
  lib.pads.forEach((tones, p) => {
    const box = padBoxes[p];
    let apart = 0;
    for (let k = 0; k < box.w * box.h; k++) {
      const alphas = tones.map((t) => t.px[k] >>> 24);
      const mean = Math.round(alphas.reduce((s, v) => s + v, 0) / alphas.length);
      if (Math.max(...alphas) - Math.min(...alphas) > 40) apart++;
      tones.forEach((t, i) => {
        const img = images[at.pads[i][p]];
        const x = box.x + (k % box.w), y = box.y + Math.floor(k / box.w);
        // The tone's colour here (where this drawing left the pixel empty, its visible neighbours')
        const rgb = [0, 0, 0];
        let n = 0;
        for (let r = 0; r <= 2 && !n; r++)
          for (let dy = -r; dy <= r; dy++)
            for (let dx = -r; dx <= r; dx++) {
              const j = ((y + dy) * img.width + x + dx) * 4;
              if (x + dx < 0 || y + dy < 0 || x + dx >= img.width || y + dy >= img.height || !img.data[j + 3]) continue;
              rgb[0] += img.data[j], rgb[1] += img.data[j + 1], rgb[2] += img.data[j + 2], n++;
            }
        const pm = (c: number) => (n ? rgb[c] / n : 0) * mean / 255;
        t.px[k] = ((mean << 24) | (from5(to5(pm(0))) << 16) | (from6(to6(pm(1))) << 8) | from5(to5(pm(2)))) >>> 0;
      });
    }
    if (apart > box.w * box.h * 0.01) throw new Error(`Pad ${p} covers other pixels in some tones than in others (${apart} pixels): the tones can't share one shape`);
  });

  const K = viewToBox();
  const fidelity = checked.map((s, i) => {
    const bg = BACKGROUND[s.atmosphere?.theme === 'night' ? 'night' : 'day'];
    const chrome = over(images[at.checked[i]], bg);
    const mine = compose(lib, s, K, bg);
    writeFileSync(join(PREVIEW_DIR(), `chrome_${i}.png`), encodePng(chrome));
    writeFileSync(join(PREVIEW_DIR(), `device_${i}.png`), encodePng(dithered(mine, opts.dither)));
    writeFileSync(join(PREVIEW_DIR(), `device_${i}_x3.png`), encodePng(dithered(mine, opts.dither), 3));
    const a = s.avatar;
    return { look: `${a.foliage}, eyes ${a.eyes}, mouth ${a.mouth}, blush ${a.blush}, soil ${a.soil}, droop ${s.leafDroop}${a.posture === 'shrink' ? ', shrunk' : ''}${s.atmosphere.theme === 'night' ? ', night' : ''}`, ...compare(mine, chrome) };
  });

  const rig = readRig(neutralSvg);
  const hash = createHash('sha1')
    .update(JSON.stringify({ anims, body, K, specs: SPECS, palettes: PALETTES, droop: DROOP_ORIGINS, state: defaultState(state) }))
    .update(Buffer.concat(cells.map((_, i) => Buffer.from(images[i].data.buffer))))
    .digest('hex')
    .slice(0, 12);
  const { code, flash } = header({ lib, anims, body, K, rig, state, hash, source: source.replace(ROOT, '.').replace(/\\/g, '/') });
  mkdirSync(ASSETS, { recursive: true });
  const out = join(ASSETS, 'tree_rig.h');
  writeFileSync(out, code);
  const named: [string, Sprite][] = [
    ['base', lib.base], ['trunk', lib.trunk], ['branches', lib.branches],
    ...lib.pads.map((t, p) => [`pad${p}`, t[TONES.indexOf(state.avatar.foliage)]] as [string, Sprite]),
  ];
  for (const [id, s] of named) writeFileSync(join(PREVIEW_DIR(), `part_${id}.png`), encodePng(spriteImage(s), 3));
  const ram = [lib.base, lib.trunk, lib.branches, ...lib.pads.map((t) => t[0])].reduce((n, s) => n + spans(s).count * 3 + s.h * 8, 0);
  const manifest = { screen: SCREEN, tree: TREE, scale: K[0], source, set: opts.set, hash, rules, pupils, flashBytes: flash, ramBytes: ram, bodyAnimations: body.map((a) => a.cls), fidelity };
  writeFileSync(join(PREVIEW_DIR(), 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`[display] look rules = the website's: ${rules.states} states, ${rules.leaves} leaves; pupils ${pupils} gazes`);
  console.log(`[display] library: ${TONES.length} tones x 3 pads, ${SOILS.length + 1} soils, ${EYES.length} eyes, ${MOUTHS.length} mouths, ${BLUSHES.length} blushes, ${body.length} body motions; ${(flash / 1024).toFixed(1)} KB in flash, ${(ram / 1024).toFixed(1)} KB copied to RAM`);
  for (const [i, r] of fidelity.entries()) console.log(`[display] ${i === 0 ? 'default' : `check ${i}`} (${r.look}): vs Chrome mean ${r.mean.toFixed(2)}/255, ${(r.off * 100).toFixed(2)} % of pixels off by more than 24`);
  console.log(`[display] ${out.replace(ROOT, '.')}, hash ${hash}`);
  console.log(`[display] previews in ${PREVIEW.replace(ROOT, '.')} (chrome_<n>.png, device_<n>_x3.png, part_*.png)`);
}

function PREVIEW_DIR() {
  mkdirSync(PREVIEW, { recursive: true });
  return PREVIEW;
}

// A sprite back as an image (for the previews)
function spriteImage(s: Sprite): Image {
  const data = new Uint8Array(Math.max(1, s.w * s.h) * 4);
  for (let i = 0; i < s.w * s.h; i++) {
    const p = s.px[i], a = p >>> 24;
    const un = (v: number) => (a ? Math.min(255, Math.round((v * 255) / a)) : 0);
    data.set([un((p >> 16) & 255), un((p >> 8) & 255), un(p & 255), a], i * 4);
  }
  return { width: Math.max(1, s.w), height: Math.max(1, s.h), data };
}

try {
  main();
} catch (err: any) {
  console.error(`[display] ${err?.message ?? err}`);
  process.exit(1);
}
