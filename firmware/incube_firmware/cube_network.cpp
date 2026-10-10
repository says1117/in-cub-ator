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
unsigned long lastMqttAttemptMs = 0;
bool wasConnected = false;

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
    if ((now - lastWifiAttemptMs) >= WIFI_RETRY_MS) {
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
  }
  mqtt.loop();
}

bool networkConnected() {
  return mqtt.connected();
}

bool networkPublish(const char *topic, const char *payload, bool retained) {
  if (!mqtt.connected()) return false;
  return mqtt.publish(topic, payload, retained);
}
