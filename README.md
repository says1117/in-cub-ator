<!-- README.md: What the project is and how to run each layer. Owner: shared by all roles. -->

# In-cube-ator

A plant cube with a pixel game. A creature walks endlessly on screen. When a plant's soil reads dry, a boss appears.
Beat the boss and the cube waters that plant.

```
ESP32 (cube) --MQTT--> Mosquitto + game server (Jetson) --WebSocket--> browser game (client)
  pads, soil           boss logic, camera, serves the client           any screen on the Wi-Fi
  <-- pump / light commands --
```

## Run on the Jetson (Orin Nano / Nano)

Needs JetPack (Ubuntu) with internet for the first install.

```bash
git clone <this repo> in-cub-ator && cd in-cub-ator
sudo bash server/deploy/setup_jetson.sh
```

This installs Mosquitto, builds `server/.venv` (using JetPack's OpenCV), runs the tests, and starts the
`incube-server` service on boot. It prints the URL when done:

- Game screen: `http://<jetson-ip>:8000/` (open it on the Jetson's own browser, or any device on the same Wi-Fi)
- MQTT for the ESP32: `<jetson-ip>:1883`

Useful commands:

```bash
journalctl -u incube-server -f            # server logs
sudo systemctl restart incube-server      # after editing server/deploy/server.env or data/*.json
python3 server/tools/fake_publisher.py    # fake cube: puts a tag on pot A and dries it out (no hardware needed)
server/tools/force_boss.sh A              # summon a boss on pot A right now
```

Settings live in `server/config.py`; override with `INCUBE_*` variables in `server/deploy/server.env`
(for example `INCUBE_VISION=1 INCUBE_CAMERA=csi` for the sunlight meter from a ribbon-cable camera, `INCUBE_AUTO_LIGHT=1`).

Python 3.8+ is required. The original 2019 Jetson Nano ships Python 3.6 on JetPack 4: install Python 3.8
(`sudo apt install python3.8 python3.8-venv`) and change `python3 -m venv` in the setup script to `python3.8`.

## Run on a laptop (no Jetson, no hardware)

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
# needs a Mosquitto broker on localhost:1883 (brew/apt install mosquitto)
.venv/bin/python -m app.main            # then open http://localhost:8000/
.venv/bin/python tools/fake_publisher.py
.venv/bin/python -m pytest              # tests
```

Without any server, open `client/index.html` through any static server with `?mock=1`, or just let it fall back
to mock data after 4 seconds. Keys in the game: `1`/`2` summon a boss on pot A/B, `M` toggles mock data.

## Layers

| Folder | Owner | What is there |
| --- | --- | --- |
| `firmware/` | Role 1 | ESP32 Arduino code (not part of this setup; flash it from the Arduino IDE) |
| `server/` | Role 2 | FastAPI + MQTT game server, boss rules, camera, deploy scripts |
| `client/` | Role 3 | Browser pixel game, no build step. Placeholder art is drawn in code; add real art through `client/assets/manifest.json` |
| `art/`, `demo/` | Role 3 | Sprites tools and pitch material |

Topics and the game state message are defined in `CONTRACT.md`.

## Calibrating soil

The defaults in `server/config.py` (`SOIL`) are placeholders. Read the raw numbers with the ESP32
(`firmware/tests/soil_print`) or `mosquitto_sub -t 'incube/soil/#'`, then set `air`, `water`, `dry_at` (boss appears at or above)
and `wet_at` (boss leaves at or below) for each pot, and record them in `NOTES.md`.
