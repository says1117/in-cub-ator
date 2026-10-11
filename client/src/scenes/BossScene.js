import { bossRotation } from "../state/bossRotation.js";
import { bossDefinition, bossMove } from "../data/bosses.js";
import { skillPower } from "../services/plantSkills.js";
import Presentation from "./BossPresentation.js";
import { playBattleFx } from "../render/battleFx.js";
import { playBossFx } from "../render/bossFx.js";
import { requestWateringReward } from "../services/api.js";
import Legacy from "../legacy/BossScene.js";
import { getAllPlants, subscribe } from "../state/plantStore.js";

// Reuse the existing battle mechanics with the new scene's artwork and HUD.
export default class BossScene extends Presentation {
  init(data = {}) { this.selectedPlantId = data.plantId; }
  onState() {}
  preload() { super.preload(); if (!this.textures.exists("plantHero")) this.load.image("plantHero", "/assets/characters/dragon.png"); }
  create() {
    this.encounter = this.registry.get("serverState")?.boss || bossRotation.begin();
    this.bossDefinition = bossDefinition(this.encounter.id);
    this.rules = null;
    this.rewardBattleId = crypto.randomUUID();
    this.audioLow = false;
    this.audioIntensity = 0.35;
    this.audioTurn = null;
    super.create();
    this.audio("setQuiet", false);
    this.audio("setIntensity", 0.35);
    const scene = this;
    const rules = Object.create(Legacy.prototype);
    this.rules = rules;
    Object.assign(rules, {
      time: this.time, events: this.events, selectedPlantId: this.selectedPlantId,
      combatHpDelta: 0, combatWaterDelta: 0, combatLightDelta: 0,
      enemy: { name: this.bossDefinition.name, attackNames: this.bossDefinition.attackNames, level: 8, hp: 100, maxHp: 100, stamina: 70, maxStamina: 70 },
      player: null, turn: 1, bossAttackCount: 0, busy: false, finished: false, boost: false,
      message: text => scene.hud.setLog(text),
      updateHUD: () => scene.refreshLive(),
      animateWater: () => scene.careEffect("aegis", "care_water"),
      animateSunlight: () => scene.careEffect("sunlight", "care_sunlight"),
      animateCO2: () => scene.careEffect("sunlight", "care_co2"),
      animateLeafFlurry: (damage, done) => {
        const rig = scene.fighters[scene.activeId];
        scene.sfx("leaf_flurry");
        rig.play("strike");
        playBattleFx("thorns", scene.plantCtx(rig, 200, true));
        scene.time.delayedCall(850, () => { scene.sfx(damage >= 24 ? "hit_heavy" : "hit_light"); scene.flashRig(scene.enemy); scene.floating(865, 260, `-${damage}`); done(); });
      },
      animateBossAttack: (damage, done, { laser = false } = {}) => {
        const target = scene.fighters[scene.activeId];
        const ctx = scene.bossCtx(target, true, false);
        if (laser) {
          scene.sfx("boss_laser_charge");
          ctx.power = 1.6;
          const hitAt = playBossFx("ray", ctx);
          scene.time.delayedCall(500, () => scene.sfx("boss_laser"));
          scene.time.delayedCall(hitAt, () => {
            scene.sfx("hurt"); target?.play("hurt");
            scene.floating(405, 300, `LASER −${damage}`, "#ffb45c"); done();
          });
        } else {
          scene.sfx("whoosh", { gain: 0.6 });
          const attackFx = bossMove(1, "attack", scene.encounter.id).fx;
          const hitAt = playBossFx(attackFx, ctx);
          scene.time.delayedCall(Math.max(620, hitAt), () => {
            scene.sfx("boss_bite"); scene.sfx("hurt"); target?.play("hurt");
            scene.floating(405, 300, `-${damage}`, "#ff8f90"); done();
          });
        }
      },
      endBattle: won => {
        if (rules.finished) return;
        rules.finished = true; rules.busy = true;
        bossRotation.complete(scene.encounter.encounterId); scene.refreshLive();
        scene.hud.showResult({ title: won ? "VICTORY!" : "DEFEAT", line: won ? `${rules.enemy.name} defeated!` : `${rules.player.name} fainted.`, detail: won ? "Requesting simulated watering from the server…" : "Returning to the forest…", water: false });
        scene.audio("setHeartbeat", false);
        scene.audio("setIntensity", 0);
        scene.audio("music", won ? "victory" : "defeat");
        if (won) { scene.dissolveBoss(); scene.confetti(); }
        else scene.sfx("defeat_sting");
        scene.events.emit("battleComplete", { won, turns: rules.turn, player: rules.player, enemy: rules.enemy });
        if (won) scene.awardWatering(rules.activePlantId);
        else scene.returnToForest();
      }
    });
    this.hud.setFight({ title: `A WILD ${rules.enemy.name.toUpperCase()} APPEARED!`, subtitle: "Choose your next move", bossName: rules.enemy.name, tierLabel: "LV 8" });
    this.hud.hideIntent(); this.hud.setTimer(null); this.hud.setBlooms(0);
    const sync = plants => {
      const plant = plants.find(p => p.plantId === (rules.activePlantId || this.selectedPlantId)) || (!rules.activePlantId ? plants[0] : null);
      if (!plant) return;
      rules.activePlantId = plant.plantId;
      rules.applyServerPlant(plant);
      this.activeId = plants.indexOf(plant) === 1 ? "B" : "A";
      this.placeTeam({ plant: this.activeId, team: { [this.activeId]: { state: "ready" } } });
      this.refreshLive();
    };
    sync(getAllPlants());
    const unsubscribe = subscribe(sync);
    this.events.once("shutdown", () => { unsubscribe(); this.rules = null; this.hud = null; this.hudSignature = null; });
    this.hud.setLog(rules.player ? `${rules.player.name}, choose a move.` : "Waiting for plant data from server…");
  }
  returnToForest() {
    if (!this.sys.isActive()) return;
    this.time.delayedCall(3400, () => this.registry.get("navigate")("/adventure"));
  }

