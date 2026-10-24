# Appbonsai display (ESP32 #2)

The website's Ficus on a physical screen. A second ESP32 of its own, separate from the sensor ESP32
(`firmware/appbonsai_esp32`, which this never touches).

**Hardware:** ESP32-D0WD-V3 (WROOM-32), 4 MB flash, **no PSRAM** (324 KB free heap in a minimal sketch), and a
3.2" ILI9341 **SPI** TFT, 320 × 240, used in landscape (`TFT_ROTATION 1`). The module's microSD slot and touch pins stay unconnected.

**Step 4 (this sketch): the state's look.** The tree moves as on the website (step 2): the body's motion for
its state, the trunk breathing, the branches swaying about their pivots, each of the 124 leaves quivering on
its own phase, and blinking (sometimes twice). It reads the live tree's ExpressionState once a minute
(`GET /api/current`, over HTTPS with the site's password; nothing on Cloudflare changed for it, step 3), and
now draws what it says: the **foliage tone** (and a season's blend), the **droop** (eased over 2.5 s, as the
website's transition) and a shrunk posture, the **face** (eyes, the pupils where the gaze rests, mouth, blush,
sweat), the **soil** (moist, watered, wet, dry, frozen) and moss, yellow and new leaves, a thinner canopy's
missing leaves and fresh tips, the **body motion** for the state, and night's paper. Its **motion** (sway
speed and amount, flutter, blink interval) eases in over 2 s. It measures and reports as it runs. (Step 1 was
the static test.)

## How the art gets here

```
src/components/avatar/BonsaiAvatar.tsx  (the website's own SVG and AvatarFace)
  → scripts/display/export.ts            react-dom/server → Chrome headless at 198×207 (the 440×460 viewBox × 0.45; `--width`)
     parts that only move:               stand + pot + pillow, trunk (no face), branches
     parts per look:                     the three pads without leaves × 14 foliage tones (one shape, a colour per tone),
                                         the soil × 5 (moist, watered, wet, dry, frozen), the moss × 14 tones,
                                         the face's layers: blush × 6, sweat, eyes × 14 (under / pupils / over), mouths × 13
     the leaves (Foliage.tsx leavesFor): place, size, shade, rim, gap, quiver delay; the palettes
     read from the CSS (css.ts):         the 17 body motions, the trunk's breathing, the sways, the leaf quiver
  → src/assets/tree_rig.h                the parts as premultiplied RGB565 + alpha in per-row spans (256 KB), the rest as tables
  → appbonsai_display.ino                 each frame: the website's look rules for the state (droopOf, leafLook, pupilOffset,
                                          paletteFor), the parts posed at the time t, composed in 8-row RGB888 strips (sampled
                                          bilinearly, leaves rasterised like leafRaster.ts), dithered to RGB565, sent by DMA
```

The look rules run on the device, not as pictures: `scripts/display/look.ts` and the sketch's `droopOf`,
`leafLook`, `pupilOffset`, `paletteFor` are the same rules (keep them in step), and the export checks look.ts
against the markup React emits for a sweep of 57 states (every leaf's matrix, colour, edge, midrib, gloss and
freshness; the pads' droop; the pupils for 5 gazes × 14 eye styles), so a change on the website that the
display doesn't follow fails the export. The leaves are rasterised by `drawLeaves()` exactly as
`scripts/display/leafRaster.ts` (keep the two in step). The export also composes six contrasting looks the
firmware's way and compares them with Chrome's drawing of the whole tree (`chrome_<n>.png` vs `device_<n>.png`;
the last run: mean difference 0.7–1.1/255, 0.1–1.0 % of pixels off by more than 24, mostly leaf edges).

Speed: the parts that only move and the pads are copied from flash into RAM at start (reading flash per pixel
was most of a frame; 57.8 KB), the pads repainted for a new tone; the face, soil and moss are small and read
from flash. The composing is built with `-O3`, and the two cores compose alternate strips.

Not yet: a new tone or face switches at once (the website eases colours over 2 s); a blend mixes the pads and
leaves but the moss stays the main tone's; at a thinner canopy the pads' highlights don't fade and the
branchlets don't show; the mouths' own motion (panting, chattering), the eyes' saccades and the pointer, the
pad highlights' flutter, gestures, filters (heat shimmer, frost…), visitors, effects (sparkles, rain…), the
dream and the hike/yoga props. The scene backdrop is the page's flat paper colour (night: the night paper).

## The connection

```sh
npm run display:setup    # writes secrets.h (gitignored) and src/assets/roots.h
```

It takes the tree's address and password from `.env.cloud` (never printed) and keeps the Wi-Fi lines; type
your Wi-Fi's name and password into `firmware/appbonsai_display/secrets.h` yourself (2.4 GHz). Without
`secrets.h` the sketch still builds and shows the exported state. The site password is in the device's flash:
the Worker has one password for everything for now; a read-only display token would be better later.

`roots.h` holds the roots of the CAs Cloudflare issues from (Let's Encrypt ISRG X1/X2 — workers.dev today,
ECDSA —, Google Trust Services R1/R4, SSL.com 2022), from Node's (Mozilla's) store.

