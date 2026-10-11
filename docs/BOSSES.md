# Adding or replacing a boss

The bosses are **Drought Chomper** and **Sporeling Trio**, using the original names
from the supplied `in-cub-ator-sporelings-boss.zip`. The ZIP's image, seven cutout
parts, rig geometry, animated faces, and mushroom effect recipes are imported.
Its server engine, random boss selection, UI, and audio replacement are not imported.

## Where to edit

`client/src/data/bosses.js` is the boss catalog. `BOSS_DEFINITIONS` holds each ID,
name, art, effect palette, moves, and attack labels. Boss identity is separate
from difficulty tier. The existing tier-based exports remain available for the
reference presentation code; active encounters pass their boss ID explicitly.

`client/src/state/bossRotation.js` lists the encounter order. Completed fights
alternate Chomper → Trio → Chomper. Both victory and defeat advance the sequence.
An incomplete fight retains its boss when reopened. Reload preserves boss identity
and the encounter ID, but restarts the battle's existing temporary HP/turn state.
Duplicate or stale completion callbacks cannot advance the sequence again.

Rotation is saved in this browser's local storage, with an in-memory fallback.
It is not synchronized between accounts or devices. Clearing browser storage
starts the sequence again at Chomper.

## Add artwork

1. Put a transparent full image under `client/public/assets/bosses/`.
2. Add a `BOSS_DEFINITIONS` entry with a unique ID and texture key:

```js
"my-boss": {
  id: "my-boss",
  name: "My Boss",
  art: { key: "boss-my-boss", file: "/assets/bosses/my-boss.png", height: 176 },
  palette: { main: 0xff3d4d, hot: 0xff8a3d, core: 0xfff0d0, deep: 0x5a0f1c },
  moves: {
    attack: { name: "Chomp", fx: "bite" },
    special: { name: "Scorch Ray", fx: "ray" },
    guard: { name: "Thorn Quake", fx: "quake" }
  },
  attackNames: { normal: "Chomp", tired: "Rest and Lunge", laser: "Overcharge Laser" }
}
```

3. Change `BOSS_ORDER` to replace an existing boss, or extend the order.
4. For animation, supply an optional rig: Chomper-style geometry uses
   `chomperRig.js`; mushroom geometry uses `sporelingsRig.js` with `kind: "spores"`.
   A different rig format needs a renderer and dispatch in `render/bossRig.js`.
5. Build and verify the entrance, normal attack, laser, and win/lose transition.

The normal attack uses the catalog's `moves.attack.fx`; additional special/guard
recipes remain available to the presentation renderer. Catalog labels do not
change the combat rules. Every third actual boss attack still uses the charged
laser and its existing 20% damage bonus, rounded up to an integer. Boss HP, level,
stamina, damage ranges, player skills, and watering rewards stay the same for both.

## Files and checks

- `main.js`: creates/reopens the next encounter before the forest entrance.
- `BossScene.js`: applies its name and visuals to the existing battle rules;
  completes rotation once when a battle ends.
- `BossPresentation.js` / `bossEntrance.js`: select the matching image and rig.
- `sporeRig.js`: mushroom faces, breathing, swaying, roaring, and attack poses.
- `bossFx.js`: imported gnash, spore volley, and mycelium quake alongside the
  existing Chomper effects and powerful third-attack laser.

Run `node --test test/*.test.js` and `npm run build` from `client`.
