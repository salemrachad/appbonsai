#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>

#include <Wire.h>
#include <Adafruit_HTS221.h>
#include <Adafruit_Sensor.h>

// ======================================================
// APPBONSAI ESP32
//
// FC-28 Soil Sensor:
//   AO  -> GPIO34
//   VCC -> GPIO25 (powered only while reading:
//          constant DC corrodes the probe and it
//          drifts toward reading wetter)
//   GND -> GND
//
// LDR:
//   midpoint of LDR + 10k resistor -> GPIO35
//
// HTS221:
//   SDA -> GPIO21
//   SCL -> GPIO22
//   VIN -> 3V3
//   GND -> GND
//
// Two ways the readings reach the Appbonsai server:
//   pull: the server reads GET /api/telemetry on the LAN
//   push: this device sends them to the server's
//         POST /api/ingest (protocol v1, docs/HOSTING.md),
//         set up at http://<device>/settings with the
//         server address and the device token
//         (npm run device -- add <device id>).
//
// Wireless update: POST the compiled .bin to /update
// with the device token (docs/HOSTING.md):
//   curl -H "Authorization: Bearer <token>"
//        -F firmware=@appbonsai_esp32.ino.bin
//        http://<device>/update
// ======================================================

const char* FIRMWARE_VERSION = "1.3.0";


// ----------------------
// PINS
// ----------------------

const int SOIL_PIN  = 34;
const int SOIL_POWER_PIN = 25; // the probe's VCC, on only while it is read
const int LIGHT_PIN = 35;

const int SDA_PIN = 21;
const int SCL_PIN = 22;


// ======================================================
// CALIBRATION
// ======================================================

// Current FC-28 measurements:
//
// AIR / VERY DRY ≈ 4000
// WATER          ≈ 1300
//
// IMPORTANT:
// This is temporary.
// Later calibrate using actual dry/wet bonsai soil.

const int SOIL_DRY_RAW = 4000;
const int SOIL_WET_RAW = 2022;


// LDR test:
//
// DARK   ≈ 0
// BRIGHT ≈ 3000

const int LIGHT_DARK_RAW   = 0;
const int LIGHT_BRIGHT_RAW = 3000;


// ======================================================
// PUSH
// ======================================================

// Readings kept while the server can't be reached:
// 6 h at one a minute. In RAM, so lost on a restart.
const int BUFFER_SIZE = 360;

// Readings per request (the server takes up to 500)
const int MAX_PER_PUSH = 60;

// How often to measure and send. The server's reply
// sets it (Settings in the app; 3 s while calibrating).
unsigned long intervalMs = 60000;


// ======================================================
// OBJECTS
// ======================================================

WebServer server(80);
Preferences preferences;

Adafruit_HTS221 hts;

bool htsAvailable = false;
bool online = false;

String wifiSSID = "";
String wifiPassword = "";

String deviceId = "";
String bootId = "";
String pushUrl = "";
String pushToken = "";


// One measurement. Declared before any function: the
// Arduino build puts its prototypes there.
struct Reading {
  uint32_t seq;
  int64_t uptimeMs;
  int soilRaw;
  int soilPercent;
  int lightRaw;
  int lightPercent;
  float temperature;
  float humidity;
  int rssi;
};

uint32_t nextSeq = 1;


// ======================================================
// DEVICE IDENTITY + TIME
// ======================================================

// The chip's own id (from its MAC): the device id
// the server knows it by. Later printed on the barcode.
String makeDeviceId() {

  uint64_t mac = ESP.getEfuseMac();

  char id[13];

  snprintf(
    id,
    sizeof(id),
    "%02x%02x%02x%02x%02x%02x",
    (uint8_t)(mac),
    (uint8_t)(mac >> 8),
    (uint8_t)(mac >> 16),
    (uint8_t)(mac >> 24),
    (uint8_t)(mac >> 32),
    (uint8_t)(mac >> 40)
  );

  return String(id);
}


