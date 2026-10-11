# Complete donor gameplay integration — review before commit

Source: `in-cub-ator-sporelings-boss.zip`. The donor's rules are integrated under
`server/app/game`; the existing FastAPI plant API, SQLite plant records,
WebSocket plant readings, level progression, and care pages remain.

## Imported systems

- **Automatic spawning:** five consecutive moisture readings below 50%. In
  default simulation mode the server samples stored moisture once per second.
  Hardware mode counts actual soil telemetry, not polling cached readings.
  The driest eligible plant starts; a wetter reading resets its dry streak.
- **Difficulty:** tier 1 below 50%, tier 2 below 25%, tier 3 at or below 1%.
  Boss HP is 38/44/48 and base attack 9/11/13. Boss identity is separate from tier.
- **Encounter state machine:** walking → entrance → battle → reward/cooldown.
  Moisture above 55% dismisses a soil-triggered encounter. Demo encounters ignore
  wet-soil cancellation. Offline hardware or 30 seconds without fresh soil cancels
  active encounters. Status messages cannot keep stale soil readings alive.
- **Respawn timing:** per-plant 60-second cooldown plus a 20-second global breather
  after completed fights. A harder moisture tier may bypass plant cooldown, but
  cannot bypass the global breather. The demo button can summon during cooldown.
- **Health:** global game health decays while dry (1/2.5/5 points per second by
  tier), recovers by 3 per second when wet, and holds during encounters/rewards.
  Weary below 60, wilting below 30, wilted at 0. Wilted attack is weaker; initial
  skill charge is lower when weary. Victory restores up to 25 health.
  This global game health is separate from stored plant `hp`.
- **Team combat:** the spawning plant fights first. If it faints, the other plant
  enters at full combat HP with its skill charged. Defeat requires both to fall.
  Default combat HP is 30 for Cast Iron and 34 for Monstera, independent of the
  stored care-page HP meter.
- **Boss strategy:** Attack > Special > Guard > Attack. Tells show sure/likely/flip
  confidence (100/75/50%), possible bluffs, and heavy attacks. Repeated moves invite
  counters. At half HP the boss enrages, hits harder and gives less reliable tells.
  Tier 2/3 get a heavy attack every third turn. Landed hits are capped at 24.
- **Plant skills:** Inferno Bloom hits for 1.75× attack; Sunburst heals 8 and hits
  for 0.75× attack. Two counter wins charge a skill; a healthy fight starts with
  one charge. This replaces the previous four-turn recharge. Skills always land;
  an attacking boss can still hit unless the skill blocks. Clashes graze the plant.
- **NFC figures:** MQTT pad tags map to Thorn Burst, Photosynthesis or Bark Shield
  and replace that plant's fighter stats. Unknown tags fall back to plant stats.
- **Automatic moves:** connected screens have 10 seconds to select a move after
  the preceding exchange completes. On timeout the server chooses a counter/skill.
  With no connected game screen the server plays the fight automatically.
- **Shared server battle state:** `/ws/game` broadcasts the same encounter, turns,
  damage, tells, team, skill charge, health and result to every screen. Move requests
  carry fight ID and turn; stale/double submissions cannot resolve an extra turn.
  `/api/game` provides a read-only snapshot. Reload/reconnect resumes the fight.
- **Hardware support:** raw soil calibration, MQTT soil/pad/status/debug topics,
  tier-based pump durations (2/2.5/3 seconds), a 3-second command cap, reward intervals,
  offline/wet-soil checks, USB serial bridge, fake publisher, optional drying/soaking
  simulation and Jetson broker/server/client/bridge services.

## Adaptations retained from your branch

- Names remain **Drought Chomper** and **Sporeling Trio**. Completed wins and losses
  alternate bosses; cancellation does not advance. The next boss and active fight
  now persist on the server in a JSON database checkpoint, instead of browser storage.
- Each plant level above 1 adds one attack point and one healing point to healing
  skills. Critical counter wins build up to three blooms; taking damage clears them;
  a signature skill spends them for +50% damage per bloom.
