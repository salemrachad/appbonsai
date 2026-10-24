// Appbonsai display (ESP32 #2): the website's Ficus on a 3.2" ILI9341 (320x240, landscape).
//
// Step 2, the living tree: the website's avatar as a rig (scripts/display/export.ts → src/assets/tree_rig.h).
// Its parts as Chrome draws them (stand and pot, trunk, face open and closed, branches, the three pads without
// their leaves) are moved by the website's own CSS animations: the body's motion for the state, the trunk's
// breathing, the branch sways about their pivots near the trunk. The 124 leaves are drawn here, each one
// quivering about its base on its own phase, and the eyes blink at the state's interval, sometimes twice.
// Sway speed, sway amount and flutter are the state's (ExpressionState.motion), as on the website.
//
// No framebuffer (150 KB) on an ESP32 without PSRAM: the tree's box is composed in strips of 32 rows (RGB888,
// the parts sampled bilinearly so motions smaller than a pixel stay smooth), dithered to RGB565 like the
// export (a fixed pattern) and sent by DMA while the next strip is composed.
//
// Step 3, the state from the server: with secrets.h (npm run display:setup, then your Wi-Fi in it) a task on
// core 0 joins the Wi-Fi and reads the tree's GET /api/current once a minute over HTTPS (HTTP Basic, the
// site's password; If-None-Match, so an unchanged state is a 304), keeping only the ExpressionState's fields
// it uses (a streaming filter: the ~30 KB answer is never held). Its motion (sway speed and amount, flutter,
// blink interval) moves the tree now, eased over a few seconds; the face, foliage and droop are shown as words
// in the column until their art is exported.
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
#error "No tree rig yet: run `npm run display:export` in the repository first (see README.md)"
#endif

const char* FIRMWARE_VERSION = "0.3.0";

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

LGFX lcd;
uint32_t* work[2] = {nullptr, nullptr}; // a strip of the tree's box per core, 0x00RRGGBB (in IRAM: see ld32)
bool workInIram = false;
uint16_t* dma[4] = {nullptr};          // two pairs of strips as the panel takes them (byte-swapped RGB565)
uint32_t sketchBytes = 0, slotBytes = 0; // measured once: getSketchSize() reads the whole sketch from flash

float HALF[97];                        // the leaf's half-width, x = 0..12 in steps of 1/8
uint16_t BG, INK, MUTED;
const uint32_t BG_RGB = (RIG_BG_R << 16) | (RIG_BG_G << 8) | RIG_BG_B;
const uint8_t BAYER4[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};

