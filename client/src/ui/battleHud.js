// client/src/ui/battleHud.js: Everything written on the battle screen. Owner: Role 3 (client, art, demo).
// Name plates, health bars, the four move cards, the banners that call out each move, the damage
// numbers and the win or lose panel. It only draws what it is told: the battle scene reads the
// server's state and calls update().
//
// Everything here is laid out on the game's real 800 x 450 pixels (not the 1280 x 720 stage the
// fighters stand on), so the pixel fonts land exactly on the pixel grid and stay sharp.
//
//   const hud = createBattleHud(scene, { ui, fx, scale });   // two layers of the scene, and 1 / the stage's scale
//   hud.update(view)            redraw from one description of the fight: see update() below
//   hud.onPick = (move) => {}   a card was clicked
//   hud.callout("left", "EMBER", "VINE HAYMAKER", colour)
//   hud.number(stageX, stageY, "-8", "#fff48e")
import Phaser from "phaser";
import { PLANTS, PLANT_IDS } from "../data/plants.js";
import { createPlantRig, hasPlantRig } from "../render/plantRig.js";
import { audio } from "../audio.js";

const FONT = '"Silkscreen", monospace';
const BIG = '"Press Start 2P", monospace';

const INK = 0x05070f;
const PLATE = 0x131a36;
const PLATE_LOW = 0x0c1126;
const EDGE = 0x3a4788;
const TRACK = 0x1c2344;
const WHITE = "#f4f7ff";
const DIM = "#8f9bc4";
const GOLD = 0xffcf40;

export const TYPES = {
  attack: { label: "ATTACK", color: 0xff6b4a, beats: "special", loses: "guard" },
  guard: { label: "GUARD", color: 0x4aa8ff, beats: "attack", loses: "special" },
  special: { label: "SPECIAL", color: 0xb36bff, beats: "guard", loses: "attack" },
  skill: { label: "SKILL", color: GOLD },
};
const hex = (color) => `#${color.toString(16).padStart(6, "0")}`;
const shade = (color, k) => {
  const part = (shift) => Math.round(((color >> shift) & 255) * k);
  return (part(16) << 16) | (part(8) << 8) | part(0);
};
const hpColor = (ratio) => (ratio < 0.25 ? 0xf2545b : ratio < 0.5 ? 0xf7d04a : 0x5fe36c);

// A plate with its corners cut off.
function plate(g, x, y, w, h, o = {}) {
  const cut = o.cut ?? 4;
  const shape = (dx, dy, grow) => [
    { x: x + cut + dx - grow, y: y + dy - grow }, { x: x + w - cut + dx + grow, y: y + dy - grow },
    { x: x + w + dx + grow, y: y + cut + dy - grow }, { x: x + w + dx + grow, y: y + h - cut + dy + grow },
    { x: x + w - cut + dx + grow, y: y + h + dy + grow }, { x: x + cut + dx - grow, y: y + h + dy + grow },
    { x: x + dx - grow, y: y + h - cut + dy + grow }, { x: x + dx - grow, y: y + cut + dy - grow },
  ];
  if (o.glass) {   // see-through: one thin tint and an outline, so the picture behind shows
    g.fillStyle(o.fill ?? PLATE, o.alpha ?? 0.3); g.fillPoints(shape(0, 0, 0), true);
    g.fillStyle(o.low ?? PLATE_LOW, (o.alpha ?? 0.3) * 0.5); g.fillRect(x + 1, y + Math.round(h * 0.55), w - 2, Math.floor(h * 0.45) - cut + 2);
    g.lineStyle(1, o.edge ?? EDGE, o.line ?? 0.9); g.strokePoints(shape(0, 0, 0), true);
    return;
  }
  if (o.shadow !== false) { g.fillStyle(INK, 0.45); g.fillPoints(shape(2, 3, 1), true); }
  g.fillStyle(o.edge ?? EDGE, o.alpha ?? 1); g.fillPoints(shape(0, 0, 1), true);
  g.fillStyle(o.fill ?? PLATE, o.alpha ?? 1); g.fillPoints(shape(0, 0, 0), true);
  g.fillStyle(o.low ?? PLATE_LOW, o.alpha ?? 1); g.fillRect(x + 1, y + Math.round(h * 0.55), w - 2, Math.floor(h * 0.45) - cut + 2);
  g.fillStyle(0xffffff, 0.08); g.fillRect(x + cut, y + 1, w - cut * 2, 1);
}

