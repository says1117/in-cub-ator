// client/src/main.js: Starts the game: picks the state source and runs the render loop. Owner: Role 3 (client, art, demo).
import { CONFIG } from "./config.js";
import { loadAssets } from "./assets.js";
import { sfx } from "./audio.js";
import { wsSource } from "./state/wsSource.js";
import { mockSource } from "./state/mockSource.js";
import { drawWalk } from "./render/walk.js";
import { drawBattle } from "./render/battle.js";
import { addFloater, drawEffects } from "./render/effects.js";
import { drawStatusBar } from "./ui/statusBar.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

let state = null, connState = "connecting", source = null, usingMock = false, lastData = performance.now();
const prev = { A: null, B: null };
const LANE_W = CONFIG.width / 2;

function onState(s) {
  lastData = performance.now();
  for (const id of ["A", "B"]) {
    const p = s.pots[id], q = prev[id], x0 = id === "A" ? 0 : LANE_W;
    if (q) {
      if (p.phase === "boss" && q.phase !== "boss") sfx.bossAppear();
      if (q.phase === "boss" && p.phase === "watering") { sfx.win(); addFloater(x0 + LANE_W / 2, 200, "VICTORY!", "#ffe066"); }
      if (p.phase === "boss" && p.boss && q.boss && p.boss.hp < q.boss.hp) {
        sfx.hit(); addFloater(x0 + LANE_W - 78, 130, "-" + (q.boss.hp - p.boss.hp), "#ffffff");
      }
      if (p.creature && q.creature && p.creature.hp < q.creature.hp) {
        sfx.bossHit(); addFloater(x0 + 70, 190, "-" + (q.creature.hp - p.creature.hp), "#ff6b6b");
      }
    }
    prev[id] = p;
  }
  state = s;
}

function useMock() {
  if (usingMock) return;
  source && source.stop();
  usingMock = true; connState = "mock";
  source = mockSource(onState);
}

function useServer() {
  usingMock = false;
  source = wsSource(onState, (ok) => { connState = ok ? "live" : "offline"; });
}

function start() {
  if (CONFIG.mock === "1") return useMock();
  useServer();
  if (CONFIG.mock !== "0") {       // auto fallback so the screen is never blank on stage
    setInterval(() => {
      if (!usingMock && connState !== "live" && performance.now() - lastData > CONFIG.mockFallbackMs) useMock();
    }, 1000);
  }
}

addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") {
    if (usingMock) { source.stop(); useServer(); } else useMock();
  }
  const pot = { "1": "A", "2": "B" }[e.key];
  if (pot) fetch(`${CONFIG.apiBase}/api/debug/boss/${pot}`, { method: "POST" }).catch(() => {});
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const time = now / 1000;
  ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
  if (state) {
    ["A", "B"].forEach((id, i) => {
      const x0 = i * LANE_W, pot = state.pots[id];
      ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, LANE_W, CONFIG.height); ctx.clip();
      (pot.phase === "boss" && pot.boss ? drawBattle : drawWalk)(ctx, x0, LANE_W, pot, time);
      ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(x0 + LANE_W - 54, 4, 50, 14);
      ctx.fillStyle = "#fff"; ctx.font = "10px monospace"; ctx.textAlign = "center";
      ctx.fillText("POT " + id, x0 + LANE_W - 29, 14);
      ctx.restore();
    });
    ctx.fillStyle = "#10131a"; ctx.fillRect(LANE_W - 1, 0, 2, CONFIG.height);
    drawEffects(ctx, dt);
    drawStatusBar(ctx, state, connState);
  } else {
    ctx.fillStyle = "#10131a"; ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    ctx.fillStyle = "#cfd6e4"; ctx.font = "14px monospace"; ctx.textAlign = "center";
    ctx.fillText("Connecting to the cube...", CONFIG.width / 2, CONFIG.height / 2);
  }
  requestAnimationFrame(frame);
}

loadAssets().then(() => { start(); requestAnimationFrame(frame); });
