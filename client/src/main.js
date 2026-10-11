import { bossRotation } from "./state/bossRotation.js";
import { bossDefinition } from "./data/bosses.js";
import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import StorageScene from "./scenes/StorageScene.js";
import CastIronScene from "./scenes/CastIronScene.js";
import MonsteraScene from "./scenes/MonsteraScene.js";
import BossScene from "./scenes/BossScene.js";
import { loadPlants } from "./state/plantStore.js";
import { connectPlantSocket } from "./services/socket.js";
import "./style.css";
import HudScene from "./scenes/HudScene.js";
import { loadFont } from "./ui/font.js";
import audio from "./audio/index.js";
import { getAllPlants, subscribe } from "./state/plantStore.js";

const routes = {
  "/": "AdventureScene",
  "/adventure": "AdventureScene",
  "/storage": "StorageScene",
  "/cast_iron": "CastIronScene",
  "/monstera": "MonsteraScene",
  "/boss": "BossScene"
};

// Start only the requested route, avoiding overlapping asset loaders at boot.
class BootScene extends Phaser.Scene {
  constructor() { super("BootScene"); }
  create() {
    this.scene.stop();
    navigate(routes[window.location.pathname] ? window.location.pathname : "/");
  }
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  parent: "app",
  backgroundColor: "#0b0718",
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },

  scene: [BootScene, AdventureScene, StorageScene, CastIronScene, MonsteraScene, BossScene, HudScene]
};

await loadFont();
const game = new Phaser.Game(config);
window.__game = game;
audio.init(game);
game.registry.set("audio", audio);
function syncPresentation(plants) {
  const fighters = {}, water = {}, thirsty = {};
  plants.slice(0, 2).forEach((plant, i) => {
    const id = i === 0 ? "A" : "B";
    fighters[id] = { name: plant.species, hp: plant.hp, level: plant.level };
    water[id] = plant.soilMoisture;
    thirsty[id] = plant.soilMoisture < 50;
  });
  const previous = game.registry.get("serverState") || {};
  const mode = previous.mode || "walking";
  game.registry.set("serverState", { ...previous, mode, fighters, meters: { water, thirsty }, demo_available: mode === "walking" && plants.length > 0 });
}
subscribe(syncPresentation);
syncPresentation(getAllPlants());
game.registry.set("sendDemo", () => { navigate("/boss"); return true; });
connectPlantSocket(connected => game.registry.set("connected", connected));


loadPlants().catch(error => {
  console.error("Backend connection failed:", error);
});

// Navigate between URLs and scenes
function navigate(path) {
  const sceneName = routes[path];

  if (!sceneName) return;

  if (window.location.pathname !== path) window.history.pushState({}, "", path);

  const current = game.registry.get("serverState") || {};
  if (sceneName === "BossScene") {
    if (["boss", "battle"].includes(current.mode)) return;
    const encounter = bossRotation.begin();
    const definition = bossDefinition(encounter.id);
    game.registry.set("serverState", {
      ...current, mode: "boss", demo_available: false,
      boss: { ...encounter, name: definition.name, tier: 1, plant: "A" }
    });
    for (const key of new Set(Object.values(routes))) if (key !== "AdventureScene") game.scene.stop(key);
    if (!game.scene.isActive("AdventureScene")) game.scene.start("AdventureScene");
    game.scene.run("HudScene");
    game.scene.bringToTop("HudScene");
    return;
  }
  game.registry.set("serverState", { ...current, mode: "walking", boss: null, demo_available: getAllPlants().length > 0 });
  for (const key of new Set(Object.values(routes))) if (key !== sceneName) game.scene.stop(key);
  game.scene.start(sceneName);
  if (["AdventureScene", "BossScene"].includes(sceneName)) { game.scene.run("HudScene"); game.scene.bringToTop("HudScene"); }
  else { game.scene.stop("HudScene"); audio.music("forest"); }
}

// Allow scenes to use the navigation function
game.registry.set("navigate", navigate);

// Handle browser Back / Forward buttons
window.addEventListener("popstate", () => {
  navigate(window.location.pathname);
});
