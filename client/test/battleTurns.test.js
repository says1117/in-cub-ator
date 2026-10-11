import test from 'node:test';
import assert from 'node:assert/strict';
import { nextBattleEvent, describeTurn, resultFor, resultWords } from '../src/state/battleTurns.js';

test('server snapshots enqueue each turn once and catch up after missed turns', () => {
  const a={id:'fight',turn:0}, b={id:'fight',turn:1,last_move:{creature:'guard',boss:'attack'}};
  assert.equal(nextBattleEvent(null,a).kind,'fight');
  assert.equal(nextBattleEvent(a,b).kind,'turn');
  assert.equal(nextBattleEvent(b,b).kind,'none');
  assert.equal(nextBattleEvent(a,{...b,turn:4}).kind,'jump');
  assert.equal(nextBattleEvent(b,{...b,id:'new'}).kind,'fight');
  assert.equal(nextBattleEvent(b,null).kind,'none');
});

test('server damage, healing and team swaps drive the turn presentation', () => {
  const d=describeTurn({intent:{move:'guard'},blooms:2},{creature:'skill',boss:'attack',skill:'Sunburst',hit:'both',dealt:6,taken:9,healed:8,blooms_spent:2,swap:{out:'A',in:'B'}});
  assert.deepEqual([d.dealt,d.taken,d.healed,d.bloomsSpent],[6,9,8,2]);
  assert.equal(d.verdict,'skill'); assert.equal(d.swap.in,'B');
  assert.equal(resultFor({result:{fight:'other'}},'fight'),null);
});

test('result text distinguishes simulated water, pump commands, and blocked rewards', () => {
  const sim=resultWords({outcome:'won',simulated:true,increase:20,soilMoisture:90},'Monstera');
  assert.match(sim.detail,/\+20%/); assert.match(sim.detail,/WebSocket/);
  const hardware=resultWords({outcome:'won',plant:'A',water_ms:2000},'Cast Iron');
  assert.match(hardware.detail,/awaiting soil sensor/);
  assert.match(resultWords({outcome:'won',blocked:'offline'},'Cast Iron').detail,/offline/);
});
