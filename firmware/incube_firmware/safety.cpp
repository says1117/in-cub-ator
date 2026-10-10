// firmware/incube_firmware/safety.cpp: Safety limits implementation. Owner: Role 1 (firmware).

#include <Arduino.h>
#include "config.h"
#include "relays.h"
#include "safety.h"

#ifdef ARDUINO_ARCH_ESP32
#include "esp_timer.h"
#endif

namespace {

const unsigned long MS_PER_MINUTE = 60000UL;
const size_t MAX_PAYLOAD_DIGITS = 9;  // 999999999 fits in 32 bits, so no overflow while parsing

unsigned long runLengthMs[RELAY_CHANNEL_COUNT] = {0, 0, 0};
unsigned long lastOffMs[RELAY_CHANNEL_COUNT] = {0, 0, 0};
bool hasRun[RELAY_CHANNEL_COUNT] = {false, false, false};
bool running[RELAY_CHANNEL_COUNT] = {false, false, false};
bool started = false;

// Hard cutoff: a one-shot ESP32 timer per channel that drives the pin OFF at the deadline,
// even if loop() is stuck. safetyLoop() still does the bookkeeping. Not built on the host test.
#ifdef ARDUINO_ARCH_ESP32
esp_timer_handle_t cutoffTimer[RELAY_CHANNEL_COUNT] = {nullptr, nullptr, nullptr};
// Absolute deadline (esp_timer_get_time, microseconds) of the current run, 0 when nothing runs.
// The callback only cuts if the current run's deadline has passed, so a late callback left over
// from an earlier run cannot cut a newer one. 64-bit values need the lock on a 32-bit CPU.
int64_t cutoffDeadlineUs[RELAY_CHANNEL_COUNT] = {0, 0, 0};
portMUX_TYPE cutoffLock = portMUX_INITIALIZER_UNLOCKED;

void cutoffCallback(void *arg) {
  RelayChannel channel = (RelayChannel)(intptr_t)arg;
  // Check and switch off inside the lock, so a run cannot be disarmed or re-armed in between.
  portENTER_CRITICAL(&cutoffLock);
  int64_t deadline = cutoffDeadlineUs[channel];
  if (deadline != 0 && esp_timer_get_time() >= deadline) relayHardOff(channel);
  portEXIT_CRITICAL(&cutoffLock);
}

void createCutoffTimers() {
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) {
    if (cutoffTimer[i] != nullptr) continue;
    esp_timer_create_args_t args = {};
    args.callback = cutoffCallback;
    args.arg = (void *)(intptr_t)i;
    args.name = "relay_cutoff";
    esp_timer_create(&args, &cutoffTimer[i]);
  }
}

// Call right after the relay is switched on.
bool armCutoff(RelayChannel channel, unsigned long lengthMs) {
  if (cutoffTimer[channel] == nullptr) return false;
  esp_timer_stop(cutoffTimer[channel]);  // harmless if not running
  uint64_t lengthUs = (uint64_t)lengthMs * 1000ULL;
  portENTER_CRITICAL(&cutoffLock);
  cutoffDeadlineUs[channel] = esp_timer_get_time() + (int64_t)lengthUs;
  portEXIT_CRITICAL(&cutoffLock);
  return esp_timer_start_once(cutoffTimer[channel], lengthUs) == ESP_OK;
}

void disarmCutoff(RelayChannel channel) {
  if (cutoffTimer[channel] != nullptr) esp_timer_stop(cutoffTimer[channel]);
  portENTER_CRITICAL(&cutoffLock);
  cutoffDeadlineUs[channel] = 0;
  portEXIT_CRITICAL(&cutoffLock);
}
#else
void createCutoffTimers() {}
bool armCutoff(RelayChannel, unsigned long) { return true; }
void disarmCutoff(RelayChannel) {}
#endif

unsigned long minGapMs(RelayChannel channel) {
  return channel == RELAY_LIGHT ? LIGHT_MIN_GAP_MS : PUMP_MIN_GAP_MS;
}

void markOff(RelayChannel channel, unsigned long now) {
  disarmCutoff(channel);
  running[channel] = false;
  hasRun[channel] = true;
  lastOffMs[channel] = now;
}

