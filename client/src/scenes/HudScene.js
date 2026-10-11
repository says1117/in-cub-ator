// client/src/scenes/HudScene.js: The in-canvas HUD, drawn above every other scene. Owner: Role 3.
// Started once at boot (main.js) and never stopped. It only reads the registry:
//   serverState  the latest game state from the server (PROJECT.md, state message v2)
//   connected    true / false from the WebSocket (unset until the first attempt ends)
//   sendDemo     () => asks the server for a demo boss
//   audio        optional, { toggleMute(), isMuted() }
//
// Forest (modes walking and cooldown, while the forest is on screen):
//   pet tags (name, droplet meter, %), the stats line top left, the "Summon boss" button top right,
//   and a captions ribbon at the bottom.
// Every mode: a "reconnecting…" / "ESP32 offline" pill top centre and the mute icon bottom right.
// The battle screen draws its own HUD, so the forest pieces fade out for boss, battle and reward.
import Phaser from "phaser";
import { textStyle } from "../ui/font.js";
import { PLANTS, PLANT_IDS } from "../data/plants.js";
import {
  HUD, drawPlate, drawBitmap, drawDroplet, DROP_W, DROP_H,
  PLAY, ARROW, GLYPH_SCALE, SPEAKER_ON, SPEAKER_OFF, TAIL,
} from "../ui/hudArt.js";
import {
  isForestMode, demoAvailable, statsLine, plantName, waterPercent, isThirsty,
  ribbonCaptions, parseCaption,
} from "../ui/hudText.js";

const W = 800;
const H = 450;
const MARGIN = 8;
const CAPTION_MS = 5000;     // each ribbon caption stays this long
const FADE_MS = 350;
const TAG_GAP = 20;          // from the top of the taller plant up to the tail of its tag
const TAG_SPACING = 4;       // the least room between the two tags
const ARROW_NUDGE = 0;       // lines the drawn arrow up with the font's capitals
const FALLBACK_NAMES = Object.fromEntries(PLANT_IDS.map((id) => [id, PLANTS[id].name]));

// HUD text: the shared style. Every HUD text is 16 px: Tiny5 sits on an 8 px grid, so 16 px puts
// each font pixel on exactly 2 x 2 screen pixels (12, 14 and 18 px come out uneven).
// All HUD text sits on a dark plate, so it needs no drop shadow: a 1 px shadow under 2 px font
// pixels makes 8 and % look checkered.
const NO_SHADOW = { shadow: { offsetX: 0, offsetY: 0, fill: false, stroke: false } };
const plain = (size, color, extra = {}) => textStyle(size, color, { ...NO_SHADOW, ...extra });

export default class HudScene extends Phaser.Scene {
  constructor() {
    super({ key: "HudScene", active: true });
  }

