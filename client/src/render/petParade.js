// client/src/render/petParade.js: The two plants hopping along behind the dragon. Owner: Role 3 (client, art, demo).
// They take turns: one is never in the air while the other is. A thirsty plant droops and hops lower.
// When a boss arrives they jump in fright, then the dragon calls the thirsty one forward to fight
// while the other hides behind the dragon.
//
// A plant only follows while it is on the cube (the server's `present`, from its NFC pad). Lift it and
// it poofs away; set it down and it poofs back to its place. One plant alone follows on its own.
//
// AdventureScene owns one of these and calls update() every frame. The boss arrival
// (render/bossEntrance.js) tells it what is happening through onEntrance().
import Phaser from "phaser";
import { PLANTS, PLANT_IDS, otherPlant } from "../data/plants.js";
import { createPlantRig, hasPlantRig } from "./plantRig.js";
import { audio } from "../audio.js";

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
    // size: the rig's own scale at forest size. A rig is sized by its scale, so 1 would be full battle size.
    pets[id] = { id, rig, size: rig.scaleX, home: dragonX + HOME[id], offset: 0, hop: null, from: 0, sweatAt: 0 };
  }
  const list = () => Object.values(pets);
  const active = () => list().filter((pet) => pet.here !== false);   // the ones that are on the cube

  const tween = (config) => { const t = scene.tweens.add(config); tweens.push(t); return t; };
  const after = (ms, fn) => { timers.push(scene.time.delayedCall(ms, fn)); };
  const nameOf = (id, state) => (state && state.fighters && state.fighters[id] && state.fighters[id].name) || PLANTS[id].name;
  const isDry = (id, state) => {
    const water = state && state.meters && state.meters.water ? state.meters.water[id] : null;
    return water !== null && water !== undefined && water < DRY_BELOW;
  };

  // ---- the walk: they hop in turns ----
  function walk(time, dt, state) {
    const all = active();
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
    const label = scene.add.text(0, 0, text, {
      fontFamily: "monospace", fontSize: "13px", fontStyle: "bold", color: "#ffffff", stroke: "#1a1208", strokeThickness: 4,
    }).setOrigin(0.5);
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
    const all = active();
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
      const id = state && state.boss && pets[state.boss.plant] && pets[state.boss.plant].here !== false ? state.boss.plant : all[0].id;
      called = pets[id];
      const other = pets[otherPlant(id)];
      if (!called) return;
      const here = scene.player.x;
      callout(`GO, ${nameOf(id, state).toUpperCase()}!`, here + 6, groundY - 138);
      called.rig.setMood("fierce").setDepth(10.6);
      called.rig.emote("anger", 1200);
      hopTo(called, here + FRONT, 2);
      if (other && other !== called && other.here !== false) {
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
      pet.rig.setPosition(pet.home, groundY).setDepth(DEPTH[pet.id]).setAlpha(1).setScale(pet.size).setVisible(pet.here !== false);
      pet.rig.setMood(isDry(pet.id, state) ? "thirsty" : "happy");
    }
    nextHopAt = scene.time.now + 250;
  }

  // The fight was won: they bounce and beam, one after the other.
  function celebrate() {
    active().forEach((pet, i) => {
      after(i * 280, () => {
        pet.rig.setMood("proud");
        pet.rig.play("cheer");
        pet.rig.emote(i % 2 ? "heart" : "sparkle", 1500);
      });
      after(1500 + i * 280, () => pet.rig.play("cheer"));
    });
  }

  // ---- on and off the cube ----
  // A burst of little clouds and a few sparks where the plant stands.
  function puff(x, y) {
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      const r = Phaser.Math.Between(5, 9);
      const cloud = scene.add.circle(x, y - 18, r, i % 3 === 0 ? 0xd9c8ff : 0xf6f1ff, 0.9).setDepth(11);
      made.push(cloud);
      const far = Phaser.Math.Between(16, 30);
      tween({
        targets: cloud, x: x + Math.cos(angle) * far, y: y - 18 + Math.sin(angle) * far * 0.8 - 6,
        scale: 2.1, alpha: 0, duration: Phaser.Math.Between(340, 520), ease: "Cubic.easeOut", onComplete: () => cloud.destroy(),
      });
    }
    for (let i = 0; i < 5; i++) {
      const spark = scene.add.star(x + Phaser.Math.Between(-14, 14), y - Phaser.Math.Between(10, 40), 4, 1.5, 4.5, 0xfff2a8).setDepth(11);
      made.push(spark);
      tween({ targets: spark, y: spark.y - Phaser.Math.Between(14, 30), alpha: 0, angle: 90, duration: Phaser.Math.Between(420, 640), delay: i * 30, onComplete: () => spark.destroy() });
    }
  }

  function leave(pet) {
    pet.here = false;
    pet.hop = null;
    audio.play("poofOut");
    puff(pet.rig.x, groundY);
    tween({
      targets: pet.rig, alpha: 0, scaleX: pet.size * 0.3, scaleY: pet.size * 0.3, duration: 170, ease: "Cubic.easeIn",
      onComplete: () => { if (pet.here === false) pet.rig.setVisible(false).setAlpha(1).setScale(pet.size); },
    });
  }

  function arrive(pet) {
    pet.here = true;
    pet.offset = 0;
    pet.hop = null;
    audio.play("poofIn");
    pet.rig.setPosition(pet.home, groundY).setDepth(DEPTH[pet.id]).setVisible(true).setAlpha(0).setScale(pet.size * 0.3);
    pet.rig.setMood("happy");
    puff(pet.home, groundY);
    tween({ targets: pet.rig, alpha: 1, scaleX: pet.size, scaleY: pet.size, duration: 260, delay: 90, ease: "Back.easeOut" });
    nextHopAt = Math.max(nextHopAt, scene.time.now + 400);
  }

  // Follow the server's `present`. The first message only sets the starting state, with no poof.
  function syncPresence(state) {
    if (!state || !state.present) return;
    for (const pet of list()) {
      const want = state.present[pet.id] !== false;
      if (pet.here === undefined) {
        pet.here = want;
        pet.rig.setVisible(want);
      } else if (want !== pet.here) {
        if (want) arrive(pet);
        else leave(pet);
      }
    }
  }

  function update(time, delta, walking, state) {
    syncPresence(state);
    const dt = Math.min(delta / 1000, 0.05);
    if (walking && !standing) walk(time, dt, state);
    else if (walking && standing) reset(state);       // the walk has started again
  }

  return {
    update,
    onEntrance,
    reset,
    celebrate,
    stand: () => { standing = true; },
    pets,
  };
}
