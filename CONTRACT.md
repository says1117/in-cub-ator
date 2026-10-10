<!-- CONTRACT.md: MQTT topics and the game state message. Owner: shared by all roles (firmware publishes pads and soil, server publishes commands and game state, client reads game state). Changes need all three people to agree. -->

# CONTRACT

## MQTT topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `incube/pad/A`, `incube/pad/B` | ESP32 to Jetson | tag UID, or empty when lifted |
| `incube/soil/A`, `incube/soil/B` | ESP32 to Jetson | raw ADC number |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | Jetson to ESP32 | milliseconds |
| `incube/cmd/light` | Jetson to ESP32 | minutes |
| `incube/status/esp32` | ESP32 to Jetson | `online` or `offline` (MQTT last will) |
| `incube/debug/boss` | laptop to Jetson | boss override (server owns this) |

## Game state message

TODO: not defined in the firmware CLAUDE.md. Role 2 and Role 3 to agree on the WebSocket game state shape and record it here.
