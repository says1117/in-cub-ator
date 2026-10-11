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

The server pushes this JSON over the WebSocket `ws://<jetson>:8000/ws` once on connect and every 0.5 s.
`GET /api/state` returns the same object. `POST /api/debug/boss/A` (or `B`) summons a boss.

```json
{
  "t": 123.4,
  "esp32": "online",
  "sunlight": 62.5,
  "light_on": false,
  "pots": {
    "A": {
      "creature": {"uid": "04A1B2C3", "name": "Sprout", "level": 2, "xp": 30,
                   "hp": 30, "max_hp": 36, "attack": 8, "color": "#6ccf5a"},
      "soil_raw": 2100,
      "water": 0.55,
      "dry": false,
      "phase": "ok",
      "boss": null,
      "last_hit": {"by": "boss", "dmg": 4}
    },
    "B": {"...": "same shape"}
  },
  "events": [{"t": 99.0, "pot": "A", "kind": "win", "text": "Sprout beat the boss!"}]
}
```

- `esp32`: `online`, `offline` or `unknown` (nothing heard yet).
- `sunlight`: 0 to 100 from the camera, or `null` when vision is off.
- `creature`: `null` when no tag is on the pad. `xp` is progress inside the current level (0 to 99).
- `water`: 0.0 (dry) to 1.0 (wet) from calibration, `null` when the soil reading is missing or stale.
- `phase`: `ok` (creature walks), `boss` (fight; `boss` is `{"name","hp","max_hp"}`), `watering` (pump just ran, waiting for the soil to wet).
- Creatures never faint (HP stays at 1 or more), so every fight ends in a win and the pump runs.
