// client/src/render/bossFx.js: What the boss throws, spits and flashes in a fight. Owner: Role 3 (client, art, demo).
// render/bossRig.js uses these for its intent poses and its moves (rig.setIntent, rig.perform).
//
//   createChargeSparks(scene, parent)   sparks that gather at the mouth while it charges (lives in the rig)
//   spitOrb(scene, options)             a glowing orb spat from the mouth at a target. Returns ms until it hits.
//   shieldGlint(scene, options)         a shield that flashes up in front of it, or shatters
//   biteSnap(scene, options)            the snap of a bite landing, or the clink of one that was blocked
//
// Positions are in the `layer` given (for the battle screen, the 1280 x 720 stage). Without a layer
// things go straight into the scene, in its own coordinates. Everything made here destroys itself.
// Movement runs on the scene's tweens and clock, so a hit-stop (timeScale 0) freezes it too.
import Phaser from "phaser";

const rand = Phaser.Math.FloatBetween;
const between = Phaser.Math.Between;
export const GLOW_KEY = "bossFxGlow";

const ORB = { core: 0xfff1c4, hot: 0xffb04a, mid: 0xf0502f, rim: 0xc21d36 };

// A soft white dot, tinted for every glow and spark here.
export function ensureGlowTexture(scene) {
  if (scene.textures.exists(GLOW_KEY)) return GLOW_KEY;
  const texture = scene.textures.createCanvas(GLOW_KEY, 64, 64);
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  texture.refresh();
  return GLOW_KEY;
}

// A point on screen (world coordinates) as a point in `layer`.
export function toLayer(layer, point) {
  if (!layer || !layer.getWorldTransformMatrix) return { x: point.x, y: point.y };
  const local = layer.getWorldTransformMatrix().applyInverse(point.x, point.y);
  return { x: local.x, y: local.y };
}

function put(scene, layer, object) {
  if (layer) layer.add(object);
  return object;
}

