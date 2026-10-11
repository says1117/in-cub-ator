// client/src/battle/arena.js: The battle screen's backdrop, made from the forest's own paintings. Owner: Role 3.
// The fight happens right where the boss landed, so the battle reuses the enchanted forest's
// layers (theme/enchantedForest.js) seen closer up: the sky and its light shafts, the far trees,
// the glowing undergrowth, the hedge, the path and the pond, wisteria hanging from above.
//
// It is painted once into one 1280 x 720 picture and kept in the texture manager, so every later
// fight costs nothing to set up and the backdrop is a single draw each frame.
import Phaser from "phaser";
import { paintEnchantedForest } from "../theme/enchantedForest.js";

export const ARENA_KEY = "battleArena";
const W = 1280;
const H = 720;

// The forest's layout (800 x 450) mapped onto the battle stage, closer up: forest y -> stage y.
// The top of the forest's ground (y 320) lands at GROUND_Y, everything scaled by ZOOM around it.
const ZOOM = 1.9;
export const GROUND_Y = 430;
const stageY = (forestY) => (forestY - 320) * ZOOM + GROUND_Y;

export function ensureArenaTexture(scene) {
  if (scene.textures.exists(ARENA_KEY)) return ARENA_KEY;
  if (!scene.textures.exists("ground")) paintEnchantedForest(scene);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const src = (key) => (scene.textures.exists(key) ? scene.textures.get(key).getSourceImage() : null);

  // A layer that repeats sideways, drawn `zoom` times bigger with its top at y, shifted by `shift`.
  const band = (key, y, zoom, { shift = 0, alpha = 1 } = {}) => {
    const img = src(key);
    if (!img) return;
    const w = img.width * zoom;
    const h = img.height * zoom;
    ctx.globalAlpha = alpha;
    for (let x = -((shift % w) + w) % w; x < W; x += w) ctx.drawImage(img, x, y, w, h);
    ctx.globalAlpha = 1;
  };
  // One picture standing on (x, baseY), drawn `zoom` times bigger.
  const stand = (key, x, baseY, zoom, { flip = false, alpha = 1 } = {}) => {
    const img = src(key);
    if (!img) return;
    const w = img.width * zoom;
    const h = img.height * zoom;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, baseY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  };

  // Sky: the whole painted sky, wisteria fringe and all
  const sky = src("autumnSky");
  if (sky) ctx.drawImage(sky, 0, 0, W, H);

  // Far trees, undergrowth with its glowing mushrooms, the flowering hedge
  band("farMountains", stageY(75), ZOOM * 0.9, { shift: 180, alpha: 0.95 });
  band("farForest", stageY(190), ZOOM, { shift: 420 });

  // Mist settling where the undergrowth meets the hedge
  const mist = src("efMist");
  if (mist) { ctx.globalAlpha = 0.55; ctx.drawImage(mist, 0, stageY(292), W, mist.height * 1.6); ctx.globalAlpha = 1; }

  // Two big wisteria trees frame the clearing, standing in the grass behind the path
  stand("tree", 40, stageY(338), 3.1);
  stand("efTree2", 1250, stageY(340), 3.2, { flip: true });
  stand("efTree3", 660, stageY(332), 1.5, { alpha: 0.9 });

  band("nearForest", stageY(225), ZOOM, { shift: 260 });

  // The ground: grass edge, the stepping-stone path, the pond. The pond carries on to the bottom.
  const ground = src("ground");
  if (ground) {
    band("ground", GROUND_Y, ZOOM, { shift: 300 });
    const below = GROUND_Y + ground.height * ZOOM;
    if (below < H) {
      const w = ground.width * ZOOM;
      for (let x = -300; x < W; x += w) ctx.drawImage(ground, 0, ground.height - 14, ground.width, 14, x, below - 2, w, H - below + 2);
    }
  }

  // A few of the forest's own things, on the grass line, away from the fighters
  stand("efCrystal", 1190, stageY(336), 1.8);
  stand("grass", 560, stageY(334), 1.25);
  stand("efRune2", 1080, stageY(330), 1.4, { alpha: 0.95 });
  stand("efBoulder", 300, stageY(338), 1.6);
  stand("efFern", 760, stageY(338), 1.5);

  // Wisteria hanging into the top of the picture
  [["cloud1", 70, 1.5], ["cloud2", 340, 1.35], ["cloud3", 610, 1.55], ["cloud1", 880, 1.4], ["cloud2", 1170, 1.5]]
    .forEach(([key, x, zoom], i) => {
      const img = src(key);
      if (img) ctx.drawImage(img, x - (img.width * zoom) / 2, -40 - (i % 2) * 22, img.width * zoom, img.height * zoom);
    });

  // Light shafts and the vignette, as in the forest
  const rays = src("efRays");
  if (rays) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.28; ctx.drawImage(rays, 0, 0, W, H); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; }
  const vignette = src("efVignette");
  if (vignette) { ctx.globalAlpha = 0.85; ctx.drawImage(vignette, 0, 0, W, H); ctx.globalAlpha = 1; }

  const texture = scene.textures.addCanvas(ARENA_KEY, canvas);
  if (texture && texture.setFilter) texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  return ARENA_KEY;
}

// Soft fireflies drifting over the clearing, as in the forest. Cheap: a dozen sprites on slow tweens.
export function addFireflies(scene, layer, count = 14) {
  if (!scene.textures.exists("efGlow")) return [];
  const flies = [];
  for (let i = 0; i < count; i++) {
    const x = Phaser.Math.Between(40, W - 40);
    const y = Phaser.Math.Between(160, 520);
    const fly = scene.add.image(x, y, "efGlow").setBlendMode(Phaser.BlendModes.ADD)
      .setScale(Phaser.Math.FloatBetween(0.18, 0.4)).setAlpha(0).setTint(i % 3 ? 0xb8fff0 : 0xe6c8ff);
    layer.add(fly);
    const wander = () => {
      if (!fly.active) return;
      scene.tweens.add({
        targets: fly,
        x: Phaser.Math.Clamp(fly.x + Phaser.Math.Between(-90, 90), 20, W - 20),
        y: Phaser.Math.Clamp(fly.y + Phaser.Math.Between(-60, 60), 120, 560),
        alpha: Phaser.Math.FloatBetween(0.25, 0.8),
        duration: Phaser.Math.Between(2600, 4800),
        ease: "Sine.easeInOut",
        onComplete: wander,
      });
    };
    wander();
    flies.push(fly);
  }
  return flies;
}
