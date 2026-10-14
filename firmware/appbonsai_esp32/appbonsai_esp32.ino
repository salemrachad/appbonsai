#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>

#include <Wire.h>
#include <Adafruit_HTS221.h>
#include <Adafruit_Sensor.h>

// ======================================================
// APPBONSAI ESP32
//
// FC-28 Soil Sensor:
//   AO  -> GPIO34
//   VCC -> 3V3
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
// ======================================================


// ----------------------
// PINS
// ----------------------

const int SOIL_PIN  = 34;
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
// OBJECTS
// ======================================================

WebServer server(80);
Preferences preferences;

Adafruit_HTS221 hts;

bool htsAvailable = false;

String wifiSSID = "";
String wifiPassword = "";


// ======================================================
// SOIL
// ======================================================

int readSoilRaw() {

  long total = 0;
  const int samples = 30;

  for (int i = 0; i < samples; i++) {
    total += analogRead(SOIL_PIN);
    delay(3);
  }

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

  // Soil

  int soilRaw = readSoilRaw();
  int soilPercent = soilRawToPercent(soilRaw);


  // Light

  int lightRaw = readLightRaw();
  int lightPercent = lightRawToPercent(lightRaw);


  // HTS221

  float temperature = NAN;
  float humidity = NAN;

  if (htsAvailable) {

    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;

    hts.getEvent(
      &humidityEvent,
      &temperatureEvent
    );

    temperature = temperatureEvent.temperature;
    humidity = humidityEvent.relative_humidity;
  }


  // JSON

  String json = "{";


  json += "\"soil_moisture\":";
  json += String(soilPercent);
  json += ",";


  json += "\"soil_raw\":";
  json += String(soilRaw);
  json += ",";


  json += "\"temperature\":";

  if (htsAvailable && !isnan(temperature)) {
    json += String(temperature, 1);
  } else {
    json += "null";
  }

  json += ",";


  json += "\"humidity\":";

  if (htsAvailable && !isnan(humidity)) {
    json += String(humidity, 1);
  } else {
    json += "null";
  }

  json += ",";


  json += "\"light_raw\":";
  json += String(lightRaw);
  json += ",";


  json += "\"light_percent\":";
  json += String(lightPercent);
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
  json += String(WiFi.RSSI());


  json += "}";


  addCorsHeaders();

  server.send(
    200,
    "application/json",
    json
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

  int soilRaw = readSoilRaw();
  int soilPercent = soilRawToPercent(soilRaw);

  int lightRaw = readLightRaw();
  int lightPercent = lightRawToPercent(lightRaw);


  float temperature = NAN;
  float humidity = NAN;


  if (htsAvailable) {

    sensors_event_t humidityEvent;
    sensors_event_t temperatureEvent;

    hts.getEvent(
      &humidityEvent,
      &temperatureEvent
    );

    temperature = temperatureEvent.temperature;
    humidity = humidityEvent.relative_humidity;
  }


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

  html += String(soilPercent);

  html += "%</div>";

  html += "<div class='raw'>RAW: ";

  html += String(soilRaw);

  html += "</div>";

  html += "</div>";


  // TEMP

  html += "<div class='sensor'>";

  html += "🌡 Temperature";

  html += "<div class='value'>";

  if (htsAvailable && !isnan(temperature)) {

    html += String(temperature, 1);

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

  if (htsAvailable && !isnan(humidity)) {

    html += String(humidity, 1);

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

  html += String(lightPercent);

  html += "%</div>";

  html += "<div class='raw'>RAW: ";

  html += String(lightRaw);

  html += "</div>";

  html += "</div>";


  html +=
    "<p class='raw'>ESP32 Live Sensor</p>";

  html += "<p class='raw'>";

  html += WiFi.localIP().toString();

  html += "</p>";


  html += "</div>";

  html += "</body>";

  html += "</html>";


  addCorsHeaders();

  server.send(
    200,
    "text/html",
    html
  );
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
    "<br><br>"
    "<button "
    "type='submit' "
    "style='padding:14px;width:100%;'>"
    "Connect Appbonsai"
    "</button>";


  html += "</form>";

  html += "</div>";

  html += "</body>";

  html += "</html>";


  server.send(
    200,
    "text/html",
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


  server.send(
    200,
    "text/html",
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


  // WIFI

  bool connected =
    connectWifi();


  if (connected) {

    startAppbonsaiServer();

  } else {

    startSetupMode();
  }
}


// ======================================================
// LOOP
// ======================================================

void loop() {

  server.handleClient();

  delay(2);
}