// Declared before the first function: the Arduino build puts its prototypes there
// The parts in RAM (copied from flash at start): reading flash for every pixel was most of a frame
struct StripJob {
  int y0, rows;
  uint16_t* out;
};
struct Sprite {
  int16_t x, y, w, h;
  RigRow* rows;
  uint16_t* rgb;
  uint8_t* a;
};
struct Heap {
  uint32_t free, largest, minFree, dmaFree, dmaLargest;
};
// The ExpressionState's fields the display uses (GET /api/current → expression), as last fetched
struct Live {
  bool have = false;
  uint32_t at = 0; // millis() of the last fetch that confirmed it (200 or 304)
  float swaySpeed = 1, swayAmount = 1, flutter = 1, leafDroop = 0;
  int32_t blinkEveryMs = 0; // <= 0: null (eyes closed, no blinking)
  char eyes[16] = "", mouth[16] = "", foliage[16] = "", blush[12] = "", posture[12] = "", gaze[12] = "";
  char animation[32] = "", scene[16] = "", theme[8] = "", tapLabel[40] = "";
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

// ---------------------------------------------------------------------------------------------- matrices

struct Mat {
  float a, b, c, d, e, f; // SVG matrix(a b c d e f): x' = a x + c y + e, y' = b x + d y + f
};
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

// The motion now (ExpressionState.motion): the export's until the server's arrives, then eased toward it.
// Speed runs a clock of its own (tm += dt × speed), so a new tempo never jumps the sway's phase.
float swaySpeed = RIG_SWAY_SPEED, swayAmount = RIG_SWAY_AMOUNT, flutterAmp = RIG_FLUTTER;
int32_t blinkMs = RIG_BLINK_MS;
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

// ------------------------------------------------------------------------------------------ the frame

struct Part {
  Mat inv; // tree-box pixel now → its pixel at rest
  int x0, y0, x1, y1;
};
struct LeafNow {
  Mat inv; // tree-box pixel → leaf space
  float cx, cy, edgeHalf;
  float reachX, reachY; // beyond these (leaf units) no pixel is touched
  int x0, y0, x1, y1;
};
Part parts[SPR_COUNT];
LeafNow leafNow[RIG_LEAF_COUNT];
Mat K, Kinv, droopInv[3];
bool eyesShut = false;

void box(const Mat& m, float x0, float y0, float x1, float y1, int& bx0, int& by0, int& bx1, int& by1) {
  const float xs[4] = {m.a * x0 + m.c * y0 + m.e, m.a * x1 + m.c * y0 + m.e, m.a * x0 + m.c * y1 + m.e, m.a * x1 + m.c * y1 + m.e};
  const float ys[4] = {m.b * x0 + m.d * y0 + m.f, m.b * x1 + m.d * y0 + m.f, m.b * x0 + m.d * y1 + m.f, m.b * x1 + m.d * y1 + m.f};
  float lx = xs[0], hx = xs[0], ly = ys[0], hy = ys[0];
  for (int i = 1; i < 4; i++) lx = min(lx, xs[i]), hx = max(hx, xs[i]), ly = min(ly, ys[i]), hy = max(hy, ys[i]);
  bx0 = max(0, (int)floorf(lx) - 1), by0 = max(0, (int)floorf(ly) - 1);
  bx1 = min(RIG_W, (int)ceilf(hx) + 1), by1 = min(RIG_H, (int)ceilf(hy) + 1);
}

// Every part and leaf where it is at time t
void pose(double t) {
  const Mat body = animAt(RIG_ANIM_BODY, t, 0, RIG_BODY_ORIGIN[0], RIG_BODY_ORIGIN[1]);
  const Mat trunk = mul(body, animAt(RIG_ANIM_TRUNK, t, 0, RIG_TRUNK_ORIGIN[0], RIG_TRUNK_ORIGIN[1]));
  Mat pad[3];
  for (int i = 0; i < 3; i++) {
    const RigPad& p = RIG_PADS[i];
    const Mat sway = animAt(p.sway ? RIG_ANIM_SWAY_RIGHT : RIG_ANIM_SWAY_LEFT, t, 0, p.px, p.py);
    pad[i] = mul(body, mul(fromArray(p.droop), mul(sway, droopInv[i]))); // the sway turns inside the droop
  }
  const Mat of[SPR_COUNT] = {body, trunk, trunk, trunk, body, pad[0], pad[1], pad[2]};
  for (int i = 0; i < SPR_COUNT; i++) {
    const RigSprite& s = RIG_SPRITES[i];
    const Mat m = mul(K, mul(of[i], Kinv)); // tree-box pixels at rest → now
    parts[i].inv = invert(m);
    box(m, s.x, s.y, s.x + s.w, s.y + s.h, parts[i].x0, parts[i].y0, parts[i].x1, parts[i].y1);
  }
  for (int i = 0; i < RIG_LEAF_COUNT; i++) {
    const RigLeaf& l = RIG_LEAVES[i];
    const Mat q = animAt((l.flags & LEAF_FRESH) ? RIG_ANIM_QUIVER_FRESH : RIG_ANIM_QUIVER, t, l.delay, 0, 0);
    const Mat m = mul(K, mul(pad[l.pad], mul(fromArray(l.m), q)));
    LeafNow& n = leafNow[i];
    n.inv = invert(m);
    n.cx = hypotf(m.a, m.b);
    n.cy = hypotf(m.c, m.d);
    n.edgeHalf = (l.flags & LEAF_EDGE) ? l.edgeWidth / 2 * n.cy : 0;
    n.reachX = (0.5f + n.edgeHalf) / n.cx;
    n.reachY = 2.3f + (0.5f + n.edgeHalf) / n.cy; // the lens is 2.3 wide at most
    box(m, 0, -2.5f, 12, 2.5f, n.x0, n.y0, n.x1, n.y1);
  }
}

Sprite sprites[SPR_COUNT];

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
void drawPart(uint32_t* buf, int id, int y0, int rows) {
  const Sprite& s = sprites[id];
  const Part& p = parts[id];
  if (!s.w) return;
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
  for (int i = 0; i < RIG_LEAF_COUNT; i++) {
    const RigLeaf& l = RIG_LEAVES[i];
    if (l.pad != pad) continue;
    const LeafNow& n = leafNow[i];
    const int ya = max(n.y0, y0), yb = min(n.y1, y0 + rows);
    const float fr = (l.fill >> 16) & 255, fg = (l.fill >> 8) & 255, fb = l.fill & 255;
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
        float r = fr, g = fg, b = fb;
        if (l.flags & LEAF_EDGE) {
          const float e = constrain(n.edgeHalf + 0.5f - fabsf(d), 0.0f, 1.0f);
          r += (((l.edge >> 16) & 255) - r) * e, g += (((l.edge >> 8) & 255) - g) * e, b += ((l.edge & 255) - b) * e;
        }
        if ((l.flags & LEAF_RIB) && lx > 1.5f && lx < 10) {
          const float e = constrain(0.3f * n.cy + 0.5f - fabsf(ly) * n.cy, 0.0f, 1.0f) * 0.35f;
          r += (((l.rib >> 16) & 255) - r) * e, g += (((l.rib >> 8) & 255) - g) * e, b += ((l.rib & 255) - b) * e;
        }
        if ((l.flags & LEAF_GLOSS) && lx > 3 && lx < 9) {
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

// One strip: background, the parts and leaves in the website's order, then dithered for the panel
void compose(uint32_t* buf, int y0, int rows, uint16_t* out) {
  for (int i = 0; i < rows * RIG_W; i++) buf[i] = BG_RGB;
  drawPart(buf, SPR_BASE, y0, rows);
  drawPart(buf, SPR_TRUNK, y0, rows);
  drawPart(buf, eyesShut ? SPR_FACE_CLOSED : SPR_FACE, y0, rows);
  drawPart(buf, SPR_BRANCHES, y0, rows);
  for (int p = 0; p < 3; p++) {
    drawPart(buf, SPR_PAD0 + p, y0, rows);
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

Live live;  // written by the network task, read by the frame (under liveLock)
NetStats net;
portMUX_TYPE liveLock = portMUX_INITIALIZER_UNLOCKED;
volatile bool fetching = false, fetchNow = false;

Live liveNow() {
  portENTER_CRITICAL(&liveLock);
  const Live l = live;
  portEXIT_CRITICAL(&liveLock);
  return l;
}

// The motion eased toward the state's, and the motion clock advanced to t
void advanceMotion(double t) {
  const float dt = lastT < 0 ? 0 : (float)(t - lastT);
  lastT = t;
  const Live l = liveNow();
  if (l.have) {
    const float k = min(1.0f, dt / MOTION_EASE_S);
    swaySpeed += (l.swaySpeed - swaySpeed) * k;
    swayAmount += (l.swayAmount - swayAmount) * k;
    flutterAmp += (l.flutter - flutterAmp) * k;
    blinkMs = l.blinkEveryMs;
  }
  motionT += dt * swaySpeed;
}

void drawFrame(double t) {
  advanceMotion(t);
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

uint32_t partBytes() {
  uint32_t n = 0;
  for (int i = 0; i < SPR_COUNT; i++) n += RIG_SPRITES[i].count * 3 + RIG_SPRITES[i].h * sizeof(RigRow);
  return n;
}

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
  Serial.println();
  Serial.printf("[display] Appbonsai display %s, the living tree. Chip %s rev %d, %d MHz\n", FIRMWARE_VERSION, ESP.getChipModel(), ESP.getChipRevision(),
                ESP.getCpuFreqMHz());
  Serial.printf("  look: %s (rig %s)\n", RIG_LOOK, RIG_HASH);
  Serial.printf("  motion now: sway speed %.2f, sway amount %.2f, flutter %.2f, blink every %d ms (exported: %.2f, %.2f, %.2f, %d)\n", swaySpeed, swayAmount,
                flutterAmp, (int)blinkMs, RIG_SWAY_SPEED, RIG_SWAY_AMOUNT, RIG_FLUTTER, (int)RIG_BLINK_MS);
  Serial.printf("  flash: chip %u KB; sketch %.1f KB of a %.1f KB app slot (%.0f %%); the rig's parts %.1f KB (copied to RAM), %d leaves\n", ESP.getFlashChipSize() / 1024,
                kb(sketch), kb(slot), 100.0f * sketch / slot, kb(partBytes()), RIG_LEAF_COUNT);
  Serial.printf("  buffers: 2 x strip %.1f KB (RGB888, one per core, in %s) + 4 x %.1f KB (DMA); SPI %d MHz, %d rows a strip\n", kb(RIG_W * STRIP_ROWS * 4),
                workInIram ? "IRAM" : "RAM", kb(RIG_W * STRIP_ROWS * 2), TFT_SPI_WRITE_HZ / 1000000, STRIP_ROWS);
  printHeap("at boot:", m.boot);
  printHeap("before Wi-Fi:", m.beforeWifi);
  printHeap("Wi-Fi stack started:", m.withWifi);
  printHeap("now:", heapNow());
  Serial.printf("  running (30 fps cap):  %.1f fps, %.1f ms a frame, %.1f ms of it composing\n", m.fps, m.frameMs, m.composeMs);
  Serial.printf("  uncapped (ceiling):    %.1f fps, %.1f ms a frame, %.1f ms of it composing\n", m.maxFps, m.maxFrameMs, m.maxComposeMs);
  const Live l = liveNow();
  Serial.printf("  network: %s; Wi-Fi %s, %d dBm; fetches %u ok, %u unchanged, %u failed, %u handshakes; last %d in %u ms (%d bytes), slowest %u ms\n", net.status,
                WiFi.isConnected() ? WiFi.localIP().toString().c_str() : "not connected", net.rssi, (unsigned)net.ok, (unsigned)net.notModified,
                (unsigned)net.failed, (unsigned)net.handshakes, net.lastCode, (unsigned)net.lastMs, (int)net.lastSize, (unsigned)net.slowestMs);
  if (net.beforeFree)
    Serial.printf("  heap around fetches: before the first %.1f KB free, largest block %.1f KB; lowest while fetching %.1f KB free, largest block %.1f KB; "
                  "slowest 2 s with a fetch %.1f fps\n",
                  kb(net.beforeFree), kb(net.beforeLargest), kb(net.lowFree), kb(net.lowLargest), net.lowFps);
  if (l.have)
    Serial.printf("  state (%u s ago): scene %s/%s, eyes %s, mouth %s, foliage %s, blush %s, posture %s, gaze %s, %s, droop %.2f, \"%s\"\n",
                  (unsigned)((millis() - l.at) / 1000), l.scene, l.theme, l.eyes, l.mouth, l.foliage, l.blush, l.posture, l.gaze, l.animation, l.leafDroop, l.tapLabel);
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
    line(MUTED, "%.8s/%.8s", l.eyes, l.mouth);
    line(MUTED, "%.17s", l.foliage);
    line(MUTED, "sway %.2f x%.2f", l.swaySpeed, l.swayAmount);
    line(MUTED, "%us ago", (unsigned)((millis() - l.at) / 1000));
  }
}

// Where a frame's time goes: each stage of composing the whole tree box on one core, averaged over 10 frames, no SPI
void profile() {
  const int N = 10;
  uint32_t fill = 0, convert = 0, part[SPR_COUNT] = {0}, leaves = 0, poseUs = 0;
  for (int k = 0; k < N; k++) {
    uint32_t t0 = micros();
    pose(seconds());
    poseUs += micros() - t0;
    for (int y0 = 0; y0 < RIG_H; y0 += STRIP_ROWS) {
      const int rows = min(STRIP_ROWS, RIG_H - y0);
      t0 = micros();
      for (int i = 0; i < rows * RIG_W; i++) work[0][i] = BG_RGB;
      fill += micros() - t0;
      for (int id = 0; id < SPR_COUNT; id++) {
        if (id == SPR_FACE_CLOSED) continue;
        t0 = micros();
        drawPart(work[0], id, y0, rows);
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
  const char* names[SPR_COUNT] = {"base", "trunk", "face", "face_closed", "branches", "pad0", "pad1", "pad2"};
  Serial.printf("[display] profile (ms a frame): pose %.2f, background %.2f, dither %.2f, leaves %.2f\n", poseUs / 1000.0f / N, fill / 1000.0f / N,
                convert / 1000.0f / N, leaves / 1000.0f / N);
  for (int id = 0; id < SPR_COUNT; id++) {
    if (id == SPR_FACE_CLOSED) continue;
    const RigSprite& s = RIG_SPRITES[id];
    Serial.printf("  %-9s %3dx%-3d %6.2f ms  (box now %dx%d)\n", names[id], s.w, s.h, part[id] / 1000.0f / N, parts[id].x1 - parts[id].x0, parts[id].y1 - parts[id].y0);
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

void copyText(char* to, size_t n, JsonVariantConst v) { strlcpy(to, v.is<const char*>() ? v.as<const char*>() : "", n); }

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
      JsonObject e = filter["expression"].to<JsonObject>();
      for (const char* k : {"eyes", "mouth", "foliage", "blush", "posture", "gaze", "animation"}) e["avatar"][k] = true;
      e["motion"] = true;
      e["leafDroop"] = true;
      e["atmosphere"]["scene"] = true;
      e["atmosphere"]["theme"] = true;
      e["tapLabel"] = true;
      JsonDocument doc;
      const uint32_t b0 = millis();
      BodyReader body{http.getStream(), http.header("Transfer-Encoding").equalsIgnoreCase("chunked"), size};
      const DeserializationError err = deserializeJson(doc, body, DeserializationOption::Filter(filter));
      reuse = body.drain();
      bodyMs = millis() - b0;
      JsonObjectConst x = doc["expression"];
      if (err || x.isNull()) {
        code = err ? -100 - (int)err.code() : -99; // -99: no expression in the answer
      } else {
        Live l;
        l.have = true;
        l.at = millis();
        JsonObjectConst a = x["avatar"], mo = x["motion"];
        copyText(l.eyes, sizeof(l.eyes), a["eyes"]);
        copyText(l.mouth, sizeof(l.mouth), a["mouth"]);
        copyText(l.foliage, sizeof(l.foliage), a["foliage"]);
        copyText(l.blush, sizeof(l.blush), a["blush"]);
        copyText(l.posture, sizeof(l.posture), a["posture"]);
        copyText(l.gaze, sizeof(l.gaze), a["gaze"]);
        copyText(l.animation, sizeof(l.animation), a["animation"]);
        copyText(l.scene, sizeof(l.scene), x["atmosphere"]["scene"]);
        copyText(l.theme, sizeof(l.theme), x["atmosphere"]["theme"]);
        copyText(l.tapLabel, sizeof(l.tapLabel), x["tapLabel"]);
        l.swaySpeed = mo["swaySpeed"] | 1.0f;
        l.swayAmount = mo["swayAmount"] | 1.0f;
        l.flutter = mo["flutter"] | 1.0f;
        l.blinkEveryMs = mo["blinkEveryMs"].isNull() ? 0 : (int32_t)(mo["blinkEveryMs"] | 0);
        l.leafDroop = x["leafDroop"] | 0.0f;
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
  Serial.printf("[display] GET /api/current: %d, %u ms (%s %u, body %u), %d bytes; heap low while fetching %.1f KB free, largest block %.1f KB\n", code, (unsigned)ms, fresh ? "handshake + headers" : "headers", (unsigned)headersMs, (unsigned)bodyMs, (int)size,
                net.lowFree / 1024.0f, net.lowLargest / 1024.0f);
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

void setup() {
  Serial.begin(115200);
  delay(300);
  m.boot = heapNow();

  lcd.init();
  lcd.setRotation(TFT_ROTATION);
  BG = lcd.color565(RIG_BG_R, RIG_BG_G, RIG_BG_B);
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
  // The parts into RAM
  for (int i = 0; i < SPR_COUNT; i++) {
    const RigSprite& r = RIG_SPRITES[i];
    Sprite& sp = sprites[i];
    sp.x = r.x, sp.y = r.y, sp.w = r.w, sp.h = r.h;
    sp.rows = (RigRow*)heap_caps_malloc(max(1, (int)r.h) * sizeof(RigRow), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    sp.rgb = (uint16_t*)heap_caps_malloc(r.count * 2, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    sp.a = (uint8_t*)heap_caps_malloc(r.count, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!sp.rows || !sp.rgb || !sp.a) halt("No memory for the tree's parts");
    memcpy(sp.rows, r.rows, r.h * sizeof(RigRow));
    memcpy(sp.rgb, r.rgb, r.count * 2);
    memcpy(sp.a, r.a, r.count);
  }
  for (int e = 0; e < 3; e++)
    for (int i = 0; i <= 256; i++) EASE_LUT[e][i] = easeExact(i / 256.0f, e);
  K = fromArray(RIG_K);
  Kinv = invert(K);
  for (int i = 0; i < 3; i++) droopInv[i] = invert(fromArray(RIG_PADS[i].droop));
  randomSeed(esp_random());
  blinkAt = millis() + (RIG_BLINK_MS > 0 ? random(RIG_BLINK_MS) : 0);

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
