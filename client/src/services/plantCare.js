import { FONT } from "../ui/font.js";
export function playCareSound(scene, action) {
  const cue = { water: "care_water", light: "care_sunlight", co2: "care_co2", fertilize: "care_fertilize" }[action];
  scene.registry.get("audio")?.sfx(cue || "ui_select");
}

export function initializeWatering(scene) {
  scene.time.addEvent({ delay: 200, loop: true, callback: () => refreshWatering(scene) });
  scene.wateringStatus = scene.add.text(scene.W / 2, scene.H * 0.64,
    "Defeat a boss to earn water", {
      fontFamily: FONT, fontSize: "16px", color: "#f6ecd2",
      align: "center", wordWrap: { width: scene.W * 0.9 }
    }).setOrigin(0.5).setDepth(20);
}

export function refreshWatering(scene) {
  // The button is cosmetic. Only server-issued boss rewards add moisture.
  if (scene.plant) scene.waterButton?.setInteractive({ useHandCursor: true });
  else scene.waterButton?.disableInteractive();
  const full = Number(scene.plant?.soilMoisture) >= 100;
  if (full) {
    const remaining = Math.max(0, ((scene.plant.wateringAvailableAt || 0) * 1000 - Date.now()) / 1000);
    scene.wateringStatus?.setText(`Moisture 100% · Lv. ${scene.plant.level} · resets in ${Math.ceil(remaining)}s`);
  } else scene.wateringStatus?.setText("Defeat a boss to earn water");
}

export function waterPlant(scene) {
  if (!scene.plant || !scene.plantSprite) return;
  playCareSound(scene, "water");
  scene.particleBurst("💧", 0x4fc7fa);
  scene.tweens.add({ targets: scene.plantSprite, alpha: 0.85,
    duration: 170, yoyo: true });
  // No API request and no local reading update.
  refreshWatering(scene);
}