  create() {
    this.state = undefined;
    this.connected = undefined;
    this.muted = undefined;
    this.audio = undefined;
    this.forestOn = false;
    this.demoOn = null;          // unknown until the first update
    this.demoBusy = false;
    this.demoCooldownUntil = 0;

    this.forest = this.add.container(0, 0).setAlpha(0);
    this.global = this.add.container(0, 0);

    this.buildStats();
    this.buildDemo();
    this.buildRibbon();
    this.buildTags();
    this.buildPills();
    this.buildMute();

    this.input.keyboard.on("keydown-D", () => this.summon());

    // The state arrives with every server message; update() also catches the very first one.
    this.onState = (_parent, state) => this.applyState(state);
    this.registry.events.on("changedata-serverState", this.onState);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.registry.events.off("changedata-serverState", this.onState);
    });

    this.scene.bringToTop();
    this.applyState(this.registry.get("serverState"));
  }

  // ---------------------------------------------------------------- building

  buildStats() {
    this.statsBack = this.add.graphics();
    this.statsText = this.add.text(0, 0, "", plain(16, HUD.text));
    this.statsIcon = this.add.graphics();
    this.forest.add([this.statsBack, this.statsIcon, this.statsText]);
    this.statsLineNow = null;
  }

  layoutStats(line) {
    if (line === this.statsLineNow) return;
    this.statsLineNow = line;
    this.statsText.setText(line);
    const padX = 7;
    const h = 26;
    const w = padX + DROP_W + 5 + Math.ceil(this.statsText.width) + padX;
    this.statsBack.clear();
    drawPlate(this.statsBack, MARGIN, MARGIN, w, h, { highlight: true });
    this.statsIcon.clear();
    drawDroplet(this.statsIcon, MARGIN + padX, MARGIN + Math.round((h - DROP_H) / 2), 0.7);
    this.statsText.setPosition(MARGIN + padX + DROP_W + 5, MARGIN + Math.round((h - this.statsText.height) / 2));
  }

  buildDemo() {
    const label = this.add.text(0, 0, "Summoning…", plain(16, HUD.gold));
    const busyW = Math.ceil(label.width);
    label.setText("Summon boss");
    const key = this.add.text(0, 0, "D", plain(16, "#1a1206"));
    const padX = 8;
    const h = 26;
    const keyW = 16;
    const w = padX + PLAY[0].length * GLYPH_SCALE + 6 + Math.max(busyW, Math.ceil(label.width)) + 8 + keyW + padX;
    const x = W - MARGIN - w;
    const y = MARGIN;
    const back = this.add.graphics();
    const icon = this.add.graphics();
    const container = this.add.container(x, y, [back, icon, label, key]);
    this.demo = { container, back, icon, label, key, w, h, keyW, padX, hover: false, pressed: false };
    label.setPosition(padX + PLAY[0].length * GLYPH_SCALE + 6, Math.round((h - label.height) / 2));
    key.setPosition(w - padX - keyW + Math.round((keyW - key.width) / 2), Math.round((h - key.height) / 2));
    this.drawDemo();

    const zone = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    zone.on("pointerover", () => { this.demo.hover = true; this.drawDemo(); });
    zone.on("pointerout", () => { this.demo.hover = false; this.drawDemo(); });
    zone.on("pointerdown", () => this.summon());
    this.demo.zone = zone;
    this.forest.add([container, zone]);
  }

  drawDemo() {
    const d = this.demo;
    const busy = this.demoBusy;
    d.back.clear();
    drawPlate(d.back, 0, 0, d.w, d.h, {
      fill: d.hover && !busy ? 0x3a1f16 : 0x24120f,
      alpha: 0.85,
      border: busy ? HUD.grey : HUD.goldHex,
      borderAlpha: busy ? 0.6 : 0.9,
      highlight: true,
    });
    d.icon.clear();
    drawBitmap(d.icon, PLAY, d.padX, Math.round((d.h - PLAY.length * GLYPH_SCALE) / 2), { "#": busy ? HUD.grey : HUD.goldHex }, GLYPH_SCALE);
    // the key cap
    const kx = d.w - d.padX - d.keyW;
    const ky = Math.round((d.h - 18) / 2);
    drawPlate(d.icon, kx, ky, d.keyW, 18, {
      fill: busy ? HUD.grey : HUD.goldHex, alpha: 1, border: 0xfff1c4, borderAlpha: busy ? 0.3 : 0.9,
    });
    d.label.setColor(busy ? HUD.greyText : HUD.gold);
    d.label.setText(busy ? "Summoning…" : "Summon boss");
    d.key.setVisible(true);
  }

  buildRibbon() {
    this.ribbon = this.add.container(0, 0).setAlpha(0);
    this.ribbonBack = this.add.graphics();
    this.ribbonLine = this.add.container(0, 0);
    this.ribbon.add([this.ribbonBack, this.ribbonLine]);
    this.forest.add(this.ribbon);
    this.captions = [];
    this.captionIndex = 0;
    this.captionShown = null;
    this.captionSince = 0;
    this.ribbonOn = false;
    this.ribbonSwapping = false;
    this.captionsChanged = false;
  }

  // Draws a caption (with its arrows and accent words) centred at the bottom.
  setCaption(caption) {
    this.captionShown = caption;
    this.ribbonLine.removeAll(true);
    const size = 16;
    let x = 0;
    for (const piece of parseCaption(caption)) {
      if (piece.arrow) {
        const g = this.add.graphics();
        drawBitmap(g, ARROW, x + 2, 0, { "#": HUD.goldHex }, GLYPH_SCALE);
        g.arrowPiece = true;
        this.ribbonLine.add(g);
        x += ARROW[0].length * GLYPH_SCALE + 4;
      } else {
        const t = this.add.text(x, 0, piece.text, plain(size, piece.accent ? HUD.gold : HUD.text));
        this.ribbonLine.add(t);
        x += Math.ceil(t.width);
      }
    }
    const lineH = Math.max(...this.ribbonLine.list.filter((o) => o.type === "Text").map((t) => t.height), 18);
    // centre the arrows on the text's x-height
    for (const o of this.ribbonLine.list) if (o.arrowPiece) o.y = Math.round(lineH / 2 - (ARROW.length * GLYPH_SCALE) / 2) + ARROW_NUDGE;

    const padX = 12;
    const h = 30;
    const w = x + padX * 2;
    const left = Math.round((W - w) / 2);
    const top = H - MARGIN - h;
    this.ribbonBack.clear();
    drawPlate(this.ribbonBack, left, top, w, h, { highlight: true });
    this.ribbonLine.setPosition(left + padX, top + Math.round((h - lineH) / 2));
  }

  buildTags() {
    this.tags = {};
    for (const id of PLANT_IDS) {
      const g = this.add.graphics();
      const name = this.add.text(0, 0, "", plain(16, Phaser.Display.Color.IntegerToColor(PLANTS[id].glow).rgba));
      const pct = this.add.text(0, 0, "", plain(16, HUD.text));
      const container = this.add.container(0, 0, [g, name, pct]).setVisible(false);
      this.forest.add(container);
      this.tags[id] = { id, g, name, pct, container, x: null, w: 0, key: null };
    }
  }

  // Redraws one tag when what it shows changes. Its origin is the tip of its tail.
  drawTag(tag) {
    const s = this.state;
    const unknown = !s || !s.meters || s.meters.stale || this.connected === false;
    const water = unknown ? null : waterPercent(s, tag.id);
    const thirsty = !unknown && isThirsty(s, tag.id);
    // title case: the font's capital Z reads like a 2 in an all-caps "ZEST"
    const label = plantName(s, tag.id, FALLBACK_NAMES[tag.id]);
    const key = `${label}|${water}|${thirsty}|${unknown}`;
    if (key === tag.key) return;
    tag.key = key;

    tag.name.setText(label);
    tag.name.setColor(unknown ? HUD.greyText : Phaser.Display.Color.IntegerToColor(PLANTS[tag.id].glow).rgba);
    tag.pct.setText(water === null ? "?" : `${water}%`);
    tag.pct.setColor(unknown ? HUD.greyText : thirsty ? HUD.thirstyText : HUD.text);

    const padX = 6;
    const nameW = Math.ceil(tag.name.width);
    const rowW = DROP_W + 4 + Math.ceil(tag.pct.width);
    const w = Math.max(nameW, rowW) + padX * 2;
    const lineH = 17;
    const h = 3 + lineH + lineH + 3;
    const left = -Math.floor(w / 2);
    const top = -TAIL.length - h + 1;
    tag.w = w;

    const border = unknown ? HUD.grey : thirsty ? HUD.thirsty : HUD.border;
    tag.g.clear();
    drawPlate(tag.g, left, top, w, h, { border, borderAlpha: thirsty ? 0.95 : HUD.borderAlpha });
    drawBitmap(tag.g, TAIL, -2, top + h - 1, { "#": [border, thirsty ? 0.95 : HUD.borderAlpha] });

    const nameY = top + 3 + Math.round((lineH - tag.name.height) / 2);
    tag.name.setPosition(left + Math.round((w - nameW) / 2), nameY);
    const rowLeft = left + Math.round((w - rowW) / 2);
    const rowTop = top + 3 + lineH;
    drawDroplet(tag.g, rowLeft, rowTop + Math.round((lineH - DROP_H) / 2), water === null ? null : water / 100, {
      outline: unknown ? HUD.grey : thirsty ? HUD.thirsty : 0xcfe6ff,
      fill: unknown ? HUD.grey : HUD.water,
    });
    tag.pct.setPosition(rowLeft + DROP_W + 4, rowTop + Math.round((lineH - tag.pct.height) / 2));
  }

  buildPills() {
    this.pillBack = this.add.graphics();
    this.pillTexts = [
      this.add.text(0, 0, "reconnecting…", plain(16, "#ffd6d6")),
      this.add.text(0, 0, "ESP32 offline", plain(16, "#ffe2b0")),
    ];
    this.global.add([this.pillBack, ...this.pillTexts]);
    this.pillKey = null;
  }

  layoutPills() {
    const s = this.state;
    const offline = this.connected === false;
    const stale = !offline && !!(s && s.meters && s.meters.stale);
    const key = `${offline}|${stale}`;
    if (key === this.pillKey) return;
    this.pillKey = key;
    const shown = [];
    if (offline) shown.push({ text: this.pillTexts[0], fill: 0x4a1218, border: 0xff7a7a });
    if (stale) shown.push({ text: this.pillTexts[1], fill: 0x3d2a0c, border: 0xffc46b });
    this.pillTexts.forEach((t) => t.setVisible(shown.some((p) => p.text === t)));
    this.pillBack.clear();
    const h = 24;
    const padX = 10;
    const total = shown.reduce((sum, p) => sum + Math.ceil(p.text.width) + padX * 2, 0) + Math.max(0, shown.length - 1) * 6;
    let x = Math.round((W - total) / 2);
    for (const p of shown) {
      const w = Math.ceil(p.text.width) + padX * 2;
      drawPlate(this.pillBack, x, MARGIN, w, h, { fill: p.fill, alpha: 0.88, border: p.border, borderAlpha: 0.9 });
      p.text.setPosition(x + padX, MARGIN + Math.round((h - p.text.height) / 2));
      x += w + 6;
    }
  }

  buildMute() {
    const w = 24;
    const h = 22;
    const x = W - MARGIN - w;
    const y = H - MARGIN - h;
    this.muteG = this.add.graphics();
    this.muteBox = { x, y, w, h, hover: false };
    this.muteZone = this.add.zone(x, y, w, h).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    this.muteZone.on("pointerover", () => { this.muteBox.hover = true; this.drawMute(); });
    this.muteZone.on("pointerout", () => { this.muteBox.hover = false; this.drawMute(); });
    this.muteZone.on("pointerdown", () => {
      const audio = this.registry.get("audio");
      if (audio && typeof audio.toggleMute === "function") audio.toggleMute();
      this.syncMute(true);
    });
    this.global.add([this.muteG, this.muteZone]);
    this.syncMute(true);
  }

  // Shows the speaker only when there is an audio module to mute.
  syncMute(force = false) {
    const audio = this.registry.get("audio");
    // Hidden on the battle screen: every corner there holds a panel or a move button (M still mutes).
    const inBattle = this.scene.isActive("BossScene");
    const has = !!(audio && typeof audio.toggleMute === "function") && !inBattle;
    const muted = has && typeof audio.isMuted === "function" ? !!audio.isMuted() : false;
    if (!force && audio === this.audio && muted === this.muted && has === this.muteShown) return;
    this.audio = audio;
    this.muted = muted;
    this.muteShown = has;
    this.muteG.setVisible(has);
    if (has) this.muteZone.setInteractive({ useHandCursor: true });
    else this.muteZone.disableInteractive();
    this.drawMute();
  }

  drawMute() {
    const b = this.muteBox;
    const g = this.muteG;
    g.clear();
    drawPlate(g, b.x, b.y, b.w, b.h, { alpha: b.hover ? 0.85 : 0.6, borderAlpha: b.hover ? 0.9 : 0.5 });
    const icon = this.muted ? SPEAKER_OFF : SPEAKER_ON;
    const ix = b.x + Math.round((b.w - icon[0].length) / 2);
    const iy = b.y + Math.round((b.h - icon.length) / 2);
    drawBitmap(g, icon, ix, iy, {
      "#": this.muted ? HUD.grey : 0xf6ecd2,
      w: 0xf6ecd2,
      x: 0xff8a7a,
    });
  }

  // ---------------------------------------------------------------- behaviour

  summon() {
    if (!this.demoOn || !this.forestOn) return;
    if (this.time.now < this.demoCooldownUntil) return;
    const send = this.registry.get("sendDemo");
    if (typeof send === "function") send();
    // a short "summoning" state so a double press does not ask twice (update() redraws it)
    this.demoCooldownUntil = this.time.now + 2500;
  }

  applyState(state) {
    this.state = state;
    this.layoutStats(statsLine(state));
    this.layoutPills();
    for (const tag of Object.values(this.tags)) this.drawTag(tag);

    const captions = ribbonCaptions(state, FALLBACK_NAMES, { demo: this.canSummon() });
    if (captions.join("\n") !== this.captions.join("\n")) {
      // a new first caption (a fight's result) shows at once; otherwise the current one stays
      const fresh = captions.length > 0 && !this.captions.includes(captions[0]);
      const keep = fresh ? -1 : captions.indexOf(this.captionShown);
      this.captions = captions;
      this.captionIndex = keep >= 0 ? keep : 0;
      this.captionsChanged = keep < 0;               // swap to the new list's first caption at once
    }
  }

  // The server offers a demo boss and there is a connection to ask it on.
  canSummon() {
    return this.connected !== false && demoAvailable(this.state);
  }

  // Is the forest on screen right now, in a mode where its HUD belongs?
  forestVisible() {
    const adventure = this.scene.get("AdventureScene");
    if (!adventure || !this.scene.isActive("AdventureScene") || adventure.cutting || adventure.inBattleScene) return false;
    const s = this.state;
    return !s || isForestMode(s.mode);
  }

  fadeTo(target, alpha) {
    this.tweens.killTweensOf(target);
    this.tweens.add({ targets: target, alpha, duration: FADE_MS, ease: "Sine.easeInOut" });
  }

  updateRibbon(time) {
    const want = this.forestOn && this.captions.length > 0;
    if (want !== this.ribbonOn) {
      this.ribbonOn = want;
      if (want) {
        this.ribbonSwapping = false;
        this.captionsChanged = false;
        this.setCaption(this.captions[this.captionIndex % this.captions.length]);
        this.captionSince = time;
      }
      this.fadeTo(this.ribbon, want ? 1 : 0);
      return;
    }
    if (!want || this.ribbonSwapping) return;
    if (!this.captionsChanged && time - this.captionSince < CAPTION_MS) return;
    // gentle swap: fade out, change, fade in
    this.ribbonSwapping = true;
    this.tweens.killTweensOf(this.ribbon);
    this.tweens.add({
      targets: this.ribbon, alpha: 0, duration: FADE_MS, ease: "Sine.easeIn",
      onComplete: () => {
        // the next caption, or the first of a list that arrived meanwhile
        if (this.captionsChanged) this.captionsChanged = false;
        else this.captionIndex = (this.captionIndex + 1) % Math.max(1, this.captions.length);
        if (!this.ribbonOn || !this.captions.length) { this.ribbonSwapping = false; return; }
        this.setCaption(this.captions[this.captionIndex % this.captions.length]);
        this.captionSince = this.time.now;
        this.tweens.add({
          targets: this.ribbon, alpha: 1, duration: FADE_MS, ease: "Sine.easeOut",
          onComplete: () => { this.ribbonSwapping = false; },
        });
      },
    });
  }

  updateTags(delta) {
    const adventure = this.scene.get("AdventureScene");
    const anchors = adventure && adventure.pets && typeof adventure.pets.tagAnchors === "function"
      ? adventure.pets.tagAnchors() : null;
    const haveData = !!(this.state && this.state.meters);
    const live = [];
    for (const tag of Object.values(this.tags)) {
      const a = anchors && anchors[tag.id];
      const show = !!a && haveData;
      tag.container.setVisible(show);
      if (!show) { tag.x = null; continue; }
      const k = Math.min(1, (delta / 1000) * 10);
      tag.x = tag.x === null ? a.x : tag.x + (a.x - tag.x) * k;
      live.push({ tag, a, x: tag.x });
    }
    if (!live.length) return;
    // both tags sit on one line, above the taller plant
    const y = Math.round(Math.min(...live.map((l) => l.a.y)) - TAG_GAP);
    // keep them apart and on screen
    live.sort((p, q) => p.x - q.x);
    for (let i = 1; i < live.length; i++) {
      const p = live[i - 1];
      const q = live[i];
      const need = (p.tag.w + q.tag.w) / 2 + TAG_SPACING;
      if (q.x - p.x < need) {
        const mid = (p.x + q.x) / 2;
        p.x = mid - need / 2;
        q.x = mid + need / 2;
      }
    }
    for (const l of live) {
      const half = l.tag.w / 2;
      l.x = Math.max(MARGIN + half, Math.min(W - MARGIN - half, l.x));
    }
    for (let i = 1; i < live.length; i++) {
      const need = (live[i - 1].tag.w + live[i].tag.w) / 2 + TAG_SPACING;
      if (live[i].x - live[i - 1].x < need) live[i].x = live[i - 1].x + need;
    }
    for (const l of live) l.tag.container.setPosition(Math.round(l.x), y);
  }

  update(time, delta) {
    // stay above any scene started after this one
    const manager = this.scene.manager;
    if (manager.getIndex(this.scene.key) !== manager.scenes.length - 1) this.scene.bringToTop();

    const state = this.registry.get("serverState");
    const connected = this.registry.get("connected");
    if (connected !== this.connected) {
      this.connected = connected;
      this.pillKey = null;
      for (const tag of Object.values(this.tags)) tag.key = null;
      this.applyState(state);
    } else if (state !== this.state) {
      this.applyState(state);
    }
    this.syncMute();

    const forest = this.forestVisible();
    if (forest !== this.forestOn) {
      this.forestOn = forest;
      this.fadeTo(this.forest, forest ? 1 : 0);
    }
    const busy = time < this.demoCooldownUntil;
    if (busy !== this.demoBusy) {
      this.demoBusy = busy;
      this.drawDemo();
    }
    const demo = forest && this.canSummon();
    if (demo !== this.demoOn) {
      this.demoOn = demo;
      this.demo.container.setVisible(demo);
      if (demo) this.demo.zone.setInteractive({ useHandCursor: true });
      else this.demo.zone.disableInteractive();
    }
    if (forest || this.forest.alpha > 0) this.updateTags(delta);
    this.updateRibbon(time);
  }
}
