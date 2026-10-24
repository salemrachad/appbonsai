// Appbonsai display (ESP32 #2): the website's Ficus on a 3.2" ILI9341 (320x240, landscape).
//
// The website's avatar as a library (scripts/display/export.ts → src/assets/tree_rig.h): its parts as Chrome
// draws them, in every look the ExpressionState can ask for. The stand and pot, the trunk and the branches; each
// canopy pad without its leaves in all 14 foliage tones (one shape, a colour per tone); the soil per kind and the
// moss per tone; the face in layers (blush, sweat, each eye style around its pupils, each mouth). The 124 leaves
// are drawn here by the website's own rules (droopOf, leafLook, pupilOffset below, as scripts/display/look.ts,
// which the export checks against React's markup): the pads' droop, each leaf's tilt, curl, colour and
// freshness, where the pupils rest for the gaze. The website's CSS animations move it all: the body's motion
// for the state, the trunk's breathing, the branch sways about their pivots, each leaf's quiver on its own
// phase, and the eyes blink at the state's interval, sometimes twice. A new droop eases in over 2.5 s as on the
// website; a new tone or face switches at once (for now).
//
// No framebuffer (150 KB) on an ESP32 without PSRAM: the tree's box is composed in strips of 8 rows (RGB888,
// the parts sampled bilinearly so motions smaller than a pixel stay smooth), dithered to RGB565 like the
// export (a fixed pattern) and sent by DMA while the next strip is composed.
//
// The state from the server: with secrets.h (npm run display:setup, then your Wi-Fi in it) a task on core 0
// joins the Wi-Fi and reads the tree's GET /api/current once a minute over HTTPS (HTTP Basic, the site's
// password; If-None-Match, so an unchanged state is a 304), keeping only the ExpressionState's fields it uses
// (a streaming filter: the ~30 KB answer is never held). Until it answers, the look the library was exported
// with (RIG_DEFAULT_STATE, read by the same function).
//
// It measures as it runs: frame rate, the time spent composing a frame, flash, free heap and the largest
// free block, and while a fetch runs the lowest heap, largest block and frame rate. Serial monitor (115200
// baud) and the column right of the tree. Serial: 'r' reports, 'b' runs uncapped for 5 s, 'p' profiles,
// 'f' fetches now.
//
// Separate from the sensor ESP32's firmware (firmware/appbonsai_esp32), which this never touches.

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <WiFi.h>
#include <esp_heap_caps.h>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <math.h>
#include "display_config.h"
#include "src/rig_types.h"

#if __has_include("secrets.h") && __has_include("src/assets/roots.h")
#include "secrets.h"
#include "src/assets/roots.h"
#define HAVE_SECRETS 1
#else
#define HAVE_SECRETS 0
#endif

// Composing is the frame: the default -Os left it at half speed
#pragma GCC optimize("O3")

#if __has_include("src/assets/tree_rig.h")
#include "src/assets/tree_rig.h"
#else
#error "No tree library yet: run `npm run display:export` in the repository first (see README.md)"
#endif

const char* FIRMWARE_VERSION = "0.4.0";

// The layout (landscape 320x240): the tree's box centred in the left part, a column of words on the right
const int SCREEN_W = 320;
const int SCREEN_H = 240;
const int TEXT_X = 214;
const int TREE_X = (TEXT_X - RIG_W) / 2;
const int TREE_Y = (SCREEN_H - RIG_H) / 2;
const int STRIP_ROWS = 8; // two strips at a time, one per core; small, so the TLS buffers fit
const uint32_t FRAME_US = 33333; // 30 fps: the website's motions are seconds long and a few pixels wide
const uint32_t BLINK_MS = 160;   // as BonsaiAvatar's blink
const uint32_t FETCH_EVERY_MS = 60000; // the tree is evaluated once a minute
const uint32_t RETRY_MS = 15000;
const float MOTION_EASE_S = 2.0f; // a new motion eases in over a few seconds, never a jump
const float DROOP_EASE_S = 2.5f;  // the droop's CSS transition (transform 2.5s ease-in-out)

LGFX lcd;
uint32_t* work[2] = {nullptr, nullptr}; // a strip of the tree's box per core, 0x00RRGGBB (in IRAM: see ld32)
bool workInIram = false;
uint16_t* dma[4] = {nullptr};          // two pairs of strips as the panel takes them (byte-swapped RGB565)
uint32_t sketchBytes = 0, slotBytes = 0; // measured once: getSketchSize() reads the whole sketch from flash
uint32_t ramParts = 0;                   // the parts copied to RAM

float HALF[97];                        // the leaf's half-width, x = 0..12 in steps of 1/8
uint16_t BG, INK, MUTED;
const uint8_t BAYER4[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};

// Declared before the first function: the Arduino build puts its prototypes there
struct StripJob {
  int y0, rows;
  uint16_t* out;
};
// A part to draw: in RAM (copied from flash at start: reading flash for every pixel was most of a frame) or,
// for the small ones that change with the look (face, soil, moss), read from flash where it is
struct Sprite {
  int16_t x, y, w, h;
  const RigRow* rows;
  const uint16_t* rgb;
  const uint8_t* a;
};
struct Heap {
  uint32_t free, largest, minFree, dmaFree, dmaLargest;
};
// The ExpressionState's fields the display uses (GET /api/current → expression), as last read
struct Live {
  bool have = false, fromServer = false;
  uint32_t at = 0; // millis() of the last fetch that confirmed it (200 or 304)
  float swaySpeed = 1, swayAmount = 1, flutter = 1, leafDroop = 0;
  int32_t blinkEveryMs = 0; // <= 0: null (eyes closed, no blinking)
  // The look, as indices into the library (RIG_*_NAMES); an unknown name falls back to the first
  int8_t tone = 0, blendTone = -1, eyes = 0, mouth = 0, blush = 0, gaze = 0, soil = 0, body = -1;
  float blendAmount = 0;
  bool sweat = false, shrink = false, night = false, yellowLeaves = false, newLeaves = false;
  float newGrowth = 0, yellowing = 0, fullness = 1, refilling = 0, canopyYellow = 0;
  char animation[32] = "", scene[16] = "", tapLabel[40] = "";
};
struct NetStats {
  char status[28] = "starting";
  int rssi = 0, lastCode = 0;
  uint32_t ok = 0, notModified = 0, failed = 0, handshakes = 0, lastMs = 0, slowestMs = 0;
  int32_t lastSize = -1;
  uint32_t lowFree = UINT32_MAX, lowLargest = UINT32_MAX; // while a fetch runs (sampled every frame)
  uint32_t beforeFree = 0, beforeLargest = 0;             // just before the first fetch
  float lowFps = 0;                                       // the slowest 2 s window with a fetch in it
};
struct Mat {
  float a, b, c, d, e, f; // SVG matrix(a b c d e f): x' = a x + c y + e, y' = b x + d y + f
};
// A part where it is now: tree-box pixel → its pixel at rest, the box it covers, and (the drowsy pupils) the
// rows of its own drawing the lids leave visible, in 16.16 sampling coordinates
struct Part {
  const Sprite* s;
  Mat inv;
  int x0, y0, x1, y1;
  int32_t vLo, vHi;
};
// A leaf now: its look (the rules) and where it is (tree-box pixel → leaf space)
enum LeafFlags : uint8_t { LEAF_EDGE = 1, LEAF_RIB = 2, LEAF_GLOSS = 4, LEAF_FRESH = 8 };
struct LeafNow { // kept small: 124 of them, and the heap is what TLS has left
  bool show;
  uint8_t flags;
  int16_t x0, y0, x1, y1;
  uint32_t fill;
  float opacity;
  Mat inv;
  float cx, cy, edgeHalf;
  float reachX, reachY; // beyond these (leaf units) no pixel is touched
};
// The palette the leaves take now (Foliage.tsx paletteFor: the tone, the blend's colours mixed in)
struct Palette {
  uint32_t leaf[3], shadow, edge;
  bool hasEdge, gloss, browns;
  float curl;
};
// A value that eases toward a new target as a CSS transition does (from wherever it is)
struct Tween {
  float from = 0, to = 0;
  double start = -1e9;
};

// ---------------------------------------------------------------------------------------------- matrices

const Mat IDENTITY = {1, 0, 0, 1, 0, 0};

Mat mul(const Mat& p, const Mat& q) {
  return {p.a * q.a + p.c * q.b, p.b * q.a + p.d * q.b, p.a * q.c + p.c * q.d, p.b * q.c + p.d * q.d,
          p.a * q.e + p.c * q.f + p.e, p.b * q.e + p.d * q.f + p.f};
}
Mat invert(const Mat& m) {
  const float det = m.a * m.d - m.b * m.c;
  const float a = m.d / det, b = -m.b / det, c = -m.c / det, d = m.a / det;
  return {a, b, c, d, -(a * m.e + c * m.f), -(b * m.e + d * m.f)};
}
Mat fromArray(const float* v) { return {v[0], v[1], v[2], v[3], v[4], v[5]}; }
Mat translateM(float x, float y) { return {1, 0, 0, 1, x, y}; }
Mat scaleM(float x, float y) { return {x, 0, 0, y, 0, 0}; }
Mat rotateM(float deg) {
  const float r = deg * (float)M_PI / 180.0f;
  return {cosf(r), sinf(r), -sinf(r), cosf(r), 0, 0};
}