// The little pictures on the move cards, drawn in a 22 pixel box round cx, cy.
const ICONS = {
  fist(g, cx, cy) {
    g.fillRect(cx - 6, cy - 4, 13, 10);
    for (let i = 0; i < 4; i++) g.fillRect(cx - 6 + i * 3.4, cy - 7, 2.6, 4);
    g.fillRect(cx - 9, cy - 1, 4, 6);
    g.fillRect(cx - 12, cy - 6, 3, 1.5); g.fillRect(cx - 13, cy + 6, 4, 1.5);
  },
  heart(g, cx, cy) {
    g.fillCircle(cx - 4, cy - 3, 5); g.fillCircle(cx + 4, cy - 3, 5);
    g.fillTriangle(cx - 9, cy - 1, cx + 9, cy - 1, cx, cy + 9);
  },
  flare(g, cx, cy) {
    g.fillCircle(cx, cy + 3, 6);
    g.fillTriangle(cx - 6, cy + 2, cx + 6, cy + 2, cx + 2, cy - 10);
    g.fillTriangle(cx - 6, cy + 3, cx - 1, cy + 3, cx - 5, cy - 5);
  },
  bloom(g, cx, cy) {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.fillCircle(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 3.6); }
    g.fillCircle(cx, cy, 3);
  },
  blade(g, cx, cy) {
    g.fillPoints([{ x: cx - 9, y: cy + 8 }, { x: cx + 9, y: cy - 9 }, { x: cx + 5, y: cy - 2 }, { x: cx - 5, y: cy + 9 }], true);
    g.fillPoints([{ x: cx - 9, y: cy - 8 }, { x: cx + 9, y: cy + 9 }, { x: cx + 2, y: cy + 5 }, { x: cx - 8, y: cy - 4 }], true);
  },
  wall(g, cx, cy) {
    for (let i = -1; i <= 1; i++) g.fillTriangle(cx + i * 7 - 3.5, cy + 9, cx + i * 7 + 3.5, cy + 9, cx + i * 7, cy - 9 + Math.abs(i) * 4);
  },
  bolt(g, cx, cy) {
    g.fillPoints([{ x: cx + 3, y: cy - 10 }, { x: cx - 6, y: cy + 1 }, { x: cx - 1, y: cy + 1 }, { x: cx - 4, y: cy + 10 }, { x: cx + 6, y: cy - 2 }, { x: cx + 1, y: cy - 2 }], true);
  },
  sun(g, cx, cy) {
    g.fillCircle(cx, cy, 5);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.fillTriangle(cx + Math.cos(a - 0.25) * 7, cy + Math.sin(a - 0.25) * 7, cx + Math.cos(a + 0.25) * 7, cy + Math.sin(a + 0.25) * 7, cx + Math.cos(a) * 11, cy + Math.sin(a) * 11); }
  },
  thorn(g, cx, cy) {
    for (let i = -1; i <= 1; i++) g.fillTriangle(cx - 8, cy + i * 6 - 2, cx - 8, cy + i * 6 + 2, cx + 9, cy + i * 6);
  },
  leaf(g, cx, cy) {
    g.fillPoints([{ x: cx - 9, y: cy + 7 }, { x: cx - 4, y: cy - 6 }, { x: cx + 8, y: cy - 8 }, { x: cx + 6, y: cy + 3 }], true);
  },
  bark(g, cx, cy) {
    g.fillRect(cx - 9, cy - 8, 8, 7); g.fillRect(cx + 1, cy - 8, 8, 7); g.fillRect(cx - 9, cy + 1, 5, 7); g.fillRect(cx - 2, cy + 1, 11, 7);
  },
  star(g, cx, cy) {
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; g.fillTriangle(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, cx + Math.cos(a + 1.2) * 3, cy + Math.sin(a + 1.2) * 3, cx + Math.cos(a - 1.2) * 3, cy + Math.sin(a - 1.2) * 3); }
  },
};

