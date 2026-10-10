// client/src/data/plants.js: The two plants that follow the dragon and fight the bosses. Owner: Role 3 (client, art, demo).
// Plant A and plant B are the two pots in the cube. The server decides who fights (the drier one
// first) and sends the names and numbers; this file only says how each one looks and moves.
//
// To give a plant a new move, see the notes at the top of render/plantRig.js (how it moves its body)
// and render/battleFx.js (what flies across the screen), then name both in `moves` below.
import { EMBER_RIG, ZEST_RIG } from "./plantRigs.js";

export const PLANTS = {
  A: {
    id: "A",
    key: "plant-ember",
    name: "Ember",              // only used until the server sends a name
    rig: EMBER_RIG,
    lid: 0x86a92a,              // eyelid colour, for blinks and expressions
    glow: 0xff7a5c,             // its colour in effects
    // Named arm poses: how far each piece turns (radians) when the pose is fully on.
    gestures: {
      punch: { leafL: 0.5, fist: 0.95, handT: 0.25 },
      shield: { leafL: 0.35, fist: 0.5, handT: -0.55, handL: 0.5, handR: -0.5, leafT: -0.2 },
    },
    // What it does for each move the server reports. body: an action in render/plantRig.js.
    // fx: an effect in render/battleFx.js. Skills are looked up by the skill's name.
    moves: {
      attack: { body: "strike", fx: "punch" },
      guard: { body: "guard", fx: "shield" },
      special: { body: "cast", fx: "petals" },
      skill: { body: "cast", fx: "thorns" },
    },
    skills: {
      "Thorn Burst": { body: "strike", fx: "thorns" },
      "Photosynthesis": { body: "cast", fx: "sunlight" },
      "Bark Shield": { body: "guard", fx: "bark" },
    },
  },
  B: {
    id: "B",
    key: "plant-zest",
    name: "Zest",
    rig: ZEST_RIG,
    lid: 0x4fae22,
    glow: 0xf4e04d,
    gestures: {
      punch: { fist: 0.9, handT: 0.2, leafL: 0.2 },
      shield: { fist: 0.45, handT: -0.5, handL: 0.45, handR: -0.4, leafL: 0.25 },
    },
    moves: {
      attack: { body: "strike", fx: "punch" },
      guard: { body: "guard", fx: "shield" },
      special: { body: "cast", fx: "petals" },
      skill: { body: "cast", fx: "sunlight" },
    },
    skills: {
      "Thorn Burst": { body: "strike", fx: "thorns" },
      "Photosynthesis": { body: "cast", fx: "sunlight" },
      "Bark Shield": { body: "guard", fx: "bark" },
    },
  },
};

export const PLANT_IDS = Object.keys(PLANTS);

export function plantFor(id) {
  return PLANTS[id] || PLANTS.A;
}

// The other plant: the one that waits while this one fights.
export function otherPlant(id) {
  return PLANT_IDS.find((other) => other !== id) || id;
}

export const plantPartKey = (plant, part, size) => `${plant.key}-${part}-${size}`;

// What a plant does for a move. `skillName` is the skill's name from the server, when the move is a skill.
export function plantMove(plant, move, skillName) {
  if (move === "skill" && plant.skills[skillName]) return plant.skills[skillName];
  return plant.moves[move] || plant.moves.attack;
}

// Call from a scene's preload() so every plant picture is ready, in both sizes.
export function preloadPlantArt(scene) {
  for (const plant of Object.values(PLANTS)) {
    for (const size of Object.keys(plant.rig.sizes)) {
      for (const part of Object.keys(plant.rig.parts)) {
        const key = plantPartKey(plant, part, size);
        if (!scene.textures.exists(key)) scene.load.image(key, `${plant.rig.folder}/${part}_${size}.png`);
      }
    }
  }
}
