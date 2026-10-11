import Phaser from "phaser";
import AdventureScene from "./scenes/AdventureScene.js";
import BossScene from "./scenes/BossScene.js";
import StorageScene from "./scenes/StorageScene.js";
import CastIronScene from "./scenes/CastIronScene.js";
import MonsteraScene from "./scenes/MonsteraScene.js";
import "./style.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "@fontsource/press-start-2p/400.css";
import { connectWsSource } from "./state/wsSource.js";
import { feedPlants } from "./state/plantFeed.js";
import { mountStatusBar } from "./ui/statusBar.js";

const routes = {
  "/": "AdventureScene",
  "/adventure": "AdventureScene",
  "/boss": "BossScene",
  "/storage": "StorageScene",
  "/cast_iron": "CastIronScene",
  "/monstera": "MonsteraScene"
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

// The pixel fonts must be ready before any scene writes with them, or the first words come out
// in a fallback font. A slow or missing font never holds the game up for long.
const fonts = ['8px "Silkscreen"', 'bold 8px "Silkscreen"', '8px "Press Start 2P"'];
await Promise.race([
  Promise.all(fonts.map((font) => document.fonts.load(font))),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]).catch(() => {});

const game = new Phaser.Game(config);
if (import.meta.env.DEV) {
  window.__game = game;   // dev only: lets you poke at the game from the browser console
  // dev only: opens the battle screen on a made-up fight, with no game server. kind: "chomper" or "sporelings".
  window.__fakeBattle = (kind = "sporelings", tier = 1) => {
    const boss = { plant: "A", name: kind === "sporelings" ? "Sporeling Trio" : "Drought Chomper", kind, tier, hp: 44, max_hp: 44, type: "drought", source: "demo" };
    const battle = {
      turn: 0, plant: "A", creature: "Ember", creature_hp: 30, creature_max_hp: 30, boss_hp: 44, last_move: null,
      team: { A: { name: "Ember", hp: 30, max_hp: 30, state: "fighting" }, B: { name: "Zest", hp: 34, max_hp: 34, state: "ready" } },
      intent: { move: "attack", grade: "likely", chance: 0.75, bluff: "special", heavy: false },
      enraged: false, enrage_hp: 22, hints: true, skill: { name: "Inferno Bloom", ready: true, charge: 2, need: 2 },
      manual: true, awaiting_move: true, move_seconds_left: 10,
    };
    game.registry.set("serverState", {
      mode: "battle", creatures: { A: null, B: null }, meters: { water: { A: 20, B: 80 }, stale: false },
      fighters: { A: { name: "Ember", skill: "Inferno Bloom" }, B: { name: "Zest", skill: "Sunburst" } },
      health: 90, condition: "healthy", tier, reward: null, boss, battle,
    });
    game.scene.start("BossScene");
    document.getElementById("hud")?.style.setProperty("display", "none");
  };
}

feedPlants(null);   // example plants until the game server answers

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
    feedPlants(state);
    hud.render(state);
  },
  (connected) => hud.setConnected(connected)
);
game.registry.set("sendMove", (move) => server && server.sendMove(move));
