// Boss art and effect recipes follow the supplied repository contract.
// Active encounters choose a boss ID separately from their difficulty tier.
// See docs/BOSSES.md for adding images, segmented rigs, and encounter ordering.
import { CHOMPER_RIG } from "./chomperRig.js";
import { SPORELING_RIG } from "./sporelingsRig.js";

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

// Boss identity is independent of difficulty tier. Add artwork here without
// copying a scene or changing the shared combat/watering rules.
export const BOSS_DEFINITIONS = {
  "sporeling-trio": {
    id: "sporeling-trio", name: "Sporeling Trio",
    art: { key: "boss-sporelings", file: "/assets/bosses/sporelings.png", rig: SPORELING_RIG,
      height: 150, mouth: { x: -75, y: -215 } },
    palette: { main: 0xe0508f, hot: 0xff9ad0, core: 0xffffff, deep: 0x4a1450 },
    moves: {
      attack: { name: "Spore Gnash", fx: "gnash" },
      special: { name: "Spore Cannon", fx: "volley" },
      guard: { name: "Mycelium Quake", fx: "mycelium" }
    },
    attackNames: { normal: "Spore Gnash", tired: "Rest and Lunge", laser: "Spore Laser" }
  },
  "drought-chomper": {
    id: "drought-chomper", name: "Drought Chomper",
    art: { ...CHOMPER, height: 176 },
    palette: BOSS_PALETTES[1], moves: BOSS_MOVES[1],
    attackNames: { normal: "Chomp", tired: "Rest and Lunge", laser: "Overcharge Laser" }
  }
};

export function bossDefinition(id) {
  const definition = BOSS_DEFINITIONS[id];
  if (!definition) throw new Error(`Boss is not configured: ${id}`);
  return definition;
}

export function bossMove(tier, move, bossId) {
  const moves = BOSS_DEFINITIONS[bossId]?.moves || BOSS_MOVES[tier] || BOSS_MOVES[1];
  return moves[move] || moves.attack;
}

export function bossPalette(tier, bossId) {
  return BOSS_DEFINITIONS[bossId]?.palette || BOSS_PALETTES[tier] || BOSS_PALETTES[1];
}

export function bossArt(tier, bossId) {
  const art = BOSS_DEFINITIONS[bossId]?.art;
  if (art) return { ...art, height: art.height * ({ 1: 1, 2: 1.08, 3: 1.16 }[tier] || 1) };
  return BOSS_ART[tier] || BOSS_ART[1];
}

export const rigPartKey = (art, part) => `${art.key}-${part}`;

// Call from a scene's preload() so every boss picture is ready.
export function preloadBossArt(scene) {
  const loaded = new Set();
  for (const art of [...Object.values(BOSS_ART), ...Object.values(BOSS_DEFINITIONS).map(boss => boss.art)]) {
    if (loaded.has(art.key)) continue;
    loaded.add(art.key);
    if (!scene.textures.exists(art.key)) scene.load.image(art.key, art.file);
    if (!art.rig) continue;
    for (const part of Object.keys(art.rig.parts)) {
      const key = rigPartKey(art, part);
      if (!scene.textures.exists(key)) scene.load.image(key, `${art.rig.folder}/${part}.png`);
    }
  }
}
