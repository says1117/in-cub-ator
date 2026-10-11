import Phaser from "phaser";
import { bossArt, bossMove, bossPalette, preloadBossArt } from "../data/bosses.js";
import { createBossRig, hasBossRig } from "../render/bossRig.js";
import { PLANTS, PLANT_IDS, plantMove, preloadPlantArt } from "../data/plants.js";
import { createPlantRig } from "../render/plantRig.js";
import { playBattleFx } from "../render/battleFx.js";
import { playBossFx } from "../render/bossFx.js";
import { createFxKit } from "../render/fxKit.js";
import { createBattleHud } from "../ui/battleHud.js";
import { ensureDragonBackTexture, DRAGON_BACK_KEY } from "../render/dragonBack.js";
import { createCastShadow, outlineOfPicture, BATTLE_LIGHT } from "../render/castShadow.js";
import { audio } from "../audio.js";

const ENEMY_HEIGHT = 330;   // how tall the tier 1 boss is drawn here, roots included

// Where everyone stands on the 1280 x 720 stage. size is a share of the plant picture's own size.
const FIGHTER = { x: 405, y: 550, size: 1.5 };     // the plant that is fighting
const BENCH = { x: 228, y: 562, size: 0.62 };      // the plant waiting its turn, or resting after it fainted
const TRAINER = { x: 98, y: 568, height: 196 };    // the dragon, who sends the plants in
const BOSS = { x: 905, y: 458 };                   // the spot the boss stands on

const FOREST_KEY = "battle-forest";   // the battle's forest, flattened into one picture: see bakeForest()

const CALL = 800;         // ms a line such as "EMBER used VINE HAYMAKER!" is up before the move starts
const PAUSE = 650;        // ms of quiet after one side's move before the other is called
const BOSS_BLOW = 620;    // about how long the boss's move takes to arrive

export default class BossScene extends Phaser.Scene {
  constructor() {
    super({ key: "BossScene" });
  }

  preload() {
    preloadBossArt(this);
    preloadPlantArt(this);
  }

  create() {
    this.W = 1280;
    this.H = 720;

    this.cameras.main.setBackgroundColor("#477da9");

    this.serverState = null;
    this.lastBattle = null;
    this.resultShownAt = 0;
    this.result = null;
    this.leaving = false;
    this.rewardTimer = null;
    this.resultText = null;   // left over from the last fight otherwise: this scene object is reused
    this.rewardBar = null;
    this.rewardLabel = null;
    this.activeId = null;     // which plant is up front
    this.busyUntil = 0;       // no new move is sent while a turn is still playing out
    this.hold = null;         // the health shown while a turn plays out: see refreshHud()
    this.chosen = null;       // the move just sent, until the server answers
    this.resultPanel = null;
    this.enemyTier = null;

    // One root container controls scaling.
    this.root = this.add.container(0, 0);

    this.skyLayer = this.add.container(0, 0);
    this.forestLayer = this.add.container(0, 0);
    this.auraLayer = this.add.container(0, 0);
    this.actorLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.effectLayer = this.add.container(0, 0);
    this.root.add([
      this.skyLayer,
      this.forestLayer,
      this.auraLayer,
      this.actorLayer,
      this.uiLayer,
      this.effectLayer
    ]);

    this.buildWorld();
    this.bakeForest();
    this.buildActors();
    // effects are drawn behind the fighters (over the world) and in front of everything
    this.kit = createFxKit(this, { back: this.auraLayer, front: this.effectLayer });
    this.hud = createBattleHud(this, { ui: this.uiLayer, fx: this.effectLayer, scale: this.W / this.scale.width });
    this.hud.onPick = (move) => this.pickMove(move);
    // a new wind-up: the surer the tell, the steadier its sound; the boss leans in for a heavy one
    this.hud.onTell = (tell) => {
      audio.play(tell.heavy ? "heavy" : { sure: "tellSure", likely: "tellLikely", flip: "tellFlip" }[tell.grade] || "tellSure");
      if (tell.heavy && this.enemySprite.roar) this.enemySprite.roar();
    };
    this.waterPlayed = false;
    audio.setRage(false);
    audio.music("battle");
    this.hud.log("Waiting for a boss...");
    // the forest's own meters and button stay out of the way while the battle screen is up
    document.getElementById("hud")?.classList.add("in-battle");

    this.scale.on("resize", this.onResize, this);
    this.stateListener = (_parent, state) => this.applyServerState(state);
    this.registry.events.on("changedata-serverState", this.stateListener);
    this.keys = this.input.keyboard.addKeys("ONE,TWO,THREE,FOUR");
    this.keyListener = (event) => {
      const moves = { Digit1: "attack", Digit2: "guard", Digit3: "special", Digit4: "skill" };
      if (moves[event.code]) this.pickMove(moves[event.code]);
    };
    this.input.keyboard.on("keydown", this.keyListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
      this.registry.events.off("changedata-serverState", this.stateListener);
      this.input.keyboard.off("keydown", this.keyListener);
      if (this.rewardTimer) this.rewardTimer.remove(false);
      audio.setRage(false);
      audio.music("forest");
      document.getElementById("hud")?.classList.remove("in-battle");
    });

    this.onResize();
    this.applyServerState(this.registry.get("serverState"));
  }

  onResize() {
    const s = Math.min(
      this.scale.width / this.W,
      this.scale.height / this.H
    );

    this.root.setScale(s);

    this.root.setPosition(
      (this.scale.width - this.W * s) / 2,
      (this.scale.height - this.H * s) / 2
    );
  }

  // --------------------------------------------------
  // DRAWING HELPERS
  // --------------------------------------------------

  rect(x, y, w, h, color, alpha = 1, stroke = 0, layer = this.forestLayer) {
    const r = this.add.rectangle(x, y, w, h, color, alpha)
      .setOrigin(0);

    if (stroke) r.setStrokeStyle(3, stroke);

    layer.add(r);
    return r;
  }

  ellipse(x, y, w, h, color, alpha = 1, layer = this.forestLayer) {
    const e = this.add.ellipse(x, y, w, h, color, alpha);
    layer.add(e);
    return e;
  }

  text(x, y, str, size = 22, color = "#ffffff",
    opts = {}, layer = this.uiLayer) {
    const t = this.add.text(x, y, str, {
      fontFamily: "monospace",
      fontSize: size,
      color,
      stroke: "#11182b",
      strokeThickness: 3,
      ...opts
    });

    layer.add(t);
    return t;
  }

  // --------------------------------------------------
  // WORLD
  // --------------------------------------------------

  // The forest is painted from over a hundred shapes that never move. Drawing them all again
  // every frame is slow on a small computer, so they are flattened into one picture, at the
  // size it is shown, and the shapes are thrown away. The picture is kept for the next fight.
  bakeForest() {
    const s = this.scale.width / this.W;
    if (!this.textures.exists(FOREST_KEY)) {
      const picture = this.textures.addDynamicTexture(FOREST_KEY, this.scale.width, this.scale.height);
      this.forestLayer.setScale(s);
      picture.draw(this.forestLayer, 0, 0);
      if (picture.render) picture.render();
      this.forestLayer.setScale(1);
      this.forestLayer.removeAll(true);
    }
    this.forestLayer.add(this.add.image(0, 0, FOREST_KEY).setOrigin(0).setScale(1 / s));
  }

  buildWorld() {
    const rng = new Phaser.Math.RandomDataGenerator([
      "root-cellar-forest-v5"
    ]);

    // Sky is isolated from all other scene elements.
    this.drawDetailedSky(rng);
    if (this.textures.exists(FOREST_KEY)) return;   // the forest was painted for an earlier fight

    // Ground first, before trees and decorations.
    this.drawDetailedGround(rng);
    this.drawForestPath(rng);

    // Distant forest silhouettes.
    for (let i = 0; i < 38; i++) {
      const x = i * 39 - 20;
      const y = rng.between(325, 390);
      const h = rng.between(65, 125);

      this.drawPineSilhouette(
        x, y, h,
        rng.pick([0x567e69, 0x648d72, 0x78987b])
      );
    }

    // Background trees.
    for (let i = 0; i < 19; i++) {
      const x = i * 77 - 45;
      const y = rng.between(390, 445);

      this.drawPixelTree(
        x, y,
        rng.realInRange(0.48, 0.68),
        rng,
        true
      );
    }

    // Large autumn trees.
    const trees = [
      [-40, 505, 1.20],
      [90, 500, 1.05],
      [210, 470, 0.90],
      [335, 445, 0.76],
      [470, 420, 0.65],
      [625, 415, 0.62],
      [770, 415, 0.65],
      [910, 425, 0.72],
      [1080, 470, 0.94],
      [1215, 515, 1.15],
      [1340, 520, 1.25]
    ];

    trees.forEach(([x, y, scale]) => {
      this.drawPixelTree(x, y, scale, rng);
    });

    this.drawForestRuins(rng);
    this.drawAncientArch(720, 270, 0.8);

    // Moss and soil texture.
    for (let i = 0; i < 85; i++) {
      this.ellipse(
        rng.between(0, 1280),
        rng.between(405, 720),
        rng.between(15, 55),
        rng.between(4, 12),
        rng.pick([0x536e43, 0x63864a, 0x8e9652]),
        0.65
      );
    }

    for (let i = 0; i < 420; i++) {
      this.rect(
        rng.between(0, 1280),
        rng.between(405, 720),
        rng.between(2, 7),
        rng.between(2, 4),
        rng.pick([
          0x466b3e, 0x9d995b, 0xb5a66d,
          0x547343, 0x725b42
        ]),
        0.85
      );
    }

    for (let i = 0; i < 35; i++) {
      this.drawForestRock(
        rng.between(0, 1280),
        rng.between(425, 710),
        rng.realInRange(0.5, 1.1)
      );
    }

    for (let i = 0; i < 150; i++) {
      this.drawGrassTuft(
        rng.between(0, 1280),
        rng.between(415, 710),
        rng
      );
    }

    for (let i = 0; i < 90; i++) {
      this.drawFallenLeaf(
        rng.between(0, 1280),
        rng.between(415, 710),
        rng
      );
    }

    // Enemy platform.
    this.ellipse(905, 464, 490, 91, 0x394735, 0.4);
    this.ellipse(905, 450, 480, 76, 0xab9471);
    this.ellipse(905, 440, 450, 52, 0xc3aa82);

    // Player platform.
    this.ellipse(340, 607, 435, 72, 0x354632, 0.35);
    this.ellipse(340, 591, 420, 62, 0xb19a74);
    this.ellipse(340, 581, 390, 41, 0xc8ad84);
  }




