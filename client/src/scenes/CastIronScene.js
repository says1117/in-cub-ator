import { createPlantRig } from "../render/plantRig.js";
import { preloadPlantArt, PLANTS } from "../data/plants.js";
import { drawCareForest, carePanel, plantBackdrop, hoverControl, hoverCareAction } from "../theme/plantCareTheme.js";
import { FONT } from "../ui/font.js";
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
    preloadPlantArt(this);
  }

  create() {
    const { width, height } = this.scale;

    this.W = width;
    this.H = height;

    this.plant = this.findPlant();
    initializeReadingEffects(this);

    this.cameras.main.setBackgroundColor("#0b2530");

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

  rect(x, y, w, h) {
    return carePanel(this, x, y, w, h);
  }

  label(
    x, y, value,
    size = 18,
    color = "#f6ecd2",
    options = {}
  ) {
    return this.add.text(x, y, value, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: "normal",
      color,
      align: "center",
      stroke: "#0d1020",
      strokeThickness: 0,
      ...options
    }).setOrigin(0.5);
  }

  drawBackground() {
    drawCareForest(this);
  }

  drawHeader() {
    const { W, H } = this;

    const titleY = H * 0.07;
    const titleWidth = Math.min(W * 0.68, 510);

    this.rect(W / 2 - titleWidth / 2, titleY - 29, titleWidth, 58);

    this.titleText = this.label(
      W / 2,
      titleY,
      "CAST IRON PLANT",
      Math.max(
        16,
        Math.min(29, W * 0.032)
      )
    );

    this.rect(18, titleY - 25, 62, 50);

    const arrow = this.label(
      49,
      titleY,
      "<",
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
      arrow.setColor("#f6ecd2");
    });

    hoverControl(this, hit, { x: 18, y: titleY - 25, width: 62, height: 50 }, false);
    hit.on("pointerdown", () => {
      this.registry.get("audio")?.sfx("ui_select");
      this.registry.get("navigate")("/storage");
    });
  }

  drawPlant() {
    const { W, H } = this;

    const centerY = H * 0.39;
    plantBackdrop(this, W / 2, centerY, W * 0.38, H * 0.55);

    const glow = this.add.graphics();

    glow.fillStyle(0xbb9df7, 0.12);

    glow.fillEllipse(
      W / 2,
      centerY,
      W * 0.43,
      H * 0.47
    );

    const shadow = this.add.graphics();

    shadow.fillStyle(0x0b0d1a, 0.55);

    shadow.fillEllipse(
      W / 2,
      H * 0.625,
      W * 0.26,
      20
    );

    const target = Math.min(W * 0.47, H * 0.38, 410);
    // Animate the same individual leaves, hands and face as the forest plant.
    // Its root stays on the pedestal instead of floating the whole PNG.
    this.plantSprite = createPlantRig(this, PLANTS.A, W / 2, H * 0.625,
      target, { shadow: false });
    initializePlantGrowth(this);

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
        "#ffd77a"
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
        name: "WATER",
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

      ring.fillStyle(0x141b30);
      ring.fillCircle(
        action.x,
        action.y,
        radius
      );

      ring.lineStyle(5, 0xe8d5a6);
      ring.strokeCircle(
        action.x,
        action.y,
        radius
      );

      ring.lineStyle(3, 0x7653dc);
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

      symbol.setStroke("#0d1020", 0);

      this.rect(action.x - Math.max(radius * 1.05, 55), action.y + radius * 0.65, Math.max(radius * 2.1, 110), 29);

      this.label(
        action.x,
        action.y + radius * 0.65 + 14,
        action.name,
        Math.max(
          16,
          Math.min(15, radius * 0.29)
        ),
        "#f6ecd2",
        { strokeThickness: 0 }
      );

      const hit = this.add.zone(
        action.x,
        action.y + 10,
        Math.max(radius * 2.2, 110),
        radius * 2 + 40
      ).setInteractive({
        useHandCursor: true
      });

      if (action.type === "water") this.waterButton = hit;
      hoverCareAction(hit, ring, symbol, action, radius);
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

    this.rect(W * 0.045, panelY, W * 0.91, panelH);

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
        "#ffd77a"
      );

      this.label(
        x,
        panelY + panelH * 0.43,
        entry.name,
        Math.max(
          16,
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

      bg.fillStyle(0x1b2440);
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
          16,
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
          0xbb9df7,
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
          `MAX HP: ${this.plant.combatStats?.maxHp ?? "--"}   ` +
          `ATK: ${this.plant.combatStats?.attackDamage ?? "--"}   ` +
          `SHIELD: ${this.plant.combatStats?.shield ?? "--"}`
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

    this.rect(W * 0.045, y, W * 0.91, h);

    this.label(
      W * 0.14,
      y + h / 2,
      "BATTLE STATS",
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
        fontFamily: FONT,
        fontSize: `${Math.max(
          16,
          Math.min(16, W * 0.018)
        )}px`,
        color: "#f6ecd2",
        wordWrap: {
          width: W * 0.64
        }
      }
    ).setOrigin(0, 0.5);
  }
}

