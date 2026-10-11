// client/src/ui/hudText.js: What the HUD says, worked out from the server state. Pure, no Phaser. Owner: Role 3.
// Caption markup: "→" becomes a drawn arrow, {word} is drawn in the accent colour.

export const ATTRACT_CAPTIONS = [
  "These plants are {REAL} →",
  "Watch your plants’ {soil moisture}",
  "Open {storage} to check plant health",
];
export const DEMO_CAPTION = "Press {D} to start a battle";
export const DEFAULT_TITLE = "In-cub-ator · two real plants";

const FOREST_MODES = ["walking", "cooldown"];

export function isForestMode(mode) {
  return FOREST_MODES.includes(mode);
}

// The server says so (v2); an older server: whenever the forest is up.
export function demoAvailable(state) {
  if (!state) return false;
  if (typeof state.demo_available === "boolean") return state.demo_available;
  return isForestMode(state.mode);
}

// 19500 -> "19.5", 2000 -> "2"
export function seconds(ms) {
  const s = Math.round((Number(ms) || 0) / 100) / 10;
  return Number.isInteger(s) ? String(s) : s.toFixed(1);
}

// Top-left line: today's watering, or the title before the first fight.
export function statsLine(state) {
  const stats = state && state.stats;
  if (!stats || !(stats.fights > 0)) return state?.health != null ? `${String(state.condition || "healthy").toUpperCase()} · health ${Math.round(state.health)}%` : DEFAULT_TITLE;
  const times = Math.max(0, Math.round(Number(stats.waterings) || 0));
  return `Watered ${times}× today · ${seconds(stats.water_ms)} s of water`;
}

export function plantName(state, id, fallback) {
  const fighter = state && state.fighters && state.fighters[id];
  return (fighter && fighter.name) || fallback || id;
}

// A plant's water as an integer percent, or null when unknown.
export function waterPercent(state, id) {
  const water = state && state.meters && state.meters.water ? state.meters.water[id] : null;
  if (water === null || water === undefined || !Number.isFinite(Number(water))) return null;
  return Math.max(0, Math.min(100, Math.round(Number(water))));
}

// The server's thirsty flag (v2), else the old rule: under 50%.
export function isThirsty(state, id) {
  const flags = state && state.meters && state.meters.thirsty;
  if (flags && typeof flags[id] === "boolean") return flags[id];
  const water = waterPercent(state, id);
  return water !== null && water < 50;
}

const BLOCKED = {
  pump_resting: "the pump is resting, water comes next time",
  soil_wet: "its soil is already wet, no water needed",
  offline: "the sensor is offline, so no water",
  budget: "it had plenty of water this hour",
  publish_failed: "the pump didn't answer",
};

// What the last fight did, for the ribbon during cooldown. null when there is nothing to say.
export function resultCaption(state, fallbackNames = {}) {
  if (!state) return null;
  const result = state.result;
  if (result && result.plant) {
    const name = `{${plantName(state, result.plant, fallbackNames[result.plant])}}`;
    if (result.outcome === "won") {
      if (result.simulated && result.increase > 0) return `${name} won → simulated water +${result.increase}%`;
      if (result.water_ms > 0) return `${name} won → pump command ${seconds(result.water_ms)} s · awaiting sensor`;
      return `${name} won · ${BLOCKED[result.blocked] || "no water this time"}`;
    }
    if (result.outcome === "lost") return `${name} lost · it stays thirsty until the next fight`;
    if (result.outcome === "dismissed") return `The boss left · ${name}'s soil got wet`;
    return null;
  }
  // older server: only the last reward is known
  const reward = state.reward;
  if (reward && reward.plant && reward.size > 0) {
    const name = `{${plantName(state, reward.plant, fallbackNames[reward.plant])}}`;
    return `${name} won → the real pump gave it ${seconds(reward.size)} s of water`;
  }
  return null;
}

// The captions the bottom ribbon cycles through in this state (empty: hide the ribbon).
// options.demo overrides whether the demo caption is offered (the HUD drops it while offline).
export function ribbonCaptions(state, fallbackNames = {}, options = {}) {
  if (!state) return [];
  const demo = options.demo ?? demoAvailable(state);
  if (state.mode === "walking") return demo ? [...ATTRACT_CAPTIONS, DEMO_CAPTION] : [...ATTRACT_CAPTIONS];
  if (state.mode === "cooldown") {
    const list = [];
    const result = resultCaption(state, fallbackNames);
    if (result) list.push(result);
    list.push("Resting after the fight…");
    if (demo) list.push(DEMO_CAPTION);
    return list;
  }
  return [];
}

// Splits caption markup into pieces: {text, accent} and {arrow: true}.
export function parseCaption(caption) {
  const pieces = [];
  const re = /(\{[^}]*\}|→)/g;
  let last = 0;
  let match;
  while ((match = re.exec(caption))) {
    if (match.index > last) pieces.push({ text: caption.slice(last, match.index), accent: false });
    if (match[0] === "→") pieces.push({ arrow: true });
    else pieces.push({ text: match[0].slice(1, -1), accent: true });
    last = match.index + match[0].length;
  }
  if (last < caption.length) pieces.push({ text: caption.slice(last), accent: false });
  return pieces;
}
