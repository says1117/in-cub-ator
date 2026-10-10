// client/src/render/battleFx.js: What flies across the battle screen when a plant makes a move. Owner: Role 3 (client, art, demo).
// Each effect is one small function. data/plants.js says which effect goes with which move or skill.
//
// ADDING AN EFFECT: add a function to BATTLE_FX below, then name it in data/plants.js
// (`moves` or `skills`, as fx). It is given one object:
//   scene, layer    the battle scene and the layer to draw on (coordinates are the 1280 x 720 stage)
//   plant           the plant's entry from data/plants.js (plant.glow is its colour)
//   from(name)      where a spot on the plant is right now, for example from("fist") or from("handT")
//   to              the middle of the boss: { x, y }
//   at              ms from now until the move lands (when the plant's action reaches its hit)
//   lands           true if the move did damage; false if it was beaten or tied this turn
// Everything an effect makes must destroy itself when it is done.
import Phaser from "phaser";

const rand = Phaser.Math.FloatBetween;
const between = Phaser.Math.Between;

// A shape that flies along a curve from a to b, bulging upward by `rise`, then calls onArrive.
function fly(scene, shape, a, b, rise, delay, duration, onArrive, share = 1) {
  const path = { k: 0 };
  scene.tweens.add({
    targets: path, k: share, delay, duration, ease: "Sine.easeIn",
    onUpdate: () => {
      const k = path.k;
      const x = Phaser.Math.Linear(a.x, b.x, k);
      const y = Phaser.Math.Linear(a.y, b.y, k) - rise * 4 * k * (1 - k);
      shape.setRotation(Math.atan2(y - shape.y, x - shape.x || 0.001)).setPosition(x, y);
    },
    onComplete: () => { if (onArrive) onArrive(shape.x, shape.y); shape.destroy(); },
  });
}

// Bits that burst outward from a point and fade.
function burst(ctx, x, y, colors, count = 10, reach = 90) {
  const { scene, layer } = ctx;
  for (let i = 0; i < count; i++) {
    const bit = scene.add.rectangle(x, y, between(5, 11), between(5, 11), colors[i % colors.length]);
    bit.setRotation(rand(0, 3));
    layer.add(bit);
    const angle = rand(0, Math.PI * 2);
    const far = rand(reach * 0.4, reach);
    scene.tweens.add({
      targets: bit, x: x + Math.cos(angle) * far, y: y + Math.sin(angle) * far, alpha: 0, scaleX: 0.3, scaleY: 0.3,
      rotation: bit.rotation + rand(-4, 4), duration: between(280, 520), ease: "Cubic.easeOut", onComplete: () => bit.destroy(),
    });
  }
}

// A ring that swells and fades.
function ring(ctx, x, y, color, from = 20, toSize = 170, duration = 320, thick = 6) {
  const { scene, layer } = ctx;
  const circle = scene.add.ellipse(x, y, toSize, toSize).setStrokeStyle(thick, color, 1).setFillStyle(color, 0).setScale(from / toSize);
  layer.add(circle);
  scene.tweens.add({ targets: circle, scaleX: 1, scaleY: 1, alpha: 0, duration, ease: "Cubic.easeOut", onComplete: () => circle.destroy() });
}

const later = (ctx, ms, fn) => ctx.scene.time.delayedCall(Math.max(0, ms), fn);

