# Appbonsai display (ESP32 #2)

The website's Ficus on a physical screen. A second ESP32 of its own, separate from the sensor ESP32
(`firmware/appbonsai_esp32`, which this never touches).

**Hardware:** ESP32-D0WD-V3 (WROOM-32), 4 MB flash, **no PSRAM** (324 KB free heap in a minimal sketch), and a
3.2" ILI9341 **SPI** TFT, 320 × 240, used in landscape (`TFT_ROTATION 1`). The module's microSD slot and touch pins stay unconnected.

**Step 2 (this sketch): the living tree.** The tree moves as on the website: the body's motion for its state,
the trunk breathing, the branches swaying about their pivots, each of the 124 leaves quivering on its own phase,
and blinking (sometimes twice). It measures and reports as it runs. No network yet: the state is the one the
rig was exported from. (Step 1 was the static test.)

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
composing is built with `-O3`, and the two cores compose alternate strips (core 0 is otherwise idle; the
Wi-Fi stack is started but not connected).

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
  the uncapped ceiling (measured for 3 s at start).

Send `r` to print the report, `b` to measure the ceiling again (5 s uncapped), `p` for where a frame's time
goes (each part, the leaves and the dither, on one core).

Measured (2026-10-24, 198×207 tree box, SPI 40 MHz): **29.6 fps** as it runs, ceiling 30.3 fps; 33 ms a frame,
22 ms of it composing on the two cores (37 ms on one). Sketch 1009.6 KB of the 1920 KB slot (53 %). Heap now
87.7 KB free, **largest block 42 KB** (the parts in RAM take 60.5 KB, the strips 49.6 KB): an HTTPS client
for the state will need most of that block, so the next step measures it first.

## Settings to try (display_config.h)

- Red and blue swapped → `TFT_RGB_ORDER true`. A negative image → `TFT_INVERT true`. Upside down →
  `TFT_ROTATION 2`.
- After a clean run at 40 MHz: `TFT_SPI_WRITE_HZ 80000000`. If the image stays clean, the frame rate nearly
  doubles; if it shows noise or shifted colours, go back to 40 MHz (or try 60 MHz).

## Next steps (after the numbers)

1. ~~The layered rig~~ (step 2, done): sway, breathing, leaf quiver and blinking at 30 fps, sub-pixel motion.
2. The state: the ExpressionState (`expression` in `GET /api/current`) drives foliage, droop, face, motion and
   day/night. No server or engine changes until this step is agreed. Measure the HTTPS client's heap first.
3. The gaze's saccades, the pad highlights' flutter, gestures.
4. Visitors, effects and backdrops, if the measured budget allows.
