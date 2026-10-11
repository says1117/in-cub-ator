<!-- docs/AGENT_CONTEXT.md: Full project context for another AI agent picking up this work. Owner: shared by all roles (written by Role 1's assistant, 2026-10-10). -->

# In-cube-ator: context for the next agent

Read this first. It covers what the project is, what is built and verified, what is open, how the pieces connect, and the rules the user wants followed. It reflects the state on 2026-10-10 (hackathon day). Verify anything that matters against the code, because teammates keep pushing.

## 1. The project

In-cube-ator is a **plant cube with a pixel game**. Two real plants sit in pots. Each pot has a capacitive soil sensor, a small USB submersible pump and an NFC pad. A character walks endlessly on a game screen. When a pot's soil reads dry, a **boss** appears. Winning the battle makes the cube **water that pot**. Plants are summoned into the game by placing their NFC tag on a pad (not yet live, see section 8).

Three people, three roles:

| Role | Owner | Folders | Job |
| --- | --- | --- | --- |
| 1 | the user (GitHub `says1117`) | `/firmware` | ESP32 firmware, wiring, power, calibration, safety limits. **Never touches game rules.** |
| 2 | Alexin | `/server` | Jetson, MQTT broker, game server, boss logic, vision |
| 3 | Okayuu (and the client) | `/client`, `/art`, `/demo` | game screen, art, demo |

The user is **Role 1** and is newer to hardware. The user's own rules for you are in section 12.

## 2. Hardware (confirmed on the bench)

| Part | Detail |
| --- | --- |
| ESP32 | ESP-32S dev board (CP2102 USB-serial), Arduino core **esp32 3.3.12**, board "ESP32 Dev Module" (`esp32:esp32:esp32`) |
| NFC readers | 2x PN532 boards, I2C mode (DIP 1 ON, 2 OFF), both at address 0x24, so each is on its own bus. **No reset wire** (see open issues). Reader A: `Wire`, SDA 21, SCL 22. Reader B: `Wire1`, SDA 18, SCL 19. Powered from 3.3 V only. |
| Soil sensors | 2x capacitive v1.2, powered from 3.3 V. Sensor A signal on GPIO 34, B on GPIO 35 (ADC1 only, because ADC2 conflicts with Wi-Fi). Cable colours on the sensor: yellow = AOUT, red = VCC, black = GND. Every sensor needs all three wires. |
| Relay | 4-channel board, **active low** (LOW = on). IN1 = GPIO 25 pump A, IN2 = GPIO 26 pump B, IN3 = GPIO 27 grow light, IN4 unused. VCC on 3.3 V, **JD-VCC on 5 V from a USB splice**, blue jumper cap removed, grounds joined. |
| Pumps | 2x USB submersible pumps, **must never run dry**. Relay switches only the red wire (source red to COM, NO to the pump red). |
| Grow light | **does not exist**. Channel 3 is wired in firmware but untested with a load. |
| Jetson | Orin Nano Super. The Jetson used for testing is hostname `alexin` (Linux 6.8 tegra, aarch64), no `ufw` installed. |

Rules from the firmware spec: never connect the Jetson's ~19 V wall adapter to anything on the cube; if anything gets hot, unplug and check pin order and 3.3 V only.

**NFC tags** (NTAG, 7-byte UIDs). The tag, not the pad, identifies the plant:
- Ember: `0450AA01F25713`
- Zest: `0450A901055713`

## 3. Network (the part that took the longest)

- The ESP32 only supports a **2.4 GHz network with one shared password**. It cannot join WPA2-Enterprise.
- **UCF_WPA2 does not work** (personal login). **UCF Guest probably does not work** (appears to isolate devices; not proven). A **phone hotspot with "Maximize Compatibility" (2.4 GHz)** worked: the cube joined and reached a broker on the Mac.
- Everything must be on one network that lets devices reach each other: cube, Jetson, anyone playing.
- Ports: **1883** MQTT broker, **8765** game state WebSocket, **8080** game page.
- Cube config lives in `firmware/incube_firmware/secrets.h` (**gitignored**, only on the user's Mac). It holds `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_BROKER_HOST`. **The user types the Wi-Fi name and password. Never ask for them in chat and never write them to a file or commit.** The template is `secrets.h.example`.
- The broker host in `secrets.h` must be a numeric IP (the firmware avoids name lookups; `.local` names do not work).

## 4. Firmware (`/firmware/incube_firmware`)

Arduino C++ split into modules. Built and verified on the bench except where noted.

| File | What it does |
| --- | --- |
| `config.h` | Every pin and tunable number. Topic names. Compile-time range checks on safety limits. |
| `relays.*` | Switches the three channels. Starts everything OFF (registers pin as INPUT, preloads OFF, then OUTPUT: needed on core 3.x). Remembers state and when a channel turned on. `relayHardOff()` is pin-only for the cutoff timer. |
| `safety.*` | **Every pump and light command goes through here.** Payload must be digits only (1 to 9 chars, not zero). Pump cap **2000 ms**, minimum gap **30 s measured from when the run ENDS**; light cap 30 minutes, gap 60 s. A command while that channel runs is refused (never queued). An `esp_timer` one-shot per channel is a **hard cutoff** that works even if loop() stalls (race-checked under a spinlock). `safetyAllOff()` is an emergency stop. |
| `soil.*` | Non-blocking: 8 samples per sensor 5 ms apart, drop samples more than 400 from the median, average, one value every 2 s. Raw ADC 0 to 4095, lower = wetter. |
| `pads.*`, `pad_tracker.*`, `pn532_frame.*` | Talks to the PN532 directly over I2C (the Adafruit library blocks and copies tag IDs unchecked, so it is not used for the main sketch). A per-reader state machine, at most one short I2C transfer per reader per loop pass. Boot: GetFirmwareVersion, SAMConfiguration, RFConfiguration retries, then search every 300 ms. A tag counts after 2 identical reads; removal after 3 empty reads; failures count as empty reads; ACK-abort and restart on trouble. UID text is uppercase hex, no separators, up to 10 bytes. |
| `cube_network.*` | Wi-Fi + MQTT (PubSubClient 2.8). Named `cube_network` because a local `network.h` shadows the ESP32 core's `Network.h` on case-insensitive macOS. Last will `offline` (retained, QoS 1), publishes `online` (retained) on connect, **clears retained command topics on every connect**, subscribes to commands at QoS 0, clean session. Reconnects on its own. Prints the Wi-Fi failure reason every 5 s and runs a one-time visibility scan (it found the 5 GHz hotspot problem). |
| `incube_firmware.ino` | Routes only. Order in setup: `relaysBegin()` first. Also prints `soil A: <n>  soil B: <n>` over USB so `server/serial_bridge.py` can read it as a fallback. |

**Calibration** (`firmware/calibration.md`, provisional, measured in water not soil): sensor A dry ~3437, wet ~1471; sensor B dry ~3430, wet ~1447. Thresholds: dry (summon boss) raw > 2800, wet (dismiss) raw < 2000. **Redo with the real pots.** Keep probes at the marked line.

### Tests and tools for firmware
- Host unit tests (macOS clang, fake clock/pins): `firmware/tests/host_safety` (46 checks), `host_soil` (25), `host_pads` (30 + 26). Run commands are in each file's header.
- Bench sketches in `firmware/tests/`: `i2c_scan`, `tag_read`, `soil_print`, `relay_click`, `relay_test`.
- `firmware/tests/integration/phase4_check.sh <broker IP>`: guided pump safety test (needs the user to watch pumps; refuses to run a pump until they confirm it is under water).
- `firmware/tests/integration/remote_game_check.py <jetson IP>`: **read-only** check of ports 1883/8765/8080, page, WebSocket state, cube status and soil. Sends nothing, cannot run a pump.
- Compile/upload (macOS): `"/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli" --config-file ~/.arduinoIDE/arduino-cli.yaml compile --upload -p /dev/cu.usbserial-0001 --fqbn esp32:esp32:esp32 firmware/incube_firmware`. Libraries installed: PubSubClient 2.8, Adafruit PN532 1.3.4, BusIO 1.17.4.
- **Serial reading gotcha:** read the port with a script that flushes the input buffer first; stale buffered data once looked like thousands of lines per second. After **every upload the NFC readers can stay stuck** (no reset wire): the user unplugs the ESP32's USB for 5 seconds. The user declined adding reset wires (RSTPDN to a GPIO) unless needed.

## 5. MQTT contract (`CONTRACT.md`)

| Topic | Direction | Payload |
| --- | --- | --- |
| `incube/pad/A`, `incube/pad/B` | ESP32 to Jetson | tag UID (uppercase hex), or empty when lifted. Retained. |
| `incube/soil/A`, `incube/soil/B` | ESP32 to Jetson | raw ADC integer, every 2 s. Not retained. |
| `incube/cmd/pump/A`, `.../B` | Jetson to ESP32 | milliseconds as text. **Never retained.** QoS 0. |
| `incube/cmd/light` | Jetson to ESP32 | minutes as text. Never retained. |
| `incube/status/esp32` | ESP32 to Jetson | `online` / `offline` (last will). Retained. |
| `incube/debug/boss` | laptop to Jetson | boss override (server owns this) |

The contract file also has a **draft game state message** (WebSocket schema 1 and 2, every field typed). Changes to the contract need all three roles to agree.

## 6. Server (`/server`, Alexin's, Python)

`main.py` (asyncio: MQTT in, WebSocket out, 0.2 s tick), `engine.py` (GameEngine, no network code), `state_machine.py` (walking, boss, battle, reward, cooldown), `battle.py`, `rewards.py` (bounded pump command), `api.py` (WebSocket), `mqtt_io.py`, `config.py` (every number), `moisture_sim.py` (`--sim` made-up soil), `serial_bridge.py` (USB soil fallback), `fake_publisher.py`.

Game flow: soil dry for 5 readings, boss spawns (tier by dryness, tiers 1 to 3), battle (attack beats special beats guard beats attack, plus one skill per creature with a recharge), win -> `water_reward()` -> `incube/cmd/pump/<pot>` with a tier length, capped at 3000 ms, only if soil is dry (a demo win may water wet soil), cube online, and at least 60 s since that pot's last reward.

**Plant database (added by the user's assistant, `server/plant_db.py`, off by default):**
- Plants and moves are JSON in git (`server/data/plants.json`, `moves.json`); Ember and Zest are mapped to the two real tag UIDs. XP is an append-only ledger in SQLite `server/data/progress.db` (gitignored), saved on a background thread, with a rule that a battle id pays once.
- With `INCUBE_PLANT_DB=1`: only plants whose tag is on a pad are in the game; no plants means the boss waits; a plant lifted mid-fight is swapped out or the fight pauses with no XP and no water; each plant fights with its own moves (power 100 = today's numbers); a win against a **real soil boss** gives 20/30/45 XP by tier (never for demo fights or losses); a level-up applies from the next fight (HP +2 per level, attack +1 per 2 levels, max level 10); the game state gains `schema_version` 2 with `pads`, `summoned_plants`, `progress`, `battle.moves`, `battle.last_action`.
- A broken plant file falls back to the old engine so **watering never stops**.
- **Pump rule:** watering rules are unchanged; levels only move *timing* (stronger plants win sooner). Tests prove identical pump commands with level growth off, and rule-conformant commands with it on.
- **Tests:** `cd server && python3 -m unittest test_server test_plant_db test_summon test_progress test_snapshot` (179 pass). Needs `pip install -r requirements.txt` (paho-mqtt, websockets).

## 7. Client (`/client`, Phaser 4 + Vite)

Alexin rebuilt the battle screen on 2026-10-10 (named moves, three boss attacks, new HUD). It reads the WebSocket at `ws://<page host>:8765`. **Caveat:** the screen still identifies plants by pad A/B and always draws both, and sends move categories. It ignores the schema 2 fields. Updating it is plan **Step 5** (below). Build: `cd client && npm ci && npm run build` (output `client/dist`, served on 8080). Okayuu's separate client and a SQLite plant server live only on `okayuu-branch`; they use different MQTT topics and are **not** merged.

## 8. Plan for plants-by-tag (docs/PLANT_DATABASE_PLAN.md)

Steps 1 to 4 (data, summon/unsummon, moves/XP, game state message) are done and tested on `plant-db-tests` / `temp-full-runthrough`. **Not done:** Step 5, the client (parade and trail show only `summoned_plants`; battle uses plant_id and sprite_key; move buttons from `battle.moves`; animation fallback), Step 6 (client tests, hardware acceptance), and the optional **Databricks** track (log events locally, upload in the background, predict "pot A dry in N minutes", show as a hint, **never** let it affect pumps). Do not turn `INCUBE_PLANT_DB` on by default until Step 5 lands.

## 9. Branches (GitHub `says1117/in-cub-ator`, public)

`temp-full-runthrough` (**everything merged; the one to run**), `plant-db-tests`, `hardware-jetson`, `steven-hardware` (firmware only), `steven-integration`, `role2-test-with-role3` (Alexin's latest), `role2-server`, `okayuu-branch`, `main` (the very first commit, stale). Cloud sessions may add `claude/...` branches. Always start new work from `temp-full-runthrough` unless told otherwise.

## 10. Running it on the Jetson

`docs/JETSON_RUNTHROUGH.md` has the full steps. Short version: `git clone --branch temp-full-runthrough https://github.com/says1117/in-cub-ator.git ~/in-cub-ator`, then `bash server/deploy/setup_jetson.sh` (installs Mosquitto, Python packages, Node; builds the page; starts `incube-server`, `incube-client`, `incube-bridge`), note the printed `Broker for the ESP32: <IP>:1883`, `sudo systemctl disable --now incube-bridge` (it fights the cube's Wi-Fi status), then point the cube's `secrets.h` at that IP and reflash. A cloud agent **cannot** reach the Jetson, the cube or the user's Wi-Fi; it can only change code, run tests and push branches. Remote play from anywhere: Tailscale on the Jetson and each viewer (each person signs in themselves). No public tunnels (anyone could press the demo button and water the plants).

## 11. Incident to remember

On 2026-10-10 a game server the assistant believed stopped kept running for ~2 hours and sent **33 pump commands** (A 16, B 17, ~3 s each) to the live cube while the sensors read dry in air. Firmware caps held. Lessons: after stopping any server, **verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` / `pgrep` that it is gone**; never leave the game server running against the live cube unattended; sensors in air mean dry mean watering about once a minute.

## 12. Rules the user has set (follow them)

1. **Explain every step in plain language,** one short line saying what each step, tool, pin or command does. The user is new to hardware. Short numbered steps; name the exact pin or wire; say how to check with a multimeter; ask before suggesting any wiring change; never assume a wire is connected as planned, ask.
2. **Hackathon rule:** project code only during the event (it has started).
3. **Git:** small separate commits, one logical change each; push as you go. **No Claude attribution lines** (no Co-Authored-By, no "Generated with"); commits are authored as the user (`says1117`). Firmware work goes on `steven-hardware`; other work on its own branch. Never commit `secrets.h`, `.env`, `server/data/progress.db`, or `tools/codex-mcp.mjs` (a local helper, untracked).
4. **Review everything with Codex** (the `mcp__codex__codex` MCP tool, read-only) before calling a step done, verify each finding against the source before applying it, and tell the user what it said.
5. **No em dashes** in text you write.
6. **Safety:** pumps only under water; confirm before anything that switches a pump; use read-only checks (`remote_game_check.py`) when possible; do not change firmware pump limits without Role 2 and the user.
7. Do not ask for Wi-Fi passwords or tokens; the user types credentials themselves.

## 13. Open issues and next steps

| Priority | Item | Owner |
| --- | --- | --- |
| High | Run the Jetson setup; get its IP; reflash the cube with that IP; run `remote_game_check.py` and `phase4_check.sh` | user + assistant |
| High | The faint pump hum with the relay off: the pump wiring may still bypass the relay (red wire not on NO). Check relay terminals; the relay channels themselves click correctly. | Role 1 |
| High | Server still has placeholder soil numbers (`SOIL_RAW_DRY=3000`, `SOIL_RAW_WET=1200`) instead of 3430 and 1450 | Role 2 |
| High | Server counts a pump command as "watered" even if the firmware refused it (busy, too soon). A `incube/cmd/result` topic is proposed, not built. | Roles 1 and 2 |
| Medium | Client Step 5 (plants by tag) | Role 3 |
| Medium | `server/creatures.json` (legacy) still has made-up colon UIDs | Role 2 |
| Medium | Relay inputs float during an ESP32 reset: check IN1 to IN3 sit near 3.3 V while the board is held in reset | Role 1 |
| Medium | PubSubClient publishes only QoS 0, so retained `online` and pads are QoS 0 (contract says QoS 1); proper fix is a different MQTT library | Role 1 |
| Medium | Soil calibration redo in real soil; per-sensor freshness (the server's stale timer is global and starts optimistic) | Roles 1, 2 |
| Low | Reader B search timeout tuning; reader recovery after uploads without unplugging | Role 1 |
| Low | Tag UIDs: confirm Ember and Zest names with the team; `main` branch is stale | all |

## 14. Where to look

`firmware/CLAUDE.md` (Role 1 rules, original), `firmware/HANDOFF.md` (verified items, open issues, requests to Role 2), `CONTRACT.md`, `NOTES.md` (pins, thresholds, tag UIDs, gate status), `docs/PLANT_DATABASE_PLAN.md`, `docs/JETSON_RUNTHROUGH.md`, `server/deploy/` (Jetson services and broker config).