SafetyResult startRun(RelayChannel channel, unsigned long lengthMs, bool capped) {
  if (!started) return SAFETY_NOT_READY;
  unsigned long now = millis();
  if (running[channel] || relayIsOn(channel)) return SAFETY_BUSY;
  if (hasRun[channel] && (now - lastOffMs[channel]) < minGapMs(channel)) return SAFETY_TOO_SOON;
  // Switch on, then arm the hard cutoff. Arming after switching on means the cutoff can never
  // fire before the relay turns on. If arming fails, switch straight back off and refuse.
  if (!relaySet(channel, true)) return SAFETY_NOT_READY;
  if (!armCutoff(channel, lengthMs)) {
    relaySet(channel, false);
    disarmCutoff(channel);
    return SAFETY_NOT_READY;
  }
  runLengthMs[channel] = lengthMs;
  running[channel] = true;
  return capped ? SAFETY_STARTED_CAPPED : SAFETY_STARTED;
}

}  // namespace

bool safetyParsePositive(const char *payload, size_t length, unsigned long &value) {
  if (payload == nullptr || length == 0 || length > MAX_PAYLOAD_DIGITS) return false;
  unsigned long result = 0;
  for (size_t i = 0; i < length; i++) {
    char c = payload[i];
    if (c < '0' || c > '9') return false;
    result = result * 10 + (unsigned long)(c - '0');
  }
  if (result == 0) return false;
  value = result;
  return true;
}

void safetyBegin() {
  if (started) {
    // Called again: do not erase the gap history. Just stop everything.
    safetyAllOff();
    return;
  }
  createCutoffTimers();
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) {
    runLengthMs[i] = 0;
    lastOffMs[i] = 0;
    hasRun[i] = false;
    running[i] = false;
  }
  relaysAllOff();
  started = true;
}

void safetyLoop() {
  if (!started) return;
  unsigned long now = millis();
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) {
    RelayChannel channel = (RelayChannel)i;
    if (!running[i]) {
      // Something else switched it on (should never happen): switch it off.
      if (relayIsOn(channel)) {
        relaySet(channel, false);
        markOff(channel, now);
      }
      continue;
    }
    if (!relayIsOn(channel)) {
      // Switched off elsewhere, for example relaysAllOff(). Count it as the end of the run.
      markOff(channel, now);
      continue;
    }
    if ((now - relayOnSinceMs(channel)) >= runLengthMs[i]) {
      relaySet(channel, false);
      markOff(channel, now);
    }
  }
}

SafetyResult safetyRequestPump(RelayChannel pump, const char *payload, size_t length) {
  if (pump != RELAY_PUMP_A && pump != RELAY_PUMP_B) return SAFETY_NOT_READY;
  unsigned long requested = 0;
  if (!safetyParsePositive(payload, length, requested)) return SAFETY_BAD_PAYLOAD;
  bool capped = requested > PUMP_MAX_RUN_MS;
  return startRun(pump, capped ? PUMP_MAX_RUN_MS : requested, capped);
}

SafetyResult safetyRequestLight(const char *payload, size_t length) {
  unsigned long minutes = 0;
  if (!safetyParsePositive(payload, length, minutes)) return SAFETY_BAD_PAYLOAD;
  bool capped = minutes > LIGHT_MAX_MINUTES;
  if (capped) minutes = LIGHT_MAX_MINUTES;
  return startRun(RELAY_LIGHT, minutes * MS_PER_MINUTE, capped);
}

void safetyAllOff() {
  unsigned long now = millis();
  for (int i = 0; i < RELAY_CHANNEL_COUNT; i++) {
    bool wasOn = running[i] || relayIsOn((RelayChannel)i);
    relaySet((RelayChannel)i, false);
    if (wasOn) markOff((RelayChannel)i, now);
  }
}

const char *safetyResultName(SafetyResult result) {
  switch (result) {
    case SAFETY_STARTED: return "started";
    case SAFETY_STARTED_CAPPED: return "started (capped)";
    case SAFETY_BAD_PAYLOAD: return "bad payload";
    case SAFETY_BUSY: return "busy";
    case SAFETY_TOO_SOON: return "too soon";
    case SAFETY_NOT_READY: return "not ready";
  }
  return "unknown";
}
