// client/src/render/bossTellFx.js: The boss rig's own small effects: the sparks it gathers while it shows a special. Owner: Role 3.
// render/bossRig.js uses these for its intent poses (rig.setIntent). The boss's actual moves are
// drawn by render/bossFx.js.
//
//   createChargeSparks(scene, parent)   sparks that gather at the mouth while it charges (lives in the rig)
//
// Positions are in the `layer` given (for the battle screen, the 1280 x 720 stage). Without a layer
// things go straight into the scene, in its own coordinates. Everything made here destroys itself.
// Movement runs on the scene's tweens and clock, so a hit-stop (timeScale 0) freezes it too.
import Phaser from "phaser";

const rand = Phaser.Math.FloatBetween;
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
