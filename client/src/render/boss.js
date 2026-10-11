// client/src/render/boss.js: Draws the boss and its health bar. Owner: Role 3 (client, art, demo).
import { sprite } from "../assets.js";

export function drawBoss(ctx, boss, x, y, time) {
  const bob = Math.sin(time * 3) * 3;
  sprite(ctx, "boss", x, y + bob, 64, 64, (c, px, py) => {
    c.fillStyle = "#8c5a34"; c.fillRect(px, py + 8, 64, 52);          // body
    c.fillStyle = "#6d4224"; c.fillRect(px + 8, py, 48, 16);          // head
    c.fillStyle = "#ff4d4d"; c.fillRect(px + 16, py + 6, 8, 6); c.fillRect(px + 40, py + 6, 8, 6); // eyes
    c.fillStyle = "#3a2412"; c.fillRect(px + 20, py + 30, 24, 6);     // mouth
  });
  bar(ctx, x - 8, y - 14, 80, 6, boss.hp / boss.max_hp, "#e5484d");
  ctx.fillStyle = "#fff"; ctx.font = "10px monospace"; ctx.textAlign = "center";
  ctx.fillText(boss.name, x + 32, y - 18);
}

export function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = "#000"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = "#3a3f4b"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
}
