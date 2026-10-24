// The shapes of the tree rig that scripts/display/export.ts generates into src/assets/tree_rig.h.
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
enum RigSpriteId { SPR_BASE, SPR_TRUNK, SPR_FACE, SPR_FACE_CLOSED, SPR_BRANCHES, SPR_PAD0, SPR_PAD1, SPR_PAD2, SPR_COUNT };

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

// A canopy pad: its droop (in its exported image already), which sway it runs and about which point (SVG units)
struct RigPad {
  float droop[6];
  uint8_t sway; // 0 branch-sway-left, 1 branch-sway-right
  float px, py;
};

// A leaf: leaf space (the lens 0..12 along x) → SVG units, droop included; the quiver turns it about its base
enum RigLeafFlags : uint8_t { LEAF_EDGE = 1, LEAF_RIB = 2, LEAF_GLOSS = 4, LEAF_FRESH = 8 };
struct RigLeaf {
  float m[6];
  uint32_t fill, edge, rib; // 0x00RRGGBB
  float edgeWidth;          // leaf units
  float delay;              // seconds (CSS animation-delay)
  uint8_t pad, flags;
};
