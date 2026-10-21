import { APP_CONFIG } from '../config/appConfig';
import { ACTIVE_SPECIES } from '../species';
import { measurePhoto } from './measure';
import type { PhotoAnalysis, Rgba, Roi } from './visionTypes';

// The browser's part of a daily photo: decode, shrink, re-encode (which also drops the EXIF, location
// included) and measure. Canvas only; the measuring itself is the pure measure.ts.

export type ImageSource = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | ImageBitmap;

const sizeOf = (s: ImageSource) =>
  s instanceof HTMLVideoElement ? { w: s.videoWidth, h: s.videoHeight } : s instanceof HTMLImageElement ? { w: s.naturalWidth, h: s.naturalHeight } : { w: s.width, h: s.height };

// The source drawn on a canvas whose longest side is at most `longSide`
function draw(source: ImageSource, longSide: number): HTMLCanvasElement {
  const { w, h } = sizeOf(source);
  const k = Math.min(1, longSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// A picked file or a server image URL → a decoded image (the browser applies the EXIF orientation)
export async function loadImage(src: Blob | string): Promise<HTMLImageElement> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// The JPEG that is stored: shrunk to APP_CONFIG.photos.uploadLongSide, as base64 (no data: prefix)
export function toUploadJpeg(source: ImageSource): { base64: string; width: number; height: number; canvas: HTMLCanvasElement } {
  const canvas = draw(source, APP_CONFIG.photos.uploadLongSide);
  const url = canvas.toDataURL('image/jpeg', APP_CONFIG.photos.jpegQuality);
  return { base64: url.slice(url.indexOf(',') + 1), width: canvas.width, height: canvas.height, canvas };
}

// The pixels measured: shrunk to APP_CONFIG.photos.analysisLongSide
export function pixelsOf(source: ImageSource): Rgba {
  const canvas = draw(source, APP_CONFIG.photos.analysisLongSide);
  return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
}

// Measure a photo against the reference (none: it is the reference). The reference's own pixels are measured
// at the same size so its sharpness compares fairly.
export function measureInBrowser(source: ImageSource, roi: Roi, reference: ImageSource | null): PhotoAnalysis {
  const img = pixelsOf(source);
  let ref: { img: Rgba; sharpness: number } | null = null;
  if (reference) {
    const refImg = pixelsOf(reference);
    ref = { img: refImg, sharpness: measurePhoto({ img: refImg, roi, rules: ACTIVE_SPECIES.photo }).sharpness };
  }
  return measurePhoto({ img, roi, reference: ref, rules: ACTIVE_SPECIES.photo });
}
