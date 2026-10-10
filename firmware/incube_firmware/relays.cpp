// firmware/incube_firmware/relays.cpp: Relay control implementation. Owner: Role 1 (firmware).

#include <Arduino.h>
#include "config.h"
#include "relays.h"

namespace {

const int CHANNEL_PINS[RELAY_CHANNEL_COUNT] = {RELAY_PUMP_A_PIN, RELAY_PUMP_B_PIN, RELAY_LIGHT_PIN};
const char *CHANNEL_NAMES[RELAY_CHANNEL_COUNT] = {"pump A", "pump B", "light"};
bool channelOn[RELAY_CHANNEL_COUNT] = {false, false, false};
unsigned long onSinceMs[RELAY_CHANNEL_COUNT] = {0, 0, 0};
bool started = false;

bool validChannel(RelayChannel channel) {
  return channel >= 0 && channel < RELAY_CHANNEL_COUNT;
}

void driveOff(int i) {
  digitalWrite(CHANNEL_PINS[i], RELAY_OFF);
  channelOn[i] = false;
  onSinceMs[i] = 0;
}

}  // namespace

void relaysBegin() {
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) {
    // On ESP32 core 3.x, digitalWrite() is ignored until the pin is registered as GPIO.
    // So: register as INPUT, preload the OFF level, then enable the output. The pin then
    // starts driving OFF instead of briefly driving LOW (on).
    pinMode(CHANNEL_PINS[i], INPUT);
    digitalWrite(CHANNEL_PINS[i], RELAY_OFF);
    pinMode(CHANNEL_PINS[i], OUTPUT);
    driveOff(i);
  }
  started = true;
}

bool relaySet(RelayChannel channel, bool on) {
  if (!started || !validChannel(channel)) return false;
  if (channelOn[channel] == on) return true;  // no change, keep the original timestamp
  if (on) {
    digitalWrite(CHANNEL_PINS[channel], RELAY_ON);
    channelOn[channel] = true;
    onSinceMs[channel] = millis();
  } else {
    driveOff(channel);
  }
  return true;
}

bool relayIsOn(RelayChannel channel) {
  if (!validChannel(channel)) return false;
  return channelOn[channel];
}

unsigned long relayOnSinceMs(RelayChannel channel) {
  if (!validChannel(channel)) return 0;
  return onSinceMs[channel];
}

void relaysAllOff() {
  if (!started) return;
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) driveOff(i);
}

const char *relayName(RelayChannel channel) {
  if (!validChannel(channel)) return "unknown";
  return CHANNEL_NAMES[channel];
}
