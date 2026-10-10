<!-- firmware/HANDOFF.md: Firmware status and handoff notes for the other roles. Owner: Role 1 (firmware). -->

# Firmware handoff

## Verified on the bench (test sketches in firmware/tests)

- I2C scan: both PN532 readers answer at 0x24 (A on Wire, B on Wire1).
- Tag read: both readers read their own tag and detect removal. Keep tags 10 cm or more from the wrong reader.
- Soil: both sensors read independently. Dry about 3430, wet about 1450 (see calibration.md).
- Relay: the three channels click in order and the channel LEDs light one at a time.

## Open issues

- Pumps: they run only faintly when they should be off. The pump wiring may still bypass the relay (red wire not on the relay NO terminal). Not resolved. Do not run a pump unless it is under water, and do not leave pumps powered unattended until this is fixed.
- Grow light: not present. Channel 3 (IN3, GPIO 27) is untested with a load.
- PN532 readers have no reset wire. After uploading code, unplug the USB for 5 seconds so the readers restart cleanly.
- Soil calibration is from water, not soil. Redo it with the real pots.
- MQTT library (PubSubClient 2.8) publishes only at QoS 0, so the retained "online" status is QoS 0, not QoS 1 as CONTRACT.md says. The last will "offline" is QoS 1. It also cannot tell whether an incoming command was retained, so the firmware clears retained command topics on every connect instead. Swapping to a library with QoS 1 publish and a retain flag on incoming messages is the proper fix.
- Relay inputs float during an ESP32 reset, before the firmware runs. Check with a multimeter that IN1 to IN3 sit near 3.3 V (relay off) while the board is held in reset.
- The network file is cube_network.h / .cpp, not network.h, because the ESP32 core has its own Network.h and macOS file names ignore case.

## Not started

- NFC pads module (pads.h / pads.cpp) and adding it to the main sketch.
- Wi-Fi and MQTT against the Jetson (address not in NOTES.md yet). A temporary bench test used Mosquitto on a Mac instead.
