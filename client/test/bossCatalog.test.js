import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { bossDefinition, bossArt, bossMove, bossPalette } from "../src/data/bosses.js";
import { BOSS_ORDER } from "../src/state/bossRotation.js";
import { BOSS_FX } from "../src/render/bossFx.js";

test("both alternating bosses have unique, complete artwork and supported effects", () => {
  const keys = new Set();
  assert.deepEqual(BOSS_ORDER.map(id => bossDefinition(id).name), ["Drought Chomper", "Sporeling Trio"]);
  for (const id of BOSS_ORDER) {
    const art = bossArt(1, id);
    assert.ok(!keys.has(art.key)); keys.add(art.key);
    assert.ok(existsSync(new URL(`../public${art.file}`, import.meta.url)));
    for (const part of Object.keys(art.rig.parts)) {
      assert.ok(existsSync(new URL(`../public${art.rig.folder}/${part}.png`, import.meta.url)));
    }
    assert.ok(bossArt(3, id).height > art.height);
    for (const move of ["attack", "special", "guard"]) {
      assert.equal(typeof BOSS_FX[bossMove(1, move, id).fx], "function");
    }
    assert.ok(Number.isInteger(bossPalette(1, id).main));
  }
});
