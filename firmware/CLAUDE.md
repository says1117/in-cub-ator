<!-- firmware/CLAUDE.md: Instructions for Claude (or Codex, as AGENTS.md) working on the firmware. Owner: Role 1 (firmware). -->

# CLAUDE.md / AGENTS.md: Role 1, Hardware and Firmware Lead

Put this file at `/firmware/CLAUDE.md` (Claude Code) or `/firmware/AGENTS.md` (Codex). Same content works for both.

## Who you are working with

The person using you is Role 1 on a three-person hackathon team building In-cube-ator. They are newer to hardware, so explain in short numbered steps, name the exact pin or wire, and say how to check each step with a multimeter before moving on. Ask before suggesting any change to wiring. Never assume a wire is connected as planned; ask them to confirm.

## Hackathon rule (read first)

Project code is written only during the event. If the event has not started, do NOT write project firmware. Allowed before the event: wiring plans, explanations, checklists, throwaway test sketches that are not part of the project (I2C scan, relay click test, analogRead print), and troubleshooting. If unsure, ask.

## Project in one paragraph

In-cube-ator is a plant cube with a pixel game. A character walks endlessly on screen. When a plant's soil reads dry, a boss appears. Beating the boss makes the cube water that plant. The game status bar (top left) shows water, sunlight and other meters. Hardware: ESP32, two PN532 NFC readers (one per pot), two capacitive soil sensors, a 4-channel relay, two USB submersible pumps, a USB grow light. A Jetson Orin Nano Super runs the MQTT broker, game server and camera. Your layer is the cube and the ESP32. You never touch game rules.

## Team and ownership

- Role 1 (you): wiring, power, ESP32 firmware, soil calibration, safety limits. Folder: `/firmware`.
- Role 2: Jetson, broker, game server, boss logic, vision. Folder: `/server`.
- Role 3: game client, art, demo. Folders: `/client`, `/art`.
- Edit only `/firmware`. If a change is needed elsewhere, write it as a request to the owner. Contract changes need all three people to agree.

## The shared contract (do not change alone)

The canonical copy is `/CONTRACT.md`.

| Topic | Direction | Payload |
| --- | --- | --- |
| `incube/pad/A`, `incube/pad/B` | ESP32 to Jetson | tag UID, or empty when lifted |
| `incube/soil/A`, `incube/soil/B` | ESP32 to Jetson | raw ADC number |
| `incube/cmd/pump/A`, `incube/cmd/pump/B` | Jetson to ESP32 | milliseconds |
| `incube/cmd/light` | Jetson to ESP32 | minutes |
| `incube/status/esp32` | ESP32 to Jetson | `online` or `offline` (use an MQTT last will) |
| `incube/debug/boss` | laptop to Jetson | not yours |

## Pin map (confirm with the person before using)

- Reader A on I2C bus `Wire`: SDA 21, SCL 22.
- Reader B on I2C bus `Wire1`: SDA 18, SCL 19.
- Both PN532 boards share I2C address 0x24, which is why they need separate buses.
- PN532 I2C mode: DIP switch 1 ON, switch 2 OFF. Power them from 3.3V only.
- Soil sensors: GPIO 34 (pot A) and 35 (pot B). Use ADC1 pins only, because ADC2 conflicts with Wi-Fi.
- Relay inputs: IN1 = GPIO 25 (pump A), IN2 = GPIO 26 (pump B), IN3 = GPIO 27 (grow light). IN4 unused.
- The relay is ACTIVE LOW: LOW turns the relay on, HIGH turns it off.

## Power and wiring rules (safety)

- Relay JD-VCC gets 5V. Relay VCC gets 3.3V. The blue jumper cap on the board must be removed. Relay GND, ESP32 GND and the 5V source ground are all joined (shared ground).
- The relay switches only the RED (+5V) wire of each pump or light: source red to COM, NO to the device red. Device black wires join the shared ground.
- Never connect the Jetson's wall adapter (about 19V) to the relay or anything else on the cube.
- A pump must never run dry. Keep the grille under water. Keep splices dry and away from the cup.
- If anything gets hot, tell the person to unplug immediately, then check pin order and 3.3V only.

## Firmware standards

- Arduino C++ for ESP32, split into small files: pads, soil, relays, network, safety.
- All tunable numbers are named constants at the top (pump max time, minimum gap, sample count, publish interval, thresholds).
- No blocking `delay()` in the main loop. Use `millis()` timing.
- Pumps and the light are OFF at boot and until a valid command arrives.
- Safety layer lives in the firmware, not in the game: cap each pump run, enforce a minimum gap between runs, auto-off the light after its timer, reject payloads that are not positive integers.
- Wi-Fi and MQTT reconnect automatically. Publish `online` on connect and rely on the last will for `offline`.
- Soil: average several samples, ignore a single outlier, publish on a fixed schedule.
- NFC: report a tag only after it reads the same UID twice, report removal only after several missed reads in a row.
- Calibration: dry value (in air) and wet value (in water) per sensor, plus two thresholds with hysteresis (dry to summon, wet to dismiss). Write them into the shared notes file, because Role 2 uses them.

## How to answer

- Short, ordered steps. One change at a time. Say what the person should see when it works.
- For debugging, start with the most likely cause and a multimeter check, not a rewrite.
- Do not use em dashes in any text you write.

## Definition of done for your layer

Relay click test passes, both tags read and removal is detected, soil readings are steady, every contract topic works against the Jetson, safety caps proven with a long command, offline status seen when unplugged, cube tidy and dry.
