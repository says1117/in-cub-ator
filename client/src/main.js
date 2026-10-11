import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import BossScene from "./scenes/BossScene.js";
import StorageScene from "./scenes/StorageScene.js";
import "./style.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/press-start-2p/400.css";
import { connectWsSource } from "./state/wsSource.js";
import { mountStatusBar } from "./ui/statusBar.js";

const routes = {
  "/": "AdventureScene",
  "/adventure": "AdventureScene",
  "/boss": "BossScene",
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

  scene: [AdventureScene, StorageScene, BossScene]
};

// The pixel fonts must be ready before any scene writes with them, or the first words come out
// in a fallback font. A slow or missing font never holds the game up for long.
const fonts = ['8px "Silkscreen"', 'bold 8px "Silkscreen"', '8px "Press Start 2P"'];
await Promise.race([
  Promise.all(fonts.map((font) => document.fonts.load(font))),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).catch(() => {});

const game = new Phaser.Game(config);
if (import.meta.env.DEV) window.__game = game;   // dev only: lets you poke at the game from the browser console

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
});
server = connectWsSource(
  (state) => {
    game.registry.set("serverState", state);
    hud.render(state);
  },
  (connected) => hud.setConnected(connected)
);
game.registry.set("sendMove", (move) => server && server.sendMove(move));
