import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import StorageScene from "./scenes/StorageScene.js";
import "./style.css";
import { connectWsSource } from "./state/wsSource.js";
import { mountStatusBar } from "./ui/statusBar.js";

const routes = {
  "/": "AdventureScene",
  "/adventure": "AdventureScene",
  "/storage": "StorageScene"
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

  scene: [AdventureScene, StorageScene]
};

const game = new Phaser.Game(config);

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

// Server connection: status bar, boss alert, battle bars and the demo button overlay the game.
// The latest server state is also available to scenes as game.registry.get("serverState").
let server;
const hud = mountStatusBar(document.getElementById("app"), {
  onDemoBoss: () => server && server.sendDemoBoss(),
  onMove: (move) => server && server.sendMove(move),
});
server = connectWsSource(
  (state) => {
    game.registry.set("serverState", state);
    hud.render(state);
  },
  (connected) => hud.setConnected(connected)
);
