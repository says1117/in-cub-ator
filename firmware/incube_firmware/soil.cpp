// firmware/incube_firmware/soil.cpp: Soil sensor implementation. Owner: Role 1 (firmware).

#include <Arduino.h>
#include "config.h"
#include "soil.h"

namespace {

const int SENSOR_PINS[SOIL_SENSOR_COUNT] = {SOIL_A_PIN, SOIL_B_PIN};

int samples[SOIL_SENSOR_COUNT][SOIL_SAMPLE_COUNT];
int sampleIndex = 0;            // next sample slot, shared by both sensors
bool sampling = false;          // inside a batch of samples
unsigned long lastSampleMs = 0;
unsigned long lastBatchMs = 0;
bool firstBatch = true;
int latest[SOIL_SENSOR_COUNT] = {-1, -1};
bool fresh = false;

void sortSmall(int *values, int count) {
  for (int i = 1; i < count; i++) {
    int v = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > v) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = v;
  }
}

}  // namespace

int soilFilterSamples(int *values, int count, int outlierLimit) {
  if (values == nullptr || count <= 0) return -1;
  sortSmall(values, count);
  // For an even count this is the upper of the two middle values. If a batch splits evenly
  // into two clusters it picks the higher (drier) one, which only matters for a broken sensor.
  int median = values[count / 2];
  long total = 0;
  int kept = 0;
  for (int i = 0; i < count; i++) {
    int diff = values[i] - median;
    if (diff < 0) diff = -diff;
    if (diff <= outlierLimit) {
      total += values[i];
      kept++;
    }
  }
  if (kept == 0) return median;  // cannot happen (the median is always kept), but stay safe
  return (int)((total + kept / 2) / kept);
}

void soilBegin() {
  analogReadResolution(12);
  for (int s = 0; s < SOIL_SENSOR_COUNT; s++) {
    // On core 3.x a pin only becomes an ADC channel on its first read, and setting the
    // attenuation before that does nothing. So read once, then set 11 dB (range up to about 3.1 V).
    analogRead(SENSOR_PINS[s]);
#ifdef ARDUINO_ARCH_ESP32
    analogSetPinAttenuation(SENSOR_PINS[s], ADC_11db);
#endif
  }
  sampleIndex = 0;
  sampling = false;
  firstBatch = true;
  fresh = false;
  for (int s = 0; s < SOIL_SENSOR_COUNT; s++) latest[s] = -1;
}

void soilLoop() {
  unsigned long now = millis();
  if (!sampling) {
    if (!firstBatch && (now - lastBatchMs) < SOIL_PUBLISH_INTERVAL_MS) return;
    sampling = true;
    sampleIndex = 0;
    lastBatchMs = now;
    firstBatch = false;
    lastSampleMs = now - SOIL_SAMPLE_GAP_MS;  // take the first sample right away
  }
  if ((now - lastSampleMs) < SOIL_SAMPLE_GAP_MS) return;
  lastSampleMs = now;
  for (int s = 0; s < SOIL_SENSOR_COUNT; s++) samples[s][sampleIndex] = analogRead(SENSOR_PINS[s]);
  sampleIndex++;
  if (sampleIndex < SOIL_SAMPLE_COUNT) return;
  for (int s = 0; s < SOIL_SENSOR_COUNT; s++) {
    latest[s] = soilFilterSamples(samples[s], SOIL_SAMPLE_COUNT, SOIL_OUTLIER_LIMIT);
  }
  sampling = false;
  fresh = true;
}

bool soilTakeReading(int &a, int &b) {
  if (!fresh) return false;
  fresh = false;
  a = latest[SOIL_A];
  b = latest[SOIL_B];
  return true;
}

int soilLatest(SoilSensor sensor) {
  if (sensor < 0 || sensor >= SOIL_SENSOR_COUNT) return -1;
  return latest[sensor];
}
