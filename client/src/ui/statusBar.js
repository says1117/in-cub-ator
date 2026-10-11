// client/src/ui/statusBar.js: What is written over the forest. Owner: Role 3 (client, art, demo).
// A DOM overlay on top of the game canvas: each plant's water, the cube's health, the boss
// alert, the Storage and demo buttons and the sound switch. It only shows the server's game state.
// The battle screen has its own (ui/battleHud.js), so most of this hides during a fight.
import { audio } from "../audio.js";

const css = `
#hud{position:absolute;inset:0;pointer-events:none;font:8px "Silkscreen",ui-monospace,monospace;color:#f4f7ff;
  text-transform:uppercase;letter-spacing:.5px;image-rendering:pixelated;font-size:calc(8px*var(--k,1.5))}
#hud .plate{background:linear-gradient(#131a36 55%,#0c1126 55%);border:2px solid #3a4788;box-shadow:2px 3px 0 rgba(5,7,15,.45)}
#hud .bar{position:absolute;top:1.6%;left:1%;padding:.7em .9em .6em;min-width:19em}
#hud .row{display:flex;align-items:center;gap:.6em;margin:.35em 0}
#hud .lbl{width:5.2em;font-weight:700}
#hud .track{position:relative;flex:1;height:.85em;background:#1c2344;outline:1px solid #05070f}
#hud .fill{height:100%;width:0;background:#4ab8ff;box-shadow:inset 0 .28em 0 rgba(255,255,255,.3);transition:width .4s}
#hud .mark{position:absolute;top:-2px;bottom:-2px;left:50%;width:1px;background:#ff6b5b}
#hud .num{width:3em;text-align:right;color:#8f9bc4}
#hud .note{margin-top:.5em;color:#ffd867;min-height:1em}
#hud .note.bad{color:#ff8f6b}
#hud .banner{position:absolute;top:14%;left:0;right:0;text-align:center;font:2.4em "Press Start 2P",monospace;color:#ff5a6a;
  text-shadow:.12em .12em 0 #05070f,-.08em 0 0 #05070f,0 -.08em 0 #05070f;display:none;animation:hudblink .5s steps(2) infinite}
@keyframes hudblink{50%{opacity:.35}}
#hud .tools{position:absolute;top:1.6%;right:1%;display:flex;gap:.6em}
#hud button{pointer-events:auto;font:inherit;font-weight:700;text-transform:uppercase;color:#f4f7ff;cursor:pointer;padding:.7em 1em;
  background:linear-gradient(#131a36 55%,#0c1126 55%);border:2px solid #3a4788;box-shadow:2px 3px 0 rgba(5,7,15,.45)}
#hud button:hover{border-color:#fff;transform:translateY(-1px)}
#hud button:active{transform:translateY(1px);box-shadow:none}
#hud #demoBtn{border-color:#ff5a6a;color:#ffd5d9}
#hud #demoBtn:disabled{opacity:.4;cursor:default;transform:none;border-color:#3a4788}
#hud .tip{position:absolute;bottom:2%;left:1%;padding:.5em .8em;color:#c9d2f2}
#hud .conn{position:absolute;bottom:2%;right:1%;padding:.5em .8em;color:#8f9bc4}
#hud .conn i{display:inline-block;width:.7em;height:.7em;margin-right:.5em;background:#5fe36c}
#hud .conn.off{color:#ff8f6b}
#hud .conn.off i{background:#f2545b}
#hud .lost{position:absolute;top:42%;left:50%;transform:translateX(-50%);padding:1em 1.4em;text-align:center;line-height:1.7;
  border-color:#ff8f6b;display:none}
#hud .lost b{display:block;color:#ff8f6b;font-size:1.5em}
#hud.in-storage .bar,#hud.in-storage .conn,#hud.in-storage .tip,#hud.in-storage .banner,#hud.in-storage .lost{display:none}
#hud.in-storage .tools{display:none}
#hud.empty .bar{display:none}
#hud.in-battle #storageBtn{display:none}
#hud.in-battle .bar,#hud.in-battle .tools #demoBtn,#hud.in-battle .conn,#hud.in-battle .tip,#hud.in-battle .banner{display:none}
#hud.in-battle .tools{top:9%;bottom:auto;right:auto;left:50%;transform:translateX(-50%)}
#hud.in-battle .tools button{padding:.35em .6em;opacity:.75}
`;

const meterRow = (label, id, mark = false) => `
  <div class="row"><span class="lbl" id="${id}Name">${label}</span>
    <div class="track"><div class="fill" id="${id}"></div>${mark ? '<div class="mark"></div>' : ""}</div>
    <span class="num" id="${id}Num"></span></div>`;

