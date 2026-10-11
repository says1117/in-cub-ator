import { initializeReadingEffects, refreshReadingEffects } from "../services/plantReadingEffects.js";
import { initializePlantGrowth, refreshPlantGrowth } from "../services/plantGrowth.js";
import { initializeWatering, waterPlant, refreshWatering, playCareSound } from "../services/plantCare.js";
import Phaser from "phaser";

import {
  getAllPlants,
  subscribe
} from "../state/plantStore.js";

// Cast Iron Plant detail scene
// Backend fields:
// plantId, nfcTagId, species, soilMoisture,
// lightIntensity, co2, level, hp

const LIGHT_DISPLAY_MAX = 2000;
const LEVEL_DISPLAY_MAX = 20;

export default class CastIronScene extends Phaser.Scene {
  constructor() {
    super({ key: "CastIronScene" });

    this.plantId = "PLANT_001";
    this.plant = null;
    this.statWidgets = {};
  }

  init(data = {}) {
    this.plantId =
      data.plantId ||
      this.game.registry.get("selectedPlantId") ||
      "PLANT_001";
  }

  preload() {
    if (!this.textures.exists("castIronPlant")) {
      this.load.image(
        "castIronPlant",
        "/assets/plants/cast_iron_big.png"
      );
    }
  }

  create() {
    const { width, height } = this.scale;

    this.W = width;
    this.H = height;

    this.plant = this.findPlant();
    initializeReadingEffects(this);

    this.cameras.main.setBackgroundColor("#3b2419");

    this.drawBackground();
    this.drawHeader();
    this.drawPlant();
    this.drawActions();
    this.drawStats();
    this.drawAbout();
    initializeWatering(this);

    this.refreshStats();

    // Listen for backend updates
    this.unsubscribe = subscribe(() => {
      this.plant = this.findPlant();
      this.refreshStats();
      refreshReadingEffects(this);
    });

    this.scale.on("resize", this.onResize, this);

    this.events.once(
      Phaser.Scenes.Events.SHUTDOWN,
      () => {
        if (typeof this.unsubscribe === "function") {
          this.unsubscribe();
        }

        this.scale.off("resize", this.onResize, this);
      }
    );
  }

  findPlant() {
    const plants = getAllPlants();

    return plants.find(
      p => p.plantId === this.plantId
    ) || null;
  }

  onResize() {
    this.scene.restart({
      plantId: this.plantId
    });
  }

  rect(
    x, y, w, h,
    fill,
    stroke = 0x20130e,
    line = 3,
    radius = 0
  ) {
    const g = this.add.graphics();

    g.fillStyle(fill, 1);
    g.fillRoundedRect(x, y, w, h, radius);

    if (line) {
      g.lineStyle(line, stroke, 1);
      g.strokeRoundedRect(x, y, w, h, radius);
    }

    return g;
  }

  label(
    x, y, value,
    size = 18,
    color = "#ffe0a3",
    options = {}
  ) {
    return this.add.text(x, y, value, {
      fontFamily: "monospace",
      fontSize: `${size}px`,
      fontStyle: "bold",
      color,
      align: "center",
      stroke: "#24150f",
      strokeThickness: 3,
      ...options
    }).setOrigin(0.5);
  }

  drawBackground() {
    const { W, H } = this;
    const g = this.add.graphics();

    g.fillGradientStyle(
      0x563421,
      0x563421,
      0x2c1b15,
      0x2c1b15
    );

    g.fillRect(0, 0, W, H);

    let seed = 3719;

    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const colors = [
      0x6e4228,
      0x7c4c2d,
      0x382218,
      0x84512e
    ];

    for (
      let i = 0;
      i < Math.floor(W * H / 1700);
      i++
    ) {
      const x = random() * W;
      const y = random() * H;

      g.fillStyle(
        colors[Math.floor(random() * colors.length)],
        0.55
      );

      g.fillRect(
        x,
        y,
        3 + Math.floor(random() * 5),
        3
      );
    }

    // Grass decorations
    for (let i = 0; i < 18; i++) {
      const x =
        (i % 2 === 0 ? 0.04 : 0.92) * W +
        random() * W * 0.045;

      const y =
        H * (0.13 + random() * 0.65);

      g.lineStyle(3, 0x59632c, 0.65);

      g.lineBetween(x, y, x - 6, y - 13);
      g.lineBetween(x, y, x + 5, y - 16);
      g.lineBetween(x, y, x, y - 18);
    }
  }

