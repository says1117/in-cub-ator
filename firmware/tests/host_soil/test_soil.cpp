// firmware/tests/host_soil/test_soil.cpp: Host unit test for the soil module, fake clock and fake ADC. Owner: Role 1 (firmware).
// Run from the repo root:
//   clang++ -std=c++17 -Wall -Wextra -I firmware/tests/host_safety/shim -I firmware/incube_firmware firmware/tests/host_soil/test_soil.cpp firmware/incube_firmware/soil.cpp -o /tmp/test_soil && /tmp/test_soil

#include <cstdio>
#include <climits>
#include "Arduino.h"
#include "config.h"
#include "soil.h"

static unsigned long fakeNow = 0;
static int adcValue[40];
static int spikeAt = -1;  // sample number that returns a spike on pin A
static int sampleCount = 0;
void pinMode(uint8_t, uint8_t) {}
void digitalWrite(uint8_t, uint8_t) {}
unsigned long millis() { return fakeNow; }
void analogReadResolution(int) {}
int analogRead(uint8_t pin) {
  if (pin == SOIL_A_PIN) {
    int n = sampleCount++;
    if (n == spikeAt) return 50;
  }
  return adcValue[pin];
}

static int fails = 0, passes = 0;
#define CHECK(cond, msg) do { if (cond) { passes++; } else { fails++; printf("FAIL: %s (line %d)\n", msg, __LINE__); } } while (0)

int main() {
  int a = 0, b = 0;

  int s1[8] = {3430, 3432, 3428, 3431, 100, 3429, 3433, 3430};
  int f1 = soilFilterSamples(s1, 8, SOIL_OUTLIER_LIMIT);
  CHECK(f1 >= 3428 && f1 <= 3433, "single low spike dropped");
  int s2[8] = {1450, 1450, 1450, 1450, 1450, 1450, 1450, 4095};
  CHECK(soilFilterSamples(s2, 8, SOIL_OUTLIER_LIMIT) == 1450, "single high spike dropped");
  int s3[8] = {2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007};
  int f3 = soilFilterSamples(s3, 8, SOIL_OUTLIER_LIMIT);
  CHECK(f3 >= 2003 && f3 <= 2004, "normal spread averaged");
  CHECK(soilFilterSamples(nullptr, 8, 400) == -1, "null input");

  adcValue[SOIL_A_PIN] = 3430;
  adcValue[SOIL_B_PIN] = 1450;
  soilBegin();
  CHECK(soilLatest(SOIL_A) == -1 && soilLatest(SOIL_B) == -1, "no value before first batch");
  CHECK(!soilTakeReading(a, b), "nothing ready at start");

  spikeAt = 3;
  for (int t = 0; t < 100; t++) { soilLoop(); fakeNow++; }
  CHECK(soilTakeReading(a, b), "first reading ready quickly");
  CHECK(a == 3430, "A value with spike removed");
  CHECK(b == 1450, "B value");
  CHECK(!soilTakeReading(a, b), "reading clears after take");

  unsigned long batchStart = 0;
  while (fakeNow < batchStart + SOIL_PUBLISH_INTERVAL_MS - 1) { soilLoop(); fakeNow++; }
  CHECK(!soilTakeReading(a, b), "no new reading before the interval");
  adcValue[SOIL_A_PIN] = 2500;
  for (int t = 0; t < 100; t++) { soilLoop(); fakeNow++; }
  CHECK(soilTakeReading(a, b) && a == 2500, "next reading after the interval with new value");

  // A loop that is called rarely still finishes a batch and never takes two samples per call.
  soilBegin();
  sampleCount = 0; spikeAt = -1;
  fakeNow = 100000;
  for (int i = 0; i < SOIL_SAMPLE_COUNT; i++) { soilLoop(); fakeNow += 500; }
  CHECK(sampleCount == SOIL_SAMPLE_COUNT, "one sample per call even when slow");
  CHECK(soilTakeReading(a, b), "batch completes with a slow loop");

  CHECK(soilLatest((SoilSensor)5) == -1, "invalid sensor");

  // Outlier edge: exactly the limit away is kept, one more is dropped.
  int e1[3] = {1000, 1000, 1400};
  CHECK(soilFilterSamples(e1, 3, 400) == 1133, "400 away is kept (rounded mean 1133)");
  int e2[3] = {1000, 1000, 1401};
  CHECK(soilFilterSamples(e2, 3, 400) == 1000, "401 away is dropped");
  int e3[8] = {3430, 3430, 3430, 3430, 3430, 3430, 20, 4095};
  CHECK(soilFilterSamples(e3, 8, 400) == 3430, "two spikes dropped");
  int e4[2] = {1001, 1002};
  CHECK(soilFilterSamples(e4, 2, 400) == 1002, "rounding: 1001.5 rounds up");

  // Exact timing: batch of 8 finishes after 7 gaps, next batch starts one interval after the first.
  soilBegin(); sampleCount = 0; spikeAt = -1;
  fakeNow = 500000;
  unsigned long t0 = fakeNow;
  while (!soilTakeReading(a, b)) { soilLoop(); fakeNow++; if (fakeNow > t0 + 1000) break; }
  CHECK(fakeNow - 1 == t0 + (SOIL_SAMPLE_COUNT - 1) * SOIL_SAMPLE_GAP_MS, "first batch done after 7 gaps");
  int before = sampleCount;
  while (fakeNow < t0 + SOIL_PUBLISH_INTERVAL_MS) { soilLoop(); fakeNow++; }
  CHECK(sampleCount == before, "no samples between batches");
  soilLoop();
  CHECK(sampleCount == before + 1, "next batch starts exactly one interval after the first");

  // Repeated calls at the same time take only one sample.
  int c0 = sampleCount; soilLoop(); soilLoop(); soilLoop();
  CHECK(sampleCount == c0, "no extra samples at the same timestamp");

  // Clock wraparound (unsigned long is 64-bit on the Mac, so wrap at its real limit).
  soilBegin(); sampleCount = 0;
  fakeNow = ULONG_MAX - 20;
  for (int t = 0; t < 100; t++) { soilLoop(); fakeNow++; }
  CHECK(soilTakeReading(a, b), "batch completes across wraparound");
  unsigned long w0 = ULONG_MAX - 20;
  while (fakeNow != w0 + SOIL_PUBLISH_INTERVAL_MS) { soilLoop(); fakeNow++; }
  int cw = sampleCount; soilLoop();
  CHECK(sampleCount == cw + 1, "next batch on time after wraparound");

  printf("%d passed, %d failed\n", passes, fails);
  return fails ? 1 : 0;
}