// Milliseconds since this start. 64-bit, so it never
// wraps (millis() does after 49 days). The server puts
// readings on its own clock from this: no NTP needed.
int64_t nowMs() {

  return esp_timer_get_time() / 1000;
}


String int64ToString(int64_t v) {

  char buf[24];

  snprintf(
    buf,
    sizeof(buf),
    "%lld",
    (long long)v
  );

  return String(buf);
}


// ======================================================
// SOIL
// ======================================================

int readSoilRaw() {

  // Power the probe only for the reading (against electrolysis), let it settle, drop the first sample
  digitalWrite(SOIL_POWER_PIN, HIGH);
  delay(100);
  analogRead(SOIL_PIN);

  long total = 0;
  const int samples = 30;

  for (int i = 0; i < samples; i++) {
    total += analogRead(SOIL_PIN);
    delay(3);
  }

  digitalWrite(SOIL_POWER_PIN, LOW);

  return total / samples;
}


int soilRawToPercent(int raw) {

  int percent = map(
    raw,
    SOIL_DRY_RAW,
    SOIL_WET_RAW,
    0,
    100
  );

  return constrain(percent, 0, 100);
}


// ======================================================
// LIGHT
// ======================================================

int readLightRaw() {

  long total = 0;
  const int samples = 30;

  for (int i = 0; i < samples; i++) {
    total += analogRead(LIGHT_PIN);
    delay(3);
  }

  return total / samples;
}


int lightRawToPercent(int raw) {

  int percent = map(
    raw,
    LIGHT_DARK_RAW,
    LIGHT_BRIGHT_RAW,
    0,
    100
  );

  return constrain(percent, 0, 100);
}


// ======================================================
// READINGS
// ======================================================

Reading takeReading() {

  Reading r;

  r.seq = nextSeq++;
  r.uptimeMs = nowMs();


  // Soil

  r.soilRaw = readSoilRaw();
  r.soilPercent = soilRawToPercent(r.soilRaw);


  // Light

  r.lightRaw = readLightRaw();
  r.lightPercent = lightRawToPercent(r.lightRaw);


  // HTS221

  r.temperature = NAN;
  r.humidity = NAN;

  if (htsAvailable) {

    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;

    hts.getEvent(
      &humidityEvent,
      &temperatureEvent
    );

    r.temperature = temperatureEvent.temperature;
    r.humidity = humidityEvent.relative_humidity;
  }


  r.rssi = WiFi.RSSI();

  return r;
}


// The reading as JSON: the fields GET /api/telemetry has
// always served; a pushed one adds seq and uptime_ms.
String readingJson(const Reading& r, bool forPush) {

  String json = "{";


  if (forPush) {

    json += "\"seq\":";
    json += String(r.seq);
    json += ",";

    json += "\"uptime_ms\":";
    json += int64ToString(r.uptimeMs);
    json += ",";
  }


  json += "\"soil_moisture\":";
  json += String(r.soilPercent);
  json += ",";


  json += "\"soil_raw\":";
  json += String(r.soilRaw);
  json += ",";


  json += "\"temperature\":";

  if (htsAvailable && !isnan(r.temperature)) {
    json += String(r.temperature, 1);
  } else {
    json += "null";
  }

  json += ",";


  json += "\"humidity\":";

  if (htsAvailable && !isnan(r.humidity)) {
    json += String(r.humidity, 1);
  } else {
    json += "null";
  }

  json += ",";


  json += "\"light_raw\":";
  json += String(r.lightRaw);
  json += ",";


  json += "\"light_percent\":";
  json += String(r.lightPercent);
  json += ",";


  // LDR is not calibrated in lux

  json += "\"light_lux\":null,";


  // Future sensor

  json += "\"soil_temp\":null,";


  // HTS status

  json += "\"hts221_connected\":";

  if (htsAvailable) {
    json += "true";
  } else {
    json += "false";
  }

  json += ",";


  json += "\"source\":\"esp32_sensor\",";


  json += "\"wifi_rssi\":";
  json += String(r.rssi);


  if (!forPush) {

    json += ",\"device_id\":\"";
    json += deviceId;
    json += "\"";
  }


  json += "}";

  return json;
}