export function mountStatusBar(parent, { onDemoBoss, onStorage }) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  parent.style.position = "relative";
  const hud = document.createElement("div");
  hud.id = "hud";
  hud.innerHTML = `
    <div class="bar plate">
      ${meterRow("Plant A", "wA", true)}${meterRow("Plant B", "wB", true)}${meterRow("Vigor", "health")}
      <div class="note" id="note"></div>
    </div>
    <div class="banner" id="banner">BOSS ALERT</div>
    <div class="tools">
      <button id="storageBtn" title="See your plants">Storage</button>
      <button id="demoBtn" title="Call a boss now, whatever the soil says">Demo boss</button>
      <button id="muteBtn" title="Sound on or off (M)"></button>
    </div>
    <div class="tip plate" id="tip">Dry soil calls a boss. Win the fight and the real plant is watered.</div>
    <div class="conn plate" id="conn"><i></i><span>Connecting</span></div>
    <div class="lost plate" id="lost"><b>No game server</b>The forest is only a picture until it is back.<br>Trying again...</div>`;
  parent.appendChild(hud);
  // The overlay sits exactly on the game picture, which is drawn 800 pixels wide, stretched to
  // fit the window and centred in it. The words grow with it.
  const fit = () => {
    const canvas = parent.querySelector("canvas");
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    const home = parent.getBoundingClientRect();
    hud.style.inset = "auto";
    hud.style.left = `${box.left - home.left}px`;
    hud.style.top = `${box.top - home.top}px`;
    hud.style.width = `${box.width}px`;
    hud.style.height = `${box.height}px`;
    hud.style.setProperty("--k", String(Math.max(1, box.width / 800)));
  };
  fit();
  window.addEventListener("resize", fit);

  const $ = (id) => hud.querySelector("#" + id);
  $("demoBtn").onclick = (event) => { event.currentTarget.blur(); audio.play("pick"); onDemoBoss(); };
  $("storageBtn").onclick = (event) => { event.currentTarget.blur(); audio.play("pick"); onStorage(); };
  const showMute = (muted) => { $("muteBtn").textContent = muted ? "Sound off" : "Sound on"; };
  showMute(audio.isMuted());
  audio.onMute(showMute);
  $("muteBtn").onclick = (event) => { event.currentTarget.blur(); audio.unlock(); audio.toggleMute(); };

  let connected = false;
  let everConnected = false;
  const meter = (id, pct, color) => {
    $(id).style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (color) $(id).style.background = color;
    $(id + "Num").textContent = `${Math.round(pct)}%`;
  };

  return {
    setConnected(on) {
      connected = on;
      everConnected = everConnected || on;
      $("conn").classList.toggle("off", !on);
      $("conn").querySelector("span").textContent = on ? "Server connected" : "Server offline";
      $("lost").style.display = on ? "none" : "block";
      $("demoBtn").disabled = !on;
    },
    render(s) {
      fit();
      const dry = (pct) => (pct < 25 ? "#f2545b" : pct < 50 ? "#f7d04a" : "#4ab8ff");
      // A plant that is not on the cube (its pad reads no tag) has no meter. With none there, no panel.
      const here = { A: true, B: true, ...(s.present || {}) };
      const anyHere = here.A || here.B;
      hud.classList.toggle("empty", !anyHere);
      for (const plant of ["A", "B"]) {
        const name = s.fighters && s.fighters[plant] ? s.fighters[plant].name : `Plant ${plant}`;
        $("w" + plant + "Name").textContent = name;
        $("w" + plant + "Name").parentElement.style.display = here[plant] ? "" : "none";
        if (here[plant]) meter("w" + plant, s.meters.water[plant], dry(s.meters.water[plant]));
      }
      const h = s.health ?? 100;
      meter("health", h, h > 60 ? "#5fe36c" : h > 30 ? "#f7d04a" : "#f2545b");

      const conditions = { healthy: "", weary: "Weary: the skill starts empty", wilting: "Wilting: the skill starts empty", wilted: "Wilted: hits weaker. Win a fight!" };
      const note = $("note");
      note.textContent = s.meters.stale ? "No soil readings: the cube is offline" : conditions[s.condition] || "";
      note.classList.toggle("bad", Boolean(s.meters.stale) || s.condition === "wilted");

      const banner = $("banner");
      banner.textContent = s.boss ? `Boss alert: ${s.boss.name}` : "Boss alert";
      banner.style.display = s.mode === "boss" ? "block" : "none";

      const thirsty = ["A", "B"].filter((p) => here[p] && s.meters.water[p] < 50).map((p) => (s.fighters && s.fighters[p] ? s.fighters[p].name : p));
      $("tip").textContent = !anyHere ? "No plant on the cube. Set one down and it follows you."
        : s.mode === "cooldown" || s.mode === "reward" ? "The boss is gone for now. The plants rest."
        : thirsty.length ? `${thirsty.join(" and ")} ${thirsty.length > 1 ? "are" : "is"} thirsty. A boss is on its way...`
        : "Dry soil calls a boss. Win the fight and the real plant is watered.";
      $("demoBtn").disabled = !connected || !anyHere || !["walking", "cooldown"].includes(s.mode);
    },
  };
}