export function createBattleHud(scene, layers) {
  const root = scene.add.container(0, 0).setScale(layers.scale);
  const over = scene.add.container(0, 0).setScale(layers.scale);
  layers.ui.add(root);
  layers.fx.add(over);
  let announced = null;   // the line being told right now: see announce()

  const text = (parent, x, y, str, o = {}) => {
    const t = scene.add.text(x, y, str, {
      fontFamily: o.big ? BIG : FONT, fontSize: `${o.size || 8}px`, fontStyle: o.bold ? "bold" : "normal",
      color: o.color || WHITE, wordWrap: o.wrap ? { width: o.wrap } : undefined, lineSpacing: o.spacing ?? 0, align: o.align || "left",
    });
    if (o.stroke) t.setStroke(o.stroke, o.thick ?? 3);
    if (o.shadow !== false && !o.stroke) t.setShadow(1, 1, "#05070f", 0, false, true);
    t.setOrigin(o.ox ?? 0, o.oy ?? 0);
    parent.add(t);
    return t;
  };
  const gfx = (parent) => { const g = scene.add.graphics(); parent.add(g); return g; };
  const box = (parent, x, y, w, h, color, alpha = 1) => { const r = scene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0); parent.add(r); return r; };

  // A bar that drains smoothly, with a pale ghost of what was just lost trailing behind it.
  function bar(parent, x, y, w, h, color, o = {}) {
    const g = gfx(parent);
    g.fillStyle(INK, 1); g.fillRect(x - 1, y - 1, w + 2, h + 2);
    g.fillStyle(TRACK, 1); g.fillRect(x, y, w, h);
    const ghost = box(parent, x, y, 0, h, 0xffffff, 0.85);
    const fill = box(parent, x, y, w, h, color);
    const shine = box(parent, x, y, w, Math.max(1, Math.floor(h / 3)), 0xffffff, 0.3);
    if (o.ticks) {
      const t = gfx(parent);
      t.fillStyle(INK, 0.35);
      for (let i = 1; i < o.ticks; i++) t.fillRect(x + Math.round((w * i) / o.ticks), y, 1, h);
    }
    const state = { v: 1, ghost: 1 };
    let first = true;
    let target = null;
    const draw = () => { fill.width = Math.max(0, w * state.v); shine.width = fill.width; ghost.width = Math.max(0, w * state.ghost); };
    return {
      set(ratio, tint) {
        const to = Phaser.Math.Clamp(ratio || 0, 0, 1);
        if (tint !== undefined) fill.fillColor = tint;
        if (to === target) return;               // asked many times a second: only a change starts it moving
        target = to;
        scene.tweens.killTweensOf(state);
        if (first) { first = false; state.v = to; state.ghost = to; draw(); return; }
        if (to > state.v) state.ghost = to;                          // healing: no ghost
        scene.tweens.add({ targets: state, v: to, duration: 260, ease: "Cubic.easeOut", onUpdate: draw });
        scene.tweens.add({ targets: state, ghost: to, duration: 420, delay: 320, ease: "Quad.easeIn", onUpdate: draw, onComplete: draw });
      },
      // Straight to a value, with no easing: for a bar driven every frame.
      jump(ratio) { target = null; scene.tweens.killTweensOf(state); state.v = state.ghost = Phaser.Math.Clamp(ratio, 0, 1); first = false; draw(); },
      setAlpha(a) { for (const part of [g, ghost, fill, shine]) part.setAlpha(a * (part === ghost ? 0.85 : part === shine ? 0.3 : 1)); },
      setVisible(v) { for (const part of [g, ghost, fill, shine]) part.setVisible(v); },
    };
  }

  // ---------------------------------------------------------------- the plant's plate (top left)
  const back = gfx(root);
  const accent = box(root, 6, 10, 3, 54, 0xffffff);
  plate(back, 6, 6, 240, 62);
  back.fillStyle(INK, 0.9); back.fillCircle(31, 38, 21);
  const portraitRing = gfx(root);
  const portraits = {};
  for (const id of PLANT_IDS) {
    if (!hasPlantRig(scene, PLANTS[id], "s")) continue;
    const rig = createPlantRig(scene, PLANTS[id], 31, 57, 42, { size: "s", shadow: false });
    rig.setVisible(false);
    root.add(rig);
    portraits[id] = rig;
  }
  const plantName = text(root, 60, 9, "PLANT", { size: 16, bold: true });
  const plantTag = text(root, 239, 13, "", { color: DIM, ox: 1 });
  text(root, 60, 31, "HP", { color: "#ff8f90", bold: true });
  const plantHp = bar(root, 78, 32, 112, 7, 0x5fe36c, { ticks: 10 });
  const plantHpText = text(root, 239, 31, "", { ox: 1 });
  text(root, 60, 47, "SOIL", { color: "#7fd0ff" });
  const soil = bar(root, 86, 49, 34, 4, 0x4ab8ff);
  const soilText = text(root, 123, 47, "", { color: DIM });
  text(root, 150, 47, "VIGOR", { color: "#9dffb0" });
  const vigor = bar(root, 182, 49, 30, 4, 0x6bea86);
  const vigorText = text(root, 215, 47, "", { color: DIM });

  // the plant waiting on the bench
  plate(back, 6, 73, 140, 16, { cut: 3 });
  const benchName = text(root, 12, 76, "", {});
  const benchHp = bar(root, 52, 79, 40, 4, 0x5fe36c);
  const benchTag = text(root, 98, 76, "", { color: DIM });
  // The bench plate is also the swap button: click it (or press 5) on your move to change plants.
  const benchEdge = gfx(root);
  let swapOk = false;
  const benchZone = scene.add.zone(6, 73, 140, 16).setOrigin(0).setInteractive({ useHandCursor: true });
  root.add(benchZone);
  benchZone.on("pointerdown", () => { if (swapOk && api.onPick) api.onPick("swap"); });

  // The health potion, under the bench plate: click it (or press 6) on your move. It does not use the turn.
  plate(back, 6, 92, 140, 16, { cut: 3 });
  const potionIcon = gfx(root);
  potionIcon.fillStyle(0xffffff, 1); potionIcon.fillRect(15, 95, 3, 3);                 // the neck
  potionIcon.fillStyle(0xff6b8a, 1); potionIcon.fillRect(13, 98, 7, 7);                 // the flask
  potionIcon.fillStyle(0xffffff, 0.7); potionIcon.fillRect(14, 99, 2, 2);
  const potionName = text(root, 25, 95, "POTION", {});
  const potionTag = text(root, 140, 95, "", { ox: 1, color: "#9dffb0" });
  const potionEdge = gfx(root);
  let potionOk = false;
  const potionZone = scene.add.zone(6, 92, 140, 16).setOrigin(0).setInteractive({ useHandCursor: true });
  root.add(potionZone);
  potionZone.on("pointerdown", () => { if (api.onPotion) api.onPotion(); });

  // ---------------------------------------------------------------- the boss's plate (top right)
  plate(back, 536, 6, 258, 44);
  const bossAccent = box(root, 791, 10, 3, 36, 0xff3d4d);
  const bossName = text(root, 546, 9, "", { size: 16, bold: true });
  text(root, 546, 31, "HP", { color: "#ff8f90", bold: true });
  const bossHp = bar(root, 564, 32, 170, 7, 0x5fe36c, { ticks: 10 });
  const bossHpText = text(root, 786, 31, "", { ox: 1 });
  plate(back, 706, 54, 88, 15, { cut: 3 });
  text(root, 712, 57, "TIER", { color: DIM });
  const tierPips = gfx(root);
  const demoTag = text(root, 700, 57, "DEMO", { color: hex(GOLD), ox: 1 }).setVisible(false);
  // where on its health bar the boss loses its temper, and the word for when it has
  const rageMark = gfx(root);
  const rageTag = text(root, 546, 57, "ENRAGED!", { color: "#ff6b5b", bold: true }).setVisible(false);
  scene.tweens.add({ targets: rageTag, alpha: { from: 1, to: 0.35 }, duration: 380, yoyo: true, repeat: -1 });

  // ---------------------------------------------------------------- the boss's wind-up (under its plate)
  // What the boss is about to do and how sure that is. This is the thing the player reads.
  const TELL = { x: 606, y: 74, w: 188, h: 50 };
  const GRADES = {
    sure: { label: "SURE", color: "#8dff9b" },
    likely: { label: "LIKELY", color: "#ffd867" },
    flip: { label: "COIN FLIP", color: "#ff8f6b" },
  };
  const tell = scene.add.container(TELL.x, TELL.y).setVisible(false);
  root.add(tell);
  const tellBack = gfx(tell);
  const tellHead = text(tell, 8, 5, "", { color: DIM });
  const tellGrade = text(tell, TELL.w - 8, 5, "", { ox: 1, bold: true });
  const tellMove = text(tell, 8, 15, "", { size: 16, bold: true });
  const tellKind = text(tell, 8, 37, "", { bold: true });
  const tellAlt = text(tell, TELL.w - 8, 37, "", { ox: 1, color: "#c9d2f2" });
  let tellKey = "";
  function setTell(t, key) {
    if (!t) { tell.setVisible(false); tellKey = ""; return; }
    const type = TYPES[t.type] || TYPES.attack;
    const grade = GRADES[t.grade] || GRADES.sure;
    tellHead.setText(t.heavy ? "HEAVY WIND-UP! X2" : "WINDING UP").setColor(t.heavy ? "#ff8f6b" : DIM);
    tellGrade.setText(t.grade === "sure" ? grade.label : `${grade.label} ${Math.round(t.chance * 100)}%`).setColor(grade.color);
    tellMove.setText(t.name.toUpperCase()).setColor(hex(type.color));
    tellMove.setScale(Math.min(1, (TELL.w - 16) / tellMove.width));   // a long name shrinks to fit the panel
    tellKind.setText(type.label).setColor(hex(type.color));
    tellAlt.setText(t.alt ? `OR ${t.alt.name.toUpperCase()} ${Math.round((1 - t.chance) * 100)}%` : "");
    tellBack.clear();
    plate(tellBack, 0, 0, TELL.w, TELL.h, { edge: t.heavy ? 0xff8f6b : type.color, fill: 0x0e1430, low: 0x080c1e });
    tellBack.fillStyle(type.color, 1); tellBack.fillRect(1, 4, 3, TELL.h - 8);
    tellBack.fillStyle(t.heavy ? 0xff8f6b : type.color, 1);
    tellBack.fillTriangle(-7, 18, 0, 12, 0, 24);          // it points at the boss
    tell.setVisible(true);
    if (key !== tellKey) {                                 // a new wind-up pops in
      tellKey = key;
      tell.setScale(0.7).setAlpha(0);
      scene.tweens.add({ targets: tell, scaleX: 1, scaleY: 1, alpha: 1, duration: 200, ease: "Back.easeOut" });
      if (api.onTell) api.onTell(t);
    }
  }

  // ---------------------------------------------------------------- the turn and the clock (top middle)
  plate(back, 356, 6, 88, 17, { cut: 3 });
  const turnText = text(root, 400, 10, "TURN 0", { ox: 0.5 });
  const clockBack = box(root, 356, 27, 88, 3, INK, 0.8);
  const clock = box(root, 356, 27, 88, 3, GOLD);

  // ---------------------------------------------------------------- the dock along the bottom
  // no bar across the bottom any more: the field shows through. The log is a small plate on the
  // left, and the four move cards float on the right, a little see-through.
  plate(back, 6, 386, 290, 58, { glass: true, alpha: 0.12, line: 0.35 });
  const log = text(root, 13, 391, "", { wrap: 276, spacing: 3, stroke: "#05070f", thick: 3 });
  // the rule of the game, always in view
  let ruleX = 13;
  for (const [word, color] of [["ATK", TYPES.attack.color], [">", null], ["SPC", TYPES.special.color], [">", null], ["GRD", TYPES.guard.color], [">", null], ["ATK", TYPES.attack.color]]) {
    const t = text(root, ruleX, 431, word, { color: color ? hex(color) : "#b4bfe6", bold: Boolean(color), stroke: "#05070f", thick: 3 });
    ruleX += t.width + 3;
  }
  text(root, 289, 431, "BEATS", { color: "#b4bfe6", ox: 1, stroke: "#05070f", thick: 3 });

  const cards = [];
  const CARD = { w: 130, h: 72 };   // the four cards sit in a square on the right, two by two
  ["attack", "guard", "special", "skill"].forEach((key, index) => {
    const type = TYPES[key];
    const home = { x: 532 + (index % 2) * 134, y: 298 + Math.floor(index / 2) * 76 };
    const card = scene.add.container(home.x, home.y);
    root.add(card);
    const g = gfx(card);
    const icon = gfx(card);
    const title = text(card, 42, 6, "", { bold: true, size: 10, wrap: 74, spacing: 0, stroke: "#05070f", thick: 4 });
    const kind = text(card, 42, 35, type.label, { color: hex(type.color), bold: true, stroke: "#05070f", thick: 3 });
    const line1 = text(card, 8, 48, "", { color: "#eef2ff", stroke: "#05070f", thick: 3 });
    const line1b = text(card, 8, 48, "", { bold: true, stroke: "#05070f", thick: 3 });
    const line2 = text(card, 8, 60, "", { color: "#b4bfe6", stroke: "#05070f", thick: 3 });
    const pips = gfx(card);
    text(card, CARD.w - 11, 9, String(index + 1), { color: hex(type.color), ox: 0.5, bold: true, stroke: "#05070f", thick: 3 });
    const glow = box(card, 0, 0, CARD.w, CARD.h, type.color, 0).setBlendMode(Phaser.BlendModes.ADD);
    const zone = scene.add.zone(0, 0, CARD.w, CARD.h).setOrigin(0).setInteractive({ useHandCursor: true });
    card.add(zone);
    const entry = { key, type, card, home, g, icon, title, kind, line1, line1b, line2, pips, glow, zone, hover: false, enabled: false, chosen: false, iconName: "" };
    const paint = () => {
      g.clear();
      const lit = entry.hover && entry.enabled;
      plate(g, 0, 0, CARD.w, CARD.h, { edge: entry.chosen ? 0xffffff : lit ? type.color : shade(type.color, 0.55), fill: lit ? 0x1b2550 : PLATE, alpha: lit ? 0.34 : 0.13, line: lit || entry.chosen ? 0.95 : 0.5, glass: true });
      g.fillStyle(type.color, 1); g.fillRect(4, 1, CARD.w - 8, 2);
      g.fillStyle(shade(type.color, 0.32), 0.3); g.fillRect(7, 8, 30, 30);
      g.fillStyle(type.color, 1); g.fillRect(7, 8, 30, 1); g.fillRect(7, 37, 30, 1); g.fillRect(7, 8, 1, 30); g.fillRect(36, 8, 1, 30);
      g.fillStyle(EDGE, 0.7); g.fillRect(8, 44, CARD.w - 16, 1);
      g.fillStyle(INK, 0.8); g.fillRect(CARD.w - 17, 7, 12, 12);
    };
    entry.paint = paint;
    paint();
    zone.on("pointerover", () => { entry.hover = true; paint(); if (entry.enabled) scene.tweens.add({ targets: card, y: home.y - 3, duration: 90, ease: "Quad.easeOut" }); });
    zone.on("pointerout", () => { entry.hover = false; paint(); scene.tweens.add({ targets: card, y: home.y, duration: 120, ease: "Quad.easeOut" }); });
    zone.on("pointerdown", () => { if (entry.enabled && api.onPick) api.onPick(key); });
    cards.push(entry);
  });
  // the skill card breathes gold while it is ready
  const skillCard = cards[3];
  scene.tweens.add({ targets: skillCard.glow, fillAlpha: { from: 0, to: 0.16 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // ---------------------------------------------------------------- what the cards say
  function setCard(entry, move, enabled, chosen, skill, hint) {
    entry.title.setText((move.name || entry.type.label).toUpperCase());
    if (entry.iconName !== move.icon) {
      entry.iconName = move.icon;
      entry.icon.clear();
      entry.icon.fillStyle(0xffffff, 1);
      (ICONS[move.icon] || ICONS.star)(entry.icon, 22, 23);
    }
    entry.pips.clear();
    if (entry.key === "skill") {
      const need = skill ? skill.need : 2;
      const charge = skill ? Math.min(need, skill.charge) : 0;
      const left = need - charge;
      entry.line1.setText(skill ? move.blurb || "ALWAYS WORKS" : "NO SKILL").setColor("#eef2ff");
      entry.line1b.setText("");
      let line = !skill ? "" : skill.ready ? "READY!" : `WIN ${left} TURN${left === 1 ? "" : "S"}`;
      let color = skill && skill.ready ? hex(GOLD) : "#b4bfe6";
      if (skill && skill.ready && hint) { line = hint === "attack" ? "IT HITS BACK" : "SAFE NOW!"; color = hint === "attack" ? "#ff8f6b" : "#8dff9b"; }
      entry.line2.setText(line).setColor(color);
      for (let i = 0; i < need; i++) {
        entry.pips.fillStyle(i < charge ? GOLD : TRACK, 1);
        entry.pips.fillRect(CARD.w - 8 - (need - i) * 13, 62, 11, 6);
      }
      entry.glow.setVisible(Boolean(skill && skill.ready && enabled));
    } else {
      const beats = TYPES[entry.type.beats], loses = TYPES[entry.type.loses];
      entry.line1.setText("BEATS ");
      entry.line1b.setText(beats.label).setColor(hex(beats.color)).setX(8 + entry.line1.width);
      // on the first boss the card says outright how it does against the move being wound up
      if (hint === entry.type.beats) entry.line2.setText("WINS THIS TURN").setColor("#8dff9b");
      else if (hint === entry.type.loses) entry.line2.setText("LOSES THIS TURN").setColor("#ff8f6b");
      else if (hint) entry.line2.setText("CLASH: SMALL HIT").setColor("#ffd867");
      else entry.line2.setText(`LOSES TO ${loses.label}`).setColor("#b4bfe6");
      entry.glow.setVisible(false);
    }
    if (entry.enabled !== enabled || entry.chosen !== chosen) {
      entry.enabled = enabled;
      entry.chosen = chosen;
      entry.paint();
      if (!enabled) scene.tweens.add({ targets: entry.card, y: entry.home.y, duration: 100 });
    }
    entry.card.setAlpha(enabled || chosen ? 1 : 0.72);
  }

  let shownFighter = null;
  let lastHp = null;

  const api = {
    onPick: null,
    onPotion: null,   // the potion plate was clicked
    onTell: null,   // called when a new wind-up appears
    portraits,

    // view: {
    //   fighter: { id, name, hp, max, colour },   bench: { name, hp, max, state } or null
    //   boss: { name, hp, max, tier, demo, colour },   soil, vigor (percent or null),   turn
    //   moves: { attack, guard, special, skill } as data/plants.js gives them
    //   skill: { ready, charge, need } or null
    //   tell: { name, type, grade, chance, alt: { name } or null, heavy } or null: the boss's wind-up
    //   tellKey (changes when the wind-up does),   hints (true: the cards say how they do against it)
    //   canSwap (true when the bench plate may be clicked to change plants),   canPick (true when a card may be clicked),   chosen (the move just sent, or null),   seconds (left to choose, or null)
    // }
    update(view) {
      const f = view.fighter;
      plantName.setText(f.name.toUpperCase());
      plantTag.setText(`PLANT ${f.id}`);
      accent.fillColor = f.colour;
      plantHp.set(f.hp / f.max, hpColor(f.hp / f.max));
      plantHpText.setText(`${f.hp}/${f.max}`);
      soil.set((view.soil ?? 0) / 100);
      soilText.setText(view.soil == null ? "-" : `${Math.round(view.soil)}%`);
      vigor.set((view.vigor ?? 0) / 100);
      vigorText.setText(view.vigor == null ? "-" : `${Math.round(view.vigor)}%`);
      if (shownFighter !== f.id) {
        shownFighter = f.id;
        lastHp = f.hp;
        portraitRing.clear();
        portraitRing.lineStyle(2, f.colour, 1); portraitRing.strokeCircle(31, 38, 21);
        for (const [id, rig] of Object.entries(portraits)) rig.setVisible(id === f.id);
        if (portraits[f.id]) portraits[f.id].setMood("fierce", true).play("enter");
      } else if (portraits[f.id] && f.hp < lastHp) {
        portraits[f.id].play("hurt");
      }
      lastHp = f.hp;
      if (portraits[f.id] && f.hp <= 0) portraits[f.id].setMood("fainted");

      const b = view.bench;
      benchName.setText(b ? b.name.toUpperCase() : "NO BACKUP").setColor(b && b.state !== "down" ? WHITE : DIM);
      benchHp.setVisible(Boolean(b));
      if (b) benchHp.set(b.hp / b.max, hpColor(b.hp / b.max));
      const p = view.potion;
      potionOk = Boolean(p && p.ready && view.canPick && f.hp < f.max);
      potionName.setColor(p && p.ready ? WHITE : DIM);
      potionTag.setText(!p ? "" : p.ready ? (f.hp >= f.max ? "FULL HP" : `+${p.heal} HP  6`) : `${p.seconds_left}S`)
        .setColor(!p || !p.ready ? "#ff8f90" : potionOk ? "#ffd867" : "#9dffb0");
      potionEdge.clear();
      if (potionOk) { potionEdge.lineStyle(1, GOLD, 0.95); potionEdge.strokeRect(5.5, 91.5, 141, 17); }

      swapOk = Boolean(view.canSwap && b && b.state !== "down");
      const swapping = view.chosen === "swap";
      benchTag.setText(b ? (b.state === "down" ? "DOWN" : swapOk || swapping ? "SWAP 5" : "READY") : "")
        .setColor(b && b.state === "down" ? "#ff8f90" : swapOk || swapping ? "#ffd867" : "#9dffb0");
      benchEdge.clear();
      if (swapOk || swapping) { benchEdge.lineStyle(1, swapping ? 0xffffff : GOLD, 0.95); benchEdge.strokeRect(5.5, 72.5, 141, 17); }

      bossName.setText(view.boss.name.toUpperCase());
      bossAccent.fillColor = view.boss.colour;
      bossHp.set(view.boss.hp / view.boss.max, hpColor(view.boss.hp / view.boss.max));
      bossHpText.setText(`${view.boss.hp}/${view.boss.max}`);
      tierPips.clear();
      for (let i = 0; i < 3; i++) {
        tierPips.fillStyle(i < view.boss.tier ? view.boss.colour : TRACK, 1);
        tierPips.fillPoints([{ x: 746 + i * 14, y: 57 }, { x: 751 + i * 14, y: 62 }, { x: 746 + i * 14, y: 67 }, { x: 741 + i * 14, y: 62 }], true);
      }
      demoTag.setVisible(Boolean(view.boss.demo));
      rageTag.setVisible(Boolean(view.boss.enraged));
      rageMark.clear();
      if (view.boss.enrageAt && !view.boss.enraged) {
        const x = 564 + Math.round(170 * view.boss.enrageAt);
        rageMark.fillStyle(0xff6b5b, 1); rageMark.fillRect(x, 30, 1, 11); rageMark.fillTriangle(x - 3, 28, x + 4, 28, x + 0.5, 32);
      }
      setTell(view.tell, view.tellKey);

      turnText.setText(`TURN ${view.turn}`);
      const timed = view.canPick && view.seconds != null;
      clock.setVisible(timed); clockBack.setVisible(timed);
      if (timed) { clock.width = 88 * Phaser.Math.Clamp(view.seconds / 10, 0, 1); clock.fillColor = view.seconds <= 3 ? 0xf2545b : GOLD; }

      for (const entry of cards) {
        const move = view.moves[entry.key] || {};
        const usable = view.canPick && (entry.key !== "skill" || Boolean(view.skill && view.skill.ready));
        setCard(entry, move, usable, view.chosen === entry.key, view.skill, view.hints && view.tell ? view.tell.type : null);
      }
    },

    log(str) { log.setText(str.toUpperCase()); },

    // A banner that slides in from one side to call out a move.
    callout(side, who, move, color) {
      const c = scene.add.container(0, 114);   // below the bench and potion plates
      over.add(c);
      const g = gfx(c);
      const small = text(c, 0, 4, who.toUpperCase(), { color: hex(color) });
      const large = text(c, 0, 14, move.toUpperCase(), { size: 16, bold: true });
      const w = Math.max(small.width, large.width) + 26;
      const left = side === "left";
      plate(g, 0, 0, w, 36, { edge: color, fill: 0x0e1430, low: 0x080c1e });
      g.fillStyle(color, 1); g.fillRect(left ? 1 : w - 5, 4, 4, 28);
      small.setX(left ? 12 : 10); large.setX(left ? 12 : 10);
      const home = left ? 8 : 792 - w;
      const away = left ? -w - 10 : 810;
      c.x = away;
      scene.tweens.add({ targets: c, x: home, duration: 170, ease: "Back.easeOut" });
      scene.tweens.add({ targets: c, x: away, alpha: 0, delay: 1250, duration: 200, ease: "Quad.easeIn", onComplete: () => c.destroy() });
    },

    // The line that tells the fight like a story: "EMBER used VINE HAYMAKER!". It types itself
    // out across the top of the field, holds, and goes. Only one is up at a time.
    announce(who, move, color, hold = 1500) {
      if (announced) announced.destroy();
      const c = scene.add.container(400, 92);
      announced = c;
      over.add(c);
      const g = gfx(c);
      const name = text(c, 0, 0, who.toUpperCase(), { size: 16, bold: true, color: hex(color), oy: 0.5 });
      const rest = text(c, 0, 0, ` USED ${move.toUpperCase()}!`, { size: 16, bold: true, oy: 0.5 });
      const full = rest.text;
      const w = name.width + rest.width + 36;
      plate(g, -w / 2, -17, w, 34, { edge: color, fill: 0x0e1430, low: 0x080c1e });
      g.fillStyle(color, 1); g.fillRect(-w / 2 + 1, -13, 4, 26); g.fillRect(w / 2 - 5, -13, 4, 26);
      name.setX(-w / 2 + 18); rest.setX(name.x + name.width);
      rest.setText("");
      c.setScale(1, 0.1);
      scene.tweens.add({ targets: c, scaleY: 1, duration: 110, ease: "Back.easeOut" });
      scene.tweens.addCounter({ from: 0, to: full.length, duration: full.length * 22, delay: 90, onUpdate: (tw) => {
        if (!c.active) return;
        const shown = full.slice(0, Math.round(tw.getValue()));
        if (shown.length !== rest.text.length && shown.length % 2 === 0) audio.play("tick");
        rest.setText(shown);
      } });
      scene.tweens.add({ targets: c, alpha: 0, y: 84, delay: hold, duration: 180, onComplete: () => { if (announced === c) announced = null; c.destroy(); } });
    },

    // A word that pops in the middle of the field: CLASH!, BLOCKED! ...
    word(str, color = "#ffffff", stageX = 640, stageY = 250, size = 16) {
      const t = text(over, Math.round(stageX / layers.scale), Math.round(stageY / layers.scale), str, { big: true, size, color, stroke: "#05070f", thick: 6, ox: 0.5, oy: 0.5 });
      t.setScale(0.2).setAngle(Phaser.Math.Between(-7, 7));
      scene.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 160, ease: "Back.easeOut" });
      scene.tweens.add({ targets: t, alpha: 0, y: t.y - 14, delay: 620, duration: 260, onComplete: () => t.destroy() });
    },

    // A damage or healing number that jumps out of a fighter. big: a heavier hit.
    number(stageX, stageY, str, color = "#ffffff", big = false) {
      const t = text(over, Math.round(stageX / layers.scale), Math.round(stageY / layers.scale), str, { big: true, size: big ? 32 : 24, color, stroke: "#05070f", thick: 6, ox: 0.5, oy: 0.5 });
      const drift = Phaser.Math.Between(-14, 14);
      t.setScale(0.3);
      scene.tweens.add({ targets: t, scaleX: 1.25, scaleY: 1.25, duration: 110, ease: "Quad.easeOut", yoyo: true, hold: 30, onComplete: () => t.setScale(1) });
      scene.tweens.add({ targets: t, y: t.y - 34, x: t.x + drift, duration: 900, ease: "Cubic.easeOut" });
      scene.tweens.add({ targets: t, alpha: 0, delay: 620, duration: 280, onComplete: () => t.destroy() });
    },

    // The end of the fight. Returns an object for the reward line: see below.
    result(won, message) {
      const veil = box(over, 0, 0, 800, 450, INK, 0);
      scene.tweens.add({ targets: veil, fillAlpha: 0.72, duration: 260 });
      const color = won ? "#ffd45e" : "#ff8f9c";
      const shadow = text(over, 403, 133, won ? "VICTORY!" : "DEFEAT", { big: true, size: 32, color: "#05070f", ox: 0.5, oy: 0.5, shadow: false });
      const title = text(over, 400, 130, won ? "VICTORY!" : "DEFEAT", { big: true, size: 32, color, stroke: "#05070f", thick: 6, ox: 0.5, oy: 0.5 });
      for (const t of [shadow, title]) { t.setScale(0.2); scene.tweens.add({ targets: t, scaleX: 1, scaleY: 1, duration: 260, ease: "Back.easeOut" }); }
      scene.tweens.add({ targets: [shadow, title], angle: { from: -2, to: 2 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      const g = gfx(over);
      plate(g, 230, 180, 340, 92, { edge: won ? GOLD : 0xee7789, fill: 0x121936, low: 0x0b1024 });
      const line = text(over, 400, 196, message.toUpperCase(), { ox: 0.5 });
      let rewardBar = null;
      let rewardLabel = null;
      return {
        setLine(str) { line.setText(str.toUpperCase()); },
        // Fills a bar over `ms` while the pump runs.
        reward(label, ms) {
          if (rewardBar) return;
          rewardBar = bar(over, 260, 222, 280, 9, 0x4ab8ff, { ticks: 8 });
          rewardBar.jump(0);
          rewardLabel = text(over, 400, 240, label.toUpperCase(), { color: "#bfe6ff", ox: 0.5 });
          const fill = { v: 0 };
          scene.tweens.add({ targets: fill, v: 1, duration: ms, onUpdate: () => rewardBar.jump(fill.v), onComplete: () => rewardLabel.setText("DONE") });
        },
      };
    },
  };
  return api;
}
