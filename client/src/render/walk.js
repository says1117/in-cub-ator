// client/src/render/walk.js: The endless walking scene shown while a pot is happy. Owner: Role 3 (client, art, demo).
import { sprite } from "../assets.js";
import { CONFIG } from "../config.js";

export function drawCreature(ctx, c, x, y, step) {
  sprite(ctx, "creature", x, y, 40, 40, (g, px, py) => {
    const leg = step ? 3 : -3;
    g.fillStyle = c.color; g.fillRect(px + 6, py + 4, 28, 26);        // body
    g.fillStyle = "#1c1c1c"; g.fillRect(px + 12, py + 12, 5, 5); g.fillRect(px + 24, py + 12, 5, 5); // eyes
    g.fillStyle = "#2f7d32"; g.fillRect(px + 16, py - 4, 8, 8);       // leaf
    g.fillStyle = c.color; g.fillRect(px + 8, py + 30 + leg / 2, 8, 8); g.fillRect(px + 24, py + 30 - leg / 2, 8, 8); // legs
  });
}

export function drawWalk(ctx, x0, w, pot, time) {
  ctx.fillStyle = "#7ec8f0"; ctx.fillRect(x0, 0, w, 250);                 // sky
  ctx.fillStyle = "#9bd36a"; ctx.fillRect(x0, 250, w, 110);               // grass
  ctx.fillStyle = "#6fae4a";
  const off = (time * CONFIG.walkSpeed) % 40;
  for (let gx = -40; gx < w + 40; gx += 40) ctx.fillRect(x0 + gx - off, 300, 20, 4);   // scrolling tufts
  if (!pot.creature) {
    ctx.fillStyle = "#1c2230"; ctx.font = "13px monospace"; ctx.textAlign = "center";
    ctx.fillText("Place a creature on the pad", x0 + w / 2, 200);
    return;
  }
  drawCreature(ctx, pot.creature, x0 + w / 2 - 20, 232 + Math.abs(Math.sin(time * 6)) * -3, Math.floor(time * 4) % 2);
  if (pot.phase === "watering") {
    ctx.fillStyle = "#2a7fd4";
    for (let i = 0; i < 6; i++) ctx.fillRect(x0 + w / 2 - 30 + i * 12, 150 + ((time * 80 + i * 20) % 80), 3, 8);  // rain
    ctx.fillStyle = "#1c2230"; ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("Watering...", x0 + w / 2, 140);
  }
}
