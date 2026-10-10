import Phaser from "phaser";

// Plant Storage — 800 x 450 pixel-art scene.
// Put the supplied 70x70 PNGs at:
// public/plants/cast_iron.png and public/plants/monstera.png
const SAMPLE_PLANTS = [
  { id: "cast-iron", name: "CAST IRON PLANT", image: "cast-iron-plant", level: 5, water: 30, light: 80, health: 90 },
  { id: "monstera", name: "MONSTERA DELICIOSA", image: "monstera-plant", level: 3, water: 70, light: 80, health: 95 },
];

const C = {
  soil: 0x553323, dark: 0x38251e, soilLight: 0x75472c,
  outline: 0x2c1d19, wood: 0x9b5935, woodLight: 0xd39157,
  parchment: 0xf3d8ac, cream: 0xfff1d8, ink: "#35241e",
  water: 0x4faee6, light: 0xf1bd48, health: 0x81c75d,
};

export default class StorageScene extends Phaser.Scene {
  constructor() {
    super({ key: "StorageScene" });
  }

  preload() {
    this.load.image("cast-iron-plant", "/assets/plants/cast_iron.png");
    this.load.image("monstera-plant", "/assets/plants/monstera.png");
  }

  create() {
    this.cameras.main.setBackgroundColor(C.soil);
    this.drawGround();
    this.drawHeader();

    // Positions: each plant has a stat card, sprite, and speech bubble.
    this.addPlant(SAMPLE_PLANTS[0], 212, 0);
    this.addPlant(SAMPLE_PLANTS[1], 588, 1);

    this.add.text(400, 432, "YOUR LITTLE GREEN FRIENDS", {
      fontFamily: "monospace", fontSize: "10px", color: "#d9b58a",
    }).setOrigin(0.5).setDepth(5);
  }

  drawGround() {
    const g = this.add.graphics();
    g.fillStyle(C.soil, 1).fillRect(0, 0, 800, 450);

    // Deterministic texture: looks the same each visit.
    let seed = 2317;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const specks = [0x42291f, 0x6b402a, 0x805038, 0x493022];
    for (let i = 0; i < 950; i++) {
      const x = Math.floor(rand() * 800 / 4) * 4;
      const y = Math.floor(rand() * 450 / 4) * 4;
      g.fillStyle(specks[Math.floor(rand() * specks.length)], 0.65);
      g.fillRect(x, y, 3 + Math.floor(rand() * 5), 2 + Math.floor(rand() * 3));
    }

    // Border vines, grass, stones and small flowers.
    for (let i = 0; i < 25; i++) {
      const x = Math.floor(rand() * 800);
      const y = i < 13 ? 65 + Math.floor(rand() * 45) : 386 + Math.floor(rand() * 53);
      this.drawGrass(g, x, y, 0x46683a);
    }
    for (const [x, y, s] of [[26, 185, 1], [769, 176, 1], [58, 393, 1.2], [736, 405, 1.3], [386, 400, 0.9]]) {
      this.drawRock(g, x, y, s);
    }
    for (const [x, y] of [[95, 400], [700, 383], [30, 106], [766, 95]]) {
      g.fillStyle(0x6c8c44).fillRect(x - 2, y - 8, 4, 14);
      g.fillStyle(0xffdb89).fillRect(x - 4, y - 12, 9, 9);
      g.fillStyle(0xffffff).fillRect(x - 1, y - 9, 3, 3);
    }

    // Ground strip behind the pots.
    g.fillStyle(0x432a20, 0.45).fillRect(0, 364, 800, 14);
    g.lineStyle(2, 0x895a39, 0.55).lineBetween(0, 376, 800, 376);
  }

  drawGrass(g, x, y, color) {
    g.fillStyle(color);
    g.fillTriangle(x, y, x - 9, y - 11, x - 3, y);
    g.fillTriangle(x, y, x + 3, y - 16, x + 5, y);
    g.fillTriangle(x, y, x + 12, y - 9, x + 7, y);
  }

  drawRock(g, x, y, scale) {
    g.fillStyle(0x302923).fillEllipse(x, y + 5 * scale, 38 * scale, 11 * scale);
    g.fillStyle(0x806e5f).fillEllipse(x, y, 33 * scale, 19 * scale);
    g.fillStyle(0xa08a76).fillEllipse(x - 5 * scale, y - 4 * scale, 17 * scale, 6 * scale);
  }

  drawFrame(x, y, width, height, fill = C.parchment) {
    const g = this.add.graphics();
    g.fillStyle(C.outline).fillRoundedRect(x - 4, y - 4, width + 8, height + 8, 7);
    g.fillStyle(C.woodLight).fillRoundedRect(x - 2, y - 2, width + 4, height + 4, 5);
    g.fillStyle(C.wood).fillRoundedRect(x + 2, y + 2, width - 4, height - 4, 4);
    g.fillStyle(fill).fillRoundedRect(x + 6, y + 6, width - 12, height - 12, 3);
    return g;
  }

