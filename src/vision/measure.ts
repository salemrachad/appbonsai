import { APP_CONFIG } from '../config/appConfig';
import type { SpeciesProfile } from '../species';
import type { PhotoAnalysis, PhotoQuality, Rgba, Roi } from './visionTypes';

// Reading a daily photo of the real tree: pure and deterministic (the same pixels give the same numbers), run
// in the browser on the shrunk photo before it is uploaded, and by the tests on synthetic images.
//
//   leaves     inside the crown box, each pixel by its colour: green (excess green on chromaticity, so the
//              brightness of the light matters less, and a green hue), yellowing, or dry brown (saturated
//              enough not to be the grey bark). foliage = leaf pixels / box pixels.
//   quality    too dark, blurry, framed differently from the reference (edge maps), or no leaves in the box:
//              then the photo is kept but not measured, never guessed at.
//
// Fullness is foliage against the reference photo's (perception.leaves), so it follows if the reference changes.

type ColourRules = SpeciesProfile['photo'];
const P = APP_CONFIG.photos;

export type LeafPixel = 'green' | 'yellow' | 'brown' | null;

// One pixel → a leaf colour, or null (not a leaf, or too dark to tell)
export function leafPixel(r: number, g: number, b: number, rules: ColourRules): LeafPixel {
  const sum = r + g + b;
  if (sum < P.minPixelSum) return null;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const sat = max === 0 ? 0 : (max - min) / max;
  const hue = hueOf(r, g, b, max, min);
  const exg = (2 * g - r - b) / sum;
  const G = rules.green;
  if (exg >= G.minExg && hue >= G.minHue && hue <= G.maxHue && sat >= G.minSat) return 'green';
  const Y = rules.yellow;
  if (hue >= Y.minHue && hue < Y.maxHue && sat >= Y.minSat && v >= Y.minValue) return 'yellow';
  const B = rules.brown;
  if (hue >= B.minHue && hue < B.maxHue && sat >= B.minSat && v >= B.minValue && v <= B.maxValue) return 'brown';
  return null;
}

function hueOf(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const lumaAt = (d: ArrayLike<number>, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

// The crown box in pixels (at least one pixel, inside the image)
export function roiPixels(img: Rgba, roi: Roi): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = clamp(Math.floor(roi.x * img.width), 0, img.width - 1);
  const y0 = clamp(Math.floor(roi.y * img.height), 0, img.height - 1);
  // (a hair under, so 0.15 + 0.4 = 0.55000000000000004 doesn't take one more row)
  const x1 = clamp(Math.ceil((roi.x + roi.w) * img.width - 1e-6), x0 + 1, img.width);
  const y1 = clamp(Math.ceil((roi.y + roi.h) * img.height - 1e-6), y0 + 1, img.height);
  return { x0, y0, x1, y1 };
}

// The whole image's edges on a small fixed grid (luma averaged into cells, then the gradient magnitude):
// two photos framed alike have similar maps, whatever their size
export function edgeSignature(img: Rgba, size: { w: number; h: number } = P.signature): number[] {
  const W = size.w + 1;
  const H = size.h + 1;
  const cells = new Array<number>(W * H).fill(0);
  const counts = new Array<number>(W * H).fill(0);
  for (let y = 0; y < img.height; y++) {
    const cy = Math.min(H - 1, Math.floor((y * H) / img.height));
    for (let x = 0; x < img.width; x++) {
      const cx = Math.min(W - 1, Math.floor((x * W) / img.width));
      cells[cy * W + cx] += lumaAt(img.data, (y * img.width + x) * 4);
      counts[cy * W + cx]++;
    }
  }
  for (let i = 0; i < cells.length; i++) cells[i] = counts[i] ? cells[i] / counts[i] : 0;
  const out: number[] = [];
  for (let y = 0; y < size.h; y++)
    for (let x = 0; x < size.w; x++) {
      const c = cells[y * W + x];
      out.push(Math.hypot(cells[y * W + x + 1] - c, cells[(y + 1) * W + x] - c));
    }
  return out;
}

// Normalized cross-correlation of two edge maps (-1…1; 1 = framed the same)
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  const mean = (xs: number[]) => xs.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// Brightness and sharpness inside the crown box
function exposure(img: Rgba, box: ReturnType<typeof roiPixels>): { brightness: number; sharpness: number } {
  const { x0, y0, x1, y1 } = box;
  const d = img.data;
  const w = img.width;
  let sum = 0;
  let n = 0;
  let lap = 0;
  let m = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const c = lumaAt(d, (y * w + x) * 4);
      sum += c;
      n++;
      if (x > 0 && y > 0 && x < img.width - 1 && y < img.height - 1) {
        const l = lumaAt(d, (y * w + x - 1) * 4) + lumaAt(d, (y * w + x + 1) * 4) + lumaAt(d, ((y - 1) * w + x) * 4) + lumaAt(d, ((y + 1) * w + x) * 4) - 4 * c;
        lap += Math.abs(l);
        m++;
      }
    }
  return { brightness: n ? sum / n : 0, sharpness: m ? lap / m : 0 };
}

export interface MeasureInput {
  img: Rgba; // the photo, shrunk to about APP_CONFIG.photos.analysisLongSide
  roi: Roi; // the crown box (the reference's)
  reference?: { img: Rgba; sharpness: number } | null; // absent: this IS the reference (or none yet)
  rules: ColourRules;
}

export function measurePhoto({ img, roi, reference, rules }: MeasureInput): PhotoAnalysis {
  const box = roiPixels(img, roi);
  const { brightness, sharpness } = exposure(img, box);
  let green = 0;
  let yellow = 0;
  let brown = 0;
  for (let y = box.y0; y < box.y1; y++)
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * img.width + x) * 4;
      const k = leafPixel(img.data[i], img.data[i + 1], img.data[i + 2], rules);
      if (k === 'green') green++;
      else if (k === 'yellow') yellow++;
      else if (k === 'brown') brown++;
    }
  const leaves = green + yellow + brown;
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  const foliage = leaves / area;
  const alignment = reference ? correlation(edgeSignature(img), edgeSignature(reference.img)) : null;
  const quality: PhotoQuality =
    brightness < P.minBrightness
      ? 'too_dark'
      : sharpness < P.minSharpness || (reference && sharpness < reference.sharpness * P.sharpnessVsReference)
      ? 'blurry'
      : alignment !== null && alignment < P.minAlignment
      ? 'misaligned'
      : foliage < P.minFoliage
      ? 'no_leaves'
      : 'ok';
  return {
    analyzerVersion: P.analyzerVersion,
    quality,
    foliage: round4(foliage),
    green: leaves ? round4(green / leaves) : 0,
    yellow: leaves ? round4(yellow / leaves) : 0,
    brown: leaves ? round4(brown / leaves) : 0,
    brightness: round1(brightness),
    sharpness: round2(sharpness),
    alignment: alignment === null ? null : round2(alignment),
  };
}

// The measured fullness of a photo against the reference's foliage (null when either can't be read)
export function fullnessOf(foliage: number | null | undefined, referenceFoliage: number | null | undefined): number | null {
  if (foliage == null || !referenceFoliage) return null;
  return round2(Math.min(1.1, foliage / referenceFoliage));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