drawDetailedGround(rng) {
  const g = this.add.graphics();
  this.forestLayer.add(g);

  const W = 1280;
  const H = 720;

  // Pixel grid keeps the ground looking retro.
  const P = 4;

  const block = (x, y, w, h, color, alpha = 1) => {
    g.fillStyle(color, alpha);
    g.fillRect(
      Math.round(x / P) * P,
      Math.round(y / P) * P,
      Math.max(P, Math.round(w / P) * P),
      Math.max(P, Math.round(h / P) * P)
    );
  };

  // --------------------------------------------------
  // BASE TERRAIN
  // --------------------------------------------------

  const grassColors = [
    0x6b8c4d,
    0x739653,
    0x648447,
    0x789b55,
    0x5d7b42
  ];

  // Layered grass with subtle horizontal variation.
  for (let y = 390; y < H; y += 8) {
    const color = rng.pick(grassColors);
    block(0, y, W, 8, color);
  }

  // Brown soil beneath the foreground grass.
  block(0, 545, W, 175, 0x765a40);

  // Soil color bands.
  for (let i = 0; i < 75; i++) {
    const x = rng.between(0, W);
    const y = rng.between(545, H);

    block(
      x, y,
      rng.between(25, 120),
      rng.between(4, 12),
      rng.pick([
        0x694c38,
        0x856548,
        0x94734e,
        0x5d4936
      ]),
      0.65
    );
  }

  // --------------------------------------------------
  // IRREGULAR GRASS-TO-DIRT BORDER
  // --------------------------------------------------

  // Grass grows downward in uneven patches.
  for (let x = 0; x < W; x += 12) {
    const edge = 535 + rng.between(-18, 24);

    block(
      x, 525,
      12, edge - 525,
      rng.pick([0x638247, 0x72914b, 0x587a42])
    );

    // Dark boundary shadow.
    block(x, edge, 12, 4, 0x4d623c);
  }

  // Small grass islands on dirt.
  for (let i = 0; i < 45; i++) {
    const x = rng.between(0, W);
    const y = rng.between(545, H);

    const w = rng.between(16, 55);

    block(x, y, w, 7, 0x577843);
    block(x + 5, y - 4, w - 10, 5, 0x7c9a51);
  }

  // --------------------------------------------------
  // NATURAL DIRT PATCHES
  // --------------------------------------------------

  for (let i = 0; i < 38; i++) {
    const x = rng.between(0, W);
    const y = rng.between(420, H);
    const width = rng.between(25, 100);
    const height = rng.between(8, 24);

    // Shadow edge.
    block(x - 4, y + 4, width + 8, height, 0x4f5e3b, 0.45);

    // Main exposed soil.
    block(
      x, y, width, height,
      rng.pick([
        0x95764f,
        0xa2875b,
        0x876847,
        0xb09a67
      ]),
      0.75
    );

    // Soil highlights.
    for (let j = 0; j < 5; j++) {
      block(
        x + rng.between(0, width),
        y + rng.between(0, height),
        rng.between(4, 13),
        3,
        0xc1a16c,
        0.65
      );
    }
  }

  // --------------------------------------------------
  // TINY PIXEL SOIL DETAILS
  // --------------------------------------------------

  for (let i = 0; i < 650; i++) {
    const x = rng.between(0, W);
    const y = rng.between(395, H);

    const color = rng.pick([
      0x456b3b,
      0x9e9859,
      0xb2a16c,
      0x4b6d40,
      0x624a36,
      0x987550
    ]);

    block(
      x, y,
      rng.between(2, 7),
      rng.between(2, 5),
      color,
      rng.realInRange(0.4, 0.9)
    );
  }

  // --------------------------------------------------
  // GRASS CLUMPS
  // --------------------------------------------------

  for (let i = 0; i < 240; i++) {
    const x = rng.between(0, W);
    const y = rng.between(400, H);

    const color = rng.pick([
      0x315c35,
      0x42703b,
      0x5a8845,
      0x91ad56
    ]);

    // Three grass blades.
    block(x, y - 10, 4, 12, color);
    block(x - 7, y - 6, 4, 8, color);
    block(x + 7, y - 8, 4, 10, color);

    // Tiny bright tip.
    if (rng.frac() < 0.3) {
      block(x, y - 12, 4, 4, 0xb3c66a);
    }
  }

  // --------------------------------------------------
  // PEBBLES AND ROCKS
  // --------------------------------------------------

  for (let i = 0; i < 55; i++) {
    const x = rng.between(0, W);
    const y = rng.between(420, H);
    const size = rng.between(5, 15);

    // Ground shadow.
    block(x - 3, y + 3, size + 7, 5, 0x3c4938, 0.5);

    // Rock outline.
    block(x, y - size / 2, size, size / 2 + 5, 0x414c43);

    // Rock body.
    block(
      x + 3, y - size / 2,
      size - 4, size / 2,
      rng.pick([0x788273, 0x929587, 0x696e61])
    );

    // Highlight.
    block(x + 3, y - size / 2, size / 2, 3, 0xb7b8a0);
  }

  // --------------------------------------------------
  // EXPOSED ROOTS
  // --------------------------------------------------

  for (let i = 0; i < 12; i++) {
    const x = rng.between(0, W);
    const y = rng.between(430, 690);
    const length = rng.between(25, 75);

    // Main root.
    block(x, y, length, 6, 0x493a2c);

    // Highlight on top.
    block(x + 4, y, length - 12, 3, 0x896744);

    // Root branch.
    block(
      x + length * 0.5,
      y - 10,
      5, 14,
      0x5d4531
    );
  }

  // --------------------------------------------------
  // AUTUMN LEAF LITTER
  // --------------------------------------------------

  for (let i = 0; i < 175; i++) {
    const x = rng.between(0, W);
    const y = rng.between(405, H);

    const color = rng.pick([
      0xe6a24b,
      0xc66b36,
      0xf0c76c,
      0x9e4930,
      0xd88a3f
    ]);

    // Pixel leaf silhouette.
    block(x, y, 9, 5, color);
    block(x + 3, y - 3, 5, 4, color);
    block(x + 5, y + 4, 4, 3, 0x774a30);

    // Tiny stem.
    if (rng.frac() < 0.45) {
      block(x + 8, y + 2, 5, 2, 0x60442e);
    }
  }

  // --------------------------------------------------
  // MOSS PATCHES
  // --------------------------------------------------

  for (let i = 0; i < 45; i++) {
    const x = rng.between(0, W);
    const y = rng.between(410, H);
    const width = rng.between(15, 48);

    block(x, y, width, 7, 0x456b3d);
    block(x + 4, y - 4, width - 8, 5, 0x659349);

    for (let j = 0; j < 4; j++) {
      block(
        x + rng.between(0, width),
        y - rng.between(2, 8),
        4, 4,
        0x91b45d
      );
    }
  }

  // --------------------------------------------------
  // SMALL WILDFLOWERS
  // --------------------------------------------------

  for (let i = 0; i < 32; i++) {
    const x = rng.between(0, W);
    const y = rng.between(415, H);

    const flower = rng.pick([
      0xffe08a,
      0xf5a2a7,
      0xf5e9c7,
      0xd6b7ee
    ]);

    // Stem.
    block(x, y - 13, 3, 13, 0x3c713d);

    // Petals.
    block(x - 4, y - 18, 5, 5, flower);
    block(x + 3, y - 18, 5, 5, flower);
    block(x, y - 23, 5, 5, flower);
    block(x, y - 14, 5, 5, flower);

    // Center.
    block(x, y - 18, 4, 4, 0xe6a748);
  }
}



drawForestPath(rng) {
  const g = this.add.graphics();
  this.forestLayer.add(g);

  // Winding path from the distant forest toward the player.
  const points = [
    { x: 660, y: 395, w: 65 },
    { x: 640, y: 445, w: 95 },
    { x: 700, y: 510, w: 145 },
    { x: 620, y: 590, w: 215 },
    { x: 710, y: 720, w: 310 }
  ];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    const steps = Math.ceil((b.y - a.y) / 5);

    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const x = Phaser.Math.Linear(a.x, b.x, t);
      const y = Phaser.Math.Linear(a.y, b.y, t);
      const width = Phaser.Math.Linear(a.w, b.w, t);

      g.fillStyle(0x9a7953);
      g.fillRect(x - width / 2, y, width, 6);

      // Lighter center.
      g.fillStyle(0xb49a6c, 0.5);
      g.fillRect(x - width * 0.32, y, width * 0.64, 4);
    }
  }

  // Pebbles along the path.
  for (let i = 0; i < 65; i++) {
    const y = rng.between(400, 720);
    const x = rng.between(540, 820);

    g.fillStyle(
      rng.pick([0x756e59, 0xc5ad7a, 0x8a765c]),
      0.8
    );

    g.fillRect(
      x, y,
      rng.between(3, 9),
      rng.between(2, 5)
    );
  }
}