// ------------------------------------------------------------------------------------------- animations

// CSS easing: cubic-bezier(x1, y1, x2, y2) solved for x
float bezier(float x, float x1, float y1, float x2, float y2) {
  float t = x;
  for (int i = 0; i < 6; i++) {
    const float it = 1 - t;
    const float xt = 3 * it * it * t * x1 + 3 * it * t * t * x2 + t * t * t - x;
    const float dx = 3 * it * it * x1 + 6 * it * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (fabsf(dx) < 1e-5f) break;
    t = constrain(t - xt / dx, 0.0f, 1.0f);
  }
  const float it = 1 - t;
  return 3 * it * it * t * y1 + 3 * it * t * t * y2 + t * t * t;
}
float easeExact(float u, uint8_t easing) {
  if (easing == EASE_LINEAR) return u;
  if (easing == EASE_IN_OUT) return bezier(u, 0.42f, 0, 0.58f, 1);
  return bezier(u, 0.25f, 0.1f, 0.25f, 1);
}
// The curves in tables (built at start): solving them for every leaf on every frame cost a few ms
float EASE_LUT[3][257];
float ease(float u, uint8_t easing) {
  const float f = u * 256;
  const int i = min(255, (int)f);
  return EASE_LUT[easing][i] + (EASE_LUT[easing][i + 1] - EASE_LUT[easing][i]) * (f - i);
}

float tweenAt(const Tween& w, double t) {
  const float u = (float)((t - w.start) / DROOP_EASE_S);
  return u >= 1 ? w.to : w.from + (w.to - w.from) * ease(max(0.0f, u), EASE_IN_OUT);
}
void tweenTo(Tween& w, float v, double t) {
  if (v == w.to) return;
  w.from = tweenAt(w, t);
  w.to = v;
  w.start = t;
}

// The motion now (ExpressionState.motion): eased toward the state's. Speed runs a clock of its own
// (tm += dt × speed), so a new tempo never jumps the sway's phase.
float swaySpeed = 1, swayAmount = 1, flutterAmp = 1;
int32_t blinkMs = 0;
double motionT = 0, lastT = -1;

// Where an animation is at time t (seconds since start; double, so it stays exact over weeks), about (ox, oy).
// Those divided by the sway speed run on the motion clock; their delays (seconds, as CSS) are not divided.
Mat animAt(const RigAnim& an, double t, float delay, float ox, float oy) {
  if (!an.n) return IDENTITY;
  double p = fmod(an.bySpeed ? (motionT - delay * swaySpeed) / an.dur : (t - delay) / an.dur, 1.0);
  if (p < 0) p += 1;
  int i = 0;
  while (i < an.n - 2 && p > an.keys[i + 1].at) i++;
  const RigKey& k0 = an.keys[i];
  const RigKey& k1 = an.keys[i + 1];
  const float span = k1.at - k0.at;
  const float u = ease(span > 0 ? constrain(((float)p - k0.at) / span, 0.0f, 1.0f) : 0, an.easing);
  const float amp = an.amp == AMP_SWAY ? swayAmount : an.amp == AMP_FLUTTER ? flutterAmp : 1;
  const float tx = k0.tx + (k1.tx - k0.tx) * u, ty = k0.ty + (k1.ty - k0.ty) * u;
  const float rot = (k0.rot + (k1.rot - k0.rot) * u) * amp;
  const float sx = k0.sx + (k1.sx - k0.sx) * u, sy = k0.sy + (k1.sy - k0.sy) * u;
  const float sk = tanf((k0.skew + (k1.skew - k0.skew) * u) * (float)M_PI / 180.0f);
  // translate · rotate · skewX · scale, about the origin
  const Mat local = mul(rotateM(rot), Mat{sx, 0, sk * sy, sy, 0, 0});
  return mul(translateM(ox + tx, oy + ty), mul(local, translateM(-ox, -oy)));
}

// ------------------------------------------------------------------------------- the website's look rules

// As scripts/display/look.ts (checked there against React's markup; keep the three in step)

// BonsaiAvatar's droopTransforms: translate · rotate · scale about each pad's origin (shrink 0..1, eased)
Mat droopOf(int pad, float d, float shrink) {
  const float s = 1 - 0.07f * shrink;
  const float ox = RIG_DROOP_ORIGINS[pad][0], oy = RIG_DROOP_ORIGINS[pad][1];
  Mat local;
  if (pad == 0) local = mul(translateM(8 * shrink, d * 20), mul(rotateM(d * 11), scaleM(s, s)));
  else if (pad == 1) local = mul(translateM(-8 * shrink, d * 20), mul(rotateM(-d * 11), scaleM(s, s)));
  else local = mul(translateM(0, d * 15), scaleM(s * (1 - d * 0.07f), s * (1 - d * 0.11f)));
  return mul(translateM(ox, oy), mul(local, translateM(-ox, -oy)));
}

// Foliage.tsx mix(): each channel rounded
uint32_t mixRgb(uint32_t a, uint32_t b, float t) {
  uint32_t out = 0;
  for (int sh = 16; sh >= 0; sh -= 8) {
    const float ca = (a >> sh) & 255, cb = (b >> sh) & 255;
    out |= (uint32_t)floorf(ca + (cb - ca) * t + 0.5f) << sh;
  }
  return out;
}
Palette paletteFor(int tone, int blendTone, float amount) {
  const RigPalette& p = RIG_PALETTES[tone];
  Palette out = {{p.leaf[0], p.leaf[1], p.leaf[2]}, p.shadow, p.edge, p.hasEdge != 0, p.gloss != 0, p.browns != 0, p.curl};
  if (blendTone >= 0 && amount > 0) {
    const RigPalette& q = RIG_PALETTES[blendTone];
    for (int i = 0; i < 3; i++) out.leaf[i] = mixRgb(p.leaf[i], q.leaf[i], amount);
    out.shadow = mixRgb(p.shadow, q.shadow, amount);
  }
  return out;
}

float normDeg(float d) { return fmodf(fmodf(d + 180, 360) + 360, 360) - 180; }

// PadLeaves for one leaf, at a droop; local: leaf space → the pad's space (before its droop and sway)
void leafLook(const RigLeafSpec& l, const Live& v, const Palette& p, float droop, LeafNow& n, Mat& local) {
  const float yellowShare = max(v.yellowLeaves ? 0.11f : 0.13f * v.yellowing, v.canopyYellow);
  const float freshShare = v.newLeaves ? 0.28f : 0.32f * v.newGrowth;
  const bool missing = l.gap > v.fullness;
  const bool tip = missing && v.fullness < 1 && (l.gap - v.fullness) / (1 - v.fullness) < v.refilling * 0.6f;
  n.show = !missing || tip;
  if (!n.show) return;
  const float tilt = normDeg(90 - l.angle) * max(-0.25f, droop) * 0.38f;
  const Mat place = mul(translateM(l.x, l.y), mul(rotateM(l.angle), rotateM(tilt)));
  if (tip) {
    local = mul(place, scaleM(l.size * 0.62f, l.size * 0.62f));
    n.fill = 0xCDEB9A, n.flags = LEAF_FRESH;
    return;
  }
  uint32_t fill = p.leaf[l.shade];
  float s = l.size;
  uint8_t flags = LEAF_RIB | (p.hasEdge ? LEAF_EDGE : 0) | (p.gloss && l.r > 0.6f ? LEAF_GLOSS : 0);
  if (l.r < yellowShare) fill = l.r < yellowShare / 2 ? 0xD9A93F : 0xE2C35A;
  if (p.browns && l.r > 0.82f) fill = 0x93643A;
  if (l.rim && l.r > 1 - freshShare) fill = 0xCDEB9A, s *= 1.12f, flags |= LEAF_FRESH;
  local = mul(place, scaleM(s, s * p.curl));
  n.fill = fill, n.flags = flags;
}

// AvatarFace's Eyes: where the pupils go for a gaze (px), per eye style; false for eyes without pupils
bool pupilOffset(int eyes, float gx, float gy, float& ox, float& oy) {
  const char* e = RIG_EYE_NAMES[eyes];
  if (!strcmp(e, "happy") || !strcmp(e, "alert") || !strcmp(e, "worried") || !strcmp(e, "unsure")) ox = gx, oy = gy;
  else if (!strcmp(e, "drowsy")) ox = gx * 0.6f, oy = 1 + gy * 0.3f;
  else if (!strcmp(e, "heavy")) ox = gx * 0.7f, oy = max(0.0f, gy) * 0.6f + 1.5f;
  else if (!strcmp(e, "wide")) ox = gx * 0.8f, oy = gy * 0.8f;
  else if (!strcmp(e, "pleading")) ox = gx * 0.5f, oy = min(gy, -1.0f);
  else if (!strcmp(e, "sad")) ox = gx, oy = gy + 1;
  else return false;
  return true;
}

// ------------------------------------------------------------------------------------------- the look

