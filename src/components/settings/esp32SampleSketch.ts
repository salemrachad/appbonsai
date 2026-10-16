// A minimal Arduino sketch for an FC-28 probe on an ESP32, shown (and copied) in Settings → ESP32.
// The sketch the tree really runs is firmware/appbonsai_esp32/appbonsai_esp32.ino.
export const SAMPLE_ESP32_CODE = `#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

WebServer server(80);

// FC-28 Soil Moisture Sensor connected to GPIO34 (ADC1_CH6)
const int FC28_PIN = 34;

// Calibration values: test raw ADC in dry air vs wet soil
const int AIR_RAW = 3400;   // Dry air raw reading
const int WATER_RAW = 1200; // Submerged / wet soil reading

// Browser Local Network Access (Private Network Access) CORS headers
void addCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void handleTelemetry() {
  addCorsHeaders();

  int raw = analogRead(FC28_PIN);
  int moisture = constrain(map(raw, AIR_RAW, WATER_RAW, 0, 100), 0, 100);

  StaticJsonDocument<256> doc;
  doc["soil_moisture"] = moisture;
  doc["soil_raw"] = raw;
  doc["temperature"] = nullptr;
  doc["humidity"] = nullptr;
  doc["light_lux"] = nullptr;
  doc["soil_temp"] = nullptr;

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12); // 12-bit ADC (0 - 4095)

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\\nConnected! IP: " + WiFi.localIP().toString());

  // Handle CORS preflight OPTIONS for browser Local Network Access (PNA)
  server.on("/api/telemetry", HTTP_OPTIONS, []() {
    addCorsHeaders();
    server.send(204);
  });

  server.on("/api/telemetry", HTTP_GET, handleTelemetry);
  server.begin();
}

void loop() {
  server.handleClient();
}`;
