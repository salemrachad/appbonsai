import { apply, invert, type Mat } from './rig';

// One ficus leaf drawn the way the display firmware draws it (appbonsai_display.ino, drawLeaves: keep the two
// the same). The leaf is the avatar's lens, M 0,0 Q 5,-4.6 12,0 Q 5,4.6 0,0: its half-width at x is the
// quadratic's, x = 10t + 2t², half = 9.2·t·(1−t). A pixel's coverage comes from its distance to the edge in
// pixels (across the leaf and to the tip or base), which anti-aliases a 3 px wide leaf. Then the edge stroke
// (frost, scorch), the midrib (the palette shadow at 0.35) and the gloss line (white at 0.45), as in Foliage.tsx.

export type RGB = [number, number, number];

export interface LeafPaint {
  fill: RGB;
  edge: RGB | null;
  edgeWidth: number;
  rib: RGB | null;
  gloss: boolean;
}

export function leafHalf(x: number): number {
  if (x <= 0 || x >= 12) return 0;
  const t = (-10 + Math.sqrt(100 + 8 * x)) / 4;
  return 9.2 * t * (1 - t);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function hex(c: string): RGB {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

// The leaf's pixel box for a leaf → screen matrix
export function leafBox(m: Mat, w: number, h: number): [number, number, number, number] {
  const pts = [apply(m, 0, -2.5), apply(m, 12, -2.5), apply(m, 0, 2.5), apply(m, 12, 2.5)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.max(0, Math.floor(Math.min(...xs)) - 1), Math.max(0, Math.floor(Math.min(...ys)) - 1), Math.min(w, Math.ceil(Math.max(...xs)) + 1), Math.min(h, Math.ceil(Math.max(...ys)) + 1)];
}

// Paint one leaf into an RGB float image (w × h), m: leaf space → pixels
export function paintLeaf(img: Float32Array, w: number, h: number, m: Mat, p: LeafPaint) {
  const inv = invert(m);
  const cx = Math.hypot(m[0], m[1]); // pixels per leaf unit, along the leaf
  const cy = Math.hypot(m[2], m[3]); // and across it
  const edgeHalf = p.edge ? (p.edgeWidth / 2) * cy : 0;
  const [x0, y0, x1, y1] = leafBox(m, w, h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const [lx, ly] = apply(inv, x + 0.5, y + 0.5);
      const d = Math.min((leafHalf(lx) - Math.abs(ly)) * cy, Math.min(lx, 12 - lx) * cx);
      const cov = clamp01(d + edgeHalf + 0.5);
      if (cov <= 0) continue;
      let c = p.fill;
      if (p.edge) c = mix(c, p.edge, clamp01(edgeHalf + 0.5 - Math.abs(d)));
      if (p.rib && lx > 1.5 && lx < 10) c = mix(c, p.rib, clamp01(0.3 * cy + 0.5 - Math.abs(ly) * cy) * 0.35);
      if (p.gloss && lx > 3 && lx < 9) {
        const t = (lx - 3) / 6;
        const yg = (1 - t) * (1 - t) * -1.6 + 2 * t * (1 - t) * -3 + t * t * -1.4;
        c = mix(c, [255, 255, 255], clamp01(0.4 * cy + 0.5 - Math.abs(ly - yg) * cy) * 0.45);
      }
      const i = (y * w + x) * 3;
      img[i] += (c[0] - img[i]) * cov;
      img[i + 1] += (c[1] - img[i + 1]) * cov;
      img[i + 2] += (c[2] - img[i + 2]) * cov;
    }
  }
}
