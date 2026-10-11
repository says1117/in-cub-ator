import Phaser from "phaser";

// Plant Storage — 800 x 450
// Backend fields:
// plantId, nfcTagId, species, soilMoisture,
// lightIntensity, level, hp

import {
  getAllPlants,
  subscribe
} from "../state/plantStore.js";

const IMAGE_BY_SPECIES = {
  "cast iron plant": "cast-iron-plant",
  "aspidistra elatior": "cast-iron-plant",
  "monstera deliciosa": "monstera-plant",
};

// Display scale only, not a care threshold
const LIGHT_DISPLAY_MAX_LUX = 2000;

const C = {
  soil: 0x553323,
  dark: 0x38251e,
  soilLight: 0x75472c,
  outline: 0x2c1d19,
  wood: 0x9b5935,
  woodLight: 0xd39157,
  parchment: 0xf3d8ac,
  cream: 0xfff1d8,
  ink: "#35241e",
  water: 0x4faee6,
  light: 0xf1bd48,
  health: 0x81c75d,
};

export default class StorageScene extends Phaser.Scene {
  constructor() {
    super({ key: "StorageScene" });
  }

  preload() {
    this.load.image(
      "cast-iron-plant",
      "/assets/plants/cast_iron.png"
    );

    this.load.image(
      "monstera-plant",
      "/assets/plants/monstera.png"
    );
  }

