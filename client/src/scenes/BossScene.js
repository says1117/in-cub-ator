import Phaser from "phaser";
import { bossArt, bossMove, bossPalette, preloadBossArt } from "../data/bosses.js";
import { createBossRig, hasBossRig } from "../render/bossRig.js";
import { PLANTS, PLANT_IDS, plantMove, preloadPlantArt } from "../data/plants.js";
import { createPlantRig } from "../render/plantRig.js";
import { playBattleFx } from "../render/battleFx.js";
import { playBossFx } from "../render/bossFx.js";
import { createFxKit } from "../render/fxKit.js";
import { createBattleHud } from "../ui/battleHud.js";
import { ensureDragonBackTexture, DRAGON_BACK_KEY } from "../render/dragonBack.js";
import { createCastShadow, outlineOfPicture, BATTLE_LIGHT } from "../render/castShadow.js";
import { audio } from "../audio.js";
import { addBattleForest } from "../theme/enchantedForest.js";

const ENEMY_HEIGHT = 250;   // how tall the tier 1 boss is drawn here, roots included: it stands far off, so much smaller than the team

// Where everyone stands on the 1280 x 720 stage. size is a share of the plant picture's own size.
const FIGHTER = { x: 330, y: 664, size: 2.0 };     // the plant that is fighting: right in front of us, the biggest thing on the field
const BENCH = { x: 150, y: 600, size: 0.62 };      // the plant waiting its turn, or resting after it fainted: behind the fighter
const TRAINER = { x: 58, y: 596, height: 180 };    // the dragon, who sends the plants in
const BOSS = { x: 742, y: 534 };                   // the spot the boss stands on. It must be ON THE DARK PATH (stage y 490 to 600), in the gap between our plant and the move cards (stage x 620 to 850): higher is the hazy backdrop, where it looks as if it is flying

