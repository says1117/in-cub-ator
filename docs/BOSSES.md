# Bosses and adding a boss

The active bosses are **Drought Chomper** and **Sporeling Trio**, with the original
ZIP names, images, segmented rigs and effects. Boss identity is independent of
moisture difficulty: both use tier 1/2/3 stats.

Completed wins and losses alternate bosses. Cancellation does not advance. The
server persists boss order, encounter identity and battle state in SQLite JSON
checkpoints; all browsers share them and reload resumes the active fight.
`client/src/state/bossRotation.js` remains legacy reference code and is not active.

To add another boss:

1. Put full art/cutout PNGs under `client/public/assets/bosses/`.
2. Add its ID, name, art/rig, move labels, palette and attack names to
   `client/src/data/bosses.js` (`BOSS_DEFINITIONS`).
3. Add its server kind/name to `server/app/game/config.py` (`BOSS_KINDS`) and
   kind/ID/order entries to `server/app/game/runtime.py` (`BOSS_IDS`, `BOSS_ORDER`).
4. For new rig geometry, extend the dispatch in `render/bossRig.js`. Mushroom
   rigs use `sporelingsRig.js` and `sporeRig.js` (`kind: "spores"`).
5. Add new effects to `render/bossFx.js`, then verify entrance, Attack/Guard/Special,
   charged laser, team swaps, cancellation, victory/defeat and persisted alternation.

Adding a boss does not require replacing the plant API or copying the combat scene.
See [complete game import](GAME_IMPORT.md) for authoritative combat and spawning.
