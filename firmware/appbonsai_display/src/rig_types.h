// The shapes of the tree library that scripts/display/export.ts generates into src/assets/tree_rig.h.
// Keep the field order in step with the export (it writes aggregate initializers).
#pragma once
#include <stdint.h>

// A part of the tree exported from the website's SVG, at rest, in tree-box pixels. Each row keeps the span from
// its first to its last visible pixel, packed: premultiplied RGB565 and an 8-bit alpha.
struct RigRow {
  uint16_t start, len;
  uint32_t off;
};
struct RigSprite {
  int16_t x, y, w, h;
  const RigRow* rows;
  const uint16_t* rgb;
  const uint8_t* a;
  uint32_t count; // pixels in the spans
};

// One eye style, around its pupils: what lies under them, the pupils (at gaze 0), what lies over them.
// Drowsy pupils are clipped by the lids to an SVG y range (clipped: clip0..clip1)
struct RigEyes {
  RigSprite under, pupils, over;
  uint8_t hasPupils, clipped;
  float clip0, clip1;
};

// A CSS keyframe, reduced to translate · rotate · skewX · scale about the animation's origin
struct RigKey {
  float at, tx, ty, rot, sx, sy, skew;
};
enum RigAmp : uint8_t { AMP_NONE, AMP_SWAY, AMP_FLUTTER }; // rotate(calc(<deg> * var(--sway-amp | --flutter-amp)))
enum RigEasing : uint8_t { EASE_IN_OUT, EASE_LINEAR, EASE };
struct RigAnim {
  float dur;       // seconds
  uint8_t bySpeed; // divided by the tree's sway speed (calc(<dur> / var(--sway-speed)))
  uint8_t amp;
  uint8_t easing;
  uint8_t n; // 0: no animation
  const RigKey* keys;
};
// A body motion by its class (ExpressionState avatar.animation)
struct RigNamedAnim {
  const char* cls;
  RigAnim anim;
};

// A canopy pad: which sway it runs and about which point (SVG units); its droop is the firmware's (droopOf)
struct RigPad {
  uint8_t sway; // 0 branch-sway-left, 1 branch-sway-right
  float px, py;
};

// A leaf as Foliage.tsx's leavesFor places it (SVG units, degrees); the look rules (leafLook) do the rest
struct RigLeafSpec {
  float x, y, angle, size, r, gap, delay;
  uint8_t pad, shade, rim;
};

// A foliage tone's leaf colours (Foliage.tsx PALETTES, 0x00RRGGBB), how flat its leaves roll, and whether
// some of them turn dry brown
struct RigPalette {
  uint32_t leaf[3];
  uint32_t shadow, edge;
  uint8_t hasEdge, gloss, browns;
  float curl;
};