Live live;   // written by the network task, read by the frame (under liveLock)
Live shown;  // the look being drawn (the frame's copy)
portMUX_TYPE liveLock = portMUX_INITIALIZER_UNLOCKED;
Palette palette;
Tween droopTween, shrinkTween;
int closedEyes = 0;

// The parts: those that only move, in RAM; each pad's colour for the tone now, in RAM, mixed when blended
Sprite base, trunk, branches, pads[3];
uint16_t* padRgb[3] = {nullptr};
int8_t paintedTone = -1, paintedBlend = -2;
float paintedAmount = -1;

Sprite flashSprite(const RigSprite& r) { return {r.x, r.y, r.w, r.h, r.rows, r.rgb, r.a}; }

// Each pad's colours for a tone (and the blend's mixed in, per channel of the premultiplied RGB565)
void paintPads(int tone, int blendTone, float amount) {
  const uint32_t w = blendTone >= 0 ? (uint32_t)(constrain(amount, 0.0f, 1.0f) * 256 + 0.5f) : 0;
  for (int p = 0; p < 3; p++) {
    const uint16_t* A = RIG_PAD_TONES[p][tone];
    const uint16_t* B = w ? RIG_PAD_TONES[p][blendTone] : nullptr;
    const uint32_t n = RIG_PAD_SHAPES[p].count;
    if (!B) {
      memcpy(padRgb[p], A, n * 2);
      continue;
    }
    for (uint32_t k = 0; k < n; k++) {
      const int32_t a = A[k], b = B[k];
      const int32_t r = (a >> 11) + ((((b >> 11) - (a >> 11)) * (int32_t)w) >> 8);
      const int32_t g = ((a >> 5) & 63) + (((((b >> 5) & 63) - ((a >> 5) & 63)) * (int32_t)w) >> 8);
      const int32_t bl = (a & 31) + ((((b & 31) - (a & 31)) * (int32_t)w) >> 8);
      padRgb[p][k] = (uint16_t)((r << 11) | (g << 5) | bl);
    }
  }
  paintedTone = tone, paintedBlend = blendTone, paintedAmount = amount;
}

// ------------------------------------------------------------------------------------------ the frame

enum PartId { P_BASE, P_SOIL, P_MOSS, P_TRUNK, P_BLUSH, P_SWEAT, P_EYES_UNDER, P_PUPILS, P_EYES_OVER, P_MOUTH, P_BRANCHES, P_PAD0, P_PAD1, P_PAD2, P_COUNT };
const char* PART_NAMES[P_COUNT] = {"base", "soil", "moss", "trunk", "blush", "sweat", "eyes", "pupils", "lids", "mouth", "branches", "pad0", "pad1", "pad2"};
Part parts[P_COUNT];
Sprite faceSprites[P_COUNT]; // the look's sprites read from flash (soil, moss, face)
LeafNow leafNow[RIG_LEAF_COUNT];
Mat K, Kinv;
bool eyesShut = false;
float droopNow = 0, shrinkNow = 0;

void box(const Mat& m, float x0, float y0, float x1, float y1, int& bx0, int& by0, int& bx1, int& by1) {
  const float xs[4] = {m.a * x0 + m.c * y0 + m.e, m.a * x1 + m.c * y0 + m.e, m.a * x0 + m.c * y1 + m.e, m.a * x1 + m.c * y1 + m.e};
  const float ys[4] = {m.b * x0 + m.d * y0 + m.f, m.b * x1 + m.d * y0 + m.f, m.b * x0 + m.d * y1 + m.f, m.b * x1 + m.d * y1 + m.f};
  float lx = xs[0], hx = xs[0], ly = ys[0], hy = ys[0];
  for (int i = 1; i < 4; i++) lx = min(lx, xs[i]), hx = max(hx, xs[i]), ly = min(ly, ys[i]), hy = max(hy, ys[i]);
  bx0 = max(0, (int)floorf(lx) - 1), by0 = max(0, (int)floorf(ly) - 1);
  bx1 = min(RIG_W, (int)ceilf(hx) + 1), by1 = min(RIG_H, (int)ceilf(hy) + 1);
}

// A part at a transform (SVG units, as the website's groups); empty sprites draw nothing
void place(int id, const Sprite* s, const Mat& svg) {
  Part& p = parts[id];
  p.s = s;
  p.vLo = INT32_MIN, p.vHi = INT32_MAX;
  if (!s || !s->w) {
    p.x0 = p.x1 = 0;
    return;
  }
  const Mat m = mul(K, mul(svg, Kinv)); // tree-box pixels at rest → now
  p.inv = invert(m);
  box(m, s->x, s->y, s->x + s->w, s->y + s->h, p.x0, p.y0, p.x1, p.y1);
}

// Every part and leaf where it is at time t, for the look shown
void pose(double t) {
  const Live& v = shown;
  const RigAnim none = {0, 0, 0, 0, 0, nullptr};
  const Mat body = animAt(v.body >= 0 ? RIG_BODY[v.body].anim : none, t, 0, RIG_BODY_ORIGIN[0], RIG_BODY_ORIGIN[1]);
  const Mat trunkM = mul(body, animAt(RIG_ANIM_TRUNK, t, 0, RIG_TRUNK_ORIGIN[0], RIG_TRUNK_ORIGIN[1]));
  droopNow = tweenAt(droopTween, t);
  shrinkNow = tweenAt(shrinkTween, t);
  Mat pad[3];
  for (int i = 0; i < 3; i++) {
    const RigPad& p = RIG_PADS[i];
    const Mat sway = animAt(p.sway ? RIG_ANIM_SWAY_RIGHT : RIG_ANIM_SWAY_LEFT, t, 0, p.px, p.py);
    pad[i] = mul(body, mul(droopOf(i, droopNow, shrinkNow), sway)); // the sway turns inside the droop
  }
  // The look's sprites from flash
  const int eyes = eyesShut ? closedEyes : v.eyes;
  const RigEyes& e = RIG_EYES_ART[eyes];
  faceSprites[P_SOIL] = flashSprite(RIG_SOIL[v.soil]);
  faceSprites[P_MOSS] = flashSprite(RIG_MOSS[v.tone]);
  faceSprites[P_BLUSH] = flashSprite(RIG_BLUSH[v.blush]);
  faceSprites[P_SWEAT] = flashSprite(RIG_SWEAT);
  faceSprites[P_EYES_UNDER] = flashSprite(e.under);
  faceSprites[P_PUPILS] = flashSprite(e.pupils);
  faceSprites[P_EYES_OVER] = flashSprite(e.over);
  faceSprites[P_MOUTH] = flashSprite(RIG_MOUTH[v.mouth]);
  place(P_BASE, &base, body);
  place(P_SOIL, &faceSprites[P_SOIL], body);
  place(P_MOSS, &faceSprites[P_MOSS], body);
  place(P_TRUNK, &trunk, trunkM);
  place(P_BLUSH, &faceSprites[P_BLUSH], trunkM);
  place(P_SWEAT, v.sweat ? &faceSprites[P_SWEAT] : nullptr, trunkM);
  place(P_EYES_UNDER, &faceSprites[P_EYES_UNDER], trunkM);
  place(P_EYES_OVER, &faceSprites[P_EYES_OVER], trunkM);
  place(P_MOUTH, &faceSprites[P_MOUTH], trunkM);
  // The pupils at rest for the gaze (its base; the saccades come later), moved from where they were drawn (gaze 0)
  float ox = 0, oy = 0, ox0 = 0, oy0 = 0;
  if (e.hasPupils && pupilOffset(eyes, RIG_GAZE_BASE[v.gaze][0], RIG_GAZE_BASE[v.gaze][1], ox, oy)) {
    pupilOffset(eyes, 0, 0, ox0, oy0);
    place(P_PUPILS, &faceSprites[P_PUPILS], mul(trunkM, translateM(ox - ox0, oy - oy0)));
    if (e.clipped) { // the lids' clip stays where it is: in the pupils' own pixels, less their move
      const float dy = (oy - oy0) * K.d, y0 = faceSprites[P_PUPILS].y + 0.5f;
      parts[P_PUPILS].vLo = (int32_t)((e.clip0 * K.d + K.f - dy - y0) * 65536);
      parts[P_PUPILS].vHi = (int32_t)((e.clip1 * K.d + K.f - dy - y0) * 65536);
    }
  } else {
    place(P_PUPILS, nullptr, IDENTITY);
  }
  place(P_BRANCHES, &branches, body);
  for (int i = 0; i < 3; i++) place(P_PAD0 + i, &pads[i], pad[i]);
  // The leaves: the rules for the look at this droop, then the quiver about each leaf's base
  for (int i = 0; i < RIG_LEAF_COUNT; i++) {
    const RigLeafSpec& l = RIG_LEAVES[i];
    LeafNow& n = leafNow[i];
    Mat local;
    leafLook(l, v, palette, droopNow, n, local);
    if (!n.show) continue;
    const bool fresh = n.flags & LEAF_FRESH;
    const Mat q = animAt(fresh ? RIG_ANIM_QUIVER_FRESH : RIG_ANIM_QUIVER, t, l.delay, 0, 0);
    const Mat m = mul(K, mul(pad[l.pad], mul(local, q)));
    n.inv = invert(m);
    n.cx = hypotf(m.a, m.b);
    n.cy = hypotf(m.c, m.d);
    n.edgeHalf = (n.flags & LEAF_EDGE) ? 0.9f / 2 * n.cy : 0;
    n.reachX = (0.5f + n.edgeHalf) / n.cx;
    n.reachY = 2.3f + (0.5f + n.edgeHalf) / n.cy; // the lens is 2.3 wide at most
    int x0, y0, x1, y1;
    box(m, 0, -2.5f, 12, 2.5f, x0, y0, x1, y1);
    n.x0 = x0, n.y0 = y0, n.x1 = x1, n.y1 = y1;
    // .leaf-fresh: opacity 0.85 → 1 → 0.85 over 4 s (ease-in-out), on the leaf's delay
    n.opacity = 1;
    if (fresh) {
      double ph = fmod((t - l.delay) / 4.0, 1.0);
      if (ph < 0) ph += 1;
      n.opacity = ph < 0.5 ? 0.85f + 0.15f * ease((float)ph * 2, EASE_IN_OUT) : 1 - 0.15f * ease((float)(ph - 0.5) * 2, EASE_IN_OUT);
    }
  }
}

