import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import BossScene from "./scenes/BossScene.js";
import "./style.css";
import { connectWsSource } from "./state/wsSource.js";
import { mountStatusBar } from "./ui/statusBar.js";

// The forest is always the way in. If the page is opened during a fight, it cuts straight to
// the battle screen by itself (AdventureScene.syncWithServer).
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

  scene: [AdventureScene, BossScene]
};

const game = new Phaser.Game(config);
window.__game = game;   // lets tests and the browser console look at the game

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