  drawHeader() {
    const { W, H } = this;

    const titleY = H * 0.07;
    const titleWidth = Math.min(W * 0.68, 510);

    this.rect(
      W / 2 - titleWidth / 2,
      titleY - 29,
      titleWidth,
      58,
      0x83502e,
      0x24150e,
      4,
      8
    );

    this.titleText = this.label(
      W / 2,
      titleY,
      "CAST IRON PLANT",
      Math.max(
        16,
        Math.min(29, W * 0.032)
      )
    );

    this.rect(
      18,
      titleY - 25,
      62,
      50,
      0x89522f,
      0x21130c,
      4,
      8
    );

    const arrow = this.label(
      49,
      titleY,
      "←",
      32
    );

    const hit = this.add.zone(
      49,
      titleY,
      68,
      58
    ).setInteractive({
      useHandCursor: true
    });

    hit.on("pointerover", () => {
      arrow.setColor("#ffffff");
    });

    hit.on("pointerout", () => {
      arrow.setColor("#ffe0a3");
    });

    hit.on("pointerdown", () => {
      this.registry.get("audio")?.sfx("ui_select");
      this.registry.get("navigate")("/storage");
    });
  }

  drawPlant() {
    const { W, H } = this;

    const centerY = H * 0.39;

    const glow = this.add.graphics();

    glow.fillStyle(0xb57a37, 0.12);

    glow.fillEllipse(
      W / 2,
      centerY,
      W * 0.43,
      H * 0.47
    );

    const shadow = this.add.graphics();

    shadow.fillStyle(0x1b110c, 0.55);

    shadow.fillEllipse(
      W / 2,
      H * 0.625,
      W * 0.26,
      20
    );

    this.plantSprite = this.add.image(
      W / 2,
      centerY,
      "castIronPlant"
    );

    const target = Math.min(
      W * 0.47,
      H * 0.38,
      410
    );

    this.plantSprite.setDisplaySize(
      target,
      target
    );

    initializePlantGrowth(this);

    // Floating plant animation
    this.tweens.add({
      targets: this.plantSprite,
      y: this.plantSprite.y - 6,
      duration: 2300,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut"
    });

    // Sparkles
    for (let i = 0; i < 6; i++) {
      const x =
        W / 2 +
        (i % 2 ? 1 : -1) *
        (target * (0.22 + (i % 3) * 0.13));

      const y =
        centerY -
        target * 0.28 +
        Math.floor(i / 2) * 54;

      const star = this.label(
        x,
        y,
        "✦",
        16,
        "#ffd279"
      );

      this.tweens.add({
        targets: star,
        alpha: 0.25,
        duration: 800 + i * 140,
        yoyo: true,
        repeat: -1
      });
    }
  }