// ---- charge sparks: a fixed pool of glints that drift in toward the mouth and wink out ----
// `parent` is a container inside the rig, so the sparks move and scale with it. update() is
// called by the rig every frame with its own clock, so they freeze in a hit-stop.
export function createChargeSparks(scene, parent, options = {}) {
  ensureGlowTexture(scene);
  const size = options.size || 1;          // rig units per spark scale step
  const reach = options.reach || 150;      // how far out they start, in rig units
  const colors = [ORB.core, ORB.hot, 0xffd9a0, 0xffffff];
  const sparks = [];
  for (let i = 0; i < 18; i++) {
    const image = scene.add.image(0, 0, GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    image.setTint(colors[i % colors.length]);
    parent.add(image);
    sparks.push({ image, alive: false, age: 0, life: 0, angle: 0, from: 0, spin: 0 });
  }
  let due = 0;
  return {
    // ms: how far the rig's clock moved. (x, y): the mouth, in parent coordinates. strength: 0 to 1+.
    update(ms, x, y, strength) {
      due += (ms / 1000) * 22 * Math.min(1.6, strength);    // about 22 a second at full strength
      while (due >= 1) {
        due -= 1;
        const spark = sparks.find((s) => !s.alive);
        if (!spark) break;
        spark.alive = true;
        spark.age = 0;
        spark.life = rand(0.32, 0.55);
        spark.angle = rand(0, Math.PI * 2);
        spark.from = rand(reach * 0.55, reach);
        spark.spin = rand(-2.5, 2.5);
        spark.scale = rand(0.22, 0.42) * size;
        spark.image.setVisible(true);
      }
      for (const spark of sparks) {
        if (!spark.alive) continue;
        spark.age += ms / 1000;
        const k = spark.age / spark.life;
        if (k >= 1) { spark.alive = false; spark.image.setVisible(false); continue; }
        const pull = k * k * (3 - 2 * k);                     // slow, then fast, into the mouth
        const angle = spark.angle + spark.spin * k;
        const r = spark.from * (1 - pull);
        spark.image.setPosition(x + Math.cos(angle) * r, y + Math.sin(angle) * r * 0.8);
        spark.image.setScale(spark.scale * (1 - 0.6 * k));
        spark.image.setAlpha(Math.min(1, k * 5) * (1 - k * 0.5) * Math.min(1, strength + 0.2));
      }
    },
    clear() {
      due = 0;
      for (const spark of sparks) { spark.alive = false; spark.image.setVisible(false); }
    },
  };
}

// ---- the orb: spat from the mouth, it flies at the target and bursts, or fizzles out short ----
// options: from {x, y} and target {x, y} in layer coordinates, layer, lands, delay (ms),
// scale (sizes are tuned for the 1280 x 720 battle stage; default 1 in a layer, 0.625 without one).
// Returns ms from now until it hits the target (or, when it does not land, until it fizzles).
export function spitOrb(scene, options) {
  ensureGlowTexture(scene);
  const { layer = null, lands = true, delay = 0 } = options;
  const from = options.from;
  const target = options.target || { x: from.x - 400, y: from.y + 120 };
  const unit = options.scale ?? (layer ? 1 : 0.625);
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  const travel = Phaser.Math.Clamp(distance * 0.45, 170, 240);
  const share = lands ? 1 : 0.62;          // a beaten orb dies about two thirds of the way
  const rise = Math.min(90, distance * 0.16);
  const pointAt = (k) => ({
    x: Phaser.Math.Linear(from.x, target.x, k),
    y: Phaser.Math.Linear(from.y, target.y, k) - rise * 4 * k * (1 - k),
  });

  const orb = put(scene, layer, scene.add.container(from.x, from.y)).setVisible(false);
  const halo = scene.add.image(0, 0, GLOW_KEY).setTint(ORB.mid).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5 * unit);
  const body = scene.add.circle(0, 0, 13 * unit, ORB.rim, 1).setStrokeStyle(3 * unit, 0x2a0410, 0.9);
  const inner = scene.add.circle(0, 0, 9 * unit, ORB.mid, 1);
  const core = scene.add.circle(-2 * unit, -2 * unit, 5 * unit, ORB.core, 1);
  orb.add([halo, body, inner, core]);

  const path = { k: 0 };
  let trailAt = 0;
  scene.tweens.add({
    targets: path,
    k: share,
    delay,
    duration: travel * share,
    ease: lands ? "Quad.easeIn" : "Sine.easeOut",
    onStart: () => orb.setVisible(true).setScale(0.4),
    onUpdate: () => {
      const p = pointAt(path.k);
      orb.setPosition(p.x, p.y);
      orb.setScale(Math.min(1, 0.4 + path.k * 3) * (lands ? 1 : 1 - 0.35 * (path.k / share)));
      halo.setAlpha(0.65 + 0.35 * Math.sin(path.k * 40));
      // a trail of embers
      if (path.k - trailAt > 0.07) {
        trailAt = path.k;
        const ember = put(scene, layer, scene.add.image(p.x, p.y, GLOW_KEY));
        ember.setTint(path.k * 20 % 2 < 1 ? ORB.hot : ORB.mid).setBlendMode(Phaser.BlendModes.ADD).setScale(0.55 * unit).setAlpha(0.8);
        scene.tweens.add({ targets: ember, scale: 0.1 * unit, alpha: 0, y: ember.y + rand(-6, 10) * unit, duration: 260, onComplete: () => ember.destroy() });
      }
    },
    onComplete: () => {
      const at = { x: orb.x, y: orb.y };
      orb.destroy();
      if (lands) burstAt(scene, layer, at, unit);
      else fizzleAt(scene, layer, at, unit);
    },
  });
  return delay + travel * share;
}