  create() {
    this.cameras.main.setBackgroundColor(C.soil);

    this.drawGround();
    this.drawHeader();

    this.plantLayer = this.add.container(0, 0);
    this.page = 0;
    this.plants = [];

    this.footer = this.add.text(
      400, 432,
      "YOUR LITTLE GREEN FRIENDS",
      {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#d9b58a",
      }
    ).setOrigin(0.5).setDepth(5);

    // Pagination buttons
    this.prevButton = this.add.text(
      30, 348, "<",
      {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#fff0d3",
      }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    this.nextButton = this.add.text(
      770, 348, ">",
      {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#fff0d3",
      }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    this.prevButton.on(
      "pointerdown",
      () => this.changePage(-1)
    );

    this.nextButton.on(
      "pointerdown",
      () => this.changePage(1)
    );

    // Listen for backend plant updates
    this.onPlantsChanged = (plants) => {
      this.plants = Array.isArray(plants) ? plants : [];

      this.page = Math.min(
        this.page,
        Math.max(
          0,
          Math.ceil(this.plants.length / 2) - 1
        )
      );

      this.renderPlants();
    };

    this.unsubscribe = subscribe(this.onPlantsChanged);

    this.onPlantsChanged(getAllPlants());

    // Stop listening when leaving this scene
    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => {
        if (typeof this.unsubscribe === "function") {
          this.unsubscribe();
        }
      }
    );
  }

  changePage(delta) {
    const lastPage = Math.max(
      0,
      Math.ceil(this.plants.length / 2) - 1
    );

    this.page = Phaser.Math.Clamp(
      this.page + delta,
      0,
      lastPage
    );

    this.renderPlants();
  }

  renderPlants() {
    // Clear old plant objects and animations
    this.plantLayer.each(child => {
      this.tweens.killTweensOf(child);
    });

    this.plantLayer.removeAll(true);

    const visible = this.plants.slice(
      this.page * 2,
      this.page * 2 + 2
    );

    if (visible.length === 0) {
      const empty = this.add.text(
        400, 225,
        "NO PLANTS REGISTERED YET",
        {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#fff0d3",
        }
      ).setOrigin(0.5);

      this.plantLayer.add(empty);
    }

    visible.forEach((plant, index) => {
      this.addPlant(
        plant,
        index === 0 ? 212 : 588,
        index
      );
    });

    const pages = Math.max(
      1,
      Math.ceil(this.plants.length / 2)
    );

    this.footer.setText(
      `YOUR LITTLE GREEN FRIENDS  •  ${this.page + 1}/${pages}`
    );

    this.prevButton.setVisible(this.page > 0);
    this.nextButton.setVisible(this.page < pages - 1);
  }

  track(object) {
    this.plantLayer.add(object);
    return object;
  }

  drawGround() {
    const g = this.add.graphics();

    g.fillStyle(C.soil, 1);
    g.fillRect(0, 0, 800, 450);

    // Deterministic soil texture
    let seed = 2317;

    const rand = () => {
      seed = (
        seed * 1664525 + 1013904223
      ) >>> 0;

      return seed / 4294967296;
    };

    const specks = [
      0x42291f,
      0x6b402a,
      0x805038,
      0x493022
    ];

    for (let i = 0; i < 950; i++) {
      const x = Math.floor(rand() * 800 / 4) * 4;
      const y = Math.floor(rand() * 450 / 4) * 4;

      g.fillStyle(
        specks[Math.floor(rand() * specks.length)],
        0.65
      );

      g.fillRect(
        x, y,
        3 + Math.floor(rand() * 5),
        2 + Math.floor(rand() * 3)
      );
    }

    // Grass decorations
    for (let i = 0; i < 25; i++) {
      const x = Math.floor(rand() * 800);

      const y = i < 13
        ? 65 + Math.floor(rand() * 45)
        : 386 + Math.floor(rand() * 53);

      this.drawGrass(g, x, y, 0x46683a);
    }

    // Rocks
    const rocks = [
      [26, 185, 1],
      [769, 176, 1],
      [58, 393, 1.2],
      [736, 405, 1.3],
      [386, 400, 0.9]
    ];

    for (const [x, y, s] of rocks) {
      this.drawRock(g, x, y, s);
    }

    // Flowers
    const flowers = [
      [95, 400],
      [700, 383],
      [30, 106],
      [766, 95]
    ];

    for (const [x, y] of flowers) {
      g.fillStyle(0x6c8c44);
      g.fillRect(x - 2, y - 8, 4, 14);

      g.fillStyle(0xffdb89);
      g.fillRect(x - 4, y - 12, 9, 9);

      g.fillStyle(0xffffff);
      g.fillRect(x - 1, y - 9, 3, 3);
    }

    // Ground strip
    g.fillStyle(0x432a20, 0.45);
    g.fillRect(0, 364, 800, 14);

    g.lineStyle(2, 0x895a39, 0.55);
    g.lineBetween(0, 376, 800, 376);
  }

  drawGrass(g, x, y, color) {
    g.fillStyle(color);

    g.fillTriangle(
      x, y,
      x - 9, y - 11,
      x - 3, y
    );

    g.fillTriangle(
      x, y,
      x + 3, y - 16,
      x + 5, y
    );

    g.fillTriangle(
      x, y,
      x + 12, y - 9,
      x + 7, y
    );
  }

  drawRock(g, x, y, scale) {
    g.fillStyle(0x302923);
    g.fillEllipse(
      x, y + 5 * scale,
      38 * scale, 11 * scale
    );

    g.fillStyle(0x806e5f);
    g.fillEllipse(
      x, y,
      33 * scale, 19 * scale
    );

    g.fillStyle(0xa08a76);
    g.fillEllipse(
      x - 5 * scale,
      y - 4 * scale,
      17 * scale,
      6 * scale
    );
  }

  drawFrame(
    x, y, width, height,
    fill = C.parchment
  ) {
    const g = this.add.graphics();

    g.fillStyle(C.outline);
    g.fillRoundedRect(
      x - 4, y - 4,
      width + 8, height + 8, 7
    );

    g.fillStyle(C.woodLight);
    g.fillRoundedRect(
      x - 2, y - 2,
      width + 4, height + 4, 5
    );

    g.fillStyle(C.wood);
    g.fillRoundedRect(
      x + 2, y + 2,
      width - 4, height - 4, 4
    );

    g.fillStyle(fill);
    g.fillRoundedRect(
      x + 6, y + 6,
      width - 12, height - 12, 3
    );

    if (this.drawingPlant) {
      this.track(g);
    }

    return g;
  }

  drawHeader() {
    this.drawFrame(
      195, 13, 410, 55, C.wood
    );

    this.add.text(
      400, 40,
      "PLANT STORAGE",
      {
        fontFamily: "monospace",
        fontSize: "27px",
        fontStyle: "bold",
        color: "#fff0d3",
        stroke: "#422619",
        strokeThickness: 5,
      }
    ).setOrigin(0.5);

    this.drawFrame(
      669, 19, 110, 42, C.wood
    );

    const back = this.add.text(
      724, 40,
      "< BACK",
      {
        fontFamily: "monospace",
        fontSize: "17px",
        fontStyle: "bold",
        color: "#fff0d3",
      }
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerover", () => {
      back.setColor("#ffe08a");
    });

    back.on("pointerout", () => {
      back.setColor("#fff0d3");
    });

    back.on("pointerdown", () => {
      window.location.assign("/");
    });
  }

  drawCloud(centerX, centerY, message, index) {
    const container = this.track(
      this.add.container(centerX, centerY)
    );

    const g = this.add.graphics();

    const outline = 0x35241e;
    const cloudColor = 0xfff1d8;

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

    // Cloud outline
    g.fillStyle(outline);

    circles.forEach(([x, y, r]) => {
      g.fillCircle(x, y, r + 3);
    });

    // Cream cloud
    g.fillStyle(cloudColor);

    circles.forEach(([x, y, r]) => {
      g.fillCircle(x, y, r);
    });

    // Thought cloud tail
    g.fillStyle(outline);
    g.fillTriangle(
      -5, 32,
      18, 32,
      5, 49
    );

    g.fillStyle(cloudColor);
    g.fillTriangle(
      -3, 29,
      15, 29,
      5, 43
    );

    container.add(g);

    const text = this.add.text(
      0, -3, message,
      {
        fontFamily: "monospace",
        fontSize: "14px",
        fontStyle: "bold",
        color: "#35241e",
        align: "center",
        wordWrap: { width: 175 }
      }
    ).setOrigin(0.5);

    container.add(text);

    // Floating animation
    this.tweens.add({
      targets: container,
      y: centerY - 5,
      duration: 900 + index * 150,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1
    });

    // Gentle wobble
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
    if (
      Number.isFinite(plant.hp) &&
      plant.hp < 40
    ) {
      return "I don't feel well!";
    }

    if (
      Number.isFinite(plant.soilMoisture) &&
      plant.soilMoisture < 40
    ) {
      return "I need more water!";
    }

    // Light requirements depend on species
    return "Let's grow together!";
  }