drawBattleAura(x, y, color = 0x8ef5a5, scale = 1) {
  const aura = this.add.container(x, y);
  this.auraLayer.add(aura);
  aura.setAlpha(0.45);      // a faint mark on the field: the fighters leave it when they move

  const g = this.add.graphics();
  aura.add(g);

  // --------------------------------------------------
  // SOFT PIXEL GLOW
  // --------------------------------------------------

  for (let i = 7; i >= 1; i--) {
    const radius = 75 + i * 17;

    g.fillStyle(color, 0.018);
    g.fillCircle(0, 0, radius);
  }

  // --------------------------------------------------
  // MAIN CIRCULAR BACKDROP
  // --------------------------------------------------

  g.fillStyle(0x102b28, 0.66);
  g.fillCircle(0, 0, 116);

  g.lineStyle(7, color, 0.55);
  g.strokeCircle(0, 0, 118);

  g.lineStyle(3, 0xffffff, 0.2);
  g.strokeCircle(0, 0, 105);

  // --------------------------------------------------
  // PIXELATED RADIAL RAYS
  // --------------------------------------------------

  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;

    const inner = 125;
    const outer = 145 + (i % 3) * 10;

    const x1 = Math.cos(angle) * inner;
    const y1 = Math.sin(angle) * inner;
    const x2 = Math.cos(angle) * outer;
    const y2 = Math.sin(angle) * outer;

    g.lineStyle(i % 2 === 0 ? 7 : 4, color, 0.4);
    g.lineBetween(x1, y1, x2, y2);
  }

  // --------------------------------------------------
  // FLOATING PIXEL PARTICLES
  // --------------------------------------------------

  const particles = this.add.container(0, 0);
  aura.add(particles);

  for (let i = 0; i < 15; i++) {
    const angle = (i / 15) * Math.PI * 2;
    const radius = 110 + (i % 4) * 15;

    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;

    const size = i % 3 === 0 ? 7 : 4;

    const particle = this.add.rectangle(
      px, py, size, size, color, 0.8
    );

    particles.add(particle);

    this.tweens.add({
      targets: particle,
      y: py - 13,
      alpha: 0.15,
      duration: 1000 + i * 70,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });
  }

  // --------------------------------------------------
  // ANIMATION
  // --------------------------------------------------

  aura.setScale(scale);

  this.tweens.add({
    targets: aura,
    scaleX: scale * 1.045,
    scaleY: scale * 1.045,
    alpha: 0.32,
    duration: 1600,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut"
  });

  return aura;
}



  // --------------------------------------------------
  // DETAILED PIXEL SKY
  // --------------------------------------------------

  drawDetailedSky(rng) {
    const g = this.add.graphics();
    this.skyLayer.add(g);

    const top = Phaser.Display.Color.ValueToColor(0x477da9);
    const bottom = Phaser.Display.Color.ValueToColor(0xd9d9ae);

    // Sky gradient.
    for (let y = 0; y < 430; y += 4) {
      const t = y / 430;

      const color =
        Phaser.Display.Color.Interpolate.ColorWithColor(
          top, bottom, 100, Math.floor(t * 100)
        );

      g.fillStyle(
        Phaser.Display.Color.GetColor(
          color.r, color.g, color.b
        )
      );

      g.fillRect(0, y, 1280, 4);
    }

    // Atmospheric haze.
    for (let i = 0; i < 30; i++) {
      g.fillStyle(
        rng.pick([0xdde4c4, 0xc6dac4, 0xf1ddb5]),
        rng.realInRange(0.08, 0.22)
      );

      g.fillRect(
        rng.between(0, 1250),
        rng.between(185, 390),
        rng.between(35, 180),
        rng.between(2, 7)
      );
    }

    const sunX = 1015;
    const sunY = 115;

    // Sun rays.
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;

      g.fillStyle(0xffe8aa, 0.055);

      g.fillTriangle(
        sunX + Math.cos(angle - 0.07) * 65,
        sunY + Math.sin(angle - 0.07) * 65,
        sunX + Math.cos(angle + 0.07) * 65,
        sunY + Math.sin(angle + 0.07) * 65,
        sunX + Math.cos(angle) * 260,
        sunY + Math.sin(angle) * 260
      );
    }

    // Sun glow.
    for (let i = 5; i >= 1; i--) {
      g.fillStyle(0xffe6a0, 0.025);
      g.fillCircle(sunX, sunY, 42 + i * 21);
    }

    // Pixel sun.
    g.fillStyle(0xffe8a4);
    g.fillRect(sunX - 30, sunY - 30, 60, 60);

    g.fillStyle(0xfff5c9);
    g.fillRect(sunX - 23, sunY - 23, 46, 46);

    g.fillStyle(0xfffbe2);
    g.fillRect(sunX - 14, sunY - 14, 28, 28);

    // Mountains stay inside skyLayer.
    this.drawPixelMountains(rng);

    this.skyClouds = [];

    const clouds = [
      [90, 95, 1.2, 0.12],
      [360, 155, 0.8, 0.08],
      [630, 75, 1.1, 0.10],
      [940, 185, 0.75, 0.06],
      [1180, 85, 1.0, 0.09],
      [200, 245, 0.55, 0.04],
      [760, 265, 0.65, 0.05]
    ];

    clouds.forEach(([x, y, scale, speed]) => {
      const cloud = this.drawPixelCloud(x, y, scale);
      this.skyClouds.push({ cloud, speed });
    });

    // Atmospheric particles.
    for (let i = 0; i < 65; i++) {
      g.fillStyle(
        rng.pick([0xffffff, 0xffeac0, 0xd9f0e5]),
        rng.realInRange(0.15, 0.4)
      );

      g.fillRect(
        rng.between(0, 1280),
        rng.between(30, 370),
        rng.between(2, 4),
        2
      );
    }
  }

  drawPixelMountains(rng) {
    const g = this.add.graphics();
    this.skyLayer.add(g);

    const mountain = (x, baseY, width, height, color, highlight) => {
      const peakX = x + width * 0.52;
      const peakY = baseY - height;

      g.fillStyle(color);

      g.fillPoints([
        { x, y: baseY },
        { x: x + width * 0.18, y: baseY - height * 0.35 },
        { x: x + width * 0.33, y: baseY - height * 0.52 },
        { x: peakX, y: peakY },
        { x: x + width * 0.67, y: baseY - height * 0.58 },
        { x: x + width * 0.82, y: baseY - height * 0.3 },
        { x: x + width, y: baseY }
      ], true);

      g.fillStyle(highlight, 0.7);

      g.fillPoints([
        { x: peakX, y: peakY },
        { x: x + width * 0.33, y: baseY - height * 0.52 },
        { x: x + width * 0.49, y: baseY - height * 0.18 },
        { x: x + width * 0.59, y: baseY - height * 0.48 }
      ], true);

      for (let i = 0; i < 12; i++) {
        g.fillStyle(highlight, 0.18);

        g.fillRect(
          x + rng.between(0, Math.floor(width)),
          baseY - rng.between(0, Math.floor(height * 0.35)) - 20,
          rng.between(5, 16),
          rng.between(3, 8)
        );
      }
    };

    mountain(-120, 390, 410, 145, 0x8fa9a0, 0xb4c4af);
    mountain(180, 390, 460, 190, 0x809e9b, 0xb1c1b0);
    mountain(560, 390, 430, 155, 0x91aba1, 0xc1cbb2);
    mountain(910, 390, 490, 200, 0x809c98, 0xb3c2af);
  }

  drawPixelCloud(x, y, scale = 1) {
    const cloud = this.add.container(x, y);
    this.skyLayer.add(cloud);

    const g = this.add.graphics();
    cloud.add(g);

    const p = 8;

    const block = (bx, by, bw, bh, color, alpha = 1) => {
      g.fillStyle(color, alpha);
      g.fillRect(bx * p, by * p, bw * p, bh * p);
    };

    const shadow = 0x819db2;
    const middle = 0xc6d8d9;
    const white = 0xf1eee0;
    const highlight = 0xfff8e9;

    block(-10, 0, 21, 4, shadow);
    block(-8, -3, 17, 5, shadow);
    block(-5, -5, 11, 5, shadow);
    block(-1, -7, 6, 5, shadow);

    block(-10, -1, 20, 3, middle);
    block(-8, -4, 16, 5, middle);
    block(-5, -6, 10, 5, middle);
    block(-1, -8, 5, 5, middle);

    block(-9, -2, 18, 3, white);
    block(-7, -5, 14, 4, white);
    block(-4, -7, 9, 4, white);
    block(0, -9, 3, 4, white);

    block(-7, -5, 6, 1, highlight);
    block(-3, -7, 5, 1, highlight);
    block(0, -9, 2, 1, highlight);
    block(3, -4, 4, 1, highlight);

    block(-13, 1, 3, 1, middle, 0.75);
    block(11, 0, 4, 1, middle, 0.7);
    block(13, -1, 2, 1, white, 0.7);

    cloud.setScale(scale);
    return cloud;
  }

  // --------------------------------------------------
  // FOREST TREES
  // --------------------------------------------------

  drawPineSilhouette(x, groundY, height, color) {
    const g = this.add.graphics();
    this.forestLayer.add(g);

    g.fillStyle(color);

    g.fillRect(
      x - 4,
      groundY - height * 0.6,
      8,
      height * 0.6
    );

    for (let i = 0; i < 3; i++) {
      const top = groundY - height + i * height * 0.22;
      const width = 25 + i * 13;

      g.fillTriangle(
        x, top,
        x - width, top + height * 0.43,
        x + width, top + height * 0.43
      );
    }
  }

  drawPixelTree(x, groundY, scale, rng, distant = false) {
    const g = this.add.graphics();
    this.forestLayer.add(g);

    const pixel = Math.max(2, Math.round(4 * scale));

    const px = (xx, yy, w, h, color) => {
      g.fillStyle(color);

      g.fillRect(
        Math.round(xx / pixel) * pixel,
        Math.round(yy / pixel) * pixel,
        Math.max(pixel, Math.round(w / pixel) * pixel),
        Math.max(pixel, Math.round(h / pixel) * pixel)
      );
    };

    const trunkHeight = 170 * scale;
    const trunkWidth = 30 * scale;
    const top = groundY - trunkHeight;

    // Trunk.
    px(x - trunkWidth / 2 - 5, top,
      trunkWidth + 10, trunkHeight, 0x382e2b);

    px(x - trunkWidth / 2, top,
      trunkWidth, trunkHeight, 0x76513b);

    px(x - trunkWidth / 2 + 5 * scale, top,
      7 * scale, trunkHeight, 0x9b704c);

    px(x + trunkWidth / 2 - 9 * scale, top,
      6 * scale, trunkHeight, 0x4b382e);

    // Roots.
    px(x - 30 * scale, groundY - 13 * scale,
      32 * scale, 13 * scale, 0x50392e);

    px(x + 2 * scale, groundY - 16 * scale,
      33 * scale, 16 * scale, 0x50392e);

    if (!distant) {
      for (let i = 0; i < 14; i++) {
        px(
          x + rng.between(-9, 9) * scale,
          top + rng.between(18, 150) * scale,
          3 * scale,
          rng.between(5, 13) * scale,
          0x49372d
        );
      }
    }

    // Branches.
    for (let i = 0; i < 4; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const yy = top + (15 + i * 23) * scale;

      for (let j = 0; j < 5; j++) {
        px(
          x + side * j * 12 * scale,
          yy - j * 8 * scale,
          15 * scale,
          11 * scale,
          0x574033
        );
      }
    }

    const palettes = [
      {
        shadow: 0x743c32,
        dark: 0xa84d34,
        mid: 0xd36b38,
        light: 0xeb9949,
        highlight: 0xf7bd66
      },
      {
        shadow: 0x69402f,
        dark: 0x9d5935,
        mid: 0xc7813e,
        light: 0xe6a650,
        highlight: 0xf5c878
      },
      {
        shadow: 0x633b36,
        dark: 0x944d3d,
        mid: 0xbd6545,
        light: 0xdc8c56,
        highlight: 0xefa968
      }
    ];

    const palette = rng.pick(palettes);
    const canopyY = top - 28 * scale;
    const cell = 9 * scale;
    const radius = 13;

    // Irregular pixel canopy.
    for (let cx = -radius; cx <= radius; cx++) {
      const normalized = Math.abs(cx) / radius;
      const maxHeight = Math.sqrt(1 - normalized * normalized);

      const upper = Math.round(
        -8 * maxHeight + rng.between(-2, 2)
      );

      const lower = Math.round(
        7 * maxHeight + rng.between(-1, 2)
      );

      for (let cy = upper; cy <= lower; cy++) {
        if (rng.frac() < 0.035) continue;

        let color;

        if (cy < -3) {
          color = rng.frac() < 0.55
            ? palette.light : palette.highlight;
        } else if (cy < 2) {
          color = rng.frac() < 0.6
            ? palette.mid : palette.light;
        } else {
          color = rng.frac() < 0.7
            ? palette.dark : palette.shadow;
        }

        px(
          x + cx * cell,
          canopyY + cy * cell,
          cell + 1,
          cell + 1,
          color
        );
      }
    }

    // Leaf clusters.
    for (let i = 0; i < 23; i++) {
      const dx = rng.between(-100, 100) * scale;
      const dy = rng.between(-65, 55) * scale;
      const size = rng.between(15, 30) * scale;

      const color = rng.pick([
        palette.mid, palette.light, palette.dark
      ]);

      px(x + dx, canopyY + dy,
        size, size * 0.65, color);

      px(x + dx + 5 * scale,
        canopyY + dy - 7 * scale,
        size * 0.65, size * 0.5, color);
    }

    // Tiny foliage highlights.
    if (!distant) {
      for (let i = 0; i < 105; i++) {
        const dx = rng.between(-110, 110) * scale;
        const dy = rng.between(-68, 65) * scale;

        const normalized =
          (dx / (130 * scale)) ** 2 +
          (dy / (82 * scale)) ** 2;

        if (normalized > 0.82) continue;

        px(
          x + dx,
          canopyY + dy,
          rng.between(3, 8) * scale,
          rng.between(2, 5) * scale,
          rng.frac() < 0.65
            ? palette.highlight : palette.shadow
        );
      }
    }
  }

  // --------------------------------------------------
  // FOREST DETAILS
  // --------------------------------------------------


