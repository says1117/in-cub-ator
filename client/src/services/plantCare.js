import { requestManualWatering } from "./api.js";

// Shared between both plant pages, so navigating away and back cannot duplicate
// a request that is still running. Retries reuse its server-side receipt ID.
const pending = new Map();

export function playCareSound(scene, action) {
  const cue = { water: "care_water", light: "care_sunlight", co2: "care_co2", fertilize: "care_fertilize" }[action];
  scene.registry.get("audio")?.sfx(cue || "ui_select");
}

export function initializeWatering(scene) {
  scene.wateringBusy = false;
  scene.wateringGeneration = Symbol();
  scene.time.addEvent({ delay: 200, loop: true, callback: () => refreshWatering(scene) });
  scene.wateringStatus = scene.add.text(scene.W / 2, scene.H * 0.64,
    "Water +10% · simulated until Jetson is connected", {
      fontFamily: "monospace", fontSize: "12px", color: "#ffe0a3",
      align: "center", wordWrap: { width: scene.W * 0.9 }
    }).setOrigin(0.5).setDepth(20);
}

export function refreshWatering(scene) {
  const full = Number(scene.plant?.soilMoisture) >= 100;
  if (full || scene.wateringBusy || !scene.plant) scene.waterButton?.disableInteractive();
  else scene.waterButton?.setInteractive({ useHandCursor: true });
  if (full) {
    const remaining = Math.max(0, ((scene.plant.wateringAvailableAt || 0) * 1000 - Date.now()) / 1000);
    scene.wateringStatus?.setText(`Moisture 100% · Lv. ${scene.plant.level} · water available in ${Math.ceil(remaining)}s`);
  }
  else if (scene.wateringFull) scene.wateringStatus?.setText("Water +10% · simulated until Jetson is connected");
  scene.wateringFull = full;
}

export async function waterPlant(scene) {
  if (!scene.plant || scene.wateringBusy || Number(scene.plant.soilMoisture) >= 100) return;
  const plantId = scene.plant.plantId;
  const generation = scene.wateringGeneration;
  const current = () => scene.sys.isActive() && scene.wateringGeneration === generation;
  scene.wateringBusy = true;
  scene.waterButton?.disableInteractive();
  scene.wateringStatus.setText("Requesting simulated water…");
  playCareSound(scene, "water");
  let request = pending.get(plantId);
  if (!request) {
    request = requestManualWatering(plantId, crypto.randomUUID());
    pending.set(plantId, request);
    request.finally(() => pending.delete(plantId)).catch(() => {});
  }
  try {
    const result = await request;
    if (!current()) return;
    scene.wateringStatus.setText(result.increase > 0
      ? `Simulated water added +${result.increase}% · readings update through WebSocket`
      : "Soil moisture is already 100%");
    scene.particleBurst("💧", 0x4fc7fa);
    // The existing store subscription refreshes the moisture meter from WebSocket.
  } catch (error) {
    if (!current()) return;
    scene.wateringStatus.setText("Watering could not be confirmed. Check the backend connection.");
    scene.registry.get("audio")?.sfx("ui_denied");
    console.error("Manual watering failed:", error);
  } finally {
    if (current()) {
      scene.wateringBusy = false;
      refreshWatering(scene);
    }
  }
}