// ======================================================
// BUFFER (readings not sent yet, oldest first)
// ======================================================

Reading buffer[BUFFER_SIZE];

int bufferStart = 0;
int bufferCount = 0;


void bufferAdd(const Reading& r) {

  // Full: the oldest reading makes room

  if (bufferCount == BUFFER_SIZE) {

    bufferStart = (bufferStart + 1) % BUFFER_SIZE;
    bufferCount--;
  }

  buffer[(bufferStart + bufferCount) % BUFFER_SIZE] = r;
  bufferCount++;
}


void bufferDrop(int n) {

  n = min(n, bufferCount);

  bufferStart = (bufferStart + n) % BUFFER_SIZE;
  bufferCount -= n;
}


// ======================================================
// PUSH TO THE SERVER
// ======================================================

int64_t lastReadingAt = -1;
int64_t lastPushAt = -1;
int lastPushCode = 0;
int lastPushSent = 0;


bool pushEnabled() {

  return online && pushUrl.length() > 0 && pushToken.length() > 0;
}


// One request. Returns the HTTP status (negative: no
// answer at all) and fills response with the body.
int postJson(const String& body, String& response) {

  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;

  bool started;

  if (pushUrl.startsWith("https://")) {

    // TODO (cloud step): trust only the server's root
    // certificate. For now any certificate is accepted.
    secureClient.setInsecure();

    started = http.begin(secureClient, pushUrl);

  } else {

    started = http.begin(plainClient, pushUrl);
  }

  if (!started) {
    return -1;
  }


  http.setTimeout(8000);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + pushToken);


  int code = http.POST(body);

  if (code > 0) {
    response = http.getString();
  }

  http.end();

  return code;
}


// Send what the buffer holds, oldest first, in requests
// of up to MAX_PER_PUSH. Stops at the first failure: the
// rest stays for the next interval.
void pushBuffer() {

  for (int round = 0; round < 10 && bufferCount > 0; round++) {

    int n = min(bufferCount, MAX_PER_PUSH);


    String body = "{\"v\":1,\"device_id\":\"";
    body += deviceId;
    body += "\",\"fw\":\"";
    body += FIRMWARE_VERSION;
    body += "\",\"boot\":\"";
    body += bootId;
    body += "\",\"readings\":[";

    for (int i = 0; i < n; i++) {

      if (i > 0) {
        body += ",";
      }

      body += readingJson(buffer[(bufferStart + i) % BUFFER_SIZE], true);
    }

    // The device's time at sending: the server compares
    // each reading's uptime_ms with it
    body += "],\"uptime_ms\":";
    body += int64ToString(nowMs());
    body += "}";


    String response = "";

    int code = postJson(body, response);

    lastPushAt = nowMs();
    lastPushCode = code;


    if (code == 200) {

      bufferDrop(n);
      lastPushSent = n;


      // The server says how often to send from now on

      int at = response.indexOf("\"interval_s\":");

      if (at >= 0) {

        long seconds = response.substring(at + 13).toInt();

        if (seconds >= 2 && seconds <= 600) {
          intervalMs = seconds * 1000UL;
        }
      }

      continue;
    }


    Serial.print("Push failed: HTTP ");
    Serial.print(code);
    Serial.print(" ");
    Serial.println(response);


    // Bad data won't get better by sending it again

    if (code == 400) {
      bufferDrop(n);
    }

    // 401 wrong token, 409 server not set to receive,
    // 5xx or no answer: keep the readings, try later

    return;
  }
}


// ======================================================
// PUSH SETTINGS (server address + device token)
// ======================================================

void loadPushSettings() {

  preferences.begin(
    "appbonsai",
    true
  );

  pushUrl = preferences.getString("push_url", "");
  pushToken = preferences.getString("push_token", "");

  preferences.end();
}