// The strips live in IRAM, which the RAM that TLS needs can't spare: IRAM takes only 32-bit loads and stores,
// and -O3 may narrow (c >> 16) & 255 into a byte load (a LoadStoreError there). So every read of a strip is
// this one 32-bit load; writes are whole words anyway.
static inline uint32_t ld32(const uint32_t* p) {
  uint32_t v;
  asm volatile("l32i %0, %1, 0" : "=r"(v) : "r"(p));
  return v;
}

const RigRow NO_ROW = {0, 0, 0};

// One texel of a part's row, unpacked for blending: red and blue as 5-bit lanes (bits 16-20, 0-4), green 6-bit, alpha
static inline void texel(const Sprite& s, const RigRow& r, int x, uint32_t& rb, uint32_t& g, uint32_t& a) {
  const unsigned ux = x - r.start;
  if (ux < r.len) {
    const uint32_t c = s.rgb[r.off + ux];
    rb = ((c & 0xF800) << 5) | (c & 0x1F);
    g = (c >> 5) & 0x3F;
    a = s.a[r.off + ux];
    return;
  }
  rb = g = a = 0;
}

// A part into the strip: each pixel sampled bilinearly (premultiplied, 16.16 fixed point), laid over what is
// there. Per row, only where the part's rows have pixels.
void drawPart(uint32_t* buf, const Part& p, int y0, int rows) {
  if (!p.s || p.x1 <= p.x0) return;
  const Sprite& s = *p.s;
  const int ya = max(p.y0, y0), yb = min(p.y1, y0 + rows);
  const float du = p.inv.a, dv = p.inv.b;
  for (int Y = ya; Y < yb; Y++) {
    uint32_t* row = buf + (Y - y0) * RIG_W;
    const float u0 = p.inv.a * (p.x0 + 0.5f) + p.inv.c * (Y + 0.5f) + p.inv.e - s.x - 0.5f;
    const float v0 = p.inv.b * (p.x0 + 0.5f) + p.inv.d * (Y + 0.5f) + p.inv.f - s.y - 0.5f;
    // The part's rows this screen row reads from, and the pixels they have
    const float vEnd = v0 + dv * (p.x1 - p.x0);
    const int r0 = max(0, (int)floorf(min(v0, vEnd))), r1 = min(s.h - 1, (int)floorf(max(v0, vEnd)) + 1);
    int lo = 1 << 20, hi = -(1 << 20);
    for (int r = r0; r <= r1; r++)
      if (s.rows[r].len) lo = min(lo, (int)s.rows[r].start), hi = max(hi, s.rows[r].start + s.rows[r].len);
    if (hi < lo) continue;
    int xa = p.x0, xb = p.x1;
    if (du > 0.01f) {
      xa = max(p.x0, p.x0 + (int)floorf((lo - 1 - u0) / du));
      xb = min(p.x1, p.x0 + (int)ceilf((hi - u0) / du) + 1);
    }
    int32_t U = (int32_t)((u0 + du * (xa - p.x0)) * 65536), V = (int32_t)((v0 + dv * (xa - p.x0)) * 65536);
    const int32_t DU = (int32_t)(du * 65536), DV = (int32_t)(dv * 65536);
    for (int X = xa; X < xb; X++, U += DU, V += DV) {
      if (V < p.vLo || V >= p.vHi) continue; // clipped (the drowsy lids)
      const int iu = U >> 16, iv = V >> 16;
      const uint32_t fx = (U >> 8) & 255, fy = (V >> 8) & 255;
      uint32_t rb00, g00, a00, rb10, g10, a10, rb01, g01, a01, rb11, g11, a11;
      const RigRow& top = (unsigned)iv < (unsigned)s.h ? s.rows[iv] : NO_ROW;
      const RigRow& bottom = (unsigned)(iv + 1) < (unsigned)s.h ? s.rows[iv + 1] : NO_ROW;
      texel(s, top, iu, rb00, g00, a00);
      texel(s, top, iu + 1, rb10, g10, a10);
      texel(s, bottom, iu, rb01, g01, a01);
      texel(s, bottom, iu + 1, rb11, g11, a11);
      const uint32_t w11 = (fx * fy) >> 8, w10 = fx - w11, w01 = fy - w11, w00 = 256 - fx - fy + w11;
      const uint32_t a = (a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11) >> 8;
      if (!a) continue;
      const uint32_t rb = rb00 * w00 + rb10 * w10 + rb01 * w01 + rb11 * w11; // lanes: 5 bits x 256
      const uint32_t g = g00 * w00 + g10 * w10 + g01 * w01 + g11 * w11;
      const uint32_t r8 = (((rb >> 16) & 0xFFFF) * 263) >> 13, b8 = ((rb & 0xFFFF) * 263) >> 13, g8 = (g * 259) >> 14;
      // Over what is there; saturating, since RGB565 rounding can lift a premultiplied colour a little past its alpha
      const uint32_t dst = ld32(row + X), ia = 256 - a;
      const uint32_t r = min<uint32_t>(255, r8 + ((((dst >> 16) & 255) * ia) >> 8));
      const uint32_t gg = min<uint32_t>(255, g8 + ((((dst >> 8) & 255) * ia) >> 8));
      const uint32_t b = min<uint32_t>(255, b8 + (((dst & 255) * ia) >> 8));
      row[X] = (r << 16) | (gg << 8) | b;
    }
  }
}

float leafHalf(float x) {
  if (x <= 0 || x >= 12) return 0;
  const float f = x * 8;
  const int i = (int)f;
  return HALF[i] + (HALF[i + 1] - HALF[i]) * (f - i);
}

// The pad's leaves into the strip, as scripts/display/leafRaster.ts paints them (keep the two the same)
void drawLeaves(uint32_t* buf, int pad, int y0, int rows) {
  const uint32_t edge = palette.edge, rib = palette.shadow;
  for (int i = 0; i < RIG_LEAF_COUNT; i++) {
    if (RIG_LEAVES[i].pad != pad) continue;
    const LeafNow& n = leafNow[i];
    if (!n.show) continue;
    const int ya = max((int)n.y0, y0), yb = min((int)n.y1, y0 + rows);
    const float fr = (n.fill >> 16) & 255, fg = (n.fill >> 8) & 255, fb = n.fill & 255;
    for (int Y = ya; Y < yb; Y++) {
      uint32_t* row = buf + (Y - y0) * RIG_W;
      float lx = n.inv.a * (n.x0 + 0.5f) + n.inv.c * (Y + 0.5f) + n.inv.e;
      float ly = n.inv.b * (n.x0 + 0.5f) + n.inv.d * (Y + 0.5f) + n.inv.f;
      for (int X = n.x0; X < n.x1; X++, lx += n.inv.a, ly += n.inv.b) {
        if (ly > n.reachY || ly < -n.reachY || lx < -n.reachX || lx > 12 + n.reachX) continue; // clear of the lens
        const float d = min((leafHalf(lx) - fabsf(ly)) * n.cy, min(lx, 12 - lx) * n.cx);
        float cov = d + n.edgeHalf + 0.5f;
        if (cov <= 0) continue;
        if (cov > 1) cov = 1;
        cov *= n.opacity;
        float r = fr, g = fg, b = fb;
        if (n.flags & LEAF_EDGE) {
          const float e = constrain(n.edgeHalf + 0.5f - fabsf(d), 0.0f, 1.0f);
          r += (((edge >> 16) & 255) - r) * e, g += (((edge >> 8) & 255) - g) * e, b += ((edge & 255) - b) * e;
        }
        if ((n.flags & LEAF_RIB) && lx > 1.5f && lx < 10) {
          const float e = constrain(0.3f * n.cy + 0.5f - fabsf(ly) * n.cy, 0.0f, 1.0f) * 0.35f;
          r += (((rib >> 16) & 255) - r) * e, g += (((rib >> 8) & 255) - g) * e, b += ((rib & 255) - b) * e;
        }
        if ((n.flags & LEAF_GLOSS) && lx > 3 && lx < 9) {
          const float t = (lx - 3) / 6;
          const float yg = (1 - t) * (1 - t) * -1.6f + 2 * t * (1 - t) * -3.0f + t * t * -1.4f;
          const float e = constrain(0.4f * n.cy + 0.5f - fabsf(ly - yg) * n.cy, 0.0f, 1.0f) * 0.45f;
          r += (255 - r) * e, g += (255 - g) * e, b += (255 - b) * e;
        }
        const uint32_t dst = ld32(row + X);
        const float dr = (dst >> 16) & 255, dg = (dst >> 8) & 255, db = dst & 255;
        row[X] = ((uint32_t)(dr + (r - dr) * cov + 0.5f) << 16) | ((uint32_t)(dg + (g - dg) * cov + 0.5f) << 8) | (uint32_t)(db + (b - db) * cov + 0.5f);
      }
    }
  }
}

