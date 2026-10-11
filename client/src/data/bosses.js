// client/src/data/bosses.js: Which picture each boss tier uses. Owner: Role 3 (client, art, demo).
// The server decides the tier (1 mild, 2 dry, 3 bone dry). All three share the Drought Chomper until
// more art arrives: drop the new file in client/public/assets/bosses/ and change its line here.
// `height` is how tall the boss stands on the forest path (in game pixels); the width follows the picture.
// `rig` is optional: a boss with one is drawn from moving pieces (render/bossRig.js) once it has landed.
import { CHOMPER_RIG } from "./chomperRig.js";

const CHOMPER = { key: "boss-chomper", file: "/assets/bosses/chomper.png", rig: CHOMPER_RIG };

export const BOSS_ART = {
  1: { ...CHOMPER, height: 176 },
  2: { ...CHOMPER, height: 190 },
  3: { ...CHOMPER, height: 204 },
};

// What each tier calls its three moves, and which effect in render/bossFx.js it is.
// The server only says "attack", "guard" or "special"; this is how each tier's boss does it.
export const BOSS_MOVES = {
  1: { attack: { name: "Chomp", fx: "bite" }, special: { name: "Scorch Ray", fx: "ray" }, guard: { name: "Thorn Quake", fx: "quake" } },
  2: { attack: { name: "Brute Crunch", fx: "bite" }, special: { name: "Dust Cannon", fx: "ray" }, guard: { name: "Root Slam", fx: "quake" } },
  3: { attack: { name: "Dragon Fang", fx: "bite" }, special: { name: "Desert Breath", fx: "ray" }, guard: { name: "Dune Breaker", fx: "quake" } },
};

// Each tier's colours in its effects and on the battle screen: red heat, sand and gold, cold dragon fire.
export const BOSS_PALETTES = {
  1: { main: 0xff3d4d, hot: 0xff8a3d, core: 0xfff0d0, deep: 0x5a0f1c },
  2: { main: 0xff9a2e, hot: 0xffd45e, core: 0xffffff, deep: 0x5a3410 },
  3: { main: 0x9a5bff, hot: 0x5fd4ff, core: 0xffffff, deep: 0x2a1466 },
};

export function bossMove(tier, move) {
  const moves = BOSS_MOVES[tier] || BOSS_MOVES[1];
  return moves[move] || moves.attack;
}

export function bossPalette(tier) {
  return BOSS_PALETTES[tier] || BOSS_PALETTES[1];
}

export function bossArt(tier) {
  return BOSS_ART[tier] || BOSS_ART[1];
}

export const rigPartKey = (art, part) => `${art.key}-${part}`;

// Call from a scene's preload() so every boss picture is ready.
export function preloadBossArt(scene) {
  for (const art of Object.values(BOSS_ART)) {
    if (!scene.textures.exists(art.key)) scene.load.image(art.key, art.file);
    if (!art.rig) continue;
    for (const part of Object.keys(art.rig.parts)) {
      const key = rigPartKey(art, part);
      if (!scene.textures.exists(key)) scene.load.image(key, `${art.rig.folder}/${part}.png`);
    }
  }
}
