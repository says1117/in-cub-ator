// client/src/battle/hud.js: Everything printed on the battle screen. Owner: Role 3.
// Panels, health bars, the four move buttons, the boss's sign, blooms, the move timer, banners and
// the result panel. It only shows what it is told: BossScene decides WHEN (the turn player holds
// health changes back until a hit lands), the server decides WHAT.
//
// Coordinates are the 1280 x 720 battle stage. The stage is drawn at 0.625 into the 800 x 450 game,
// so text is made at its real on-screen pixel size and scaled back up: the pixel font stays crisp.
import Phaser from "phaser";
import { FONT, outline } from "../ui/font.js";
import { MOVE_COLORS, MOVE_CSS, MOVE_NAMES, iconFor, iconKey } from "./icons.js";
import { BEATS, COUNTER } from "../state/battleTurns.js";

const BUTTONS = [
  { move: "attack", key: "1", x: 708, y: 474 },
  { move: "guard", key: "2", x: 992, y: 474 },
  { move: "special", key: "3", x: 708, y: 592 },
  { move: "skill", key: "4", x: 992, y: 592 },
];
const BTN_W = 274;
const BTN_H = 110;
const INTENT_AT = { x: 742, y: 214 };   // the boss's sign floats here, to the left of its head

export class BattleHud {
  constructor(scene, layer, overlay, stageScale) {
    this.scene = scene;
    this.layer = layer;        // panels and buttons
    this.overlay = overlay;    // banners and the result panel, above everything
    this.s = stageScale;
    this.buttons = {};
    this.build();
  }

  // ------------------------------------------------------------ helpers
  text(x, y, str, size, color = "#ffffff", opts = {}, layer = this.layer) {
    const px = Math.max(8, Math.round(size * this.s));
    const style = { fontFamily: FONT, fontSize: `${px}px`, color, ...outline(px), ...opts };
    if (opts.wordWrap) style.wordWrap = { width: opts.wordWrap.width * this.s, useAdvancedWrap: true };
    delete style.bold;   // one weight only (see ui/font.js)
    const t = this.scene.add.text(x, y, str, style).setScale(1 / this.s);
    layer.add(t);
    return t;
  }

  plate(x, y, w, h, edge = 0x8fa6d8, layer = this.layer, alpha = 0.82) {
    const shadow = this.scene.add.rectangle(x + 5, y + 6, w, h, 0x05060d, 0.45).setOrigin(0);
    const body = this.scene.add.rectangle(x, y, w, h, 0x0e1224, alpha).setOrigin(0).setStrokeStyle(3, edge, 0.9);
    const shine = this.scene.add.rectangle(x + 4, y + 4, w - 8, 3, 0xffffff, 0.08).setOrigin(0);
    layer.add([shadow, body, shine]);
    return body;
  }

  bar(x, y, w, h, color) {
    const back = this.scene.add.rectangle(x, y, w, h, 0x060914, 1).setOrigin(0).setStrokeStyle(2, 0x6c7697, 1);
    const ghost = this.scene.add.rectangle(x + 3, y + 3, w - 6, h - 6, 0xfff1c9, 1).setOrigin(0);
    const fill = this.scene.add.rectangle(x + 3, y + 3, w - 6, h - 6, color, 1).setOrigin(0);
    const gleam = this.scene.add.rectangle(x + 3, y + 3, w - 6, Math.max(2, (h - 6) * 0.3), 0xffffff, 0.18).setOrigin(0);
    this.layer.add([back, ghost, fill, gleam]);
    return { back, ghost, fill, gleam, max: w - 6, ratio: 1, color };
  }

