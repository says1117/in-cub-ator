import Phaser from "phaser";
import { getAllPlants, getPlantById, subscribe } from "../state/plantStore.js";

export default class BossScene extends Phaser.Scene {
  constructor() {
    super({ key: "BossScene" });
  }

  init(data = {}) {
    this.selectedPlantId = data.plantId ?? null;
  }

  // Map backend plant fields into the existing battle HUD.
  makePlayer(plant) {
    const number = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const hp = Math.max(0, number(plant.hp ?? plant.health, 100));
    const water = Phaser.Math.Clamp(number(plant.soilMoisture ?? plant.soil_moisture ?? plant.water, 0), 0, 100);
    const light = Phaser.Math.Clamp(number(plant.lightIntensity ?? plant.light_intensity ?? plant.light, 0), 0, 100);
    return {
      plantId: plant.plantId ?? plant.id,
      name: plant.name ?? plant.species ?? "Plant",
      species: plant.species ?? "",
      level: number(plant.level, 1),
      hp, maxHp: Math.max(100, number(plant.maxHp ?? plant.max_hp, 100), hp),
      water, maxWater: 100,
      light, maxLight: 100,
      co2: 20, maxCo2: 20
    };
  }

  // Preserve combat-only changes when fresh sensor data arrives.
  applyServerPlant(plant) {
    if (!plant || this.finished) return;
    const next = this.makePlayer(plant);
    if (this.player) {
      next.hp = Phaser.Math.Clamp(next.hp + this.combatHpDelta, 0, next.maxHp);
      next.water = Phaser.Math.Clamp(next.water + this.combatWaterDelta, 0, 100);
      next.light = Phaser.Math.Clamp(next.light + this.combatLightDelta, 0, 100);
      next.co2 = this.player.co2;
    }
    this.player = next;
    if (this.playerNameText) this.playerNameText.setText(next.name);
    if (this.playerLevelText) this.playerLevelText.setText(`Lv. ${next.level}`);
    if (this.playerHP) this.updateHUD();
  }

  preload() {
    // Optional character sprites.
    // Missing sprites are replaced with generated characters.
    this.load.image("boss-minty", "../public/assets/characters/monstera.png");
    this.load.image("boss-caterpillar", "../public/assets/bosses/catarpillar.png");
  }

  create() {
    this.W = 1280;
    this.H = 720;

    this.cameras.main.setBackgroundColor("#477da9");

    const available = getAllPlants();
    const selected = (this.selectedPlantId && getPlantById(this.selectedPlantId)) || available[0];
    this.combatHpDelta = 0;
    this.combatWaterDelta = 0;
    this.combatLightDelta = 0;
    this.player = selected ? this.makePlayer(selected) : null;
    this.activePlantId = selected?.plantId ?? selected?.id ?? this.selectedPlantId;

    this.enemy = {
      name: "Caterpillar",
      level: 8,
      hp: 100,
      maxHp: 100,
      stamina: 70,
      maxStamina: 70
    };

    this.busy = false;
    this.finished = false;
    this.turn = 1;
    this.boost = false;

    // One root container controls scaling.
    this.root = this.add.container(0, 0);

    // Explicit rendering order.
// Explicit rendering order.
this.skyLayer = this.add.container(0, 0);
this.forestLayer = this.add.container(0, 0);
this.auraLayer = this.add.container(0, 0); // NEW
this.actorLayer = this.add.container(0, 0);
this.uiLayer = this.add.container(0, 0);
this.effectLayer = this.add.container(0, 0);

this.root.add([
  this.skyLayer,
  this.forestLayer,
  this.auraLayer,  // Behind the characters
  this.actorLayer,
  this.uiLayer,
  this.effectLayer
]);


    this.buildWorld();
    this.buildActors();
    this.buildHUD();
    this.buildMoves();

    this.message(this.player
      ? `A wild Caterpillar appeared! ${this.player.name}, choose a move.`
      : "Waiting for plant data from server...");

    this.unsubscribePlants = subscribe((plants) => {
      const plant = plants.find(p => (p.plantId ?? p.id) === this.activePlantId)
        ?? (!this.activePlantId ? plants[0] : null);
      if (!plant) return;
      this.activePlantId = plant.plantId ?? plant.id;
      this.applyServerPlant(plant);
      if (this.logText && !this.busy && !this.finished) {
        this.message(`Ready: ${this.player.name}. Choose a move.`);
      }
    });

    this.scale.on("resize", this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
      this.unsubscribePlants?.();
      this.unsubscribePlants = null;
    });

    this.onResize();
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

