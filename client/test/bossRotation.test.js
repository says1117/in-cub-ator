import test from "node:test";
import assert from "node:assert/strict";
import { createBossRotation } from "../src/state/bossRotation.js";

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
}

test("completed encounters alternate both bosses; restarting and repeated completion are safe", () => {
  const saved = storage();
  let rotation = createBossRotation(saved);
  const first = rotation.begin();
  assert.equal(first.id, "drought-chomper");
  assert.deepEqual(rotation.begin(), first);
  rotation = createBossRotation(saved);
  assert.deepEqual(rotation.begin(), first);
  assert.equal(rotation.complete("stale-encounter"), false);
  assert.equal(rotation.complete(first.encounterId), true);
  assert.equal(rotation.complete(first.encounterId), false);
  const second = rotation.begin();
  assert.equal(second.id, "sporeling-trio");
  rotation.complete(second.encounterId);
  assert.equal(createBossRotation(saved).begin().id, "drought-chomper");
});

test("blocked or corrupted browser storage still permits a session rotation", () => {
  for (const saved of [null, { getItem: () => "invalid", setItem: () => { throw new Error("blocked"); } }]) {
    const rotation = createBossRotation(saved);
    const first = rotation.begin();
    rotation.complete(first.encounterId);
    assert.equal(rotation.begin().id, "sporeling-trio");
  }
});