// A composed strip to the panel's RGB565, with the export's fixed pattern
void dither(const uint32_t* buf, int y0, int rows, uint16_t* out) {
  for (int y = 0; y < rows; y++) {
    const uint8_t* bayer = BAYER4 + ((y0 + y) & 3) * 4;
    // floor(v · 31/255 + (cell + ½)/16) in integers, exactly (checked for every v and cell): no 8 KB of tables,
    // which the TLS buffers need
    const uint32_t k[4] = {(2u * bayer[0] + 1) * 255, (2u * bayer[1] + 1) * 255, (2u * bayer[2] + 1) * 255, (2u * bayer[3] + 1) * 255};
    auto q = [](uint32_t v, uint32_t mul, uint32_t k) { return ((((v * mul + k) >> 5) * 257 + 257) >> 16); }; // ⌊⌊y/32⌋/255⌋
    const uint32_t* src = buf + y * RIG_W;
    uint16_t* dst = out + y * RIG_W;
    for (int x = 0; x < RIG_W; x++) {
      const uint32_t c = ld32(src + x), kk = k[x & 3];
      const uint32_t v = (min<uint32_t>(31, q((c >> 16) & 255, 992, kk)) << 11) | (min<uint32_t>(63, q((c >> 8) & 255, 2016, kk)) << 5) |
                         min<uint32_t>(31, q(c & 255, 992, kk));
      dst[x] = (uint16_t)((v >> 8) | (v << 8));
    }
  }
}

uint32_t bgRgb() {
  const uint8_t* c = shown.night ? RIG_BG_NIGHT : RIG_BG_DAY;
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// One strip: background, the parts and leaves in the website's order, then dithered for the panel
void compose(uint32_t* buf, int y0, int rows, uint16_t* out) {
  const uint32_t bg = bgRgb();
  for (int i = 0; i < rows * RIG_W; i++) buf[i] = bg;
  for (int id = 0; id < P_PAD0; id++) drawPart(buf, parts[id], y0, rows);
  for (int p = 0; p < 3; p++) {
    drawPart(buf, parts[P_PAD0 + p], y0, rows);
    drawLeaves(buf, p, y0, rows);
  }
  dither(buf, y0, rows, out);
}

// The other core composes every second strip (the pose is set before, and only read while composing)
StripJob job;
TaskHandle_t helper = nullptr;
SemaphoreHandle_t helperDone = nullptr;

void helperTask(void*) {
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
    compose(work[1], job.y0, job.rows, job.out);
    xSemaphoreGive(helperDone);
  }
}

uint32_t lastComposeUs = 0;

NetStats net;
volatile bool fetching = false, fetchNow = false;

Live liveNow() {
  portENTER_CRITICAL(&liveLock);
  const Live l = live;
  portEXIT_CRITICAL(&liveLock);
  return l;
}

// The state's look and motion taken in: the motion eased toward it, the droop and shrink as CSS transitions,
// the pads repainted for a new tone; the motion clock advanced to t
void advanceLook(double t) {
  const float dt = lastT < 0 ? 0 : (float)(t - lastT);
  lastT = t;
  const Live l = liveNow();
  if (l.have) {
    const float k = min(1.0f, dt / MOTION_EASE_S);
    swaySpeed += (l.swaySpeed - swaySpeed) * k;
    swayAmount += (l.swayAmount - swayAmount) * k;
    flutterAmp += (l.flutter - flutterAmp) * k;
    blinkMs = l.blinkEveryMs;
    tweenTo(droopTween, l.leafDroop, t);
    tweenTo(shrinkTween, l.shrink ? 1 : 0, t);
    if (l.tone != paintedTone || l.blendTone != paintedBlend || l.blendAmount != paintedAmount) {
      paintPads(l.tone, l.blendTone, l.blendAmount);
      palette = paletteFor(l.tone, l.blendTone, l.blendAmount);
    }
    shown = l;
  }
  motionT += dt * swaySpeed;
}

void drawFrame(double t) {
  advanceLook(t);
  pose(t);
  uint32_t composeUs = 0;
  lcd.startWrite();
  int set = 0;
  for (int y0 = 0; y0 < RIG_H; y0 += 2 * STRIP_ROWS) {
    const int rows = min(STRIP_ROWS, RIG_H - y0);
    const int y1 = y0 + STRIP_ROWS, rows1 = max(0, min(STRIP_ROWS, RIG_H - y1));
    // This pair's buffers went out two pairs ago: each push waits for the one before it
    uint16_t* a = dma[set * 2];
    uint16_t* b = dma[set * 2 + 1];
    const uint32_t c0 = micros();
    if (rows1) {
      job = {y1, rows1, b};
      xTaskNotifyGive(helper);
    }
    compose(work[0], y0, rows, a);
    if (rows1) xSemaphoreTake(helperDone, portMAX_DELAY);
    composeUs += micros() - c0;
    lcd.pushImageDMA(TREE_X, TREE_Y + y0, RIG_W, rows, (const lgfx::swap565_t*)a);
    if (rows1) lcd.pushImageDMA(TREE_X, TREE_Y + y1, RIG_W, rows1, (const lgfx::swap565_t*)b);
    set ^= 1;
  }
  lcd.waitDMA();
  lcd.endWrite();
  lastComposeUs = composeUs;
}

// ------------------------------------------------------------------------------------------- blinking

uint32_t blinkAt = 0, blinkEnd = 0, blink2At = 0;

// As BonsaiAvatar: every blinkEveryMs × (0.6..1.4), sometimes twice; never when the state's eyes are closed
bool blinking(uint32_t now) {
  if (blinkMs <= 0) return false;
  if ((int32_t)(now - blinkAt) >= 0) {
    blinkEnd = now + BLINK_MS;
    blink2At = random(100) < 18 ? now + 320 : 0;
    blinkAt = now + (uint32_t)(blinkMs * (0.6f + random(1000) / 1000.0f * 0.8f));
  }
  return (int32_t)(blinkEnd - now) > 0 || (blink2At && (int32_t)(now - blink2At) >= 0 && (int32_t)(now - blink2At) < 150);
}

// ------------------------------------------------------------------------------------- reading the state

int8_t indexOf(const char* const* names, int n, JsonVariantConst v, int8_t fallback) {
  const char* s = v.is<const char*>() ? v.as<const char*>() : nullptr;
  if (s)
    for (int i = 0; i < n; i++)
      if (!strcmp(names[i], s)) return i;
  return fallback;
}
void copyText(char* to, size_t n, JsonVariantConst v) { strlcpy(to, v.is<const char*>() ? v.as<const char*>() : "", n); }

// The body's motion: the first of the animation's classes the library has
int8_t bodyOf(const char* classes) {
  char buf[48];
  strlcpy(buf, classes, sizeof(buf));
  for (char* tok = strtok(buf, " "); tok; tok = strtok(nullptr, " "))
    for (int i = 0; i < RIG_BODY_ANIMS; i++)
      if (!strcmp(RIG_BODY[i].cls, tok)) return i;
  return -1;
}

