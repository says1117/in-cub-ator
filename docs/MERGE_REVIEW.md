# Boss merge review

## New in this merge

- Add Sporeling Trio from `in-cub-ator-sporelings-boss.zip`: the complete image,
  seven segmented PNGs, rig configuration, animated stems/caps, live faces,
  roaring, and attack poses. Keep the source name **Sporeling Trio**.
- Keep the existing Drought Chomper and its animated rig. Caterpillar is no longer
  an active encounter; its older asset remains available without deletion.
- Add a reusable boss catalog with distinct IDs, names, art, move labels, palettes,
  and attack labels. Boss identity is independent of its difficulty tier.
- Extend the rig factory to dispatch mushroom rigs to the imported renderer.
  Import the gnash, spore-volley, and mycelium-quake effect recipes without
  replacing the existing renderer, arena, HUD, or audio engine.
- Make the forest entrance and battle choose the same boss definition. Update
  title, enemy name, battle log, and victory text for the chosen boss.
- Alternate completed encounters **Drought Chomper → Sporeling Trio → repeat**.
  Wins and losses advance once. Incomplete encounters keep their boss. Store the
  active encounter and next boss in this browser's local storage, with an
  in-memory fallback. Reload keeps identity, while temporary combat state
  restarts as before. This is not account-wide or cross-device persistence.
- Add rotation/catalog tests and `docs/BOSSES.md`, with steps for adding a new
  static-image or segmented boss without copying the combat scene.

## Gameplay preserved

Both bosses use the same existing level-8, 100-HP, 70-stamina encounter values,
normal/exhausted damage ranges, player skills, and combat resource rules. The
Trio's triple-bite animation applies its normal damage **once**, not three times.
Every third actual boss attack still fires the powerful laser with 20% more
damage, rounded up. Attack count starts at zero in each new battle.

Victory still requests simulated +20-point watering. Defeat does not reward
water. Manual watering remains +10 points. Existing server logic still awards
one level when moisture reaches 100%, holds it for 10 seconds, then resets it to
60%; its WebSocket and sensor handling are unchanged by this merge.

## Commit scope

The client UI merge and earlier requested features were still uncommitted when
this task started. The frontend commit therefore also records that existing
working client: merged forest/battle presentation, original battle rules retained
in `legacy/BossScene.js`, procedural audio, plant-level bars, storage/detail
navigation, watering buttons, moisture growth/pop, and distinct sensor-update
effects. These are preserved features, not new gameplay changes from the boss ZIP.

Only client source/assets/package files, client tests, and documentation are
included. Existing server source edits, plant database changes, simulator edits,
ZIP downloads, dependencies, and built output remain outside this commit.
The donor server/battle engine is not substituted for the current backend.

## Validation

- Client rotation/catalog tests pass: ordering, restart persistence, duplicate
  completion, blocked/corrupt storage, distinct complete assets, and effect names.
- Browser checks pass: both animated entrances; Chomper victory to Trio;
  Trio reload retaining the same encounter; normal gnash, volley and quake;
  Trio third-attack laser; Trio defeat to Chomper; no defeat reward; no runtime errors.
- All 12 existing isolated backend watering/telemetry tests pass.
- Production client build and whitespace checks pass.
