// client/src/render/petParade.js: The two plants hopping along behind the dragon. Owner: Role 3 (client, art, demo).
// They take turns: one is never in the air while the other is. A thirsty plant droops and hops lower.
// When a boss arrives they jump in fright, then the dragon calls the thirsty one forward to fight
// while the other hides behind the dragon.
//
// AdventureScene owns one of these and calls update() every frame. The boss arrival
// (render/bossEntrance.js) tells it what is happening through onEntrance().
import Phaser from "phaser";
import { PLANTS, PLANT_IDS, otherPlant } from "../data/plants.js";
import { createPlantRig, hasPlantRig } from "./plantRig.js";
import { textStyle } from "../ui/font.js";

const SIZE = 0.345;            // forest size: a share of the battle-screen picture
const HOME = { A: -76, B: -144 };   // where each one hops, measured from the dragon
const DEPTH = { A: 8.7, B: 8.6 };   // above the dragon's shadow (8), behind the dragon (9, 10)
const GROUND_SLIP = 0.4;       // how much of the ground's speed carries a standing plant backward
const AHEAD = 10;              // how far ahead of its spot a hop lands
const DRY_BELOW = 50;          // percent: under this a plant looks thirsty (the server's own boss threshold)
const FRONT = 80;              // how far in front of the dragon the called plant stands
const HIDE = -72;              // where the other one cowers, measured from the dragon