// An ExpressionState (GET /api/current's expression, or the exported default) into the fields used
bool readExpression(JsonObjectConst x, Live& l) {
  if (x.isNull()) return false;
  JsonObjectConst a = x["avatar"], mo = x["motion"];
  l.tone = indexOf(RIG_TONE_NAMES, RIG_TONES, a["foliage"], 0);
  JsonObjectConst blend = a["foliageBlend"];
  l.blendTone = blend.isNull() ? -1 : indexOf(RIG_TONE_NAMES, RIG_TONES, blend["tone"], -1);
  l.blendAmount = l.blendTone >= 0 ? (blend["amount"] | 0.0f) : 0;
  l.eyes = indexOf(RIG_EYE_NAMES, RIG_EYES, a["eyes"], 0);
  l.mouth = indexOf(RIG_MOUTH_NAMES, RIG_MOUTHS, a["mouth"], 0);
  l.blush = indexOf(RIG_BLUSH_NAMES, RIG_BLUSHES, a["blush"], 0);
  l.gaze = indexOf(RIG_GAZE_NAMES, RIG_GAZES, a["gaze"], 0);
  l.soil = indexOf(RIG_SOIL_NAMES, RIG_SOILS - 1, a["soil"], 0);
  l.sweat = a["sweat"] | false;
  l.shrink = a["posture"].is<const char*>() && !strcmp(a["posture"].as<const char*>(), "shrink");
  bool rain = false;
  l.yellowLeaves = l.newLeaves = false;
  for (JsonVariantConst e : a["effects"].as<JsonArrayConst>()) {
    const char* s = e.as<const char*>();
    if (!s) continue;
    if (!strcmp(s, "yellow_leaves")) l.yellowLeaves = true;
    else if (!strcmp(s, "new_leaves")) l.newLeaves = true;
    else if (!strcmp(s, "rain")) rain = true;
  }
  if (rain && !strcmp(RIG_SOIL_NAMES[l.soil], "moist")) l.soil = RIG_SOILS - 1; // the moist soil darkens while watered
  l.newGrowth = a["seasonalLeaves"]["newGrowth"] | 0.0f;
  l.yellowing = a["seasonalLeaves"]["yellowing"] | 0.0f;
  l.fullness = a["canopy"]["fullness"] | 1.0f;
  l.refilling = a["canopy"]["refilling"] | 0.0f;
  l.canopyYellow = a["canopy"]["yellow"] | 0.0f;
  copyText(l.animation, sizeof(l.animation), a["animation"]);
  l.body = bodyOf(l.animation);
  copyText(l.scene, sizeof(l.scene), x["atmosphere"]["scene"]);
  l.night = x["atmosphere"]["theme"].is<const char*>() && !strcmp(x["atmosphere"]["theme"].as<const char*>(), "night");
  copyText(l.tapLabel, sizeof(l.tapLabel), x["tapLabel"]);
  l.swaySpeed = mo["swaySpeed"] | 1.0f;
  l.swayAmount = mo["swayAmount"] | 1.0f;
  l.flutter = mo["flutter"] | 1.0f;
  l.blinkEveryMs = mo["blinkEveryMs"].isNull() ? 0 : (int32_t)(mo["blinkEveryMs"] | 0);
  l.leafDroop = x["leafDroop"] | 0.0f;
  l.have = true;
  return true;
}

// The filter for GET /api/current: only these fields are kept as the answer streams in
void expressionFilter(JsonDocument& filter) {
  JsonObject e = filter["expression"].to<JsonObject>();
  for (const char* k : {"eyes", "mouth", "foliage", "foliageBlend", "seasonalLeaves", "canopy", "soil", "effects", "blush", "sweat", "posture", "gaze", "animation"})
    e["avatar"][k] = true;
  e["motion"] = true;
  e["leafDroop"] = true;
  e["atmosphere"]["scene"] = true;
  e["atmosphere"]["theme"] = true;
  e["tapLabel"] = true;
}

// ------------------------------------------------------------------------------------------ measuring

struct Measured {
  Heap boot, beforeWifi, withWifi;
  float fps = 0, frameMs = 0, composeMs = 0;   // as it runs (30 fps cap)
  float maxFps = 0, maxFrameMs = 0, maxComposeMs = 0; // uncapped ('b', and once at start)
} m;

Heap heapNow() {
  return {ESP.getFreeHeap(), (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT), ESP.getMinFreeHeap(),
          (uint32_t)heap_caps_get_free_size(MALLOC_CAP_DMA), (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_DMA)};
}
float kb(uint32_t bytes) { return bytes / 1024.0f; }
double seconds() { return esp_timer_get_time() / 1e6; }

// As fast as it goes for a while: the ceiling
void benchmark(uint32_t ms) {
  const uint32_t start = millis();
  uint32_t frames = 0, composeUs = 0;
  const uint32_t t0 = micros();
  while (millis() - start < ms) {
    eyesShut = blinking(millis());
    drawFrame(seconds());
    composeUs += lastComposeUs;
    frames++;
  }
  const float us = micros() - t0;
  m.maxFrameMs = us / frames / 1000;
  m.maxFps = 1000 / m.maxFrameMs;
  m.maxComposeMs = composeUs / (float)frames / 1000;
}

void printHeap(const char* when, const Heap& h) {
  Serial.printf("  heap %-22s free %6.1f KB, largest block %6.1f KB, min ever %6.1f KB; DMA-capable free %6.1f KB, largest %6.1f KB\n", when,
                kb(h.free), kb(h.largest), kb(h.minFree), kb(h.dmaFree), kb(h.dmaLargest));
}

void report() {
  const uint32_t sketch = sketchBytes;
  const uint32_t slot = slotBytes; // the OTA partition the next update would go to: the app's room
  const Live& v = shown;
  Serial.println();
  Serial.printf("[display] Appbonsai display %s, the living tree. Chip %s rev %d, %d MHz\n", FIRMWARE_VERSION, ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getCpuFreqMHz());
  char blend[32] = "";
  if (v.blendTone >= 0) snprintf(blend, sizeof(blend), " + %s %.2f", RIG_TONE_NAMES[v.blendTone], v.blendAmount);
  Serial.printf("  look (%s): %s%s, eyes %s, mouth %s, blush %s%s, gaze %s, soil %s, %s, droop %.2f (now %.2f)%s%s, scene %s%s (library %s)\n",
                v.fromServer ? "the server's" : "exported", RIG_TONE_NAMES[v.tone], blend, RIG_EYE_NAMES[v.eyes], RIG_MOUTH_NAMES[v.mouth], RIG_BLUSH_NAMES[v.blush], v.sweat ? ", sweat" : "", RIG_GAZE_NAMES[v.gaze],
                v.soil < RIG_SOILS - 1 ? RIG_SOIL_NAMES[v.soil] : "moist, watered", v.body >= 0 ? RIG_BODY[v.body].cls : "no body motion", v.leafDroop, droopNow,
                v.shrink ? ", shrunk" : "", v.newLeaves ? ", new leaves" : v.yellowLeaves ? ", yellow leaves" : "", v.scene, v.night ? " (night)" : "", RIG_HASH);
  Serial.printf("  motion now: sway speed %.2f, sway amount %.2f, flutter %.2f, blink every %d ms\n", swaySpeed, swayAmount, flutterAmp, (int)blinkMs);
  Serial.printf("  flash: chip %u KB; sketch %.1f KB of a %.1f KB app slot (%.0f %%); parts copied to RAM %.1f KB, %d leaves\n", ESP.getFlashChipSize() / 1024,
                kb(sketch), kb(slot), 100.0f * sketch / slot, kb(ramParts), RIG_LEAF_COUNT);
  Serial.printf("  buffers: 2 x strip %.1f KB (RGB888, one per core, in %s) + 4 x %.1f KB (DMA); SPI %d MHz, %d rows a strip\n", kb(RIG_W * STRIP_ROWS * 4),
                workInIram ? "IRAM" : "RAM", kb(RIG_W * STRIP_ROWS * 2), TFT_SPI_WRITE_HZ / 1000000, STRIP_ROWS);
  printHeap("at boot:", m.boot);
  printHeap("before Wi-Fi:", m.beforeWifi);
  printHeap("Wi-Fi stack started:", m.withWifi);
  printHeap("now:", heapNow());
  Serial.printf("  running (30 fps cap):  %.1f fps, %.1f ms a frame, %.1f ms of it composing\n", m.fps, m.frameMs, m.composeMs);
  Serial.printf("  uncapped (ceiling):    %.1f fps, %.1f ms a frame, %.1f ms of it composing\n", m.maxFps, m.maxFrameMs, m.maxComposeMs);
  Serial.printf("  network: %s; Wi-Fi %s, %d dBm; fetches %u ok, %u unchanged, %u failed, %u handshakes; last %d in %u ms (%d bytes), slowest %u ms\n", net.status,
                WiFi.isConnected() ? WiFi.localIP().toString().c_str() : "not connected", net.rssi, (unsigned)net.ok, (unsigned)net.notModified,
                (unsigned)net.failed, (unsigned)net.handshakes, net.lastCode, (unsigned)net.lastMs, (int)net.lastSize, (unsigned)net.slowestMs);
  if (net.beforeFree)
    Serial.printf("  heap around fetches: before the first %.1f KB free, largest block %.1f KB; lowest while fetching %.1f KB free, largest block %.1f KB; "
                  "slowest 2 s with a fetch %.1f fps\n",
                  kb(net.beforeFree), kb(net.beforeLargest), kb(net.lowFree), kb(net.lowLargest), net.lowFps);
  if (v.fromServer) Serial.printf("  state %u s ago: \"%s\"\n", (unsigned)((millis() - v.at) / 1000), v.tapLabel);
  Serial.println("  ('b' measures the ceiling again, 'p' profiles, 'f' fetches now, 'r' prints this)");
}