- Every third offensive boss action is a charged laser with +20% calculated damage
  rounded up, subject to the donor's 24-damage cap. This is additional to tier heavy
  attacks, whose count follows turns. Guard does not advance the laser counter.
- Move announcements remain text plus sound: plant → pause → boss → verdict → effects.
  Critical means a counter win; weak/miss means the boss won (miss identifies a bluff);
  skill hit and clash have separate labels. Damage follows donor calculations:
  ordinary counter wins deal the plant's attack, losses deal zero outgoing damage,
  and clashes graze the plant. The prior random 10% miss / half outgoing weak-hit
  model and combat water/light costs are superseded by the imported rules.
- Default mode is simulated: victory adds +20 moisture; manual watering adds +10.
  The existing persistent receipts and `/ws/plants` update remain. No hardware
  presence is required in simulation. Full moisture still awards one level, holds
  at 100% for 10 seconds without watering, then resets to 60%.
- Hardware mode is explicit. A command attempt is persisted before publishing so
  retries/restarts never issue it twice. Successful MQTT enqueue is not relay proof;
  the client waits for actual sensor readings rather than inventing moisture.
- The target forest/battle artwork, procedural audio, detail pages, level bars,
  growth/pop and reading effects remain. Tier, confidence, charge, health and result
  displays now follow server state.

## Files and running

- Rules/config: `server/app/game/{battle,engine,state_machine,config,rewards}.py`.
- Integration/checkpoint/reward adapter: `server/app/game/runtime.py`.
- API/telemetry: `server/app/main.py`, `mqtt_client.py`, `models.py`.
- Client feed: `client/src/state/gameSource.js`; routing: `client/src/main.js`.
- Active battle: `BossScene.js` delegates to the queued server presentation in
  `BossPresentation.js`. The old local resolver was removed. Legacy scene/browser
  rotation code remains reference-only and no longer drives gameplay.
- Hardware/demo helpers: `server/serial_bridge.py`, `fake_publisher.py`,
  `app/game/moisture_sim.py`, `serve_client.py`, and `server/deploy/*`.

Run backend from `server`:

```sh
.venv/bin/python -m uvicorn app.main:app --port 8000
```

Run client from `client`: `npm run dev`. Default simulated mode samples database
moisture; PATCH either plant below 50% and wait five samples to trigger a boss.
Set `INCUBE_MOISTURE_SIM=1` to also gradually dry soil and soak after water.
It is opt-in so the existing light/CO₂ simulator does not silently change moisture.
Set `INCUBE_HARDWARE=1` only when using real MQTT sensors/pumps. MQTT host/port use
`MQTT_HOST`/`MQTT_PORT`. Raw calibration overrides are `INCUBE_SOIL_RAW_DRY` and
`INCUBE_SOIL_RAW_WET`; donor defaults 3000/1200 are placeholders. Manual pump duration
uses `INCUBE_MANUAL_PUMP_MS` (default 1000, capped at 3000); this is a duration, not
an assertion of +10% physical moisture. Extra browser origins go in comma-separated
`INCUBE_ALLOWED_ORIGINS`.

Jetson setup script is supplied but **has not been run**. It creates an isolated
Python environment and hardware-mode configuration, builds the client, and installs
services. The kiosk serves every SPA route correctly and connects to the API on the
same host. Physical relay operation requires compatible firmware and calibration;
no Jetson or relay was available for testing.

## Commit scope and verification

This change also incorporates the existing uncommitted plant API, progression,
telemetry and simulator source changes needed by the merged app. It excludes the
plant database, generated ZIP/build output, dependencies and local environment files.
Review this document before the commit. The previous ZIP comparison is a historical
snapshot; it does not describe this completed game import.

Verification completed: 138 backend tests (115 donor rule tests, 9 runtime tests,
one multi-client API/restart test, and 13 watering/telemetry tests), six client
tests, production build, Python compilation and deployment shell syntax. Real
browser checks passed low-moisture spawn for the driest plant, tier selection,
shared server turns, duplicate input lock, reload, timed automatic moves, wet-soil
cancellation, simulated victory water and boss alternation, with no browser errors.
Hardware command safety was tested with mocks; physical relay/sensor behavior
was not tested.
