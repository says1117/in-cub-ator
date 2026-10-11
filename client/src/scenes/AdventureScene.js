import Phaser from "phaser";
import { paintEnchantedForest, addForestAmbience } from "../theme/enchantedForest.js";
import { createBossEntrance } from "../render/bossEntrance.js";
import { preloadHeroArt, ensureHeroTexture, setHeroWalking, setHeroMood, HERO_BODY_SHARE } from "../render/heroSprite.js";
import { preloadBossArt } from "../data/bosses.js";
import { preloadPlantArt } from "../data/plants.js";
import { createPetParade } from "../render/petParade.js";
import { createCastShadow, outlineOfPicture } from "../render/castShadow.js";
import { audio } from "../audio.js";

export default class AdventureScene extends Phaser.Scene {
  constructor() {
    super("AdventureScene");
  }

  preload() {
    preloadHeroArt(this);
    preloadBossArt(this);
    preloadPlantArt(this);
  }

  create() {
    audio.music("forest");
    this.walking = true;
    this.speed = 85;

    this.createTextures();
    // Enchanted forest theme: repaints the map layers (client/src/theme/enchantedForest.js)
    paintEnchantedForest(this);
    this.createCharacterTexture();

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
    this.castShadow = createCastShadow(this, outlineOfPicture(this, "plantHero"), { size: Math.round(128 / HERO_BODY_SHARE) / dragonPicture.height });
    this.castShadow.setPosition(190, 358).setDepth(8.1);

    // CHARACTER
    this.player = this.add.image(
      190, 360, "plantHero"
    );

    this.player.setOrigin(0.5, 1);
    this.player.setDepth(10);
    this.player.setFlipX(false);

    this.characterHeight = Math.round(128 / HERO_BODY_SHARE);   // the dragon stands 128 tall; its picture is taller, with room above for it to fly up into

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
    // The dragon steps with its own legs inside its picture (render/heroSprite.js), so nothing is cut
    // off for the feet any more: the two foot pictures are empty and only kept for the code that moves them.
    const legCutY = 1;
    const frameW = this.player.width;
    const frameH = this.player.height;
    this.player.setCrop(0, 0, frameW, frameH * legCutY);

    // The two feet overlap a little in the middle so there is never a see-through seam
    const seamOverlap = frameW * 0.03;

    // Where the feet are cut apart: the middle of the black gap between the legs.
    // That is a bit right of the picture's centre (column 51 of 88).
    const splitX = frameW * 0.5;

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
      ensureHeroTexture(this);
      this.inBattleScene = true;
      this.scene.launch("BossScene");
      this.scene.sleep();
    };
    if (instant) return go();

