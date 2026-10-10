// firmware/tests/host_safety/test_safety.cpp: Host unit test for relays and safety, runs on a Mac with a fake clock and fake pins. Owner: Role 1 (firmware).
// Run from the repo root:
//   clang++ -std=c++17 -Wall -Wextra -I firmware/tests/host_safety/shim -I firmware/incube_firmware firmware/tests/host_safety/test_safety.cpp firmware/incube_firmware/relays.cpp firmware/incube_firmware/safety.cpp -o /tmp/test_safety && /tmp/test_safety
// The ESP32 hard cutoff timer is not built here (it needs the real chip). Everything else is.

#include <cstdio>
#include <climits>
#include <cstring>
#include "Arduino.h"
#include "config.h"
#include "relays.h"
#include "safety.h"

static unsigned long fakeNow = 0;
static int level[40];
static int mode[40];
static bool registered[40];
void pinMode(uint8_t p, uint8_t m) { mode[p] = m; registered[p] = true; }
void digitalWrite(uint8_t p, uint8_t v) { if (registered[p]) level[p] = v; }  // like core 3.x: ignored until registered
unsigned long millis() { return fakeNow; }

static int fails = 0, passes = 0;
#define CHECK(cond, msg) do { if (cond) { passes++; } else { fails++; printf("FAIL: %s (line %d)\n", msg, __LINE__); } } while (0)
static SafetyResult pump(RelayChannel p, const char *s) { return safetyRequestPump(p, s, strlen(s)); }
static SafetyResult light(const char *s) { return safetyRequestLight(s, strlen(s)); }
static void advance(unsigned long ms) { for (unsigned long i = 0; i < ms; i++) { fakeNow++; safetyLoop(); } }
static bool pinOn(int pin) { return mode[pin] == OUTPUT && level[pin] == LOW; }

int main() {
  for (int i = 0; i < 40; i++) { level[i] = LOW; mode[i] = 0; registered[i] = false; }  // worst case: latch LOW at reset

  CHECK(pump(RELAY_PUMP_A, "2000") == SAFETY_NOT_READY, "rejects before start");
  relaysBegin(); safetyBegin();
  CHECK(!pinOn(RELAY_PUMP_A_PIN) && !pinOn(RELAY_PUMP_B_PIN) && !pinOn(RELAY_LIGHT_PIN), "all off after begin");
  CHECK(level[RELAY_PUMP_A_PIN] == HIGH, "pump A pin driven HIGH (off)");

  unsigned long v = 0;
  CHECK(safetyParsePositive("2000", 4, v) && v == 2000, "parse 2000");
  CHECK(safetyParsePositive("007", 3, v) && v == 7, "parse 007");
  const char *bad[] = {"", "0", "000", "-5", "+5", "12a", " 5", "5 ", "1.5", "1234567890"};
  for (const char *b : bad) CHECK(!safetyParsePositive(b, strlen(b), v), b);
  CHECK(!safetyParsePositive(nullptr, 3, v), "null payload");
  CHECK(pump(RELAY_PUMP_A, "abc") == SAFETY_BAD_PAYLOAD, "bad payload result");
  CHECK(pump(RELAY_LIGHT, "2000") == SAFETY_NOT_READY, "light is not a pump");

  fakeNow = 1000;
  CHECK(pump(RELAY_PUMP_A, "2000") == SAFETY_STARTED, "pump A starts");
  CHECK(pinOn(RELAY_PUMP_A_PIN), "pump A pin on");
  CHECK(pump(RELAY_PUMP_A, "2000") == SAFETY_BUSY, "busy while running");
  advance(1999); CHECK(pinOn(RELAY_PUMP_A_PIN), "still on at 1999 ms");
  advance(1); CHECK(!pinOn(RELAY_PUMP_A_PIN), "off at 2000 ms");
  CHECK(pump(RELAY_PUMP_A, "1000") == SAFETY_TOO_SOON, "too soon right after");
  advance(PUMP_MIN_GAP_MS - 1); CHECK(pump(RELAY_PUMP_A, "1000") == SAFETY_TOO_SOON, "too soon 1 ms before gap");
  advance(1); CHECK(pump(RELAY_PUMP_A, "60000") == SAFETY_STARTED_CAPPED, "long request capped");
  advance(PUMP_MAX_RUN_MS - 1); CHECK(pinOn(RELAY_PUMP_A_PIN), "capped run still on before max");
  advance(1); CHECK(!pinOn(RELAY_PUMP_A_PIN), "capped run off at max");

  CHECK(pump(RELAY_PUMP_B, "1500") == SAFETY_STARTED, "pump B independent of A gap");
  advance(1500); CHECK(!pinOn(RELAY_PUMP_B_PIN), "pump B off");

  CHECK(light("45") == SAFETY_STARTED_CAPPED, "light capped to max minutes");
  advance(LIGHT_MAX_MINUTES * 60000UL - 1); CHECK(pinOn(RELAY_LIGHT_PIN), "light on before max");
  advance(1); CHECK(!pinOn(RELAY_LIGHT_PIN), "light off at max");

  advance(PUMP_MIN_GAP_MS);
  CHECK(pump(RELAY_PUMP_A, "2000") == SAFETY_STARTED, "pump A again");
  advance(500); safetyAllOff();
  CHECK(!pinOn(RELAY_PUMP_A_PIN), "emergency stop");
  CHECK(pump(RELAY_PUMP_A, "2000") == SAFETY_TOO_SOON, "gap counted after emergency stop");

  relaysAllOff();  // external off while nothing runs: no crash
  // Near clock wraparound. unsigned long is 64-bit on the Mac, so wrap at its real limit.
  fakeNow = ULONG_MAX - 1000 - PUMP_MIN_GAP_MS;
  advance(PUMP_MIN_GAP_MS);
  CHECK(pump(RELAY_PUMP_B, "2000") == SAFETY_STARTED, "start near wrap");
  advance(1999); CHECK(pinOn(RELAY_PUMP_B_PIN), "on across wrap");
  advance(1); CHECK(!pinOn(RELAY_PUMP_B_PIN), "off on time across wrap");

  // Calling safetyBegin() again must not erase the gap history.
  advance(PUMP_MIN_GAP_MS);
  CHECK(pump(RELAY_PUMP_A, "1000") == SAFETY_STARTED, "pump A before re-begin");
  advance(1000);
  safetyBegin();
  CHECK(pump(RELAY_PUMP_A, "1000") == SAFETY_TOO_SOON, "gap survives second safetyBegin");

  // Hard cutoff path: pin forced off outside loop, bookkeeping catches up in safetyLoop().
  advance(PUMP_MIN_GAP_MS);
  CHECK(pump(RELAY_PUMP_B, "2000") == SAFETY_STARTED, "pump B for cutoff test");
  relayHardOff(RELAY_PUMP_B);
  CHECK(!pinOn(RELAY_PUMP_B_PIN), "hard off drives pin off");
  CHECK(pump(RELAY_PUMP_B, "2000") == SAFETY_BUSY, "still busy until loop records it");
  advance(2000);
  CHECK(pump(RELAY_PUMP_B, "2000") == SAFETY_TOO_SOON, "gap after hard off");
  CHECK(!pinOn(RELAY_PUMP_B_PIN), "pin stays off");

  printf("%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