// The column right of the tree: the same numbers, small (17 characters a line)
void drawColumn() {
  const Heap h = heapNow();
  const Live l = liveNow();
  char status[28];
  portENTER_CRITICAL(&liveLock);
  strlcpy(status, net.status, sizeof(status));
  portEXIT_CRITICAL(&liveLock);
  lcd.fillRect(TEXT_X, 0, SCREEN_W - TEXT_X, SCREEN_H, BG);
  lcd.setFont(&fonts::Font0);
  lcd.setTextSize(1);
  int y = 10;
  auto line = [&](uint16_t colour, const char* fmt, auto... v) {
    lcd.setTextColor(colour, BG);
    lcd.setCursor(TEXT_X, y);
    lcd.printf(fmt, v...);
    y += 11;
  };
  auto gap = [&] { y += 5; };
  line(INK, "Appbonsai %s", FIRMWARE_VERSION);
  gap();
  line(INK, "%.1f fps", m.fps);
  line(MUTED, "draw %.0f/%.0f ms", m.composeMs, m.frameMs);
  line(MUTED, "max %.1f fps", m.maxFps);
  gap();
  line(INK, "heap  %.0fK", kb(h.free));
  line(INK, "block %.0fK", kb(h.largest));
  if (net.beforeFree) line(MUTED, "fetch %.0fK/%.0fK", kb(net.lowFree), kb(net.lowLargest));
  line(MUTED, "flash %.0f/%.0fK", kb(sketchBytes), kb(slotBytes));
  gap();
  line(INK, "%.17s", status);
  if (WiFi.isConnected()) line(MUTED, "wifi %d dBm", net.rssi);
  line(MUTED, "ok %u =%u x%u", (unsigned)net.ok, (unsigned)net.notModified, (unsigned)net.failed);
  if (l.have) {
    gap();
    line(INK, "%.17s", l.scene);
    line(MUTED, "%.17s", RIG_TONE_NAMES[l.tone]);
    line(MUTED, "sway %.2f x%.2f", l.swaySpeed, l.swayAmount);
    if (l.fromServer) line(MUTED, "%us ago", (unsigned)((millis() - l.at) / 1000));
    else line(MUTED, "exported look");
  }
}

// Where a frame's time goes: each stage of composing the whole tree box on one core, averaged over 10 frames, no SPI
void profile() {
  const int N = 10;
  uint32_t fill = 0, convert = 0, part[P_COUNT] = {0}, leaves = 0, poseUs = 0;
  for (int k = 0; k < N; k++) {
    uint32_t t0 = micros();
    pose(seconds());
    poseUs += micros() - t0;
    for (int y0 = 0; y0 < RIG_H; y0 += STRIP_ROWS) {
      const int rows = min(STRIP_ROWS, RIG_H - y0);
      t0 = micros();
      const uint32_t bg = bgRgb();
      for (int i = 0; i < rows * RIG_W; i++) work[0][i] = bg;
      fill += micros() - t0;
      for (int id = 0; id < P_COUNT; id++) {
        t0 = micros();
        drawPart(work[0], parts[id], y0, rows);
        part[id] += micros() - t0;
      }
      t0 = micros();
      for (int p = 0; p < 3; p++) drawLeaves(work[0], p, y0, rows);
      leaves += micros() - t0;
      t0 = micros();
      dither(work[0], y0, rows, dma[0]);
      convert += micros() - t0;
    }
  }
  int shownLeaves = 0;
  for (int i = 0; i < RIG_LEAF_COUNT; i++) shownLeaves += leafNow[i].show;
  Serial.printf("[display] profile (ms a frame): pose %.2f, background %.2f, dither %.2f, leaves %.2f (%d shown)\n", poseUs / 1000.0f / N, fill / 1000.0f / N,
                convert / 1000.0f / N, leaves / 1000.0f / N, shownLeaves);
  for (int id = 0; id < P_COUNT; id++) {
    const Sprite* s = parts[id].s;
    if (!s || !s->w) continue;
    Serial.printf("  %-9s %3dx%-3d %6.2f ms  (box now %dx%d)%s\n", PART_NAMES[id], s->w, s->h, part[id] / 1000.0f / N, parts[id].x1 - parts[id].x0,
                  parts[id].y1 - parts[id].y0, s == &faceSprites[id] ? ", from flash" : "");
  }
}

// ------------------------------------------------------------------------------- the state from the server

void setStatus(const char* text) {
  portENTER_CRITICAL(&liveLock);
  strlcpy(net.status, text, sizeof(net.status));
  portEXIT_CRITICAL(&liveLock);
}

#if HAVE_SECRETS
String etag;

// The answer's body as it arrives, for the parser: Content-Length, chunked, or until the server closes. It is
// read to its very end (drain), so the connection is clean for the next request.
struct BodyReader {
  Stream& s;
  bool chunked;
  int32_t left;       // Content-Length bytes still to come (-1: unknown)
  uint32_t chunk = 0; // bytes left in this chunk
  bool started = false, done = false;

  int raw() {
    char c;
    return s.readBytes(&c, 1) == 1 ? (uint8_t)c : -1; // with the client's timeout
  }
  bool line(char* out, size_t n) { // one line, CRLF dropped
    size_t i = 0;
    for (int c; (c = raw()) >= 0;) {
      if (c == '\n') {
        out[i] = 0;
        return true;
      }
      if (c != '\r' && i + 1 < n) out[i++] = c;
    }
    return false;
  }
  int read() {
    if (done) return -1;
    if (!chunked) {
      if (left == 0) return done = true, -1;
      const int c = raw();
      if (c < 0) return done = true, -1;
      if (left > 0) left--;
      return c;
    }
    if (!chunk) {
      char text[24];
      if (started && !line(text, sizeof(text))) return done = true, -1; // the CRLF after the last chunk's data
      started = true;
      if (!line(text, sizeof(text))) return done = true, -1;
      chunk = strtoul(text, nullptr, 16);
      if (!chunk) { // the last chunk: trailers up to an empty line
        while (line(text, sizeof(text)) && text[0]) {}
        return done = true, -1;
      }
    }
    const int c = raw();
    if (c < 0) return done = true, -1;
    chunk--;
    return c;
  }
  size_t readBytes(char* buf, size_t n) {
    size_t i = 0;
    for (int c; i < n && (c = read()) >= 0;) buf[i++] = c;
    return i;
  }
  bool drain() {
    while (read() >= 0) {}
    return !chunked || chunk == 0;
  }
};

// The connection stays open between fetches (HTTP/1.1 keep-alive): the TLS handshake is ~15 s of a core that
// also composes, so it is paid only when the server has closed the connection
NetworkClientSecure tls;
HTTPClient http;

// One GET /api/current: 200 → the fields into `live`; 304 → the state stands; else counted as failed
void fetchState() {
  if (!net.beforeFree) net.beforeFree = ESP.getFreeHeap(), net.beforeLargest = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
  fetching = true;
  const uint32_t t0 = millis();
  int code = -1;
  int32_t size = -1;
  uint32_t headersMs = 0, bodyMs = 0;
  bool reuse = true;
  const bool fresh = !tls.connected();
  if (fresh) net.handshakes++;
  if (http.begin(tls, APPBONSAI_URL "/api/current")) {
    http.setAuthorization("display", APPBONSAI_PASSWORD);
    const char* keep[] = {"ETag", "Transfer-Encoding"};
    http.collectHeaders(keep, 2);
    if (etag.length()) http.addHeader("If-None-Match", etag);
    code = http.GET();
    headersMs = millis() - t0; // (connect + TLS handshake) + request + headers
    size = http.getSize();
    if (code == 200) {
      JsonDocument filter;
      expressionFilter(filter);
      JsonDocument doc;
      const uint32_t b0 = millis();
      BodyReader body{http.getStream(), http.header("Transfer-Encoding").equalsIgnoreCase("chunked"), size};
      const DeserializationError err = deserializeJson(doc, body, DeserializationOption::Filter(filter));
      reuse = body.drain();
      bodyMs = millis() - b0;
      Live l;
      if (err || !readExpression(doc["expression"], l)) {
        code = err ? -100 - (int)err.code() : -99; // -99: no expression in the answer
      } else {
        l.fromServer = true;
        l.at = millis();
        portENTER_CRITICAL(&liveLock);
        live = l;
        portEXIT_CRITICAL(&liveLock);
        etag = http.header("ETag");
      }
    } else if (code == 304) {
      portENTER_CRITICAL(&liveLock);
      live.at = millis();
      portEXIT_CRITICAL(&liveLock);
    }
    if (code != 200 && code != 304) reuse = false; // a body nobody read: start clean
    http.end();
    if (!reuse) tls.stop();
  }
  const uint32_t ms = millis() - t0;
  fetching = false;
  if (code < 0) {
    char why[100];
    const int e = tls.lastError(why, sizeof(why));
    Serial.printf("[display] TLS: %d (%s); 8-bit heap %.1f KB, largest %.1f KB; 32-bit-only (IRAM) free %.1f KB, largest %.1f KB\n", e, why,
                  heap_caps_get_free_size(MALLOC_CAP_8BIT) / 1024.0f, heap_caps_get_largest_free_block(MALLOC_CAP_8BIT) / 1024.0f,
                  (heap_caps_get_free_size(MALLOC_CAP_32BIT) - heap_caps_get_free_size(MALLOC_CAP_8BIT)) / 1024.0f,
                  heap_caps_get_largest_free_block(MALLOC_CAP_32BIT | MALLOC_CAP_EXEC) / 1024.0f);
  }
  char text[28];
  if (code == 200) net.ok++, snprintf(text, sizeof(text), "state in %u ms", (unsigned)ms);
  else if (code == 304) net.notModified++, snprintf(text, sizeof(text), "unchanged, %u ms", (unsigned)ms);
  else if (code == 401) net.failed++, strlcpy(text, "401: wrong password", sizeof(text));
  else net.failed++, snprintf(text, sizeof(text), "failed: %d", code);
  net.lastCode = code, net.lastMs = ms, net.lastSize = size, net.slowestMs = max(net.slowestMs, ms);
  setStatus(text);
  Serial.printf("[display] GET /api/current: %d, %u ms (%s %u, body %u), %d bytes; heap low while fetching %.1f KB free, largest block %.1f KB\n", code, (unsigned)ms,
                fresh ? "handshake + headers" : "headers", (unsigned)headersMs, (unsigned)bodyMs, (int)size, net.lowFree / 1024.0f, net.lowLargest / 1024.0f);
}