How it fits in an ESP32 without PSRAM (TLS wants ~34 KB of buffers, 16 KB each way, plus the handshake):

- The two RGB888 strips live in **IRAM** (~37 KB of heap that takes only 32-bit loads and stores, otherwise
  unused): every read of a strip is a forced 32-bit load (`ld32`), since `-O3` may narrow `(c >> 16) & 255`
  into a byte load, which faults there.
- The strips are **8 rows** (the DMA buffers halve), and the dither is computed in integers instead of two
  8 KB tables (exactly the same values, checked for every value and cell).
- The network task runs on core 0 at **idle priority**: the TLS handshake is ~15 s of elliptic-curve
  arithmetic on a core that also composes, and above idle it starved the idle task into the task watchdog
  (a reboot).
- **Keep-alive:** the connection stays open between fetches (HTTP/1.1; `BodyReader` reads a chunked or
  Content-Length body to its very end, so the connection stays clean), so the handshake is paid only after the
  server or the Wi-Fi drops it. The answer is ~30 KB; a streaming filter keeps only the fields used.

Generate the asset before compiling (it is gitignored, regenerated from the art):

```sh
npm run display:export                                   # the library; the golden master's last look until the server answers
npm run display:export -- --state current.json           # start with a saved GET /api/current from the live tree
npm run display:export -- --set avatar.eyes=happy --set avatar.mouth=smile   # change any field of that look
```

The library is the same whatever the state; `--state` and `--set` only choose the look shown until the
server's first answer (`RIG_DEFAULT_STATE`, read by the same function as the live answers). To use the live
tree's: open `https://appbonsai.appbonsai.workers.dev/api/current` in the browser (it asks for the password),
save the page as `current.json` outside the repository, and pass it with `--state`.