  drawActions() {
    const { W, H } = this;

    const actions = [
      {
        name: "WATER +10%",
        icon: "💧",
        x: W * 0.17,
        y: H * 0.27,
        type: "water",
        color: 0x4fc7fa
      },
      {
        name: "BRIGHTEN",
        icon: "☀",
        x: W * 0.83,
        y: H * 0.27,
        type: "light",
        color: 0xffc74d
      },
      {
        name: "ADD CO₂",
        icon: "CO₂",
        x: W * 0.17,
        y: H * 0.52,
        type: "co2",
        color: 0x9ce7a0
      },
      {
        name: "FERTILIZE",
        icon: "✿",
        x: W * 0.83,
        y: H * 0.52,
        type: "fertilize",
        color: 0x94d56e
      }
    ];

    const radius = Math.max(
      29,
      Math.min(
        W * 0.07,
        H * 0.078,
        62
      )
    );

    actions.forEach(action => {
      const ring = this.add.graphics();

      ring.fillStyle(0x6a4026);
      ring.fillCircle(
        action.x,
        action.y,
        radius
      );

      ring.lineStyle(5, 0xeab975);
      ring.strokeCircle(
        action.x,
        action.y,
        radius
      );

      ring.lineStyle(3, 0x2c1b12);
      ring.strokeCircle(
        action.x,
        action.y,
        radius - 6
      );

      const symbol = this.label(
        action.x,
        action.y - 4,
        action.icon,
        action.icon === "CO₂"
          ? radius * 0.5
          : radius * 0.8,
        "#ffffff"
      );

      symbol.setStroke("#332015", 3);

      this.rect(
        action.x - radius * 1.05,
        action.y + radius * 0.65,
        radius * 2.1,
        29,
        0xe8b875,
        0x342015,
        3,
        4
      );

      this.label(
        action.x,
        action.y + radius * 0.65 + 14,
        action.name,
        Math.max(
          10,
          Math.min(15, radius * 0.29)
        ),
        "#3b2315",
        { strokeThickness: 0 }
      );

      const hit = this.add.zone(
        action.x,
        action.y,
        radius * 2.2,
        radius * 2.4
      ).setInteractive({
        useHandCursor: true
      });

      if (action.type === "water") this.waterButton = hit;
      hit.on("pointerover", () => {
        ring.setAlpha(0.75);
      });

      hit.on("pointerout", () => {
        ring.setAlpha(1);
      });

      hit.on("pointerdown", () => {
        this.applyAction(action);
      });
    });
  }

  applyAction(action) {
    if (action.type === "water") { waterPlant(this); return; }
    if (!this.plant) {
      console.warn("Plant not found.");
      return;
    }

    playCareSound(this, action.type);
    // Request backend care action.
    // Do not directly modify sensor readings.
    this.game.events.emit("plant:care-request", {
      plantId: this.plant.plantId,
      nfcTagId: this.plant.nfcTagId,
      action: action.type
    });

    this.particleBurst(
      action.icon,
      action.color
    );

    this.tweens.add({
      targets: this.plantSprite,
      alpha: 0.85,
      duration: 170,
      yoyo: true
    });
  }

  particleBurst(icon, color) {
    const { W, H } = this;

    for (let i = 0; i < 9; i++) {
      const x =
        W / 2 + Phaser.Math.Between(-75, 75);

      const y =
        H * 0.39 + Phaser.Math.Between(-40, 65);

      const p = this.label(
        x,
        y,
        icon,
        16,
        "#ffffff"
      );

      this.tweens.add({
        targets: p,
        x: x + Phaser.Math.Between(-35, 35),
        y: y - Phaser.Math.Between(50, 120),
        alpha: 0,
        duration: 700 + i * 60,
        onComplete: () => p.destroy()
      });
    }
  }