function burstAt(scene, layer, at, unit) {
  const flash = put(scene, layer, scene.add.image(at.x, at.y, GLOW_KEY)).setTint(ORB.core).setBlendMode(Phaser.BlendModes.ADD).setScale(1 * unit);
  scene.tweens.add({ targets: flash, scale: 3.4 * unit, alpha: 0, duration: 260, ease: "Cubic.easeOut", onComplete: () => flash.destroy() });
  const ring = put(scene, layer, scene.add.circle(at.x, at.y, 60 * unit)).setStrokeStyle(5 * unit, ORB.hot, 1).setScale(0.2);
  scene.tweens.add({ targets: ring, scale: 1, alpha: 0, duration: 320, ease: "Cubic.easeOut", onComplete: () => ring.destroy() });
  const colors = [ORB.core, ORB.hot, ORB.mid, ORB.rim];
  for (let i = 0; i < 12; i++) {
    const bit = put(scene, layer, scene.add.rectangle(at.x, at.y, between(4, 9) * unit, between(4, 9) * unit, colors[i % colors.length]));
    bit.setRotation(rand(0, 3));
    const angle = rand(0, Math.PI * 2);
    const far = rand(30, 90) * unit;
    scene.tweens.add({
      targets: bit, x: at.x + Math.cos(angle) * far, y: at.y + Math.sin(angle) * far, alpha: 0, scale: 0.3,
      rotation: bit.rotation + rand(-4, 4), duration: between(260, 480), ease: "Cubic.easeOut", onComplete: () => bit.destroy(),
    });
  }
}

// A beaten orb: it wobbles, shrinks to nothing and leaves a puff of dull smoke.
function fizzleAt(scene, layer, at, unit) {
  const pop = put(scene, layer, scene.add.circle(at.x, at.y, 10 * unit, ORB.mid, 1));
  scene.tweens.add({ targets: pop, scale: 0.1, alpha: 0, duration: 200, ease: "Back.easeIn", onComplete: () => pop.destroy() });
  for (let i = 0; i < 7; i++) {
    const puff = put(scene, layer, scene.add.image(at.x + rand(-8, 8) * unit, at.y + rand(-6, 6) * unit, GLOW_KEY));
    puff.setTint(i % 2 ? 0x8a7d9a : 0x5c4f6b).setScale(0.35 * unit).setAlpha(0.6);
    scene.tweens.add({
      targets: puff, y: puff.y - rand(14, 40) * unit, x: puff.x + rand(-20, 20) * unit, scale: rand(0.7, 1.1) * unit, alpha: 0,
      duration: between(380, 620), ease: "Cubic.easeOut", onComplete: () => puff.destroy(),
    });
  }
}

// ---- the shield: a curved pane of light in front of the boss, with a glint running across it ----
// options: at {x, y} (the middle of the boss, in layer coordinates), height (of the boss, in layer
// units), layer, lands (false: it was beaten, so it cracks and shatters).
export function shieldGlint(scene, options) {
  ensureGlowTexture(scene);
  const { layer = null, lands = true, at } = options;
  const h = options.height || 300;
  const w = h * 0.62;
  const cx = at.x - w * 0.18;              // a little toward the plant, on the left
  const pane = put(scene, layer, scene.add.graphics({ x: cx, y: at.y }));
  const drawPane = (alpha) => {
    pane.clear();
    pane.fillStyle(0xfff3d6, 0.16 * alpha);
    pane.fillEllipse(0, 0, w, h);
    pane.lineStyle(Math.max(2, h * 0.012), 0xffe2b8, 0.9 * alpha);
    pane.strokeEllipse(0, 0, w, h);
    pane.lineStyle(Math.max(1, h * 0.006), 0xffffff, 0.6 * alpha);
    pane.strokeEllipse(0, 0, w * 0.82, h * 0.86);
  };
  drawPane(1);
  pane.setScale(0.7, 0.85).setAlpha(0);
  scene.tweens.add({ targets: pane, scaleX: 1, scaleY: 1, alpha: 1, duration: 110, ease: "Back.easeOut" });

  // the glint: a bright slanted streak that sweeps across the pane
  const streak = put(scene, layer, scene.add.rectangle(cx - w * 0.45, at.y, w * 0.09, h * 0.9, 0xffffff, 0.85));
  streak.setRotation(0.35).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
  scene.tweens.add({ targets: streak, x: cx + w * 0.45, alpha: { from: 0.95, to: 0 }, delay: 70, duration: 240, ease: "Sine.easeInOut", onComplete: () => streak.destroy() });
  const star = put(scene, layer, scene.add.image(cx - w * 0.22, at.y - h * 0.28, GLOW_KEY)).setBlendMode(Phaser.BlendModes.ADD).setScale(0.1);
  scene.tweens.add({ targets: star, scale: h * 0.006, alpha: 0, delay: 90, duration: 260, ease: "Quad.easeOut", onComplete: () => star.destroy() });

  if (lands) {
    scene.tweens.add({ targets: pane, alpha: 0, delay: 300, duration: 260, onComplete: () => pane.destroy() });
    return;
  }
  // beaten: cracks run across it, then it falls apart in shards
  scene.time.delayedCall(150, () => {
    pane.lineStyle(Math.max(2, h * 0.01), 0x3a1320, 0.85);
    for (let i = 0; i < 5; i++) {
      const angle = rand(0, Math.PI * 2);
      pane.lineBetween(0, 0, Math.cos(angle) * w * 0.48, Math.sin(angle) * h * 0.48);
    }
  });
  scene.time.delayedCall(240, () => {
    pane.destroy();
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      const sx = cx + Math.cos(angle) * w * 0.45;
      const sy = at.y + Math.sin(angle) * h * 0.45;
      const s = h * rand(0.03, 0.06);
      const shard = put(scene, layer, scene.add.triangle(sx, sy, 0, 0, s, s * 0.3, s * 0.2, s * 1.2, i % 2 ? 0xfff3d6 : 0xffe2b8, 0.85));
      shard.setRotation(rand(0, 3));
      scene.tweens.add({
        targets: shard, x: sx + Math.cos(angle) * h * 0.25, y: sy + h * rand(0.15, 0.4), rotation: shard.rotation + rand(-5, 5), alpha: 0,
        duration: between(380, 620), ease: "Quad.easeIn", onComplete: () => shard.destroy(),
      });
    }
  });
}

