<!-- firmware/calibration.md: Dry and wet readings per soil sensor. Owner: Role 1 (firmware). -->

# Soil sensor calibration

Raw ADC values from `firmware/tests/soil_print` (12-bit, 0 to 4095, ESP32 pins GPIO 34 and 35, sensors powered from 3.3V). Lower number means wetter. Higher number means drier.

Status: PROVISIONAL. Measured in a cup of water (probe to the marked line, 15 seconds) and in air, not in real soil. Redo with the real pots before the demo.

| Sensor | Pin | Dry (in air) | Wet (water to the line) |
|--------|-----|--------------|--------------------------|
| A | GPIO 34 | about 3437 | about 1471 |
| B | GPIO 35 | about 3430 | about 1447 |

## Thresholds (shared by both sensors for now)

| Name | Raw value | Meaning |
|------|-----------|---------|
| DRY_THRESHOLD | 2800 | Reading above this means the soil is dry, so summon the boss |
| WET_THRESHOLD | 2000 | Reading below this means the soil is watered, so dismiss the boss |

Between 2000 and 2800 nothing changes (hysteresis), so a pot does not flip back and forth on small changes.

## Notes

- Readings drift a little while water wicks up the probe, so margins are wide.
- Keep the probe at the marked line. Water above the line can push the reading far too low and can damage the sensor.
- Both sensors read about 3430 dry, so they are interchangeable for the dry end.
