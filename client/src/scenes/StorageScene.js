import { preloadPlantArt } from "../data/plants.js";
import { ensurePlantPortrait } from "../render/plantPortrait.js";
import { drawCareForest, carePanel, plantBackdrop, hoverControl } from "../theme/plantCareTheme.js";
import { FONT } from "../ui/font.js";
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
  soil: 0x0b2530,
  ink: "#f6ecd2",
  water: 0x56b8ff,
  light: 0xffd77a,
  health: 0x81c75d,
};

export default class StorageScene extends Phaser.Scene {
  constructor() {
    super({ key: "StorageScene" });
  }

  preload() {
    preloadPlantArt(this);
  }

  create() {
    ensurePlantPortrait(this, "A", "cast-iron-plant");
    ensurePlantPortrait(this, "B", "monstera-plant");
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
        fontFamily: FONT,
        fontSize: "16px",
        color: "#dcc0fb",
      }
    ).setOrigin(0.5).setDepth(5);

    // Pagination buttons
    this.prevButton = this.add.text(
      30, 348, "<",
      {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#f6ecd2",
      }
    )
      .setOrigin(0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    this.nextButton = this.add.text(
      770, 348, ">",
      {
        fontFamily: FONT,
        fontSize: "24px",
        color: "#f6ecd2",
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

    hoverControl(this, this.prevButton, { x: 12, y: 330, width: 36, height: 36 });
    hoverControl(this, this.nextButton, { x: 752, y: 330, width: 36, height: 36 });

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
          fontFamily: FONT,
          fontSize: "18px",
          color: "#f6ecd2",
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
    drawCareForest(this);
  }

  drawFrame(x, y, width, height) {
    const g = carePanel(this, x, y, width, height);
    if (this.drawingPlant) this.track(g);
    return g;
  }

  drawHeader() {
    this.drawFrame(195, 13, 410, 55);

    this.add.text(
      400, 40,
      "PLANT STORAGE",
      {
        fontFamily: FONT,
        fontSize: "27px",
        fontStyle: "normal",
        color: "#f6ecd2",
        stroke: "#0d1020",
        strokeThickness: 0,
      }
    ).setOrigin(0.5);

    this.drawFrame(669, 19, 110, 42);

    const back = this.add.text(
      724, 40,
      "< BACK",
      {
        fontFamily: FONT,
        fontSize: "16px",
        fontStyle: "normal",
        color: "#f6ecd2",
      }
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    back.on("pointerover", () => {
      back.setColor("#ffe08a");
    });

    back.on("pointerout", () => {
      back.setColor("#f6ecd2");
    });

    hoverControl(this, back, { x: 669, y: 19, width: 110, height: 42 }, false);
    back.on("pointerdown", () => {
      this.registry.get("audio")?.sfx("ui_select");
      this.registry.get("navigate")("/");
    });
  }

  drawCloud(centerX, centerY, message, index) {
    const container = this.track(this.add.container(centerX, centerY));
    const panel = carePanel(this, -122, -24, 244, 48);
    container.add(panel);
    container.add(this.add.text(0, 0, message, {
      fontFamily: FONT, fontSize: "16px", color: "#f6ecd2", align: "center",
      wordWrap: { width: 224 }
    }).setOrigin(0.5));
    this.tweens.add({ targets: container, y: centerY - 4,
      duration: 1800 + index * 150, ease: "Sine.easeInOut", yoyo: true, repeat: -1 });
    return container;
  }

  getMessage(plant) {
    if (
      Number.isFinite(plant.hp) &&
      plant.hp < 40
    ) {
      return "I don't feel well!";
    }

    // Same rule as the game: thirsty once the soil has been dry long enough to call a boss.
    if (plant.thirsty) {
      return "I need more water!";
    }

    // Light requirements depend on species
    return "Let's grow together!";
  }

  addPlant(plant, centerX, index) {
    this.drawingPlant = true;
    this.track(plantBackdrop(this, centerX, 223, 220, 160));

    const cardX = centerX - 138;
    const cardY = 295;

    const species = String(
      plant.species ?? "Unknown plant"
    );

    const image = IMAGE_BY_SPECIES[
      species.trim().toLowerCase()
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
        ).setScale(144 / this.textures.get(image).getSourceImage().height)
      );

      sprite.setInteractive({
        useHandCursor: true
      });

      const hoverGlow = this.track(hoverControl(this, sprite, { x: centerX - 110, y: 143, width: 220, height: 145 }));
      this.plantLayer.moveBelow(hoverGlow, sprite);
      sprite.on("pointerdown", () => {
        this.game.registry.set(
          "selectedPlantId",
          plant.plantId
        );

        const path = image === "cast-iron-plant"
          ? "/cast_iron"
          : "/monstera";

        this.registry.get("navigate")(path);
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
          fontFamily: FONT,
          fontSize: "18px",
          color: "#ffd77a",
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
        cardX + 20,
        cardY + 19,
        species.toUpperCase().replace(" DELICIOSA", ""),
        {
          fontFamily: FONT,
          fontSize: "16px",
          fontStyle: "normal",
          color: C.ink,
        }
      ).setOrigin(0, 0.5)
    );

    this.track(
      this.add.text(
        cardX + 207,
        cardY + 11,
        `LV. ${plant.level ?? "?"}`,
        {
          fontFamily: FONT,
          fontSize: "16px",
          fontStyle: "normal",
          color: "#ffd77a",
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
          fontFamily: FONT,
          fontSize: "16px",
          fontStyle: "normal",
          color: C.ink,
        }
      )
    );

    const g = this.track(
      this.add.graphics()
    );

    g.fillStyle(0xbb9df7);
    g.fillRect(
      bx - 1, y - 1,
      barWidth + 2, 12
    );

    g.fillStyle(0x1b2440);
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
          fontFamily: FONT,
          fontSize: "16px",
          color: C.ink,
        }
      )
    );
  }
}