const CALL = 800;         // ms a line such as "EMBER used VINE HAYMAKER!" is up before the move starts
const PAUSE = 650;        // ms of quiet after one side's move before the other is called
const BOSS_BLOW = 620;    // about how long the boss's move takes to arrive

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

    this.cameras.main.setBackgroundColor("#477da9");

    this.serverState = null;
    this.lastBattle = null;
    this.resultShownAt = 0;
    this.result = null;
    this.leaving = false;
    this.rewardTimer = null;
    this.resultText = null;   // left over from the last fight otherwise: this scene object is reused
    this.rewardBar = null;
    this.rewardLabel = null;
    this.activeId = null;     // which plant is up front
    this.busyUntil = 0;       // no new move is sent while a turn is still playing out
    this.hold = null;         // the health shown while a turn plays out: see refreshHud()
    this.chosen = null;       // the move just sent, until the server answers
    this.resultPanel = null;
    this.enemyBoss = null;    // the boss shown now: { kind, tier }

    // One root container controls scaling.
    this.root = this.add.container(0, 0);

    this.skyLayer = this.add.container(0, 0);
    this.forestLayer = this.add.container(0, 0);
    this.auraLayer = this.add.container(0, 0);
    this.actorLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);
    this.effectLayer = this.add.container(0, 0);
    this.root.add([
      this.skyLayer,
      this.forestLayer,
      this.auraLayer,
      this.actorLayer,
      this.uiLayer,
      this.effectLayer
    ]);

    // the enchanted forest, standing still behind the fight (theme/enchantedForest.js); everything
    // in it is drawn behind `root`, which holds the fighters, the effects and the screen
    addBattleForest(this);
    this.root.setDepth(100);
    this.buildActors();
    // effects are drawn behind the fighters (over the world) and in front of everything
    this.kit = createFxKit(this, { back: this.auraLayer, front: this.effectLayer });
    this.hud = createBattleHud(this, { ui: this.uiLayer, fx: this.effectLayer, scale: this.W / this.scale.width });
    this.hud.onPick = (move) => this.pickMove(move);
    this.hud.onPotion = () => this.drinkPotion();
    // a new wind-up: the surer the tell, the steadier its sound; the boss leans in for a heavy one
    this.hud.onTell = (tell) => {
      audio.play(tell.heavy ? "heavy" : { sure: "tellSure", likely: "tellLikely", flip: "tellFlip" }[tell.grade] || "tellSure");
      if (tell.heavy) this.roarBoss();
      else if (this.enemySprite.emote) this.enemySprite.emote("alert", 1600);
    };
    this.waterPlayed = false;
    audio.setRage(false);
    audio.play("battleStart");
    audio.music("battle", 0.7);
    this.hud.log("Waiting for a boss...");
    // the forest's own meters and button stay out of the way while the battle screen is up
    document.getElementById("hud")?.classList.add("in-battle");

    this.scale.on("resize", this.onResize, this);
    this.stateListener = (_parent, state) => this.applyServerState(state);
    this.registry.events.on("changedata-serverState", this.stateListener);
    this.keys = this.input.keyboard.addKeys("ONE,TWO,THREE,FOUR");
    this.keyListener = (event) => {
      const moves = { Digit1: "attack", Digit2: "guard", Digit3: "special", Digit4: "skill", Digit5: "swap" };
      if (moves[event.code]) this.pickMove(moves[event.code]);
      if (event.code === "Digit6" || event.code === "KeyP") this.drinkPotion();
    };
    this.input.keyboard.on("keydown", this.keyListener);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.onResize, this);
      this.registry.events.off("changedata-serverState", this.stateListener);
      this.input.keyboard.off("keydown", this.keyListener);
      if (this.rewardTimer) this.rewardTimer.remove(false);
      audio.setRage(false);
      audio.music("forest", 0.3);
      document.getElementById("hud")?.classList.remove("in-battle");
    });

    this.onResize();
    this.applyServerState(this.registry.get("serverState"));
  }

  onResize() {
    const s = Math.min(
      this.scale.width / this.W,
      this.scale.height / this.H
    );

    this.root.setScale(s);

    this.root.setPosition(
      (this.scale.width - this.W * s) / 2,
      (this.scale.height - this.H * s) / 2
    );
  }

  // --------------------------------------------------
  // DRAWING HELPERS
  // --------------------------------------------------

  rect(x, y, w, h, color, alpha = 1, stroke = 0, layer = this.forestLayer) {
    const r = this.add.rectangle(x, y, w, h, color, alpha)
      .setOrigin(0);

    if (stroke) r.setStrokeStyle(3, stroke);

    layer.add(r);
    return r;
  }

  ellipse(x, y, w, h, color, alpha = 1, layer = this.forestLayer) {
    const e = this.add.ellipse(x, y, w, h, color, alpha);
    layer.add(e);
    return e;
  }

  text(x, y, str, size = 22, color = "#ffffff",
    opts = {}, layer = this.uiLayer) {
    const t = this.add.text(x, y, str, {
      fontFamily: "monospace",
      fontSize: size,
      color,
      stroke: "#11182b",
      strokeThickness: 3,
      ...opts
    });

    layer.add(t);
    return t;
  }

  // A soft glow on the ground under a fighter, with a thin ring: a faint mark the fighter stands in.
  drawBattleAura(x, y, color = 0x8ef5a5, scale = 1) {
    const aura = this.add.container(x, y);
    this.auraLayer.add(aura);
    aura.setAlpha(0.7);
    const g = this.add.graphics();
    aura.add(g);
    g.setBlendMode(Phaser.BlendModes.ADD);
    for (let i = 7; i >= 1; i--) {
      g.fillStyle(color, 0.035);
      g.fillEllipse(0, 0, 150 + i * 46, (150 + i * 46) * 0.34);
    }
    g.lineStyle(3, color, 0.45);
    g.strokeEllipse(0, 0, 250, 250 * 0.34);
    g.lineStyle(2, 0xffffff, 0.25);
    g.strokeEllipse(0, 0, 214, 214 * 0.34);
    aura.setScale(scale);
    this.tweens.add({ targets: aura, scaleX: scale * 1.05, scaleY: scale * 1.05, alpha: 0.45, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    return aura;
  }

  buildActors() {
    this.drawBattleAura(FIGHTER.x, FIGHTER.y - 4, 0xa8ffd0, 1.4);
    

    // Our side stands on a mossy mound that runs off the bottom of the screen, as in a
    // monster-battle game. That, and the boss being small and far off, gives the field its depth.
    this.drawIsland(FIGHTER.x - 30, FIGHTER.y + 4, 800, 150);
    // The boss has no oval of its own: one hanging in the air made it look as if it was flying.
    // It stands on the forest floor, with turned earth and a dark shadow where its roots go in.
    this.ellipse(BOSS.x, BOSS.y + 3, 300, 40, 0x1b1024, 0.6, this.actorLayer);
    this.ellipse(BOSS.x, BOSS.y + 1, 220, 24, 0x07040d, 0.65, this.actorLayer);

    // The dragon no longer fights. It stands at the back, facing us, and sends the plants in.
    // Its usual picture is made by the forest scene; if the page was opened straight on the
    // battle, that picture does not exist yet and the view from behind is used.
    ensureDragonBackTexture(this);
    const trainerKey = this.textures.exists("plantHero") ? "plantHero" : DRAGON_BACK_KEY;
    this.textures.get(trainerKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.trainer = this.add.image(TRAINER.x, TRAINER.y, trainerKey).setOrigin(0.5, 1);
    this.trainer.setScale(TRAINER.height / this.trainer.height);
    this.ellipse(TRAINER.x, TRAINER.y - 3, 150, 22, 0x10201b, 0.48, this.actorLayer);
    this.actorLayer.add(
      createCastShadow(this, outlineOfPicture(this, trainerKey), { light: BATTLE_LIGHT, size: this.trainer.scaleX })
        .setPosition(TRAINER.x, TRAINER.y - 3)
    );
    this.actorLayer.add(this.trainer);
    this.tweens.add({ targets: this.trainer, y: TRAINER.y - 5, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    if (hasBossRig(this, bossArt("chomper"))) {
      // made of moving pieces: it sways on its own
      this.enemySprite = createBossRig(this, bossArt("chomper"), BOSS.x, BOSS.y, ENEMY_HEIGHT, { light: BATTLE_LIGHT });
      this.enemySprite.artKey = bossArt("chomper").key;
    } else if (this.textures.exists(bossArt("chomper").key)) {
      this.enemySprite = this.add.image(BOSS.x, BOSS.y, bossArt("chomper").key).setOrigin(0.5, 0.93);
      this.fitEnemy({ kind: "chomper", tier: 1 });
    } else {
      this.enemySprite = this.add.container(BOSS.x, BOSS.y);   // no picture to show
    }
    this.actorLayer.add(this.enemySprite);
    this.addBossGrass();

    // Both plants (render/plantRig.js). They stay hidden until the server says who is fighting.
    this.fighters = {};
    for (const id of PLANT_IDS) {
      const rig = createPlantRig(this, PLANTS[id], BENCH.x, BENCH.y, PLANTS[id].rig.height * BENCH.size, { light: BATTLE_LIGHT });
      rig.setVisible(false);
      rig.setTurn(0.85);   // they face the boss, turned enough to still show their faces
      this.actorLayer.add(rig);
      this.fighters[id] = rig;
    }
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
      boss: { x: BOSS.x - 20, y: BOSS.y - 150 },
      bossGround: { x: BOSS.x, y: BOSS.y },
    };
  }

  // What the boss's effect in render/bossFx.js is given. rig: the plant it is aimed at.
  bossCtx(rig, lands, blocked, meet = null) {
    const enemy = this.enemySprite;
    return {
      scene: this, kit: this.kit, palette: bossPalette(this.enemyBoss), lands, blocked, meet,
      mouth: () => {
        if (enemy.mouthPoint) return this.stagePoint(enemy.mouthPoint());
        const at = bossArt(this.enemyBoss).mouth || { x: -40, y: -230 };
        return { x: BOSS.x + at.x, y: BOSS.y + at.y };
      },
      boss: { x: BOSS.x - 20, y: BOSS.y - 150 },
      bossGround: { x: BOSS.x, y: BOSS.y },
      target: { x: FIGHTER.x + 10, y: FIGHTER.y - rig.getHeight() * 0.45 },
      targetGround: { x: FIGHTER.x, y: FIGHTER.y },
      roar: () => this.roarBoss(),
      lunge: (dx, ms) => this.lunge(enemy, dx, ms),
      // for a boss made of several parts: each mouth, each cap, a named move, a feeling, a shove
      mouths: () => (enemy.mouthPoints ? enemy.mouthPoints().map((p) => this.stagePoint(p)).sort((a, b) => a.x - b.x) : [this.stagePoint(enemy.mouthPoint ? enemy.mouthPoint() : { x: 0, y: 0 })]),
      caps: () => (enemy.capPoints ? enemy.capPoints().map((p) => this.stagePoint(p)).sort((a, b) => a.x - b.x) : []),
      act: (name) => (enemy.act ? enemy.act(name) : 0),
      emote: (name, ms, stagger) => enemy.emote && enemy.emote(name, ms, stagger),
      react: (power) => enemy.react && enemy.react(power),
    };
  }

  // The dragon throws an arm forward: "go!"
  trainerCall() {
    this.tweens.add({ targets: this.trainer, angle: 9, x: TRAINER.x + 12, duration: 120, yoyo: true, ease: "Quad.easeOut" });
  }

  // Which plant the server says is fighting.
  fightingPlant(state) {
    const battle = state.battle || {};
    if (this.fighters[battle.plant]) return battle.plant;
    if (state.boss && this.fighters[state.boss.plant]) return state.boss.plant;
    return PLANT_IDS[0];
  }

  // Stands every plant where the server says it is, with no animation: up front, on the bench,
  // or fainted on the bench. arrive: the fighter pops in as if the dragon just called it.
  placeTeam(state, arrive = false) {
    const team = (state.battle && state.battle.team) || {};
    this.activeId = this.fightingPlant(state);
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
      this.hud.callout("left", "GO!", this.plantName(this.activeId), rig.plant.glow);
    }
  }

  // The plant up front has fainted: it tips over and is carried to the bench, and the dragon
  // sends the other one bounding in from the bench.
  swapFighter(outId, inId, delay) {
    const out = this.fighters[outId];
    const next = this.fighters[inId];
    this.activeId = inId;
    if (!out || !next) return;

    this.time.delayedCall(delay, () => {
      out.setMood("fainted");
      out.emote("sweat", 900);
      this.hud.log(`${this.plantName(outId)} fainted!`);
      this.hud.word("DOWN!", "#ff8f9c", FIGHTER.x, FIGHTER.y - 300);
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
      audio.play("swap");
      this.hud.log(`Go, ${this.plantName(inId)}!`);
      this.hud.callout("left", "GO!", this.plantName(inId), next.plant.glow);
      this.hold = null;                      // the screen now shows the new plant
      this.refreshHud();
      next.setVisible(true).setAlpha(1).setMood("fierce");
      next.emote("anger", 1000);
      this.actorLayer.bringToTop(next);
      // two bounds from the bench to the front, growing as it comes closer
      next.play("hop", { ms: 320, height: 0.34 });
      next.play("hop", { ms: 320, height: 0.24, delay: 320 });
      this.tweens.add({
        targets: next, x: FIGHTER.x, y: FIGHTER.y, scaleX: FIGHTER.size, scaleY: FIGHTER.size,
        duration: 640, ease: "Sine.easeInOut",
        onComplete: () => playBattleFx("arrive", this.plantCtx(next, 0, true)),
      });
    });
  }

  plantName(id) {
    const team = (this.serverState && this.serverState.battle && this.serverState.battle.team) || {};
    return (team[id] && team[id].name) || PLANTS[id].name;
  }

  // --------------------------------------------------
  // THE SCREEN AND THE SERVER
  // --------------------------------------------------

  // Redraws the name plates, bars and cards (ui/battleHud.js) from the server's last message.
  // While a turn is playing out, `this.hold` keeps the health as it was until each blow lands.
  refreshHud() {
    const state = this.serverState;
    if (!state || !state.boss || !state.battle) return;
    const { boss, battle, meters } = state;
    const hold = this.hold;
    const id = hold ? hold.id : this.fightingPlant(state);
    const plant = PLANTS[id] || PLANTS[PLANT_IDS[0]];
    const team = battle.team || {};
    const benchId = PLANT_IDS.find((other) => other !== id && team[other]);
    const bench = benchId ? { name: team[benchId].name, hp: team[benchId].hp, max: team[benchId].max_hp, state: team[benchId].state } : null;
    if (bench && hold && hold.id !== battle.plant && benchId === battle.plant) { bench.hp = bench.max; bench.state = "ready"; }
    const skill = (hold && hold.skill) || battle.skill || null;
    // The wind-up for the coming turn. It stays hidden while the last turn is still playing out.
    const intent = !hold && !this.result && battle.intent && this.time.now >= this.busyUntil ? battle.intent : null;
    const tell = intent && {
      name: bossMove(boss, intent.move).name, type: intent.move, grade: intent.grade, chance: intent.chance,
      heavy: intent.heavy, alt: intent.bluff ? { name: bossMove(boss, intent.bluff).name } : null,
    };
    const moves = { ...plant.moves, skill: plantMove(plant, "skill", battle.skill ? battle.skill.name : "") };
    if (!battle.skill) moves.skill = { name: "Skill", icon: "star" };
    this.hud.update({
      fighter: {
        id, name: hold ? hold.name : battle.creature || plant.name, colour: plant.glow,
        hp: hold ? hold.hp : battle.creature_hp, max: hold ? hold.max : battle.creature_max_hp,
      },
      bench,
      boss: {
        name: boss.name, hp: hold ? hold.bossHp : battle.boss_hp, max: boss.max_hp, tier: boss.tier, demo: boss.source === "demo",
        colour: bossPalette(boss).main, enraged: hold ? hold.enraged : battle.enraged,
        enrageAt: battle.enrage_hp ? battle.enrage_hp / boss.max_hp : 0,
      },
      tell, tellKey: `${battle.turn}`, hints: Boolean(battle.hints),
      soil: meters && meters.water ? meters.water[boss.plant] : null,
      vigor: state.health,
      turn: battle.turn,
      moves, skill,
      canPick: Boolean(battle.awaiting_move) && !this.result && this.time.now >= this.busyUntil,
      potion: battle.potion || null,
      canSwap: Boolean(battle.awaiting_move && battle.can_swap) && !this.result && !this.chosen && this.time.now >= this.busyUntil,
      chosen: this.chosen,
      seconds: battle.move_seconds_left,
    });
  }

  flash(sprite) {
    this.tweens.add({ targets: sprite, alpha: 0.25, duration: 70, yoyo: true, repeat: 2, onComplete: () => sprite.setAlpha(1) });
  }

  lunge(sprite, dx, ms = 130) {
    this.tweens.add({ targets: sprite, x: sprite.x + dx, duration: ms, yoyo: true, ease: "Quad.easeOut" });
  }

  pickMove(move) {
    const battle = this.serverState?.battle;
    if (!battle?.awaiting_move || this.result || this.time.now < this.busyUntil) return;   // the last turn is still playing out
    if (this.chosen) return;
    if (move === "skill" && !battle.skill?.ready) { audio.play("no"); return; }
    if (move === "swap" && !battle.can_swap) { audio.play("no"); return; }   // nobody to change to
    audio.play("pick");
    this.registry.get("sendMove")?.(move);
    this.chosen = move;
    // if the server never answers (a dropped message), the cards come back
    const turn = battle.turn;
    this.time.delayedCall(1500, () => {
      if (this.chosen !== move || this.serverState?.battle?.turn !== turn) return;
      this.chosen = null;
      this.refreshHud();
    });
    this.hud.log(move === "swap" ? "Changing plants..." : "Here it comes...");
    this.refreshHud();
  }

  // The health potion: only on your own move, and it does not use the turn. The server decides.
  drinkPotion() {
    const battle = this.serverState?.battle;
    if (!battle?.awaiting_move || this.result || this.chosen || this.time.now < this.busyUntil) return;
    if (!battle.potion?.ready || battle.creature_hp >= battle.creature_max_hp) { audio.play("no"); return; }
    this.registry.get("sendPotion")?.();
  }

  // A potion was drunk: the plant glows, the number floats up, the bar fills.
  showPotion(healed) {
    const rig = this.fighters[this.activeId];
    if (!rig) return;
    audio.play("heal");
    rig.emote("sparkle", 1100);
    rig.play("cheer");
    this.kit.ring(rig.x, rig.y - rig.getHeight() * 0.45, { from: 30, to: 230, color: 0x8dff9b, thick: 8, ms: 480 });
    this.hud.number(rig.x - 20, rig.y - rig.getHeight() * 0.8, `+${healed}`, "#8dff9b");
    this.hud.log(`${this.plantName(this.activeId)} drank a potion: +${healed} HP.`);
  }

  applyServerState(state) {
    if (!state) return;
    const previous = this.lastBattle;
    this.serverState = state;
    const battle = state.battle;
    if (state.boss && battle) {
      if (this.activeId === null) this.placeTeam(state, true);   // the dragon sends the first plant in
      if (!this.enemyBoss || state.boss.tier !== this.enemyBoss.tier || state.boss.kind !== this.enemyBoss.kind) {
        this.enemyBoss = { kind: state.boss.kind, tier: state.boss.tier };
        this.fitEnemy(this.enemyBoss);
      }
      if (previous && battle.potion && previous.potion && battle.potion.used > previous.potion.used) {
        this.showPotion(Math.max(0, battle.creature_hp - previous.creature_hp));
      }
      if (previous && battle.turn > previous.turn) this.animateTurn(previous, battle, state);
      // a plant change with no turn to show it (the page was opened late): just put them in place
      if (this.fightingPlant(state) !== this.activeId) this.placeTeam(state);
      this.refreshHud();
      if ((!previous || previous.turn === battle.turn) && this.time.now >= this.busyUntil && !this.chosen) {
        this.hud.log(battle.awaiting_move ? "Read the wind-up. Choose a move." : "The fight is on...");
      }
      this.lastBattle = { ...battle };
    }
    if (state.mode === "reward") this.showResult(true, state);
    else if (state.mode === "cooldown" && previous && !this.result) this.showResult(previous.boss_hp <= 0, state);
    else if (state.mode === "walking" && !battle && !this.result) this.hud.log("Waiting for a boss...");
    if ((state.mode === "walking" || state.mode === "cooldown") && (this.result || !battle)) this.leaveWhenReady();
  }

  // The mound our plants stand on, in the forest's own colours: dark violet earth with a lit rim,
  // moss in several greens, dappled light, and round its edge grass, tiny flowers, fallen wisteria
  // petals and the same glowing blue mushrooms that grow among the trees. x, y is its middle.
  drawIsland(x, y, w, h) {
    const rng = new Phaser.Math.RandomDataGenerator(["plant-island"]);
    const g = this.add.graphics();
    this.actorLayer.add(g);
    const oval = (dx, dy, ow, oh, color, alpha = 1) => { g.fillStyle(color, alpha); g.fillEllipse(x + dx, y + dy, ow, oh); };
    // a spot on the mound's top: angle round it, and how far out from the middle (1 is the rim)
    const spot = (angle, out) => ({ x: x + Math.cos(angle) * (w * 0.465) * out, y: y + Math.sin(angle) * (h * 0.41) * out });

    // the earth it is made of, and a soft glow where it meets the ground
    oval(0, h * 0.3, w * 1.1, h * 1.2, 0x7a5cff, 0.1);
    oval(0, h * 0.24, w * 1.04, h * 1.12, 0x120a1f, 0.85);
    oval(0, h * 0.13, w * 1.01, h * 1.04, 0x2b1b45, 1);
    oval(0, h * 0.09, w * 1.0, h * 1.0, 0x4a3470, 1);          // the lit lip of the earth
    // moss, darker at the edge and brighter where the light falls
    oval(0, h * 0.03, w * 0.985, h * 0.96, 0x1c4a3c, 1);
    oval(0, 0, w * 0.95, h * 0.86, 0x276b47, 1);
    oval(-w * 0.03, -h * 0.03, w * 0.84, h * 0.7, 0x348a52, 1);
    oval(-w * 0.07, -h * 0.07, w * 0.6, h * 0.46, 0x4aa85e, 0.75);
    oval(-w * 0.1, -h * 0.1, w * 0.36, h * 0.24, 0x8fe08a, 0.22);
    oval(w * 0.22, h * 0.06, w * 0.34, h * 0.3, 0x5b3fa0, 0.16);   // the purple of the trees, thrown across it

    // dappled light and moss clumps
    for (let i = 0; i < 46; i++) {
      const p = spot(rng.frac() * Math.PI * 2, Math.sqrt(rng.frac()) * 0.9);
      const light = rng.frac() < 0.55;
      g.fillStyle(light ? 0x6fc56c : 0x1f5a40, light ? 0.3 : 0.4);
      g.fillEllipse(p.x, p.y, rng.between(14, 44), rng.between(4, 9));
    }
    // a few flat stones sunk in the moss
    for (let i = 0; i < 6; i++) {
      const p = spot(Math.PI + rng.frac() * Math.PI, 0.35 + rng.frac() * 0.5);
      const sw = rng.between(20, 38);
      g.fillStyle(0x2a2440, 0.9); g.fillEllipse(p.x, p.y + 2, sw, sw * 0.36);
      g.fillStyle(0x6a6590, 1); g.fillEllipse(p.x, p.y, sw, sw * 0.34);
      g.fillStyle(0xa9a6cf, 0.8); g.fillEllipse(p.x - sw * 0.12, p.y - 1.5, sw * 0.5, sw * 0.12);
    }
    // grass round the back rim, where it shows against the forest
    for (let i = 0; i < 120; i++) {
      const p = spot(Math.PI + (i / 119) * Math.PI + rng.realInRange(-0.02, 0.02), rng.realInRange(0.9, 1.0));
      const bh = rng.between(8, 22), lean = rng.between(-6, 6);
      g.fillStyle([0x1f5a3c, 0x2f8048, 0x47a65a, 0x79d87c][i % 4], 1);
      g.fillTriangle(p.x - 3, p.y + 2, p.x + 3, p.y + 2, p.x + lean, p.y - bh);
    }
    // fallen wisteria petals and tiny flowers
    for (let i = 0; i < 34; i++) {
      const p = spot(rng.frac() * Math.PI * 2, 0.2 + rng.frac() * 0.72);
      g.fillStyle([0xc9a8ff, 0xe6d4ff, 0x9d7cf0][i % 3], 0.9);
      g.fillEllipse(p.x, p.y, rng.between(4, 7), 2.5);
    }
    for (let i = 0; i < 16; i++) {
      const p = spot(Math.PI * (0.95 + rng.frac() * 1.1), 0.55 + rng.frac() * 0.4);
      const color = [0xff9ad0, 0xffffff, 0xffe27a, 0xb8f0ff][i % 4];
      g.fillStyle(0x2f8048, 1); g.fillRect(p.x - 0.5, p.y - 7, 1.5, 7);
      g.fillStyle(color, 1);
      for (const [fx, fy] of [[-2.5, -8], [2.5, -8], [0, -10.5], [0, -5.5]]) g.fillCircle(p.x + fx, p.y + fy, 2);
      g.fillStyle(0xffd24a, 1); g.fillCircle(p.x, p.y - 8, 1.4);
    }
    // glowing mushrooms, like the ones among the trees: they breathe light
    const glow = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.actorLayer.add(glow);
    for (let i = 0; i < 9; i++) {
      const p = spot(Math.PI * (1.02 + (i / 8) * 0.96) + rng.realInRange(-0.05, 0.05), rng.realInRange(0.7, 0.93));
      const size = rng.realInRange(0.75, 1.5);
      const cap = i % 3 === 2 ? 0xff9ad8 : 0x7fe0ff;
      g.fillStyle(0xe9f6ff, 1); g.fillRect(p.x - 1.5 * size, p.y - 9 * size, 3 * size, 9 * size);
      g.fillStyle(cap, 1); g.fillEllipse(p.x, p.y - 10 * size, 14 * size, 8 * size);
      g.fillStyle(0xffffff, 0.75); g.fillEllipse(p.x - 2.5 * size, p.y - 11.5 * size, 4 * size, 2 * size);
      g.fillStyle(0x10201b, 0.35); g.fillEllipse(p.x, p.y + 1, 12 * size, 3 * size);
      glow.fillStyle(cap, 0.16); glow.fillCircle(p.x, p.y - 9 * size, 20 * size);
      glow.fillStyle(cap, 0.1); glow.fillEllipse(p.x, p.y + 2, 46 * size, 12 * size);   // its light on the moss
    }
    this.tweens.add({ targets: glow, alpha: { from: 0.55, to: 1 }, duration: 1900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // Tufts of grass over the edge of the earth the boss stands in, so it looks planted, not hovering.
  // They are added after the boss, which is swapped in place by fitEnemy, so they stay in front of it.
  addBossGrass() {
    const g = this.add.graphics();
    const rng = new Phaser.Math.RandomDataGenerator(["boss-grass"]);
    for (let i = 0; i < 46; i++) {
      const x = BOSS.x + (i / 45 - 0.5) * 316 + rng.between(-5, 5);
      const edge = Math.abs(i / 45 - 0.5) * 2;                 // 0 in the middle, 1 at the ends
      const y = BOSS.y + 6 + Math.sqrt(1 - edge * edge) * 22 + rng.between(-2, 2);   // along the front rim of its patch
      const h = rng.between(7, 15);
      const lean = rng.between(-5, 5);
      g.fillStyle([0x2e6b3a, 0x3f8a43, 0x1e4a30][i % 3], 1);
      g.fillTriangle(x - 3, y, x + 3, y, x + lean, y - h);
    }
    this.actorLayer.add(g);
    this.bossGrass = g;
  }

  // Puts the right boss on the field, at battle size, keeping its proportions. Higher tiers stand taller.
  // The first one is the Chomper (see buildActors); another kind of boss takes its place in the stack.
  fitEnemy(boss) {
    const art = bossArt(boss);
    const height = ENEMY_HEIGHT * Math.min(1.2, art.height / bossArt("chomper").height);
    if (this.enemySprite.artKey !== art.key && this.textures.exists(art.key)) {
      const old = this.enemySprite;
      const at = this.actorLayer.getIndex(old);
      this.tweens.killTweensOf(old);
      const next = hasBossRig(this, art)
        ? createBossRig(this, art, BOSS.x, BOSS.y, height, { light: BATTLE_LIGHT })
        : this.add.image(BOSS.x, BOSS.y, art.key).setOrigin(0.5, 0.93);
      next.artKey = art.key;
      this.actorLayer.addAt(next, Math.max(0, at));
      old.destroy();
      this.enemySprite = next;
    }
    if (this.enemySprite.isBossRig) { this.enemySprite.setHeight(height); return; }
    if (!this.textures.exists(art.key) || this.enemySprite.type !== "Image") return;
    this.tweens.killTweensOf(this.enemySprite);
    const picture = this.textures.get(art.key).getSourceImage();
    this.enemySprite.setTexture(art.key).setDisplaySize(height * (picture.width / picture.height), height).setPosition(BOSS.x, BOSS.y).setAngle(0);
    this.enemyHome = { x: this.enemySprite.x, scaleX: this.enemySprite.scaleX, scaleY: this.enemySprite.scaleY };
    // a flat boss has no mouth to open: it swells and shudders instead
    this.tweens.add({ targets: this.enemySprite, scaleY: this.enemyHome.scaleY * 1.015, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // The boss roars: the moving one opens its mouth, a flat one rears up and shakes.
  roarBoss() {
    const enemy = this.enemySprite;
    if (enemy.roar) { enemy.roar(); return; }
    if (!this.enemyHome || enemy.type !== "Image") return;
    const home = this.enemyHome;
    this.tweens.killTweensOf(enemy);
    this.tweens.add({ targets: enemy, scaleX: home.scaleX * 1.1, scaleY: home.scaleY * 1.12, duration: 160, yoyo: true, ease: "Quad.easeOut",
      onComplete: () => this.tweens.add({ targets: enemy, scaleY: home.scaleY * 1.015, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }) });
    this.tweens.add({ targets: enemy, x: home.x + 5, duration: 40, yoyo: true, repeat: 9, onComplete: () => enemy.setX(home.x) });
  }

  // --------------------------------------------------
  // ONE TURN
  // --------------------------------------------------

  // Plays one turn. Both sides always show their move, even the one that lost the turn:
  //   the plant goes first, then the boss answers;
  //   unless the plant's guard is what won, then the boss strikes first and breaks on the shield;
  //   a tie has both go at once and meet in the middle.
  // What each plant does for a move is in data/plants.js, and the boss's moves are in data/bosses.js.
  animateTurn(previous, battle, state) {
    const move = battle.last_move;
    if (!move) return;
    if (move.creature === "swap") { this.animateSwapTurn(previous, battle, state); return; }
    const swap = move.swap || null;
    const actorId = swap && this.fighters[swap.out] ? swap.out : this.activeId;
    const actor = this.fighters[actorId];
    const enemy = this.enemySprite;
    const who = previous.creature || battle.creature;
    const mine = plantMove(actor.plant, move.creature, move.skill);
    const theirs = bossMove(state.boss, move.boss);
    const palette = bossPalette(state.boss);

    const healed = move.healed || 0;
    const bossLoss = previous.boss_hp - battle.boss_hp;
    const before = previous.plant === undefined || previous.plant === actorId ? previous.creature_hp : 0;
    const playerLoss = Math.max(0, (swap ? before : before - battle.creature_hp) + healed);
    const plantLands = bossLoss > 0;
    const tie = move.hit === "tie";
    const bossLands = playerLoss > 0 && !tie;
    const graze = tie ? playerLoss : 0;   // a tie costs the plant a little
    const shielded = move.boss === "attack" && !bossLands && mine.body === "guard";
    const above = () => ({ x: actor.x - 20, y: actor.y - actor.getHeight() * 0.8 });

    this.chosen = null;
    this.hold = {
      id: actorId, name: who, max: previous.creature_max_hp, hp: before, bossHp: previous.boss_hp,
      skill: previous.skill, enraged: previous.enraged,
    };

    // The turn is told like a story: "EMBER used VINE HAYMAKER!", a beat, the move, a word for
    // how it went, a pause, then the boss's line and its move.
    const sayPlant = () => {
      this.hud.announce(who, mine.name, actor.plant.glow, CALL + 500);
      this.hud.log(`${who} used ${mine.name}!`);
      audio.play("call");
      this.time.delayedCall(CALL, () => audio.play(`move_${mine.fx}`));
    };
    const sayBoss = () => {
      this.hud.announce(state.boss.name, theirs.name, palette.main, CALL + 500);
      this.hud.log(move.bluffed ? `A bluff! ${state.boss.name} used ${theirs.name}!` : `${state.boss.name} used ${theirs.name}!`);
      audio.play(move.bluffed ? "bluff" : "call");
      if (move.bluffed) this.hud.word("BLUFF!", "#ff8f6b", BOSS.x - 20, BOSS.y - 330, 16);
    };
    const shout = (str, color) => this.hud.word(str, color, 640, 300, 24);
    const finisher = battle.boss_hp <= 0;

    const onBossHurt = () => {
      this.hold.bossHp = battle.boss_hp;
      this.refreshHud();
      this.flash(enemy);
      this.lunge(enemy, 26);
      // a boss made of parts flinches, and a beaten one goes dizzy
      if (enemy.emote) { enemy.emote(finisher ? "dizzy" : "hurt", finisher ? 3000 : 900); if (finisher) enemy.setMood("dizzy"); }
      if (enemy.react) enemy.react(Math.min(2, bossLoss / 8));
      audio.play(finisher || bossLoss >= 9 ? "crit" : "hit");
      this.hud.number(BOSS.x - 20, BOSS.y - 300, `-${bossLoss}`, "#fff48e", bossLoss >= 9);
      shout(finisher ? "KNOCKOUT!" : bossLoss >= 9 ? "CRITICAL HIT!" : move.skill ? "BOOM!" : "DIRECT HIT!", finisher ? "#ffd867" : "#fff48e");
      this.benchCheers();
    };
    const onPlantHurt = () => {
      this.hold.hp = swap ? 0 : battle.creature_hp;
      this.refreshHud();
      actor.play("hurt", { force: 1.3 });
      this.flash(actor);
      audio.play(move.heavy || playerLoss >= 12 ? "crit" : "hurt");
      if (enemy.emote) enemy.emote("smug", 1000, 120);
      this.hud.number(above().x, above().y, `-${playerLoss}`, "#ff8f90", playerLoss >= 9);
      shout(swap || battle.creature_hp <= 0 ? "KNOCKED OUT!" : move.heavy ? "HEAVY HIT!" : playerLoss >= 12 ? "CRUNCH!" : "OUCH!", "#ff8f90");
      if (move.heavy || playerLoss >= 12) this.kit.shake(260, 0.012);
    };
    // The boss's move starts now. Returns when its blow arrives.
    const bossGoes = (blocked, meet = null) => {
      audio.play(`boss_${theirs.fx}`);
      return playBossFx(theirs.fx, this.bossCtx(actor, bossLands, blocked, meet));
    };
    const reach = () => {
      if (!plantLands) return 0.42;
      return mine.reach === "boss" ? (BOSS.x - 235 - FIGHTER.x) / actor.getHeight() : 0.85;
    };

    let length;
    if (shielded) {
      // the boss is called first, then the plant; the shield goes up just in time
      sayBoss();
      this.time.delayedCall(CALL, sayPlant);
      const go = CALL * 2;
      const blow = go + BOSS_BLOW;                    // about when the boss's blow arrives
      this.time.delayedCall(go, () => bossGoes(true));
      const options = { ms: mine.ms, delay: 0 };
      options.delay = Math.max(0, blow - actor.hitTime(mine.body, options));
      actor.play(mine.body, options);
      const extra = playBattleFx(mine.fx, this.plantCtx(actor, blow, plantLands));
      this.time.delayedCall(blow, () => { shout("BLOCKED!", "#bfe6ff"); this.lunge(enemy, 40, 160); audio.play("block"); if (enemy.emote) enemy.emote("shock", 800); });
      if (plantLands) this.time.delayedCall(blow + extra + 380, onBossHurt);
      length = blow + extra + 1000;
    } else if (tie) {
      // both are called, then they go at once: they meet in the middle, and the plant is grazed
      sayPlant();
      this.time.delayedCall(CALL, sayBoss);
      const go = CALL * 2;
      const options = { ms: mine.ms, delay: go, reach: reach() };
      actor.play(mine.body, options);
      const hitAt = actor.hitTime(mine.body, options);
      playBattleFx(mine.fx, this.plantCtx(actor, hitAt, false));
      const mid = { x: (FIGHTER.x + BOSS.x) / 2 + 30, y: FIGHTER.y - 240 };
      this.time.delayedCall(go, () => bossGoes(false, mid));
      const meet = Math.max(hitAt, go + BOSS_BLOW);
      this.time.delayedCall(meet, () => {
        this.kit.impact(mid.x, mid.y, { power: 1.1, color: 0xd7e3ff });
        shout(move.creature === "guard" ? "STANDOFF!" : "CLASH!", "#d7e3ff");
        audio.play("clash");
        if (graze > 0) {
          this.hold.hp = swap ? 0 : battle.creature_hp;
          this.refreshHud();
          actor.play("hurt", { force: 0.7 });
          audio.play("graze");
          this.hud.number(above().x, above().y, `-${graze}`, "#ff8f90");
        }
      });
      length = meet + 800;
    } else {
      sayPlant();
      const options = { ms: mine.ms, delay: CALL, reach: reach() };
      actor.play(mine.body, options);
      const hitAt = actor.hitTime(mine.body, options);
      const extra = playBattleFx(mine.fx, this.plantCtx(actor, hitAt, plantLands));
      const landed = hitAt + extra;
      if (plantLands) this.time.delayedCall(landed, onBossHurt);
      else if (!healed) this.time.delayedCall(landed, () => { shout(mine.body === "guard" ? "NOTHING TO BLOCK!" : "IT FAILED!", "#c9d2e8"); audio.play("miss"); });
      if (healed > 0) {
        this.time.delayedCall(hitAt, () => {
          this.hold.hp = Math.min(this.hold.max, this.hold.hp + healed);
          this.refreshHud();
          this.hud.number(above().x, above().y, `+${healed}`, "#8dff9b");
          audio.play("heal");
        });
      }
      if (finisher) {
        length = landed + 700;               // that was the last blow: the boss has no answer
      } else {
        const bossSays = landed + PAUSE;
        this.time.delayedCall(bossSays, sayBoss);
        this.time.delayedCall(bossSays + CALL, () => {
          const blow = bossGoes(false);
          this.time.delayedCall(blow, bossLands ? onPlantHurt : () => { shout("NO EFFECT!", "#c9d2e8"); audio.play("miss"); });
        });
        length = bossSays + CALL + BOSS_BLOW + (bossLands ? 620 : 420);
      }
    }

    // a plant that runs out of health tips over; if the other one is ready, the dragon sends it in
    if (swap || battle.creature_hp <= 0) this.time.delayedCall(length - 60, () => audio.play("faint"));
    if (swap) { this.swapFighter(swap.out, swap.in, length - 60); length += 1500; }
    else if (battle.creature_hp <= 0) this.time.delayedCall(length - 60, () => actor.setMood("fainted"));

    // at half health the boss loses its temper: from now on it hits harder and its tells are shakier
    if (move.enraged) {
      this.time.delayedCall(length, () => {
        if (this.result) return;
        this.hold.enraged = true;
        this.refreshHud();
        this.roarBoss();
        if (enemy.setMood) enemy.setMood("enraged");
        audio.play("enrage");
        audio.setRage(true);
        this.kit.flash(palette.main, 0.35, 260);
        this.kit.shake(420, 0.014);
        this.kit.ring(BOSS.x, BOSS.y, { from: 60, to: 520, squash: 0.3, color: palette.hot, thick: 10, ms: 520, layer: "back" });
        this.hud.word("ENRAGED!", "#ff6b5b", BOSS.x - 20, BOSS.y - 300, 24);
        this.hud.log(`${state.boss.name} is enraged! It hits harder and bluffs more.`);
      });
      length += 1000;
    }

    this.busyUntil = this.time.now + length;
    this.time.delayedCall(length + 20, () => {
      this.hold = null;
      this.refreshHud();
      if (!this.result && battle.skill?.ready && !previous.skill?.ready && !move.swap) audio.play("charged");
      if (!this.result && this.serverState?.battle?.awaiting_move) this.hud.log("Read the wind-up. Choose a move.");
    });
  }

  // The player spent the turn changing plants: one hops back to the bench, the other bounds in,
  // and the boss's move lands on the one that came in. If that knocks it out, the first returns.
  animateSwapTurn(previous, battle, state) {
    const move = battle.last_move;
    const { out: outId, in: inId } = move.swap;
    const out = this.fighters[outId];
    const actor = this.fighters[inId];
    const enemy = this.enemySprite;
    if (!out || !actor) { this.placeTeam(state); return; }
    const theirs = bossMove(state.boss, move.boss);
    const palette = bossPalette(state.boss);
    const back = move.back || null;                        // it went down at once: the other comes back
    const was = (previous.team && previous.team[inId]) || {};
    const before = was.hp ?? battle.creature_max_hp;
    const name = move.swap.name || this.plantName(inId);
    const loss = move.took || 0;

    this.chosen = null;
    this.hold = { id: inId, name, max: was.max_hp ?? before, hp: before, bossHp: previous.boss_hp, skill: back ? null : battle.skill, enraged: previous.enraged };

    // the change itself
    this.activeId = inId;
    this.tweens.killTweensOf(out);
    this.tweens.killTweensOf(actor);
    this.hud.log(`${this.plantName(outId)}, come back! Go, ${name}!`);
    this.hud.callout("left", "GO!", name, actor.plant.glow);
    this.trainerCall();
    audio.play("swap");
    out.setMood("happy");
    out.play("hop", { ms: 300, height: 0.24 });
    this.tweens.add({ targets: out, x: BENCH.x, y: BENCH.y, scaleX: BENCH.size, scaleY: BENCH.size, duration: 420, ease: "Sine.easeInOut" });
    actor.setVisible(true).setAlpha(1).setMood("fierce");
    actor.emote("anger", 1000);
    this.actorLayer.bringToTop(actor);
    actor.play("hop", { ms: 320, height: 0.34 });
    actor.play("hop", { ms: 320, height: 0.24, delay: 320 });
    this.tweens.add({
      targets: actor, x: FIGHTER.x, y: FIGHTER.y, scaleX: FIGHTER.size, scaleY: FIGHTER.size, duration: 640, ease: "Sine.easeInOut",
      onComplete: () => playBattleFx("arrive", this.plantCtx(actor, 0, true)),
    });
    this.refreshHud();

    // then the boss's move, which nothing answers
    const bossSays = 900;
    this.time.delayedCall(bossSays, () => {
      this.hud.announce(state.boss.name, theirs.name, palette.main, CALL + 500);
      this.hud.log(move.bluffed ? `A bluff! ${state.boss.name} used ${theirs.name}!` : `${state.boss.name} used ${theirs.name}!`);
      audio.play(move.bluffed ? "bluff" : "call");
      if (move.bluffed) this.hud.word("BLUFF!", "#ff8f6b", BOSS.x - 20, BOSS.y - 330, 16);
    });
    this.time.delayedCall(bossSays + CALL, () => {
      audio.play(`boss_${theirs.fx}`);
      const blow = playBossFx(theirs.fx, this.bossCtx(actor, loss > 0, false, null));
      this.time.delayedCall(blow, () => {
        this.hold.hp = Math.max(0, before - loss);
        this.refreshHud();
        actor.play("hurt", { force: 1.3 });
        this.flash(actor);
        audio.play(move.heavy || loss >= 12 ? "crit" : "hurt");
        if (enemy.emote) enemy.emote("smug", 1000, 120);
        this.hud.number(actor.x - 20, actor.y - actor.getHeight() * 0.8, `-${loss}`, "#ff8f90", loss >= 9);
        this.hud.word(back ? "KNOCKED OUT!" : move.heavy ? "HEAVY HIT!" : loss >= 12 ? "CRUNCH!" : "OUCH!", "#ff8f90", 640, 300, 24);
        if (move.heavy || loss >= 12) this.kit.shake(260, 0.012);
      });
    });
    let length = bossSays + CALL + BOSS_BLOW + 620;
    if (back) {
      this.time.delayedCall(length - 60, () => audio.play("faint"));
      this.swapFighter(back.out, back.in, length - 60);
      length += 1500;
    }

    this.busyUntil = this.time.now + length;
    this.time.delayedCall(length + 20, () => {
      this.hold = null;
      this.refreshHud();
      if (!this.result && this.serverState?.battle?.awaiting_move) this.hud.log("Read the wind-up. Choose a move.");
    });
  }

  // The plant on the bench is glad when its friend lands a hit.
  benchCheers() {
    for (const id of PLANT_IDS) {
      const rig = this.fighters[id];
      if (id !== this.activeId && rig.visible && rig.getMood() !== "fainted") rig.play("hop", { height: 0.16 });
    }
  }

  // --------------------------------------------------
  // THE END OF THE FIGHT
  // --------------------------------------------------

  showResult(won, state) {
    if (this.result) { if (won && state.reward) this.showReward(state.reward); return; }
    this.result = won ? "win" : "loss";
    // the last blow plays out before anything is announced
    const wait = Math.max(0, this.busyUntil - this.time.now);
    this.resultShownAt = this.time.now + wait + (won ? 900 : 300);
    this.refreshHud();
    this.time.delayedCall(wait, () => {
      this.hold = null;
      this.refreshHud();
      audio.music(null);
      if (won) { this.dissolveBoss(); this.kit.at(520, () => audio.play("boom")); }
      else { this.roarBoss(); audio.play("roar"); }
      // the plants: a win has them bouncing, a loss leaves them flat out
      PLANT_IDS.forEach((id, i) => {
        const rig = this.fighters[id];
        if (!rig.visible) return;
        if (!won) { rig.setMood("fainted"); return; }
        if (rig.getMood() === "fainted") return;
        rig.setMood("proud");
        rig.emote(i % 2 ? "heart" : "sparkle", 1800);
        for (let n = 0; n < 3; n++) rig.play("cheer", { delay: 200 + i * 220 + n * 950 });
      });
      this.time.delayedCall(won ? 900 : 300, () => {
        this.resultPanel = this.hud.result(won, won ? "The drought boss has retreated." : "No water this time.");
        audio.play(won ? "victory" : "defeat");
        if (won) { this.confetti(); this.showReward(this.serverState && this.serverState.reward); }
      });
    });
  }

  // The boss comes apart: it shudders, cracks with light, and bursts.
  dissolveBoss() {
    const enemy = this.enemySprite;
    const palette = bossPalette(this.enemyBoss);
    const x = BOSS.x - 20, y = BOSS.y - 150;
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
      this.kit.flash(0xffffff, 0.75, 240);
      this.kit.shake(380, 0.016);
      this.kit.impact(x, y, { power: 2, color: palette.hot, color2: palette.main, shape: "petal" });
      this.kit.ring(BOSS.x, BOSS.y, { from: 60, to: 560, squash: 0.3, color: 0xffffff, thick: 12, ms: 560, layer: "back" });
      this.kit.burst(x, y, { count: 60, colors: [palette.main, palette.hot, 0xf2aa62, 0xffd676], shape: "petal", speed: [200, 900], size: [12, 28], life: [700, 1400], gravity: 700, spin: [-8, 8] });
      this.kit.burst(x, y, { count: 30, colors: [0xffffff, palette.core, palette.hot], shape: "star", speed: [100, 500], size: [8, 18], life: [600, 1200], gravity: -60, add: true });
    });
  }

  confetti() {
    this.kit.burst(640, 120, { count: 70, colors: [0xffd867, 0x8dff9b, 0x7fd0ff, 0xff8f9c, 0xffffff], shape: "sq", speed: [200, 760], angle: Math.PI / 2, spread: 3.4, size: [8, 14], life: [1400, 2400], gravity: 420, drag: 0.97, spin: [-10, 10], stretch: 1.8 });
  }

  showReward(reward) {
    if (!this.resultPanel) return;
    if (!reward) { this.resultPanel.setLine("No water sent: the pot is wet, or the cube is offline."); return; }
    if (!this.waterPlayed) { this.waterPlayed = true; this.time.delayedCall(1300, () => audio.play("water", reward.size / 1000)); }
    const seconds = (reward.size / 1000).toFixed(1);
    this.resultPanel.setLine(`Water for plant ${reward.plant}: pump runs ${seconds} s`);
    this.resultPanel.reward(`Watering plant ${reward.plant}`, reward.size);
  }

  leaveWhenReady() {
    if (this.leaving) return;
    const remaining = this.result ? 2500 - (this.time.now - this.resultShownAt) : 0;
    if (remaining > 0) {
      this.time.delayedCall(remaining, () => this.leaveWhenReady());
      return;
    }
    const adventure = this.scene.get("AdventureScene");
    if (!adventure || !adventure.scene.isSleeping()) return;
    this.leaving = true;
    this.cameras.main.fadeOut(350);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { this.scene.stop(); this.scene.wake("AdventureScene"); });
  }
}
