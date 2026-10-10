// client/src/ui/statusBar.js: Top-left meters. Owner: Role 3 (client, art, demo).
// DOM overlay on top of the game canvas. Placeholder look, driven only by the server's game state.

const css = `
#hud{position:absolute;inset:0;pointer-events:none;font:12px ui-monospace,Menlo,monospace;color:#fff;text-shadow:1px 1px 0 #000}
#hud .bar{position:absolute;top:8px;left:8px;background:rgba(10,14,20,.78);padding:8px 10px;border:2px solid #3a4568;min-width:170px}
#hud .row{display:flex;align-items:center;gap:6px;margin:3px 0}
#hud .lbl{width:64px;opacity:.85}
#hud .track{flex:1;height:10px;background:#0b0d12;border:1px solid #3a4568}
#hud .fill{height:100%;background:#4aa3ff}
#hud .stale{color:#ffb84a;margin-top:4px}
#hud .banner{position:absolute;top:10px;left:0;right:0;text-align:center;font-size:26px;color:#ff5a6a;display:none;animation:blink .6s steps(2) infinite}
@keyframes blink{50%{opacity:.25}}
#hud .panel{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(10,14,20,.82);border:2px solid #3a4568;padding:8px 14px;min-width:300px;display:none}
#hud .hp .track{width:150px}
#hud .hp .fill{background:#ff7a6a}
#hud .reward{color:#7bd88f}
#hud .health .fill{background:#5fd068}
#hud .cond{margin-top:4px;color:#ffe08a}
#hud .title{color:#ffe08a;margin-bottom:4px}
#hud .moves{display:flex;gap:6px;margin-top:8px}
#hud .moves button{position:static;flex:1;pointer-events:auto;background:#2d4a78;color:#fff;border:2px solid #6f95d6;padding:6px 4px;font:bold 12px ui-monospace,Menlo,monospace;cursor:pointer;text-shadow:none}
#hud .moves button:hover:not(:disabled){background:#3f66a8}
#hud .moves button:disabled{opacity:.4;cursor:default}
#hud .moves button small{display:block;font-weight:normal;opacity:.8;font-size:10px}
#hud .timer{margin-top:6px;opacity:.75}
#hud button{position:absolute;top:8px;right:8px;pointer-events:auto;background:#ff5a6a;color:#0b0d12;border:0;padding:8px 12px;font:bold 12px inherit;cursor:pointer}
#hud .conn{position:absolute;bottom:6px;right:8px;opacity:.6}
`;

const meterRow = (label, id) =>
  `<div class="row"><span class="lbl">${label}</span><div class="track"><div class="fill" id="${id}"></div></div></div>`;

const hpRow = (label, id, txt) =>
  `<div class="row hp"><span class="lbl">${label}</span><div class="track"><div class="fill" id="${id}"></div></div><span id="${txt}"></span></div>`;

export function mountStatusBar(parent, { onDemoBoss }) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  parent.style.position = "relative";
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.innerHTML = `
    <div class="bar">
      ${meterRow("WATER A", "wA")}${meterRow("WATER B", "wB")}
      ${meterRow("SUNLIGHT", "sun")}
      <div class="health">${meterRow("HEALTH", "health")}</div>
      <div class="cond" id="cond"></div>
      <div class="stale" id="stale"></div>
    </div>
    <div class="banner" id="banner">BOSS ALERT</div>
    <div class="panel" id="panel"></div>
    <button id="demoBtn">DEMO BOSS</button>
    <div class="conn" id="conn">connecting...</div>`;
  parent.appendChild(hud);
  hud.querySelector("#demoBtn").onclick = onDemoBoss;

  const $ = (id) => hud.querySelector("#" + id);

  return {
    setConnected(on) {
      $("conn").textContent = on ? "server connected" : "server offline, retrying...";
    },
    render(s) {
      $("wA").style.width = `${s.meters.water.A}%`;
      $("wB").style.width = `${s.meters.water.B}%`;
      const sun = s.meters.sunlight.A ?? s.meters.sunlight.B;
      $("sun").style.width = sun == null ? "0%" : `${sun}%`;
      $("stale").textContent = s.meters.stale ? "STALE: ESP32 offline" : "";

      const h = s.health ?? 100;
      $("health").style.width = `${h}%`;
      $("health").style.background = h > 60 ? "#5fd068" : h > 30 ? "#e0c040" : "#e04a4a";
      const conditions = { healthy: "", weary: "Weary", wilting: "Wilting", wilted: "WILTED: hits weaker, water it!" };
      $("cond").textContent = conditions[s.condition] || "";

      const banner = $("banner");
      banner.textContent = s.boss ? `BOSS ALERT: ${s.boss.name}` : "BOSS ALERT";
      banner.style.display = s.mode === "boss" ? "block" : "none";

      const panel = $("panel");
      let html = "";
      panel.innerHTML = html;
      panel.style.display = html ? "block" : "none";
    },
  };
}
