// client/src/state/mockSource.js: Fake game state so the client runs without a server. Owner: Role 3 (client, art, demo).
// Cycles pot A through: happy -> boss fight -> watering -> happy. Pot B stays happy.
export function mockSource(onState) {
  const t0 = performance.now();
  const hero = (n, c, hp) => ({ uid: n, name: n, level: 2, xp: 30, hp, max_hp: 36, attack: 8, color: c });
  const id = setInterval(() => {
    const t = (performance.now() - t0) / 1000, cyc = t % 20;
    const fight = cyc > 5 && cyc < 14;
    const bossHp = fight ? Math.max(0, Math.round(60 - (cyc - 5) * 6.7)) : 0;
    const A = {
      creature: hero("Sprout", "#6ccf5a", 36 - (fight ? Math.min(20, (cyc - 5) * 2) : 0)),
      soil_raw: fight ? 2800 : cyc >= 14 ? 1900 : 2100, water: fight ? 0.2 : 0.7, dry: fight,
      phase: fight ? "boss" : cyc >= 14 ? "watering" : "ok",
      boss: fight ? { name: "Drought Golem", hp: bossHp, max_hp: 60 } : null,
      last_hit: fight ? { by: Math.floor(cyc * 1.2) % 2 ? "boss" : "creature", dmg: 4 } : {},
    };
    const B = { creature: hero("Fern", "#4fb3d9", 36), soil_raw: 1800, water: 0.8, dry: false, phase: "ok", boss: null, last_hit: {} };
    onState({ t, esp32: "mock", sunlight: 60 + 20 * Math.sin(t / 5), light_on: false, pots: { A, B }, events: [] });
  }, 250);
  return { stop() { clearInterval(id); } };
}
