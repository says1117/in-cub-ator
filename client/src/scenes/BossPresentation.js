// client/src/scenes/BossScene.js: The battle screen. Owner: Role 3 (client, art, demo).
//
// The server runs the fight; this scene tells it. Every server message is turned into events
// (state/battleTurns.js): a new fight, one turn, a catch-up, the result. Events wait in a queue
// and play one after another, so:
//   - a turn is told in beats: both picks revealed, who beat whom, the hit, then the next sign;
//   - health bars move when a hit LANDS, never before;
//   - VICTORY or DEFEAT only shows after the final blow has played;
//   - nothing is played twice, and a page opened mid-fight just takes the state as it is.
// Buttons only work while the server is accepting a move and the last turn has finished playing.
import Phaser from "phaser";
import { bossArt, bossMove, bossPalette, preloadBossArt } from "../data/bosses.js";
import { createBossRig, hasBossRig } from "../render/bossRig.js";
import { PLANTS, PLANT_IDS, plantMove, preloadPlantArt } from "../data/plants.js";
import { createPlantRig } from "../render/plantRig.js";
import { playBattleFx } from "../render/battleFx.js";
import { playBossFx } from "../render/bossFx.js";
import { createFxKit } from "../render/fxKit.js";
import { ensureDragonBackTexture, DRAGON_BACK_KEY } from "../render/dragonBack.js";
import { createCastShadow, outlineOfPicture, BATTLE_LIGHT } from "../render/castShadow.js";
import { ensureArenaTexture, addFireflies } from "../battle/arena.js";
import { ensureIcons, iconFor, MOVE_COLORS } from "../battle/icons.js";
import { BattleHud } from "../battle/hud.js";
import { nextBattleEvent, resultFor, describeTurn, resultWords, intentOf } from "../state/battleTurns.js";
import { textStyle } from "../ui/font.js";

const ENEMY = { x: 905, y: 458, height: 330 };       // the boss, roots included (tier 1)
const FIGHTER = { x: 405, y: 550, size: 1.5 };      // the plant that is fighting
const BENCH = { x: 228, y: 562, size: 0.62 };       // the plant waiting its turn, or resting after it fainted
const TRAINER = { x: 98, y: 568, height: 196 };     // the dragon, who sends the plants in
const MOVE_KEYS = { Digit1: "attack", Digit2: "guard", Digit3: "special", Digit4: "skill",
                    Numpad1: "attack", Numpad2: "guard", Numpad3: "special", Numpad4: "skill" };
const RESULT_SECONDS = 3.4;   // how long the result panel stays before the forest comes back
const BOSS_BLOW_MS = 620;     // about how long a boss move takes to arrive (render/bossFx.js)

export default class BossScene extends Phaser.Scene {
  constructor() {
    super({ key: "BossScene" });
  }

  preload() {
    preloadBossArt(this);
    preloadPlantArt(this);
  }

  create() {
    this.W = 1280;
    this.H = 720;
    this.cameras.main.setBackgroundColor("#0b0718");
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || /[?&]calm\b/.test(window.location.search);

    this.state = null;        // the latest server state
    this.tail = null;         // the last battle snapshot turned into an event
    this.shown = null;        // the battle snapshot the screen currently shows
    this.fightId = null;
    this.queue = [];
    this.busy = false;
    this.locked = null;       // { move, turn } after a press, until the turn plays
    this.resultQueued = false;
    this.leaving = false;
    this.activeId = null;     // which plant is up front
    this.stopUntil = 0;       // hit-stop: everything frozen until this real time
    this.slowUntil = 0;

    this.root = this.add.container(0, 0);
    this.backLayer = this.add.container(0, 0);
    this.groundLayer = this.add.container(0, 0);
    this.actorLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.overlayLayer = this.add.container(0, 0);
    this.root.add([this.backLayer, this.groundLayer, this.actorLayer, this.fxLayer, this.uiLayer, this.overlayLayer]);
    this.onResize();

    this.backLayer.add(this.add.image(0, 0, ensureArenaTexture(this)).setOrigin(0));
    addFireflies(this, this.backLayer);
    ensureIcons(this);
    this.buildActors();
    // the effects kit (render/fxKit.js): drawn on the ground behind the fighters, and in front of them
    this.kit = createFxKit(this, { back: this.groundLayer, front: this.fxLayer });
    this.hud = new BattleHud(this, this.uiLayer, this.overlayLayer, this.root.scaleX);
    for (const b of Object.values(this.hud.buttons)) b.container.on("pointerdown", () => this.press(b.move));

    this.scale.on("resize", this.onResize, this);
    this.stateListener = (_parent, state) => this.onState(state);
    this.registry.events.on("changedata-serverState", this.stateListener);
    this.keyListener = (event) => { if (MOVE_KEYS[event.code]) this.press(MOVE_KEYS[event.code]); };
    this.input.keyboard.on("keydown", this.keyListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
      this.registry.events.off("changedata-serverState", this.stateListener);
      this.input.keyboard.off("keydown", this.keyListener);
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
      this.audio("setIntensity", 0);
      this.audio("setHeartbeat", false);
    });

