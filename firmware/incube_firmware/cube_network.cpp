// firmware/incube_firmware/cube_network.cpp: Wi-Fi and MQTT implementation. Owner: Role 1 (firmware).

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "config.h"
#include "secrets.h"
#include "cube_network.h"

namespace {

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);
CommandHandler commandHandler = nullptr;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastWifiLogMs = 0;
bool scanDone = false;
unsigned long lastMqttAttemptMs = 0;
bool wasConnected = false;
bool justConnected = false;

const char *const COMMAND_TOPICS[] = {TOPIC_CMD_PUMP_A, TOPIC_CMD_PUMP_B, TOPIC_CMD_LIGHT};
const int COMMAND_TOPIC_COUNT = 3;

void onMessage(char *topic, uint8_t *payload, unsigned int length) {
  if (commandHandler != nullptr) commandHandler(topic, payload, length);
}

// Give up on a half-finished connection, so the next attempt starts clean.
bool abandon(const char *step) {
  Serial.print("network: setup step failed: ");
  Serial.println(step);
  mqtt.disconnect();
  return false;
}

// One-time check, if Wi-Fi has not joined after a while: can the ESP32 see the configured
// network at all? Prints only about that network, never other names or the password.
// Blocks for a few seconds, once, and only while not connected.
void diagnoseWifi() {
  scanDone = true;
  WiFi.disconnect();  // a scan fails while a join is in progress; pause it, scan, then rejoin
  delay(100);
  // Limit each channel to 120 ms, so the whole scan blocks for about 2 s at most.
  int count = WiFi.scanNetworks(false, false, false, 120);
  if (count < 0) {
    Serial.print("network: Wi-Fi scan failed (code ");
    Serial.print(count);
    Serial.println(")");
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttemptMs = millis();
    return;
  }
  for (int i = 0; i < count; i++) {
    if (WiFi.SSID(i) != String(WIFI_SSID)) continue;
    wifi_auth_mode_t auth = WiFi.encryptionType(i);
    Serial.print("network: configured Wi-Fi is visible, channel ");
    Serial.print(WiFi.channel(i));
    Serial.print(", signal ");
    Serial.print(WiFi.RSSI(i));
    Serial.print(" dBm, security ");
    Serial.println(auth == WIFI_AUTH_WPA2_ENTERPRISE ? "enterprise (needs a username, not supported)"
                   : auth == WIFI_AUTH_OPEN          ? "open"
                   : auth == WIFI_AUTH_WPA3_PSK      ? "WPA3 only (try WPA2/WPA3 compatibility on the hotspot)"
                                                     : "password (supported)");
    WiFi.scanDelete();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttemptMs = millis();
    return;
  }
  Serial.print("network: configured Wi-Fi NOT visible on 2.4 GHz (");
  Serial.print(count);
  Serial.println(" other networks seen). Check the exact name, including apostrophes, and turn on Maximize Compatibility.");
  WiFi.scanDelete();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();  // the scan restarted the join, so time the next retry from now
}

bool connectBroker() {
  // Last will: if the cube drops off without saying goodbye, the broker publishes "offline", retained.
  // This connect call uses a clean session, so no old subscriptions or queued commands survive.
  if (!mqtt.connect(MQTT_CLIENT_ID, TOPIC_STATUS, 1, true, STATUS_OFFLINE)) return false;
  // Clear any retained command left on the broker by mistake, before subscribing, so an old
  // command can never run. An empty payload deletes a retained message.
  for (int i = 0; i < COMMAND_TOPIC_COUNT; i++) {
    if (!mqtt.publish(COMMAND_TOPICS[i], "", true)) return abandon("clear retained command");
  }
  for (int i = 0; i < COMMAND_TOPIC_COUNT; i++) {
    if (!mqtt.subscribe(COMMAND_TOPICS[i], 0)) return abandon("subscribe");
  }
  // Note: PubSubClient only publishes at QoS 0, so this is retained QoS 0, not the QoS 1 the
  // contract asks for. The last will above is QoS 1. See firmware/HANDOFF.md.
  if (!mqtt.publish(TOPIC_STATUS, STATUS_ONLINE, true)) return abandon("publish online");
  return true;
}

}  // namespace

void networkBegin(CommandHandler handler) {
  commandHandler = handler;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();
  wifiClient.setConnectionTimeout(MQTT_SOCKET_TIMEOUT_S * 1000);  // TCP connect, milliseconds
  wifiClient.setTimeout(MQTT_SOCKET_TIMEOUT_S * 1000);            // stream reads, milliseconds
  // Use a numeric address when given one, so there is no name lookup that could stall.
  IPAddress brokerIp;
  if (brokerIp.fromString(MQTT_BROKER_HOST)) {
    mqtt.setServer(brokerIp, MQTT_PORT);
  } else {
    mqtt.setServer(MQTT_BROKER_HOST, MQTT_PORT);
  }
  mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  mqtt.setSocketTimeout(MQTT_SOCKET_TIMEOUT_S);
  mqtt.setCallback(onMessage);
  lastMqttAttemptMs = millis() - MQTT_RETRY_MS;  // try the broker as soon as Wi-Fi is up
}

void networkLoop() {
  unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wasConnected) {
      Serial.println("network: Wi-Fi lost");
      wasConnected = false;
    }
    if ((now - lastWifiLogMs) >= WIFI_RETRY_MS) {
      lastWifiLogMs = now;
      wl_status_t status = WiFi.status();
      Serial.print("network: Wi-Fi not connected: ");
      Serial.println(status == WL_NO_SSID_AVAIL   ? "network name not found (check the name, and 2.4 GHz)"
                     : status == WL_CONNECT_FAILED ? "connect failed (check the password)"
                     : status == WL_CONNECTION_LOST ? "connection lost"
                     : status == WL_DISCONNECTED   ? "disconnected, auto-reconnect is trying"
                     : status == WL_IDLE_STATUS    ? "idle"
                                                    : "other");
    }
    if (!scanDone && (now - lastWifiAttemptMs) >= 15000) diagnoseWifi();
    // Auto-reconnect is on, so only force a fresh attempt now and then. Forcing it too often
    // restarts a join that is still in progress.
    if ((now - lastWifiAttemptMs) >= WIFI_RECONNECT_MS) {
      lastWifiAttemptMs = now;
      WiFi.reconnect();
    }
    return;
  }
  if (!mqtt.connected()) {
    if (wasConnected) {
      Serial.println("network: broker lost");
      wasConnected = false;
    }
    if ((now - lastMqttAttemptMs) < MQTT_RETRY_MS) return;
    lastMqttAttemptMs = now;
    Serial.print("network: connecting to broker at ");
    Serial.println(MQTT_BROKER_HOST);
    if (!connectBroker()) {
      Serial.print("network: broker connect failed, state ");
      Serial.println(mqtt.state());
      return;
    }
    Serial.print("network: online, IP ");
    Serial.println(WiFi.localIP());
    wasConnected = true;
    justConnected = true;
  }
  mqtt.loop();
}

bool networkConnected() {
  return mqtt.connected();
}

bool networkTakeJustConnected() {
  if (!justConnected) return false;
  justConnected = false;
  return true;
}

bool networkPublish(const char *topic, const char *payload, bool retained) {
  if (!mqtt.connected()) return false;
  return mqtt.publish(topic, payload, retained);
}
