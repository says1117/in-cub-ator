<!-- CONTRACT.md: MQTT topics and the game state message. Owner: shared by all roles (firmware publishes pads and soil, server publishes commands and game state, client reads game state). Changes need all three people to agree. -->

# CONTRACT

Status: the topic list is agreed. The formats and delivery rules below are a DRAFT proposed by Role 1 (firmware). Roles 2 and 3 please review. Anything marked TBD needs a decision.

## MQTT topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `incube/pad/A`, `incube/pad/B` | ESP32 to Jetson | tag UID, or empty when lifted |
| `incube/soil/A`, `incube/soil/B` | ESP32 to Jetson | raw ADC number |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | Jetson to ESP32 | milliseconds |
| `incube/cmd/light` | Jetson to ESP32 | minutes |
| `incube/status/esp32` | ESP32 to Jetson | `online` or `offline` (MQTT last will) |
| `incube/debug/boss` | laptop to Jetson | boss override (server owns this) |

## Payload formats (draft)

All payloads are plain text, no JSON, no spaces.

| Topic | Format | Example |
| --- | --- | --- |
| `incube/pad/A`, `incube/pad/B` | Tag UID as uppercase hex, no separators. Empty payload (zero bytes) when the tag is lifted | `0450A901055713` |
| `incube/soil/A`, `incube/soil/B` | Raw 12-bit ADC value as a decimal integer, 0 to 4095. Lower means wetter | `3437` |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | Run time in milliseconds, positive decimal integer | `2000` |
| `incube/cmd/light` | On time in minutes, positive decimal integer | `30` |
| `incube/status/esp32` | `online` or `offline` | `online` |

Known tag UIDs for testing: pad A `0450A901055713`, pad B `0450AA01F25713`.

## Delivery rules (draft)

| Topic | QoS | Retained | Why |
| --- | --- | --- | --- |
| `incube/pad/*` | 1 | yes | A restarted server learns what is on each pad. Lifted tag sends an empty retained message, which clears it, so no message means the pad is empty |
| `incube/soil/*` | 0 | no | Readings repeat on a schedule, so a lost one does not matter |
| `incube/cmd/pump/*` | 0 | never | A retained or duplicated command could water twice after a reconnect |
| `incube/cmd/light` | 0 | never | Same reason |
| `incube/status/esp32` | 1 | yes | Server sees the current state at once. Last will publishes `offline` retained |

## Firmware safety rules the server can rely on

- Pumps and the light are OFF at boot and until a valid command arrives.
- A payload that is not a positive integer is ignored.
- Each pump run is capped, and a minimum gap is enforced between runs on the same pump. The light turns itself off after its timer. Starting values, still to be confirmed by Role 2: pump max run 1000 ms (changed from 3000 ms by Role 1 after bench testing: 3 s was far too much water), minimum gap between runs of the same pump 30000 ms, light max 30 minutes per run with a 60000 ms minimum gap.
- A command that arrives while that pump is running is ignored, not queued.
- The firmware never replays a command after a reconnect.

## Soil values the server uses

Lower raw value means wetter. Provisional thresholds (see `firmware/calibration.md`, to be redone with real soil):

- Dry, summon the boss: raw above 2800.
- Wet, dismiss the boss: raw below 2000.
- Between 2000 and 2800 the state does not change.

## Game state message

TODO: Roles 2 and 3 to define the WebSocket game state shape (endpoint, fields, state names, snapshot or update) and record it here.

## Versions

- ESP32 Arduino core 3.3.12, board "ESP32 Dev Module".
- Adafruit PN532 1.3.4, Adafruit BusIO 1.17.4.

## Open decisions

1. Pump max run time and minimum gap (1000 ms and 30000 ms; the server should send at most 1000 ms, Role 2 to confirm).
2. Light maximum minutes (starting value 30, Role 2 to confirm).
3. How often soil is published (starting value every 2000 ms). Pads publish only on change.
4. Game state message (Roles 2 and 3).
