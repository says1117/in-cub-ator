// client/src/state/battleTurns.js: Turns two server snapshots into what the battle screen should play.
// Pure: no Phaser, no window. Tested with `node --test` (client/test/battleTurns.test.js).
//
// The server sends the whole state every time something changes. The battle screen needs events
// instead: "a new fight started", "this turn happened", "the fight ended like this". Each fight has
// an id and each turn a number, so nothing is played twice or skipped, and a page opened in the
// middle of a fight simply takes the current state as it is.

export const MOVES = ["attack", "guard", "special"];
export const BEATS = { attack: "special", special: "guard", guard: "attack" };
export const COUNTER = { attack: "guard", guard: "special", special: "attack" };

// What the boss showed before a turn: "attack", "guard", "special", or "?" when it hid its move.
export function intentOf(battle) {
  if (!battle || !battle.intent) return null;
  return battle.intent.move || "?";
}

// What changed between the last snapshot the screen played and the new one.
//   { kind: "none" }                       nothing to play
//   { kind: "fight", battle }              a different fight than the one on screen
//   { kind: "turn", prev, next, move }     exactly one new turn
//   { kind: "jump", next }                 several turns at once (a slow screen): just catch up
export function nextBattleEvent(shown, next) {
  if (!next) return { kind: "none" };
  if (!shown || shown.id !== next.id) return { kind: "fight", battle: next };
  if (next.turn === shown.turn + 1 && next.last_move) {
    return { kind: "turn", prev: shown, next, move: next.last_move };
  }
  if (next.turn > shown.turn) return { kind: "jump", next };
  return { kind: "none" };
}

// The result of the fight on screen, once the server has one for it.
export function resultFor(state, fightId) {
  const r = state && state.result;
  if (!r || !fightId || r.fight !== fightId) return null;
  return r;
}

// How one turn should be told, from the plant's side. Everything comes from the server's
// last_move: the screen never works out a rule on its own.
export function describeTurn(prev, move) {
  const shown = intentOf(prev);
  const skill = Boolean(move.skill);
  const hit = move.hit;                       // creature | boss | both | tie | none
  let verdict;
  if (skill) verdict = "skill";
  else if (hit === "creature") verdict = "win";
  else if (hit === "boss") verdict = "lose";
  else verdict = "tie";
  return {
    verdict,
    playerMove: move.creature,
    bossMove: move.boss,
    hidden: shown === "?",
    countered: !skill && shown !== "?" && shown !== null && move.creature === COUNTER[shown],
    plantLands: (move.dealt || 0) > 0 || (move.healed || 0) > 0,
    bossLands: (move.taken || 0) > 0,
    dealt: move.dealt || 0,
    taken: move.taken || 0,
    healed: move.healed || 0,
    bloomGain: Math.max(0, move.bloom_gain || 0),
    bloomsSpent: move.blooms_spent || 0,
    bloomsWiped: (move.taken || 0) > 0 && (prev.blooms || 0) > 0 && !skill,
    swap: move.swap || null,
    auto: Boolean(move.auto),
    skillName: move.skill || null,
  };
}

// The words for the result panel. Honest about water that was not given, and why.
export function resultWords(result, plantName) {
  const who = plantName || `Plant ${result.plant}`;
  if (result.outcome === "won") {
    if (result.water_ms > 0) {
      return { title: "VICTORY!", line: `${who} is drinking`, detail: `Pump ${result.plant} · ${(result.water_ms / 1000).toFixed(1)} s of real water`, water: true };
    }
    const why = {
      pump_resting: "It was watered moments ago, so the pump is resting.",
      soil_wet: "Its soil is already moist. No water needed.",
      offline: "The cube's sensors are offline, so no water this time.",
      budget: "It has had plenty of water this hour.",
      publish_failed: "The pump did not answer, so no water this time.",
    };
    return { title: "VICTORY!", line: `${who} is safe`, detail: why[result.blocked] || "No water this time.", water: false };
  }
  if (result.outcome === "lost") {
    return { title: "DEFEAT", line: `${who} is still thirsty`, detail: "The boss will be back soon. Tip: watch its sign and counter it.", water: false };
  }
  return { title: "THE BOSS FLED", line: "It slipped back into the trees", detail: "The soil got wet, or the sensors went quiet.", water: false };
}
