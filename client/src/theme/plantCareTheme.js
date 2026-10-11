import { paintEnchantedForest } from "./enchantedForest.js";
import { drawPlate, HUD } from "../ui/hudArt.js";

// Reuse the adventure's painted layers without its walking or battle effects.
export function drawCareForest(scene) {
  if (!scene.textures.exists("autumnSky")) paintEnchantedForest(scene);
  const width = scene.scale.width, height = scene.scale.height;
  const backdrop = scene.add.container(0, 0).setDepth(-20);
  backdrop.setScale(width / 800, height / 450);
  const layers = [
    ["autumnSky", 400, 225, 800, 450],
    ["farMountains", 400, 205, 800, 260],
    ["nearMountains", 400, 245, 800, 240],
    ["farForest", 400, 285, 800, 190],
    ["nearForest", 400, 305, 800, 160],
    ["ground", 400, 385, 800, 130],
  ];
  for (const [key, x, y, w, h] of layers) {
    backdrop.add(scene.add.image(x, y, key).setDisplaySize(w, h));
  }
  // A shaded clearing keeps the care readings legible against the forest.
  backdrop.add(scene.add.rectangle(400, 225, 800, 450, HUD.plate, 0.23));
  for (let i = 0; i < 18; i++) {
    const mote = scene.add.circle(24 + (i * 137 % 750), 78 + (i * 43 % 325),
      i % 3 === 0 ? 2 : 1, i % 2 ? 0xdcc0fb : HUD.goldHex, 0.65);
    backdrop.add(mote);
    scene.tweens.add({ targets: mote, y: mote.y - 16, alpha: 0.15,
      duration: 1800 + i * 110, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }
  return backdrop;
}

export function carePanel(scene, x, y, width, height) {
  const g = scene.add.graphics();
  drawPlate(g, x, y, width, height, { alpha: 0.88, highlight: true });
  return g;
}

// A quiet, opaque display alcove separates green leaves from the busy forest.
export function plantBackdrop(scene, x, y, width, height) {
  const g = scene.add.graphics().setDepth(-10);
  g.fillStyle(0xbb9df7, 0.13).fillEllipse(x, y, width + 20, height + 16);
  g.fillStyle(0x11172c, 0.96).fillRoundedRect(x - width / 2, y - height / 2, width, height, 28);
  g.lineStyle(2, 0xbb9df7, 0.65).strokeRoundedRect(x - width / 2, y - height / 2, width, height, 28);
  g.fillStyle(0x7653dc, 0.18).fillEllipse(x, y + height * 0.35, width * 0.8, height * 0.14);
  return g;
}

export function hoverControl(scene, target, bounds, sound = true) {
  const glow = scene.add.graphics();
  const original = target.style?.color;
  target.on("pointerover", () => {
    glow.clear();
    drawPlate(glow, bounds.x, bounds.y, bounds.width, bounds.height,
      { fill: 0x7653dc, alpha: 0.3, border: HUD.goldHex, borderAlpha: 1 });
    if (target.setColor) target.setColor(HUD.gold);
    else if (target.setTint) target.setTint(0xffe6ae);
  });
  const reset = () => {
    glow.clear();
    if (target.setColor) target.setColor(original || HUD.text);
    else target.clearTint?.();
  };
  target.on("pointerout", reset);
  scene.input.on("gameout", reset);
  target.once("destroy", () => scene.input.off("gameout", reset));
  target.on("pointerdown", () => glow.clear());
  if (sound) target.on("pointerdown", () => scene.registry.get("audio")?.sfx("ui_select"));
  return glow;
}

export function hoverCareAction(hit, ring, symbol, action, radius) {
  const scene = hit.scene;
  const paint = (hovered) => {
    const disabled = action.type === "water" && !hit.input?.enabled;
    ring.clear();
    ring.fillStyle(hovered ? 0x35325e : 0x141b30).fillCircle(action.x, action.y, radius);
    ring.lineStyle(hovered ? 6 : 5, disabled ? HUD.grey : hovered ? action.color : HUD.border)
      .strokeCircle(action.x, action.y, radius);
    ring.lineStyle(3, disabled ? 0x45435e : hovered ? HUD.goldHex : 0x7653dc)
      .strokeCircle(action.x, action.y, radius - 6);
    symbol.setColor(disabled ? HUD.greyText : hovered ? HUD.gold : "#ffffff");
  };
  hit.on("pointerover", () => paint(true));
  const reset = () => paint(false);
  hit.on("pointerout", reset);
  hit.on("pointerdown", reset);
  scene.input.on("gameout", reset);
  hit.once("destroy", () => scene.input.off("gameout", reset));
  // Water controls can become disabled while hovered; don't leave a stale highlight.
  scene.time.addEvent({ delay: 200, loop: true, callback: () => {
    if (!hit.input?.enabled) paint(false);
  }});
}
