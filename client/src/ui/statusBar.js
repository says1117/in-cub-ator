// client/src/ui/statusBar.js: Top-left status bar: water, sunlight and other meters. Owner: Role 3 (client, art, demo).
import { bar } from "../render/boss.js";

export function drawStatusBar(ctx, state, connState) {
  ctx.fillStyle = "rgba(10,12,18,0.78)"; ctx.fillRect(4, 4, 168, 76);
  ctx.font = "10px monospace"; ctx.textAlign = "left";
  const row = (y, label, frac, color, text) => {
    ctx.fillStyle = "#cfd6e4"; ctx.fillText(label, 10, y + 6);
    bar(ctx, 58, y, 78, 7, frac == null ? 0 : frac, color);
    ctx.fillStyle = "#cfd6e4"; ctx.fillText(text, 140, y + 6);
  };
  const pct = (f) => (f == null ? "--" : Math.round(f * 100) + "%");
  row(10, "Water A", state.pots.A.water, "#3b8fe0", pct(state.pots.A.water));
  row(24, "Water B", state.pots.B.water, "#3b8fe0", pct(state.pots.B.water));
  const sun = state.sunlight == null ? null : state.sunlight / 100;
  row(38, state.light_on ? "Light*" : "Sun", sun, "#f2c94c", pct(sun));
  ctx.fillStyle = state.esp32 === "online" || state.esp32 === "mock" ? "#4cc46a" : "#e5484d";
  ctx.fillText("Cube: " + state.esp32, 10, 62);
  ctx.fillStyle = connState === "live" ? "#4cc46a" : "#f2c94c";
  ctx.fillText(connState === "live" ? "LIVE" : connState.toUpperCase(), 120, 62);
  const lvl = (p) => (state.pots[p].creature ? `${state.pots[p].creature.name} Lv${state.pots[p].creature.level}` : "-");
  ctx.fillStyle = "#cfd6e4"; ctx.fillText(`A:${lvl("A")}  B:${lvl("B")}`, 10, 74);
}
