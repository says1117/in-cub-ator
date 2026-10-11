import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import BossScene from "./scenes/BossScene.js";
import HudScene from "./scenes/HudScene.js";
import "./style.css";
import { connectWsSource } from "./state/wsSource.js";
import { loadFont } from "./ui/font.js";
import audio from "./audio/index.js";

// The forest is always the way in. If the page is opened during a fight, it cuts straight to
// the battle screen by itself (AdventureScene.syncWithServer).
// HudScene starts with the game, stays above the other scenes and is never stopped.
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

  scene: [AdventureScene, BossScene, HudScene]
};

await loadFont();
const game = new Phaser.Game(config);
window.__game = game;   // lets tests and the browser console look at the game

// All sound (audio/index.js). Scenes reach it through the registry, so a missing module never breaks them.
audio.init(game);
game.registry.set("audio", audio);

// Server connection. Scenes read everything from the registry:
//   serverState  the latest game state       connected  true / false (unset until the first try ends)
//   sendMove     (move, ...) => void          sendDemo   () => void, asks for a demo boss
const server = connectWsSource(
  (state) => game.registry.set("serverState", state),
  (connected) => game.registry.set("connected", connected)
);
game.registry.set("sendMove", (...args) => server.sendMove(...args));
game.registry.set("sendDemo", () => server.sendDemoBoss());
