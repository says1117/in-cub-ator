// client/src/render/bossEntrance.js: How a boss arrives in the forest. Owner: Role 3 (client, art, demo).
// It is spotted deep in the forest and comes toward the camera in two bounds, each one bigger
// and lower on screen, then lands with impact frames in a clearing further back than the dragon.
// The dragon turns its back to us to face it, the same view the battle screen opens on.
// The boss roars at it, and AdventureScene then cuts to that screen.
//
// The boss is one flat picture while it is in the air. Once it has landed, a boss that has a rig
// (render/bossRig.js) is swapped for its moving version, so it sways and can open its mouth.
//
// What makes it read as depth and not as a sideways jump: it grows as it comes closer, far away
// it is dim and blue, each landing spot is lower on screen, its shadow lies flat on the ground,
// and the dust and shockwave grow as they roll toward the camera and pass under the dragon.
// The landing also wrecks the ground around it: a crater, plants and rocks thrown clear, clods of
// earth flying past the camera, the trees shuddering and dropping their petals.
//
// Everything this file creates or moves is undone by cleanup(), so the walk can carry on after.
//
// onStep(step, state) is called as it goes, so others can react (the plants in render/petParade.js do):
// "spotted", "impact", "faceoff", "roar", and "reset" when everything has been put back.
import { audio } from "../audio.js";
import Phaser from "phaser";
import { bossArt } from "../data/bosses.js";
import { createBossRig, hasBossRig } from "./bossRig.js";
import { ensureDragonBackTexture, DRAGON_BACK_KEY } from "./dragonBack.js";

// The three places it touches the ground, from far to near. size is a share of full size.
const FAR = { x: 458, y: 262, size: 0.14 };   // first seen, deep between the trees
const MID = { x: 478, y: 304, size: 0.44 };   // first bound, at the edge of the trees
const LAND = { x: 452, y: 333, size: 1 };     // up in the grass, well behind the dragon
const FAR_SCALE = FAR.size;
const SKID = 9;                   // how far the landing shoves the dragon
const BOSS_DEPTH = 7;             // in front of the bushes (6), behind the dragon (9, 10)
const OVERLAY_DEPTH = 40;         // above the vignette (19) and the scene's own text (21)

