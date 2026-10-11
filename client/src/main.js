import { connectGameSource } from "./state/gameSource.js";
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
// Keep plant pages on their existing feed; the game feed owns encounter state.
connectPlantSocket();
let gameFeed = connectGameSource((state, rejected) => {
  if (rejected) { game.events.emit("moveRejected", rejected); return; }
  game.registry.set("serverState", state);
  if (["boss", "battle"].includes(state.mode) && !game.scene.isActive("AdventureScene") && !game.scene.isActive("BossScene")) {
    showForest();
  }
}, connected => {
  game.registry.set("connected", connected);
  if (connected && game.registry.get("pendingDemo")) {
    game.registry.set("pendingDemo", false);
    gameFeed.send({ action: "demo_boss" });
  }
});
game.registry.set("sendMove", (move, turn) => gameFeed.send({ action: "move", move, turn,
  fight: game.registry.get("serverState")?.battle?.id }));
game.registry.set("sendDemo", () => gameFeed.send({ action: "demo_boss" }));
loadPlants().catch(error => console.error("Backend connection failed:", error));

function showForest() {
  for (const key of new Set(Object.values(routes))) if (key !== "AdventureScene") game.scene.stop(key);
  game.scene.start("AdventureScene");
  game.scene.run("HudScene");
  game.scene.bringToTop("HudScene");
}

// Navigate between URLs and scenes
function navigate(path) {
  const sceneName = routes[path];

  if (!sceneName) return;

  if (window.location.pathname !== path) window.history.pushState({}, "", path);

  if (sceneName === "BossScene") {
    const state = game.registry.get("serverState");
    showForest();
    if (!state?.boss && !["boss", "battle", "reward"].includes(state?.mode)) {
      if (!game.registry.get("sendDemo")?.()) game.registry.set("pendingDemo", true);
    }
    return;
  }
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