    this.cameras.main.fadeIn(300, 7, 5, 26);
    this.audio("music", "battle");
    this.onState(this.registry.get("serverState"));
  }

  onResize() {
    const s = Math.min(this.scale.width / this.W, this.scale.height / this.H);
    this.root.setScale(s);
    this.root.setPosition((this.scale.width - this.W * s) / 2, (this.scale.height - this.H * s) / 2);
  }

  // Sound goes through the audio module when there is one (registry "audio"); otherwise silence.
  audio(kind, ...args) {
    const a = this.registry.get("audio");
    if (!a) return;
    if (kind === "sfx") a.sfx?.(...args);
    else if (kind === "music") a.music?.(...args);
    else a[kind]?.(...args);
  }
  sfx(name, opts) { this.audio("sfx", name, opts); }

  // ================================================================ the cast
  buildActors() {
    this.fighterRing = this.groundRing(FIGHTER.x, FIGHTER.y - 6, 250, 0x9df6ba);
    this.bossRing = this.groundRing(ENEMY.x, ENEMY.y - 4, 300, 0xff9868);

    // The dragon stands at the back and sends the plants in.
    ensureDragonBackTexture(this);
    const trainerKey = this.textures.exists("plantHero") ? "plantHero" : DRAGON_BACK_KEY;
    this.textures.get(trainerKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.trainer = this.add.image(TRAINER.x, TRAINER.y, trainerKey).setOrigin(0.5, 1);
    this.trainer.setScale(TRAINER.height / this.trainer.height);
    this.actorLayer.add(this.add.ellipse(TRAINER.x, TRAINER.y - 3, 150, 22, 0x10201b, 0.48));
    this.actorLayer.add(createCastShadow(this, outlineOfPicture(this, trainerKey), { light: BATTLE_LIGHT, size: this.trainer.scaleX })
      .setPosition(TRAINER.x, TRAINER.y - 3));
    this.actorLayer.add(this.trainer);
    this.tweens.add({ targets: this.trainer, y: TRAINER.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    this.actorLayer.add(this.add.ellipse(ENEMY.x + 2, ENEMY.y - 1, 295, 37, 0x10201b, 0.5));
    if (hasBossRig(this, bossArt(1, this.bossId()))) {
      this.enemy = createBossRig(this, bossArt(1, this.bossId()), ENEMY.x, ENEMY.y, ENEMY.height, { light: BATTLE_LIGHT });
    } else {
      this.enemy = this.add.image(ENEMY.x, ENEMY.y, bossArt(1, this.bossId()).key).setOrigin(0.5, 0.93);
      this.tweens.add({ targets: this.enemy, y: ENEMY.y - 5, duration: 1050, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    this.enemyHome = { x: this.enemy.x, y: this.enemy.y };
    this.actorLayer.add(this.enemy);
    this.fitEnemy(1);

    // Both plants. They stay hidden until the server says who is fighting.
    this.fighters = {};
    for (const id of PLANT_IDS) {
      const rig = createPlantRig(this, PLANTS[id], BENCH.x, BENCH.y, PLANTS[id].rig.height * BENCH.size, { light: BATTLE_LIGHT });
      rig.setVisible(false);
      this.actorLayer.add(rig);
      this.fighters[id] = rig;
    }
  }

  // A glowing ring on the ground under a fighter. setColor() changes it smoothly.
  groundRing(x, y, width, color) {
    const ring = this.add.container(x, y);
    const glow = this.add.ellipse(0, 0, width * 1.15, width * 0.3, color, 0.13);
    const disc = this.add.ellipse(0, 0, width, width * 0.25, 0x0d1a18, 0.32);
    const edge = this.add.ellipse(0, 0, width, width * 0.25).setStrokeStyle(4, color, 0.75);
    const inner = this.add.ellipse(0, 0, width * 0.78, width * 0.19).setStrokeStyle(2, 0xffffff, 0.22);
    ring.add([glow, disc, edge, inner]);
    this.groundLayer.add(ring);
    this.tweens.add({ targets: ring, scaleX: 1.04, scaleY: 1.04, alpha: 0.82, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    ring.setColor = (c) => { glow.fillColor = c; edge.setStrokeStyle(4, c, 0.75); };
    return ring;
  }

  fitEnemy(tier) {
    const art = bossArt(tier, this.bossId());
    const height = ENEMY.height * ({ 1: 1, 2: 1.08, 3: 1.16 }[tier] || 1);
    if (this.enemy.isBossRig) { this.enemy.setHeight(height); return; }
    const picture = this.textures.get(art.key).getSourceImage();
    this.enemy.setTexture(art.key).setDisplaySize(height * (picture.width / picture.height), height);
  }

  // A spot on the screen (what a plant's point() gives) as a spot on the 1280 x 720 stage.
  stagePoint(point) {
    return { x: (point.x - this.root.x) / this.root.scaleX, y: (point.y - this.root.y) / this.root.scaleY };
  }

  // What a plant's effect in render/battleFx.js is given.
  plantCtx(rig, at, lands) {
    return {
      scene: this, kit: this.kit, plant: rig.plant, at, lands,
      from: (name) => this.stagePoint(rig.point(name)),
      ground: { x: FIGHTER.x, y: FIGHTER.y },
      boss: { x: ENEMY.x - 20, y: ENEMY.y - 150 },
      bossGround: { x: ENEMY.x, y: ENEMY.y },
    };
  }

  // What the boss's effect in render/bossFx.js is given. rig: the plant it is aimed at.
  bossCtx(rig, lands, blocked, meet = null) {
    const enemy = this.enemy;
    return {
      scene: this, kit: this.kit, palette: bossPalette(this.tier(), this.bossId()), lands, blocked, meet,
      mouth: () => (enemy.mouthPoint ? this.stagePoint(enemy.mouthPoint()) : { x: ENEMY.x - 40, y: ENEMY.y - 230 }),
      boss: { x: ENEMY.x - 20, y: ENEMY.y - 150 },
      bossGround: { x: ENEMY.x, y: ENEMY.y },
      act: name => enemy.act?.(name),
      mouths: () => enemy.mouthPoints ? enemy.mouthPoints().map(point => this.stagePoint(point))
        : [0, 1, 2].map(() => ({ x: ENEMY.x - 40, y: ENEMY.y - 230 })),
      caps: () => enemy.capPoints ? enemy.capPoints().map(point => this.stagePoint(point))
        : [0, 1, 2].map(() => ({ x: ENEMY.x, y: ENEMY.y })),
      target: { x: FIGHTER.x + 10, y: FIGHTER.y - rig.getHeight() * 0.45 },
      targetGround: { x: FIGHTER.x, y: FIGHTER.y },
      roar: () => enemy.roar && enemy.roar(),
      lunge: (dx, ms) => this.knock(enemy, dx, ms),
    };
  }

  bossId() { return this.encounter?.id || this.registry.get("serverState")?.boss?.id; }

  tier() { return (this.fightBoss && this.fightBoss.tier) || 1; }

  plantName(id, battle = this.state && this.state.battle) {
    const team = (battle && battle.team) || {};
    return (team[id] && team[id].name) || PLANTS[id]?.name || "Plant";
  }

  // ================================================================ server state -> events
  onState(state) {
    if (!state || this.leaving) return;
    this.state = state;
    this.stateAt = performance.now();
    const battle = state.battle;

    if (battle) {
      const ev = nextBattleEvent(this.tail, battle);
      if (ev.kind === "fight") {
        if (this.fightId && this.fightId !== battle.id) { this.scene.restart(); return; }   // a new fight before this one left
        this.fightBoss = state.boss || this.fightBoss || {};   // this fight's boss, kept even if the state moves on
        this.enqueue({ kind: "fight", battle });
      } else if (ev.kind === "turn") {
        this.enqueue({ kind: "turn", prev: ev.prev, next: battle });
      } else if (ev.kind === "jump") {
        this.enqueue({ kind: "sync", battle });
      }
      this.tail = battle;
    }

    const result = resultFor(state, this.tail && this.tail.id);
    if (result && !this.resultQueued) {
      this.resultQueued = true;
      this.enqueue({ kind: "result", result });
    }
    // Nothing to show at all (the fight was over before this screen opened): back to the forest.
    if (!battle && !this.tail && state.mode !== "battle") this.leave(0);
    // The fight vanished with no result for it (the server restarted, say): end it as "the boss fled"
    // after a moment, rather than wait forever on a fight that no longer exists.
    if (!battle && this.tail && !this.resultQueued && state.mode !== "battle" && !this.vanishCheck) {
      this.vanishCheck = this.time.delayedCall(1200, () => {
        this.vanishCheck = null;
        const now = this.state;
        if (this.resultQueued || (now && now.battle) || (now && now.mode === "battle")) return;
        this.resultQueued = true;
        this.enqueue({ kind: "result", result: { fight: this.tail.id, outcome: "dismissed", plant: this.tail.plant, water_ms: 0, blocked: null } });
      });
    }
    this.refreshLive();
  }

  enqueue(event) {
    this.queue.push(event);
    this.pump();
  }

  pump() {
    if (this.busy || this.queue.length === 0) return;
    let event = this.queue.shift();
    // A turn while more turns are already waiting (a slow screen): catch up instead of animating each.
    if (event.kind === "turn" && this.queue.some((e) => e.kind === "turn" || e.kind === "sync")) event = { kind: "sync", battle: event.next };
    this.busy = true;
    let finished = false;
    // An event ends after the ms it returns, or ("async") when it calls eventDone(ms) itself.
    this.eventDone = (ms) => this.time.delayedCall(Math.max(0, ms || 0), () => {
      if (finished) return;
      finished = true;
      this.busy = false;
      this.refreshLive();
      this.pump();
    });
    let ms = 0;
    try {
      ms = this[{ fight: "playFight", turn: "playTurn", sync: "playSync", result: "playResult" }[event.kind]](event) || 0;
    } catch (error) {
      // never let one bad event freeze the screen: report it and carry on with the next
      console.error("battle event failed", event.kind, error);
    }
    if (ms !== "async") this.eventDone(ms);
  }

  // Buttons, the move timer and the autopilot ribbon follow the latest state, between turns.
  refreshLive() {
    const b = this.state && this.state.battle;
    const current = b && this.shown && b.id === this.shown.id && b.turn === this.shown.turn;
    const live = Boolean(current && !b.over && !this.busy && !this.resultQueued);
    const canPress = live && b.accepting_move && !this.locked;
    this.hud.setButtons(canPress, b && b.skill, this.skillBlurb(b));
    const auto = live && b.manual && b.autopilot;
    this.hud.setAuto(Boolean(auto));
    this.audio("setQuiet", Boolean(b && b.autopilot));
    if (canPress && !auto && b.move_deadline_in_ms != null) {
      const deadline = this.stateAt + b.move_deadline_in_ms;
      if (this.hud.deadline == null || this.timerTurn !== b.turn) {
        this.timerTurn = b.turn;
        this.hud.setTimer(deadline, Math.max(1000, b.move_deadline_in_ms));
      }
    } else if (!canPress) {
      this.hud.setTimer(null);
    }
  }

  // ================================================================ input
  press(move) {
    const b = this.state && this.state.battle;
    if (!b || b.over || this.leaving) return;
    const send = this.registry.get("sendMove");
    const btn = this.hud.buttons[move];
    if (b.autopilot && b.manual) {
      // Taking over from the autopilot: any press wakes the server. It is also the move only if the
      // buttons are live (the next sign is on screen); otherwise turn -1 means "I'm here", not a move.
      send && send(move, btn && btn.enabled ? b.turn : -1);
      this.hud.banner("YOU'RE IN!", "#ffe680", { size: 40, y: 200, hold: 500 });
      this.sfx("ui_select");
      if (btn && btn.enabled) this.lockIn(move, b.turn);
      return;
    }
    if (!btn || !btn.enabled) {
      if (!this.busy) { this.sfx("ui_denied"); this.hud.denied(move); }
      return;
    }
    if (!send || send(move, b.turn) === false) {
      this.sfx("ui_denied");
      this.hud.setLog("No connection to the cube. Trying again...");
      return;
    }
    this.sfx("ui_select");
    this.lockIn(move, b.turn);
  }

  lockIn(move, turn) {
    this.locked = { move, turn };
    this.hud.lockIn(move);
    this.hud.setTimer(null);
    this.hud.setButtons(false, this.state.battle && this.state.battle.skill);
    const rig = this.fighters[this.activeId];
    if (rig) rig.play("hop", { height: 0.05, ms: 260 });
    // If the server never answers this press (it raced the auto-pick), give the buttons back.
    this.time.delayedCall(2600, () => {
      if (this.locked && this.locked.turn === turn) { this.locked = null; this.hud.clearLock(); this.refreshLive(); }
    });
  }

  // ================================================================ events
  // A new fight. Everyone is put in place; a fight that is just starting gets the dragon's call.
  playFight({ battle }) {
    const state = this.state;
    const boss = this.fightBoss || {};
    this.fightId = battle.id;
    this.shown = battle;
    this.resultQueued = false;
    this.fitEnemy(boss.tier || 1);
    const thirsty = this.plantName(boss.plant, battle);
    this.hud.setFight({
      title: `${thirsty.toUpperCase()} IS THIRSTY!`,
      subtitle: `Plant ${boss.plant}  ·  soil ${Math.round((state.meters && state.meters.water && state.meters.water[boss.plant]) ?? 0)}%${boss.source === "demo" ? "  ·  DEMO" : ""}`,
      bossName: boss.name || "Drought Boss",
      tierLabel: "★".repeat(Math.max(1, boss.tier || 1)) + `  TIER ${boss.tier || 1}`,
    });
    this.applySnapshot(battle);
    const arriving = battle.turn === 0;
    this.placeTeam(battle, arriving);
    if (!arriving) { this.showIntent(battle); return 0; }
    this.hud.banner(`GO, ${this.plantName(battle.plant, battle).toUpperCase()}!`, "#fff2b0", { size: 52, y: 250, hold: 650 });
    this.sfx("swap_in");
    this.time.delayedCall(800, () => this.showIntent(battle));
    return 1000;
  }

  // Several turns at once: no animation, just the latest state.
  playSync({ battle }) {
    this.shown = battle;
    this.applySnapshot(battle);
    if (this.fightingPlant(battle) !== this.activeId) this.placeTeam(battle);
    this.showIntent(battle);
    return 0;
  }

  // Every panel straight to what a snapshot says, with no animation.
  applySnapshot(b) {
    const boss = this.fightBoss || {};
    this.hud.setBossHP(b.boss_hp, boss.max_hp || b.boss_hp, { instant: true });
    this.setPlantPanel(b, b.creature_hp, { instant: true });
    this.hud.setTeam(b.team, { A: PLANTS.A.name, B: PLANTS.B.name });
    this.hud.setBlooms(b.blooms || 0, { skillReady: b.skill && b.skill.ready });
    this.showMoveNames(b.plant);
    this.hud.setButtons(false, b.skill, this.skillBlurb(b));
  }

  // The fighting plant's own names for its moves, and its skill's one-liner (data/plants.js).
  showMoveNames(plantId) {
    const plant = PLANTS[plantId];
    if (!plant) return;
    this.hud.setMoveNames({ attack: plant.moves.attack.name, guard: plant.moves.guard.name, special: plant.moves.special.name });
  }

  skillBlurb(b) {
    const plant = b && PLANTS[b.plant];
    if (!plant || !b.skill) return null;
    if (b.skill.heal) return `heal ${b.skill.heal}${b.skill.power ? ` + hit ${b.skill.power}` : ""}`;
    return `${b.skill.kind === "shield" ? "block + " : ""}hit ${b.skill.power || 0} · blooms boost`;
  }

  setPlantPanel(b, hp, opts) {
    const soil = this.state.meters && this.state.meters.water && this.state.meters.water[b.plant];
    this.hud.setPlant({ name: b.creature || this.plantName(b.plant, b), hp, max: b.creature_max_hp, soil }, opts);
  }

  showIntent(b) {
    if (!b || b.over || !b.intent) { this.hud.hideIntent(); this.enemySetIntent(null); return; }
    const move = intentOf(b);
    const teach = b.turn < 2;
    this.hud.showIntent(move, { teach, ...b.intent });
    this.enemySetIntent(move);
    this.bossRing.setColor(MOVE_COLORS[move] || 0xff9868);
    if (move !== "?") this.sfx("reveal", { gain: 0.5 });
  }

  enemySetIntent(move) {
    if (this.enemy.setIntent) this.enemy.setIntent(move);
  }

  // One turn, told in beats:
  //   reveal   the hidden sign turns over (or the shown one pulses), the plant's pick pops up
  //   verdict  who beat whom, in icons (a skill gets its name instead)
  //   the exchange, as each plant and boss move is drawn (data/plants.js, data/bosses.js):
  //     a guard against a bite goes up just in time; a tie has both go at once and meet in the
  //     middle; otherwise the plant goes, then the boss answers (no answer to a final blow)
  //   health moves as each blow LANDS, then the next sign appears.
  // The exchange's length is only known once its effects start, so it ends the event itself.
  playTurn({ prev, next }) {
    const move = next.last_move;
    const d = describeTurn(prev, move);
    const actorId = d.swap ? d.swap.out : prev.plant;
    const actor = this.fighters[actorId] || this.fighters[this.activeId];
    const enemy = this.enemy;
    const boss = this.fightBoss || {};
    const bossName = boss.name || "The boss";
    const plantName = prev.creature || this.plantName(actorId, prev);
    const mine = plantMove(actor.plant, move.creature, move.skill);
    const theirs = move.laser
      ? { name: "Overcharge Laser", fx: "ray" }
      : bossMove(this.tier(), move.boss, this.bossId());
    const palette = bossPalette(this.tier(), this.bossId());
    const final = next.boss_hp <= 0;
    const lastStand = !d.swap && next.creature_hp <= 0;
    const tie = move.hit === "tie";
    const shielded = move.boss === "attack" && !d.bossLands && mine.body === "guard";
    this.shown = next;
    this.locked = null;
    this.hud.clearLock();
    this.hud.setTimer(null);
    this.hud.setButtons(false, prev.skill);
    this.hud.setAuto(false);

    let t = 1700;
    const at = (ms, fn) => this.time.delayedCall(ms, fn);
    const pressed = d.skillName ? "skill" : d.playerMove;
    if (d.auto && next.manual) { this.hud.ghostPress(pressed); this.sfx("ui_select", { gain: 0.6 }); t += 240; }

    at(0, () => this.callout("left", plantName, mine.name, actor.plant.glow));
    at(850, () => {
      this.callout("right", bossName, theirs.name, palette.main);
      this.sfx(move.laser ? "boss_laser_charge" : "boss_roar", { gain: 0.55 });
    });
    at(1700, () => this.hud.banner(move.outcome || (d.verdict === "win" ? "CRITICAL HIT" : d.verdict === "lose" ? "WEAK HIT" : "CLASH"), "#ffdfa3", { y: 220, hold: 750 }));

    // Reveal
    at(t, () => {
      if (d.hidden) { this.hud.flipIntent(d.bossMove); this.sfx("flip"); } else { this.hud.pulseIntent(); this.sfx("reveal"); }
      if (!d.skillName) this.popIcon(actor, d.playerMove);
      this.enemySetIntent(d.bossMove);
    });
    t += 220;

    // Verdict
    at(t, () => {
      if (d.verdict === "skill") {
        const mult = d.bloomsSpent ? ` ×${1 + 0.5 * d.bloomsSpent}` : "";
        this.hud.banner(`${d.skillName.toUpperCase()}${mult}!`, "#ead8ff", { size: 46 + 6 * d.bloomsSpent, y: 280, hold: 700 });
        this.sfx("unleash", { pitch: 1 + 0.1 * d.bloomsSpent });
        if (d.bloomsSpent) { this.dimFor(500 + 120 * d.bloomsSpent); this.hud.setBlooms(0, { skillReady: false }); }
      } else if (d.verdict === "win") { this.hud.verdict(d.playerMove, d.bossMove, "win"); this.sfx("clash_win"); }
      else if (d.verdict === "lose") { this.hud.verdict(d.bossMove, d.playerMove, "lose"); this.sfx("clash_lose"); }
      else { this.hud.verdict(d.playerMove, d.bossMove, "tie"); this.sfx("clash_tie"); }
    });
    t += 160;

    // What happens when each side's blow lands
    let hpShown = prev.creature_hp;
    const onBossHurt = () => {
      this.impact(final ? 160 : 70 + 35 * d.bloomsSpent, final ? 420 : 0);
      this.flashRig(enemy);
      this.knock(enemy, 26);
      this.floating(ENEMY.x - 40, ENEMY.y - 300, `-${d.dealt}`, "#fff48e", 44 + 6 * d.bloomsSpent);
      this.cameras.main.shake(final ? 260 : 130, (final ? 0.012 : 0.005) + 0.002 * d.bloomsSpent);
      this.hud.setBossHP(next.boss_hp, boss.max_hp || next.boss_hp);
      this.sfx(d.dealt >= 12 || final ? "hit_heavy" : "hit_light");
      if (d.dealt >= 12 || final) this.audio("duck", 400);
      this.benchCheers();
      if (d.bloomGain) {
        this.time.delayedCall(160, () => {
          this.hud.setBlooms(next.blooms, { gain: true, skillReady: next.skill && next.skill.ready });
          this.sfx("bloom_gain", { pitch: 1 + 0.12 * (next.blooms - 1) });
        });
      }
    };
    const onHeal = () => {
      hpShown = Math.min(prev.creature_max_hp, hpShown + d.healed);
      const top = this.stagePoint(actor.point("top"));
      this.floating(top.x - 30, top.y - 30, `+${d.healed}`, "#8dff9b", 40);
      this.setPlantPanel(prev, hpShown);
      this.sfx("heal");
    };
    const onPlantHurt = () => {
      hpShown = Math.max(0, hpShown - d.taken);
      this.impact(lastStand ? 160 : 70, lastStand ? 380 : 0);
      this.flashRig(actor);
      actor.play("hurt", { force: 1.3 });
      const top = this.stagePoint(actor.point("top"));
      this.floating(top.x - 40, top.y - 20, `-${d.taken}`, "#ff8f90", 42);
      this.cameras.main.shake(160, 0.007);
      this.setPlantPanel(prev, hpShown);
      this.sfx("hit_heavy");
      this.sfx("hurt");
      if (d.bloomsWiped) { this.hud.setBlooms(0, { wipe: true }); this.sfx("bloom_wipe"); }
    };
    // The boss's move starts now; returns when its blow arrives.
    const bossGoes = (blocked, meet = null) => {
      this.sfx(move.boss === "attack" ? "boss_bite" : move.boss === "special" ? "boss_orb" : "clang", { gain: d.bossLands ? 1 : 0.6 });
      const ctx = this.bossCtx(actor, d.bossLands, blocked, meet);
      if (move.laser) { ctx.power = 1.6; at(500, () => this.sfx("boss_laser")); }
      return playBossFx(theirs.fx, ctx);
    };
    const reach = () => {
      if (!d.plantLands) return 0.42;
      return mine.reach === "boss" ? (ENEMY.x - 235 - FIGHTER.x) / actor.getHeight() : 0.85;
    };

    // The exchange
    at(t, () => {
      let length;
      try {
        this.sfx("whoosh", { gain: 0.6 });
        if (shielded) {
          // the boss comes first; the shield goes up just in time
          const blow = bossGoes(true);
          const options = { ms: mine.ms, delay: 0 };
          options.delay = Math.max(0, blow - actor.hitTime(mine.body, options));
          actor.play(mine.body, options);
          const extra = playBattleFx(mine.fx, this.plantCtx(actor, blow, d.plantLands));
          at(blow, () => { this.word("BLOCKED!", "#bfe6ff", FIGHTER.x + 230, FIGHTER.y - 330); this.knock(enemy, 40, 160); this.sfx("parry"); });
          if (d.plantLands) at(blow + extra, onBossHurt);
          length = blow + extra + 700;
        } else {
          const options = { ms: mine.ms, delay: 0, reach: reach() };
          actor.play(mine.body, options);
          const hitAt = actor.hitTime(mine.body, options);
          const extra = playBattleFx(mine.fx, this.plantCtx(actor, hitAt, d.plantLands));
          const landed = hitAt + extra;
          if (d.dealt > 0) at(landed, onBossHurt);
          if (d.healed > 0) at(hitAt, onHeal);
          if (tie) {
            // both at once: they meet in the middle and nothing gets through
            const mid = { x: (FIGHTER.x + ENEMY.x) / 2 + 30, y: FIGHTER.y - 240 };
            const blow = bossGoes(false, mid);
            const meet = Math.max(hitAt, blow);
            if (d.taken > 0) at(meet, onPlantHurt);
            at(meet, () => {
              this.kit.impact(mid.x, mid.y, { power: 1.1, color: 0xd7e3ff });
              this.word(move.creature === "guard" ? "STANDOFF" : "CLASH!", "#d7e3ff", mid.x, mid.y - 70);
              this.sfx("clang");
            });
            length = meet + 750;
          } else if (final) {
            length = landed + 520;               // that was the last blow: the boss has no answer
          } else {
            const bossStart = landed + (d.plantLands ? 460 : 260);
            at(bossStart, () => {
              const blow = bossGoes(false);
              if (d.taken > 0) at(blow, onPlantHurt);
            });
            length = bossStart + BOSS_BLOW_MS + (d.taken > 0 ? 520 : 200);
          }
        }
      } catch (error) {
        console.error("turn animation failed", error);
        length = 0;
      }

      // a plant that runs out of health tips over; if the other one is ready, the dragon sends it in
      if (d.swap) { this.swapFighter(d.swap.out, d.swap.in, length - 60, next); length += 1500; }
      else if (lastStand) at(length - 60, () => { actor.setMood("fainted"); this.sfx("faint"); });

      // words for the log, and the next sign once the dust has settled
      if (move.enraged) {
        at(Math.max(0, length - 100), () => {
          this.hud.banner("ENRAGED!", "#ff8f90", { y: 240 });
          this.enemy.roar?.(); this.sfx("boss_roar");
        });
        length += 1000;
      }
      at(Math.max(0, length - 200), () => {
        this.hud.setLog(this.turnWords(d, plantName, bossName, mine.name, theirs.name));
        this.hud.setTeam(next.team, { A: PLANTS.A.name, B: PLANTS.B.name });
        this.hud.setBlooms(next.blooms || 0, { skillReady: next.skill && next.skill.ready });
        if (!final && !lastStand) this.showIntent(this.state.battle && this.state.battle.id === next.id ? this.state.battle : next);
      });
      this.eventDone(length);
    });
    return "async";
  }

  turnWords(d, plant, boss, mine, theirs) {
    if (d.verdict === "skill") {
      const parts = [];
      if (d.dealt) parts.push(`hit for ${d.dealt}`);
      if (d.healed) parts.push(`healed ${d.healed}`);
      const back = d.taken ? ` ${boss}'s ${theirs} still hit for ${d.taken}.` : "";
      return `${plant}'s ${d.skillName}${d.bloomsSpent ? ` ×${1 + 0.5 * d.bloomsSpent}` : ""} ${parts.join(" and ") || "landed"}!${back}`;
    }
    if (d.verdict === "win") return `${mine} beats ${theirs}! ${plant} hits for ${d.dealt}.${d.bloomGain ? " A bloom opens." : ""}`;
    if (d.verdict === "lose") return `${theirs} beats ${mine}. ${plant} takes ${d.taken}.${d.bloomsWiped ? " Blooms lost!" : ""}`;
    return `${mine} meets ${theirs}. CLASH${d.taken ? ` · ${plant} takes ${d.taken}` : ""}.`;
  }

  // ================================================================ result
  playResult({ result }) {
    const words = resultWords(result, this.plantName(result.plant));
    const won = result.outcome === "won";
    this.hud.hideIntent();
    this.hud.setTimer(null);
    this.hud.setButtons(false, null);
    this.hud.setAuto(false);
    this.enemySetIntent(null);
    if (won) {
      this.dissolveBoss();
      this.audio("music", "victory");
    } else if (result.outcome === "lost") {
      this.audio("music", "defeat");
      this.sfx("defeat_sting");
    } else {
      this.tweens.add({ targets: this.enemy, alpha: 0, x: this.enemy.x + 120, duration: 700, ease: "Quad.easeIn" });
      this.audio("music", null);
    }
    PLANT_IDS.forEach((id, i) => {
      const rig = this.fighters[id];
      if (!rig.visible) return;
      if (result.outcome === "lost") { rig.setMood("fainted"); return; }
      if (rig.getMood() === "fainted") return;
      rig.setMood("proud");
      if (won) {
        rig.emote(i % 2 ? "heart" : "sparkle", 1800);
        for (let n = 0; n < 3; n++) rig.play("cheer", { delay: 200 + i * 220 + n * 950 });
      }
    });
    this.time.delayedCall(won ? 650 : 350, () => {
      this.hud.showResult(words, { waterMs: result.water_ms || 0 });
      if (won) this.confetti();
      if (words.water) this.sfx("victory_water", { durationMs: result.water_ms || 1600 });
    });
    this.time.delayedCall(RESULT_SECONDS * 1000, () => this.leave());
    return RESULT_SECONDS * 1000 + 1000;
  }

  leave(delay = 0) {
    if (this.leaving) return;
    this.leaving = true;
    this.time.delayedCall(delay, () => {
      this.cameras.main.fadeOut(350, 7, 5, 26);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        const adventure = this.scene.get("AdventureScene");
        this.scene.stop();
        if (window.location.pathname === "/boss") window.history.replaceState({}, "", "/adventure");
        if (adventure && adventure.scene.isSleeping()) this.scene.wake("AdventureScene");
        else if (adventure && !adventure.scene.isActive()) this.scene.start("AdventureScene");
      });
    });
  }

  // ================================================================ the plant team
  fightingPlant(battle) {
    if (battle && this.fighters[battle.plant]) return battle.plant;
    const boss = this.fightBoss;
    if (boss && this.fighters[boss.plant]) return boss.plant;
    return PLANT_IDS[0];
  }

  trainerCall() {
    this.tweens.add({ targets: this.trainer, angle: 9, x: TRAINER.x + 12, duration: 120, yoyo: true, ease: "Quad.easeOut" });
  }

  // Stands every plant where the server says it is. arrive: the fighter pops in as if just called.
  placeTeam(battle, arrive = false) {
    const team = (battle && battle.team) || {};
    this.activeId = this.fightingPlant(battle);
    for (const id of PLANT_IDS) {
      const rig = this.fighters[id];
      const info = team[id];
      this.tweens.killTweensOf(rig);
      rig.stopActions();
      if (id === this.activeId) {
        rig.setPosition(FIGHTER.x, FIGHTER.y).setHeight(rig.plant.rig.height * FIGHTER.size).setAlpha(1).setVisible(true);
        rig.setMood("fierce", true);
        this.actorLayer.bringToTop(rig);
      } else if (info) {
        const down = info.state === "down";
        rig.setPosition(BENCH.x, BENCH.y).setHeight(rig.plant.rig.height * BENCH.size).setAlpha(down ? 0.65 : 1).setVisible(true);
        rig.setMood(down ? "fainted" : "happy", true);
      } else {
        rig.setVisible(false);
      }
    }
    if (arrive) {
      const rig = this.fighters[this.activeId];
      this.trainerCall();
      rig.play("enter");
      rig.emote("anger", 1100);
      playBattleFx("arrive", this.plantCtx(rig, 60, true));
    }
  }

  // The plant up front has fainted: it tips over and is carried to the bench, and the dragon
  // sends the other one bounding in from the bench.
  swapFighter(outId, inId, delay, next) {
    const out = this.fighters[outId];
    const nextRig = this.fighters[inId];
    this.activeId = inId;
    if (!out || !nextRig) return;
    this.time.delayedCall(delay, () => {
      out.setMood("fainted");
      out.emote("sweat", 900);
      this.hud.setLog(`${this.plantName(outId, next)} fainted!`);
      this.sfx("faint");
    });
    this.time.delayedCall(delay + 760, () => {
      this.tweens.add({
        targets: out, alpha: 0, duration: 200,
        onComplete: () => {
          out.setPosition(BENCH.x - 34, BENCH.y + 2).setHeight(out.plant.rig.height * BENCH.size * 0.9);
          this.tweens.add({ targets: out, alpha: 0.65, duration: 220 });
        },
      });
      this.trainerCall();
      this.hud.banner(`GO, ${this.plantName(inId, next).toUpperCase()}!`, "#fff2b0", { size: 48, y: 250, hold: 600 });
      this.sfx("swap_in");
      nextRig.setVisible(true).setAlpha(1).setMood("fierce");
      nextRig.emote("anger", 1000);
      this.actorLayer.bringToTop(nextRig);
      nextRig.play("hop", { ms: 320, height: 0.34 });
      nextRig.play("hop", { ms: 320, height: 0.24, delay: 320 });
      this.tweens.add({
        targets: nextRig, x: FIGHTER.x, y: FIGHTER.y, scaleX: FIGHTER.size, scaleY: FIGHTER.size,
        duration: 640, ease: "Sine.easeInOut",
        onComplete: () => playBattleFx("arrive", this.plantCtx(nextRig, 0, true)),
      });
      this.setPlantPanel(next, next.creature_hp, { instant: true });
      this.showMoveNames(inId);
      this.hud.setBlooms(next.blooms || 0, { skillReady: next.skill && next.skill.ready });
    });
  }

  benchCheers() {
    for (const id of PLANT_IDS) {
      const rig = this.fighters[id];
      if (id !== this.activeId && rig.visible && rig.getMood() !== "fainted") rig.play("hop", { height: 0.16 });
    }
  }

  // ================================================================ feedback
  // Hit-stop: everything in the fight freezes for a moment when a blow lands, then (for a knockout)
  // runs in slow motion for a little longer. Real time drives it, so it always ends.
  impact(stopMs, slowMs = 0) {
    if (this.reducedMotion) { stopMs = Math.min(stopMs, 40); slowMs = 0; }
    const now = performance.now();
    this.stopUntil = now + stopMs;
    this.slowUntil = this.stopUntil + slowMs;
    this.tweens.timeScale = 0;
    this.time.timeScale = 0;
  }

  flashRig(rig) {
    if (rig.flashWhite) { rig.flashWhite(90); return; }
    this.tweens.add({ targets: rig, alpha: 0.35, duration: 70, yoyo: true, repeat: 1 });
  }

  knock(sprite, dx, ms = 120) {
    this.tweens.add({ targets: sprite, x: sprite.x + dx, duration: ms, yoyo: true, ease: "Quad.easeOut" });
  }

  // A word that pops at a spot on the stage: "BLOCKED!", "CLASH!".
  word(str, color, x, y) {
    this.floating(x, y, str, color, 36);
  }

  // Who is doing what, in a small plate over their side: "Ember · Vine Haymaker".
  callout(side, who, what, color) {
    const x = side === "left" ? FIGHTER.x - 20 : ENEMY.x + 60;   // the clear strip under the top panels
    const y = side === "left" ? 162 : 150;
    const label = `${who} · ${what}`;
    const t = this.hud.text(x, y, label, 22, "#ffffff", {}, this.overlayLayer).setOrigin(0.5);
    const plate = this.add.rectangle(x, y, t.displayWidth + 34, t.displayHeight + 16, 0x0e1224, 0.88).setStrokeStyle(3, color, 1);
    this.overlayLayer.add(plate);
    this.overlayLayer.bringToTop(t);
    const group = [plate, t];
    group.forEach((o) => o.setAlpha(0));
    this.tweens.add({ targets: group, alpha: 1, duration: 140 });
    this.tweens.add({ targets: group, alpha: 0, delay: 1100, duration: 260, onComplete: () => group.forEach((o) => o.destroy()) });
  }

  popIcon(rig, move) {
    const top = this.stagePoint(rig.point("top"));
    const icon = this.add.image(top.x + 30, top.y - 40, iconFor(move)).setScale(0.5);
    this.fxLayer.add(icon);
    this.tweens.add({ targets: icon, scale: 4.5, duration: 140, ease: "Back.easeOut" });
    this.tweens.add({ targets: icon, alpha: 0, y: icon.y - 30, delay: 620, duration: 240, onComplete: () => icon.destroy() });
  }

  clashSpark() {
    const x = (FIGHTER.x + ENEMY.x) / 2;
    const y = 360;
    const star = this.add.star(x, y, 8, 12, 44, 0xffffff, 0.95);
    this.fxLayer.add(star);
    this.tweens.add({ targets: star, scale: 1.8, alpha: 0, angle: 45, duration: 300, onComplete: () => star.destroy() });
  }

  dimFor(ms) {
    const dim = this.add.rectangle(0, 0, this.W, this.H, 0x05030f, 0).setOrigin(0);
    this.groundLayer.add(dim);
    this.tweens.add({ targets: dim, fillAlpha: 0.35, duration: 140, yoyo: true, hold: ms, onComplete: () => dim.destroy() });
  }

  floating(x, y, label, color = "#ffffff", size = 40) {
    const px = Math.round(size * this.root.scaleX);
    const t = this.add.text(x, y, label, textStyle(px, color))
      .setOrigin(0.5).setScale(1.6 / this.root.scaleX);
    this.fxLayer.add(t);
    this.tweens.add({ targets: t, scale: 1 / this.root.scaleX, duration: 220, ease: "Back.easeOut" });
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, delay: 420, duration: 560, ease: "Quad.easeIn", onComplete: () => t.destroy() });
  }

  // The boss comes apart: it shudders, cracks with light, and bursts.
  dissolveBoss() {
    const enemy = this.enemy;
    const palette = bossPalette(this.tier(), this.bossId());
    const x = ENEMY.x - 20, y = ENEMY.y - 150;
    this.sfx("dissolve");
    this.bossRing.setColor(0xffe28a);
    this.tweens.add({ targets: enemy, x: enemy.x + 7, duration: 45, yoyo: true, repeat: 9 });
    for (let i = 0; i < 6; i++) {
      this.kit.at(i * 80, () => {
        const px = x + this.kit.rand(-90, 90), py = y + this.kit.rand(-130, 120);
        this.kit.star(px, py, { size: 46, color: 0xffffff, ms: 180 });
        this.kit.glow(px, py, { r: 70, color: palette.hot, alpha: 0.6, ms: 220 });
      });
    }
    this.kit.at(520, () => {
      enemy.setVisible(false);
      if (!this.reducedMotion) this.kit.flash(0xffffff, 0.45, 240);
      this.kit.shake(380, 0.012);
      this.kit.impact(x, y, { power: 2, color: palette.hot, color2: palette.main, shape: "petal" });
      this.kit.ring(ENEMY.x, ENEMY.y, { from: 60, to: 560, squash: 0.3, color: 0xffffff, thick: 12, ms: 560, layer: "back" });
      this.kit.burst(x, y, { count: 60, colors: [palette.main, palette.hot, 0xf2aa62, 0xffd676], shape: "petal", speed: [200, 900], size: [12, 28], life: [700, 1400], gravity: 700, spin: [-8, 8] });
      this.kit.burst(x, y, { count: 30, colors: [0xffffff, palette.core, palette.hot], shape: "star", speed: [100, 500], size: [8, 18], life: [600, 1200], gravity: -60, add: true });
    });
  }

  confetti() {
    this.kit.burst(640, 120, { count: 70, colors: [0xffd867, 0x8dff9b, 0x7fd0ff, 0xff8f9c, 0xffffff], shape: "sq", speed: [200, 760], angle: Math.PI / 2, spread: 3.4, size: [8, 14], life: [1400, 2400], gravity: 420, drag: 0.97, spin: [-10, 10], stretch: 1.8 });
  }

  // ================================================================ per frame
  update() {
    if (this.stopUntil) {
      const now = performance.now();
      if (now >= this.slowUntil) {
        this.stopUntil = this.slowUntil = 0;
        this.tweens.timeScale = 1;
        this.time.timeScale = 1;
      } else if (now >= this.stopUntil) {
        this.tweens.timeScale = 0.3;
        this.time.timeScale = 0.3;
      }
    }
    const secs = this.hud.updateTimer(performance.now());
    if (secs != null && secs <= 3 && secs > 0) this.sfx("tick", { pitch: 1 + (3 - secs) * 0.12 });
    // The music grows tense in the last seconds to pick or when the boss is nearly beaten, and a
    // heartbeat comes in when the plant is low. Only told to the audio module when it changes.
    const b = this.shown;
    if (b && !this.resultQueued) {
      const bossMax = (this.fightBoss && this.fightBoss.max_hp) || b.boss_hp || 1;
      const urgent = this.hud.deadline != null && this.hud.lastTick != null && this.hud.lastTick <= 3;
      const tense = urgent || b.boss_hp / bossMax < 0.25 ? 1 : 0;
      const low = b.creature_max_hp ? b.creature_hp / b.creature_max_hp < 0.3 : false;
      if (tense !== this.musicTense) { this.musicTense = tense; this.audio("setIntensity", tense); }
      if (low !== this.musicLow) { this.musicLow = low; this.audio("setHeartbeat", low); }
    } else if (this.musicLow) {
      this.musicLow = false;
      this.audio("setHeartbeat", false);
    }
  }
}