export const BATTLE_FX = {
  // A fist: speed lines behind it, a star where it lands.
  punch(ctx) {
    const { scene, layer, to } = ctx;
    later(ctx, ctx.at - 90, () => {
      const fist = ctx.from("fist");
      for (let i = 0; i < 4; i++) {
        const streak = scene.add.rectangle(fist.x - 30 - i * 26, fist.y + (i - 1.5) * 16, 70 - i * 8, 5, 0xffffff, 0.8);
        layer.add(streak);
        scene.tweens.add({ targets: streak, x: streak.x - 60, alpha: 0, scaleX: 0.3, duration: 200, onComplete: () => streak.destroy() });
      }
    });
    later(ctx, ctx.at, () => {
      const fist = ctx.from("fist");
      const x = ctx.lands ? Phaser.Math.Linear(fist.x, to.x, 0.55) : fist.x + 40;
      const y = ctx.lands ? Phaser.Math.Linear(fist.y, to.y, 0.55) : fist.y;
      if (!ctx.lands) { ring(ctx, x, y, 0xd7e3ff, 14, 80, 260, 4); return; }
      const star = scene.add.star(x, y, 8, 22, 70, 0xfff3a8).setStrokeStyle(5, 0xffffff).setScale(0.2).setRotation(rand(0, 1));
      layer.add(star);
      scene.tweens.add({ targets: star, scaleX: 1.25, scaleY: 1.25, alpha: 0, rotation: star.rotation + 0.5, duration: 260, ease: "Cubic.easeOut", onComplete: () => star.destroy() });
      ring(ctx, x, y, 0xffffff, 30, 210, 300);
      burst(ctx, x, y, [0xfff3a8, 0xffffff, ctx.plant.glow], 12, 130);
    });
  },

  // A dome of leaves the plant ducks behind.
  shield(ctx) {
    const { scene, layer } = ctx;
    later(ctx, ctx.at - 120, () => {
      const face = ctx.from("face");
      const dome = scene.add.ellipse(face.x + 40, face.y - 20, 250, 330, 0x8dffb0, 0.28).setStrokeStyle(6, 0xd9ffe2, 0.95).setScale(0.25);
      layer.add(dome);
      scene.tweens.add({ targets: dome, scaleX: 1, scaleY: 1, duration: 170, ease: "Back.easeOut" });
      scene.tweens.add({ targets: dome, alpha: 0, delay: 430, duration: 240, onComplete: () => dome.destroy() });
      for (let i = 0; i < 7; i++) {
        const angle = -1.25 + (i / 6) * 2.5;
        const leaf = scene.add.ellipse(face.x + 40, face.y - 20, 30, 14, i % 2 ? 0x4fbf5a : 0x9be36a).setStrokeStyle(2, 0x1c4b24);
        leaf.setRotation(angle);
        layer.add(leaf);
        scene.tweens.add({
          targets: leaf, x: face.x + 40 + Math.cos(angle) * 128, y: face.y - 20 + Math.sin(angle) * 168,
          duration: 190, ease: "Back.easeOut",
        });
        scene.tweens.add({ targets: leaf, alpha: 0, y: leaf.y + 30, delay: 470, duration: 240, onComplete: () => leaf.destroy() });
      }
      if (ctx.lands) later(ctx, 260, () => ring(ctx, face.x + 150, face.y - 20, 0xffffff, 40, 230, 300));
    });
  },

  // A flurry of petals from its open hand. They scatter short of the boss if the move was beaten.
  petals(ctx) {
    const { scene, layer, to } = ctx;
    for (let i = 0; i < 9; i++) {
      later(ctx, ctx.at - 330 + i * 34, () => {
        const hand = ctx.from(i % 2 ? "handT" : "handR");
        const petal = scene.add.ellipse(hand.x, hand.y, 26, 12, i % 3 ? ctx.plant.glow : 0xffffff).setStrokeStyle(2, 0x3a1420);
        layer.add(petal);
        const end = { x: to.x + between(-60, 60), y: to.y + between(-80, 70) };
        fly(scene, petal, hand, end, between(40, 150), 0, 300, (x, y) => {
          burst(ctx, x, y, ctx.lands ? [ctx.plant.glow, 0xffffff] : [0xb8c4d8], ctx.lands ? 3 : 1, ctx.lands ? 60 : 30);
        }, ctx.lands ? 1 : 0.55);
      });
    }
    if (ctx.lands) later(ctx, ctx.at + 40, () => ring(ctx, to.x, to.y, ctx.plant.glow, 30, 240, 340));
  },

  // Thorns shot straight at the boss.
  thorns(ctx) {
    const { scene, layer, to } = ctx;
    for (let i = 0; i < 6; i++) {
      later(ctx, ctx.at - 170 + i * 30, () => {
        const start = ctx.from(i % 2 ? "fist" : "handT");
        const thorn = scene.add.triangle(start.x, start.y, 0, -7, 44, 0, 0, 7, 0x2f7a3a).setStrokeStyle(2, 0xdfffc2);
        layer.add(thorn);
        const end = { x: to.x + between(-55, 55), y: to.y + between(-90, 80) };
        fly(scene, thorn, start, end, between(-10, 30), 0, 170, (x, y) => burst(ctx, x, y, [0xdfffc2, 0x58b060, 0xffffff], 4, 70));
      });
    }
    later(ctx, ctx.at + 60, () => { ring(ctx, to.x, to.y, 0xdfffc2, 30, 260, 320); ring(ctx, to.x, to.y, 0xffffff, 10, 150, 240, 4); });
  },

  // Sunbeams fall on the plant and sparkles rise from it: a heal.
  sunlight(ctx) {
    const { scene, layer } = ctx;
    later(ctx, ctx.at - 260, () => {
      const pot = ctx.from("pot");
      for (let i = 0; i < 4; i++) {
        const beam = scene.add.rectangle(pot.x - 90 + i * 60, pot.y - 330, 34 + (i % 2) * 22, 620, 0xfff3a0, 0).setRotation(0.16);
        layer.add(beam);
        scene.tweens.add({ targets: beam, fillAlpha: 0.34, duration: 180, delay: i * 50, yoyo: true, hold: 300, onComplete: () => beam.destroy() });
      }
      for (let i = 0; i < 14; i++) {
        const spark = scene.add.star(pot.x + between(-110, 110), pot.y + between(-40, 30), 4, 3, 10, i % 3 ? 0xfff3a0 : 0x9dffb0);
        spark.setAlpha(0);
        layer.add(spark);
        scene.tweens.add({ targets: spark, y: spark.y - between(150, 300), alpha: { from: 1, to: 0 }, rotation: 3, delay: 120 + i * 40, duration: between(620, 900), onComplete: () => spark.destroy() });
      }
      ring(ctx, pot.x, pot.y - 110, 0xfff3a0, 60, 330, 520);
    });
  },

  // Plates of bark slam down in front of the plant.
  bark(ctx) {
    const { scene, layer } = ctx;
    later(ctx, ctx.at - 140, () => {
      const face = ctx.from("face");
      for (let i = 0; i < 4; i++) {
        const plate = scene.add.rectangle(face.x + 150 + (i % 2) * 14, face.y - 420, 46, 96, i % 2 ? 0x8a5a34 : 0x6e4426).setStrokeStyle(4, 0x2e1a0e);
        layer.add(plate);
        scene.tweens.add({ targets: plate, y: face.y - 150 + i * 82, duration: 160, delay: i * 45, ease: "Bounce.easeOut" });
        scene.tweens.add({ targets: plate, alpha: 0, x: plate.x + 40, delay: 620, duration: 220, onComplete: () => plate.destroy() });
      }
      later(ctx, 260, () => ring(ctx, face.x + 165, face.y - 30, 0xffe0b0, 40, 260, 320));
    });
  },

  // Leaves swirl out of the ground where a plant arrives.
  arrive(ctx) {
    const { scene, layer } = ctx;
    later(ctx, ctx.at, () => {
      const pot = ctx.from("pot");
      ring(ctx, pot.x, pot.y, 0xffffff, 40, 340, 380);
      for (let i = 0; i < 14; i++) {
        const leaf = scene.add.ellipse(pot.x, pot.y + 40, 26, 12, i % 2 ? 0x57c264 : ctx.plant.glow).setStrokeStyle(2, 0x1c4b24);
        layer.add(leaf);
        const angle = -Math.PI * (0.08 + 0.84 * (i / 13));
        scene.tweens.add({
          targets: leaf, x: pot.x + Math.cos(angle) * between(120, 230), y: pot.y + 40 + Math.sin(angle) * between(140, 300),
          rotation: rand(-5, 5), alpha: 0, duration: between(420, 700), ease: "Cubic.easeOut", onComplete: () => leaf.destroy(),
        });
      }
    });
  },
};

// Runs a named effect. An unknown name does nothing, so a move can be named before its effect exists.
export function playBattleFx(name, ctx) {
  const effect = BATTLE_FX[name];
  if (effect) effect(ctx);
}
