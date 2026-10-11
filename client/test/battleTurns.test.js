// Run: cd client && npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextBattleEvent, resultFor, describeTurn, resultWords, intentOf, COUNTER } from "../src/state/battleTurns.js";

const battle = (over = {}) => ({ id: "a1", turn: 0, blooms: 0, intent: { move: "attack", counter: "guard" }, last_move: null, ...over });

test("a different fight id is a new fight, even at the same turn number", () => {
  assert.equal(nextBattleEvent(null, battle()).kind, "fight");
  assert.equal(nextBattleEvent(battle({ id: "a1", turn: 3 }), battle({ id: "b2", turn: 3 })).kind, "fight");
});

test("exactly one new turn is played, a repeat snapshot is not", () => {
  const lm = { creature: "guard", boss: "attack", hit: "creature", dealt: 8, taken: 0, healed: 0 };
  const ev = nextBattleEvent(battle(), battle({ turn: 1, last_move: lm }));
  assert.equal(ev.kind, "turn");
  assert.equal(ev.move, lm);
  assert.equal(nextBattleEvent(battle({ turn: 1 }), battle({ turn: 1, last_move: lm })).kind, "none");
});

test("two turns at once are caught up, not animated", () => {
  assert.equal(nextBattleEvent(battle(), battle({ turn: 2, last_move: {} })).kind, "jump");
});

test("a result only counts for the fight on screen", () => {
  const state = { result: { fight: "a1", outcome: "won" } };
  assert.ok(resultFor(state, "a1"));
  assert.equal(resultFor(state, "zz"), null);
  assert.equal(resultFor({ result: null }, "a1"), null);
});

test("intent: a hidden move reads as ?", () => {
  assert.equal(intentOf(battle({ intent: { move: null, counter: null } })), "?");
  assert.equal(intentOf(battle()), "attack");
  assert.equal(intentOf(battle({ intent: null })), null);
});

test("describeTurn tells who won, whether the sign was countered and what happened to blooms", () => {
  const prev = battle({ blooms: 2 });
  const win = describeTurn(prev, { creature: COUNTER.attack, boss: "attack", hit: "creature", dealt: 8, taken: 0, healed: 0, bloom_gain: 1 });
  assert.equal(win.verdict, "win");
  assert.equal(win.countered, true);
  assert.equal(win.bloomGain, 1);
  const lose = describeTurn(prev, { creature: "special", boss: "attack", hit: "boss", dealt: 0, taken: 7, healed: 0 });
  assert.equal(lose.verdict, "lose");
  assert.equal(lose.bloomsWiped, true);
  const skill = describeTurn(prev, { creature: "skill", boss: "guard", hit: "creature", dealt: 16, taken: 0, healed: 0, skill: "Thorn Burst", blooms_spent: 2 });
  assert.equal(skill.verdict, "skill");
  assert.equal(skill.bloomsSpent, 2);
  assert.equal(skill.bloomsWiped, false);
});

test("result words never claim water that was not given", () => {
  const given = resultWords({ outcome: "won", plant: "A", water_ms: 2000, blocked: null }, "Ember");
  assert.equal(given.water, true);
  assert.match(given.detail, /2\.0 s/);
  for (const blocked of ["pump_resting", "soil_wet", "offline", "budget", "publish_failed"]) {
    const w = resultWords({ outcome: "won", plant: "A", water_ms: 0, blocked }, "Ember");
    assert.equal(w.water, false);
    assert.doesNotMatch(w.detail, /s of real water/);
  }
  assert.equal(resultWords({ outcome: "lost", plant: "B" }, "Zest").title, "DEFEAT");
});
