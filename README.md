# in-cub-ator

A plant-care game with a forest, animated bosses, live sensor readings and
watering rewards. The FastAPI backend owns both plant data and battle rules;
Phaser animates the shared server state.

## Run locally

```sh
cd server
.venv/bin/python -m uvicorn app.main:app --port 8000
```

In another terminal, run `npm install` and `npm run dev` from `client` (port 5173).
Using `python -m uvicorn` also works when a copied virtual environment's launcher
still contains an old path. Install backend dependencies from `server/requirements.txt`
if creating a new environment.

Routes: `/`, `/adventure`, `/boss`, `/storage`, `/cast_iron`, `/monstera`.
Storage opens the matching plant detail page. The Battle button or `/boss` requests
a demo encounter. Normal encounters also spawn automatically from low moisture.

## Spawning and combat

Five consecutive readings below 50% summon a boss for the driest eligible plant.
Moisture selects difficulty: below 50% tier 1, below 25% tier 2, at/below 1% tier 3.
Soil above 55% dismisses a soil-triggered encounter. Completed wins and losses
alternate **Drought Chomper** and **Sporeling Trio**; cancellations do not advance.
The server persists the sequence and fight, so reload and multiple screens share it.

The donor's tells, bluffs, enrage, heavy attacks, repeated-move counters, team
swaps, health decay/recovery, NFC skills and timed auto-moves are active. Plant
move callouts precede boss callouts, verdicts and effects. Cast Iron has Inferno
Bloom; Monstera has Sunburst. Two winning counters charge skills. Levels and blooms
strengthen them; every third offensive boss action uses the charged +20% laser.
See [combat](docs/COMBAT.md), [boss guide](docs/BOSSES.md), and the
[complete import review](docs/GAME_IMPORT.md) for exact rules and adaptations.

## Plant readings and watering

`GET /api/plants` and `/ws/plants` supply moisture, light, CO₂, HP, level and watering
availability. `/ws/game` supplies game/battle state and accepts demo/move actions.
`GET /api/game` reads the current game snapshot.

Default mode simulates watering: the server rewards victory with +20 moisture,
and detail-page water buttons play a cosmetic splash and sound without changing
moisture or sending a watering request. Defeat a boss to earn water.
Stored receipt IDs prevent
retries from watering twice. Stored moisture is broadcast over WebSocket; the
client does not invent a moisture reading from an HTTP success.

At 100% moisture the server awards one level, blocks victory watering for
10 seconds, then resets moisture to 60%. The hold survives restart. Repeated full
readings do not award extra levels. Plant detail pages retain growth/pop, care
sounds and distinct moisture/light/CO₂ update effects.

## Simulation and hardware

Without Jetson hardware, the game samples stored moisture once per second. Set
`INCUBE_MOISTURE_SIM=1` to additionally dry soil gradually, with soaking after water.
The existing `.venv/bin/python simulate_pi.py` publishes light and CO₂ every two
seconds through MQTT; omitting moisture preserves watering and its cooldown.
Both MQTT processes use `MQTT_HOST`/`MQTT_PORT` (default localhost:1883).

Set `INCUBE_HARDWARE=1` for real soil/pad/status MQTT and bounded pump commands.
Soil must stay fresh; offline/silent sensors cancel fights and block water. Pump
commands never alter stored moisture directly; actual sensor feedback updates it.
See [hardware settings and deployment](docs/GAME_IMPORT.md). Jetson setup/services
and USB serial bridge are included but have not been installed or tested on hardware.

## Verification

From `server`, install test dependency `httpx` if needed and run:

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*game*.py'
.venv/bin/python -m unittest discover -s tests -p test_watering_reward.py
```

Tests use isolated temporary databases and mocked hardware. From `client`, run
`node --test test/*.test.js` and `npm run build`.

Random encounters also appear during active walking on `/` and `/adventure`, after a
random 20–45 second wait. The server owns the timer shared by all screens, respects
plant cooldowns and the post-battle breather, and alternates the two bosses. Leaving
the forest, hiding the tab, or disconnecting stops exploration. Random encounters
can appear with healthy moisture; victory uses the existing watering reward, full
moisture lock, and pump safety limits. Low-moisture encounters still work.

## Live footage preparation

Open `/footage` from the forest's **LIVE FOOTAGE** button or from Storage. This
page uses the forest theme, shows two live camera views, reconnects automatically,
and labels sensor readings separately from future AI assessments. Storage and
plant-care pages continue to use their existing plant artwork.

The webcam connects to the computer running the backend (or later the Jetson).
Install the updated backend requirements and restart it:

```bash
cd server
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
```

Grant that Python/terminal process camera permission in your operating system.
By default both views share webcam index `0`. To assign separate webcams:

```bash
export INCUBE_CAMERA_SOURCES='{"PLANT_001":0,"PLANT_002":1}'
```

For two plants visible in one camera, assign a normalized crop to each view:

```bash
export INCUBE_CAMERA_SOURCES='{"PLANT_001":{"source":0,"crop":[0,0,0.5,1]},"PLANT_002":{"source":0,"crop":[0.5,0,0.5,1]}}'
```

Use the actual database plant IDs. Crops are `[x,y,width,height]`, fractions of the
camera frame. Sources can also be OpenCV-compatible camera URLs; credentials stay
on the backend. One worker owns each physical camera, so shared views do not
compete for it. Cameras start on demand, release after five seconds without views,
and capture up to eight frames per second. A failed camera, missing OpenCV,
bad frame or timed-out request shows **Camera unavailable** and retries.

Preparation endpoints:

- `GET /api/plants/{plantId}/footage/frame`: current JPEG, or 503 while unavailable.
- `GET /api/plants/{plantId}/footage`: camera status and the future assessment contract.

No trained model is provided yet. The assessment is explicitly
`model_not_configured`, with null condition, confidence and assessment timestamp;
the UI displays **Model not configured · not assessed**. A future trained model
can populate that contract with its output for the corresponding cropped view.
This page displays live footage; it does not save recordings.
