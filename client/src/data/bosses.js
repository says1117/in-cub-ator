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
