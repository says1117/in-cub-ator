// client/src/audio/music.js: The adaptive music, generated note by note. Owner: Role 3 (client, art, demo).
// A lookahead scheduler: tick(now) is called about every 25 ms and books every note that falls in
// the next 100 ms at its exact context time. Each state is a "layer" with its own gain node, so
// changing state crossfades: the old layer fades out and stops booking notes, the new one fades in.
//
//   forest   wind (filtered noise) with a slow swell, rare bird chirps, a gentle major-key melody and warm plucked chords
//   boss     a tritone sting, then a low drone with a timpani pulse
//   battle   140 BPM in D minor: square bass, kick, snare, soft hats. An intensity sub-layer adds
//            16th hats and an arpeggio; a heartbeat sub-layer adds a double thump.
//   victory  a one-shot jingle (about 1.9 s), then silence
//   defeat   a one-shot jingle (about 1.9 s), then silence

const LOOKAHEAD = 0.1;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Music {
  constructor(ctx, synth, out) {
    this.ctx = ctx;
    this.s = synth;
    this.out = out;          // the music bus
    this.layers = [];        // live and fading layers
    this.state = null;
    this.intensity = 0;
    this.heartbeat = false;
    this.quiet = false;
  }

  // Switch to a state at context time `at`.
  set(state, at) {
    if (state === this.state && state !== "victory" && state !== "defeat") return;
    for (const layer of this.layers) if (!layer.stopping) this.fadeOut(layer, at, state === "boss" ? 0.25 : 0.8);
    this.state = state;
    if (!state || !BUILDERS[state]) { this.state = null; return; }
    const layer = BUILDERS[state](this, at);
    layer.state = state;
    this.layers.push(layer);
    if (layer.oneShot) this.state = null;     // a jingle plays once, then the music is silent
    this.applyQuiet(at);
  }

  fadeOut(layer, at, over) {
    layer.stopping = true;
    layer.stopAt = at + over;
    const g = layer.bus.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
    else { g.cancelScheduledValues(at); g.setValueAtTime(g.value, at); }
    g.linearRampToValueAtTime(0, at + over);
    for (const src of layer.loops) { try { src.stop(at + over + 0.05); } catch { /* already stopped */ } }
  }

  // Books notes up to now + LOOKAHEAD and drops layers that have finished fading.
  tick(now) {
    for (const layer of this.layers) {
      if (!layer.step) continue;
      const until = Math.min(now + LOOKAHEAD, layer.stopAt);
      while (layer.next < until) {
        this.s.p = 1;
        this.s.sink = null;
        layer.step(layer.i, layer.next);
        layer.i += 1;
        layer.next += layer.stepDur;
      }
    }
    this.layers = this.layers.filter((layer) => {
      if (now < layer.stopAt + 0.2) return true;
      layer.bus.disconnect();
      return false;
    });
    return this.layers.length > 0;
  }

  setIntensity(x, at) {
    this.intensity = Math.min(1, Math.max(0, x));
    for (const layer of this.layers) if (layer.intense) layer.intense.gain.setTargetAtTime(this.intensity, at, 0.3);
  }

  setHeartbeat(on, at) {
    this.heartbeat = on;
    for (const layer of this.layers) if (layer.heart) layer.heart.gain.setTargetAtTime(on ? 1 : 0, at, 0.1);
  }

  // Quiet (autopilot / attract): the boss and battle loops go silent; jingles and the forest stay.
  setQuiet(on, at) {
    this.quiet = on;
    this.applyQuiet(at);
  }

  applyQuiet(at) {
    for (const layer of this.layers) {
      if (layer.gate) layer.gate.gain.setTargetAtTime(this.quiet ? 0 : 1, at, 0.25);
    }
  }

  stopAll(at) {
    for (const layer of this.layers) if (!layer.stopping) this.fadeOut(layer, at, 0.3);
    this.state = null;
  }
}

// A layer: a bus that fades in, an optional gate (for quiet mode), and a step function.
function makeLayer(m, at, { level, fadeIn, stepDur, gated }) {
  const ctx = m.ctx;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0, at);
  bus.gain.linearRampToValueAtTime(level, at + fadeIn);
  let head = bus;
  let gate = null;
  if (gated) {
    gate = ctx.createGain();
    gate.gain.value = m.quiet ? 0 : 1;
    gate.connect(bus);
    head = gate;
  }
  bus.connect(m.out);
  return { bus, gate, input: head, loops: [], stepDur, next: at + 0.05, i: 0, stopAt: Infinity, stopping: false };
}