export function createBossEntrance(scene, onStep = () => {}) {
  const made = [];     // display objects to destroy
  const tweens = [];
  const timers = [];
  let active = false;
  let done = false;
  let boss = null;
  let homeX = scene.player.x; // where the dragon stands when nothing is pushing it
  let back = null;            // the dragon seen from behind, shown once it has turned around
  const wrecked = [];         // plants and rocks the landing threw clear, put back afterwards
  let debris = [];            // clods of earth, frozen in the air during the impact frames
  let felled = null;          // the tree the landing snapped, mended afterwards

  const dragonParts = () => [scene.footL, scene.footR, scene.player];
  const groundY = () => scene.basePlayerY;
  const LAND_X = LAND.x;

  const keep = (object) => {
    made.push(object);
    return object;
  };
  const tween = (config) => {
    const t = scene.tweens.add(config);
    tweens.push(t);
    return t;
  };
  const after = (ms, fn) => {
    timers.push(scene.time.delayedCall(ms, () => active && fn()));
  };

  const silhouette = (color) => {
    for (const part of [boss, ...dragonParts()]) {
      part.setTint(color).setTintMode(Phaser.TintModes.FILL);
    }
    for (const clod of debris) clod.shape.setFillStyle(color);
  };
  const clearSilhouette = () => {
    for (const part of [boss, ...dragonParts()]) {
      if (part && part.active) part.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    }
  };

  function resetDragon() {
    if (!scene.player) return;
    scene.player.x = homeX;
    scene.footL.x = homeX;
    scene.footR.x = homeX;
    scene.footL.setDepth(9);
    scene.footR.setDepth(9);
    scene.player.setDepth(10);
    for (const part of dragonParts()) part.setVisible(true);
    scene.footL.setDisplaySize(scene.baseWidth, scene.baseHeight);
    scene.footR.setDisplaySize(scene.baseWidth, scene.baseHeight);
    scene.shadow.setVisible(true);
    scene.standStill();
  }

  function cleanup() {
    active = false;
    done = false;
    tweens.splice(0).forEach((t) => t.remove());
    timers.splice(0).forEach((t) => t.remove(false));
    clearSilhouette();
    made.splice(0).forEach((object) => object.destroy());
    boss = null;
    back = null;
    scene.cameras.main.resetFX();
    scene.cameras.main.setZoom(1);
    for (const w of wrecked.splice(0)) {
      w.sprite.setPosition(w.x, w.y).setRotation(w.rotation).setScale(w.scaleX, w.scaleY).setAlpha(w.alpha).setDepth(w.depth);
    }
    debris = [];
    mendTree();
    resetDragon();
    onStep("reset", scene.registry.get("serverState"));
  }

  // ---- the steps, in order ----

  function spotted(fullScale) {
    boss.setPosition(FAR.x, FAR.y).setScale(fullScale * FAR_SCALE).setDepth(3.5);
    boss.setTint(0x1a1030).setTintMode(Phaser.TintModes.FILL);

    // two red eyes glint in the dark between the trees
    for (const dx of [-2, 2]) {
      const eye = keep(scene.add.image(FAR.x + dx * 2 - 6, FAR.y - 11, "efGlow"));
      eye.setDepth(3.6).setTint(0xff3b3b).setBlendMode(Phaser.BlendModes.ADD).setScale(0.02);
      tween({ targets: eye, scale: 0.3, alpha: { from: 1, to: 0 }, duration: 560, ease: "Quad.easeOut" });
    }
    tween({ targets: boss, x: FAR.x + 2, duration: 60, yoyo: true, repeat: 5 });

    // the dragon notices: a "!" and a startled hop
    const mark = keep(scene.add.text(homeX + 4, groundY() - 132, "!", {
      fontFamily: "monospace", fontSize: "34px", fontStyle: "bold",
      color: "#fff2a8", stroke: "#3a1320", strokeThickness: 6,
    }).setOrigin(0.5).setDepth(22).setScale(0));
    tween({ targets: mark, scale: 1, duration: 160, ease: "Back.easeOut" });
    tween({ targets: mark, alpha: 0, y: mark.y - 10, delay: 620, duration: 200 });
    tween({ targets: dragonParts(), y: groundY() - 12, duration: 110, yoyo: true, ease: "Quad.easeOut" });
  }

  // One bound from one spot on the ground to the next, closer one.
  function bound(fullScale, from, to, duration, height, onLand) {
    const haze = Phaser.Display.Color.ValueToColor(0x6552b4);   // far things are dim and blue
    const clear = Phaser.Display.Color.ValueToColor(0xffffff);
    const path = { t: 0 };
    let ghostAt = 0;

    tween({
      targets: path,
      t: 1,
      duration,
      ease: "Sine.easeIn",
      onUpdate: () => {
        const t = path.t;
        // Perspective: something coming straight at you barely moves at first, then swells fast.
        const near = Math.pow(t, 2.2);
        const size = Phaser.Math.Linear(from.size, to.size, near);
        const groundX = Phaser.Math.Linear(from.x, to.x, t);
        const groundYNow = Phaser.Math.Linear(from.y, to.y, near);

        boss.x = groundX;
        boss.y = groundYNow - Math.sin(Math.PI * t) * height * size;
        boss.setScale(fullScale * size);
        boss.rotation = Math.sin(Math.PI * t) * -0.14;
        // it comes out in front of the tree lines as it gets closer
        boss.setDepth(size < 0.12 ? 3.5 : size < 0.5 ? 4.5 : BOSS_DEPTH);

        const mix = Phaser.Display.Color.Interpolate.ColorWithColor(haze, clear, 100, Math.min(100, Math.max(0, size - 0.14) * 150));
        boss.setTint(Phaser.Display.Color.GetColor(mix.r, mix.g, mix.b));

        // Its shadow stays flat on the ground below it: small and faint when it is high or far.
        const lift = Math.sin(Math.PI * t);
        landShadow.setPosition(groundX, groundYNow - 1).setDepth(boss.depth - 0.05);
        landShadow.setSize(150 * size * (1 - lift * 0.45), 18 * size * (1 - lift * 0.45));
        landShadow.setFillStyle(0x120a26, 0.5 * (1 - lift * 0.6) * Math.min(1, size * 2));

        // after-images trailing back into the distance, each smaller than the last
        if (t - ghostAt > 0.11 && size > 0.2) {
          ghostAt = t;
          const ghost = keep(scene.add.image(boss.x, boss.y, boss.texture.key).setOrigin(0.5, 0.93));
          ghost.setScale(boss.scaleX, boss.scaleY).setRotation(boss.rotation).setDepth(boss.depth - 0.1);
          ghost.setTint(0xc9b6ff).setTintMode(Phaser.TintModes.FILL).setAlpha(0.28);
          tween({ targets: ghost, alpha: 0, scale: ghost.scale * 0.8, duration: 260 });
        }
      },
      onComplete: () => {
        boss.setPosition(to.x, to.y).setScale(fullScale * to.size).setRotation(0);
        onLand();
      },
    });
  }

  let landShadow = null;

  function leap(fullScale, onLand) {
    landShadow = keep(scene.add.ellipse(FAR.x, FAR.y, 6, 2, 0x120a26, 0).setDepth(3.4));
    boss.setTintMode(Phaser.TintModes.MULTIPLY);

    // crouch, then the first bound: still far away, so it is small and the thud is small
    tween({ targets: boss, scaleY: boss.scaleY * 0.7, duration: 110, yoyo: true });
    after(230, () => bound(fullScale, FAR, MID, 500, 190, () => {
      scene.cameras.main.shake(140, 0.003);
      for (let i = 0; i < 6; i++) {
        const puff = keep(scene.add.image(MID.x + Phaser.Math.Between(-22, 22), MID.y - 2, "efGlow"));
        puff.setDepth(4.6).setTint(0xb9a8e0).setScale(0.12).setAlpha(0.6);
        tween({ targets: puff, y: puff.y - Phaser.Math.Between(6, 20), x: puff.x + Phaser.Math.Between(-24, 24), alpha: 0, scale: 0.3, duration: 420 });
      }
      // squash on landing, then spring straight into the second, much closer bound
      const s = boss.scaleX;
      tween({ targets: boss, scaleX: s * 1.2, scaleY: s * 0.72, duration: 70, yoyo: true });
      after(150, () => bound(fullScale, MID, LAND, 560, 140, () => {
        boss.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
        boss.setDepth(BOSS_DEPTH);
        onLand();
      }));
    }));
  }

  // Clods of earth, grass and stone torn out of the ground. They are made at the moment of
  // impact and hang in the air as cut-outs through the impact frames, then fly.
  function spawnDebris() {
    const colors = [0x3f7a3a, 0x2f5f33, 0x4a3327, 0x6b4a36, 0x8d86a8, 0xd07cf0];
    debris = [];
    for (let i = 0; i < 40; i++) {
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const toward = Math.sin(angle);              // 1 = at the camera, -1 = away from it
      const start = Phaser.Math.Between(26, 96);
      const size = Phaser.Math.Between(3, 9) * (1 + Math.max(0, toward) * 0.8);
      const x = LAND.x + Math.cos(angle) * start;
      const y = LAND.y - 8 + toward * start * 0.3 - Phaser.Math.Between(0, 46);
      const shape = keep(scene.add.rectangle(x, y, size, size * Phaser.Math.FloatBetween(0.6, 1.2), 0x000000));
      shape.setRotation(Phaser.Math.FloatBetween(0, 3)).setDepth(OVERLAY_DEPTH + 1.5);
      debris.push({
        shape, x, y, toward,
        color: colors[i % colors.length],
        vx: Math.cos(angle) * Phaser.Math.Between(120, 330),
        vy: -Phaser.Math.Between(170, 420),
        spin: Phaser.Math.FloatBetween(-9, 9),
      });
    }
  }

  // After the impact frames: the clods get their colours back and are thrown outward. Ones coming
  // at the camera grow, drop down the screen and pass in front of the dragon.
  function throwDebris() {
    const GRAVITY = 900;
    for (const clod of debris) {
      const { shape, toward } = clod;
      shape.setFillStyle(clod.color).setDepth(toward > 0.3 ? 11.7 : BOSS_DEPTH - 0.1);
      const flight = { t: 0 };
      const life = Phaser.Math.FloatBetween(0.6, 1.05);
      const scale0 = shape.scale;
      tween({
        targets: flight,
        t: life,
        duration: life * 1000,
        onUpdate: () => {
          const t = flight.t;
          shape.x = clod.x + clod.vx * t;
          shape.y = clod.y + clod.vy * t + 0.5 * GRAVITY * t * t + toward * 70 * t;
          shape.rotation += clod.spin * 0.016;
          shape.setScale(scale0 * (1 + toward * 0.9 * t));
          shape.setAlpha(Math.min(1, (life - t) * 5));
        },
        onComplete: () => shape.setVisible(false),
      });
    }
  }

  // The nearest big tree snaps a little above the roots. The stump stays, and the trunk and
  // crown topple away from the boss and hit the ground.
  function snapTree() {
    const life = scene.forestLife;
    if (!life) return;
    let tree = null;
    // Prefer a tree on the far side of the boss from the dragon, so it has room to fall.
    const score = (candidate) => {
      const dx = candidate.getX() - LAND.x;
      return Math.abs(dx) + (dx < 0 ? 90 : 0);
    };
    for (const candidate of life.trees) {
      if (!candidate.source) continue;   // only the trees along the path
      if (Math.abs(candidate.getX() - LAND.x) > 240) continue;
      if (!tree || score(candidate) < score(tree)) tree = candidate;
    }
    if (!tree) return;

    const base = tree.parts.find((part) => part.kind === "base").sprite;
    const width = base.width;
    const height = base.height;
    const stump = Math.round(tree.spec.height * 0.26);   // how much trunk is left standing

    base.setCrop(0, height - stump, width, stump);
    const top = scene.add.image(base.x, base.y, base.texture.key);
    top.setOrigin(0.5, (height - stump) / height).setScale(tree.scale).setFlipX(tree.flip).setDepth(tree.depth);
    top.setCrop(0, 0, width, height - stump);
    const part = { sprite: top, lx: 0, ly: -stump, kind: "top" };
    tree.parts.push(part);

    const x = tree.getX();
    // It falls away from the boss, unless that would drop it on the dragon. Then it goes over
    // backwards, behind the boss.
    const length = tree.spec.height * tree.scale * 1.3;
    const dir = x >= LAND.x || x - length < homeX + 50 ? 1 : -1;
    tree.broken = { angle: 0, pivotY: -stump };
    felled = { tree, base, part };

    // splinters at the break
    const breakY = tree.y - stump * tree.scale;
    for (let i = 0; i < 12; i++) {
      const chip = keep(scene.add.rectangle(x, breakY, Phaser.Math.Between(2, 5), Phaser.Math.Between(5, 13), i % 2 ? 0xd9b98a : 0x6b4a36));
      chip.setDepth(tree.depth + 0.5).setRotation(Phaser.Math.FloatBetween(0, 3));
      tween({
        targets: chip,
        x: x + Phaser.Math.Between(-70, 70),
        y: breakY - Phaser.Math.Between(10, 80),
        rotation: chip.rotation + Phaser.Math.FloatBetween(-6, 6),
        alpha: 0,
        duration: Phaser.Math.Between(380, 720),
        ease: "Quad.easeOut",
      });
    }

    // it leans slowly, then drops fast, then bounces once where it hits
    const flat = dir * 1.42;
    tween({
      targets: tree.broken,
      angle: flat,
      delay: 90,
      duration: 760,
      ease: "Cubic.easeIn",
      onComplete: () => {
        scene.cameras.main.shake(220, 0.008);
        tween({ targets: tree.broken, angle: flat - dir * 0.07, duration: 110, yoyo: true, ease: "Quad.easeOut" });
        const reach = (tree.spec.height - stump) * tree.scale;
        for (let i = 0; i < 16; i++) {
          const along = Phaser.Math.FloatBetween(0.25, 1.15);
          const puff = keep(scene.add.image(x + dir * reach * along, tree.y - 4, "efGlow"));
          puff.setDepth(tree.depth + 0.4).setTint(i % 3 ? 0xcfe9c0 : 0xe8c8ff).setScale(0.3).setAlpha(0.7);
          tween({ targets: puff, y: puff.y - Phaser.Math.Between(8, 46), x: puff.x + Phaser.Math.Between(-30, 30), scale: 0.75, alpha: 0, duration: Phaser.Math.Between(450, 900), ease: "Cubic.easeOut" });
        }
      },
    });
  }

  function mendTree() {
    if (!felled) return;
    const { tree, base, part } = felled;
    felled = null;
    tree.broken = null;
    base.setCrop();
    tree.parts.splice(tree.parts.indexOf(part), 1);
    part.sprite.destroy();
  }

  // The ground and everything growing near the landing spot.
  function wreckTerrain() {
    const y = LAND.y;
    const rand = Phaser.Math.FloatBetween;

    // crater: a dark gouge with a lit far rim and cracks running out of it. Everything is wide
    // and flat because the ground is seen at a shallow angle.
    const crater = keep(scene.add.graphics().setDepth(5.92));
    crater.fillStyle(0x140d22, 0.62);
    crater.fillEllipse(LAND.x, y + 2, 230, 40);
    crater.fillStyle(0x0b0716, 0.72);
    crater.fillEllipse(LAND.x, y + 4, 190, 32);
    crater.lineStyle(3, 0x86c06a, 0.7);       // torn turf catching the light on the far side
    crater.beginPath();
    for (let i = 0; i <= 20; i++) {
      const angle = Math.PI * (1.06 + (0.88 * i) / 20);
      const px = LAND.x + Math.cos(angle) * 116;
      const py = y + 2 + Math.sin(angle) * 20;
      if (i === 0) crater.moveTo(px, py);
      else crater.lineTo(px, py);
    }
    crater.strokePath();
    crater.lineStyle(2, 0x0b0716, 0.8);
    for (let i = 0; i < 13; i++) {
      const angle = (i / 13) * Math.PI * 2 + rand(-0.18, 0.18);
      const toward = Math.sin(angle);
      const reach = Phaser.Math.Between(120, 185) * (1 + Math.max(0, toward) * 0.5);
      let px = LAND.x + Math.cos(angle) * 100;
      let py = y + 3 + toward * 17;
      crater.beginPath();
      crater.moveTo(px, py);
      for (let step = 1; step <= 3; step++) {
        const r = 100 + ((reach - 100) * step) / 3;
        px = LAND.x + Math.cos(angle + rand(-0.07, 0.07)) * r;
        py = y + 3 + Math.sin(angle) * r * 0.2 + rand(-1.5, 1.5);
        crater.lineTo(px, py);
      }
      crater.strokePath();
    }
    crater.setAlpha(0);
    tween({ targets: crater, alpha: 1, duration: 90 });

    // plants, rocks and crystals nearby are ripped out and thrown clear
    for (const item of scene.decorations || []) {
      const sprite = item.sprite;
      const dx = sprite.x - LAND.x;
      if (item.type === "tree") {
        // trees are too big to throw: they shudder, more the closer they are
        if (Math.abs(dx) > 320) continue;
        wrecked.push({ sprite, x: sprite.x, y: sprite.y, rotation: sprite.rotation, scaleX: sprite.scaleX, scaleY: sprite.scaleY, alpha: sprite.alpha, depth: sprite.depth });
        const shake = 7 * (1 - Math.abs(dx) / 340);
        tween({ targets: sprite, x: sprite.x + shake, duration: 45, yoyo: true, repeat: 7 });
        continue;
      }
      if (Math.abs(dx) > 165) continue;
      wrecked.push({ sprite, x: sprite.x, y: sprite.y, rotation: sprite.rotation, scaleX: sprite.scaleX, scaleY: sprite.scaleY, alpha: sprite.alpha, depth: sprite.depth });
      const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(dx);
      const far = 1 - Math.abs(dx) / 190;
      const time = Phaser.Math.Between(520, 820);
      sprite.setDepth(11.6);   // thrown toward us, past the dragon
      tween({ targets: sprite, x: sprite.x + dir * Phaser.Math.Between(90, 230) * (0.5 + far), rotation: dir * rand(2.5, 6), duration: time, ease: "Quad.easeOut" });
      tween({ targets: sprite, y: sprite.y - Phaser.Math.Between(50, 130) * (0.5 + far), duration: time * 0.42, ease: "Quad.easeOut", yoyo: true });
      tween({ targets: sprite, scaleX: sprite.scaleX * 1.35, scaleY: sprite.scaleY * 1.35, alpha: 0, duration: time, ease: "Quad.easeIn" });
    }

    // petals shaken out of the canopy drift down over the wreck
    for (let i = 0; i < 26; i++) {
      const petal = keep(scene.add.image(LAND.x + Phaser.Math.Between(-260, 260), Phaser.Math.Between(70, 230), "efPetal"));
      petal.setTint(i % 3 ? 0xbb9df7 : 0xf1b4f4).setDepth(i % 4 ? 7.5 : 12).setAlpha(0).setScale(rand(0.9, 1.7));
      const fall = Phaser.Math.Between(1300, 2300);
      tween({ targets: petal, alpha: { from: 0.95, to: 0 }, y: petal.y + Phaser.Math.Between(120, 220), x: petal.x - Phaser.Math.Between(10, 70), rotation: rand(-6, 6), delay: Phaser.Math.Between(0, 350), duration: fall, ease: "Sine.easeIn" });
    }

    throwDebris();
    snapTree();
  }

  function impact(fullScale) {
    const cam = scene.cameras.main;
    const y = LAND.y;

    const screen = keep(scene.add.rectangle(400, 225, 800, 450, 0xffffff).setDepth(OVERLAY_DEPTH));
    const lines = keep(scene.add.graphics().setDepth(OVERLAY_DEPTH + 0.5).setVisible(false));
    lines.fillStyle(0xffffff, 1);
    for (let i = 0; i < 26; i++) {
      const angle = (i / 26) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.08, 0.08);
      const near = Phaser.Math.Between(70, 150);
      const spread = Phaser.Math.FloatBetween(0.012, 0.04);
      lines.fillTriangle(
        LAND_X + Math.cos(angle) * near, y - 30 + Math.sin(angle) * near,
        LAND_X + Math.cos(angle - spread) * 900, y - 30 + Math.sin(angle - spread) * 900,
        LAND_X + Math.cos(angle + spread) * 900, y - 30 + Math.sin(angle + spread) * 900
      );
    }

    // lift the two fighters above the overlay so they read as cut-outs
    boss.setDepth(OVERLAY_DEPTH + 1);
    dragonParts().forEach((part, i) => part.setDepth(OVERLAY_DEPTH + 2 + i * 0.1));
    scene.shadow.setVisible(false);
    boss.setScale(fullScale * 1.18, fullScale * 0.78); // squashed by the landing
    spawnDebris();

    // frame 1: white screen, black cut-outs
    silhouette(0x000000);
    // frame 2: inverted, with speed lines
    after(75, () => {
      screen.setFillStyle(0x000000);
      silhouette(0xffffff);
      lines.setVisible(true);
    });
    // frame 3: white flash
    after(150, () => {
      screen.setFillStyle(0xffffff);
      lines.setVisible(false);
      silhouette(0x000000);
    });
    // hit-stop, then the world comes back shaking
    after(205, () => {
      screen.setFillStyle(0xffffff, 0.6);
      clearSilhouette();
      boss.setDepth(BOSS_DEPTH);
      scene.footL.setDepth(9);
      scene.footR.setDepth(9);
      scene.player.setDepth(10);
      scene.shadow.setVisible(true);
    });
    after(320, () => {
      tween({ targets: screen, alpha: 0, duration: 180 });
      cam.shake(520, 0.02);
      audio.play("land");
      onStep("impact");
      wreckTerrain();
      // a quick push-in, as if the landing rocked the camera
      tween({ targets: cam, zoom: 1.07, duration: 90, yoyo: true, ease: "Quad.easeOut" });
      tween({ targets: boss, scaleX: fullScale, scaleY: fullScale, duration: 420, ease: "Elastic.easeOut" });

      // It now stands on the ground: a dark patch right under it and a longer shadow thrown
      // toward the camera.
      landShadow.setPosition(LAND_X, y - 2).setSize(150, 20).setFillStyle(0x120a26, 0.55).setDepth(BOSS_DEPTH - 0.05);
      const cast = keep(scene.add.ellipse(LAND_X - 14, y + 9, 170, 30, 0x120a26, 0).setDepth(5.95));
      tween({ targets: cast, fillAlpha: 0.2, duration: 300 });

      // Shockwave rings lying flat on the ground. They spread toward the camera, so the near
      // edge travels further down the screen than the far edge travels up, and passes under
      // the dragon.
      for (let i = 0; i < 3; i++) {
        const ring = keep(scene.add.ellipse(LAND_X, y, 70, 14).setDepth(5.97));
        ring.setStrokeStyle(3, 0xfff3d6, 0.85).setFillStyle(0xffffff, 0);
        tween({ targets: ring, scaleX: 8.5, scaleY: 9, y: y + 34, alpha: 0, delay: i * 120, duration: 700, ease: "Cubic.easeOut" });
      }

      // Dust thrown outward. Puffs that fly toward the camera grow and drop down the screen
      // and end up in front of the dragon. Puffs that fly away shrink and stay behind it.
      for (let i = 0; i < 26; i++) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const toward = Math.sin(angle);            // 1 = straight at the camera, -1 = straight away
        const reach = Phaser.Math.Between(60, 190);
        const puff = keep(scene.add.image(LAND_X + Math.cos(angle) * 30, y - 2, "efGlow"));
        puff.setTint(i % 3 ? 0xcfe9c0 : 0xfff3d6).setScale(0.3).setAlpha(Phaser.Math.FloatBetween(0.4, 0.75));
        puff.setDepth(toward > 0.35 ? 11.6 : BOSS_DEPTH - 0.2);
        tween({
          targets: puff,
          x: LAND_X + Math.cos(angle) * reach,
          y: y + toward * reach * 0.42 - Phaser.Math.Between(4, 26),
          scale: 0.3 * (1 + toward * 0.9) + 0.25,
          alpha: 0,
          duration: Phaser.Math.Between(480, 950),
          ease: "Cubic.easeOut",
        });
      }

      // the blast shoves the dragon away from it, heels digging in
      tween({
        targets: [...dragonParts(), scene.shadow],
        x: homeX - SKID,
        duration: 300,
        ease: "Cubic.easeOut",
      });
      tween({ targets: scene.player, rotation: -0.09, duration: 150, yoyo: true });
      after(380, turnAround);
    });
  }

  // The dragon spins on the spot to face the boss, which leaves its back to the camera.
  function turnAround() {
    const parts = dragonParts();
    const x = homeX - SKID;
    ensureDragonBackTexture(scene);

    tween({
      targets: parts,
      scaleX: 0,
      duration: 110,
      ease: "Quad.easeIn",
      onComplete: () => {
        for (const part of parts) part.setVisible(false);
        back = keep(scene.add.image(x, groundY(), DRAGON_BACK_KEY).setOrigin(0.5, 1).setDepth(10));
        // a touch bigger than the side view: it is the one closest to us
        const scale = (scene.baseHeight * 1.06) / back.height;
        back.setScale(0, scale);
        tween({ targets: back, scaleX: scale, duration: 130, ease: "Back.easeOut" });
        // a little settle as its feet plant
        tween({ targets: back, y: groundY() - 5, duration: 90, yoyo: true, delay: 130 });
      },
    });
  }

  function faceOff(state, fullScale) {
    onStep("faceoff", state);
    // cinema bars
    const top = keep(scene.add.rectangle(400, -23, 800, 46, 0x07051a).setDepth(30));
    const bottom = keep(scene.add.rectangle(400, 473, 800, 46, 0x07051a).setDepth(30));
    tween({ targets: top, y: 23, duration: 260, ease: "Cubic.easeOut" });
    tween({ targets: bottom, y: 427, duration: 260, ease: "Cubic.easeOut" });

    // the boss rears up and roars
    const art = bossArt((state.boss && state.boss.tier) || 1);
    let mouth = () => ({ x: LAND_X - 62, y: LAND.y - 56 });
    let roarDelay = 0;
    if (hasBossRig(scene, art)) {
      // from here on it is the moving version: the middle head lifts, opens and roars
      const rig = keep(createBossRig(scene, art, boss.x, boss.y, art.height).setDepth(BOSS_DEPTH));
      boss.setVisible(false);
      rig.roar();
      mouth = rig.mouthPoint;
      roarDelay = 400;   // the mouth is open by then
      tween({ targets: rig, x: LAND_X - 3, delay: roarDelay, duration: 45, yoyo: true, repeat: 13 });
    } else {
      tween({ targets: boss, scaleX: fullScale * 1.12, scaleY: fullScale * 1.12, duration: 170, yoyo: true, repeat: 1 });
      tween({ targets: boss, x: LAND_X - 3, duration: 45, yoyo: true, repeat: 9 });
    }
    after(roarDelay, () => {
      onStep("roar", state);
      const from = mouth();
      for (let i = 0; i < 5; i++) {
        // the roar rolls out of its mouth toward the dragon and the camera
        const roar = keep(scene.add.ellipse(from.x, from.y, 22, 30).setDepth(11.4));
        roar.setStrokeStyle(2, i % 2 ? 0xffd9a0 : 0xffffff, 0.85).setFillStyle(0xffffff, 0);
        tween({ targets: roar, x: homeX + 30, y: groundY() - 50, scaleX: 5.2, scaleY: 5.2, alpha: 0, delay: i * 130, duration: 560, ease: "Quad.easeIn" });
      }
      // spit and torn petals fly out with it
      for (let i = 0; i < 14; i++) {
        const fleck = keep(scene.add.rectangle(from.x, from.y, Phaser.Math.Between(2, 5), Phaser.Math.Between(2, 5), i % 3 ? 0xff5a6a : 0xfff0c0));
        fleck.setDepth(11.5).setRotation(Phaser.Math.FloatBetween(0, 3));
        tween({
          targets: fleck,
          x: from.x - Phaser.Math.Between(60, 230),
          y: from.y + Phaser.Math.Between(-30, 110),
          rotation: fleck.rotation + Phaser.Math.FloatBetween(-5, 5),
          alpha: 0,
          delay: Phaser.Math.Between(0, 520),
          duration: Phaser.Math.Between(320, 620),
          ease: "Quad.easeOut",
        });
      }
      // the forest darkens and shudders while it roars
      const dread = keep(scene.add.rectangle(400, 225, 800, 450, 0x2a0410, 0).setDepth(18.5));
      tween({ targets: dread, fillAlpha: 0.34, duration: 160, yoyo: true, hold: 420 });
      scene.cameras.main.shake(roarDelay ? 680 : 300, roarDelay ? 0.011 : 0.006);
      audio.play("roar");
    });

    // the dragon braces: a small hop toward it
    after(260 + roarDelay, () => {
      if (back) tween({ targets: back, y: groundY() - 9, x: back.x + 4, duration: 120, yoyo: true, ease: "Quad.easeOut" });
    });
    // the camera leans in on the two of them
    tween({ targets: scene.cameras.main, zoom: 1.08, delay: 300, duration: 900, ease: "Sine.easeInOut" });

    // slanted name plate
    const name = String((state.boss && state.boss.name) || "Boss").toUpperCase();
    const tier = (state.boss && state.boss.tier) || 1;
    const plate = keep(scene.add.container(980, 96).setDepth(31));
    const shape = scene.add.graphics();
    shape.fillStyle(0x07051a, 0.92);
    shape.fillPoints([{ x: -150, y: -24 }, { x: 160, y: -24 }, { x: 142, y: 24 }, { x: -168, y: 24 }], true);
    shape.fillStyle(0xff5a6a, 1);
    shape.fillPoints([{ x: -150, y: -24 }, { x: -140, y: -24 }, { x: -158, y: 24 }, { x: -168, y: 24 }], true);
    const title = scene.add.text(-128, -19, name, {
      fontFamily: "monospace", fontSize: "20px", fontStyle: "bold", color: "#ffffff",
    });
    const sub = scene.add.text(-134, 5, `DROUGHT BOSS  •  TIER ${tier}`, {
      fontFamily: "monospace", fontSize: "11px", color: "#ffb8c0",
    });
    plate.add([shape, title, sub]);
    tween({ targets: plate, x: 566, delay: 120, duration: 300, ease: "Cubic.easeOut" });
  }

  // ---- public ----

  function start(state) {
    if (active) return;
    const tier = (state && state.boss && state.boss.tier) || 1;
    const art = bossArt(tier);
    if (!scene.textures.exists(art.key)) {
      // no picture to show: skip straight to the cut
      active = true;
      done = true;
      return;
    }

    active = true;
    done = false;
    homeX = scene.player.x;

    ensureDragonBackTexture(scene);
    boss = keep(scene.add.image(FAR.x, FAR.y, art.key).setOrigin(0.5, 0.93));
    const fullScale = art.height / boss.height;

    spotted(fullScale);
    onStep("spotted", state);
    after(560, () => leap(fullScale, () => {
      impact(fullScale);
      after(950, () => faceOff(state, fullScale));
      after(2500, () => { done = true; });
    }));
  }

  return {
    start,
    cleanup,
    cancel: cleanup,
    isActive: () => active,
    isDone: () => active && done,
  };
}
