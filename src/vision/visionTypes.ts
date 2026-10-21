// Daily photos of the real tree (taken with the phone, measured in the browser, stored by the server).
// Evidence class "observation": what the photo shows, read by fixed rules (src/vision/measure.ts).

// An RGBA image as a canvas gives it (ImageData), or a synthetic one in the tests
export interface Rgba {
  width: number;
  height: number;
  data: ArrayLike<number>; // r, g, b, a per pixel, row by row
}

// The crown's box, as fractions of the image (0-1): leaves are only counted inside it (not the pot, not the
// background). Drawn once on the reference photo; the ghost in the viewfinder keeps later photos framed alike.
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Why a photo couldn't be read (stored, never measured: as with the sensors, nothing is invented)
export type PhotoQuality = 'ok' | 'too_dark' | 'blurry' | 'misaligned' | 'no_leaves';

export interface PhotoAnalysis {
  analyzerVersion: number;
  quality: PhotoQuality;
  foliage: number; // share of the crown box covered by leaves (0-1); fullness = foliage / the reference's
  green: number; // shares of the leaf pixels (sum 1)
  yellow: number;
  brown: number; // dry, dead leaves (saturated brown, not the grey bark)
  brightness: number; // mean luma in the crown box, 0-255
  sharpness: number; // mean |Laplacian| of luma in the crown box
  alignment: number | null; // how well the framing matches the reference (-1…1), null for the reference itself
}

export interface PhotoRecord {
  id: number;
  takenAt: number;
  uploadedAt: number;
  width: number;
  height: number;
  isReference: boolean; // the tree at its fullest: fullness is measured against it
  roi: Roi | null; // the crown box (kept on the reference)
  analysis: PhotoAnalysis | null;
  note: string | null;
}

// What perception makes of the photos (perception.leaves): only with a reference and a readable photo
export interface LeafObservation {
  photoId: number;
  at: number; // when the latest readable photo was taken
  fullness: number; // its leaves against the reference's (1 = as full as the reference)
  yellow: number; // yellow + brown share of its leaf pixels
  lastPhotoAt: number; // the latest photo of any quality (the evening reminder)
  // Readable photos in the window, oldest first (the canopy is anchored on them; shedding compares them)
  measured: { id: number; at: number; fullness: number; yellow: number }[];
}
