// client/src/ui/notify.js: "Your plant is thirsty" notifications. Owner: Role 3 (client, art, demo).
// The server sends thirsty: {A, B} (dry for long enough to call a boss). A plant is announced once
// per dry spell, and only while the forest is calm (not during a fight or the cooldown after one). It
// is announced again only after its soil got wet. This shows an in-game banner with a sound, flashes
// the tab title, and, where the browser allows it (https pages only), a system notification.
// Nothing here waters anything: only a won fight does.
import { audio } from "../audio.js";

const css = `
#thirst{position:absolute;top:24%;left:50%;transform:translateX(-50%);z-index:30;pointer-events:auto;cursor:pointer;
  padding:.8em 1.2em;font:calc(9px*var(--k,1.5)) "Silkscreen",ui-monospace,monospace;text-transform:uppercase;text-align:center;
  color:#dff3ff;background:linear-gradient(#0f2a48 55%,#0b1f38 55%);border:2px solid #4ab8ff;box-shadow:2px 3px 0 rgba(5,7,15,.45);
  display:none;line-height:1.6}
#thirst b{display:block;color:#7fd0ff;font-size:1.25em}
`;

export function mountThirstNotifier(parent, nameOf) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  const box = document.createElement("div");
  box.id = "thirst";
  (parent.querySelector("#hud") || parent).appendChild(box);
  box.onclick = () => { box.style.display = "none"; };

  // System notifications need a secure page and the player's permission, asked on their first tap.
  const canNotify = typeof window.Notification === "function" && window.isSecureContext;
  if (canNotify && Notification.permission === "default") {
    window.addEventListener("pointerdown", () => Notification.requestPermission().catch(() => {}), { once: true });
  }

  const baseTitle = document.title;
  let titleTimer = null;
  const flashTitle = (text) => {
    clearInterval(titleTimer);
    let on = false;
    titleTimer = setInterval(() => { on = !on; document.title = on ? text : baseTitle; }, 1000);
  };
  const stopTitle = () => { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) stopTitle(); });

  const told = { A: false, B: false };   // announced in this dry spell
  let hideTimer = null;
  return {
    update(state) {
      const now = { A: false, B: false, ...(state && state.thirsty) };
      for (const p of ["A", "B"]) if (!now[p]) told[p] = false;   // wet again: a new dry spell may be told
      if (!state || state.mode !== "walking") return;               // a fight or the cooldown: stay quiet
      const fresh = ["A", "B"].filter((p) => now[p] && !told[p]);
      for (const p of fresh) told[p] = true;
      if (!fresh.length) return;
      const names = fresh.map(nameOf).join(" and ");
      const many = fresh.length > 1;
      const title = `${names} ${many ? "are" : "is"} thirsty!`;
      const body = "Its soil is getting dry. Fight the boss to water it.";
      box.innerHTML = `<b>${title}</b>${body}`;
      box.style.display = "block";
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => { box.style.display = "none"; }, 8000);
      audio.play("alarm");
      if (document.hidden) flashTitle(`💧 ${title}`);
      if (canNotify && Notification.permission === "granted") {
        try { new Notification(title, { body, tag: "incube-thirst" }); } catch { /* some phones only allow it from a service worker */ }
      }
    },
  };
}