const BUILDERS = {
  forest(m, at) {
    const layer = makeLayer(m, at, { level: 0.9, fadeIn: 1.5, stepDur: 60 / 90 / 2, gated: false });
    const ctx = m.ctx;
    // wind: looping noise, band-passed, with a slow swell
    const src = ctx.createBufferSource();
    src.buffer = m.s.noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 450;
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const swell = ctx.createOscillator();
    const depth = ctx.createGain();
    swell.frequency.value = 0.08;
    depth.gain.value = 0.015;
    swell.connect(depth).connect(g.gain);
    src.connect(bp).connect(g).connect(layer.input);
    src.start(at);
    swell.start(at);
    layer.loops.push(src, swell);
    // A soft C-major pentatonic tune, with space between phrases.
    const notes = [523.25, 587.33, 659.25, 783.99, 880];
    const melody = [0, null, 2, 3, 4, null, 3, 2, 1, null, 2, 3, 2, null, 0, null,
                    2, null, 3, 4, 3, null, 2, 1, 0, null, 1, 2, 0, null, null, null];
    const chords = [[130.81, 164.81, 196], [174.61, 220, 261.63],
                    [110, 130.81, 164.81], [196, 246.94, 293.66]];
    layer.step = (i, t) => {
      const note = melody[i % melody.length];
      if (note !== null) {
        m.s.tone(layer.input, { type: "triangle", f0: notes[note], t, a: 0.025, d: 0.42, gain: 0.09 });
        m.s.tone(layer.input, { type: "sine", f0: notes[note] * 2, t, a: 0.03, d: 0.65, gain: 0.018 });
      }
      const chord = chords[Math.floor(i / 8) % chords.length];
      if (i % 4 === 0) {
        chord.forEach((f, j) => m.s.tone(layer.input, { type: "sine", f0: f * 2, t: t + j * 0.045, a: 0.02, d: 0.95, gain: 0.025 }));
        m.s.tone(layer.input, { type: "triangle", f0: chord[0], t, a: 0.02, d: 0.5, gain: 0.06 });
      }
      if (Math.random() < 0.035) {
        const n = 2 + Math.floor(Math.random() * 2);
        const base = rand(2200, 2800);
        for (let k = 0; k < n; k++) m.s.tone(layer.input, { type: "sine", f0: base, f1: base * 1.25, t: t + k * 0.09, a: 0.005, d: 0.05, gain: 0.025 });
      }
    };
    return layer;
  },

  boss(m, at) {
    const layer = makeLayer(m, at, { level: 0.9, fadeIn: 0.05, stepDur: 60 / 70, gated: true });
    const s = m.s;
    const t0 = at + 0.05;
    // the sting: a tritone that opens up
    for (const f of [73.42, 103.83]) {
      s.tone(layer.input, { type: "sawtooth", f0: f, t: t0, a: 0.02, d: 1.6, gain: 0.12, filter: { type: "lowpass", f0: 200, f1: 2000, over: 0.4 } });
    }
    // a low drone under the arrival
    const ctx = m.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0, t0);
    dg.gain.linearRampToValueAtTime(0.08, t0 + 1.2);
    lp.connect(dg).connect(layer.input);
    for (const f of [36.71, 37.1]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.connect(lp);
      osc.start(t0);
      layer.loops.push(osc);
    }
    layer.next = t0 + 1.2;
    layer.step = (i, t) => {
      s.tone(layer.input, { type: "sine", f0: 73.42, f1: 60, t, a: 0.004, d: 0.4, gain: 0.3 });
    };
    return layer;
  },

  battle(m, at) {
    const layer = makeLayer(m, at, { level: 0.9, fadeIn: 0.4, stepDur: 60 / 140 / 4, gated: true });
    const ctx = m.ctx;
    const s = m.s;
    layer.intense = ctx.createGain();
    layer.intense.gain.value = m.intensity;
    layer.intense.connect(layer.input);
    layer.heart = ctx.createGain();
    layer.heart.gain.value = m.heartbeat ? 1 : 0;
    layer.heart.connect(layer.input);
    const roots = [73.42, 58.27, 65.41, 55];               // Dm, Bb, C, A
    const bassPattern = [1, 1, 2, 1, 1.5, 1, 2, 1.5];
    const arp = [1, 1.189, 1.498, 2];                         // minor triad and octave
    const input = layer.input;
    layer.step = (i, t) => {
      const step = i % 16;
      const root = roots[Math.floor(i / 16) % roots.length];
      if (step % 2 === 0) {
        s.tone(input, { type: "square", f0: root * bassPattern[step / 2], t, a: 0.004, d: 0.09, gain: 0.1, filter: { type: "lowpass", f0: 700, fixed: true }, fixed: true });
        s.noise(input, { t, a: 0.001, d: 0.025, gain: 0.03, filter: { type: "highpass", f0: 6000, fixed: true }, filter2: { type: "lowpass", f0: 9000, fixed: true } });
      } else {
        s.noise(layer.intense, { t, a: 0.001, d: 0.02, gain: 0.025, filter: { type: "highpass", f0: 6000, fixed: true }, filter2: { type: "lowpass", f0: 9000, fixed: true } });
      }
      if (step === 0 || step === 8) s.tone(input, { type: "sine", f0: 150, f1: 40, t, a: 0.002, d: 0.12, gain: 0.4, fixed: true });
      if (step === 4 || step === 12) s.noise(input, { t, a: 0.001, d: 0.08, gain: 0.1, filter: { type: "bandpass", f0: 1800, q: 0.8, fixed: true } });
      s.tone(layer.intense, { type: "triangle", f0: root * 4 * arp[step % 4], t, a: 0.003, d: 0.08, gain: 0.04, filter: { type: "lowpass", f0: 2500, fixed: true }, fixed: true });
      if (step % 8 === 0) {
        s.tone(layer.heart, { type: "sine", f0: 60, f1: 45, t, a: 0.005, d: 0.15, gain: 0.35, fixed: true });
        s.tone(layer.heart, { type: "sine", f0: 58, f1: 44, t: t + 0.18, a: 0.005, d: 0.13, gain: 0.25, fixed: true });
      }
    };
    return layer;
  },

  victory(m, at) {
    const layer = makeLayer(m, at, { level: 1, fadeIn: 0.01, gated: false });
    const s = m.s;
    const t0 = at + 0.05;
    const lp = { type: "lowpass", f0: 3000, fixed: true };
    const lead = [[523.25, 0, 0.12], [659.25, 0.12, 0.12], [783.99, 0.24, 0.12], [1046.5, 0.36, 0.45]];
    for (const [f, dt, d] of lead) s.tone(layer.input, { type: "square", f0: f, t: t0 + dt, a: 0.004, d, gain: 0.07, filter: lp, fixed: true });
    for (const [f, dt, d] of [[130.81, 0, 0.36], [196, 0.36, 0.4]]) s.tone(layer.input, { type: "triangle", f0: f, t: t0 + dt, a: 0.005, d, gain: 0.18, fixed: true });
    for (const f of [523.25, 659.25, 783.99, 261.63]) s.tone(layer.input, { type: "triangle", f0: f, t: t0 + 0.8, a: 0.02, d: 1.0, gain: 0.07, fixed: true });
    layer.oneShot = true;
    layer.stopping = true;
    layer.stopAt = t0 + 1.9;
    return layer;
  },

  defeat(m, at) {
    const layer = makeLayer(m, at, { level: 1, fadeIn: 0.01, gated: false });
    const s = m.s;
    const t0 = at + 0.05;
    let dt = 0;
    const lp = { type: "lowpass", f0: 2500, f1: 400, over: 1.6, fixed: true };
    for (const [f, d] of [[392, 0.22], [369.99, 0.26], [349.23, 0.32], [329.63, 0.9]]) {
      s.tone(layer.input, { type: "triangle", f0: f, t: t0 + dt, a: 0.01, d, gain: 0.14, filter: lp, fixed: true });
      dt += d;
    }
    s.tone(layer.input, { type: "sine", f0: 98, f1: 82.4, t: t0, a: 0.05, d: 1.6, gain: 0.2, fixed: true });
    layer.oneShot = true;
    layer.stopping = true;
    layer.stopAt = t0 + 1.9;
    return layer;
  },
};