drawForestRuins(rng) {
  const g = this.add.graphics();
  this.forestLayer.add(g);

  // Stone wall colors
  const C = {
    outline: 0x343b36,
    deepShadow: 0x41483f,
    shadow: 0x596056,
    stone: 0x858779,
    light: 0xa6a899,
    highlight: 0xc3c1a8,
    crack: 0x454a42,
    mossDark: 0x385b35,
    moss: 0x5d8844,
    mossLight: 0x8baa59,
    vine: 0x406b3b,
    vineLight: 0x72a454
  };

  // Pixel-aligned rectangles
  const P = 4;

  const px = (x, y, w, h, color, alpha = 1) => {
    g.fillStyle(color, alpha);
    g.fillRect(
      Math.round(x / P) * P,
      Math.round(y / P) * P,
      Math.max(P, Math.round(w / P) * P),
      Math.max(P, Math.round(h / P) * P)
    );
  };

  // Wall locations
  const walls = [
    { x: 480, y: 315, w: 105, h: 120 },
    { x: 580, y: 340, w: 85, h: 95 },
    { x: 1060, y: 305, w: 115, h: 135 }
  ];

  walls.forEach((wall, wallIndex) => {
    const { x, y, w, h } = wall;

    // --------------------------------------------------
    // FOUNDATION AND SHADOW
    // --------------------------------------------------

    px(x - 8, y + h - 7, w + 16, 15, C.deepShadow);
    px(x - 5, y + 6, w + 10, h - 6, C.outline);

    // Main wall base
    px(x, y, w, h, C.shadow);

    // --------------------------------------------------
    // INDIVIDUAL STONE BRICKS
    // --------------------------------------------------

    const brickH = 19;
    const brickW = 29;

    for (let row = 0; row < Math.ceil(h / brickH); row++) {
      const offset = row % 2 === 0 ? 0 : -brickW / 2;

      for (let col = -1; col < Math.ceil(w / brickW) + 1; col++) {
        const bx = x + col * brickW + offset;
        const by = y + row * brickH;

        const left = Math.max(x + 3, bx + 2);
        const right = Math.min(x + w - 3, bx + brickW - 2);
        const top = by + 2;
        const bottom = Math.min(y + h - 3, by + brickH - 2);

        if (right <= left || bottom <= top) continue;

        const bw = right - left;
        const bh = bottom - top;

        const stoneColor = rng.pick([
          C.stone,
          C.light,
          0x747b70,
          0x96988a,
          0x70796c
        ]);

        // Brick shadow
        px(left + 2, top + 2, bw, bh, C.deepShadow);

        // Main stone face
        px(left, top, bw - 2, bh - 2, stoneColor);

        // Top highlight
        px(left + 3, top + 2, Math.max(4, bw - 9), 3,
          C.highlight, 0.55);

        // Bottom shadow
        px(left + 3, bottom - 5, Math.max(4, bw - 7), 3,
          C.deepShadow, 0.45);

        // Stone grain
        for (let i = 0; i < 3; i++) {
          px(
            left + rng.between(2, Math.max(2, Math.floor(bw - 6))),
            top + rng.between(3, Math.max(3, Math.floor(bh - 5))),
            4, 4,
            rng.pick([C.shadow, C.light, C.highlight]),
            0.55
          );
        }

        // Occasional cracked brick
        if (rng.frac() < 0.18 && bw > 17 && bh > 12) {
          const crackX = left + Math.floor(bw / 2);
          const crackY = top + 3;

          px(crackX, crackY, 3, 6, C.crack);
          px(crackX + 3, crackY + 5, 6, 3, C.crack);
          px(crackX + 6, crackY + 8, 3, 5, C.crack);
        }
      }
    }

    // --------------------------------------------------
    // BROKEN TOP EDGE
    // --------------------------------------------------

    // Uneven stone blocks along the top
    for (let i = 0; i < Math.ceil(w / 18); i++) {
      const bx = x + i * 18;
      const brokenHeight = rng.between(4, 16);

      px(bx, y - brokenHeight, 17, brokenHeight + 5,
        C.outline);

      px(bx + 3, y - brokenHeight + 3,
        11, brokenHeight,
        rng.pick([C.stone, C.light, C.shadow]));

      px(bx + 3, y - brokenHeight + 3,
        8, 3, C.highlight, 0.6);
    }

    // Missing chunks near the top
    for (let i = 0; i < 3; i++) {
      const gapX = x + rng.between(10, Math.max(10, w - 20));
      const gapY = y - rng.between(1, 8);

      px(gapX, gapY, rng.between(7, 14), 8,
        C.outline);
    }

    // --------------------------------------------------
    // MOSS GROWING BETWEEN BRICKS
    // --------------------------------------------------

    for (let i = 0; i < 34; i++) {
      const mx = x + rng.between(2, Math.floor(w - 8));
      const my = y + rng.between(2, Math.floor(h - 5));
      const mw = rng.between(5, 20);

      px(mx, my, mw, 5, C.mossDark);
      px(mx + 3, my - 3, Math.max(4, mw - 5), 5, C.moss);

      if (rng.frac() < 0.5) {
        px(mx + 5, my - 5, 5, 4, C.mossLight);
      }
    }

    // Thick moss along the top
    for (let i = 0; i < 14; i++) {
      const mx = x + rng.between(0, Math.floor(w - 10));
      const my = y - rng.between(5, 13);

      px(mx, my, rng.between(8, 19), 6, C.mossDark);
      px(mx + 3, my - 3, rng.between(5, 13), 5, C.moss);

      if (rng.frac() < 0.55) {
        px(mx + 5, my - 5, 5, 4, C.mossLight);
      }
    }

    // --------------------------------------------------
    // CREEPING VINES
    // --------------------------------------------------

    const vineCount = wallIndex === 2 ? 4 : 2;

    for (let i = 0; i < vineCount; i++) {
      let vx = x + rng.between(8, Math.floor(w - 10));
      let vy = y - 8;

      const length = rng.between(40, Math.floor(h * 0.8));

      for (let j = 0; j < length; j += 6) {
        const drift = Math.sin(j * 0.13 + i) * 5;

        px(vx + drift, vy + j, 4, 8, C.vine);

        if (j % 12 === 0) {
          const side = rng.frac() < 0.5 ? -1 : 1;

          px(
            vx + drift + side * 6,
            vy + j + 2,
            10, 5,
            C.vineLight
          );

          px(
            vx + drift + side * 9,
            vy + j - 2,
            6, 4,
            C.mossLight
          );
        }
      }
    }

    // --------------------------------------------------
    // SMALL PLANTS AT THE BASE
    // --------------------------------------------------

    for (let i = 0; i < 8; i++) {
      const pxX = x + rng.between(-8, Math.floor(w + 8));
      const pxY = y + h + rng.between(-3, 5);

      px(pxX, pxY - 12, 4, 14, C.vine);
      px(pxX - 6, pxY - 8, 8, 5, C.moss);
      px(pxX + 3, pxY - 11, 9, 5, C.vineLight);
    }

    // --------------------------------------------------
    // RUBBLE AROUND THE WALL
    // --------------------------------------------------

    for (let i = 0; i < 12; i++) {
      const rx = x + rng.between(-25, Math.floor(w + 25));
      const ry = y + h + rng.between(0, 24);
      const size = rng.between(5, 14);

      // Rubble shadow
      px(rx - 2, ry + 3, size + 5, 5, C.outline, 0.55);

      // Stone fragment
      px(rx, ry - size / 2, size, size / 2 + 4,
        rng.pick([C.stone, C.light, C.shadow]));

      // Highlight
      px(rx + 2, ry - size / 2, Math.max(4, size - 5),
        3, C.highlight, 0.65);
    }
  });
}