// Empty token = keep the current one
void savePushSettings(String url, String token) {

  url.trim();
  token.trim();

  preferences.begin(
    "appbonsai",
    false
  );

  preferences.putString("push_url", url);

  if (token.length() > 0) {
    preferences.putString("push_token", token);
  }

  preferences.end();

  loadPushSettings();
}


String htmlAttr(String s) {

  s.replace("&", "&amp;");
  s.replace("<", "&lt;");
  s.replace(">", "&gt;");
  s.replace("\"", "&quot;");
  s.replace("'", "&#39;");

  return s;
}


String pushStatusText() {

  if (pushUrl.length() == 0 || pushToken.length() == 0) {
    return "Push off (no server address or token)";
  }

  String text = "Push to " + htmlAttr(pushUrl) + "<br>";

  if (lastPushAt < 0) {

    text += "Nothing sent yet";

  } else {

    text += "Last push ";
    text += int64ToString((nowMs() - lastPushAt) / 1000);
    text += " s ago: ";

    if (lastPushCode == 200) {
      text += "OK, " + String(lastPushSent) + " reading(s)";
    } else if (lastPushCode == 401) {
      text += "wrong token or unknown device";
    } else if (lastPushCode == 409) {
      text += "the server is not set to receive pushed readings";
    } else if (lastPushCode < 0) {
      text += "server not reachable";
    } else {
      text += "HTTP " + String(lastPushCode);
    }
  }

  text += "<br>Waiting to send: " + String(bufferCount);
  text += " · every " + String(intervalMs / 1000) + " s";

  return text;
}


// ======================================================
// CORS + LOCAL NETWORK ACCESS
// ======================================================

void addCorsHeaders() {

  server.sendHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  server.sendHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  server.sendHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  server.sendHeader(
    "Access-Control-Allow-Private-Network",
    "true"
  );
}


// ======================================================
// TELEMETRY
// ======================================================

void handleTelemetry() {

  // A reading on request does not use up a seq

  Reading r = takeReading();
  nextSeq--;


  addCorsHeaders();

  server.send(
    200,
    "application/json",
    readingJson(r, false)
  );
}


// ======================================================
// OPTIONS / PREFLIGHT
// ======================================================

void handleOptions() {

  addCorsHeaders();

  server.send(
    204,
    "text/plain",
    ""
  );
}


// ======================================================
// STATUS PAGE
// ======================================================

