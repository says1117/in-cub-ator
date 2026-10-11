import Phaser from "phaser";
import { drawCareForest, carePanel, hoverControl } from "../theme/plantCareTheme.js";
import { FONT } from "../ui/font.js";
import { getAllPlants, subscribe } from "../state/plantStore.js";
import { attachFootage } from "../services/footageFeed.js";

export default class FootageScene extends Phaser.Scene {
  constructor() { super("FootageScene"); }

  label(x, y, text, color = "#f6ecd2", size = 16) {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color });
  }

  create() {
    drawCareForest(this);
    carePanel(this, 190, 13, 420, 55);
    this.label(400, 40, "PLANT FOOTAGE", "#ffd77a", 28).setOrigin(0.5);
    carePanel(this, 669, 19, 110, 42);
    const back = this.label(724, 40, "< BACK").setOrigin(0.5).setInteractive({ useHandCursor: true });
    hoverControl(this, back, { x: 669, y: 19, width: 110, height: 42 });
    back.on("pointerdown", () => this.registry.get("navigate")("/storage"));
    this.cards = new Map();
    this.empty = this.label(400, 220, "Waiting for registered plants…").setOrigin(0.5);
    const render = () => {
      const plants = getAllPlants().slice(0, 2);
      this.empty.setVisible(!plants.length);
      plants.forEach((plant, i) => {
        let card = this.cards.get(plant.plantId);
        if (!card) {
          card = this.buildCard(plant, i);
          this.cards.set(plant.plantId, card);
        }
        card.name.setText(plant.species.toUpperCase());
        card.readings.setText(`Sensor water: ${Math.round(plant.soilMoisture)}%  ·  Lv. ${plant.level}`);
      });
    };
    this.unsubscribe = subscribe(render); render();
    this.label(400, 430, "Live view · camera reconnects automatically", "#dcc0fb").setOrigin(0.5);
    this.events.once("shutdown", () => this.unsubscribe?.());
  }

  buildCard(plant, index) {
    const x = index === 0 ? 28 : 412, width = 360;
    carePanel(this, x, 83, width, 319);
    const name = this.label(x + width / 2, 100, plant.species.toUpperCase(), "#ffd77a").setOrigin(0.5);
    this.add.rectangle(x + width / 2, 210, 338, 184, 0x11172c);
    const placeholder = this.label(x + width / 2, 209, "Connecting camera…", "#a9a3b8").setOrigin(0.5);
    const cameraStatus = this.label(x + 16, 306, "CAMERA · CONNECTING", "#a9a3b8");
    this.label(x + 16, 333, "AI ASSESSMENT", "#ffd77a");
    this.label(x + 16, 356, "Model not configured · not assessed", "#a9a3b8");
    const readings = this.label(x + 16, 379, "", "#dcc0fb");
    const video = attachFootage(this, plant.plantId, x + width / 2, 210, 338, 184, live => {
      placeholder.setVisible(!live).setText("Camera unavailable\nRetrying automatically…").setAlign("center");
      cameraStatus.setText(live ? "CAMERA · LIVE" : "CAMERA · UNAVAILABLE");
      cameraStatus.setColor(live ? "#9ce7a0" : "#a9a3b8");
    });
    return { name, readings, video };
  }
}
