<!-- README.md: What the project is and how to run each layer. Owner: shared by all roles. -->

# README.md

TODO

## Simulated victory watering

Until the Jetson is connected, a boss victory requests
`POST /api/plants/{plantId}/watering-reward` with `{ "battleId": "unique-battle-id" }`.
The server adds 20 percentage points to that plant's `soilMoisture`, capped at 100,
then broadcasts the stored plant data as `plants_updated` on `/ws/plants`.
The client updates its plant store from that WebSocket message. A persistent reward
receipt prevents retries of the same battle from watering twice. Defeats and the
Water combat move do not request this reward. This endpoint simulates moisture;
it does not issue MQTT or relay commands.

Run the backend from `server` with `.venv/bin/uvicorn app.main:app --port 8000`,
and the frontend from `client` with `npm install` and `npm run dev` (port 5173).
The existing MQTT connection may retry while no broker or hardware is available;
simulated rewards work independently of that connection.

Reward tests use an isolated temporary database and mocked MQTT, leaving your
plant database untouched. Install the test-only dependency with
`.venv/bin/python -m pip install httpx`, then run from `server`:

```sh
.venv/bin/python -m unittest discover -s tests -p test_watering_reward.py
```

The **WATER +10%** button on `/cast_iron` and `/monstera` sends
`POST /api/plants/{plantId}/water` with a unique `requestId`. It simulates a
10-point moisture increase, caps at 100%, and broadcasts the result through
WebSocket. The detail-page meter uses the resulting sensor data from the shared
store. Duplicate requests are recorded independently from victory rewards.
Jetson/relay control is not connected yet; both watering paths are explicitly
simulated.

When moisture rises from below 100% to 100%, the server awards one level and broadcasts it. Repeated full readings or watering requests do not award another level. Full plants cannot receive manual or victory water; moisture stays at 100% for 10 seconds, then the server resets it to 60% and broadcasts the update. Both watering sources become available again. The cooldown persists across restarts; sensor readings cannot lower moisture during the hold. Each level above 1 adds one point to Leaf Flurry damage, Water/Sunlight resource recovery and healing, and CO₂ recovery/attack bonus.


## Light and CO₂ simulator

With an MQTT broker running, launch `server/simulate_pi.py` from `server` using
`.venv/bin/python simulate_pi.py`. It publishes light and CO₂ for both plant IDs
every two seconds. `soilMoisture` is optional in telemetry: omitting it preserves
moisture, level, and the watering cooldown. The backend stores the supplied readings
and broadcasts them through WebSocket. Both processes use `MQTT_HOST` and
`MQTT_PORT` (defaults: `127.0.0.1`, `1883`) and must connect to the same broker.


## Alternating bosses

Completed fights alternate **Drought Chomper** and **Sporeling Trio**. Both victories
and defeats advance the order; unfinished encounters keep the same boss across
reloads. Boss identity is saved in this browser, while temporary combat state
restarts on reload. Both use the same battle rules and third-attack laser.
See [the boss guide](docs/BOSSES.md) for adding artwork, rigs, or another boss.
Run client tests with `node --test test/*.test.js` from `client`.