void handleRoot() {

  Reading r = takeReading();
  nextSeq--;


  String html = "";

  html += "<!DOCTYPE html>";
  html += "<html>";

  html += "<head>";

  html +=
    "<meta name='viewport' "
    "content='width=device-width,initial-scale=1'>";

  html += "<title>Appbonsai</title>";

  html += "<style>";

  html +=
    "body{"
    "font-family:Arial;"
    "background:#f4f1e8;"
    "color:#26382b;"
    "text-align:center;"
    "padding:25px;"
    "}";

  html +=
    ".card{"
    "background:white;"
    "max-width:450px;"
    "margin:auto;"
    "padding:25px;"
    "border-radius:20px;"
    "box-shadow:0 5px 25px rgba(0,0,0,.08);"
    "}";

  html +=
    ".sensor{"
    "background:#f5f7f3;"
    "padding:16px;"
    "margin:12px 0;"
    "border-radius:14px;"
    "}";

  html +=
    ".value{"
    "font-size:32px;"
    "font-weight:bold;"
    "}";

  html +=
    ".raw{"
    "font-size:13px;"
    "color:#777;"
    "}";

  html += "</style>";

  html += "</head>";


  html += "<body>";

  html += "<div class='card'>";

  html += "<h1>🌳 Appbonsai</h1>";


  // SOIL

  html += "<div class='sensor'>";

  html += "💧 Soil Moisture";

  html += "<div class='value'>";

  html += String(r.soilPercent);

  html += "%</div>";

  html += "<div class='raw'>RAW: ";

  html += String(r.soilRaw);

  html += "</div>";

  html += "</div>";


  // TEMP

  html += "<div class='sensor'>";

  html += "🌡 Temperature";

  html += "<div class='value'>";

  if (htsAvailable && !isnan(r.temperature)) {

    html += String(r.temperature, 1);

    html += " °C";

  } else {

    html += "--";
  }

  html += "</div>";

  html += "</div>";


  // HUMIDITY

  html += "<div class='sensor'>";

  html += "💨 Humidity";

  html += "<div class='value'>";

  if (htsAvailable && !isnan(r.humidity)) {

    html += String(r.humidity, 1);

    html += " %";

  } else {

    html += "--";
  }

  html += "</div>";

  html += "</div>";


  // LIGHT

  html += "<div class='sensor'>";

  html += "☀️ Light";

  html += "<div class='value'>";

  html += String(r.lightPercent);

  html += "%</div>";

  html += "<div class='raw'>RAW: ";

  html += String(r.lightRaw);

  html += "</div>";

  html += "</div>";


  // PUSH

  html += "<p class='raw'>";

  html += pushStatusText();

  html += "<br><a href='/settings'>Push settings</a></p>";


  html +=
    "<p class='raw'>ESP32 Live Sensor · firmware ";

  html += FIRMWARE_VERSION;

  html += "</p>";

  html += "<p class='raw'>";

  html += WiFi.localIP().toString();

  html += " · device id ";

  html += deviceId;

  html +=
    pushToken.length() > 0
      ? " · wireless update on"
      : " · wireless update off (no token)";

  html += "</p>";


  html += "</div>";

  html += "</body>";

  html += "</html>";


  addCorsHeaders();

  server.send(
    200,
    "text/html; charset=utf-8",
    html
  );
}


// ======================================================
// PUSH SETTINGS PAGE
// ======================================================

// Anyone on this Wi-Fi can open it, like the status page.
// The token itself is never shown.
String pushFieldsHtml() {

  String html = "";

  html +=
    "<p>Server address (push)<br>"
    "<small>e.g. http://192.168.1.20:3000/api/ingest</small></p>";

  html +=
    "<input "
    "name='push_url' "
    "value='";

  html += htmlAttr(pushUrl);

  html +=
    "' "
    "style='width:100%;padding:12px;'>";


  html += "<p>Device token<br><small>";

  html +=
    pushToken.length() > 0
      ? "Set. Leave empty to keep it."
      : "From: npm run device -- add " + deviceId;

  html += "</small></p>";

  html +=
    "<input "
    "name='push_token' "
    "type='password' "
    "autocomplete='off' "
    "style='width:100%;padding:12px;'>";

  return html;
}


void handleSettingsPage() {

  String html = "";

  html += "<!DOCTYPE html>";
  html += "<html>";

  html += "<head>";

  html +=
    "<meta name='viewport' "
    "content='width=device-width,initial-scale=1'>";

  html += "<title>Appbonsai Push</title>";

  html += "</head>";


  html +=
    "<body style='"
    "font-family:Arial;"
    "background:#f4f1e8;"
    "padding:30px;'>";


  html +=
    "<div style='"
    "background:white;"
    "max-width:400px;"
    "margin:auto;"
    "padding:25px;"
    "border-radius:20px;'>";


  html += "<h2>🌳 Push settings</h2>";

  html += "<p>Device id: <b>";

  html += deviceId;

  html += "</b></p>";

  html += "<p style='font-size:13px;color:#777;'>";

  html += pushStatusText();

  html += "</p>";


  html +=
    "<form method='POST' action='/settings'>";

  html += pushFieldsHtml();

  html +=
    "<br><br>"
    "<button "
    "type='submit' "
    "style='padding:14px;width:100%;'>"
    "Save"
    "</button>";

  html += "</form>";

  html +=
    "<p style='font-size:13px;color:#777;'>"
    "An empty server address turns push off.</p>";

  html += "<p><a href='/'>Back</a></p>";

  html += "</div>";

  html += "</body>";

  html += "</html>";


  server.send(
    200,
    "text/html; charset=utf-8",
    html
  );
}


