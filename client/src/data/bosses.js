// client/src/data/bosses.js: Which picture each boss tier uses. Owner: Role 3 (client, art, demo).
// The server picks which boss comes (the Drought Chomper or the Sporeling Trio, equally likely) and,
// from how dry the soil is, how strong it is (tier 1 mild, 2 dry, 3 bone dry). To add a boss, drop its
// picture in client/public/assets/bosses/, add a line to each table below, and add the name to
// BOSS_KINDS in server/config.py.
// `height` is how tall the boss stands on the forest path (in game pixels); the width follows the picture.
// `rig` is optional: a boss with one is drawn from moving pieces (render/bossRig.js) once it has landed.
import { CHOMPER_RIG } from "./chomperRig.js";
import { SPORELING_RIG } from "./sporelingsRig.js";

const CHOMPER = { key: "boss-chomper", file: "/assets/bosses/chomper.png", rig: CHOMPER_RIG };
// Three sad mushrooms on one patch of dark ground, cut into moving pieces (render/sporeRig.js).
// mouth: where an attack comes out if the picture is shown flat, as an offset on the 1280 x 720 stage.
const SPORELINGS = { key: "boss-sporelings", file: "/assets/bosses/sporelings.png", rig: SPORELING_RIG, mouth: { x: -75, y: -215 } };

// One entry per kind of boss, which the server picks at random each time (config.BOSS_KINDS).
// `height` is how tall it stands on the forest path at tier 1; a drier tier makes it taller.
export const BOSS_ART = {
  chomper: { ...CHOMPER, height: 176 },
  sporelings: { ...SPORELINGS, height: 150 },
};
const TIER_SCALE = { 1: 1, 2: 1.08, 3: 1.16 };

// What each kind calls its three moves, and which effect in render/bossFx.js it is.
// The server only says "attack", "guard" or "special"; this is how each boss does it.
export const BOSS_MOVES = {
  chomper: { attack: { name: "Chomp", fx: "bite" }, special: { name: "Scorch Ray", fx: "ray" }, guard: { name: "Thorn Quake", fx: "quake" } },
  sporelings: { attack: { name: "Spore Gnash", fx: "gnash" }, special: { name: "Spore Cannon", fx: "volley" }, guard: { name: "Mycelium Quake", fx: "mycelium" } },
};

// Each kind's colours in its effects and on the battle screen: red heat, pink spores.
export const BOSS_PALETTES = {
  chomper: { main: 0xff3d4d, hot: 0xff8a3d, core: 0xfff0d0, deep: 0x5a0f1c },
  sporelings: { main: 0xe0508f, hot: 0xff9ad0, core: 0xffffff, deep: 0x4a1450 },
};

// All of these take the boss as the server sends it ({ kind, tier, ... }), or just a kind name.
const kindOf = (boss) => {
  const kind = typeof boss === "string" ? boss : boss && boss.kind;
  return BOSS_ART[kind] ? kind : "chomper";
};

export function bossMove(boss, move) {
  const moves = BOSS_MOVES[kindOf(boss)];
  return moves[move] || moves.attack;
}

export function bossPalette(boss) {
  return BOSS_PALETTES[kindOf(boss)];
}

export function bossArt(boss) {
  const art = BOSS_ART[kindOf(boss)];
  const scale = (boss && typeof boss === "object" && TIER_SCALE[boss.tier]) || 1;
  return { ...art, height: art.height * scale };
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
