import Phaser from "phaser";

export default class StorageScene extends Phaser.Scene {
  constructor() {
    super("StorageScene");
  }

  create() {
    // Background
    this.cameras.main.setBackgroundColor("#f5e6c8");

    // Title
    this.add.text(400, 45, "PLANT STORAGE", {
      fontSize: "32px",
      color: "#355e3b",
      fontFamily: "monospace"
    }).setOrigin(0.5);

    // Example plants
    const plants = [
      { name: "Rose", need: "Needs Water", color: "#e74c3c" },
      { name: "Pumpkin", need: "Needs Light", color: "#f39c12" }
    ];

    plants.forEach((plant, index) => {
      const x = 250 + index * 300;
      const y = 220;

      this.add.rectangle(x, y, 220, 250, 0xffffff)
        .setStrokeStyle(3, 0x355e3b);

      this.add.circle(x, y - 55, 35,
        Phaser.Display.Color.HexStringToColor(plant.color).color
      );

      this.add.text(x, y + 10, plant.name, {
        fontSize: "24px",
        color: "#222222"
      }).setOrigin(0.5);

      this.add.text(x, y + 55, plant.need, {
        fontSize: "17px",
        color: "#a44a24"
      }).setOrigin(0.5);
    });

    // Return to Adventure
    const backButton = this.add.text(400, 410, "BACK TO ADVENTURE", {
      fontSize: "18px",
      color: "#355e3b",
      backgroundColor: "#ffffff",
      padding: { x: 12, y: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backButton.on("pointerdown", () => {
      this.scene.start("AdventureScene");
    });
  }
}