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
- Each pump run is capped, and a minimum gap is enforced between runs on the same pump. The light turns itself off after its timer. Starting values, still to be confirmed by Role 2: pump max run 3000 ms, minimum gap between runs of the same pump 30000 ms, light max 30 minutes per run with a 60000 ms minimum gap.
- A command that arrives while that pump is running is ignored, not queued.
- The firmware never replays a command after a reconnect.

## Soil values the server uses

Lower raw value means wetter. Provisional thresholds (see `firmware/calibration.md`, to be redone with real soil):

- Dry, summon the boss: raw above 2800.
- Wet, dismiss the boss: raw below 2000.
- Between 2000 and 2800 the state does not change.

## Game state message

DRAFT (written from the code on branch `plant-db-tests`, for Roles 2 and 3 to confirm).

- **Endpoint:** WebSocket `ws://<server>:8765` (`server/api.py`).
- **Server to client:** the full game state as one JSON object, sent when a client connects and again whenever anything changes. There are no partial updates.
- **Client to server:** `{"action": "demo_boss"}` or `{"action": "move", "move": "<category or move_id>"}`. The move can be a category (`attack`, `guard`, `special`, `skill`) or the fighting plant's own `move_id` (schema 2). Other plants' moves are ignored.
- **`schema_version`:** `1` when the server runs without the plant database, `2` with it (`INCUBE_PLANT_DB=1`). Schema 2 only adds fields; every schema 1 field keeps its meaning.

### Schema 1 fields (always present)

Types: `str`, `int`, `float`, `bool`; `X | null` means the value may be null. Pads are always `"A"` and `"B"`. JSON object key order is not guaranteed; list orders stated below are.

| Field | Type | Meaning |
| --- | --- | --- |
| `schema_version` | int | `1` or `2` |
| `mode` | str | `walking`, `boss`, `battle`, `reward` or `cooldown` |
| `meters.water.A`, `.B` | float | moisture percent per pot, 0 to 100, one decimal |
| `meters.stale` | bool | true when the cube has gone quiet or reported offline |
| `health` | float | overall plant health, 0 to 100 |
| `condition` | str | `healthy`, `weary`, `wilting` or `wilted` |
| `tier` | int | how dry the driest pot is: 0 (fine) to 3 (bone dry) |
| `creatures.A`, `.B` | str \| null | the tag UID reported on each pad |
| `fighters.A`, `.B` | object \| null | `{name: str, skill: str \| null}`. In schema 2 an empty pad is null |
| `boss` | object \| null | see below |
| `battle` | object \| null | see below |
| `reward` | object \| null | the last watering: `{type: "water", plant: "A"\|"B", size: int (ms), tier: int}` |

`boss`: `{plant: "A"|"B" (the pot it is drying), name: str, tier: int (1 to 3), hp: int, max_hp: int, type: "drought", source: "soil"|"demo"}`

`battle`:

| Field | Type | Meaning |
| --- | --- | --- |
| `turn` | int | turns played |
| `plant` | str | pad now fighting |
| `team` | object | each pad in the fight to `{name: str, hp: int, max_hp: int, state: "fighting"\|"ready"\|"down"}` |
| `creature`, `creature_hp`, `creature_max_hp` | str, int, int | the fighting plant |
| `boss_hp` | int | boss HP left |
| `last_move` | object \| null | see below |
| `skill` | object \| null | the fighter's skill: `{name: str, ready: bool, ready_in: int (turns)}` |
| `manual` | bool | true when the player picks moves |
| `awaiting_move` | bool | true while waiting for the player |
| `move_seconds_left` | int \| null | seconds before the game picks a move; null when not manual |

`last_move`: `{creature: str (the category used), boss: str, hit: "creature"|"boss"|"both"|"tie"|"none"}`, plus these keys only when they apply: `skill` (str), `damage` (int), `healed` (int), `swap` (`{out: pad, in: pad, name: str, reason?: "lifted"}`), and in schema 2 `move_id` (str), `actor_pad` (str), `actor_plant_id` (str). One exception: if a plant is lifted before any turn is played, `last_move` is just `{swap: {...}}`, with no `creature`, `boss` or `hit`.

### Schema 2 additions (plant database on)

| Field | Type | Meaning |
| --- | --- | --- |
| `pads.A`, `.B` | object | `{uid: str \| null, plant_id: str \| null, status: str}`; status is `empty`, `known`, `unknown` (a tag not in the database), `invalid` (not a tag ID), or `moved` (that plant was then seen on the other pad) |
| `summoned_plants` | list | the party, in pad order (A then B). Each: `plant_id`, `pad_id`, `name`, `species`, `type` (all str), `level`, `xp` (int), `xp_to_next` (int \| null, null at max level), `hp`, `atk` (int, at the current level), `sprite_key`, `animation_set_key` (str), `moves` (list of 4 move ids in the order attack, guard, special, skill) |
| `progress.last_xp` | object \| null | the last award: plant id to `{xp, level, gained: int, levelled_up: bool}` |
| `progress.unsaved` | bool | true while an award is waiting to be written |
| `progress.persistent` | bool | false when there is no usable save file, so XP lasts only until the server restarts |
| `battle.battle_id` | str | unique per fight |
| `battle.active_plant_id` | str \| null | the plant fighting now |
| `battle.team_plants` | object | each pad in the fight to `{plant_id: str \| null, level: int \| null}` |
| `battle.moves` | list | the fighting plant's move buttons, in the order attack, guard, special, skill. Each: `move_id`, `name`, `category`, `type` (str), `power` (int, percent of attack), `animation_key` (str), `animation` (`{body: str, fx: str}`), `ready` (bool; false only for a recharging skill) |
| `battle.last_action` | object \| null | the last move made, and how to show it: `{actor_pad: str, actor_plant_id: str, move_id: str \| null, animation_key: str \| null, animation: {body: str, fx: str} \| null}`. Null before the first turn. It names the plant that made the move, even if that plant has since been swapped out or lifted |

Behavior in schema 2: only plants whose tag is on a pad are in the game. With no plant summoned, a boss waits at the end of its intro until a plant is placed. A plant lifted mid-fight leaves it (the next plant steps in, or the boss waits again). Watering always goes to the pot the boss was drying.

## Versions

- ESP32 Arduino core 3.3.12, board "ESP32 Dev Module".
- Adafruit PN532 1.3.4, Adafruit BusIO 1.17.4.

## Open decisions

1. Pump max run time and minimum gap (starting values 3000 ms and 30000 ms, Role 2 to confirm).
2. Light maximum minutes (starting value 30, Role 2 to confirm).
3. How often soil is published (starting value every 2000 ms). Pads publish only on change.
4. Game state message: draft written above from the plant-db-tests code; Roles 2 and 3 to confirm.