void handleSaveSettings() {

  savePushSettings(
    server.arg("push_url"),
    server.arg("push_token")
  );


  // Send a reading right away to show it works

  lastReadingAt = -1;


  server.sendHeader("Location", "/settings");

  server.send(303, "text/plain", "");
}


// ======================================================
// WIRELESS UPDATE (POST /update)
// ======================================================

// The password is the device token: whoever may feed
// this tree's data may also update its firmware. No
// token saved = no wireless updates.

bool updateAllowed = false;
bool updateReceived = false;
String updateError = "";


bool tokenMatches(String authorization) {

  if (pushToken.length() == 0) {
    return false;
  }

  String expected = "Bearer " + pushToken;

  if (authorization.length() != expected.length()) {
    return false;
  }

  // Compare every character, so the time taken
  // doesn't tell how much of the token was right
  uint8_t diff = 0;

  for (unsigned int i = 0; i < expected.length(); i++) {
    diff |= authorization[i] ^ expected[i];
  }

  return diff == 0;
}


// Called for each piece of the uploaded file
void handleUpdateUpload() {

  HTTPUpload& upload = server.upload();


  if (upload.status == UPLOAD_FILE_START) {

    updateReceived = true;
    updateError = "";

    updateAllowed =
      tokenMatches(server.header("Authorization"));

    if (!updateAllowed) {
      return;
    }


    Serial.print("Wireless update: ");
    Serial.println(upload.filename);

    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) {
      updateError = Update.errorString();
    }

  } else if (upload.status == UPLOAD_FILE_WRITE) {

    if (!updateAllowed || updateError.length() > 0) {
      return;
    }

    if (
      Update.write(upload.buf, upload.currentSize) !=
      upload.currentSize
    ) {
      updateError = Update.errorString();
      Update.abort();
    }

  } else if (upload.status == UPLOAD_FILE_END) {

    if (!updateAllowed || updateError.length() > 0) {
      return;
    }

    // true: the size is whatever arrived
    if (!Update.end(true)) {
      updateError = Update.errorString();
    }

  } else if (upload.status == UPLOAD_FILE_ABORTED) {

    if (updateAllowed) {
      Update.abort();
    }

    updateError = "upload aborted";
  }
}


// Called once the whole request has arrived
void handleUpdateDone() {

  bool allowed = updateAllowed;
  bool received = updateReceived;
  String error = updateError;

  updateAllowed = false;
  updateReceived = false;
  updateError = "";


  if (!tokenMatches(server.header("Authorization"))) {
    server.send(401, "text/plain", "wrong token or no token saved\n");
    return;
  }

  if (!received || !allowed) {
    server.send(400, "text/plain", "no firmware file (field: firmware)\n");
    return;
  }

  if (error.length() > 0) {
    Serial.println("Wireless update failed: " + error);
    server.send(400, "text/plain", "update failed: " + error + "\n");
    return;
  }


  Serial.println("Wireless update done, restarting...");

  server.send(200, "text/plain", "OK, restarting with the new firmware\n");

  delay(500);

  ESP.restart();
}


// ======================================================
// WIFI SETUP PAGE
// ======================================================

