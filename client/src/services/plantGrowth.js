// Moisture changes only the artwork; the server remains the source of readings.
export function initializePlantGrowth(scene) {
  const sprite = scene.plantSprite;
  scene.plantNormalScale = { x: sprite.scaleX, y: sprite.scaleY };
  scene.growthMoisture = undefined;
  scene.growthTween = null;
  // Keep the pot grounded as the foliage grows upward.
  sprite.y = scene.H * 0.625;
  sprite.setOrigin(0.5, 1);
}

export function refreshPlantGrowth(scene) {
  if (!scene.plantSprite || !scene.plantNormalScale || !scene.plant) return;
  const value = Number(scene.plant.soilMoisture);
  if (!Number.isFinite(value)) return;
  const moisture = Math.max(0, Math.min(100, value));
  if (scene.growthMoisture === moisture) return;
  const first = scene.growthMoisture === undefined;
  const popped = !first && scene.growthMoisture < 100 && moisture === 100;
  scene.growthMoisture = moisture;
  const factor = moisture === 100 ? 1 : 1 + moisture / 100 * 0.4;
  const x = scene.plantNormalScale.x * factor;
  const y = scene.plantNormalScale.y * factor;
  scene.growthTween?.stop();
  if (first) scene.plantSprite.setScale(x, y);
  else scene.growthTween = scene.tweens.add({
    targets: scene.plantSprite, scaleX: x, scaleY: y,
    duration: popped ? 360 : 450, ease: popped ? "Back.easeOut" : "Sine.easeInOut"
  });
  if (popped) {
    scene.registry.get("audio")?.sfx("plant_pop");
    scene.particleBurst("✦", 0xffd279);
  }
}
