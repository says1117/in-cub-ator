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

## Requests to other roles (from an integration check against their branches, 2026-10-10)

Firmware sends exactly what CONTRACT.md says. These are changes on the server side, for the owners to decide.

### Role 2 server (branch role2-test-with-role3)

1. **Soil calibration (high).** `server/config.py` still has placeholders `SOIL_RAW_DRY = 3000`, `SOIL_RAW_WET = 1200`. Measured values are dry about 3430, wet about 1450 (lower is wetter, see firmware/calibration.md). With the placeholders, fairly moist soil summons a boss. Please use 3430 and 1450, and keep the boss thresholds near raw 2800 (dry) and 2000 (wet).
2. **Real tag UIDs (medium).** `server/creatures.json` uses made-up IDs with colons (`04:A1:B2:C3`). Firmware sends uppercase hex with no separators. Real tags: pad A `0450A901055713`, pad B `0450AA01F25713`. Without this, every tag plays as the default creature.
3. **A pump command can be refused (high).** Firmware ignores a pump command when that pump is running or ran less than 30 s ago (from when it stopped), and caps runs at 3000 ms. The server currently counts the reward as given when it sends the command. Please do not assume watering happened. A small result topic would fix this properly (proposal below).
4. **Light cap.** Firmware caps light at 30 minutes with a 60 s gap after each run. `LIGHT_MAX_MINUTES = 60` in the server should be 30.
5. **Stale readings.** Please start as "stale" until the first soil reading arrives, and track each sensor separately, so old readings do not drive the game.
6. **Simulators.** `fake_publisher.py` and `serial_bridge.py` publish `incube/status/esp32` too. Do not run them while the real ESP32 is connected, or they fight over online/offline.
7. **Lifted tag during a battle.** Firmware sends an empty retained message when a tag is lifted. Decide what the game does then.

### Team decision needed

- **Two different servers.** okayuu-branch has its own server that listens on `plants/+/telemetry` with JSON. It does not match CONTRACT.md, so the ESP32 cannot talk to it. Please agree which server is the real one.
- **Proposed contract addition: command results.** Firmware would publish one line per command, for example `incube/cmd/result` with `pump/A started 3000` or `pump/A too soon`. Not built, because contract changes need all three roles.
- **QoS.** PubSubClient sends pads and "online" at QoS 0. If the team wants QoS 1 as drafted, firmware needs a different MQTT library and the server must subscribe at QoS 1.
- `server/plants.db` (a database file) is committed on okayuu-branch. It usually should not be in git.

## USB fallback if Wi-Fi fails

The main firmware also prints `soil A: <n>  soil B: <n>` over USB every 2 s, which Role 2's `server/serial_bridge.py` reads and publishes to the broker. This carries soil only: pads and pump commands still need Wi-Fi.

