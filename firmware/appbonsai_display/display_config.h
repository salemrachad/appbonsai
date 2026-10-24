// The display ESP32 (#2): ESP32-D0WD-V3 (WROOM-32), 4 MB flash, no PSRAM, with a 3.2" ILI9341 SPI TFT (240x320).
// Wiring and why these pins: README.md next to this file.
#pragma once

#define LGFX_USE_V1
#include <LovyanGFX.hpp>

// SCK and MOSI are VSPI's own pins (IO_MUX), so the SPI clock may go above 40 MHz later. CS, DC and RESET are
// plain GPIOs, none of them a boot strapping pin. These are the pins the display is wired to (2026-10-24).
#define PIN_TFT_SCLK 18 // SCK
#define PIN_TFT_MOSI 23 // SDI (MOSI)
#define PIN_TFT_MISO -1 // SDO (MISO): not connected, nothing is read back from the panel
#define PIN_TFT_CS 27   // CS
#define PIN_TFT_DC 26   // DC / RS
#define PIN_TFT_RST 25  // RESET
#define PIN_TFT_BL -1   // LED (backlight): wired to 3.3 V for now; a PWM pin once the module's LED circuit is checked

// 40 MHz is what ILI9341 modules take reliably; try 80 MHz once the static test runs (the README says how)
#define TFT_SPI_WRITE_HZ 40000000
#define TFT_ROTATION 1     // landscape (320x240); 3 turns it upside down
#define TFT_RGB_ORDER false // true if red and blue come out swapped
#define TFT_INVERT false    // true if the colours come out inverted (a negative image)
#define TFT_COLOUR_CHECK 0  // at start: red, green, blue, black for a second each (wiring and colour order)

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_ILI9341 panel;
  lgfx::Bus_SPI bus;
  lgfx::Light_PWM light;

public:
  LGFX() {
    {
      auto cfg = bus.config();
      cfg.spi_host = SPI3_HOST; // VSPI
      cfg.spi_mode = 0;
      cfg.freq_write = TFT_SPI_WRITE_HZ;
      cfg.freq_read = 16000000;
      cfg.spi_3wire = false;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = PIN_TFT_SCLK;
      cfg.pin_mosi = PIN_TFT_MOSI;
      cfg.pin_miso = PIN_TFT_MISO;
      cfg.pin_dc = PIN_TFT_DC;
      bus.config(cfg);
      panel.setBus(&bus);
    }
    {
      auto cfg = panel.config();
      cfg.pin_cs = PIN_TFT_CS;
      cfg.pin_rst = PIN_TFT_RST;
      cfg.pin_busy = -1;
      cfg.panel_width = 240;
      cfg.panel_height = 320;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.readable = false;
      cfg.invert = TFT_INVERT;
      cfg.rgb_order = TFT_RGB_ORDER;
      cfg.dlen_16bit = false;
      cfg.bus_shared = false; // the SD card and touch are not connected
      panel.config(cfg);
    }
    if (PIN_TFT_BL >= 0) {
      auto cfg = light.config();
      cfg.pin_bl = PIN_TFT_BL;
      cfg.invert = false;
      cfg.freq = 44100;
      cfg.pwm_channel = 7;
      light.config(cfg);
      panel.setLight(&light);
    }
    setPanel(&panel);
  }
};