// Core 0 at idle priority: the TLS handshake is seconds of arithmetic, and above idle it starved the idle task
// into the task watchdog (a reboot). Composing comes first; this joins the Wi-Fi and fetches once a minute.
void netTask(void*) {
  if (!strlen(WIFI_SSID)) {
    setStatus("no Wi-Fi in secrets.h");
    vTaskDelete(nullptr);
  }
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  tls.setCACert(ROOTS_PEM);
  http.setReuse(true);
  http.setTimeout(10000);
  uint32_t next = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      setStatus("joining Wi-Fi");
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    net.rssi = WiFi.RSSI();
    if (fetchNow || (int32_t)(millis() - next) >= 0) {
      fetchNow = false;
      fetchState();
      next = millis() + (net.lastCode == 200 || net.lastCode == 304 ? FETCH_EVERY_MS : RETRY_MS);
    }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}
#endif

// ------------------------------------------------------------------------------------------- setup/loop

void halt(const char* why) {
  Serial.printf("[display] %s\n", why);
  lcd.setTextColor(INK, BG);
  lcd.drawString(why, 4, 4);
  while (true) delay(1000);
}

// A part that only moves, into RAM
Sprite toRam(const RigSprite& r, bool copyRgb = true) {
  Sprite s = {r.x, r.y, r.w, r.h, nullptr, nullptr, nullptr};
  RigRow* rows = (RigRow*)heap_caps_malloc(max(1, (int)r.h) * sizeof(RigRow), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  uint16_t* rgb = (uint16_t*)heap_caps_malloc(max<uint32_t>(1, r.count) * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  uint8_t* a = (uint8_t*)heap_caps_malloc(max<uint32_t>(1, r.count), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!rows || !rgb || !a) halt("No memory for the tree's parts");
  memcpy(rows, r.rows, r.h * sizeof(RigRow));
  if (copyRgb) memcpy(rgb, r.rgb, r.count * 2);
  memcpy(a, r.a, r.count);
  s.rows = rows, s.rgb = rgb, s.a = a;
  ramParts += r.h * sizeof(RigRow) + r.count * 3;
  return s;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  m.boot = heapNow();

  lcd.init();
  lcd.setRotation(TFT_ROTATION);
  BG = lcd.color565(RIG_BG_DAY[0], RIG_BG_DAY[1], RIG_BG_DAY[2]);
  INK = lcd.color565(0x2d, 0x33, 0x2a); // --ink
  MUTED = lcd.color565(0x8a, 0x8f, 0x86);
  Serial.printf("[display] panel started: %dx%d, SPI %d MHz\n", lcd.width(), lcd.height(), TFT_SPI_WRITE_HZ / 1000000);
#if TFT_COLOUR_CHECK
  // The wiring and colour order at a glance: a white screen through this = the panel gets no commands
  const struct { uint16_t c; const char* name; } fills[] = {{TFT_RED, "red"}, {TFT_GREEN, "green"}, {TFT_BLUE, "blue"}, {TFT_BLACK, "black"}};
  for (auto& f : fills) {
    Serial.printf("[display] colour check: %s\n", f.name);
    lcd.fillScreen(f.c);
    delay(1000);
  }
#endif
  lcd.fillScreen(BG);
  if (PIN_TFT_BL >= 0) lcd.setBrightness(200);

  // The Wi-Fi stack, started but not connected: the heap it leaves is the heap the display will have
  m.beforeWifi = heapNow();
  WiFi.mode(WIFI_STA);
  delay(100);
  m.withWifi = heapNow();

  // The strips in IRAM (32-bit only, ~37 KB otherwise unused), else in RAM
  workInIram = true;
  for (int i = 0; i < 2; i++) {
    work[i] = (uint32_t*)heap_caps_malloc(RIG_W * STRIP_ROWS * 4, MALLOC_CAP_EXEC | MALLOC_CAP_32BIT);
    if (!work[i]) work[i] = (uint32_t*)heap_caps_malloc(RIG_W * STRIP_ROWS * 4, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT), workInIram = false;
  }
  for (int i = 0; i < 4; i++) dma[i] = (uint16_t*)heap_caps_malloc(RIG_W * STRIP_ROWS * 2, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
  if (!work[0] || !work[1] || !dma[0] || !dma[1] || !dma[2] || !dma[3]) halt("No memory for the strip buffers");
  helperDone = xSemaphoreCreateBinary();
  if (!helperDone || xTaskCreatePinnedToCore(helperTask, "compose", 4096, nullptr, 5, &helper, 0) != pdPASS) halt("No second core");
  sketchBytes = ESP.getSketchSize();
  slotBytes = ESP.getFreeSketchSpace();

  for (int i = 0; i <= 96; i++) {
    const float x = i / 8.0f;
    const float t = (-10 + sqrtf(100 + 8 * x)) / 4;
    HALF[i] = (i == 0 || i == 96) ? 0 : 9.2f * t * (1 - t);
  }
  // The parts that only move into RAM; the pads' shapes too, their colours painted for the tone
  base = toRam(RIG_BASE);
  trunk = toRam(RIG_TRUNK);
  branches = toRam(RIG_BRANCHES);
  for (int p = 0; p < 3; p++) {
    pads[p] = toRam(RIG_PAD_SHAPES[p], false);
    padRgb[p] = (uint16_t*)pads[p].rgb;
  }
  for (int i = 0; i < RIG_EYES; i++)
    if (!strcmp(RIG_EYE_NAMES[i], "closed")) closedEyes = i;
  for (int e = 0; e < 3; e++)
    for (int i = 0; i <= 256; i++) EASE_LUT[e][i] = easeExact(i / 256.0f, e);
  K = fromArray(RIG_K);
  Kinv = invert(K);

  // The exported look until the server answers, read as a live answer would be
  {
    JsonDocument doc;
    Live l;
    if (deserializeJson(doc, RIG_DEFAULT_STATE) || !readExpression(doc["expression"], l)) halt("The exported state doesn't read");
    live = l;
    swaySpeed = l.swaySpeed, swayAmount = l.swayAmount, flutterAmp = l.flutter, blinkMs = l.blinkEveryMs;
    droopTween = {l.leafDroop, l.leafDroop, -1e9};
    shrinkTween = {l.shrink ? 1.0f : 0.0f, l.shrink ? 1.0f : 0.0f, -1e9};
  }
  randomSeed(esp_random());
  blinkAt = millis() + (blinkMs > 0 ? random(blinkMs) : 0);

  benchmark(3000);
#if HAVE_SECRETS
  if (xTaskCreatePinnedToCore(netTask, "net", 10240, nullptr, tskIDLE_PRIORITY, nullptr, 0) != pdPASS) setStatus("no memory for the network");
#else
  setStatus("no secrets.h (README)");
#endif
  drawColumn();
  report();
}

void loop() {
  static uint32_t frameAt = 0, windowAt = 0, frames = 0, frameUs = 0, composeUs = 0;
  static bool fetchInWindow = false;
  if (Serial.available()) {
    const int c = Serial.read();
    if (c == 'b') {
      benchmark(5000);
      report();
    } else if (c == 'r') {
      report();
    } else if (c == 'p') {
      profile();
    } else if (c == 'f') {
      fetchNow = true;
    }
  }
  const uint32_t now = micros();
  if (now - frameAt >= FRAME_US) {
    frameAt = now;
    eyesShut = blinking(millis());
    drawFrame(seconds());
    frameUs += micros() - now;
    composeUs += lastComposeUs;
    frames++;
    if (fetching) { // the heap at its lowest while TLS runs
      fetchInWindow = true;
      net.lowFree = min(net.lowFree, (uint32_t)ESP.getFreeHeap());
      net.lowLargest = min(net.lowLargest, (uint32_t)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    }
  }
  if (millis() - windowAt >= 2000 && frames) { // the numbers over the last two seconds, then the column
    const float secs = (millis() - windowAt) / 1000.0f;
    m.fps = frames / secs;
    m.frameMs = frameUs / (float)frames / 1000;
    m.composeMs = composeUs / (float)frames / 1000;
    if (fetchInWindow) net.lowFps = net.lowFps ? min(net.lowFps, m.fps) : m.fps;
    fetchInWindow = false;
    frames = frameUs = composeUs = 0;
    windowAt = millis();
    drawColumn();
  }
}
