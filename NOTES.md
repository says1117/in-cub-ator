<!-- NOTES.md: Shared values: pins, thresholds, Jetson address, gate status. Owner: shared by all roles. -->

# NOTES

| Group | Name | Value |
|-------|------|-------|
| Pins | Reader A (Wire) SDA, SCL | GPIO 21, 22 |
| Pins | Reader B (Wire1) SDA, SCL | GPIO 18, 19 |
| Pins | Soil sensor A, B | GPIO 34, 35 |
| Pins | Relay IN1 pump A, IN2 pump B, IN3 light | GPIO 25, 26, 27 |
| Thresholds | Soil dry (summon boss), raw ADC above | 2800 (provisional) |
| Thresholds | Soil wet (dismiss boss), raw ADC below | 2000 (provisional) |
| Thresholds | Direction | Lower raw value means wetter |
| Tags | Pad A tag UID | 0450A901055713 |
| Tags | Pad B tag UID | 0450AA01F25713 |
| Jetson | Address | |
| Gate status | Role 1 bench tests | Readers, soil, relay channels pass. Pump wiring open. See firmware/HANDOFF.md |