  async awardWatering(plantId) {
    const battleId = this.rewardBattleId;
    if (getAllPlants().find(plant => plant.plantId === plantId)?.soilMoisture >= 100) {
      this.hud.resultLine.setText("Victory! Soil moisture is full.");
      this.hud.resultDetail.setText("No water added at 100% moisture.");
      this.returnToForest();
      return;
    }
    try {
      const reward = await requestWateringReward(plantId, battleId);
      if (!this.sys.isActive() || !this.hud || this.rewardBattleId !== battleId) return;
      this.hud.resultLine.setText(reward.increase > 0 ? "Simulated watering rewarded!" : "Soil moisture is full · no water added");
      this.hud.resultDetail.setText(
        `Soil moisture: ${Math.round(reward.previousSoilMoisture)}% → ${Math.round(reward.soilMoisture)}%\nThe server sends the new reading through WebSocket.`
      );
      this.sfx("victory_water", { durationMs: 1600 });
    } catch (error) {
      if (!this.sys.isActive() || !this.hud || this.rewardBattleId !== battleId) return;
      this.hud.resultLine.setText("Victory! Watering could not be confirmed.");
      this.hud.resultDetail.setText("The server could not confirm the simulated reward. Check the backend connection.");
      console.error("Simulated watering reward failed:", error);
    } finally {
      if (this.rewardBattleId === battleId) this.returnToForest();
    }
  }

  careEffect(effect, cue) {
    const rig = this.fighters[this.activeId];
    rig.play("channel");
    playBattleFx(effect, this.plantCtx(rig, 250, true));
    this.sfx(cue);
  }
  press(move) {
    if (!this.rules || this.rules.busy || this.rules.finished || !this.rules.player) return;
    const resourceBlocked = move === "attack" && (this.rules.player.water < 5 || this.rules.player.light < 4);
    this.sfx(resourceBlocked ? "ui_denied" : "ui_select");
    this.rules.useMove({ attack: "leaf", guard: "water", special: "sun", skill: "co2" }[move]);
    this.refreshLive();
  }
  refreshLive() {
    const r = this.rules;
    if (!r || !this.hud) return;
    const power = base => skillPower(r.player?.level, base);
    this.hud.setButtons(!!r.player && !r.busy && !r.finished, { name: "CO₂ Boost", ready: true }, `Next attack +${power(12)}`);
    this.hud.setMoveNames({ attack: "Leaf Flurry", guard: "Water", special: "Sunlight" });
    const descriptions = { attack: "5 water · 4 sunlight", guard: `+${power(9)} water · +${power(4)} HP`, special: `+${power(9)} sunlight · +${power(3)} HP`, skill: `Next Leaf Flurry +${power(12)}` };
    for (const [id, text] of Object.entries(descriptions)) this.hud.buttons[id].sub.setText(text);
    const signature = JSON.stringify([r.enemy.hp, r.player?.hp, r.player?.water]);
    if (signature === this.hudSignature) return;
    this.hudSignature = signature;
    this.hud.setBossHP(r.enemy.hp, r.enemy.maxHp);
    if (r.player) this.hud.setPlant({ name: r.player.name, hp: r.player.hp, max: r.player.maxHp, soil: r.player.water });
    const team = {};
    getAllPlants().slice(0, 2).forEach((plant, i) => {
      const id = i === 0 ? "A" : "B";
      team[id] = { name: plant.species, hp: id === this.activeId ? r.player.hp : plant.hp, max_hp: 100, state: id === this.activeId ? "fighting" : "ready" };
    });
    this.hud.setTeam(team, {});
  }
  update() {
    this.refreshLive();
    const r = this.rules;
    if (!r || !r.player || r.finished) return;
    const low = r.player.hp / r.player.maxHp < 0.3;
    if (low !== this.audioLow) { this.audioLow = low; this.audio("setHeartbeat", low); }
    const intensity = r.enemy.hp / r.enemy.maxHp < 0.3 ? 1 : 0.35;
    if (intensity !== this.audioIntensity) { this.audioIntensity = intensity; this.audio("setIntensity", intensity); }
    if (!r.busy && r.turn !== this.audioTurn) { this.audioTurn = r.turn; this.sfx("your_turn"); }
  }
}