  // Snap the bar to a value. The light "ghost" behind it waits, then drains: you see how much was lost.
  setBar(bar, ratio, { instant = false } = {}) {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    const tw = this.scene.tweens;
    tw.killTweensOf([bar.fill, bar.ghost, bar.gleam]);
    const w = Math.max(0, bar.max * r);
    if (instant) {
      bar.fill.width = bar.ghost.width = bar.gleam.width = w;
    } else if (r < bar.ratio) {
      bar.fill.width = bar.gleam.width = w;
      tw.add({ targets: bar.ghost, width: w, delay: 320, duration: 420, ease: "Quad.easeIn" });
    } else {
      bar.ghost.width = w;
      tw.add({ targets: [bar.fill, bar.gleam], width: w, duration: 380, ease: "Sine.easeOut" });
    }
    bar.fill.fillColor = r < 0.25 ? 0xf0565e : r < 0.5 ? 0xf2c04a : bar.color;
    bar.ratio = r;
  }

  // ------------------------------------------------------------ layout
  build() {
    // Top left: who is thirsty, and the team
    this.plate(20, 18, 450, 104, 0x7fd8b6);
    this.titleText = this.text(40, 26, "DROUGHT BOSS", 30, "#fff4d8", { bold: true });
    this.subText = this.text(40, 66, "", 18, "#c9d6f2");
    this.team = {};
    ["A", "B"].forEach((id, i) => {
      const x = 40 + i * 214;
      this.team[id] = {
        name: this.text(x, 90, "", 16, "#ffffff"),
        hp: null,
        tag: this.text(x + 150, 90, "", 14, "#cbd4ff"),
        x,
      };
    });
    this.teamBars = {};
    ["A", "B"].forEach((id, i) => {
      const x = 40 + i * 214;
      this.teamBars[id] = this.bar(x + 72, 94, 72, 16, 0x6bea86);
    });

    // Top right: the boss
    this.plate(790, 18, 470, 104, 0xf08a8a);
    this.bossName = this.text(812, 26, "", 32, "#ffffff", { bold: true });
    this.bossTier = this.text(1240, 32, "", 18, "#ffd9a8").setOrigin(1, 0);
    this.text(812, 78, "HP", 20, "#ff8f8f", { bold: true });
    this.bossHP = this.bar(860, 78, 280, 28, 0x63e67c);
    this.bossHPText = this.text(1150, 78, "", 20, "#ffffff");

    // Bottom left: the plant that is fighting
    this.plate(20, 560, 400, 146, 0x7fd8b6);
    this.plantName = this.text(42, 568, "", 34, "#ffffff", { bold: true });
    this.plantSoil = this.text(400, 578, "", 16, "#ffe38a").setOrigin(1, 0);
    this.text(42, 620, "HP", 20, "#ff8f8f", { bold: true });
    this.plantHP = this.bar(90, 620, 220, 26, 0x6bea86);
    this.plantHPText = this.text(320, 620, "", 20, "#ffffff");
    this.text(42, 662, "BLOOMS", 18, "#ffb6dc", { bold: true });
    this.blooms = [];
    for (let i = 0; i < 3; i++) {
      const pip = this.scene.add.image(150 + i * 46, 674, iconKey("bloomEmpty")).setScale(3.2);
      this.layer.add(pip);
      this.blooms.push(pip);
    }
    this.bloomHint = this.text(296, 662, "", 16, "#ffd7ee");

    // Bottom middle: what just happened, in words
    this.plate(436, 600, 256, 106, 0x8fa6d8);
    this.logText = this.text(450, 610, "", 17, "#e6eeff", { wordWrap: { width: 230 } });

    // Move timer, right above the buttons
    this.timerBack = this.scene.add.rectangle(708, 452, 558, 10, 0x060914, 0.85).setOrigin(0).setStrokeStyle(2, 0x6c7697, 1);
    this.timerFill = this.scene.add.rectangle(711, 455, 552, 4, 0x9ff0ff, 1).setOrigin(0);
    this.timerText = this.text(708, 416, "", 22, "#fff4d8", { bold: true });
    this.layer.add([this.timerBack, this.timerFill]);
    this.setTimer(null);

    BUTTONS.forEach((b) => this.buildButton(b));

    // The boss's sign: a bubble beside its head
    this.intent = this.scene.add.container(INTENT_AT.x, INTENT_AT.y).setVisible(false);
    const tail = this.scene.add.triangle(58, 6, 0, -14, 0, 14, 34, 0, 0x0e1224, 0.92);
    const bubble = this.scene.add.rectangle(0, 0, 112, 112, 0x0e1224, 0.92).setStrokeStyle(4, 0xffffff, 1);
    const icon = this.scene.add.image(0, -10, iconFor("?")).setScale(5.5);
    const label = this.text(0, 40, "?", 18, "#ffffff", { bold: true }, this.layer).setOrigin(0.5);
    this.layer.remove(label);
    this.intent.add([tail, bubble, icon, label]);
    this.intent.bubble = bubble;
    this.intent.icon = icon;
    this.intent.label = label;
    this.intentCaption = this.text(INTENT_AT.x, INTENT_AT.y + 66, "", 15, "#dfe6ff").setOrigin(0.5, 0);
    this.layer.add(this.intent);
    this.layer.bringToTop(this.intentCaption);

    // Autopilot ribbon, top middle
    this.auto = this.scene.add.container(640, 146).setVisible(false);
    const autoPlate = this.scene.add.rectangle(0, 0, 440, 44, 0x2a1a4a, 0.88).setStrokeStyle(3, 0xc9a8ff, 1);
    const autoText = this.text(0, 0, "AUTO  ·  press 1–4 to take over", 20, "#f1e6ff", { bold: true }, this.layer).setOrigin(0.5);
    this.layer.remove(autoText);
    this.auto.add([autoPlate, autoText]);
    this.layer.add(this.auto);
    this.scene.tweens.add({ targets: this.auto, alpha: { from: 1, to: 0.7 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  buildButton({ move, key, x, y }) {
    const color = MOVE_COLORS[move];
    const container = this.scene.add.container(x + BTN_W / 2, y + BTN_H / 2);
    const shadow = this.scene.add.rectangle(4, 6, BTN_W, BTN_H, 0x05060d, 0.5);
    const bg = this.scene.add.rectangle(0, 0, BTN_W, BTN_H, color, 1).setStrokeStyle(3, 0x10142a, 1);
    const shine = this.scene.add.rectangle(0, -BTN_H / 2 + 8, BTN_W - 10, 6, 0xffffff, 0.16);
    const glow = this.scene.add.rectangle(0, 0, BTN_W + 14, BTN_H + 14).setStrokeStyle(6, 0xffffff, 1).setVisible(false);
    const keyPlate = this.scene.add.rectangle(-BTN_W / 2 + 26, -BTN_H / 2 + 26, 32, 32, 0x0b0e1c, 0.75).setStrokeStyle(2, 0xffffff, 0.6);
    const keyText = this.text(-BTN_W / 2 + 26, -BTN_H / 2 + 26, key, 20, "#ffffff", { bold: true }).setOrigin(0.5);
    const name = this.text(-BTN_W / 2 + 52, -BTN_H / 2 + 14, move === "skill" ? "SKILL" : MOVE_NAMES[move], 24, "#ffffff", { bold: true });
    const sub = this.text(-BTN_W / 2 + 18, BTN_H / 2 - 34, "", 17, "#f6f1dc");
    const parts = [shadow, glow, bg, shine, keyPlate, keyText, name, sub];
    let beatsIcon = null;
    if (move !== "skill") {
      sub.setText(`${move} · beats`);
      beatsIcon = this.scene.add.image(sub.x + sub.displayWidth + 18, BTN_H / 2 - 24, iconFor(BEATS[move])).setScale(2.4);
      const ownIcon = this.scene.add.image(BTN_W / 2 - 40, -6, iconFor(move)).setScale(4.2);
      parts.push(beatsIcon, ownIcon);
    }
    parts.forEach((p) => this.layer.remove(p));
    container.add(parts);
    const stamp = this.text(0, 0, "LOCKED IN", 24, "#fff4b0", { bold: true }, this.layer).setOrigin(0.5).setAngle(-6).setVisible(false);
    this.layer.remove(stamp);
    container.add(stamp);
    container.setSize(BTN_W, BTN_H).setInteractive({ useHandCursor: true });
    this.layer.add(container);
    this.buttons[move] = { move, container, bg, glow, name, sub, stamp, enabled: false, color };
  }

  // ------------------------------------------------------------ what the panels say
  setFight({ title, subtitle, bossName, tierLabel }) {
    this.titleText.setText(title).setScale(1 / this.s);
    if (this.titleText.displayWidth > 410) this.titleText.setScale((1 / this.s) * 410 / this.titleText.displayWidth);
    this.subText.setText(subtitle);
    this.bossName.setText(bossName);
    this.bossTier.setText(tierLabel);
  }

  setBossHP(hp, max, opts) {
    this.bossHPText.setText(`${Math.max(0, hp)}/${max}`);
    this.setBar(this.bossHP, hp / max, opts);
  }

  setPlant({ name, hp, max, soil }, opts) {
    this.plantName.setText(name);
    this.plantSoil.setText(soil == null ? "" : `SOIL ${Math.round(soil)}%`);
    this.plantHPText.setText(`${Math.max(0, hp)}/${max}`);
    this.setBar(this.plantHP, hp / max, opts);
  }

  setTeam(team, names) {
    const tags = { fighting: "FIGHT", ready: "READY", down: "DOWN" };
    const colors = { fighting: "#ffe680", ready: "#9dffb0", down: "#ff8f90" };
    for (const id of ["A", "B"]) {
      const info = team && team[id];
      const ui = this.team[id];
      const alpha = !info ? 0.35 : info.state === "down" ? 0.55 : 1;
      ui.name.setText(((info && info.name) || names[id] || id).toUpperCase()).setAlpha(alpha).setScale(1 / this.s);
      if (ui.name.displayWidth > 66) ui.name.setScale((1 / this.s) * 66 / ui.name.displayWidth);
      ui.tag.setText(info ? tags[info.state] || "" : "").setColor(info ? colors[info.state] || "#cbd4ff" : "#cbd4ff");
      this.teamBars[id].fill.setAlpha(alpha);
      this.setBar(this.teamBars[id], info ? info.hp / info.max_hp : 0);
    }
  }

  setLog(str) { this.logText.setText(str); }

  // n filled petals out of max. gain/wipe animate the change.
  setBlooms(n, { gain = false, wipe = false, skillReady = false } = {}) {
    this.blooms.forEach((pip, i) => {
      const filled = i < n;
      const key = iconKey(filled ? "bloom" : "bloomEmpty");
      if (pip.texture.key !== key) {
        pip.setTexture(key);
        if (filled && gain) {
          pip.setScale(5.2);
          this.scene.tweens.add({ targets: pip, scale: 3.2, duration: 380, ease: "Back.easeOut" });
        }
        if (!filled && wipe) {
          const petal = this.scene.add.image(pip.x, pip.y, iconKey("bloom")).setScale(3.2).setTint(0x9a9aa8);
          this.layer.add(petal);
          this.scene.tweens.add({ targets: petal, y: pip.y + 46, angle: 70, alpha: 0, duration: 560, ease: "Quad.easeIn", onComplete: () => petal.destroy() });
        }
      }
    });
    this.bloomHint.setText(n > 0 && skillReady ? `skill ×${(1 + 0.5 * n).toFixed(1).replace(".0", "")}` : "");
  }

  // ------------------------------------------------------------ the boss's sign
  showIntent(move, { teach = false, grade = "sure", chance = 1, bluff = null, heavy = false, laser = false } = {}) {
    const m = move || "?";
    const c = this.intent;
    c.icon.setTexture(iconFor(m));
    c.bubble.setStrokeStyle(4, MOVE_COLORS[m], 1);
    c.label.setText(m === "?" ? "???" : MOVE_NAMES[m]).setColor(MOVE_CSS[m]);
    const confidence = `${grade.toUpperCase()} ${Math.round(chance * 100)}%`;
    this.intentCaption.setText(m === "?" ? "hiding its move" :
      `${confidence}${heavy ? " · HEAVY" : ""}${laser ? " · LASER" : ""}\n${COUNTER[m].toUpperCase()} beats it${bluff ? ` · may bluff ${bluff.toUpperCase()}` : ""}`)
      .setColor("#ffe1a3");
    c.setVisible(true).setScale(0.2).setAlpha(0);
    this.intentCaption.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 260, ease: "Back.easeOut" });
    this.scene.tweens.add({ targets: this.intentCaption, alpha: 1, duration: 260, delay: 120 });
    for (const b of Object.values(this.buttons)) b.glow.setVisible(false);
    if (m !== "?") {
      const b = this.buttons[COUNTER[m]];
      b.glow.setStrokeStyle(6, MOVE_COLORS[m], 1).setVisible(true);
      this.scene.tweens.killTweensOf(b.glow);
      b.glow.setAlpha(1);
      this.scene.tweens.add({ targets: b.glow, alpha: teach ? 0.25 : 0.55, duration: teach ? 380 : 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  hideIntent() {
    this.scene.tweens.add({ targets: [this.intent, this.intentCaption], alpha: 0, duration: 160, onComplete: () => { this.intent.setVisible(false); this.intentCaption.setVisible(false); } });
    for (const b of Object.values(this.buttons)) { this.scene.tweens.killTweensOf(b.glow); b.glow.setVisible(false); }
  }

  // The hidden sign turns over to show what the boss really did.
  flipIntent(move) {
    const c = this.intent;
    if (!c.visible) this.showIntent(move);
    this.scene.tweens.add({
      targets: c, scaleX: 0, duration: 110, ease: "Quad.easeIn",
      onComplete: () => {
        c.icon.setTexture(iconFor(move));
        c.bubble.setStrokeStyle(4, MOVE_COLORS[move], 1);
        c.label.setText(MOVE_NAMES[move]).setColor(MOVE_CSS[move]);
        this.scene.tweens.add({ targets: c, scaleX: 1, duration: 130, ease: "Quad.easeOut" });
      },
    });
  }

  pulseIntent() {
    this.scene.tweens.add({ targets: this.intent, scale: 1.18, duration: 120, yoyo: true, ease: "Quad.easeOut" });
  }

  // ------------------------------------------------------------ buttons
  // Each plant calls its three moves by its own names (data/plants.js): "Vine Haymaker" for attack.
  setMoveNames(names) {
    for (const move of ["attack", "guard", "special"]) {
      if (names[move]) this.buttons[move].name.setText(names[move].toUpperCase());
    }
  }

  // enabled: which moves can be pressed now. skill: the server's skill info. blurb: the plant's own
  // one-line description of its skill (data/plants.js), shown while it is ready.
  setButtons(enabled, skill, blurb = null) {
    for (const b of Object.values(this.buttons)) {
      const on = enabled && (b.move !== "skill" || (skill && skill.ready));
      b.enabled = on;
      b.bg.setAlpha(on ? 1 : 0.45);
      b.container.setAlpha(on ? 1 : 0.8);
    }
    const s = this.buttons.skill;
    if (skill) {
      s.name.setText(skill.name.toUpperCase());
      const what = blurb ? blurb.toLowerCase() : skill.kind === "heal" ? `heals ${skill.power}` : skill.kind === "shield" ? `blocks · ${skill.power} back` : `${skill.power} damage`;
      s.sub.setText(skill.ready ? `always hits · ${what}` : `charge ${skill.charge}/${skill.need} · win ${skill.ready_in} more`);
    } else {
      s.name.setText("SKILL");
      s.sub.setText("no skill");
    }
  }

  lockIn(move) {
    for (const b of Object.values(this.buttons)) {
      if (b.move === move) {
        b.stamp.setVisible(true).setScale(1.6).setAlpha(0);
        this.scene.tweens.add({ targets: b.stamp, scale: 1, alpha: 1, duration: 160, ease: "Back.easeOut" });
        this.scene.tweens.add({ targets: b.container, scale: 0.94, duration: 60, yoyo: true });
        b.bg.setAlpha(1);
      } else {
        b.container.setAlpha(0.45);
      }
    }
  }

  clearLock() {
    for (const b of Object.values(this.buttons)) { b.stamp.setVisible(false); b.container.setScale(1); }
  }

  // The autopilot's hand presses a button, so watchers see what it picked.
  ghostPress(move) {
    const b = this.buttons[move];
    if (!b) return;
    const flash = this.scene.add.rectangle(0, 0, BTN_W, BTN_H, 0xffffff, 0.55);
    b.container.add(flash);
    this.scene.tweens.add({ targets: b.container, scale: 0.92, duration: 90, yoyo: true });
    this.scene.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
  }

  denied(move) {
    const b = this.buttons[move];
    if (!b) return;
    const x = b.container.x;
    this.scene.tweens.add({ targets: b.container, x: x + 6, duration: 40, yoyo: true, repeat: 2, onComplete: () => b.container.setX(x) });
  }

  // ------------------------------------------------------------ timer and autopilot
  // deadline: scene time (ms) when the server picks for you, or null to hide the timer.
  setTimer(deadline, total = 8000) {
    this.deadline = deadline;
    this.timerTotal = total;
    const on = deadline != null;
    this.timerBack.setVisible(on);
    this.timerFill.setVisible(on);
    this.timerText.setVisible(on);
    this.lastTick = null;
  }

  // Called every frame. Returns the whole seconds left when that number just changed, else null.
  updateTimer(now) {
    if (this.deadline == null) return null;
    const left = Math.max(0, this.deadline - now);
    const k = Phaser.Math.Clamp(left / this.timerTotal, 0, 1);
    this.timerFill.width = 552 * k;
    const secs = Math.ceil(left / 1000);
    const urgent = secs <= 3;
    this.timerFill.fillColor = urgent ? 0xff6a6a : 0x9ff0ff;
    if (secs !== this.lastTick) {
      this.lastTick = secs;
      this.timerText.setText(secs > 0 ? `YOUR MOVE  ${secs}` : "AUTO-PICK!").setColor(urgent ? "#ff9a9a" : "#fff4d8");
      if (urgent && secs > 0) {
        this.timerText.setScale(1.3 / this.s);
        this.scene.tweens.add({ targets: this.timerText, scale: 1 / this.s, duration: 300, ease: "Quad.easeOut" });
      }
      return secs;
    }
    return null;
  }

  setAuto(on) {
    if (this.auto.visible === on) return;
    this.auto.setVisible(on);
  }

  // ------------------------------------------------------------ banners
  // A big line across the middle: the verdict of a turn, a skill's name, "GO, EMBER!".
  banner(str, color = "#ffffff", { size = 44, y = 300, hold = 700 } = {}) {
    const t = this.text(640, y, str, size, color, { bold: true }, this.overlay).setOrigin(0.5).setScale(0.6 / this.s).setAlpha(0);
    this.scene.tweens.add({ targets: t, scale: 1 / this.s, alpha: 1, duration: 160, ease: "Back.easeOut" });
    this.scene.tweens.add({ targets: t, alpha: 0, y: y - 24, delay: hold, duration: 260, onComplete: () => t.destroy() });
    return t;
  }

  // The verdict drawn in icons: [guard] > [attack]
  verdict(winner, loser, kind) {
    const color = kind === "win" ? 0x7bf09a : kind === "lose" ? 0xff7a7a : 0xc8cde6;
    const css = kind === "win" ? "#9dffb4" : kind === "lose" ? "#ff9a9a" : "#dfe3f5";
    const group = this.scene.add.container(640, 292).setAlpha(0).setScale(0.6);
    const plate = this.scene.add.rectangle(0, 0, 360, 92, 0x0b0e1c, 0.78).setStrokeStyle(4, color, 1);
    const a = this.scene.add.image(-96, 0, iconFor(winner)).setScale(5.5);
    const b = this.scene.add.image(96, 0, iconFor(loser)).setScale(5.5);
    const sign = this.text(0, -2, kind === "tie" ? "=" : ">", 52, css, { bold: true }, this.overlay).setOrigin(0.5);
    this.overlay.remove(sign);
    group.add([plate, a, b, sign]);
    this.overlay.add(group);
    this.scene.tweens.add({ targets: group, alpha: 1, scale: 1, duration: 150, ease: "Back.easeOut" });
    if (kind === "tie") this.scene.tweens.add({ targets: [a, b], x: (t) => t.x * 0.8, duration: 90, yoyo: true, repeat: 1 });
    else this.scene.tweens.add({ targets: b, angle: 25, alpha: 0.35, delay: 160, duration: 200 });
    this.scene.tweens.add({ targets: group, alpha: 0, delay: 760, duration: 220, onComplete: () => group.destroy() });
  }

  // ------------------------------------------------------------ result
  showResult(words, { waterMs = 0 } = {}) {
    const dim = this.scene.add.rectangle(0, 0, 1280, 720, 0x050b1c, 0.0).setOrigin(0);
    this.overlay.add(dim);
    this.scene.tweens.add({ targets: dim, fillAlpha: 0.55, duration: 300 });
    const win = words.title === "VICTORY!";
    const edge = win ? 0xf0c35a : words.title === "DEFEAT" ? 0xee7789 : 0x9fb0d8;
    const title = this.text(640, 196, words.title, 64, win ? "#ffd867" : words.title === "DEFEAT" ? "#ff9caa" : "#dfe6ff", { bold: true }, this.overlay).setOrigin(0.5).setAngle(-4);
    title.setScale(0.4 / this.s);
    this.scene.tweens.add({ targets: title, scale: 1 / this.s, duration: 380, ease: "Back.easeOut" });
    const panel = this.scene.add.rectangle(640, 372, 640, 196, 0x0e1224, 0.94).setStrokeStyle(4, edge, 1);
    this.overlay.add(panel);
    this.resultLine = this.text(640, 300, words.line, 32, "#ffffff", { bold: true }, this.overlay).setOrigin(0.5, 0);
    this.resultDetail = this.text(640, 348, words.detail, 20, "#d3ddf5", { wordWrap: { width: 580 }, align: "center" }, this.overlay).setOrigin(0.5, 0);
    if (words.water && waterMs > 0) {
      const back = this.scene.add.rectangle(380, 420, 520, 26, 0x060914, 1).setOrigin(0, 0.5).setStrokeStyle(2, 0x6c7697, 1);
      const fill = this.scene.add.rectangle(383, 420, 0, 18, 0x4aa3ff, 1).setOrigin(0, 0.5);
      this.overlay.add([back, fill]);
      this.scene.tweens.add({ targets: fill, width: 514, duration: waterMs, ease: "Linear" });
      // drops falling into the bar
      for (let i = 0; i < 10; i++) {
        const drop = this.scene.add.ellipse(400 + i * 50, 380, 8, 12, 0x8fd0ff, 1).setAlpha(0);
        this.overlay.add(drop);
        this.scene.tweens.add({ targets: drop, y: 418, alpha: { from: 1, to: 0 }, delay: i * (waterMs / 10), duration: 420, ease: "Quad.easeIn", repeat: 1, onComplete: () => drop.destroy() });
      }
    }
    return title;
  }
}
