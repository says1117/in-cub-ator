// client/src/audio/cues.js: Every sound effect, as a short recipe. Owner: Role 3 (client, art, demo).
// A cue is fn(s, out, t, o, engine) and returns how long it lasts in seconds.
//   s       the Synth (s.tone / s.noise); s.p is already set to o.pitch
//   out     the voice's output node (gain, pan and voice limiting are handled by the engine)
//   t       the context time to start at
//   o       the caller's options: { pitch, gain, pan, durationMs }
//   engine  for side effects such as engine.duck()
// Levels are kept moderate and nothing sits much above 3 kHz for long: this plays in a public hall.

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// A handful of shared shapes.
const thump = (s, out, t, f0, f1, d, gain) => s.tone(out, { type: "sine", f0, f1, t, a: 0.003, d, gain, shape: true });
const click = (s, out, t, freq, gain = 0.2, d = 0.02) =>
  s.noise(out, { t, d, gain, filter: { type: "bandpass", f0: freq, q: 8 } });

export const CUES = {
  // ---- buttons and turn flow ----
  ui_hover(s, out, t) {
    s.tone(out, { type: "sine", f0: 1000, t, a: 0.002, d: 0.03, gain: 0.05 });
    return 0.035;
  },
  ui_select(s, out, t) {
    const lp = { type: "lowpass", f0: 3000 };
    s.tone(out, { type: "square", f0: 660, t, a: 0.002, d: 0.04, gain: 0.09, filter: lp });
    s.tone(out, { type: "square", f0: 990, t: t + 0.04, a: 0.002, d: 0.06, gain: 0.09, filter: lp });
    return 0.1;
  },
  ui_denied(s, out, t) {
    s.tone(out, { type: "square", f0: 180, f1: 140, t, a: 0.004, d: 0.12, gain: 0.12, filter: { type: "lowpass", f0: 1400 } });
    return 0.125;
  },
  your_turn(s, out, t) {
    s.tone(out, { type: "triangle", f0: 523.25, t, a: 0.004, d: 0.07, gain: 0.22 });
    s.tone(out, { type: "triangle", f0: 783.99, t: t + 0.07, a: 0.004, d: 0.12, gain: 0.22 });
    return 0.2;
  },
  // pitch: 1, 988/880, 1175/880 for the last three seconds
  tick(s, out, t) {
    s.tone(out, { type: "sine", f0: 880, t, a: 0.002, d: 0.06, gain: 0.18 });
    return 0.065;
  },
  time_up(s, out, t) {
    s.tone(out, { type: "triangle", f0: 440, f1: 220, t, a: 0.005, d: 0.26, gain: 0.25 });
    return 0.27;
  },
  reveal(s, out, t) {
    click(s, out, t, 2500, 0.25);
    click(s, out, t + 0.06, 2500, 0.25);
    s.tone(out, { type: "sine", f0: 1500, t: t + 0.06, a: 0.002, d: 0.14, gain: 0.07 });
    return 0.21;
  },
  flip(s, out, t) {
    s.noise(out, { t, a: 0.01, d: 0.06, gain: 0.18, filter: { type: "bandpass", f0: 1200, f1: 3000, q: 2 } });
    s.noise(out, { t: t + 0.07, a: 0.01, d: 0.06, gain: 0.18, filter: { type: "bandpass", f0: 3000, f1: 1500, q: 2 } });
    s.tone(out, { type: "sine", f0: 1760, t: t + 0.14, a: 0.002, d: 0.1, gain: 0.06 });
    return 0.25;
  },

  // ---- the rock-paper-scissors verdict ----
  clash_win(s, out, t) {
    const lp = { type: "lowpass", f0: 3500 };
    [523.25, 659.25, 783.99].forEach((f, i) => s.tone(out, { type: "square", f0: f, t: t + i * 0.05, a: 0.002, d: 0.06, gain: 0.07, filter: lp }));
    s.tone(out, { type: "sine", f0: 1046.5, t: t + 0.15, a: 0.004, d: 0.3, gain: 0.1 });
    return 0.46;
  },
  clash_lose(s, out, t) {
    const lp = { type: "lowpass", f0: 1200 };
    s.tone(out, { type: "sawtooth", f0: 330, f1: 311, t, a: 0.005, d: 0.22, gain: 0.12, filter: lp });
    s.tone(out, { type: "sawtooth", f0: 247, f1: 233, t: t + 0.02, a: 0.005, d: 0.22, gain: 0.1, filter: lp });
    return 0.25;
  },
  clash_tie(s, out, t) {
    s.tone(out, { type: "sine", f0: 1200, t, a: 0.002, d: 0.22, gain: 0.08 });
    s.tone(out, { type: "sine", f0: 1730, t, a: 0.002, d: 0.18, gain: 0.05 });
    s.tone(out, { type: "sine", f0: 1200, t: t + 0.09, a: 0.002, d: 0.2, gain: 0.06 });
    return 0.3;
  },

  // ---- the plant-care moves ----
  care_water(s, out, t) {
    for (let i = 0; i < 9; i++) {
      const f = 380 + (i % 3) * 180;
      s.tone(out, { type: "sine", f0: f, f1: f * 1.8, t: t + i * 0.05, a: 0.004, d: 0.055, gain: 0.09 });
    }
    s.noise(out, { t, a: 0.06, d: 0.45, gain: 0.08, filter: { type: "bandpass", f0: 1500, q: 0.8 } });
    return 0.55;
  },
  care_sunlight(s, out, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      s.tone(out, { type: "sine", f0: f, t: t + i * 0.09, a: 0.025, d: 0.7, gain: 0.09, tremolo: { rate: 6, depth: 0.2 } }));
    return 1;
  },
  plant_pop(s, out, t) {
    // A soft bubble burst and sparkling upward notes.
    s.tone(out, { type: "sine", f0: 520, f1: 170, t, a: 0.003, d: 0.12, gain: 0.15 });
    s.noise(out, { t, a: 0.002, d: 0.07, gain: 0.08, filter: { type: "lowpass", f0: 1800 } });
    [784, 1046.5, 1318.5].forEach((f, i) =>
      s.tone(out, { type: "sine", f0: f, t: t + 0.07 + i * 0.055, a: 0.005, d: 0.18, gain: 0.08 }));
    return 0.45;
  },
  care_fertilize(s, out, t) {
    [392, 493.88, 587.33].forEach((f, i) =>
      s.tone(out, { type: "triangle", f0: f, t: t + i * 0.08, a: 0.008, d: 0.24, gain: 0.08 }));
    return 0.5;
  },
  care_co2(s, out, t) {
    s.noise(out, { t, a: 0.12, d: 0.35, gain: 0.14, filter: { type: "bandpass", f0: 600, f1: 2200, q: 1.5 } });
    [220, 330, 440].forEach((f, i) =>
      s.tone(out, { type: "triangle", f0: f, f1: f * 2, t: t + i * 0.09, a: 0.02, d: 0.3, gain: 0.09 }));
    return 0.5;
  },
  leaf_flurry(s, out, t) {
    for (let i = 0; i < 5; i++) {
      s.noise(out, { t: t + i * 0.075, a: 0.025, d: 0.065, gain: 0.16, filter: { type: "bandpass", f0: 900, f1: 3200, q: 1.2 } });
      s.tone(out, { type: "triangle", f0: 650 + i * 180, f1: 350, t: t + i * 0.075, a: 0.002, d: 0.075, gain: 0.045 });
    }
    return 0.4;
  },

  // ---- blows ----
  whoosh(s, out, t) {
    s.noise(out, { t, a: 0.12, d: 0.08, gain: 0.3, filter: { type: "bandpass", f0: 400, f1: 2500, q: 1.2, over: 0.2 } });
    return 0.2;
  },
  hit_light(s, out, t) {
    s.noise(out, { t, a: 0.001, d: 0.045, gain: 0.45, filter: { type: "lowpass", f0: 1200 } });
    thump(s, out, t, 120, 50, 0.12, 0.55);
    s.tone(out, { type: "square", f0: 2000, t, a: 0.001, d: 0.008, gain: 0.04, filter: { type: "lowpass", f0: 3000 } });
    return 0.13;
  },
  hit_heavy(s, out, t, o, engine) {
    thump(s, out, t, 90, 35, 0.22, 0.75);
    s.noise(out, { t, a: 0.001, d: 0.08, gain: 0.45, filter: { type: "lowpass", f0: 900 } });
    s.noise(out, { t, a: 0.001, d: 0.02, gain: 0.15, filter: { type: "bandpass", f0: 2200, q: 1 } });
    engine.duck(260, t);
    return 0.23;
  },
  clang(s, out, t) {
    [[523, 0.16], [1307, 0.08], [2093, 0.04]].forEach(([f, g]) => s.tone(out, { type: "sine", f0: f, t, a: 0.002, d: 0.35, gain: g }));
    s.noise(out, { t, a: 0.001, d: 0.015, gain: 0.1, filter: { type: "highpass", f0: 3000 }, filter2: { type: "lowpass", f0: 7000 } });
    return 0.36;
  },
  // A blow turned aside: a bright "shing" with a falling scrape.
  parry(s, out, t) {
    s.tone(out, { type: "sine", f0: 784, t, a: 0.002, d: 0.25, gain: 0.12 });
    s.tone(out, { type: "sine", f0: 1960, t, a: 0.002, d: 0.16, gain: 0.04 });
    s.noise(out, { t, a: 0.003, d: 0.12, gain: 0.14, filter: { type: "bandpass", f0: 3000, f1: 1200, q: 3 } });
    return 0.26;
  },

  // ---- the plants' moves ----
  petals(s, out, t) {
    for (let i = 0; i < 8; i++) {
      s.tone(out, { type: "sine", f0: rand(1500, 2600), t: t + i * 0.03, a: 0.003, d: 0.04, gain: 0.07 });
    }
    return 0.28;
  },
  thorns(s, out, t) {
    for (let i = 0; i < 6; i++) {
      s.tone(out, { type: "sawtooth", f0: 900, f1: 300, t: t + i * 0.03, a: 0.003, d: 0.07, gain: 0.07, filter: { type: "lowpass", f0: 2500 } });
    }
    return 0.23;
  },
  heal(s, out, t) {
    [523.25, 659.25, 783.99, 987.77].forEach((f, i) =>
      s.tone(out, { type: "sine", f0: f, t: t + i * 0.03, a: 0.15, d: 0.7, gain: 0.06, tremolo: { rate: 8, depth: 0.35 } }));
    return 0.95;
  },
  bark(s, out, t) {
    for (let i = 0; i < 4; i++) {
      const at = t + i * 0.045;
      s.noise(out, { t: at, a: 0.002, d: 0.06, gain: 0.3, filter: { type: "lowpass", f0: 500 } });
      s.tone(out, { type: "square", f0: 110, t: at, a: 0.002, d: 0.08, gain: 0.1, filter: { type: "lowpass", f0: 600 } });
    }
    return 0.22;
  },

  // ---- blooms ----
  // pitch: 1 / 1.26 / 1.5 for the 1st / 2nd / 3rd bloom (C, E, G)
  bloom_gain(s, out, t) {
    s.tone(out, { type: "sine", f0: 1046.5, t, a: 0.004, d: 0.4, gain: 0.11 });
    s.tone(out, { type: "triangle", f0: 523.25, t, a: 0.004, d: 0.45, gain: 0.08 });
    s.tone(out, { type: "sine", f0: 1568, t: t + 0.04, a: 0.004, d: 0.25, gain: 0.025 });
    return 0.46;
  },
  bloom_wipe(s, out, t) {
    s.tone(out, { type: "triangle", f0: 700, f1: 250, t, a: 0.01, d: 0.35, gain: 0.16, vibrato: { rate: 9, depth: 18 } });
    s.noise(out, { t, a: 0.02, d: 0.3, gain: 0.1, filter: { type: "lowpass", f0: 1500, f1: 500 } });
    return 0.37;
  },
  // durationMs: how long the charge-up lasts before the boom (default 600)
  unleash(s, out, t, o, engine) {
    const charge = Math.min(2, Math.max(0.2, (o.durationMs ?? 600) / 1000));
    s.noise(out, { t, a: charge, d: 0.04, gain: 0.22, filter: { type: "bandpass", f0: 300, f1: 2000, q: 1.5, over: charge } });
    [146.8, 220, 293.7].forEach((f) =>
      s.tone(out, { type: "sawtooth", f0: f, f1: f * 2, t, a: charge, d: 0.05, gain: 0.04, filter: { type: "lowpass", f0: 600, f1: 2400, over: charge } }));
    const hit = t + charge;
    thump(s, out, hit, 55, 30, 0.6, 0.8);
    s.noise(out, { t: hit, a: 0.002, d: 0.45, gain: 0.4, filter: { type: "lowpass", f0: 4000, f1: 200 } });
    engine.duck(900, hit);
    return charge + 0.61;
  },

  // ---- the boss ----
  boss_roar(s, out, t, o, engine) {
    const lp = { type: "lowpass", f0: 600, fixed: true };
    for (const f of [70, 73]) {
      s.tone(out, { type: "sawtooth", f0: f, f1: f * 0.78, t, a: 0.08, d: 1.2, gain: 0.22, shape: true, filter: lp, tremolo: { rate: 18, depth: 0.45 } });
    }
    s.noise(out, { t, a: 0.1, d: 1.1, gain: 0.18, filter: { type: "lowpass", f0: 700, f1: 300 }, filter2: { type: "highpass", f0: 120 } });
    engine.duck(900, t);
    return 1.29;
  },
  boss_bite(s, out, t) {
    s.noise(out, { t, a: 0.001, d: 0.03, gain: 0.3, filter: { type: "bandpass", f0: 1500, q: 1.5 } });
    thump(s, out, t, 150, 60, 0.08, 0.45);
    thump(s, out, t + 0.07, 140, 55, 0.1, 0.5);
    return 0.18;
  },
  boss_laser_charge(s, out, t) {
    s.tone(out, { type: "sawtooth", f0: 110, f1: 880, t, a: 0.4, d: 0.1, gain: 0.12,
      filter: { type: "lowpass", f0: 1800 }, vibrato: { rate: 18, depth: 25 } });
    return 0.5;
  },
  boss_laser(s, out, t) {
    s.noise(out, { t, a: 0.01, d: 0.55, gain: 0.3,
      filter: { type: "bandpass", f0: 1600, f1: 400, q: 0.8 } });
    s.tone(out, { type: "sawtooth", f0: 760, f1: 130, t, a: 0.008, d: 0.55, gain: 0.16,
      filter: { type: "lowpass", f0: 2200 } });
    thump(s, out, t, 95, 38, 0.4, 0.55);
    return 0.65;
  },
  boss_orb(s, out, t) {
    s.tone(out, { type: "sine", f0: 200, f1: 600, t, a: 0.3, d: 0.08, gain: 0.16, vibrato: { rate: 14, depth: 20 } });
    s.noise(out, { t: t + 0.35, a: 0.02, d: 0.28, gain: 0.25, filter: { type: "bandpass", f0: 800, f1: 300, q: 1.2 } });
    s.tone(out, { type: "triangle", f0: 300, f1: 120, t: t + 0.35, a: 0.005, d: 0.25, gain: 0.12 });
    return 0.66;
  },

  // ---- plants hurt, fainting and swapping ----
  hurt(s, out, t) {
    s.tone(out, { type: "square", f0: 600, f1: 200, t, a: 0.004, d: 0.15, gain: 0.1, filter: { type: "lowpass", f0: 2000 } });
    return 0.16;
  },
  faint(s, out, t) {
    s.tone(out, { type: "triangle", f0: 600, f1: 120, t, a: 0.01, d: 0.6, gain: 0.22, vibrato: { rate: 6, depth: 15 } });
    return 0.62;
  },
  swap_in(s, out, t) {
    s.tone(out, { type: "sine", f0: 300, f1: 900, t, a: 0.02, d: 0.24, gain: 0.18 });
    s.noise(out, { t, a: 0.03, d: 0.17, gain: 0.07, filter: { type: "bandpass", f0: 3500, q: 2 } });
    return 0.27;
  },
  ko(s, out, t, o, engine) {
    CUES.hit_heavy(s, out, t, o, engine);
    const boom = t + 0.15 + 0.23;           // 150 ms of silence after the blow, then the boom
    thump(s, out, boom, 55, 38, 0.6, 0.8);
    s.noise(out, { t: boom, a: 0.005, d: 0.6, gain: 0.25, filter: { type: "lowpass", f0: 600, f1: 120 } });
    engine.duck(1400, t);
    return boom - t + 0.61;
  },
  dissolve(s, out, t) {
    for (let i = 0; i < 20; i++) {
      s.tone(out, { type: "sine", f0: rand(1800, 3200), t: t + Math.pow(i / 20, 1.6) * 0.6, a: 0.003, d: 0.07, gain: 0.04 });
    }
    return 0.68;
  },

  // ---- result ----
  badge_earned(s, out, t) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      s.tone(out, { type: "sine", f0: f, t: t + i * .085, a: .006, d: .5, gain: .12 });
      s.tone(out, { type: "triangle", f0: f * 2, t: t + i * .085, a: .003, d: .25, gain: .035 });
    });
    return .85;
  },
  // durationMs: the real pump time, so the bubbling lasts as long as the water does
  victory_water(s, out, t, o) {
    const dur = Math.min(6, Math.max(0.3, (o.durationMs ?? 2000) / 1000));
    const count = Math.round(dur * 15);
    for (let i = 0; i < count; i++) {
      const f = rand(300, 900);
      s.tone(out, { type: "sine", f0: f, f1: f * 1.6, t: t + (i / count) * dur + rand(0, 0.04), a: 0.004, d: 0.04, gain: 0.1 });
    }
    s.noise(out, { t, a: 0.2, d: dur, gain: 0.03, filter: { type: "bandpass", f0: 1200, q: 0.8 } });
    return dur + 0.2;
  },
  defeat_sting(s, out, t) {
    const lp = { type: "lowpass", f0: 1800, f1: 400, over: 0.8 };
    s.tone(out, { type: "triangle", f0: 220, f1: 196, t, a: 0.02, d: 0.8, gain: 0.18, filter: lp });
    s.tone(out, { type: "triangle", f0: 146.8, f1: 138.6, t, a: 0.02, d: 0.8, gain: 0.16, filter: lp });
    return 0.82;
  },

  // ---- the forest and the boss's arrival ----
  step(s, out, t) {
    s.noise(out, { t, a: 0.002, d: 0.025, gain: 0.05, filter: { type: "lowpass", f0: 600 } });
    return 0.03;
  },
  hop(s, out, t) {
    s.tone(out, { type: "sine", f0: 220, f1: 160, t, a: 0.003, d: 0.04, gain: 0.07 });
    return 0.045;
  },
  spotted(s, out, t) {
    const lp = { type: "lowpass", f0: 3000 };
    s.tone(out, { type: "square", f0: 784, t, a: 0.002, d: 0.05, gain: 0.08, filter: lp });
    s.tone(out, { type: "square", f0: 1568, t: t + 0.055, a: 0.002, d: 0.08, gain: 0.07, filter: lp });
    s.tone(out, { type: "sawtooth", f0: 98, t, a: 0.01, d: 0.4, gain: 0.08, filter: { type: "lowpass", f0: 500 } });
    return 0.41;
  },
  bound(s, out, t) {
    thump(s, out, t, 80, 40, 0.2, 0.55);
    s.noise(out, { t, a: 0.002, d: 0.1, gain: 0.25, filter: { type: "lowpass", f0: 400 } });
    return 0.21;
  },
  // 75 ms of hush first: the silence makes the landing land.
  impact(s, out, t, o, engine) {
    engine.duck(1300, t, 0.02);
    const hit = t + 0.075;
    thump(s, out, hit, 60, 25, 0.7, 0.85);
    s.noise(out, { t: hit, a: 0.002, d: 0.5, gain: 0.45, filter: { type: "lowpass", f0: 8000, f1: 200 } });
    s.noise(out, { t: hit, a: 0.001, d: 0.03, gain: 0.2, shape: true, filter: { type: "highpass", f0: 1500 }, filter2: { type: "lowpass", f0: 6000 } });
    return 0.78;
  },
  // durationMs: delay from the crack to the trunk hitting the ground (default 850)
  tree_crack(s, out, t, o) {
    for (let i = 0; i < 30; i++) click(s, out, t + Math.pow(Math.random(), 1.5) * 0.4, rand(2200, 3400), 0.12, 0.008);
    const land = t + Math.min(3, Math.max(0.3, (o.durationMs ?? 850) / 1000));
    thump(s, out, land, 70, 40, 0.3, 0.5);
    s.noise(out, { t: land, a: 0.003, d: 0.25, gain: 0.25, filter: { type: "lowpass", f0: 300 } });
    return land - t + 0.31;
  },
  cut(s, out, t) {
    s.noise(out, { t, a: 0.25, d: 0.06, gain: 0.14, filter: { type: "highpass", f0: 200, f1: 6000, over: 0.3 }, filter2: { type: "lowpass", f0: 8000 } });
    return 0.31;
  },

  // ---- system ----
  demo_press(s, out, t) {
    const lp = { type: "lowpass", f0: 3000 };
    s.tone(out, { type: "square", f0: 988, t, a: 0.002, d: 0.06, gain: 0.08, filter: lp });
    s.tone(out, { type: "square", f0: 1319, t: t + 0.065, a: 0.002, d: 0.22, gain: 0.08, filter: lp });
    return 0.29;
  },
  connect(s, out, t) {
    s.tone(out, { type: "sine", f0: 523.25, t, a: 0.004, d: 0.08, gain: 0.1 });
    s.tone(out, { type: "sine", f0: 783.99, t: t + 0.09, a: 0.004, d: 0.12, gain: 0.1 });
    return 0.22;
  },
  disconnect(s, out, t) {
    s.tone(out, { type: "sine", f0: 783.99, t, a: 0.004, d: 0.08, gain: 0.1 });
    s.tone(out, { type: "sine", f0: 523.25, t: t + 0.09, a: 0.004, d: 0.14, gain: 0.1 });
    return 0.24;
  },
};

// Cues that may not repeat faster than this (ms). Walk cycles fire every frame they can.
export const MIN_GAP_MS = { step: 110, hop: 90, ui_hover: 60, tick: 250, petals: 80, dissolve: 200 };
// Cues muted while quiet (autopilot / attract).
export const QUIET_SKIP = new Set(["tick", "time_up", "ui_hover", "step"]);
