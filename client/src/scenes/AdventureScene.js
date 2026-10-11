import Phaser from "phaser";
import { paintEnchantedForest, addForestAmbience } from "../theme/enchantedForest.js";
import { createBossEntrance } from "../render/bossEntrance.js";
import { ensureDragonBackTexture } from "../render/dragonBack.js";
import { preloadBossArt } from "../data/bosses.js";
import { preloadPlantArt } from "../data/plants.js";
import { createPetParade } from "../render/petParade.js";
import { createCastShadow, outlineOfPicture } from "../render/castShadow.js";

export default class AdventureScene extends Phaser.Scene {
  constructor() {
    super("AdventureScene");
  }

  preload() {
    // The dragon: cut out of the original photo once, ahead of time (88 x 160 pixels)
    if (!this.textures.exists("plantHero")) this.load.image("plantHero", "/assets/characters/dragon.png");
    preloadBossArt(this);
    preloadPlantArt(this);
  }

  create() {
    this.walking = true;
    this.speed = 85;

    // Enchanted forest theme: paints the map layers (client/src/theme/enchantedForest.js)
    paintEnchantedForest(this);

    // SKY AND SUN
    this.sky = this.add.image(
      400,
      225,
      "autumnSky"
    );

    this.sky.setDepth(-10);

    // CLOUDS
    this.clouds = [];
    const cloudTypes = ["cloud1", "cloud2", "cloud3"];

    for (let i = 0; i < 7; i++) {
      const cloud = this.add.image(
        i * 160 + 35,
        65 + (i % 3) * 30,
        cloudTypes[i % 3]
      );

      cloud.setScale(0.8 + (i % 3) * 0.15);
      cloud.setAlpha(0.9);
      cloud.setDepth(-8);
      cloud.scrollSpeed = 4 + (i % 3) * 3;

      this.clouds.push(cloud);
    }

    // MOUNTAINS
    this.farMountains = this.add.tileSprite(
      400, 205, 800, 260, "farMountains"
    ).setDepth(1);

    this.nearMountains = this.add.tileSprite(
      400, 245, 800, 240, "nearMountains"
    ).setDepth(2);

    // FOREST
    this.farForest = this.add.tileSprite(
      400, 285, 800, 190, "farForest"
    ).setDepth(3);

    this.nearForest = this.add.tileSprite(
      400, 305, 800, 160, "nearForest"
    ).setDepth(4);

    // GROUND
    this.ground = this.add.tileSprite(
      400, 385, 800, 130, "ground"
    ).setDepth(5);

    // DECORATIONS
    this.decorations = [];

    const types = [
      "tree", "bush", "flower", "rock", "grass"
    ];

    for (let i = 0; i < 28; i++) {
      const type = types[i % types.length];

      const obj = this.add.image(
        i * 70,
        type === "tree" ? 340 : 335 + (i % 3) * 8,
        type
      );

      obj.setOrigin(0.5, 1);
      obj.setDepth(6);

      const scales = {
        tree: 1.5,
        bush: 1.0,
        flower: 0.85,
        rock: 0.9,
        grass: 0.85
      };

      obj.setScale(scales[type]);

      this.decorations.push({
        sprite: obj,
        type
      });
    }

    // CHARACTER SHADOW
    this.shadow = this.add.ellipse(
      190, 358,
      60, 11,
      0x1a1022,
      0.45
    ).setDepth(8);

    this.shadowBaseWidth = 60;
    this.shadowBaseHeight = 11;

    // The shadow the dragon throws: its own outline laid on the ground (render/castShadow.js)
    const dragonPicture = this.textures.get("plantHero").getSourceImage();
    this.castShadow = createCastShadow(this, outlineOfPicture(this, "plantHero"), { size: 115 / dragonPicture.height });
    this.castShadow.setPosition(190, 358).setDepth(8.1);

    // CHARACTER
    this.player = this.add.image(
      190, 360, "plantHero"
    );

    this.player.setOrigin(0.5, 1);
    this.player.setDepth(10);
    this.player.setFlipX(false);

    this.characterHeight = 115;

    this.player.setDisplaySize(
      this.characterHeight *
        this.player.width / this.player.height,
      this.characterHeight
    );

    this.baseWidth = this.player.displayWidth;
    this.baseHeight = this.player.displayHeight;
    this.basePlayerY = 360;

    // LEGS: the picture is cut at legCutY. Everything above it is the body,
    // everything below it is the left and right foot, which step in turns.
    // The body no longer includes the flat legs, only the moving feet are drawn there.
    const legCutY = 0.78;
    const frameW = this.player.width;
    const frameH = this.player.height;
    this.player.setCrop(0, 0, frameW, frameH * legCutY);

    // The two feet overlap a little in the middle so there is never a see-through seam
    const seamOverlap = frameW * 0.03;

    // Where the feet are cut apart: the middle of the black gap between the legs.
    // That is a bit right of the picture's centre (column 51 of 88).
    const splitX = frameW * 0.58;

    const makeFoot = (cropX, cropW) => {
      const foot = this.add.image(
        this.player.x, this.basePlayerY, "plantHero"
      );
      foot.setOrigin(0.5, 1);
      foot.setDepth(9);
      foot.setDisplaySize(this.baseWidth, this.baseHeight);
      foot.setCrop(cropX, frameH * legCutY, cropW, frameH * (1 - legCutY));
      return foot;
    };

    this.footL = makeFoot(0, splitX + seamOverlap);
    this.footR = makeFoot(splitX - seamOverlap, frameW - (splitX - seamOverlap));

    // UI

    this.add.text(20, 13, "PLANT CARE RPG", {
      fontFamily: "monospace",
      fontSize: "22px",
      color: "#fff5df",
      stroke: "#593a31",
      strokeThickness: 4
    }).setDepth(21);

    this.statusText = this.add.text(
      570, 19, "EXPLORING...", {
        fontFamily: "monospace",
        fontSize: "27px",
        color: "#ffe4a0"
      }
    ).setDepth(21);

    // Fireflies, drifting petals and a soft vignette
    addForestAmbience(this);

    // The two plants hop along behind the dragon (client/src/render/petParade.js)
    this.pets = createPetParade(this, this.basePlayerY - 2);

    // Boss arrival (client/src/render/bossEntrance.js) and the cut to the battle screen.
    // The plants react to each step of it.
    this.entrance = createBossEntrance(this, (step, state) => {
      if (step === "reset") this.pets.reset(state);
      else this.pets.onEntrance(step, state);
    });
    this.lastServerMode = null;
    this.inBattleScene = false;
    this.cutting = false;

    // The battle screen stops itself and wakes this scene when the fight is over.
    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      this.inBattleScene = false;
      this.cutting = false;
      this.entrance.cleanup();
      this.cameras.main.fadeIn(450, 7, 5, 26);
      // back from a won fight: the plants celebrate while the reward is on screen
      const state = this.registry.get("serverState");
      if (state && state.mode === "reward") this.pets.celebrate();
    });
  }

  // Leave the forest for the battle screen. This scene sleeps, so nothing here is rebuilt.
  cutToBattle(instant = false) {
    if (this.cutting || this.inBattleScene) return;
    this.cutting = true;

    const go = () => {
      // The boss can leave during the flashes (wet soil, sensor lost). Then stay in the forest.
      const state = this.registry.get("serverState");
      if (!state || state.mode !== "battle") {
        this.cutting = false;
        this.entrance.cancel();
        this.cameras.main.fadeIn(300, 7, 5, 26);
        return;
      }
      ensureDragonBackTexture(this);
      this.inBattleScene = true;
      this.scene.launch("BossScene");
      this.scene.sleep();
    };
    if (instant) return go();

    const cam = this.cameras.main;
    cam.flash(110, 255, 255, 255);
    this.time.delayedCall(170, () => cam.flash(110, 255, 255, 255));
    this.time.delayedCall(340, () => {
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
      cam.fade(260, 7, 5, 26);
    });
  }

  // ==========================================
  // CHARACTER WALKING ANIMATION
  // ==========================================

  animateCharacter(time) {
    if (!this.walking) return;

    const step = Math.sin(time * 0.012);
    const bounce = Math.abs(step);

    // Character walking animation
    this.player.y = this.basePlayerY - bounce * 4;

    this.player.setDisplaySize(
      this.baseWidth * (1 + bounce * 0.025),
      this.baseHeight * (1 - bounce * 0.015)
    );

    this.player.rotation = step * 0.025;

    // Feet follow the body and stay side by side, only a very small up and down step in turns
    const stepLift = 5;

    for (const foot of [this.footL, this.footR]) {
      foot.setDisplaySize(
        this.player.displayWidth,
        this.player.displayHeight
      );
    }

    this.footL.x = this.player.x;
    this.footL.y = this.player.y - Math.max(0, step) * stepLift;
    this.footR.x = this.player.x;
    this.footR.y = this.player.y - Math.max(0, -step) * stepLift;

    // Shadow stays on the ground
    this.shadow.setPosition(
      this.player.x,
      this.basePlayerY - 2
    );

    // Shadow becomes slightly smaller when character rises
    this.shadow.setDisplaySize(
      this.shadowBaseWidth * (1 - bounce * 0.18),
      this.shadowBaseHeight * (1 - bounce * 0.12)
    );

    // Shadow becomes lighter when character rises
    this.shadow.setAlpha(
      0.45 - bounce * 0.14
    );
  }

  // ==========================================
  // GAME LOOP
  // ==========================================

  // Server modes where the dragon stands still: boss appears, fights, and the reward moment.
  syncWithServer() {
    const state = this.registry.get("serverState");
    const mode = state ? state.mode : null;

    if (mode !== this.lastServerMode) {
      const was = this.lastServerMode;
      this.lastServerMode = mode;
      if (mode === "boss" && was !== "boss") {
        this.entrance.start(state);
      } else if (mode !== "battle" && this.entrance.isActive() && !this.cutting) {
        // the boss left before the fight started (the soil got wet, or the sensor dropped out)
        this.entrance.cancel();
      }
    }
    if (mode === "battle" && !this.inBattleScene && !this.cutting) {
      // Page opened mid-fight: go straight in. Otherwise wait for the arrival to finish.
      if (!this.entrance.isActive()) this.cutToBattle(true);
      else if (this.entrance.isDone()) this.cutToBattle();
    }

    const stand = state && ["boss", "battle", "reward"].includes(state.mode);
    const shouldWalk = !stand;

    if (shouldWalk === this.walking) return;
    this.walking = shouldWalk;

    if (!this.walking) this.standStill();
  }

  // Reset the step bounce so the dragon stops in a neutral pose.
  standStill() {
    this.player.y = this.basePlayerY;
    this.player.setDisplaySize(this.baseWidth, this.baseHeight);
    this.player.rotation = 0;

    this.footL.setPosition(this.player.x, this.basePlayerY);
    this.footR.setPosition(this.player.x, this.basePlayerY);

    this.shadow.setPosition(this.player.x, this.basePlayerY - 2);
    this.shadow.setDisplaySize(this.shadowBaseWidth, this.shadowBaseHeight);
    this.shadow.setAlpha(0.45);
  }

  update(time, delta) {
    this.syncWithServer();
    this.pets.update(time, delta, this.walking, this.registry.get("serverState"));
    // the dragon's shadow goes where it goes, and hides when the boss arrival hides the dragon
    this.castShadow.setPosition(this.player.x, this.basePlayerY - 2).setVisible(this.shadow.visible);

    if (!this.walking) return;

    const dt = Math.min(delta / 1000, 0.05);

    // MOUNTAINS
    this.farMountains.tilePositionX += 6 * dt;
    this.nearMountains.tilePositionX += 15 * dt;

    // FOREST
    this.farForest.tilePositionX += 25 * dt;
    this.nearForest.tilePositionX += 45 * dt;

    // GROUND
    this.ground.tilePositionX += this.speed * dt;

    // CLOUDS
    for (const cloud of this.clouds) {
      cloud.x -= cloud.scrollSpeed * dt;

      if (cloud.x < -120) {
        cloud.x += this.clouds.length * 175;
      }
    }

    // DECORATIONS
    for (const item of this.decorations) {
      item.sprite.x -= this.speed * dt;

      if (item.sprite.x < -120) {
        item.sprite.x += this.decorations.length * 70;
      }
    }

    // CHARACTER
    this.animateCharacter(time);
  }
}
