// client/src/render/battle.js: The boss fight scene. Owner: Role 3 (client, art, demo).
import { drawBoss, bar } from "./boss.js";
import { drawCreature } from "./walk.js";

export function drawBattle(ctx, x0, w, pot, time) {
  ctx.fillStyle = "#3a2b4d"; ctx.fillRect(x0, 0, w, 250);
  ctx.fillStyle = "#54406b"; ctx.fillRect(x0, 250, w, 110);
  ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
  ctx.fillText("THE SOIL IS DRY!", x0 + w / 2, 104);
  drawBoss(ctx, pot.boss, x0 + w - 110, 120, time);
  if (pot.creature) {
    const lunge = pot.last_hit && pot.last_hit.by === "creature" ? Math.sin(time * 20) * 6 : 0;
    drawCreature(ctx, pot.creature, x0 + 50 + lunge, 190, Math.floor(time * 6) % 2);
    bar(ctx, x0 + 40, 176, 60, 5, pot.creature.hp / pot.creature.max_hp, "#4cc46a");
  } else {
    ctx.fillStyle = "#fff"; ctx.font = "13px monospace";
    ctx.fillText("Put a creature on the pad to fight!", x0 + w / 2, 300);
  }
}
