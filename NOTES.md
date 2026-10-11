<!-- NOTES.md: Shared values: pins, thresholds, Jetson address, gate status. Owner: shared by all roles. -->

# NOTES

| Group | Name | Value |
|-------|------|-------|
| Pins | See firmware/CLAUDE.md | Soil 34/35, relay 25/26/27, I2C 21/22 and 18/19 |
| Thresholds | Soil dry_at / wet_at (A and B) | 2600 / 2000 (placeholder, set in server/config.py after calibration) |
| Jetson | Address | TODO: run `hostname -I` on the Jetson; game at http://ADDRESS:8000/, MQTT port 1883 |
| Gate status | | |
