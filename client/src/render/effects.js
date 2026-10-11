// client/src/render/effects.js: Floating damage numbers and screen shake. Owner: Role 3 (client, art, demo).
const floaters = [];

export function addFloater(x, y, text, color) {
  floaters.push({ x, y, text, color, age: 0 });
}

export function drawEffects(ctx, dt) {
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.age += dt;
    if (f.age > 0.9) { floaters.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - f.age / 0.9;
    ctx.fillStyle = "#000"; ctx.fillText(f.text, f.x + 1, f.y - f.age * 30 + 1);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - f.age * 30);
    ctx.globalAlpha = 1;
  }
}