export function createPetParade(scene, groundY) {
  const dragonX = scene.player.x;
  const pets = {};
  const made = [];              // callouts and other short-lived things
  const tweens = [];
  const timers = [];
  let turn = 0;                 // whose hop is next
  let nextHopAt = 0;
  let standing = false;         // true from the moment a boss is seen until the walk starts again
  let called = null;            // the plant the dragon sent forward

  for (const id of PLANT_IDS) {
    const plant = PLANTS[id];
    if (!hasPlantRig(scene, plant, "s")) continue;
    const rig = createPlantRig(scene, plant, dragonX + HOME[id], groundY, plant.rig.height * SIZE, { size: "s" });
    rig.setDepth(DEPTH[id]);
    pets[id] = { id, rig, home: dragonX + HOME[id], offset: 0, hop: null, from: 0, sweatAt: 0 };
  }
  const list = () => Object.values(pets);

  const tween = (config) => { const t = scene.tweens.add(config); tweens.push(t); return t; };
  const after = (ms, fn) => { timers.push(scene.time.delayedCall(ms, fn)); };
  const nameOf = (id, state) => (state && state.fighters && state.fighters[id] && state.fighters[id].name) || PLANTS[id].name;
  // The server's thirsty flag (state v2), else the old rule: under DRY_BELOW percent.
  const isDry = (id, state) => {
    const flags = state && state.meters && state.meters.thirsty;
    if (flags && typeof flags[id] === "boolean") return flags[id];
    const water = state && state.meters && state.meters.water ? state.meters.water[id] : null;
    return water !== null && water !== undefined && water < DRY_BELOW;
  };

  // ---- the walk: they hop in turns ----
  function walk(time, dt, state) {
    const all = list();
    if (!all.length) return;
    const airborne = all.some((pet) => pet.hop && time < pet.hop.end);

    if (!airborne && time >= nextHopAt) {
      const pet = all[turn % all.length];
      turn += 1;
      const dry = pet.rig.getMood() === "thirsty";
      const ms = dry ? Phaser.Math.Between(500, 560) : Phaser.Math.Between(400, 470);
      const height = dry ? Phaser.Math.FloatBetween(0.09, 0.13) : Phaser.Math.FloatBetween(0.17, 0.27);
      pet.rig.play("hop", { ms, height });
      pet.hop = { start: time, end: time + ms, ms };
      pet.from = pet.offset;
      nextHopAt = time + ms + Phaser.Math.Between(50, 170);
    }

    for (const pet of all) {
      const k = pet.hop ? (time - pet.hop.start) / pet.hop.ms : 1;
      if (k >= 0.18 && k < 0.84) {
        // in the air: it sails forward to just ahead of its spot
        const a = (k - 0.18) / 0.66;
        pet.offset = Phaser.Math.Linear(pet.from, AHEAD, a * a * (3 - 2 * a));
      } else {
        // on the ground: the ground carries it back
        pet.offset = Math.max(-AHEAD * 1.6, pet.offset - scene.speed * GROUND_SLIP * dt);
      }
      pet.rig.x = pet.home + pet.offset;

      const dry = isDry(pet.id, state);
      const mood = dry ? "thirsty" : "happy";
      if (pet.rig.getMood() !== mood) pet.rig.setMood(mood);
      if (dry && time >= pet.sweatAt) {
        pet.rig.emote("sweat", 1300);
        pet.sweatAt = time + Phaser.Math.Between(5200, 8600);
      }
    }
  }

  // ---- the boss arrival ----
  function callout(text, x, y) {
    const plate = scene.add.container(x, y).setDepth(22).setScale(0);
    const label = scene.add.text(0, 0, text, textStyle(16, "#ffffff")).setOrigin(0.5);
    const back = scene.add.graphics();
    const w = label.width + 14;
    back.fillStyle(0x07051a, 0.85);
    back.fillRoundedRect(-w / 2, -11, w, 22, 5);
    back.fillTriangle(-6, 10, 6, 10, -2, 18);
    plate.add([back, label]);
    made.push(plate);
    tween({ targets: plate, scaleX: 1, scaleY: 1, duration: 170, ease: "Back.easeOut" });
    tween({ targets: plate, alpha: 0, y: y - 8, delay: 1250, duration: 260 });
  }

  // Hops a plant to a new spot in a few bounds.
  function hopTo(pet, x, hops, onArrive) {
    const each = 210;
    const step = (x - pet.rig.x) / hops;
    for (let i = 0; i < hops; i++) {
      after(i * each, () => {
        pet.rig.play("hop", { ms: each, height: 0.24 });
        tween({ targets: pet.rig, x: pet.rig.x + step, delay: each * 0.18, duration: each * 0.66, ease: "Sine.easeInOut" });
      });
    }
    if (onArrive) after(hops * each, onArrive);
  }

  function onEntrance(step, state) {
    const all = list();
    if (!all.length) return;

    if (step === "spotted") {
      // something is out there: both jump, one a beat after the other
      standing = true;
      all.forEach((pet, i) => {
        pet.hop = null;
        after(i * 150, () => {
          pet.rig.emote("alert", 1000);
          pet.rig.play("startle");
          pet.rig.setMood("alarmed");
        });
      });
    } else if (step === "impact") {
      // the landing blows them back with the dragon
      all.forEach((pet, i) => {
        pet.rig.play("hurt", { force: 1.3, delay: i * 60 });
        tween({ targets: pet.rig, x: pet.rig.x - 9 - i * 4, duration: 300, ease: "Cubic.easeOut" });
      });
    } else if (step === "faceoff") {
      // the dragon calls the thirsty plant forward; the other one hides behind the dragon
      const id = state && state.boss && pets[state.boss.plant] ? state.boss.plant : all[0].id;
      called = pets[id];
      const other = pets[otherPlant(id)];
      const here = scene.player.x;
      callout(`GO, ${nameOf(id, state).toUpperCase()}!`, here + 6, groundY - 138);
      called.rig.setMood("fierce").setDepth(10.6);
      called.rig.emote("anger", 1200);
      hopTo(called, here + FRONT, 2);
      if (other && other !== called) {
        other.rig.setMood("alarmed");
        hopTo(other, here + HIDE, 1);
      }
    } else if (step === "roar") {
      // the called plant digs in against the roar, the other one jumps again
      if (called) called.rig.play("guard", { ms: 900, delay: 60 });
      for (const pet of all) {
        if (pet === called) continue;
        pet.rig.play("startle", { delay: 120 });
        pet.rig.emote("sweat", 1400);
      }
    }
  }

  // Back to their spots behind the dragon, as if nothing had happened.
  function reset(state) {
    tweens.splice(0).forEach((t) => t.remove());
    timers.splice(0).forEach((t) => t.remove(false));
    made.splice(0).forEach((object) => object.destroy());
    called = null;
    standing = false;
    for (const pet of list()) {
      pet.offset = 0;
      pet.hop = null;
      pet.rig.stopActions();
      pet.rig.setPosition(pet.home, groundY).setDepth(DEPTH[pet.id]).setAlpha(1);
      pet.rig.setMood(isDry(pet.id, state) ? "thirsty" : "happy");
    }
    nextHopAt = scene.time.now + 250;
  }

  // The fight was won: they bounce and beam, one after the other.
  function celebrate() {
    list().forEach((pet, i) => {
      after(i * 280, () => {
        pet.rig.setMood("proud");
        pet.rig.play("cheer");
        pet.rig.emote(i % 2 ? "heart" : "sparkle", 1500);
      });
      after(1500 + i * 280, () => pet.rig.play("cheer"));
    });
  }

  function update(time, delta, walking, state) {
    const dt = Math.min(delta / 1000, 0.05);
    if (walking && !standing) walk(time, dt, state);
    else if (walking && standing) reset(state);       // the walk has started again
  }

  // Where the HUD hangs each plant's tag (scenes/HudScene.js): its x right now, and the top of the
  // plant standing on the ground. Hops lift the drawing, not the rig, so the tag does not hop.
  function tagAnchors() {
    const out = {};
    for (const pet of list()) {
      if (!pet.rig.visible || pet.rig.alpha < 0.5) continue;
      out[pet.id] = { x: pet.rig.x, y: groundY - pet.rig.getHeight() };
    }
    return out;
  }

  return {
    update,
    onEntrance,
    tagAnchors,
    reset,
    celebrate,
    stand: () => { standing = true; },
    pets,
  };
}
