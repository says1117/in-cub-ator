const fields = ["soilMoisture", "lightIntensity", "co2"];

export function initializeReadingEffects(scene) {
  scene.previousReadings = snapshot(scene.plant);
  scene.readingEffects = new Map();
}

function snapshot(plant) {
  if (!plant) return null;
  return { plantId: plant.plantId, ...Object.fromEntries(fields.map(key => [key, plant[key]])) };
}

export function refreshReadingEffects(scene) {
  const next = snapshot(scene.plant);
  const previous = scene.previousReadings;
  scene.previousReadings = next;
  // Initial load establishes a baseline, rather than pretending a reading changed.
  if (!next || !previous || previous.plantId !== next.plantId) return;
  for (const field of fields) {
    if (Number.isFinite(next[field]) && Number.isFinite(previous[field]) && next[field] !== previous[field]) {
      playReadingEffect(scene, field);
    }
  }
}

function playReadingEffect(scene, field) {
  const old = scene.readingEffects.get(field);
  old?.timer.remove();
  if (old) {
    old.container.each(child => scene.tweens.killTweensOf(child));
    old.container.destroy();
  }
  const bounds = scene.plantSprite.getBounds();
  const cx = scene.plantSprite.x;
  const top = Math.max(scene.H * 0.16, bounds.top);
  const bottom = Math.min(scene.H * 0.6, bounds.bottom);
  const cy = (top + bottom) / 2;
  const radius = Math.min(65, bounds.width * 0.3);
  const container = scene.add.container(0, 0).setDepth(15);
  if (field === "soilMoisture") {
    // Blue droplets fall onto the leaves.
    for (let i = 0; i < 9; i++) {
      const drop = scene.add.graphics().setPosition(cx + (i % 5 - 2) * 22, top + (i % 3) * 10);
      drop.fillStyle(0x65d8ff, 0.9).fillTriangle(0, -7, -4, 1, 4, 1).fillCircle(0, 1, 4);
      container.add(drop);
      scene.tweens.add({ targets: drop, y: Math.min(bottom, drop.y + 85), alpha: 0,
        delay: i * 45, duration: 650, ease: "Sine.easeIn" });
    }
  } else if (field === "lightIntensity") {
    // A golden halo and outward sun rays brighten the foliage.
    const rays = scene.add.graphics().setPosition(cx, cy);
    rays.lineStyle(2, 0xffd568, 0.85).strokeCircle(0, 0, radius);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      rays.lineBetween(Math.cos(angle) * (radius + 6), Math.sin(angle) * (radius + 6),
        Math.cos(angle) * (radius + 18), Math.sin(angle) * (radius + 18));
    }
    container.add(rays);
    scene.tweens.add({ targets: rays, scaleX: 1.2, scaleY: 1.2, angle: 25,
      alpha: 0, duration: 1000, ease: "Sine.easeOut" });
  } else {
    // Soft green gas bubbles drift up around the plant.
    for (let i = 0; i < 8; i++) {
      const x = cx + (i % 2 ? 1 : -1) * (radius + (i % 3) * 7);
      const bubble = scene.add.graphics().setPosition(x, cy + 35 - (i % 3) * 12);
      bubble.fillStyle(0xa6f5a5, 0.18).fillCircle(0, 0, 5 + i % 3);
      bubble.lineStyle(1.5, 0xa6f5a5, 0.9).strokeCircle(0, 0, 5 + i % 3);
      container.add(bubble);
      scene.tweens.add({ targets: bubble, x: x + (i % 2 ? -14 : 14), y: top + 8,
        alpha: 0, delay: i * 45, duration: 950, ease: "Sine.easeOut" });
    }
  }
  const timer = scene.time.delayedCall(1500, () => {
    container.destroy();
    scene.readingEffects.delete(field);
  });
  scene.readingEffects.set(field, { container, timer });
}