  drawHeader() {
    this.drawFrame(195, 13, 410, 55, C.wood);
    this.add.text(400, 40, "PLANT STORAGE", {
      fontFamily: "monospace", fontSize: "27px", fontStyle: "bold",
      color: "#fff0d3", stroke: "#422619", strokeThickness: 5,
    }).setOrigin(0.5);

    this.drawFrame(669, 19, 110, 42, C.wood);
    const back = this.add.text(724, 40, "< BACK", {
      fontFamily: "monospace", fontSize: "17px", fontStyle: "bold", color: "#fff0d3",
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on("pointerover", () => back.setColor("#ffe08a"));
    back.on("pointerout", () => back.setColor("#fff0d3"));
    back.on("pointerdown", () => {
      const navigate = this.game.registry.get("navigate");
      if (typeof navigate === "function") navigate("/adventure");
      else this.scene.start("AdventureScene");
    });
  }

  drawCloud(centerX, centerY, message, index) {
  const container = this.add.container(centerX, centerY);

  const g = this.add.graphics();

  const outline = 0x35241e;
  const cloudColor = 0xfff1d8;

  // Draw cloud from overlapping circles
  const circles = [
    [-85, 0, 27],
    [-65, -20, 31],
    [-30, -28, 34],
    [10, -30, 35],
    [48, -24, 33],
    [80, -7, 29],
    [65, 15, 28],
    [25, 22, 32],
    [-20, 23, 30],
    [-65, 17, 26]
  ];

  // Dark outline
  g.fillStyle(outline);
  circles.forEach(([x, y, r]) => {
    g.fillCircle(x, y, r + 3);
  });

  // Cream-colored cloud
  g.fillStyle(cloudColor);
  circles.forEach(([x, y, r]) => {
    g.fillCircle(x, y, r);
  });

  // Cloud tail pointing toward plant
  g.fillStyle(outline);
  g.fillTriangle(-5, 32, 18, 32, 5, 49);

  g.fillStyle(cloudColor);
  g.fillTriangle(-3, 29, 15, 29, 5, 43);

  container.add(g);

  // Message
  const text = this.add.text(0, -3, message, {
    fontFamily: "monospace",
    fontSize: "14px",
    fontStyle: "bold",
    color: "#35241e",
    align: "center",
    wordWrap: { width: 175 }
  }).setOrigin(0.5);

  container.add(text);

  // Cloud floating animation
  this.tweens.add({
    targets: container,
    y: centerY - 5,
    duration: 900 + index * 150,
    ease: "Sine.easeInOut",
    yoyo: true,
    repeat: -1
  });

  // Gentle giggling / wobbling
  this.tweens.add({
    targets: container,
    angle: index === 0 ? 2 : -2,
    scaleX: 1.025,
    scaleY: 0.975,
    duration: 420,
    ease: "Sine.easeInOut",
    yoyo: true,
    repeat: -1
  });

  return container;
  }

  getMessage(plant) {
    if (plant.health < 40) return "I don't feel well!";
    if (plant.water < 40) return "I need more water!";
    if (plant.light < 40) return "I need more light!";
    return "I am happy now!";
  }

  addPlant(plant, centerX, index) {
    const cardX = centerX - 138;
    const cardY = 295;
    const cardW = 276;
    const cardH = 119;
    const msg = this.getMessage(plant);

    // Speech bubble and small tail.
    this.drawCloud(centerX, 115, msg, index);

    // Plant sprite. Uses the exact provided 70x70 PNG, scaled up with pixelArt rendering.
    const sprite = this.add.image(centerX, 228, plant.image).setScale(1.75);
    sprite.setOrigin(0.5);
    // Small continuous playful wobble, not a full rotation.
    this.tweens.add({
      targets: sprite,
      y: 224,
      angle: index === 0 ? 2.5 : -2.5,
      duration: 650 + index * 120,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    // Tiny animated giggle marks on both sides.
    const giggle = this.add.text(centerX + 68, 246, "♪", {
      fontFamily: "monospace", fontSize: "18px", color: "#ffcc72",
    }).setOrigin(0.5);
    this.tweens.add({ targets: giggle, y: 237, alpha: 0.2, duration: 820, yoyo: true, repeat: -1 });

    this.drawFrame(cardX, cardY, cardW, cardH);
    this.add.text(centerX, cardY + 20, plant.name, {
      fontFamily: "monospace", fontSize: "16px", fontStyle: "bold", color: C.ink,
    }).setOrigin(0.5);
    this.add.text(cardX + 19, cardY + 41, `LV. ${plant.level}`, {
      fontFamily: "monospace", fontSize: "12px", fontStyle: "bold", color: "#76523a",
    });
    this.drawMeter(cardX + 20, cardY + 43, "HP", plant.health, C.health, 100);
    this.drawMeter(cardX + 20, cardY + 64, "WATER", plant.water, C.water, 100);
    this.drawMeter(cardX + 20, cardY + 85, "LIGHT", plant.light, C.light, 100);
  }

  drawMeter(x, y, label, value, color, barWidth = 100) {
    const safe = Phaser.Math.Clamp(value, 0, 100);
    const labelWidth = 58;
    this.add.text(x, y - 2, label, {
      fontFamily: "monospace", fontSize: "11px", fontStyle: "bold", color: C.ink,
    });
    const bx = x + labelWidth;
    const g = this.add.graphics();
    g.fillStyle(0x6e4b38).fillRect(bx - 1, y - 1, barWidth + 2, 12);
    g.fillStyle(0xe4c9a4).fillRect(bx, y, barWidth, 10);
    g.fillStyle(color).fillRect(bx, y, Math.round(barWidth * safe / 100), 10);
    g.fillStyle(0xffffff, 0.24).fillRect(bx, y, Math.round(barWidth * safe / 100), 3);
    this.add.text(bx + barWidth + 5, y - 2, `${safe}%`, {
      fontFamily: "monospace", fontSize: "10px", color: C.ink,
    });
  }
}
