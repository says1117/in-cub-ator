<!-- docs/JETSON_RUNTHROUGH.md: How to get the code onto the Jetson and play the game remotely, end to end. Owner: shared by all roles (written by Role 1, 2026-10-10). -->

# Jetson run-through: code, network, cube, remote play

Branch with everything merged: **`temp-full-runthrough`** (firmware + Alexin's server and battle screen + plant database + tests). Okayuu's separate client is not in it.

## How the pieces connect

```
ESP32 cube  --Wi-Fi, MQTT port 1883-->  Jetson: Mosquitto broker + game server (port 8765) + game page (port 8080)
                                                  ^
Players' browsers  --Wi-Fi, http://<Jetson IP>:8080 and ws://<Jetson IP>:8765-----+
Remote players (anywhere)  --Tailscale (optional)--------------------------------+
```

Rule: the cube, the Jetson and anyone playing on site must be on **the same network that lets devices talk to each other**. UCF_WPA2 needs a personal login the ESP32 cannot use, and UCF Guest appears to hide devices from each other. Use a **phone hotspot (2.4 GHz, "Maximize Compatibility" on iPhone) or a travel router** for the whole demo.

## Part 1: get the code onto the Jetson

1. **Put the Jetson on the shared network** (hotspot or travel router). Check it has internet: `ping -c 2 github.com`.
2. **Sign in to GitHub on the Jetson**, if the repository is private. Easiest: `gh auth login` (GitHub CLI) and follow the prompts yourself. Never paste a password or token into a chat.
3. **Get the code:**
   - First time: `git clone https://github.com/says1117/in-cub-ator.git && cd in-cub-ator`
   - Already cloned: `cd in-cub-ator && git fetch origin`
   - Then: `git switch temp-full-runthrough && git pull`
4. **Install and start everything:** `bash server/deploy/setup_jetson.sh`. It installs Mosquitto, the server's Python packages and Node, builds the game page, and starts three services on every boot: `incube-server` (game), `incube-client` (game page on port 8080) and `incube-bridge` (USB soil reader). At the end it prints `Broker for the ESP32: <IP>:1883`. **Write that IP down.**
5. **Turn off the USB bridge** when the ESP32 is on Wi-Fi, or the two will both report the cube's online status:
   `sudo systemctl disable --now incube-bridge`
6. **Check the services:** `systemctl status incube-server incube-client mosquitto --no-pager` and `journalctl -u incube-server -f` for the game log.
7. **Updating later:** `git pull`, then `cd client && npm run build && cd ..` if the game screen changed, then `sudo systemctl restart incube-server incube-client`.

## Part 2: point the cube at the Jetson (on the Mac that flashes the ESP32)

1. In `firmware/incube_firmware/secrets.h` (gitignored, on the Mac only):
   - `WIFI_SSID` and `WIFI_PASSWORD`: the hotspot or router (type these yourself).
   - `MQTT_BROKER_HOST`: the Jetson IP from Part 1, step 4.
2. Upload the firmware from the Arduino IDE or `arduino-cli`. In the serial log you should see `network: online, IP ...`.
3. Unplug the ESP32's USB for 5 seconds after uploading so the NFC readers restart cleanly.

## Part 3: safety before the game runs with the real cube

- **Pumps under water** with the grille covered, every time the game server is running and the cube is online.
- **Soil sensors in soil** (or a damp cloth). In air they read bone dry and the game calls a boss and waters about once a minute.
- **Stop the game when you walk away:** `sudo systemctl stop incube-server`.

## Part 4: test it, in this order

Run these from a laptop on the same network (Mac commands shown):

1. **Remote check (read-only, sends nothing):**
   `server/.venv/bin/python firmware/tests/integration/remote_game_check.py <Jetson IP>`
   Expect 8 of 8: ports 8080, 8765, 1883 reachable; page loads; live game state; cube status online; soil readings arriving.
2. **Pump safety (you watch the pumps):**
   `firmware/tests/integration/phase4_check.sh <Jetson IP>`
   Expect: 2 s run, a too-soon command refused, bad payload ignored, a 60 s request capped to 3 s, offline seen after unplugging.
3. **Play it:** open `http://<Jetson IP>:8080` in Safari or Chrome. Plants walk; press the demo button or let the soil call a boss; win; the dry pot gets watered.
4. **Server tests on the Jetson:** `cd server && python3 -m unittest test_server test_plant_db test_summon test_progress test_snapshot` (179 pass on the Mac).

## Part 5: remote play

| Who | How | Notes |
| --- | --- | --- |
| On site, same network | `http://<Jetson IP>:8080` | Works today. The game page talks to port 8765 on the same address by itself. |
| From anywhere (teammates, judges) | **Tailscale** on the Jetson and on each viewer's device, then `http://<Jetson Tailscale IP>:8080` | Private: only devices you invite. No change to the game. The cube still uses the local network. Each person signs in to Tailscale themselves. |
| Public link (ngrok, Cloudflare) | Not recommended | Anyone with the link could press the demo button and water the plants, and the page would need changes to reach port 8765. |

Tailscale on the Jetson: `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up` and sign in with the link it prints. `tailscale ip -4` shows the address to share.

## Part 6: optional, plant database (NFC summoning)

Off by default, because the battle screen still identifies plants by pad A/B (plan Step 5). To try it on the Jetson: add `Environment=INCUBE_PLANT_DB=1` under `[Service]` in `/etc/systemd/system/incube-server.service`, then `sudo systemctl daemon-reload && sudo systemctl restart incube-server`. Progress is saved in `server/data/progress.db` on the Jetson.

## If something fails

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Remote check: ports fail | Not on the same network, or the network hides devices | Hotspot or travel router; check `sudo ufw status` on the Jetson and allow 1883, 8080, 8765 |
| Cube never says online | Wrong Wi-Fi name or password, 5 GHz network, or wrong Jetson IP in `secrets.h` | The serial log prints the reason every 5 s |
| Online and offline flicker | `incube-bridge` still running | `sudo systemctl disable --now incube-bridge` |
| Page loads, plants do not move | Game server not running, or port 8765 blocked | `systemctl status incube-server`; open port 8765 |
| A reader reports nothing | NFC reader stuck after an upload | Unplug the ESP32 USB for 5 s |
