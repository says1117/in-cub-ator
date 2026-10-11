// client/src/data/plants.js: The two plants that follow the dragon and fight the bosses. Owner: Role 3 (client, art, demo).
// Plant A and plant B are the two pots in the cube. The server decides who fights (the drier one
// first) and sends the names and numbers; this file only says how each one looks and moves.
//
// To give a plant a new move, see the notes at the top of render/plantRig.js (how it moves its body)
// and render/battleFx.js (what flies across the screen), then name both in `moves` or `skills` below.
import { EMBER_RIG, ZEST_RIG } from "./plantRigs.js";

// The skills a tagged figure can bring (server/creatures.json). Any plant can end up with one.
const FIGURE_SKILLS = {
  "Thorn Burst": { body: "strike", fx: "thorns", icon: "thorn", blurb: "SURE HIT" },
  "Photosynthesis": { body: "channel", fx: "sunlight", icon: "leaf", ms: 1100, blurb: "HEAL 8" },
  "Bark Shield": { body: "guard", fx: "bark", icon: "bark", ms: 900, blurb: "BLOCK + HIT BACK" },
};

export const PLANTS = {
  A: {
    id: "A",
    key: "plant-ember",
    name: "Ember",              // only used until the server sends a name
    rig: EMBER_RIG,
    lid: 0x86a92a,              // eyelid colour, for blinks and expressions
    glow: 0xff7a5c,             // its colour in effects and on the battle screen
    // Named arm poses: how far each piece turns (radians) when the pose is fully on.
    gestures: {
      punch: { leafL: 0.5, fist: 0.95, handT: 0.25 },
      shield: { leafL: 0.35, fist: 0.5, handT: -0.55, handL: 0.5, handR: -0.5, leafT: -0.2 },
    },
    // What it does for each move the server reports.
    //   name   what the move is called on the battle screen
    //   body   an action in render/plantRig.js      ms: a different length for that action
    //   fx     an effect in render/battleFx.js      icon: a picture in ui/battleHud.js
    //   reach  "boss" to run all the way to the boss for the blow
    moves: {
      attack: { name: "Vine Haymaker", body: "strike", fx: "haymaker", icon: "fist", ms: 760, reach: "boss" },
      guard: { name: "Petal Aegis", body: "guard", fx: "aegis", icon: "heart", ms: 900 },
      special: { name: "Flamingo Flare", body: "cast", fx: "flare", icon: "flare", ms: 900 },
    },
    // Skills are looked up by the name the server sends. blurb: one line on the button.
    skills: {
      "Inferno Bloom": { body: "channel", fx: "inferno", icon: "bloom", ms: 1500, blurb: "SURE HIT x1.25" },
      ...FIGURE_SKILLS,
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
      attack: { name: "Blade Rush", body: "rush", fx: "bladeRush", icon: "blade", reach: "boss" },
      guard: { name: "Stripe Wall", body: "guard", fx: "stripeWall", icon: "wall", ms: 900 },
      special: { name: "Citrus Volt", body: "cast", fx: "citrusVolt", icon: "bolt", ms: 900 },
    },
    skills: {
      "Sunburst": { body: "channel", fx: "sunburst", icon: "sun", ms: 1500, blurb: "HEAL 8 + HIT" },
      ...FIGURE_SKILLS,
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
// The answer always has a name to show.
export function plantMove(plant, move, skillName) {
  if (skillName && plant.skills[skillName]) return { name: skillName, ...plant.skills[skillName] };
  if (skillName) return { name: skillName, body: "cast", fx: "", icon: "star", blurb: "SURE HIT" };
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
