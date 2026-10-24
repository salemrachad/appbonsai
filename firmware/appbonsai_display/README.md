# Appbonsai display (ESP32 #2)

The website's Ficus on a physical screen. A second ESP32 of its own, separate from the sensor ESP32
(`firmware/appbonsai_esp32`, which this never touches).

**Hardware:** ESP32-D0WD-V3 (WROOM-32), 4 MB flash, **no PSRAM** (324 KB free heap in a minimal sketch), and a
3.2" ILI9341 **SPI** TFT, 320 × 240, used in landscape (`TFT_ROTATION 1`). The module's microSD slot and touch pins stay unconnected.

**Step 3 (this sketch): the state from the server.** The tree moves as on the website (step 2): the body's
motion for its state, the trunk breathing, the branches swaying about their pivots, each of the 124 leaves
quivering on its own phase, and blinking (sometimes twice). Now it also reads the live tree's ExpressionState
once a minute (`GET /api/current`, over HTTPS with the site's password; nothing on Cloudflare changed for it):
its **motion** (sway speed and amount, flutter, blink interval) moves the tree, eased over 2 s; the face,
foliage, droop and scene are shown as words in the column until their art is exported (the next step). It
measures and reports as it runs. (Step 1 was the static test.)

## How the art gets here

```
src/components/avatar/BonsaiAvatar.tsx  (the website's own SVG, for one ExpressionState)
  → scripts/display/export.ts            react-dom/server → Chrome headless at 198×207 (the 440×460 viewBox × 0.45; `--width`)
     the parts, each drawn alone:        stand + pot, trunk (no face), face open, face closed, branches, the three pads without leaves
     read from the markup (rig.ts):      the 124 leaves (place, colour, edge, midrib, gloss, quiver delay), pad droops and sway pivots
     read from the CSS (css.ts):         the animations' keyframes, durations, easings and origins (body, trunk, sways, leaf quiver)
  → src/assets/tree_rig.h                the parts as premultiplied RGB565 + alpha in per-row spans (60.5 KB), the leaves, the keyframes
  → appbonsai_display.ino                 each frame: poses the rig at the time t, composes the tree's box in 16-row RGB888 strips
                                          (parts sampled bilinearly, leaves rasterised like leafRaster.ts), dithers to RGB565, sends by DMA
```

The leaves are drawn on the device, not exported as pictures: `scripts/display/leafRaster.ts` and the sketch's
`drawLeaves()` are the same rasteriser (keep them in step). The export composes the rest pose itself and
compares it with Chrome's picture (the last run: mean difference 0.75/255, 0.18 % of pixels off by more than 24).

Speed: the parts are copied from flash into RAM at start (reading flash per pixel was most of a frame), the
composing is built with `-O3`, and the two cores compose alternate strips.

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
npm run display:export                                   # the golden master's last state, tree only
npm run display:export -- --state current.json           # a saved GET /api/current from the live tree
npm run display:export -- --set avatar.eyes=happy --set avatar.mouth=smile   # change any field
npm run display:export -- --with-extras                  # keep visitors and effects (deferred for now)
```

To use the live tree's state: open `https://appbonsai.appbonsai.workers.dev/api/current` in the browser
(it asks for the password), save the page as `current.json` outside the repository, and pass it with `--state`.

It also writes, in `build/display/`: `chrome.png` (what Chrome drew), `rest.png` / `rest_x3.png` (the rest
pose as the device composes it), `part_*.png` (each part), `tree.svg` and `manifest.json`. Compare
`rest_x3.png` with the screen.

Not yet: the gaze's idle saccades, the pad highlights' flutter, gestures (sigh, shiver…), visitors, effects
(sparkles, butterfly…), the dream and the hike/yoga props. The scene backdrop is the page's flat paper colour
for now (night: the night paper).

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

Measured (2026-10-24, 198×207 tree box, SPI 40 MHz, Wi-Fi at -66 dBm):

| | |
|---|---|
| Frame rate | **27.0 fps** as it runs (25.4 fps in the slowest 2 s with a fetch); ceiling 27.8 fps |
| Frame | 36.5 ms, 25.2 ms of it composing on the two cores (16-row strips were 29.6 fps, but TLS didn't fit) |
| Sketch | 1170 KB of the 1920 KB slot (61 %) |
| Heap before the first fetch | 95.9 KB free, largest block 68 KB |
| Heap, connection open | 51.2 KB free, largest block 12.5 KB; lowest while fetching 33.0 KB (block 7.7 KB) |
| First fetch | 15.7 s (handshake + headers 14.2 s, body 1.5 s) |
| Later fetches | 1.7 s (headers 0.2 s, body 1.5 s), on the same connection |

## Settings to try (display_config.h)

- Red and blue swapped → `TFT_RGB_ORDER true`. A negative image → `TFT_INVERT true`. Upside down →
  `TFT_ROTATION 2`.
- After a clean run at 40 MHz: `TFT_SPI_WRITE_HZ 80000000`. If the image stays clean, the frame rate nearly
  doubles; if it shows noise or shifted colours, go back to 40 MHz (or try 60 MHz).

## Next steps (after the numbers)

1. ~~The layered rig~~ (step 2, done): sway, breathing, leaf quiver and blinking, sub-pixel motion.
2. ~~The state's motion~~ (step 3, done): the live ExpressionState over HTTPS, its motion on the tree.
3. The state's look: the face (eyes × mouth × blush), the leaves' colours per foliage tone, the droop and the
   body's animation per state, exported as variants and swapped in when the state changes.
4. The gaze's saccades, the pad highlights' flutter, gestures.
5. Visitors, effects and backdrops, if the measured budget allows.
6. On the server, later (agreed first): a small display endpoint (only the fields used, a read-only token)
   would make each fetch a fraction of the 30 KB and keep the site password off the device.