It also writes, in `build/display/`: for each checked look `chrome_<n>.png` (Chrome's tree) and
`device_<n>.png` / `device_<n>_x3.png` (the library composed the firmware's way, dithered), `part_*.png` and
`manifest.json` (sizes, the checks' results).

## Wiring

| ILI9341 module pin | ESP32 pin | Notes |
|---|---|---|
| VCC | **3V3** | As wired. Most 3.2" modules also take 5V (VIN) through their own regulator when jumper J1 is open; if the screen is dim or unstable on 3V3, try that. |
| GND | GND | |
| CS | GPIO **27** | |
| RESET | GPIO **25** | |
| DC / RS | GPIO **26** | |
| SDI (MOSI) | GPIO **23** | VSPI MOSI (IO_MUX: allows > 40 MHz later) |
| SCK | GPIO **18** | VSPI SCLK (IO_MUX) |
| LED | **3V3** | Backlight always on for now. Check the module first: if LED goes through a transistor, it can move to a PWM pin (e.g. GPIO 32, `PIN_TFT_BL`) for night dimming. If it only goes through a resistor straight to the LEDs, keep it on 3V3: a GPIO can't safely drive it. |
| SDO (MISO) | not connected | Nothing is read back from the panel. |
| T_CLK, T_CS, T_DIN, T_DO, T_IRQ | not connected | Touch (if fitted) comes later. |
| SD_CS, SD_MOSI, SD_MISO, SD_SCK | not connected | No microSD: the assets are in flash. |

The module's logic is 3.3 V, like the ESP32: no level shifters. Keep the wires short (≤ 15 cm) for 40 MHz;
longer jumper wires are the usual reason for garbage at higher clocks.

Pins kept free on purpose: GPIO 0, 2, 5, 12, 15 (boot strapping), 6–11 (the flash), 34–39 (input only),
1 and 3 (USB serial).

## Build and upload

In the Arduino IDE: board **ESP32 Dev Module**, **Tools → Partition Scheme → "Minimal SPIFFS (1.9MB APP with
OTA/128KB SPIFFS)"**, library **LovyanGFX** (1.2.34, Library Manager). Open `appbonsai_display.ino` and upload.

Or with the IDE's arduino-cli:

```sh
arduino-cli compile --fqbn esp32:esp32:esp32:PartitionScheme=min_spiffs firmware/appbonsai_display
arduino-cli upload  --fqbn esp32:esp32:esp32:PartitionScheme=min_spiffs -p COM3 firmware/appbonsai_display
```

Why Minimal SPIFFS: with the default scheme (two 1.25 MB app slots) the static test already uses 81 % of a
slot (Wi-Fi alone is most of it); the HTTPS client and the layered art wouldn't fit. Minimal SPIFFS keeps two
slots (wireless updates stay possible) of 1.9 MB each: the same build is 54 %.

## What it reports

On the serial monitor (115200 baud) and in the column right of the tree:

- **flash:** sketch size of the app slot, and the rig's parts;
- **heap** at boot, before and with the Wi-Fi stack started (not connected: the heap the display will really
  have), and now: free, **largest free block**, minimum ever, and the DMA-capable part;
- **frame rate** as it runs (capped at 30 fps), the time a frame takes and how much of it is composing, and
  the uncapped ceiling (measured for 3 s at start);
- **network:** Wi-Fi, fetches (ok / unchanged / failed), handshakes, the last fetch's time (handshake or not,
  headers, body), the heap before the first fetch and its lowest while fetching, the slowest 2 s of frames
  with a fetch in it, and the state last read.

Send `r` to print the report, `b` to measure the ceiling again (5 s uncapped), `p` for where a frame's time
goes (each part, the leaves and the dither, on one core), `f` to fetch now. A failed TLS connection prints
mbedTLS's reason and the heap at that moment. (Opening the serial monitor restarts the board.)

Measured (2026-10-24, step 4, 198×207 tree box, SPI 40 MHz, Wi-Fi at -67 dBm, the live state `scorching`:
curled tone, squinting, panting, sweat, droop 0.32):

| | |
|---|---|
| Frame rate | **25.4 fps** as it runs (23.0 fps in the slowest 2 s with a fetch); ceiling 24.8 fps uncapped |
| Frame | 38.8 ms, 27.1 ms of it composing on the two cores (step 3: 27.0 fps; the look rules for 124 leaves are 2.6 ms of pose) |
| Sketch | 1384 KB of the 1920 KB slot (72 %; step 3: 61 %); the library 256 KB of it |
| Heap before the first fetch | 97.1 KB free, largest block 68 KB |
| Heap, connection open | 52.5 KB free, largest block 14.0 KB; lowest while fetching 34.3 KB (block 7.7 KB) |
| First fetch | 16.0 s (handshake + headers 14.5 s, body 1.5 s) |
| Later fetches | 1.6 s (headers 0.1–0.2 s, body 1.5 s), on the same connection |

The heap's largest block while fetching is the limit to watch: a first build kept 3 KB more per-leaf state, the
block fell to 1.6 KB, and three answers in four broke off mid-body (ArduinoJson IncompleteInput, a new
handshake each time). Keep the RAM structures small.

## Settings to try (display_config.h)

- Red and blue swapped → `TFT_RGB_ORDER true`. A negative image → `TFT_INVERT true`. Upside down →
  `TFT_ROTATION 2`.
- After a clean run at 40 MHz: `TFT_SPI_WRITE_HZ 80000000`. If the image stays clean, the frame rate nearly
  doubles; if it shows noise or shifted colours, go back to 40 MHz (or try 60 MHz).

## Next steps (after the numbers)

1. ~~The layered rig~~ (step 2, done): sway, breathing, leaf quiver and blinking, sub-pixel motion.
2. ~~The state's motion~~ (step 3, done): the live ExpressionState over HTTPS, its motion on the tree.
3. ~~The state's look~~ (step 4, done): foliage tones and blends, droop, face, soil and moss, the body's motion.
4. Colours easing between looks, the gaze's saccades, the mouths' motion, the pad highlights' flutter, gestures.
5. Visitors, effects and backdrops, if the measured budget allows.
6. On the server, later (agreed first): a small display endpoint (only the fields used, a read-only token)
   would make each fetch a fraction of the 30 KB and keep the site password off the device.
