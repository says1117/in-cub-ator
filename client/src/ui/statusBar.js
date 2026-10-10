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

const MOVE_LABELS = { attack: "Attack", guard: "Guard", special: "Special", skill: "Skill" };
const MOVE_KEYS = ["attack", "guard", "special", "skill"];

export function mountStatusBar(parent, { onDemoBoss, onMove = () => {} }) {
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

  // Move buttons are rebuilt with every update, so listen once on the panel.
  let canMove = false;
  let skillReady = false;
  const pick = (move) => {
    if (!canMove || (move === "skill" && !skillReady)) return;
    onMove(move);
  };
  $("panel").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-move]");
    if (button && !button.disabled) pick(button.dataset.move);
  });
  window.addEventListener("keydown", (event) => {
    const index = ["1", "2", "3", "4"].indexOf(event.key);
    if (index >= 0) pick(MOVE_KEYS[index]);
  });

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
      if (s.mode === "battle" && s.battle && s.boss) {
        const b = s.battle;
        const lm = b.last_move;
        canMove = !!b.awaiting_move;
        skillReady = !!(b.skill && b.skill.ready);
        const skillLabel = b.skill
          ? `${b.skill.name}<small>${b.skill.ready ? "ready" : `in ${b.skill.ready_in} turns`}</small>`
          : "Skill<small>none</small>";
        const moveButtons = MOVE_KEYS.map((m, i) => {
          const off = !canMove || (m === "skill" && !skillReady);
          const label = m === "skill" ? skillLabel : `${MOVE_LABELS[m]}<small>press ${i + 1}</small>`;
          return `<button data-move="${m}"${off ? " disabled" : ""}>${label}</button>`;
        }).join("");
        const played = lm
          ? `${lm.skill ? lm.skill + " (" + lm.creature + ")" : "you " + lm.creature}, boss ${lm.boss}: ${lm.hit}`
          : "";
        html =
          `<div class="title">${b.creature || "Plant"} vs ${s.boss.name} (tier ${s.boss.tier}), turn ${b.turn}${s.boss.source === "demo" ? ", demo" : ""}</div>` +
          hpRow("BOSS", "bossHp", "bossTxt") + hpRow("PLANT", "plantHp", "plantTxt") +
          (played ? `<div>${played}</div>` : "") +
          (canMove ? `<div class="moves">${moveButtons}</div>` : "") +
          (b.move_seconds_left != null ? `<div class="timer">pick a move: ${b.move_seconds_left}s</div>` : "");
      } else if (s.mode === "reward" && s.reward) {
        html = `<div class="reward">Watered plant ${s.reward.plant}: ${s.reward.size} ms</div>`;
      } else if (s.mode === "cooldown") {
        html = `<div>The boss retreats. Back to the walk...</div>`;
      }
      if (!(s.mode === "battle" && s.battle && s.boss)) {
        canMove = false;
        skillReady = false;
      }
      panel.innerHTML = html;
      panel.style.display = html ? "block" : "none";
      if (s.mode === "battle" && s.battle && s.boss) {
        $("bossHp").style.width = `${100 * s.battle.boss_hp / s.boss.max_hp}%`;
        $("plantHp").style.width = `${100 * s.battle.creature_hp / s.battle.creature_max_hp}%`;
        $("bossTxt").textContent = `${s.battle.boss_hp}/${s.boss.max_hp}`;
        $("plantTxt").textContent = `${s.battle.creature_hp}/${s.battle.creature_max_hp}`;
      }
    },
  };
}