  buildWorld() {
    const rng = new Phaser.Math.RandomDataGenerator([
      "root-cellar-forest-v5"
    ]);

    // Sky is isolated from all other scene elements.
    this.drawDetailedSky(rng);

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
    alpha: 0.85,
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

    // RUBBLE AROUND THE WALL
    for (let i = 0; i < 12; i++) {
      const rx = x + rng.between(-25, Math.floor(w + 25));
      const ry = y + h + rng.between(0, 24);
      const size = rng.between(5, 14);

      px(rx - 2, ry + 3, size + 5, 5, C.outline, 0.55);
      px(rx, ry - size / 2, size, size / 2 + 4,
        rng.pick([C.stone, C.light, C.shadow]));
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

  px(x, y, pillarW, h, dark);
  px(x + 5 * scale, y + 5 * scale,
    pillarW - 10 * scale, h - 10 * scale, stone);

  px(x + w - pillarW, y, pillarW, h, dark);
  px(x + w - pillarW + 5 * scale, y + 5 * scale,
    pillarW - 10 * scale, h - 10 * scale, stone);

  px(x - 8 * scale, y - 20 * scale,
    w + 16 * scale, 40 * scale, dark);
  px(x - 3 * scale, y - 16 * scale,
    w + 6 * scale, 28 * scale, stone);

  px(x, y - 16 * scale, w, 5 * scale, light);

  for (let i = 1; i < 5; i++) {
    px(x + i * w / 5, y - 15 * scale,
      4 * scale, 25 * scale, dark);
  }

  for (let i = 0; i < 20; i++) {
    const mx = x + (i * 37 % Math.floor(w));
    const my = y - 20 * scale + (i % 3) * 5 * scale;
    px(mx, my, 12 * scale, 6 * scale, moss);
  }

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
// BATTLE UI
// --------------------------------------------------

panel(x, y, w, h, edge = 0x50618d) {
  this.rect(
    x + 5, y + 6, w, h,
    0x111322, 0.5, 0, this.uiLayer
  );

  this.rect(
    x, y, w, h,
    0x151d37, 1, edge, this.uiLayer
  );
}

bar(x, y, w, h, color) {
  this.rect(
    x, y, w, h,
    0x080f23, 1, 0x67718c, this.uiLayer
  );

  const fill = this.rect(
    x + 4, y + 4, w - 8, h - 8,
    color, 1, 0, this.uiLayer
  );

  return { fill, maxWidth: w - 8 };
}

setBar(bar, ratio) {
  bar.fill.width = Math.max(
    0,
    bar.maxWidth * Phaser.Math.Clamp(ratio, 0, 1)
  );
}

buildHUD() {
  // Enemy HUD.
  this.panel(760, 28, 492, 158, 0xf17b80);

  this.text(787, 46, "Caterpillar", 32);
  this.text(1125, 51, "Lv. 8", 23, "#cbd4ff");

  this.text(784, 100, "HP", 23, "#ff7777");
  this.enemyHP = this.bar(865, 104, 260, 24, 0x63e67c);
  this.enemyHPText = this.text(1140, 101, "100/100", 18);

  this.text(784, 139, "STA", 21, "#6fd5ff");
  this.enemySTA = this.bar(865, 143, 260, 20, 0x51c8fa);
  this.enemySTAText = this.text(1140, 140, "70/70", 18);

  // Player HUD.
  this.panel(24, 551, 556, 153, 0x79dcb0);

  this.playerNameText = this.text(
    48, 568, this.player?.name ?? "Loading...", 32
  );
  this.playerLevelText = this.text(
    445, 574, `Lv. ${this.player?.level ?? "--"}`,
    21, "#cbd4ff"
  );

  this.text(49, 614, "HP", 19, "#ff7878");
  this.playerHP = this.bar(151, 614, 285, 18, 0x6bea86);
  this.playerHPText = this.text(449, 608, "29/29", 19);

  this.text(49, 642, "WATER", 18, "#68cfff");
  this.playerWater = this.bar(151, 642, 285, 17, 0x51c7ff);
  this.waterText = this.text(449, 638, "25/25", 18);

  this.text(49, 670, "SUN", 18, "#ffe077");
  this.playerLight = this.bar(151, 670, 285, 17, 0xffd85e);
  this.lightText = this.text(449, 666, "24/24", 18);

  this.panel(23, 20, 420, 74, 0x77b8b0);
  this.text(42, 31, "ROOT CELLAR", 27);
  this.text(
    42, 65,
    "BOSS BATTLE  •  ROOM 2/5",
    15, "#c8d7ef"
  );

  // Battle log.
  this.panel(585, 626, 270, 78, 0x5d739e);

  this.logText = this.text(
    602, 642, "", 16, "#e6f0ff",
    { wordWrap: { width: 239 } }
  );

  this.updateHUD();

  if (!this.player) {
    this.playerHPText.setText("--");
    this.waterText.setText("--");
    this.lightText.setText("--");
  }
}

buildMoves() {
  const moves = [
    {
      name: "WATER",
      sub: "Restore water • +HP",
      color: 0x236aab,
      key: "water"
    },
    {
      name: "SUNLIGHT",
      sub: "Restore sunlight • +HP",
      color: 0xa87327,
      key: "sun"
    },
    {
      name: "CO₂",
      sub: "Boost next leaf attack",
      color: 0x357e4b,
      key: "co2"
    },
    {
      name: "LEAF FLURRY",
      sub: "Damage enemy • costs resources",
      color: 0x3a9254,
      key: "leaf"
    }
  ];

  this.moveButtons = [];

  moves.forEach((move, i) => {
    const x = 710 + (i % 2) * 281;
    const y = 477 + Math.floor(i / 2) * 111;
    const w = 272;
    const h = 99;

    const bg = this.rect(
      x, y, w, h,
      move.color, 1, 0x172441, this.uiLayer
    );

    this.text(x + 19, y + 14, move.name, 22);

    this.text(
      x + 19, y + 56,
      move.sub, 12, "#f3f2dd",
      { wordWrap: { width: 235 } }
    );

    const hit = this.add.zone(x, y, w, h)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });

    this.uiLayer.add(hit);

    hit.on("pointerover", () => {
      bg.setStrokeStyle(4, 0xffe680);
    });

    hit.on("pointerout", () => {
      bg.setStrokeStyle(3, 0x172441);
    });

    hit.on("pointerdown", () => {
      this.useMove(move.key);
    });

    this.moveButtons.push({ hit, bg });
  });
}

buildActors() {
  this.drawBattleAura(350, 493, 0x9df6ba, 1.0);
  this.drawBattleAura(915, 355, 0xff9868, 1.15);

  this.ellipse(
    340, 596, 245, 40,
    0x172b25, 0.38, this.actorLayer
  );

  this.ellipse(
    907, 457, 295, 37,
    0x172b25, 0.36, this.actorLayer
  );

  if (this.textures.exists("boss-minty")) {
    this.playerSprite = this.add.image(
      350, 493, "boss-minty"
    ).setDisplaySize(265, 285);
  } else {
    this.playerSprite = this.makeMinty(350, 490);
  }

  if (this.textures.exists("boss-caterpillar")) {
    this.enemySprite = this.add.image(
      905, 352, "boss-caterpillar"
    ).setDisplaySize(335, 235);
  } else {
    this.enemySprite = this.makeCaterpillar(915, 355);
    this.enemySprite.setScale(0.85);
  }

  this.actorLayer.add([
    this.playerSprite,
    this.enemySprite
  ]);

  this.tweens.add({
    targets: this.playerSprite,
    y: this.playerSprite.y - 7,
    duration: 1200,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut"
  });

  this.tweens.add({
    targets: this.enemySprite,
    y: this.enemySprite.y - 5,
    scaleY: this.enemySprite.scaleY * 1.025,
    duration: 1050,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut"
  });
}

// --------------------------------------------------
// BATTLE MECHANICS
// --------------------------------------------------

message(str) {
  this.logText.setText(str);
}

updateHUD() {
  const p = this.player;
  const e = this.enemy;

  if (!p) return;

  this.setBar(this.playerHP, p.hp / p.maxHp);
  this.setBar(this.playerWater, p.water / p.maxWater);
  this.setBar(this.playerLight, p.light / p.maxLight);

  this.setBar(this.enemyHP, e.hp / e.maxHp);
  this.setBar(this.enemySTA, e.stamina / e.maxStamina);

  this.playerHPText.setText(
    `${Math.round(p.hp)}/${Math.round(p.maxHp)}`
  );
  this.waterText.setText(
    `${Math.round(p.water)}/${p.maxWater}`
  );
  this.lightText.setText(
    `${Math.round(p.light)}/${p.maxLight}`
  );

  this.enemyHPText.setText(`${e.hp}/${e.maxHp}`);
  this.enemySTAText.setText(`${e.stamina}/${e.maxStamina}`);

  this.enemyHP.fill.fillColor =
    e.hp / e.maxHp < 0.25 ? 0xf46b65 : 0x63e67c;
}

floating(x, y, label, color = "#ffffff") {
  const t = this.text(
    x, y, label, 30, color, {}, this.effectLayer
  );

  this.tweens.add({
    targets: t,
    y: y - 65,
    alpha: 0,
    duration: 950,
    onComplete: () => t.destroy()
  });
}

flash(sprite) {
  this.tweens.add({
    targets: sprite,
    alpha: 0.25,
    duration: 100,
    yoyo: true,
    repeat: 2
  });
}

useMove(move) {
  if (this.busy || this.finished || !this.player) return;

  const p = this.player;
  const e = this.enemy;

  if (move === "leaf" && (p.water < 5 || p.light < 4)) {
    this.message("Need at least 5 water and 4 sunlight!");
    return;
  }

  this.busy = true;

  const oldHp = p.hp;
  const oldWater = p.water;
  const oldLight = p.light;

  if (move === "water") {
    p.water = Math.min(p.maxWater, p.water + 9);
    p.hp = Math.min(p.maxHp, p.hp + 4);

    this.message(`${p.name} drinks fresh water!`);
    this.floating(320, 410, "+ WATER", "#7edcff");

  } else if (move === "sun") {
    p.light = Math.min(p.maxLight, p.light + 9);
    p.hp = Math.min(p.maxHp, p.hp + 3);

    this.message(`${p.name} absorbs warm sunlight!`);
    this.floating(320, 410, "+ SUN", "#ffe180");

  } else if (move === "co2") {
    p.co2 = Math.min(p.maxCo2, p.co2 + 5);
    this.boost = true;

    this.message("CO₂ boost! Next Leaf Flurry is stronger.");
    this.floating(320, 410, "POWER UP", "#a2ffab");

  } else if (move === "leaf") {
    p.water -= 5;
    p.light -= 4;

    const damage =
      Phaser.Math.Between(16, 23) +
      (this.boost ? 12 : 0);

    this.boost = false;
    e.hp = Math.max(0, e.hp - damage);

    this.message(`Leaf Flurry dealt ${damage} damage!`);
    this.flash(this.enemySprite);
    this.floating(875, 240, `-${damage}`, "#fff48e");
  }

  // Combat changes stay local to this battle.
  this.combatHpDelta += p.hp - oldHp;
  this.combatWaterDelta += p.water - oldWater;
  this.combatLightDelta += p.light - oldLight;

  this.updateHUD();

  if (e.hp <= 0) {
    this.time.delayedCall(900, () => this.endBattle(true));
    return;
  }

  this.time.delayedCall(1150, () => this.enemyTurn());
}

enemyTurn() {
  if (this.finished || !this.player) return;

  const e = this.enemy;
  const p = this.player;

  let damage;

  if (e.stamina >= 12) {
    damage = Phaser.Math.Between(4, 7);
    e.stamina -= 12;

    this.message(
      `Caterpillar used Headbutt! -${damage} HP`
    );
  } else {
    damage = Phaser.Math.Between(2, 4);
    e.stamina = Math.min(e.maxStamina, e.stamina + 18);

    this.message(
      `Caterpillar rests and lunges! -${damage} HP`
    );
  }

  const oldHp = p.hp;
  p.hp = Math.max(0, p.hp - damage);
  this.combatHpDelta += p.hp - oldHp;

  this.flash(this.playerSprite);
  this.floating(310, 388, `-${damage}`, "#ff8f90");

  this.updateHUD();

  if (p.hp <= 0) {
    this.time.delayedCall(900, () => this.endBattle(false));
    return;
  }

  this.turn++;

  this.time.delayedCall(800, () => {
    this.busy = false;
    this.message(`Turn ${this.turn}: choose your next move.`);
  });
}

endBattle(won) {
  this.finished = true;
  this.busy = true;

  this.rect(
    0, 0, 1280, 720,
    0x050b1c, 0.72, 0, this.effectLayer
  );

  const x = 330;
  const y = 220;

  this.rect(
    x + 5, y + 6, 620, 260,
    0x111322, 0.5, 0, this.effectLayer
  );

  this.rect(
    x, y, 620, 260,
    0x151d37, 1,
    won ? 0x7de6a5 : 0xee7789,
    this.effectLayer
  );

  this.text(
    420, 259,
    won ? "VICTORY!" : "DEFEAT",
    48,
    won ? "#9dffb2" : "#ff9caa",
    {},
    this.effectLayer
  );

  this.text(
    395, 334,
    won
      ? `Caterpillar defeated! ${this.player.name} wins!`
      : `${this.player.name} fainted. Try again!`,
    22,
    "#ffffff",
    {},
    this.effectLayer
  );

  const button = this.rect(
    510, 405, 260, 52,
    0x447b78, 1, 0xc0ffdd, this.effectLayer
  ).setInteractive({ useHandCursor: true });

  this.text(
    548, 418,
    "RETRY BATTLE",
    22, "#ffffff", {}, this.effectLayer
  );

  button.on("pointerdown", () => {
    this.scene.restart({ plantId: this.activePlantId });
  });

  this.events.emit("battleComplete", {
    won,
    turns: this.turn,
    player: this.player,
    enemy: this.enemy
  });
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
