  drawStats() {
    const { W, H } = this;

    const panelY = H * 0.69;
    const panelH = H * 0.18;

    this.rect(
      W * 0.045,
      panelY,
      W * 0.91,
      panelH,
      0x482918,
      0xc18a4b,
      4,
      10
    );

    this.statWidgets = {};

    const entries = [
      {
        key: "soilMoisture",
        name: "WATER",
        icon: "💧",
        color: 0x49bdf2,
        max: 100,
        unit: "%"
      },
      {
        key: "lightIntensity",
        name: "LIGHT",
        icon: "☀",
        color: 0xffc34a,
        max: LIGHT_DISPLAY_MAX,
        unit: "lux"
      },
      {
        key: "co2",
        name: "CO₂",
        icon: "☁",
        color: 0x78d969,
        max: 100,
        unit: ""
      },
      {
        key: "level",
        name: "LEVEL",
        icon: "★",
        color: 0xa681f7,
        max: LEVEL_DISPLAY_MAX,
        unit: ""
      }
    ];

    const colW = W * 0.91 / 4;

    entries.forEach((entry, i) => {
      const x =
        W * 0.045 +
        colW * (i + 0.5);

      const top =
        panelY + panelH * 0.19;

      this.label(
        x,
        top,
        entry.icon,
        Math.min(29, H * 0.035),
        "#ffe2a7"
      );

      this.label(
        x,
        panelY + panelH * 0.43,
        entry.name,
        Math.max(
          10,
          Math.min(16, W * 0.018)
        )
      );

      const barX = x - colW * 0.36;
      const barY = panelY + panelH * 0.61;
      const barW = colW * 0.72;
      const barH = Math.max(
        9,
        panelH * 0.115
      );

      const bg = this.add.graphics();

      bg.fillStyle(0x1e1816);
      bg.fillRoundedRect(
        barX,
        barY,
        barW,
        barH,
        4
      );

      const fill = this.add.graphics();

      const text = this.label(
        x,
        panelY + panelH * 0.88,
        "",
        Math.max(
          10,
          Math.min(15, W * 0.019)
        ),
        "#ffffff"
      );

      this.statWidgets[entry.key] = {
        fill,
        text,
        barX,
        barY,
        barW,
        barH,
        color: entry.color,
        max: entry.max,
        unit: entry.unit
      };

      if (i < 3) {
        const div = this.add.graphics();

        div.lineStyle(
          2,
          0x926039,
          0.8
        );

        div.lineBetween(
          W * 0.045 + colW * (i + 1),
          panelY + 14,
          W * 0.045 + colW * (i + 1),
          panelY + panelH - 14
        );
      }
    });

    this.refreshStats();
  }

  refreshStats() {
    refreshWatering(this);
    refreshPlantGrowth(this);
    if (!this.statWidgets) return;

    for (const [key, widget] of Object.entries(
      this.statWidgets
    )) {
      const value = this.plant?.[key];

      const valid =
        typeof value === "number" &&
        Number.isFinite(value);

      const safeValue = valid
        ? Math.max(0, value)
        : 0;

      const ratio = Phaser.Math.Clamp(
        safeValue / widget.max,
        0,
        1
      );

      widget.fill.clear();

      widget.fill.fillStyle(
        widget.color
      );

      if (ratio > 0) {
        widget.fill.fillRoundedRect(
          widget.barX + 2,
          widget.barY + 2,
          (widget.barW - 4) * ratio,
          widget.barH - 4,
          3
        );
      }

      if (!valid) {
        widget.text.setText("--");
      } else if (key === "level") {
        widget.text.setText(
          `Lv. ${value}`
        );
      } else if (key === "lightIntensity") {
        widget.text.setText(
          `${Math.round(value)} lux`
        );
      } else if (key === "soilMoisture") {
        widget.text.setText(
          `${Math.round(value)}%`
        );
      } else {
        widget.text.setText(
          `${Math.round(value)}`
        );
      }
    }

    if (this.titleText && this.plant) {
      this.titleText.setText(
        this.plant.species.toUpperCase()
      );
    }

    if (this.infoText) {
      if (this.plant) {
        this.infoText.setText(
          `ID: ${this.plant.plantId}   ` +
          `NFC: ${this.plant.nfcTagId}   ` +
          `HP: ${this.plant.hp}`
        );
      } else {
        this.infoText.setText(
          "PLANT DATA NOT AVAILABLE"
        );
      }
    }
  }

  drawAbout() {
    const { W, H } = this;

    const y = H * 0.895;
    const h = H * 0.085;

    this.rect(
      W * 0.045,
      y,
      W * 0.91,
      h,
      0x482918,
      0xb9854c,
      4,
      9
    );

    this.label(
      W * 0.14,
      y + h / 2,
      "🌿 ABOUT",
      Math.max(
        12,
        Math.min(19, W * 0.024)
      )
    );

    this.infoText = this.add.text(
      W * 0.28,
      y + h / 2,
      "",
      {
        fontFamily: "monospace",
        fontSize: `${Math.max(
          10,
          Math.min(16, W * 0.018)
        )}px`,
        color: "#ffe0a3",
        wordWrap: {
          width: W * 0.64
        }
      }
    ).setOrigin(0, 0.5);
  }
}