void handleSetupPage() {

  String html = "";

  html += "<!DOCTYPE html>";
  html += "<html>";

  html += "<head>";

  html +=
    "<meta name='viewport' "
    "content='width=device-width,initial-scale=1'>";

  html += "<title>Appbonsai Setup</title>";

  html += "</head>";


  html +=
    "<body style='"
    "font-family:Arial;"
    "background:#f4f1e8;"
    "padding:30px;'>";


  html +=
    "<div style='"
    "background:white;"
    "max-width:400px;"
    "margin:auto;"
    "padding:25px;"
    "border-radius:20px;'>";


  html += "<h2>🌳 Appbonsai</h2>";

  html +=
    "<p>Connect your bonsai to Wi-Fi.</p>";


  html +=
    "<form method='POST' action='/save'>";


  html +=
    "<p>Wi-Fi name</p>";


  html +=
    "<input "
    "name='ssid' "
    "required "
    "style='width:100%;padding:12px;'>";


  html +=
    "<p>Password</p>";


  html +=
    "<input "
    "name='password' "
    "type='password' "
    "style='width:100%;padding:12px;'>";


  html +=
    "<p style='font-size:13px;color:#777;'>"
    "Optional, also later at http://bonsai.local/settings:</p>";

  html += pushFieldsHtml();


  html +=
    "<br><br>"
    "<button "
    "type='submit' "
    "style='padding:14px;width:100%;'>"
    "Connect Appbonsai"
    "</button>";


  html += "</form>";

  html += "<p style='font-size:13px;color:#777;'>Device id: ";

  html += deviceId;

  html += "</p>";

  html += "</div>";

  html += "</body>";

  html += "</html>";


  server.send(
    200,
    "text/html; charset=utf-8",
    html
  );
}


// ======================================================
// SAVE WIFI
// ======================================================

void handleSaveWifi() {

  String ssid = server.arg("ssid");

  String password = server.arg("password");


  preferences.begin(
    "appbonsai",
    false
  );


  preferences.putString(
    "ssid",
    ssid
  );


  preferences.putString(
    "password",
    password
  );


  preferences.end();


  if (server.arg("push_url").length() > 0) {

    savePushSettings(
      server.arg("push_url"),
      server.arg("push_token")
    );
  }


  server.send(
    200,
    "text/html; charset=utf-8",
    "<html><body>"
    "<h2>Saved!</h2>"
    "<p>ESP32 restarting...</p>"
    "</body></html>"
  );


  delay(2000);

  ESP.restart();
}


// ======================================================
// WIFI SETUP MODE
// ======================================================

void startSetupMode() {

  WiFi.mode(WIFI_AP);


  WiFi.softAP(
    "Appbonsai-Setup"
  );


  Serial.println();

  Serial.println(
    "=============================="
  );

  Serial.println(
    "APPBONSAI WIFI SETUP"
  );

  Serial.println(
    "=============================="
  );

  Serial.println();

  Serial.println(
    "Connect to WiFi:"
  );

  Serial.println(
    "Appbonsai-Setup"
  );

  Serial.println();

  Serial.println(
    "Then open:"
  );

  Serial.println(
    "http://192.168.4.1"
  );


  server.on(
    "/",
    HTTP_GET,
    handleSetupPage
  );


  server.on(
    "/save",
    HTTP_POST,
    handleSaveWifi
  );


  server.begin();
}


// ======================================================
// CONNECT WIFI
// ======================================================

bool connectWifi() {

  preferences.begin(
    "appbonsai",
    true
  );


  wifiSSID =
    preferences.getString(
      "ssid",
      ""
    );


  wifiPassword =
    preferences.getString(
      "password",
      ""
    );


  preferences.end();


  if (wifiSSID.length() == 0) {

    return false;
  }


  Serial.print(
    "Connecting to "
  );

  Serial.println(
    wifiSSID
  );


  WiFi.mode(
    WIFI_STA
  );


  WiFi.begin(
    wifiSSID.c_str(),
    wifiPassword.c_str()
  );


  unsigned long startAttempt =
    millis();


  while (
    WiFi.status() != WL_CONNECTED &&
    millis() - startAttempt < 20000
  ) {

    delay(500);

    Serial.print(".");
  }


  Serial.println();


  if (WiFi.status() == WL_CONNECTED) {

    // Comes back by itself after a Wi-Fi drop; the
    // buffer keeps the readings meanwhile
    WiFi.setAutoReconnect(true);


    Serial.println();

    Serial.println(
      "=============================="
    );

    Serial.println(
      "APPBONSAI CONNECTED"
    );

    Serial.println(
      "=============================="
    );


    Serial.print(
      "IP address: "
    );

    Serial.println(
      WiFi.localIP()
    );


    Serial.print(
      "Telemetry URL: http://"
    );

    Serial.print(
      WiFi.localIP()
    );

    Serial.println(
      "/api/telemetry"
    );


    return true;
  }


  Serial.println(
    "Could not connect to WiFi."
  );


  return false;
}