  addPlant(plant, centerX, index) {
    this.drawingPlant = true;

    const cardX = centerX - 138;
    const cardY = 295;

    const species = String(
      plant.species ?? "Unknown plant"
    );

    const image = IMAGE_BY_SPECIES[
      species.toLowerCase()
    ];

    const message = this.getMessage(plant);

    this.drawCloud(
      centerX, 115, message, index
    );

    let sprite;

    if (image && this.textures.exists(image)) {
      sprite = this.track(
        this.add.image(
          centerX, 228, image
        ).setScale(1.75)
      );

      sprite.setInteractive({
        useHandCursor: true
      });

      sprite.on("pointerdown", () => {
        this.game.registry.set(
          "selectedPlantId",
          plant.plantId
        );

        const target = image === "cast-iron-plant"
          ? "CastIronScene"
          : "MonsteraScene";

        if (this.scene.manager.keys[target]) {
          this.scene.start(target, {
            plantId: plant.plantId
          });
        }
      });
    } else {
      sprite = this.track(
        this.add.text(
          centerX, 228,
          "🌱",
          { fontSize: "70px" }
        ).setOrigin(0.5)
      );
    }

    // Plant wobble animation
    this.tweens.add({
      targets: sprite,
      y: 224,
      angle: index === 0 ? 2.5 : -2.5,
      duration: 650 + index * 120,
      ease: "Sine.easeInOut",
      yoyo: true,
      repeat: -1,
    });

    const giggle = this.track(
      this.add.text(
        centerX + 68, 246,
        "♪",
        {
          fontFamily: "monospace",
          fontSize: "18px",
          color: "#ffcc72",
        }
      ).setOrigin(0.5)
    );

    this.tweens.add({
      targets: giggle,
      y: 237,
      alpha: 0.2,
      duration: 820,
      yoyo: true,
      repeat: -1
    });

    // Plant stat card
    this.drawFrame(
      cardX, cardY, 276, 119
    );

    this.track(
      this.add.text(
        centerX,
        cardY + 20,
        species.toUpperCase(),
        {
          fontFamily: "monospace",
          fontSize: "14px",
          fontStyle: "bold",
          color: C.ink,
        }
      ).setOrigin(0.5)
    );

    this.track(
      this.add.text(
        cardX + 19,
        cardY + 41,
        `LV. ${plant.level ?? "?"}`,
        {
          fontFamily: "monospace",
          fontSize: "12px",
          fontStyle: "bold",
          color: "#76523a",
        }
      )
    );

    this.drawMeter(
      cardX + 20,
      cardY + 43,
      "HP",
      plant.hp,
      C.health,
      100,
      ""
    );

    this.drawMeter(
      cardX + 20,
      cardY + 64,
      "WATER",
      plant.soilMoisture,
      C.water,
      100,
      "%"
    );

    this.drawMeter(
      cardX + 20,
      cardY + 85,
      "LIGHT",
      plant.lightIntensity,
      C.light,
      100,
      "lux",
      LIGHT_DISPLAY_MAX_LUX
    );

    this.drawingPlant = false;
  }

  drawMeter(
    x, y, label, value, color,
    barWidth = 100,
    unit = "%",
    max = 100
  ) {
    const valid =
      typeof value === "number" &&
      Number.isFinite(value);

    const amount = valid
      ? Math.max(0, value)
      : 0;

    const percent = Phaser.Math.Clamp(
      amount / max * 100,
      0,
      100
    );

    const bx = x + 58;

    this.track(
      this.add.text(
        x, y - 2, label,
        {
          fontFamily: "monospace",
          fontSize: "11px",
          fontStyle: "bold",
          color: C.ink,
        }
      )
    );

    const g = this.track(
      this.add.graphics()
    );

    g.fillStyle(0x6e4b38);
    g.fillRect(
      bx - 1, y - 1,
      barWidth + 2, 12
    );

    g.fillStyle(0xe4c9a4);
    g.fillRect(
      bx, y, barWidth, 10
    );

    g.fillStyle(color);
    g.fillRect(
      bx, y,
      Math.round(barWidth * percent / 100),
      10
    );

    g.fillStyle(0xffffff, 0.24);
    g.fillRect(
      bx, y,
      Math.round(barWidth * percent / 100),
      3
    );

    const display = valid
      ? `${Math.round(amount)}${
          unit === "%"
            ? "%"
            : unit === "lux"
              ? " lx"
              : ""
        }`
      : "--";

    this.track(
      this.add.text(
        bx + barWidth + 5,
        y - 2,
        display,
        {
          fontFamily: "monospace",
          fontSize: "10px",
          color: C.ink,
        }
      )
    );
  }
}