    const cam = this.cameras.main;
    cam.flash(110, 255, 255, 255);
    audio.play("cut");
    this.time.delayedCall(170, () => cam.flash(110, 255, 255, 255));
    this.time.delayedCall(340, () => {
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
      cam.fade(260, 7, 5, 26);
    });
  }

  // ==========================================
  // CHARACTER PHOTO PROCESSING
  // ==========================================

  // The dragon: a moving picture made every frame from its cut-out layers (render/heroSprite.js).
  createCharacterTexture() {
    ensureHeroTexture(this);
    setHeroMood(null);   // back from a fight: it chooses its own face again
  }

  // ==========================================
  // CREATE ALL TEXTURES
  // ==========================================

  createTextures() {
    this.createSkyTexture(); 
    this.createCloudTextures();

    this.createMountainTexture("farMountains", true);
    this.createMountainTexture("nearMountains", false);

    this.createForestTextures();
    this.createGroundTexture();
    this.createTreeTexture();
    this.createDecorationTextures();
  }

  // ==========================================
  // DETAILED PIXEL ART AUTUMN SKY
  // ==========================================

  createSkyTexture() {
    const W = 800;
    const H = 450;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const rng = new Phaser.Math.RandomDataGenerator([
      "autumn-sky"
    ]);

    const pixel = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };

    // ======================================
    // 1. SKY GRADIENT
    // ======================================

    const gradient = ctx.createLinearGradient(
      0, 0, 0, H
    );

    gradient.addColorStop(0.00, "#5f94c1");
    gradient.addColorStop(0.22, "#84b7d5");
    gradient.addColorStop(0.45, "#b7d4db");
    gradient.addColorStop(0.65, "#f0c69d");
    gradient.addColorStop(0.85, "#f4ae79");
    gradient.addColorStop(1.00, "#e88d65");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    // ======================================
    // 2. SUBTLE PIXEL COLOR VARIATIONS
    // ======================================

    for (let i = 0; i < 300; i++) {
      const x = rng.between(0, W - 12);
      const y = rng.between(40, 350);

      ctx.globalAlpha = rng.realInRange(0.03, 0.09);

      pixel(
        x, y,
        rng.between(4, 12),
        rng.between(2, 4),
        i % 2 === 0 ? "#ffffff" : "#f8d9b3"
      );
    }

    ctx.globalAlpha = 1;

    // ======================================
    // 3. ATMOSPHERIC HAZE
    // ======================================

    for (let i = 0; i < 35; i++) {
      const y = rng.between(230, 390);
      const x = rng.between(0, W - 100);

      ctx.globalAlpha = 0.10;

      pixel(
        x, y,
        rng.between(80, 200),
        rng.between(2, 5),
        "#fff0d1"
      );
    }

    ctx.globalAlpha = 1;

    // ======================================
    // 4. DISTANT CLOUD STREAKS
    // ======================================

    for (let i = 0; i < 16; i++) {
      const x = rng.between(0, W - 100);
      const y = rng.between(90, 300);
      const width = rng.between(40, 110);

      ctx.globalAlpha = 0.28;

      pixel(x, y, width, 3, "#fff0dc");
      pixel(x + 12, y - 3, width - 20, 3, "#fff7e9");
      pixel(x + 20, y + 3, width - 35, 2, "#e7bda7");
    }

    ctx.globalAlpha = 1;

    // ======================================
    // 5. SUN GLOW
    // ======================================

    const sunX = 660;
    const sunY = 85;

    const glow = ctx.createRadialGradient(
      sunX, sunY, 15,
      sunX, sunY, 145
    );

    glow.addColorStop(0, "rgba(255,245,190,0.55)");
    glow.addColorStop(0.4, "rgba(255,220,155,0.22)");
    glow.addColorStop(1, "rgba(255,220,155,0)");

    ctx.fillStyle = glow;
    ctx.fillRect(
      sunX - 145,
      sunY - 145,
      290,
      290
    );

    // ======================================
    // 6. PIXEL-ART SUN
    // ======================================

    const drawPixelCircle = (cx, cy, radius, color) => {
      const size = 4;

      for (
        let y = -radius;
        y <= radius;
        y += size
      ) {
        for (
          let x = -radius;
          x <= radius;
          x += size
        ) {
          if (x * x + y * y <= radius * radius) {
            pixel(
              cx + x,
              cy + y,
              size,
              size,
              color
            );
          }
        }
      }
    };

    drawPixelCircle(
      sunX, sunY, 32, "#f9d985"
    );

    drawPixelCircle(
      sunX, sunY, 26, "#ffe9a5"
    );

    drawPixelCircle(
      sunX - 4, sunY - 4, 17, "#fff2c2"
    );

    // ======================================
    // 7. SMALL LIGHT PARTICLES
    // ======================================

    for (let i = 0; i < 40; i++) {
      const x = rng.between(0, W - 4);
      const y = rng.between(60, 280);

      ctx.globalAlpha = 0.2;

      pixel(
        x, y,
        2, 2,
        "#fff4dc"
      );
    }

    ctx.globalAlpha = 1;

    // ======================================
    // REGISTER SKY TEXTURE
    // ======================================

    this.textures.addCanvas("autumnSky", canvas);
  }

  // ==========================================
  // CLOUDS
  // ==========================================

  createCloudTextures() {
    const drawCloud = (key, width, height, seed) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");

      const rng = new Phaser.Math.RandomDataGenerator([
        String(seed)
      ]);

      const block = 4;

      const clusters = [
        [0.18, 0.62, 0.19, 0.23],
        [0.34, 0.42, 0.23, 0.34],
        [0.52, 0.32, 0.25, 0.37],
        [0.70, 0.46, 0.23, 0.30],
        [0.84, 0.65, 0.15, 0.19]
      ];

      const variations = clusters.map(c => ({
        x: c[0] + rng.realInRange(-0.035, 0.035),
        y: c[1] + rng.realInRange(-0.045, 0.045),
        rx: c[2],
        ry: c[3]
      }));

      for (let y = 0; y < height; y += block) {
        for (let x = 0; x < width; x += block) {
          const nx = (x + block / 2) / width;
          const ny = (y + block / 2) / height;

          const inside = variations.some(c => {
            const dx = (nx - c.x) / c.rx;
            const dy = (ny - c.y) / c.ry;

            return dx * dx + dy * dy < 1;
          });

          if (!inside) continue;

          ctx.fillStyle =
            ny > 0.72 ? "#9ebed4" :
            ny > 0.58 ? "#c6dce9" :
            ny > 0.43 ? "#e4eff6" :
            "#ffffff";

          ctx.fillRect(x, y, block, block);
        }
      }

      this.textures.addCanvas(key, canvas);
    };

    drawCloud("cloud1", 120, 64, 12);
    drawCloud("cloud2", 160, 72, 28);
    drawCloud("cloud3", 96, 56, 45);
  }

  // ==========================================
  // DETAILED AUTUMN MOUNTAINS
  // ==========================================

  createMountainTexture(key, isFar) {
    const width = 800;
    const height = 260;
    const block = 4;

    const cols = width / block;
    const rows = height / block;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    const rng = new Phaser.Math.RandomDataGenerator([key]);

    const colors = isFar
      ? {
          base: "#9eb8c9",
          light: "#c6d8e2",
          shadow: "#789bad",
          dark: "#668a9e",
          snow: "#eaf2f4",
          snowShadow: "#d2e3e9",
          detail: "#87a8b9"
        }
      : {
          base: "#ba783e",
          light: "#e5b75e",
          shadow: "#a45438",
          dark: "#783e36",
          snow: "#f6d78d",
          snowShadow: "#d89c63",
          detail: "#bb693a"
        };

    const pixel = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(
        x * block,
        y * block,
        w * block,
        h * block
      );
    };

    const peaks = isFar
      ? [
          { x: 35, height: 39, width: 30 },
          { x: 105, height: 49, width: 38 },
          { x: 170, height: 35, width: 31 }
        ]
      : [
          { x: 28, height: 43, width: 35 },
          { x: 95, height: 53, width: 42 },
          { x: 165, height: 46, width: 38 }
        ];

    const heights = [];

    for (let x = 0; x < cols; x++) {
      let mountainHeight = isFar ? 13 : 17;

      for (const peak of peaks) {
        const d = Math.abs(x - peak.x);
        const distance = Math.min(d, cols - d);

        mountainHeight = Math.max(
          mountainHeight,
          12 +
            Math.max(0, 1 - distance / peak.width) *
            peak.height
        );
      }

      const roughness =
        Math.sin(x * 0.17) * 2.5 +
        Math.sin(x * 0.39) * 1.2 +
        Math.sin(x * 0.73) * 0.7;

      heights.push(
        Phaser.Math.Clamp(
          Math.round(rows - mountainHeight - roughness),
          0,
          rows - 1
        )
      );
    }

    // MOUNTAIN SURFACE
    for (let x = 0; x < cols; x++) {
      const top = heights[x];

      const slope =
        heights[(x + 1) % cols] -
        heights[(x - 1 + cols) % cols];

      for (let y = top; y < rows; y++) {
        let color =
          slope > 1 ? colors.shadow :
          slope < -1 ? colors.light :
          colors.base;

        if (y > top + 24) {
          color = colors.shadow;
        }

        const pattern =
          Math.sin(x * 0.53 + y * 0.19) +
          Math.sin(x * 0.23 - y * 0.47);

        if (pattern > 1.25) {
          color = colors.light;
        } else if (pattern < -1.3) {
          color = colors.dark;
        }

        pixel(x, y, 1, 1, color);
      }

      // PEAK HIGHLIGHTS
      if (top < (isFar ? 35 : 25)) {
        const snowDepth = isFar ? 8 : 4;

        for (
          let y = top;
          y < Math.min(rows, top + snowDepth);
          y++
        ) {
          const irregular =
            Math.sin(x * 0.65) * 2 +
            Math.sin(x * 0.23) * 2;

          if (
            y - top <= snowDepth / 2 + irregular
          ) {
            pixel(
              x, y, 1, 1,
              x % 5 < 3
                ? colors.snow
                : colors.snowShadow
            );
          }
        }
      }
    }

    // ROCK DETAILS
    for (let i = 0; i < (isFar ? 90 : 180); i++) {
      const x = rng.between(0, cols - 1);

      const y = rng.between(
        Math.min(rows - 1, heights[x] + 8),
        rows - 1
      );

      pixel(
        x, y,
        Math.min(rng.between(2, 7), cols - x),
        1,
        i % 3 === 0 ? colors.light : colors.detail
      );

      if (i % 4 === 0) {
        pixel(
          x, y, 1,
          rng.between(2, 4),
          colors.dark
        );
      }
    }

    // AUTUMN VEGETATION
    if (!isFar) {
      for (let i = 0; i < 90; i++) {
        const x = rng.between(0, cols - 1);

        const y = rng.between(
          Math.min(rows - 1, heights[x] + 12),
          rows - 1
        );

        pixel(x, y, 3, 1, "#c7753e");
        pixel(x + 1, y - 1, 1, 1, "#f1c66a");

        if (i % 6 === 0) {
          pixel(x, y - 2, 4, 2, "#974a36");
          pixel(x + 1, y - 3, 2, 1, "#e6a34c");
        }
      }
    }

    this.textures.addCanvas(key, canvas);
  }

  // ==========================================
  // DETAILED AUTUMN FOREST
  // ==========================================

  createForestTextures() {
    const W = 512;

    const makeCanvas = (key, height, draw) => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;

      const p = (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(
          Math.floor(x),
          Math.floor(y),
          Math.ceil(w),
          Math.ceil(h)
        );
      };

      draw(p);
      this.textures.addCanvas(key, canvas);
    };

    // ==========================================
    // FAR FOREST
    // ==========================================

    makeCanvas("farForest", 190, (p) => {
      const rng = new Phaser.Math.RandomDataGenerator([
        "far-forest"
      ]);

      const colors = {
        mist: "#dfc58c",
        hill: "#c99a60",
        hillDark: "#b47a4e",
        pineDark: "#9b603f",
        pineMid: "#bc7b48",
        pineLight: "#dda35e",
        trunk: "#8c624d"
      };

      // Rolling hills
      for (let x = 0; x < W; x += 2) {
        const hillY =
          125 +
          Math.sin(x * Math.PI * 2 / W) * 12 +
          Math.sin(x * Math.PI * 6 / W) * 5;

        p(x, hillY, 2, 190 - hillY, colors.hill);
      }

      // Hill shadows
      for (let x = 0; x < W; x += 4) {
        const y =
          148 +
          Math.sin(x * Math.PI * 2 / W) * 9;

        p(x, y, 4, 190 - y, colors.hillDark);
      }

      // Back row of pine trees
      for (let i = 0; i < 27; i++) {
        const x = i * 20;
        const h = rng.between(45, 80);
        const baseY = 178;
        const topY = baseY - h;

        p(
          x + 8,
          topY + 18,
          4,
          h - 10,
          colors.trunk
        );

        for (let layer = 0; layer < 4; layer++) {
          const y = topY + layer * 14;
          const halfWidth = 7 + layer * 5;

          for (let row = 0; row < 14; row += 3) {
            const width = Math.floor(
              halfWidth * (row / 14)
            );

            p(
              x + 10 - width,
              y + row,
              width * 2 + 2,
              3,
              layer % 2 === 0
                ? colors.pineLight
                : colors.pineMid
            );
          }
        }
      }

      // Foreground pine silhouettes
      for (let i = 0; i < 22; i++) {
        const x = i * 24 + 8;
        const h = rng.between(65, 105);
        const top = 190 - h;

        p(
          x + 8,
          top + 20,
          5,
          h - 18,
          colors.trunk
        );

        for (let row = 0; row < h - 15; row += 4) {
          const t = row / (h - 15);
          const half = Math.floor(2 + t * 17);

          p(
            x + 10 - half,
            top + row,
            half * 2,
            4,
            row % 12 === 0
              ? colors.pineMid
              : colors.pineDark
          );
        }

        p(
          x + 10,
          top + 22,
          3,
          18,
          colors.pineLight
        );
      }

      // Autumn haze
      for (let i = 0; i < 90; i++) {
        const x = rng.between(0, W - 8);
        const y = rng.between(150, 187);

        p(
          x, y,
          rng.between(3, 10),
          2,
          colors.mist
        );
      }
    });

    // ==========================================
    // NEAR FOREST
    // ==========================================

    makeCanvas("nearForest", 160, (p) => {
      const rng = new Phaser.Math.RandomDataGenerator([
        "near-forest"
      ]);

      const colors = {
        trunkOutline: "#51382f",
        trunkDark: "#654b35",
        trunk: "#8a6444",
        barkLight: "#ae8156",

        leafOutline: "#62332e",
        leafDark: "#8f4135",
        leafShadow: "#ac5039",
        leafMid: "#cc703e",
        leafLight: "#e9a44e",
        leafHighlight: "#f6cf76",

        undergrowth: "#a05a39",
        undergrowthLight: "#d49349"
      };

      // ==========================================
      // DENSE FOREST BACKGROUND
      // Fills gaps between tree trunks
      // ==========================================

      p(0, 70, W, 90, "#793e34");
      p(0, 95, W, 65, "#a14e36");

      // Background bushes
      for (let x = 0; x < W; x += 20) {
        const top = rng.between(70, 100);
        const bushWidth = rng.between(22, 34);

        p(
          x - 4,
          top,
          bushWidth + 8,
          160 - top,
          "#70382f"
        );

        p(
          x,
          top + 5,
          bushWidth,
          160 - top - 5,
          "#b65c3a"
        );

        p(x + 3, top + 8, 12, 9, "#d17a42");
        p(x + 12, top + 17, 10, 7, "#e5a451");
        p(x + 6, top + 7, 6, 3, "#f2c66d");
      }

      // Lower foliage
      p(0, 130, W, 30, "#944b35");

      for (let i = 0; i < 180; i++) {
        const x = rng.between(0, W - 5);
        const y = rng.between(95, 157);

        p(
          x, y,
          rng.between(2, 5),
          rng.between(2, 4),
          i % 2 === 0 ? "#d98545" : "#793c32"
        );
      }

      // ==========================================
      // FOLIAGE HELPER
      // ==========================================

      const foliage = (cx, cy, radius) => {
        const r = radius;

        // Outer outline
        p(cx - r + 6, cy - r, r * 2 - 12, 7,
          colors.leafOutline);

        p(cx - r, cy - r + 7, r * 2, r,
          colors.leafOutline);

        p(cx - r + 4, cy + 7, r * 2 - 8, r - 5,
          colors.leafOutline);

        // Dark foliage
        p(cx - r + 5, cy - r + 5, r * 2 - 10, r + 5,
          colors.leafDark);

        p(cx - r + 8, cy + 5, r * 2 - 16, r - 5,
          colors.leafShadow);

        // Orange foliage
        p(cx - r + 8, cy - r + 10, r, 15,
          colors.leafMid);

        p(cx - 4, cy - r + 7, r - 3, 18,
          colors.leafMid);

        p(cx - r + 12, cy + 2, r - 4, 12,
          colors.leafMid);

        // Golden highlights
        p(cx - r + 11, cy - r + 9, 12, 5,
          colors.leafLight);

        p(cx - r + 16, cy - r + 6, 9, 4,
          colors.leafHighlight);

        p(cx + 3, cy - r + 13, 12, 5,
          colors.leafLight);

        // Leaf details
        for (let i = 0; i < 12; i++) {
          const dx = rng.between(-r + 10, r - 10);
          const dy = rng.between(-r + 12, r - 4);

          p(
            cx + dx,
            cy + dy,
            3,
            2,
            i % 3 === 0
              ? colors.leafHighlight
              : colors.leafLight
          );
        }
      };

      // ==========================================
      // TREE TRUNKS
      // ==========================================

      for (let i = 0; i < 11; i++) {
        const x = i * 49 + 14;
        const trunkWidth = rng.between(9, 14);
        const top = rng.between(42, 65);

        p(
          x - 2,
          top,
          trunkWidth + 4,
          160 - top,
          colors.trunkOutline
        );

        p(
          x,
          top,
          trunkWidth,
          160 - top,
          colors.trunk
        );

        // Bark shadow
        p(
          x + trunkWidth - 4,
          top + 5,
          3,
          160 - top - 5,
          colors.trunkDark
        );

        // Bark highlight
        p(
          x + 2,
          top + 8,
          2,
          35,
          colors.barkLight
        );

        // Bark cracks
        for (let j = 0; j < 5; j++) {
          const by = top + 20 + j * 18;

          p(x + 4, by, 4, 2, colors.trunkDark);
          p(x + 6, by + 2, 2, 5, colors.trunkDark);
        }

        // Branches
        p(
          x - 13,
          top + 17,
          17,
          5,
          colors.trunkOutline
        );

        p(
          x - 11,
          top + 18,
          14,
          3,
          colors.trunk
        );

        p(
          x + trunkWidth - 2,
          top + 24,
          18,
          5,
          colors.trunkOutline
        );

        p(
          x + trunkWidth,
          top + 25,
          15,
          3,
          colors.trunk
        );
      }

      // ==========================================
      // TREE CANOPIES
      // ==========================================

      for (let i = 0; i < 11; i++) {
        const x = i * 49 + 20;
        const y = rng.between(40, 60);
        const radius = rng.between(27, 34);

        foliage(x - 13, y + 8, radius - 7);
        foliage(x + 13, y + 5, radius - 6);
        foliage(x, y - 9, radius);
      }

      // ==========================================
      // UNDERGROWTH
      // ==========================================

      p(0, 145, W, 15, colors.undergrowth);

      for (let i = 0; i < 100; i++) {
        const x = rng.between(0, W - 7);
        const y = rng.between(135, 157);

        p(
          x, y,
          rng.between(3, 8),
          rng.between(2, 5),
          i % 2 === 0
            ? colors.undergrowthLight
            : colors.leafDark
        );
      }

      // Golden grass tufts
      for (let x = 5; x < W; x += 17) {
        const y = rng.between(143, 153);

        p(x, y, 2, 7, colors.leafDark);
        p(x + 3, y - 4, 2, 11, colors.leafLight);
        p(x + 6, y + 1, 2, 6, colors.undergrowth);
      }
    });
  }

  // ==========================================
  // DETAILED AUTUMN GROUND
  // ==========================================

  createGroundTexture() {
    const width = 512;
    const height = 130;
    const block = 2;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");

    const rng = new Phaser.Math.RandomDataGenerator([
      "forest-ground"
    ]);

    const pixel = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };

    const c = {
      grass: "#c58b43",
      grassLight: "#e9bb62",
      grassDark: "#a96a38",
      grassShadow: "#844b32",

      dirt: "#c9a071",
      dirtLight: "#e2bd89",
      dirtDark: "#a77d52",
      dirtShadow: "#8c6848",

      stone: "#8d9380",
      stoneLight: "#c3c5a5"
    };

    // GOLDEN GRASS BASE
    pixel(0, 0, width, height, c.grass);

    for (let i = 0; i < 700; i++) {
      pixel(
        rng.between(0, width - 6),
        rng.between(0, height - 3),
        rng.between(2, 6),
        rng.between(2, 4),
        i % 3 === 0 ? c.grassLight : c.grassDark
      );
    }

    // IRREGULAR DIRT PATH
    const pathEdge = [];

    for (let x = 0; x < width; x += block) {
      const wave =
        Math.sin(x * Math.PI * 2 / width) * 4 +
        Math.sin(x * Math.PI * 8 / width) * 2 +
        Math.sin(x * Math.PI * 16 / width);

      const edge = Math.round(37 + wave);
      pathEdge.push(edge);

      pixel(x, edge, block, height - edge, c.dirt);
      pixel(x, edge, block, 3, c.dirtShadow);
      pixel(x, edge + 3, block, 3, c.dirtDark);
    }

    // DIRT TEXTURE
    for (let i = 0; i < 900; i++) {
      const x = rng.between(0, width - 7);
      const y = rng.between(42, height - 4);

      if (
        y < pathEdge[Math.floor(x / block)] + 6
      ) continue;

      const color =
        i % 4 === 0 ? c.dirtLight :
        i % 4 === 1 ? c.dirtDark :
        c.dirt;

      pixel(
        x, y,
        rng.between(2, 7),
        rng.between(1, 3),
        color
      );
    }

    // SOIL PATCHES
    for (let i = 0; i < 35; i++) {
      const x = rng.between(5, width - 18);
      const y = rng.between(55, height - 12);

      pixel(x, y, 12, 3, c.dirtDark);
      pixel(x + 3, y - 2, 7, 2, c.dirtDark);
      pixel(x + 2, y + 3, 9, 2, c.dirtLight);
    }

    // PEBBLES
    for (let i = 0; i < 55; i++) {
      const x = rng.between(5, width - 10);
      const y = rng.between(47, height - 7);

      if (
        y < pathEdge[Math.floor(x / block)] + 5
      ) continue;

      pixel(x, y + 3, 7, 2, c.dirtDark);
      pixel(x + 1, y, 6, 4, c.stone);
      pixel(x + 2, y, 3, 2, c.stoneLight);
    }

    // GRASS BLADES
    for (let i = 0; i < 170; i++) {
      const x = rng.between(0, width - 9);
      const edge = pathEdge[Math.floor(x / block)];

      const y = rng.between(
        8,
        Math.max(8, edge - 6)
      );

      pixel(x, y + 3, 7, 2, c.grassDark);
      pixel(x + 1, y, 2, 5, c.grassShadow);
      pixel(x + 4, y - 2, 2, 7, c.grassLight);
      pixel(x + 7, y + 1, 2, 4, c.grassDark);
    }

    // ROAD EDGE GRASS
    for (let x = 0; x < width - 10; x += 14) {
      const edge = pathEdge[Math.floor(x / block)];

      pixel(x, edge - 5, 3, 6, c.grassDark);
      pixel(x + 4, edge - 8, 3, 9, c.grassLight);
      pixel(x + 8, edge - 4, 3, 5, c.grassShadow);
    }

    // FOOTPRINTS
    for (let i = 0; i < 7; i++) {
      const x = i * 65 + 20;
      const y = 85 + (i % 2) * 15;

      pixel(x, y, 5, 8, "#b68d60");
      pixel(x + 3, y - 3, 4, 4, "#b68d60");
      pixel(x + 10, y + 8, 5, 8, "#b68d60");
    }

    this.textures.addCanvas("ground", canvas);
  }

  // ==========================================
  // DETAILED AUTUMN TREE
  // ==========================================

  createTreeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 100;

    const ctx = canvas.getContext("2d");

    const pixel = (x, y, w, h, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
    };

    const outline = "#542f2d";
    const darkGreen = "#843b35";
    const shadowGreen = "#aa4d38";
    const middleGreen = "#cc713d";
    const lightGreen = "#e9a34e";
    const highlightGreen = "#f6d074";

    // TRUNK
    pixel(13, 93, 38, 4, "#956039");
    pixel(18, 97, 28, 2, "#b37b42");

    pixel(27, 51, 13, 44, outline);
    pixel(29, 52, 9, 41, "#765035");
    pixel(30, 55, 3, 29, "#a77b4d");
    pixel(35, 61, 2, 25, "#543a2d");

    pixel(31, 65, 2, 6, "#c0935e");
    pixel(35, 77, 2, 7, "#483226");
    pixel(30, 85, 3, 4, "#936b43");

    // BRANCHES
    pixel(20, 58, 12, 5, outline);
    pixel(23, 60, 10, 3, "#765035");
    pixel(36, 54, 12, 5, outline);
    pixel(36, 56, 10, 3, "#765035");

    const drawBlocks = (blocks, color) => {
      for (const [x, y, w, h] of blocks) {
        pixel(x, y, w, h, color);
      }
    };

    // CANOPY OUTLINE
    drawBlocks([
      [20, 5, 24, 5],
      [12, 10, 40, 6],
      [7, 16, 50, 7],
      [3, 23, 58, 24],
      [0, 30, 64, 19],
      [4, 49, 56, 10],
      [10, 59, 45, 8],
      [17, 67, 32, 5]
    ], outline);

    // DARK RED FOLIAGE
    drawBlocks([
      [21, 8, 22, 5],
      [14, 13, 37, 8],
      [9, 20, 47, 8],
      [5, 28, 54, 18],
      [8, 46, 49, 10],
      [14, 56, 38, 9],
      [21, 65, 25, 4]
    ], darkGreen);

    // SHADOW CLUSTERS
    drawBlocks([
      [14, 18, 18, 15],
      [31, 14, 19, 17],
      [7, 32, 22, 17],
      [25, 27, 24, 22],
      [42, 30, 16, 17],
      [17, 45, 20, 15],
      [34, 46, 17, 13]
    ], shadowGreen);

    // ORANGE FOLIAGE
    drawBlocks([
      [17, 15, 16, 12],
      [34, 17, 14, 13],
      [11, 33, 17, 12],
      [28, 29, 20, 15],
      [43, 34, 11, 10],
      [19, 47, 14, 10],
      [36, 46, 11, 8]
    ], middleGreen);

    // GOLDEN FOLIAGE
    drawBlocks([
      [20, 14, 10, 6],
      [35, 18, 10, 6],
      [13, 33, 10, 7],
      [31, 30, 13, 8],
      [45, 34, 7, 6],
      [21, 47, 9, 5],
      [38, 46, 7, 5]
    ], lightGreen);

    // HIGHLIGHTS
    drawBlocks([
      [22, 13, 6, 3],
      [37, 17, 6, 3],
      [14, 32, 5, 3],
      [33, 29, 7, 3],
      [46, 33, 4, 3],
      [22, 46, 5, 2]
    ], highlightGreen);

    // LEAF DETAILS
    const leafDetails = [
      [12, 25], [18, 21], [26, 23],
      [39, 26], [47, 25], [53, 38],
      [8, 40], [15, 43], [27, 39],
      [37, 41], [44, 51], [23, 54],
      [30, 58], [18, 60]
    ];

    leafDetails.forEach(([x, y], i) => {
      pixel(
        x, y, 3, 2,
        i % 2 === 0 ? lightGreen : darkGreen
      );
    });

    pixel(29, 24, 4, 3, darkGreen);
    pixel(16, 42, 4, 3, darkGreen);
    pixel(40, 43, 4, 3, darkGreen);

    this.textures.addCanvas("tree", canvas);
  }

  // ==========================================
  // AUTUMN DECORATIONS
  // ==========================================

  createDecorationTextures() {
    const makeTexture = (key, width, height, draw) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;

      const pixel = (x, y, w, h, color) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
      };

      draw(pixel);

      this.textures.addCanvas(key, canvas);
    };

    // ==========================================
    // 1. AUTUMN BUSH
    // ==========================================

    makeTexture("bush", 72, 52, (p) => {
      const outline = "#56302c";
      const dark = "#833c34";
      const shadow = "#a74e38";
      const green = "#cb6d3d";
      const light = "#e9a54d";
      const highlight = "#f6cd72";

      // Ground shadow
      p(10, 46, 52, 4, "#905035");

      // Silhouette
      p(16, 12, 40, 6, outline);
      p(9, 18, 54, 8, outline);
      p(4, 26, 64, 14, outline);
      p(9, 40, 54, 7, outline);
      p(18, 47, 36, 3, outline);

      // Dark foliage
      p(17, 15, 38, 8, dark);
      p(11, 22, 50, 16, dark);
      p(8, 30, 56, 9, dark);
      p(14, 39, 44, 6, dark);

      // Leaf clusters
      p(14, 23, 19, 17, shadow);
      p(29, 16, 22, 20, shadow);
      p(43, 25, 17, 15, shadow);
      p(21, 35, 29, 9, shadow);

      // Orange foliage
      p(17, 21, 15, 12, green);
      p(31, 19, 17, 13, green);
      p(45, 27, 12, 9, green);
      p(22, 35, 18, 7, green);

      // Golden foliage
      p(19, 20, 10, 6, light);
      p(34, 17, 11, 7, light);
      p(47, 26, 8, 5, light);
      p(24, 34, 9, 4, light);

      // Highlights
      p(21, 19, 6, 3, highlight);
      p(36, 16, 7, 3, highlight);
      p(48, 25, 5, 2, highlight);

      // Individual leaves
      const leaves = [
        [12, 30], [17, 37], [26, 29],
        [38, 34], [51, 35], [56, 30],
        [32, 40], [44, 41], [25, 15]
      ];

      leaves.forEach(([x, y], i) => {
        p(
          x, y, 4, 2,
          i % 2 === 0 ? light : dark
        );
      });

      // Berries
      p(20, 31, 3, 3, "#d86c69");
      p(48, 37, 3, 3, "#e18a71");
      p(37, 27, 2, 2, "#d86c69");
    });

    // ==========================================
    // 2. FLOWER
    // ==========================================

    makeTexture("flower", 32, 42, (p) => {
      const darkGreen = "#765037";
      const green = "#b17a3d";
      const lightGreen = "#e1b65a";

      // Ground shadow
      p(8, 39, 18, 2, "#a06b3d");

      // Stem
      p(15, 17, 5, 23, darkGreen);
      p(17, 18, 2, 21, green);

      // Left leaf
      p(8, 29, 9, 4, darkGreen);
      p(10, 26, 7, 5, green);
      p(12, 27, 4, 2, lightGreen);

      // Right leaf
      p(19, 31, 9, 4, darkGreen);
      p(19, 28, 7, 5, green);
      p(20, 29, 4, 2, lightGreen);

      // Petal outlines
      p(13, 1, 9, 10, "#b95d8a");
      p(5, 9, 11, 9, "#b95d8a");
      p(20, 9, 10, 9, "#b95d8a");
      p(12, 17, 11, 8, "#b95d8a");

      // Pink petals
      p(15, 2, 5, 8, "#f5a6cb");
      p(7, 11, 9, 5, "#f5a6cb");
      p(21, 11, 7, 5, "#f5a6cb");
      p(14, 18, 7, 5, "#f5a6cb");

      // Highlights
      p(16, 3, 3, 3, "#ffe1ec");
      p(8, 11, 4, 2, "#ffe1ec");
      p(23, 11, 3, 2, "#ffe1ec");
      p(16, 19, 3, 2, "#ffe1ec");

      // Flower center
      p(13, 10, 10, 9, "#a66a32");
      p(15, 12, 6, 5, "#f6ce55");
      p(16, 12, 3, 2, "#fff09b");
    });

    // ==========================================
    // 3. ROCK
    // ==========================================

    makeTexture("rock", 54, 38, (p) => {
      const outline = "#465657";
      const dark = "#596d6c";
      const middle = "#82948b";
      const light = "#b1c0ae";
      const highlight = "#d5ddc7";

      // Ground shadow
      p(5, 33, 44, 4, "#8a6c4c");

      // Rock silhouette
      p(15, 4, 23, 5, outline);
      p(9, 9, 34, 5, outline);
      p(5, 14, 43, 16, outline);
      p(9, 30, 36, 5, outline);

      // Main body
      p(16, 7, 20, 6, middle);
      p(11, 12, 31, 11, middle);
      p(8, 19, 37, 10, dark);
      p(13, 28, 29, 4, dark);

      // Illuminated face
      p(17, 7, 17, 5, light);
      p(12, 13, 20, 7, light);

      // Highlights
      p(19, 7, 11, 3, highlight);
      p(13, 14, 10, 3, highlight);

      // Facets
      p(32, 13, 9, 10, "#738882");
      p(34, 16, 5, 7, dark);

      // Cracks
      p(24, 17, 3, 5, "#526664");
      p(26, 21, 6, 2, "#526664");
      p(31, 23, 2, 4, "#526664");

      // Texture
      p(13, 24, 6, 2, "#9bada0");
      p(20, 28, 5, 2, "#455b59");
      p(36, 27, 5, 2, "#a2b4a5");

      // Autumn moss
      p(9, 25, 7, 3, "#aa713f");
      p(11, 23, 4, 3, "#d59a4b");
      p(39, 28, 5, 3, "#a46a3d");
    });

    // ==========================================
    // 4. GOLDEN GRASS TUFT
    // ==========================================

    makeTexture("grass", 36, 32, (p) => {
      const shadow = "#754631";
      const dark = "#9b5a35";
      const green = "#c5833f";
      const light = "#e4ad52";
      const highlight = "#f3d073";

      // Ground shadow
      p(4, 28, 28, 3, "#9e6639");

      // Outer blades
      p(5, 16, 4, 13, shadow);
      p(8, 12, 4, 17, dark);

      p(27, 15, 4, 14, shadow);
      p(24, 11, 4, 18, dark);

      // Center blades
      p(14, 5, 5, 24, shadow);
      p(16, 2, 4, 26, green);

      p(21, 7, 4, 22, dark);
      p(22, 5, 3, 22, light);

      // Short blades
      p(11, 19, 4, 10, green);
      p(29, 21, 3, 8, green);

      // Highlights
      p(17, 4, 2, 16, highlight);
      p(23, 8, 2, 13, highlight);
      p(9, 14, 2, 10, light);

      // Dense base
      p(7, 25, 23, 4, dark);
      p(12, 24, 15, 4, green);
      p(15, 25, 9, 2, light);
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
        audio.play("alarm");
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
    setHeroWalking(this.walking);   // its legs, arms, tail and wing follow (render/heroSprite.js)
    this.animateCharacter(time);
  }
}
