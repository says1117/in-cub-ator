import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import StorageScene from "./scenes/StorageScene.js";
import CastIronScene from "./scenes/CastIronScene.js";
import MonsteraScene from "./scenes/MonsteraScene.js";
import BossScene from "./scenes/BossScene.js";
import { loadPlants } from "./state/plantStore.js";
import { connectPlantSocket } from "./services/socket.js";
import "./style.css";

const routes = {
  "/": "AdventureScene",
  "/adventure": "AdventureScene",
  "/storage": "StorageScene",
  "/cast_iron": "CastIronScene",
  "/monstera": "MonsteraScene",
  "/boss": "BossScene"
};

function getSceneFromURL() {
  return routes[window.location.pathname] || "AdventureScene";
}

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 450,
  parent: "app",
  backgroundColor: "#87c9eb",
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },

  scene: [AdventureScene, StorageScene, CastIronScene, MonsteraScene, BossScene]
};

const game = new Phaser.Game(config);
connectPlantSocket();


loadPlants().catch(error => {
  console.error("Backend connection failed:", error);
});

// Navigate between URLs and scenes
function navigate(path) {
  const sceneName = routes[path];

  if (!sceneName) return;

  window.history.pushState({}, "", path);

  game.scene.start(sceneName);
}

// Allow scenes to use the navigation function
game.registry.set("navigate", navigate);

// Start the correct scene based on the URL
game.events.once(Phaser.Core.Events.READY, () => {
  game.scene.start(getSceneFromURL());
});

// Handle browser Back / Forward buttons
window.addEventListener("popstate", () => {
  game.scene.start(getSceneFromURL());
});