// ======================================================
// SERVER
// ======================================================

void startAppbonsaiServer() {

  server.on(
    "/",
    HTTP_GET,
    handleRoot
  );


  server.on(
    "/api/telemetry",
    HTTP_GET,
    handleTelemetry
  );


  server.on(
    "/api/telemetry",
    HTTP_OPTIONS,
    handleOptions
  );


  server.on(
    "/settings",
    HTTP_GET,
    handleSettingsPage
  );


  server.on(
    "/settings",
    HTTP_POST,
    handleSaveSettings
  );


  server.on(
    "/update",
    HTTP_POST,
    handleUpdateDone,
    handleUpdateUpload
  );


  // The update checks the token in this header
  const char* headerKeys[] = { "Authorization" };

  server.collectHeaders(headerKeys, 1);


  server.begin();


  if (MDNS.begin("bonsai")) {

    Serial.println();

    Serial.println(
      "Also available at:"
    );

    Serial.println(
      "http://bonsai.local"
    );

    Serial.println(
      "http://bonsai.local/api/telemetry"
    );
  }


  Serial.println();

  Serial.println(
    "Appbonsai server started."
  );
}


// ======================================================
// SETUP
// ======================================================

void setup() {

  Serial.begin(115200);

  delay(1000);


  Serial.println();

  Serial.println(
    "🌳 Appbonsai starting..."
  );


  // Identity: the chip's id, and a new boot id each start
  // (with seq, it lets the server drop retried readings)

  deviceId = makeDeviceId();

  bootId = String(esp_random(), HEX);


  Serial.print(
    "Device id: "
  );

  Serial.println(
    deviceId
  );


  // ADC

  analogReadResolution(12);


  analogSetPinAttenuation(
    SOIL_PIN,
    ADC_11db
  );


  analogSetPinAttenuation(
    LIGHT_PIN,
    ADC_11db
  );


  pinMode(
    SOIL_PIN,
    INPUT
  );


  pinMode(
    SOIL_POWER_PIN,
    OUTPUT
  );

  digitalWrite(
    SOIL_POWER_PIN,
    LOW
  );


  pinMode(
    LIGHT_PIN,
    INPUT
  );


  // HTS221

  Wire.begin(
    SDA_PIN,
    SCL_PIN
  );


  Serial.print(
    "HTS221: "
  );


  if (hts.begin_I2C()) {

    htsAvailable = true;

    Serial.println(
      "CONNECTED"
    );

  } else {

    htsAvailable = false;

    Serial.println(
      "NOT FOUND"
    );
  }


  // PUSH

  loadPushSettings();


  // WIFI

  online =
    connectWifi();


  if (online) {

    startAppbonsaiServer();


    Serial.print(
      "Push: "
    );

    Serial.println(
      pushUrl.length() > 0 && pushToken.length() > 0
        ? pushUrl
        : "off (set it at /settings)"
    );

  } else {

    startSetupMode();
  }
}


// ======================================================
// LOOP
// ======================================================

void loop() {

  server.handleClient();


  // Push mode: measure every interval and send. Without
  // Wi-Fi the reading waits in the buffer.

  if (
    pushEnabled() &&
    (lastReadingAt < 0 || nowMs() - lastReadingAt >= (int64_t)intervalMs)
  ) {

    lastReadingAt = nowMs();

    bufferAdd(takeReading());


    if (WiFi.status() == WL_CONNECTED) {

      pushBuffer();
    }
  }


  delay(2);
}