// ---- the bite: jaws of light snapping shut on the target, or a clink where the bite was stopped ----
// options: at {x, y} in layer coordinates, size (layer units), layer, lands.
export function biteSnap(scene, options) {
  ensureGlowTexture(scene);
  const { layer = null, lands = true, at } = options;
  const size = options.size || 60;
  if (lands) {
    // two rows of teeth that slam together
    for (const side of [-1, 1]) {
      const jaw = put(scene, layer, scene.add.graphics({ x: at.x, y: at.y + side * size * 0.55 }));
      jaw.fillStyle(0xfff6e0, 1);
      for (let i = -2; i <= 2; i++) {
        const x = i * size * 0.22;
        jaw.fillTriangle(x - size * 0.1, 0, x + size * 0.1, 0, x, -side * size * 0.3);
      }
      jaw.setAlpha(0.95);
      scene.tweens.add({ targets: jaw, y: at.y + side * size * 0.12, duration: 70, ease: "Quad.easeIn" });
      scene.tweens.add({ targets: jaw, alpha: 0, scaleX: 1.25, delay: 110, duration: 180, onComplete: () => jaw.destroy() });
    }
    const flash = put(scene, layer, scene.add.image(at.x, at.y, GLOW_KEY)).setTint(0xffd9a0).setBlendMode(Phaser.BlendModes.ADD).setScale(size * 0.012);
    scene.tweens.add({ targets: flash, scale: size * 0.04, alpha: 0, delay: 60, duration: 220, ease: "Cubic.easeOut", onComplete: () => flash.destroy() });
    return;
  }
  // blocked: a cold clink star and a few sparks glancing off
  const star = put(scene, layer, scene.add.star(at.x, at.y, 4, size * 0.08, size * 0.42, 0xe8f0ff, 1)).setRotation(0.4).setScale(0.3);
  scene.tweens.add({ targets: star, scale: 1, alpha: 0, rotation: 0.9, duration: 240, ease: "Cubic.easeOut", onComplete: () => star.destroy() });
  for (let i = 0; i < 6; i++) {
    const spark = put(scene, layer, scene.add.rectangle(at.x, at.y, size * 0.16, size * 0.04, i % 2 ? 0xffffff : 0xb8c8e8));
    const angle = rand(-0.9, 0.9);          // glancing back toward the boss, on the right
    spark.setRotation(angle);
    scene.tweens.add({
      targets: spark, x: at.x + Math.cos(angle) * size * rand(0.6, 1.2), y: at.y + Math.sin(angle) * size * rand(0.6, 1.2),
      alpha: 0, scaleX: 0.3, duration: between(180, 300), ease: "Quad.easeOut", onComplete: () => spark.destroy(),
    });
  }
}