drawAncientArch(x, y, scale = 1) {
  const g = this.add.graphics();
  this.forestLayer.add(g);

  const P = 4;

  const px = (xx, yy, w, h, color) => {
    g.fillStyle(color);
    g.fillRect(
      Math.round(xx / P) * P,
      Math.round(yy / P) * P,
      Math.max(P, Math.round(w / P) * P),
      Math.max(P, Math.round(h / P) * P)
    );
  };

  const stone = 0x898d7e;
  const dark = 0x40483f;
  const light = 0xb9b8a3;
  const moss = 0x628747;

  const w = 170 * scale;
  const h = 175 * scale;
  const pillarW = 32 * scale;

  // Left pillar
  px(x, y, pillarW, h, dark);
  px(x + 5 * scale, y + 5 * scale,
    pillarW - 10 * scale, h - 10 * scale, stone);

  // Right pillar
  px(x + w - pillarW, y, pillarW, h, dark);
  px(x + w - pillarW + 5 * scale, y + 5 * scale,
    pillarW - 10 * scale, h - 10 * scale, stone);

  // Upper stone beam
  px(x - 8 * scale, y - 20 * scale,
    w + 16 * scale, 40 * scale, dark);

  px(x - 3 * scale, y - 16 * scale,
    w + 6 * scale, 28 * scale, stone);

  // Top highlights
  px(x, y - 16 * scale,
    w, 5 * scale, light);

  // Stone seams
  for (let i = 1; i < 5; i++) {
    px(x + i * w / 5, y - 15 * scale,
      4 * scale, 25 * scale, dark);
  }

  // Moss growing across the arch
  for (let i = 0; i < 20; i++) {
    const mx = x + (i * 37 % Math.floor(w));
    const my = y - 20 * scale + (i % 3) * 5 * scale;

    px(mx, my, 12 * scale, 6 * scale, moss);
  }

  // Cracks on pillars
  px(x + 12 * scale, y + 45 * scale,
    4 * scale, 25 * scale, dark);
  px(x + 16 * scale, y + 65 * scale,
    12 * scale, 4 * scale, dark);

  px(x + w - 17 * scale, y + 75 * scale,
    4 * scale, 30 * scale, dark);
  px(x + w - 27 * scale, y + 100 * scale,
    14 * scale, 4 * scale, dark);
}





  drawForestRock(x, y, scale = 1) {
    this.ellipse(x, y + 5 * scale,
      38 * scale, 12 * scale, 0x283a2c, 0.3);

    this.ellipse(x, y,
      35 * scale, 22 * scale, 0x5b6155);

    this.ellipse(x - 4 * scale, y - 5 * scale,
      23 * scale, 11 * scale, 0x9a9984);

    this.rect(x + 5 * scale, y,
      9 * scale, 4 * scale, 0x414b43);
  }

  drawGrassTuft(x, y, rng) {
    const color = rng.pick([
      0x385e36, 0x527d3c, 0x7da34b, 0x9aab52
    ]);

    this.rect(x, y - 8, 3, 10, color);
    this.rect(x - 6, y - 5, 3, 7, color);
    this.rect(x + 6, y - 6, 3, 8, color);

    if (rng.frac() < 0.12) {
      const flowerColor = rng.pick([
        0xffd76b, 0xf4a6a5, 0xf9e5ba
      ]);

      this.rect(x, y - 14, 2, 10, 0x42713d);
      this.ellipse(x, y - 15, 8, 8, flowerColor);
      this.ellipse(x, y - 15, 3, 3, 0xe8a24b);
    }
  }

  drawFallenLeaf(x, y, rng) {
    const color = rng.pick([
      0xd46b37, 0xef9d40, 0xf0c15f,
      0x9f4932, 0xc57b3c
    ]);

    const leaf = this.add.ellipse(
      x, y,
      rng.between(5, 11),
      rng.between(3, 6),
      color
    );

    leaf.rotation = rng.realInRange(-Math.PI, Math.PI);
    this.forestLayer.add(leaf);
  }

  // --------------------------------------------------
  // CHARACTERS
  // --------------------------------------------------



  makeMinty(x, y) {
    const c = this.add.container(x, y);

    const e = (dx, dy, w, h, color, rot = 0) => {
      const s = this.add.ellipse(dx, dy, w, h, color);
      s.rotation = rot;
      c.add(s);
    };

    e(0, 74, 65, 175, 0x6bdc8b);
    e(-60, 45, 92, 42, 0x3abf88, -0.5);
    e(60, 45, 92, 42, 0x3abf88, 0.5);

    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;

      e(
        Math.cos(a) * 73,
        Math.sin(a) * 62 - 40,
        85, 38,
        i % 2 ? 0x36b98a : 0x65e5a4,
        a
      );
    }

    e(0, -35, 155, 143, 0x8af3b0);
    e(-30, -44, 14, 20, 0x173e36);
    e(30, -44, 14, 20, 0x173e36);
    e(0, -6, 18, 8, 0xd96c91);

    return c;
  }

  // --------------------------------------------------
  // THE FIGHTERS
  // --------------------------------------------------

  buildActors() {
    this.drawBattleAura(FIGHTER.x, 395, 0x9df6ba, 1.0);
    this.drawBattleAura(BOSS.x + 10, 355, 0xff9868, 1.15);

    this.ellipse(BOSS.x + 2, BOSS.y - 1, 295, 37, 0x10201b, 0.5, this.actorLayer);

    // The dragon no longer fights. It stands at the back, facing us, and sends the plants in.
    // Its usual picture is made by the forest scene; if the page was opened straight on the
    // battle, that picture does not exist yet and the view from behind is used.
    ensureDragonBackTexture(this);
    const trainerKey = this.textures.exists("plantHero") ? "plantHero" : DRAGON_BACK_KEY;
    this.textures.get(trainerKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.trainer = this.add.image(TRAINER.x, TRAINER.y, trainerKey).setOrigin(0.5, 1);
    this.trainer.setScale(TRAINER.height / this.trainer.height);
    this.ellipse(TRAINER.x, TRAINER.y - 3, 150, 22, 0x10201b, 0.48, this.actorLayer);
    this.actorLayer.add(
      createCastShadow(this, outlineOfPicture(this, trainerKey), { light: BATTLE_LIGHT, size: this.trainer.scaleX })
        .setPosition(TRAINER.x, TRAINER.y - 3)
    );
    this.actorLayer.add(this.trainer);
    this.tweens.add({ targets: this.trainer, y: TRAINER.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    if (hasBossRig(this, bossArt(1))) {
      // made of moving pieces: it sways on its own
      this.enemySprite = createBossRig(this, bossArt(1), BOSS.x, BOSS.y, ENEMY_HEIGHT, { light: BATTLE_LIGHT });
    } else if (this.textures.exists(bossArt(1).key)) {
      this.enemySprite = this.add.image(BOSS.x, BOSS.y, bossArt(1).key).setOrigin(0.5, 0.93);
      this.fitEnemy(1);
    } else {
      this.enemySprite = this.makeCaterpillar(BOSS.x + 10, 355);
      this.enemySprite.setScale(0.85);
    }
    this.actorLayer.add(this.enemySprite);

    // Both plants (render/plantRig.js). They stay hidden until the server says who is fighting.
    this.fighters = {};
    for (const id of PLANT_IDS) {
      const rig = createPlantRig(this, PLANTS[id], BENCH.x, BENCH.y, PLANTS[id].rig.height * BENCH.size, { light: BATTLE_LIGHT });
      rig.setVisible(false);
      this.actorLayer.add(rig);
      this.fighters[id] = rig;
    }
  }

  // A spot on the screen (what a plant's point() gives) as a spot on the 1280 x 720 stage.
  stagePoint(point) {
    return { x: (point.x - this.root.x) / this.root.scaleX, y: (point.y - this.root.y) / this.root.scaleY };
  }

  // What a plant's effect in render/battleFx.js is given.
  plantCtx(rig, at, lands) {
    return {
      scene: this, kit: this.kit, plant: rig.plant, at, lands,
      from: (name) => this.stagePoint(rig.point(name)),
      ground: { x: FIGHTER.x, y: FIGHTER.y },
      boss: { x: BOSS.x - 20, y: BOSS.y - 150 },
      bossGround: { x: BOSS.x, y: BOSS.y },
    };
  }

  // What the boss's effect in render/bossFx.js is given. rig: the plant it is aimed at.
  bossCtx(rig, lands, blocked, meet = null) {
    const enemy = this.enemySprite;
    return {
      scene: this, kit: this.kit, palette: bossPalette(this.enemyTier || 1), lands, blocked, meet,
      mouth: () => (enemy.mouthPoint ? this.stagePoint(enemy.mouthPoint()) : { x: BOSS.x - 40, y: BOSS.y - 230 }),
      boss: { x: BOSS.x - 20, y: BOSS.y - 150 },
      bossGround: { x: BOSS.x, y: BOSS.y },
      target: { x: FIGHTER.x + 10, y: FIGHTER.y - rig.getHeight() * 0.45 },
      targetGround: { x: FIGHTER.x, y: FIGHTER.y },
      roar: () => enemy.roar && enemy.roar(),
      lunge: (dx, ms) => this.lunge(enemy, dx, ms),
    };
  }

  // The dragon throws an arm forward: "go!"
  trainerCall() {
    this.tweens.add({ targets: this.trainer, angle: 9, x: TRAINER.x + 12, duration: 120, yoyo: true, ease: "Quad.easeOut" });
  }

  // Which plant the server says is fighting.
  fightingPlant(state) {
    const battle = state.battle || {};
    if (this.fighters[battle.plant]) return battle.plant;
    if (state.boss && this.fighters[state.boss.plant]) return state.boss.plant;
    return PLANT_IDS[0];
  }

  // Stands every plant where the server says it is, with no animation: up front, on the bench,
  // or fainted on the bench. arrive: the fighter pops in as if the dragon just called it.
  placeTeam(state, arrive = false) {
    const team = (state.battle && state.battle.team) || {};
    this.activeId = this.fightingPlant(state);
    for (const id of PLANT_IDS) {
      const rig = this.fighters[id];
      const info = team[id];
      this.tweens.killTweensOf(rig);
      rig.stopActions();
      if (id === this.activeId) {
        rig.setPosition(FIGHTER.x, FIGHTER.y).setHeight(rig.plant.rig.height * FIGHTER.size).setAlpha(1).setVisible(true);
        rig.setMood("fierce", true);
        this.actorLayer.bringToTop(rig);
      } else if (info) {
        const down = info.state === "down";
        rig.setPosition(BENCH.x, BENCH.y).setHeight(rig.plant.rig.height * BENCH.size).setAlpha(down ? 0.65 : 1).setVisible(true);
        rig.setMood(down ? "fainted" : "happy", true);
      } else {
        rig.setVisible(false);
      }
    }
    if (arrive) {
      const rig = this.fighters[this.activeId];
      this.trainerCall();
      rig.play("enter");
      rig.emote("anger", 1100);
      playBattleFx("arrive", this.plantCtx(rig, 60, true));
      this.hud.callout("left", "GO!", this.plantName(this.activeId), rig.plant.glow);
    }
  }

  // The plant up front has fainted: it tips over and is carried to the bench, and the dragon
  // sends the other one bounding in from the bench.
  swapFighter(outId, inId, delay) {
    const out = this.fighters[outId];
    const next = this.fighters[inId];
    this.activeId = inId;
    if (!out || !next) return;

    this.time.delayedCall(delay, () => {
      out.setMood("fainted");
      out.emote("sweat", 900);
      this.hud.log(`${this.plantName(outId)} fainted!`);
      this.hud.word("DOWN!", "#ff8f9c", FIGHTER.x, FIGHTER.y - 300);
    });
    this.time.delayedCall(delay + 760, () => {
      this.tweens.add({
        targets: out, alpha: 0, duration: 200,
        onComplete: () => {
          out.setPosition(BENCH.x - 34, BENCH.y + 2).setHeight(out.plant.rig.height * BENCH.size * 0.9);
          this.tweens.add({ targets: out, alpha: 0.65, duration: 220 });
        },
      });
      this.trainerCall();
      audio.play("swap");
      this.hud.log(`Go, ${this.plantName(inId)}!`);
      this.hud.callout("left", "GO!", this.plantName(inId), next.plant.glow);
      this.hold = null;                      // the screen now shows the new plant
      this.refreshHud();
      next.setVisible(true).setAlpha(1).setMood("fierce");
      next.emote("anger", 1000);
      this.actorLayer.bringToTop(next);
      // two bounds from the bench to the front, growing as it comes closer
      next.play("hop", { ms: 320, height: 0.34 });
      next.play("hop", { ms: 320, height: 0.24, delay: 320 });
      this.tweens.add({
        targets: next, x: FIGHTER.x, y: FIGHTER.y, scaleX: FIGHTER.size, scaleY: FIGHTER.size,
        duration: 640, ease: "Sine.easeInOut",
        onComplete: () => playBattleFx("arrive", this.plantCtx(next, 0, true)),
      });
    });
  }

  plantName(id) {
    const team = (this.serverState && this.serverState.battle && this.serverState.battle.team) || {};
    return (team[id] && team[id].name) || PLANTS[id].name;
  }

  // --------------------------------------------------
  // THE SCREEN AND THE SERVER
  // --------------------------------------------------

  // Redraws the name plates, bars and cards (ui/battleHud.js) from the server's last message.
  // While a turn is playing out, `this.hold` keeps the health as it was until each blow lands.
  refreshHud() {
    const state = this.serverState;
    if (!state || !state.boss || !state.battle) return;
    const { boss, battle, meters } = state;
    const hold = this.hold;
    const id = hold ? hold.id : this.fightingPlant(state);
    const plant = PLANTS[id] || PLANTS[PLANT_IDS[0]];
    const team = battle.team || {};
    const benchId = PLANT_IDS.find((other) => other !== id && team[other]);
    const bench = benchId ? { name: team[benchId].name, hp: team[benchId].hp, max: team[benchId].max_hp, state: team[benchId].state } : null;
    if (bench && hold && hold.id !== battle.plant && benchId === battle.plant) { bench.hp = bench.max; bench.state = "ready"; }
    const skill = (hold && hold.skill) || battle.skill || null;
    // The wind-up for the coming turn. It stays hidden while the last turn is still playing out.
    const intent = !hold && !this.result && battle.intent && this.time.now >= this.busyUntil ? battle.intent : null;
    const tell = intent && {
      name: bossMove(boss.tier, intent.move).name, type: intent.move, grade: intent.grade, chance: intent.chance,
      heavy: intent.heavy, alt: intent.bluff ? { name: bossMove(boss.tier, intent.bluff).name } : null,
    };
    const moves = { ...plant.moves, skill: plantMove(plant, "skill", battle.skill ? battle.skill.name : "") };
    if (!battle.skill) moves.skill = { name: "Skill", icon: "star" };
    this.hud.update({
      fighter: {
        id, name: hold ? hold.name : battle.creature || plant.name, colour: plant.glow,
        hp: hold ? hold.hp : battle.creature_hp, max: hold ? hold.max : battle.creature_max_hp,
      },
      bench,
      boss: {
        name: boss.name, hp: hold ? hold.bossHp : battle.boss_hp, max: boss.max_hp, tier: boss.tier, demo: boss.source === "demo",
        colour: bossPalette(boss.tier).main, enraged: hold ? hold.enraged : battle.enraged,
        enrageAt: battle.enrage_hp ? battle.enrage_hp / boss.max_hp : 0,
      },
      tell, tellKey: `${battle.turn}`, hints: Boolean(battle.hints),
      soil: meters && meters.water ? meters.water[boss.plant] : null,
      vigor: state.health,
      turn: battle.turn,
      moves, skill,
      canPick: Boolean(battle.awaiting_move) && !this.result && this.time.now >= this.busyUntil,
      chosen: this.chosen,
      seconds: battle.move_seconds_left,
    });
  }

  flash(sprite) {
    this.tweens.add({ targets: sprite, alpha: 0.25, duration: 70, yoyo: true, repeat: 2, onComplete: () => sprite.setAlpha(1) });
  }

  lunge(sprite, dx, ms = 130) {
    this.tweens.add({ targets: sprite, x: sprite.x + dx, duration: ms, yoyo: true, ease: "Quad.easeOut" });
  }

  pickMove(move) {
    const battle = this.serverState?.battle;
    if (!battle?.awaiting_move || this.result || this.time.now < this.busyUntil) return;   // the last turn is still playing out
    if (this.chosen) return;
    if (move === "skill" && !battle.skill?.ready) { audio.play("no"); return; }
    audio.play("pick");
    this.registry.get("sendMove")?.(move);
    this.chosen = move;
    // if the server never answers (a dropped message), the cards come back
    const turn = battle.turn;
    this.time.delayedCall(1500, () => {
      if (this.chosen !== move || this.serverState?.battle?.turn !== turn) return;
      this.chosen = null;
      this.refreshHud();
    });
    this.hud.log("Here it comes...");
    this.refreshHud();
  }

  applyServerState(state) {
    if (!state) return;
    const previous = this.lastBattle;
    this.serverState = state;
    const battle = state.battle;
    if (state.boss && battle) {
      if (this.activeId === null) this.placeTeam(state, true);   // the dragon sends the first plant in
      if (state.boss.tier !== this.enemyTier) { this.enemyTier = state.boss.tier; this.fitEnemy(state.boss.tier); }
      if (previous && battle.turn > previous.turn) this.animateTurn(previous, battle, state);
      // a plant change with no turn to show it (the page was opened late): just put them in place
      if (this.fightingPlant(state) !== this.activeId) this.placeTeam(state);
      this.refreshHud();
      if ((!previous || previous.turn === battle.turn) && this.time.now >= this.busyUntil && !this.chosen) {
        this.hud.log(battle.awaiting_move ? "Read the wind-up. Choose a move." : "The fight is on...");
      }
      this.lastBattle = { ...battle };
    }
    if (state.mode === "reward") this.showResult(true, state);
    else if (state.mode === "cooldown" && previous && !this.result) this.showResult(previous.boss_hp <= 0, state);
    else if (state.mode === "walking" && !battle && !this.result) this.hud.log("Waiting for a boss...");
    if ((state.mode === "walking" || state.mode === "cooldown") && (this.result || !battle)) this.leaveWhenReady();
  }

  // Shows this tier's boss at battle size, keeping its proportions. Higher tiers stand taller.
  fitEnemy(tier) {
    const art = bossArt(tier);
    const height = ENEMY_HEIGHT * Math.min(1.1, art.height / bossArt(1).height);
    if (this.enemySprite.isBossRig) { this.enemySprite.setHeight(height); return; }
    if (!this.textures.exists(art.key) || this.enemySprite.type !== "Image") return;
    const picture = this.textures.get(art.key).getSourceImage();
    this.enemySprite.setTexture(art.key).setDisplaySize(height * (picture.width / picture.height), height);
  }

  // --------------------------------------------------
  // ONE TURN
  // --------------------------------------------------

  // Plays one turn. Both sides always show their move, even the one that lost the turn:
  //   the plant goes first, then the boss answers;
  //   unless the plant's guard is what won, then the boss strikes first and breaks on the shield;
  //   a tie has both go at once and meet in the middle.
  // What each plant does for a move is in data/plants.js, and the boss's moves are in data/bosses.js.
  animateTurn(previous, battle, state) {
    const move = battle.last_move;
    if (!move) return;
    const swap = move.swap || null;
    const actorId = swap && this.fighters[swap.out] ? swap.out : this.activeId;
    const actor = this.fighters[actorId];
    const enemy = this.enemySprite;
    const who = previous.creature || battle.creature;
    const mine = plantMove(actor.plant, move.creature, move.skill);
    const theirs = bossMove(state.boss.tier, move.boss);
    const palette = bossPalette(state.boss.tier);

    const healed = move.healed || 0;
    const bossLoss = previous.boss_hp - battle.boss_hp;
    const before = previous.plant === undefined || previous.plant === actorId ? previous.creature_hp : 0;
    const playerLoss = Math.max(0, (swap ? before : before - battle.creature_hp) + healed);
    const plantLands = bossLoss > 0;
    const tie = move.hit === "tie";
    const bossLands = playerLoss > 0 && !tie;
    const graze = tie ? playerLoss : 0;   // a tie costs the plant a little
    const shielded = move.boss === "attack" && !bossLands && mine.body === "guard";
    const above = () => ({ x: actor.x - 20, y: actor.y - actor.getHeight() * 0.8 });

    this.chosen = null;
    this.hold = {
      id: actorId, name: who, max: previous.creature_max_hp, hp: before, bossHp: previous.boss_hp,
      skill: previous.skill, enraged: previous.enraged,
    };

    // The turn is told like a story: "EMBER used VINE HAYMAKER!", a beat, the move, a word for
    // how it went, a pause, then the boss's line and its move.
    const sayPlant = () => {
      this.hud.announce(who, mine.name, actor.plant.glow, CALL + 500);
      this.hud.log(`${who} used ${mine.name}!`);
      audio.play("call");
      this.time.delayedCall(CALL, () => audio.play(move.skill ? "skill" : mine.body === "guard" ? "block" : "swing"));
    };
    const sayBoss = () => {
      this.hud.announce(state.boss.name, theirs.name, palette.main, CALL + 500);
      this.hud.log(move.bluffed ? `A bluff! ${state.boss.name} used ${theirs.name}!` : `${state.boss.name} used ${theirs.name}!`);
      audio.play(move.bluffed ? "bluff" : "call");
      if (move.bluffed) this.hud.word("BLUFF!", "#ff8f6b", BOSS.x - 20, BOSS.y - 330, 16);
    };
    const shout = (str, color) => this.hud.word(str, color, 640, 300, 24);
    const finisher = battle.boss_hp <= 0;

    const onBossHurt = () => {
      this.hold.bossHp = battle.boss_hp;
      this.refreshHud();
      this.flash(enemy);
      this.lunge(enemy, 26);
      audio.play(finisher || bossLoss >= 9 ? "crit" : "hit");
      this.hud.number(BOSS.x - 20, BOSS.y - 300, `-${bossLoss}`, "#fff48e", bossLoss >= 9);
      shout(finisher ? "KNOCKOUT!" : bossLoss >= 9 ? "CRITICAL HIT!" : move.skill ? "BOOM!" : "DIRECT HIT!", finisher ? "#ffd867" : "#fff48e");
      this.benchCheers();
    };
    const onPlantHurt = () => {
      this.hold.hp = swap ? 0 : battle.creature_hp;
      this.refreshHud();
      actor.play("hurt", { force: 1.3 });
      this.flash(actor);
      audio.play(move.heavy || playerLoss >= 12 ? "crit" : "hurt");
      this.hud.number(above().x, above().y, `-${playerLoss}`, "#ff8f90", playerLoss >= 9);
      shout(swap || battle.creature_hp <= 0 ? "KNOCKED OUT!" : move.heavy ? "HEAVY HIT!" : playerLoss >= 12 ? "CRUNCH!" : "OUCH!", "#ff8f90");
      if (move.heavy || playerLoss >= 12) this.kit.shake(260, 0.012);
    };
    // The boss's move starts now. Returns when its blow arrives.
    const bossGoes = (blocked, meet = null) => playBossFx(theirs.fx, this.bossCtx(actor, bossLands, blocked, meet));
    const reach = () => {
      if (!plantLands) return 0.42;
      return mine.reach === "boss" ? (BOSS.x - 235 - FIGHTER.x) / actor.getHeight() : 0.85;
    };

    let length;
    if (shielded) {
      // the boss is called first, then the plant; the shield goes up just in time
      sayBoss();
      this.time.delayedCall(CALL, sayPlant);
      const go = CALL * 2;
      const blow = go + BOSS_BLOW;                    // about when the boss's blow arrives
      this.time.delayedCall(go, () => bossGoes(true));
      const options = { ms: mine.ms, delay: 0 };
      options.delay = Math.max(0, blow - actor.hitTime(mine.body, options));
      actor.play(mine.body, options);
      const extra = playBattleFx(mine.fx, this.plantCtx(actor, blow, plantLands));
      this.time.delayedCall(blow, () => { shout("BLOCKED!", "#bfe6ff"); this.lunge(enemy, 40, 160); audio.play("block"); });
      if (plantLands) this.time.delayedCall(blow + extra + 380, onBossHurt);
      length = blow + extra + 1000;
    } else if (tie) {
      // both are called, then they go at once: they meet in the middle, and the plant is grazed
      sayPlant();
      this.time.delayedCall(CALL, sayBoss);
      const go = CALL * 2;
      const options = { ms: mine.ms, delay: go, reach: reach() };
      actor.play(mine.body, options);
      const hitAt = actor.hitTime(mine.body, options);
      playBattleFx(mine.fx, this.plantCtx(actor, hitAt, false));
      const mid = { x: (FIGHTER.x + BOSS.x) / 2 + 30, y: FIGHTER.y - 240 };
      this.time.delayedCall(go, () => bossGoes(false, mid));
      const meet = Math.max(hitAt, go + BOSS_BLOW);
      this.time.delayedCall(meet, () => {
        this.kit.impact(mid.x, mid.y, { power: 1.1, color: 0xd7e3ff });
        shout(move.creature === "guard" ? "STANDOFF!" : "CLASH!", "#d7e3ff");
        audio.play("clash");
        if (graze > 0) {
          this.hold.hp = swap ? 0 : battle.creature_hp;
          this.refreshHud();
          actor.play("hurt", { force: 0.7 });
          this.hud.number(above().x, above().y, `-${graze}`, "#ff8f90");
        }
      });
      length = meet + 800;
    } else {
      sayPlant();
      const options = { ms: mine.ms, delay: CALL, reach: reach() };
      actor.play(mine.body, options);
      const hitAt = actor.hitTime(mine.body, options);
      const extra = playBattleFx(mine.fx, this.plantCtx(actor, hitAt, plantLands));
      const landed = hitAt + extra;
      if (plantLands) this.time.delayedCall(landed, onBossHurt);
      else if (!healed) this.time.delayedCall(landed, () => { shout(mine.body === "guard" ? "NOTHING TO BLOCK!" : "IT FAILED!", "#c9d2e8"); audio.play("miss"); });
      if (healed > 0) {
        this.time.delayedCall(hitAt, () => {
          this.hold.hp = Math.min(this.hold.max, this.hold.hp + healed);
          this.refreshHud();
          this.hud.number(above().x, above().y, `+${healed}`, "#8dff9b");
          audio.play("heal");
        });
      }
      if (finisher) {
        length = landed + 700;               // that was the last blow: the boss has no answer
      } else {
        const bossSays = landed + PAUSE;
        this.time.delayedCall(bossSays, sayBoss);
        this.time.delayedCall(bossSays + CALL, () => {
          const blow = bossGoes(false);
          this.time.delayedCall(blow, bossLands ? onPlantHurt : () => { shout("NO EFFECT!", "#c9d2e8"); audio.play("miss"); });
        });
        length = bossSays + CALL + BOSS_BLOW + (bossLands ? 620 : 420);
      }
    }

    // a plant that runs out of health tips over; if the other one is ready, the dragon sends it in
    if (swap || battle.creature_hp <= 0) this.time.delayedCall(length - 60, () => audio.play("faint"));
    if (swap) { this.swapFighter(swap.out, swap.in, length - 60); length += 1500; }
    else if (battle.creature_hp <= 0) this.time.delayedCall(length - 60, () => actor.setMood("fainted"));

    // at half health the boss loses its temper: from now on it hits harder and its tells are shakier
    if (move.enraged) {
      this.time.delayedCall(length, () => {
        if (this.result) return;
        this.hold.enraged = true;
        this.refreshHud();
        if (enemy.roar) enemy.roar();
        audio.play("roar");
        audio.setRage(true);
        this.kit.flash(palette.main, 0.35, 260);
        this.kit.shake(420, 0.014);
        this.kit.ring(BOSS.x, BOSS.y, { from: 60, to: 520, squash: 0.3, color: palette.hot, thick: 10, ms: 520, layer: "back" });
        this.hud.word("ENRAGED!", "#ff6b5b", BOSS.x - 20, BOSS.y - 300, 24);
        this.hud.log(`${state.boss.name} is enraged! It hits harder and bluffs more.`);
      });
      length += 1000;
    }

    this.busyUntil = this.time.now + length;
    this.time.delayedCall(length + 20, () => {
      this.hold = null;
      this.refreshHud();
      if (!this.result && battle.skill?.ready && !previous.skill?.ready && !move.swap) audio.play("charged");
      if (!this.result && this.serverState?.battle?.awaiting_move) this.hud.log("Read the wind-up. Choose a move.");
    });
  }

  // The plant on the bench is glad when its friend lands a hit.
  benchCheers() {
    for (const id of PLANT_IDS) {
      const rig = this.fighters[id];
      if (id !== this.activeId && rig.visible && rig.getMood() !== "fainted") rig.play("hop", { height: 0.16 });
    }
  }

  // --------------------------------------------------
  // THE END OF THE FIGHT
  // --------------------------------------------------

  showResult(won, state) {
    if (this.result) { if (won && state.reward) this.showReward(state.reward); return; }
    this.result = won ? "win" : "loss";
    // the last blow plays out before anything is announced
    const wait = Math.max(0, this.busyUntil - this.time.now);
    this.resultShownAt = this.time.now + wait + (won ? 900 : 300);
    this.refreshHud();
    this.time.delayedCall(wait, () => {
      this.hold = null;
      this.refreshHud();
      audio.music(null);
      if (won) { this.dissolveBoss(); this.kit.at(520, () => audio.play("boom")); }
      else { if (this.enemySprite.roar) this.enemySprite.roar(); audio.play("roar"); }
      // the plants: a win has them bouncing, a loss leaves them flat out
      PLANT_IDS.forEach((id, i) => {
        const rig = this.fighters[id];
        if (!rig.visible) return;
        if (!won) { rig.setMood("fainted"); return; }
        if (rig.getMood() === "fainted") return;
        rig.setMood("proud");
        rig.emote(i % 2 ? "heart" : "sparkle", 1800);
        for (let n = 0; n < 3; n++) rig.play("cheer", { delay: 200 + i * 220 + n * 950 });
      });
      this.time.delayedCall(won ? 900 : 300, () => {
        this.resultPanel = this.hud.result(won, won ? "The drought boss has retreated." : "No water this time.");
        audio.play(won ? "victory" : "defeat");
        if (won) { this.confetti(); this.showReward(this.serverState && this.serverState.reward); }
      });
    });
  }

  // The boss comes apart: it shudders, cracks with light, and bursts.
  dissolveBoss() {
    const enemy = this.enemySprite;
    const palette = bossPalette(this.enemyTier || 1);
    const x = BOSS.x - 20, y = BOSS.y - 150;
    this.tweens.add({ targets: enemy, x: enemy.x + 7, duration: 45, yoyo: true, repeat: 9 });
    for (let i = 0; i < 6; i++) {
      this.kit.at(i * 80, () => {
        const px = x + this.kit.rand(-90, 90), py = y + this.kit.rand(-130, 120);
        this.kit.star(px, py, { size: 46, color: 0xffffff, ms: 180 });
        this.kit.glow(px, py, { r: 70, color: palette.hot, alpha: 0.6, ms: 220 });
      });
    }
    this.kit.at(520, () => {
      enemy.setVisible(false);
      this.kit.flash(0xffffff, 0.75, 240);
      this.kit.shake(380, 0.016);
      this.kit.impact(x, y, { power: 2, color: palette.hot, color2: palette.main, shape: "petal" });
      this.kit.ring(BOSS.x, BOSS.y, { from: 60, to: 560, squash: 0.3, color: 0xffffff, thick: 12, ms: 560, layer: "back" });
      this.kit.burst(x, y, { count: 60, colors: [palette.main, palette.hot, 0xf2aa62, 0xffd676], shape: "petal", speed: [200, 900], size: [12, 28], life: [700, 1400], gravity: 700, spin: [-8, 8] });
      this.kit.burst(x, y, { count: 30, colors: [0xffffff, palette.core, palette.hot], shape: "star", speed: [100, 500], size: [8, 18], life: [600, 1200], gravity: -60, add: true });
    });
  }

  confetti() {
    this.kit.burst(640, 120, { count: 70, colors: [0xffd867, 0x8dff9b, 0x7fd0ff, 0xff8f9c, 0xffffff], shape: "sq", speed: [200, 760], angle: Math.PI / 2, spread: 3.4, size: [8, 14], life: [1400, 2400], gravity: 420, drag: 0.97, spin: [-10, 10], stretch: 1.8 });
  }

  showReward(reward) {
    if (!this.resultPanel) return;
    if (!reward) { this.resultPanel.setLine("No water sent: the pot is wet, or the cube is offline."); return; }
    if (!this.waterPlayed) { this.waterPlayed = true; this.time.delayedCall(1300, () => audio.play("water", reward.size / 1000)); }
    const seconds = (reward.size / 1000).toFixed(1);
    this.resultPanel.setLine(`Water for plant ${reward.plant}: pump runs ${seconds} s`);
    this.resultPanel.reward(`Watering plant ${reward.plant}`, reward.size);
  }

  leaveWhenReady() {
    if (this.leaving) return;
    const remaining = this.result ? 2500 - (this.time.now - this.resultShownAt) : 0;
    if (remaining > 0) {
      this.time.delayedCall(remaining, () => this.leaveWhenReady());
      return;
    }
    const adventure = this.scene.get("AdventureScene");
    if (!adventure || !adventure.scene.isSleeping()) return;
    this.leaving = true;
    this.cameras.main.fadeOut(350);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { this.scene.stop(); this.scene.wake("AdventureScene"); });
  }

  // --------------------------------------------------
  // ANIMATION
  // --------------------------------------------------

  update(time, delta) {
    if (!this.skyClouds) return;

    const dt = Math.min(delta, 50) / 16.67;

    this.skyClouds.forEach(({ cloud, speed }) => {
      cloud.x += speed * dt;

      if (cloud.x > 1450) {
        cloud.x = -200;
      }
    });
  }
}
