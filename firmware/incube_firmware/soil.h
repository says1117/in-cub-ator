// firmware/incube_firmware/soil.h: Soil sensor interface. Owner: Role 1 (firmware).
// Takes SOIL_SAMPLE_COUNT samples per sensor without blocking, drops samples far from the median
// (a single spike), averages the rest, and offers one clean raw value per sensor every
// SOIL_PUBLISH_INTERVAL_MS. Lower raw value means wetter. Deciding dry or wet is the server's job.

#ifndef INCUBE_SOIL_H
#define INCUBE_SOIL_H

enum SoilSensor : int {
  SOIL_A = 0,
  SOIL_B = 1,
  SOIL_SENSOR_COUNT = 2
};

// Call once in setup().
void soilBegin();

// Call on every pass of loop(). Takes at most one sample per sensor per call, so it never blocks.
void soilLoop();

// True once per publish interval, when a fresh pair of readings is ready. Clears itself when read.
// Fills a and b with the raw values (0 to 4095).
bool soilTakeReading(int &a, int &b);

// Most recent clean value for one sensor, or -1 before the first reading.
int soilLatest(SoilSensor sensor);

// Filter used on each batch of samples. Exposed for tests. Sorts the array in place.
int soilFilterSamples(int *samples, int count, int outlierLimit);

#endif
