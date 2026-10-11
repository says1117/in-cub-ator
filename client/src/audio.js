// client/src/audio.js: Every sound in the game. Owner: Role 3 (client, art, demo).
// There are no sound files. Everything is built from oscillators and noise with the browser's
// Web Audio: layered voices (detuned stacks, FM bells, filter sweeps, distortion), a drum kit,
// a shared reverb, and two arranged songs.
//
//   audio.play("crit")            one effect: the names are the keys of SOUNDS below
//   audio.music("battle")         a song: "forest", "battle" or null for silence
//   audio.setRage(true)           the battle song gets faster and fuller
//   audio.toggleMute()            also on the M key
//
// Which sound goes with which event, and why it was chosen over the other candidates, is the
// table in PROJECT.md (section "Sound"). The audition page is /sounds.html on the dev server.
//
// A browser only lets a page make sound after a key press or a click, so nothing is heard until
// the first one. For a kiosk, start Chromium with --autoplay-policy=no-user-gesture-required.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let reverbIn = null;
let noiseBuffer = null;
let crush = null;          // a distortion curve
let muted = false;
try { muted = window.localStorage.getItem("incube-muted") === "1"; } catch { /* storage is optional */ }
const listeners = new Set();

const MASTER = 0.6;
const MUSIC = 0.38;

// Some sounds are short and need pushing up to sit next to the long ones. Each effect is scaled
// by its number here, found by measuring every effect (audio.measure) and listening.
const TRIM = {
  tick: 3, call: 2.5, no: 2, pick: 1.4, unmute: 2, move_generic: 6, graze: 2, miss: 2, hit: 1.8, hurt: 1.6,
  bound: 1.8, charged: 1.5, move_haymaker: 1.5, move_bladeRush: 1.5, move_flare: 1.3, bluff: 1.2,
};
let trim = 1;      // the scale for the effect being played right now

// ------------------------------------------------------------------ the sound system
function impulse(c, seconds, decay) {
  const length = Math.floor(c.sampleRate * seconds);
  const buffer = c.createBuffer(2, length, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const x = i / length;
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;     // a duller tail than plain noise
      data[i] = last * (1 - x) ** decay * Math.min(1, i / (c.sampleRate * 0.012));
    }
  }
  return buffer;
}

// Builds the mixing desk on a context (the live one, or an offline one for testing).
function build(c) {
  ctx = c;
  master = c.createGain();
  master.gain.value = muted ? 0 : MASTER;
  const squash = c.createDynamicsCompressor();      // a gentle limiter, so loud moments never crackle
  squash.threshold.value = -16; squash.knee.value = 12; squash.ratio.value = 6;
  squash.attack.value = 0.004; squash.release.value = 0.18;
  master.connect(squash).connect(c.destination);

  const room = c.createConvolver();
  room.buffer = impulse(c, 2.4, 2.6);
  reverbIn = c.createGain();
  const roomOut = c.createGain();
  roomOut.gain.value = 0.5;
  reverbIn.connect(room); room.connect(roomOut); roomOut.connect(master);

  sfxBus = c.createGain(); sfxBus.connect(master);
  musicBus = c.createGain(); musicBus.gain.value = MUSIC; musicBus.connect(master);

  noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  crush = new Float32Array(1024);
  for (let i = 0; i < crush.length; i++) {
    const x = (i / (crush.length - 1)) * 2 - 1;
    crush[i] = Math.tanh(x * 4.5);
  }
}

function start() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  build(new Ctx());
  return ctx;
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);   // a MIDI note number as a pitch
const rand = (a, b) => a + Math.random() * (b - a);

// One pitched voice. Options:
//   f, to, slide     pitch, where it slides to, and how long the slide takes
//   dur, vol, attack, hold      the loudness shape: rise, stay, then fade to nothing by `dur`
//   type             sine, triangle, square or sawtooth
//   unison, spread   several copies, spread apart by this many cents (a fat sound)
//   filter           { type, f, to, time, q }  a filter that sweeps
//   fm               { ratio, index, decay }   a bell or metal tone
//   vib              { rate, cents }           a wobble in the pitch
//   trem             { rate, depth }           a wobble in the loudness (0 to 1)
//   drive            true: distort it
//   pan, verb, bus, at
function voice(o) {
  const t = ctx.currentTime + (o.at || 0);
  const dur = o.dur ?? 0.3;
  const n = o.unison || 1;
  const vol = Math.max(0.0002, (o.vol ?? 0.2) * trim / Math.sqrt(n));
  const attack = Math.min(o.attack ?? 0.005, dur * 0.8);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(vol, t + attack);
  if (o.hold) amp.gain.setValueAtTime(vol, t + attack + o.hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  let entry = amp;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type || "lowpass";
    f.Q.value = o.filter.q ?? 0.8;
    f.frequency.setValueAtTime(o.filter.f, t);
    if (o.filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.filter.to), t + (o.filter.time ?? dur));
    f.connect(amp);
    entry = f;
  }
  if (o.drive) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = crush;
    shaper.connect(entry);
    entry = shaper;
  }

  const stop = t + dur + 0.1;
  const lfos = [];
  for (let k = 0; k < n; k++) {
    const osc = ctx.createOscillator();
    osc.type = o.type || "sawtooth";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.slide ?? dur));
    if (n > 1) osc.detune.value = (k - (n - 1) / 2) * (o.spread ?? 12);
    if (o.vib) {
      const lfo = ctx.createOscillator(); const depth = ctx.createGain();
      lfo.frequency.value = o.vib.rate; depth.gain.value = o.vib.cents;
      lfo.connect(depth).connect(osc.detune); lfos.push(lfo);
    }
    if (o.fm) {
      const mod = ctx.createOscillator(); const index = ctx.createGain();
      mod.frequency.setValueAtTime(o.f * o.fm.ratio, t);
      index.gain.setValueAtTime(o.f * o.fm.index, t);
      index.gain.exponentialRampToValueAtTime(Math.max(0.01, o.f * 0.02), t + (o.fm.decay ?? dur));
      mod.connect(index).connect(osc.frequency);
      mod.start(t); mod.stop(stop);
    }
    osc.connect(entry);
    osc.start(t); osc.stop(stop);
  }
  if (o.trem) {
    const lfo = ctx.createOscillator(); const depth = ctx.createGain();
    lfo.frequency.value = o.trem.rate; depth.gain.value = vol * o.trem.depth;
    lfo.connect(depth).connect(amp.gain); lfos.push(lfo);
  }
  for (const lfo of lfos) { lfo.start(t); lfo.stop(stop); }
  output(amp, o, t, dur);
}

// A burst of filtered noise: wind, crackle, whooshes, the body of a hit.
//   filter, filter2   { type, f, to, time, q }
function noise(o) {
  const t = ctx.currentTime + (o.at || 0);
  const dur = o.dur ?? 0.2;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  const level = Math.max(0.0002, (o.vol ?? 0.3) * trim);
  amp.gain.exponentialRampToValueAtTime(level, t + Math.min(o.attack ?? 0.004, dur * 0.8));
  if (o.hold) amp.gain.setValueAtTime(level, t + (o.attack ?? 0.004) + o.hold);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = src;
  for (const spec of [o.filter, o.filter2]) {
    if (!spec) continue;
    const f = ctx.createBiquadFilter();
    f.type = spec.type || "lowpass";
    f.Q.value = spec.q ?? 0.8;
    f.frequency.setValueAtTime(spec.f, t);
    if (spec.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, spec.to), t + (spec.time ?? dur));
    node.connect(f);
    node = f;
  }
  node.connect(amp);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.1);
  output(amp, o, t, dur);
}

function output(amp, o, t, dur) {
  let out = amp;
  if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; amp.connect(p); out = p; }
  out.connect(o.bus || sfxBus);
  if (o.verb) { const send = ctx.createGain(); send.gain.value = o.verb; out.connect(send).connect(reverbIn); }
}

// ------------------------------------------------------------------ the instruments
const bell = (n, at, o = {}) => voice({ type: "sine", f: NOTE(n), at, dur: o.dur ?? 1.1, vol: o.vol ?? 0.12, attack: 0.002,
  fm: { ratio: o.ratio ?? 3.5, index: o.index ?? 1.8, decay: (o.dur ?? 1.1) * 0.3 }, pan: o.pan, verb: o.verb ?? 0.5, bus: o.bus });
const pluck = (n, at, o = {}) => voice({ type: "triangle", f: NOTE(n), at, dur: o.dur ?? 0.5, vol: o.vol ?? 0.12, attack: 0.003,
  filter: { f: 3200, to: 500, q: 1, time: o.dur ?? 0.5 }, pan: o.pan, verb: o.verb ?? 0.35, bus: o.bus });
const stab = (notes, at, o = {}) => notes.forEach((n) => voice({ type: "sawtooth", f: NOTE(n), at, dur: o.dur ?? 0.3, vol: o.vol ?? 0.1,
  unison: 3, spread: 16, attack: 0.008, filter: { f: o.from ?? 500, to: o.to ?? 3200, time: 0.09, q: 1.2 }, verb: o.verb ?? 0.25, bus: o.bus }));
const run = (notes, step, fn, o = {}) => notes.forEach((n, i) => fn(n, (o.at || 0) + i * step, o));

const kick = (at, vol = 0.5, bus) => {
  voice({ type: "sine", f: 160, to: 42, slide: 0.13, dur: 0.34, vol, attack: 0.002, at, bus });
  noise({ filter: { type: "highpass", f: 3000 }, dur: 0.012, vol: vol * 0.35, at, bus });
};
const snare = (at, vol = 0.3, bus) => {
  noise({ filter: { type: "bandpass", f: 2200, q: 0.6 }, dur: 0.2, vol, at, attack: 0.002, verb: 0.2, bus });
  voice({ type: "triangle", f: 210, to: 130, slide: 0.08, dur: 0.12, vol: vol * 0.7, attack: 0.002, at, bus });
};
const hat = (at, vol = 0.07, open = false, bus) =>
  noise({ filter: { type: "highpass", f: 7500, q: 0.5 }, dur: open ? 0.22 : 0.045, vol, at, attack: 0.002, pan: rand(-0.2, 0.2), bus });
const tom = (at, f = 150, vol = 0.35, bus) => voice({ type: "sine", f, to: f * 0.5, slide: 0.18, dur: 0.4, vol, attack: 0.003, at, verb: 0.3, bus });
const crash = (at, vol = 0.12, bus) => noise({ filter: { type: "highpass", f: 4500, q: 0.4 }, dur: 1.6, vol, at, attack: 0.004, verb: 0.35, bus });
const sparkle = (at, from, count, o = {}) => { for (let i = 0; i < count; i++) bell(from + [0, 2, 4, 7, 9][i % 5] + 12 * Math.floor(i / 5), at + i * (o.step ?? 0.055), { vol: o.vol ?? 0.07, dur: 1.2, pan: rand(-0.6, 0.6), verb: 0.7 }); };

// the music dips for a moment under a big sound
function duck(level = 0.45, seconds = 0.5) {
  if (!ctx || !musicBus) return;
  const g = musicBus.gain; const t = ctx.currentTime;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(0.0001, g.value), t);
  g.linearRampToValueAtTime(MUSIC * level, t + 0.03);
  g.linearRampToValueAtTime(MUSIC, t + seconds);
}

// ------------------------------------------------------------------ the effects, one per event
const SOUNDS = {
  // ---- the screen
  tick: () => voice({ type: "triangle", f: [880, 988, 784][Math.floor(Math.random() * 3)], dur: 0.04, vol: 0.05, attack: 0.002 }),
  pick: () => { bell(81, 0, { vol: 0.1, dur: 0.5, verb: 0.3 }); bell(88, 0.07, { vol: 0.09, dur: 0.6, verb: 0.3 }); },
  no: () => voice({ type: "square", f: 130, to: 100, dur: 0.14, vol: 0.09, filter: { f: 500 } }),
  call: () => { voice({ type: "sine", f: 420, to: 840, slide: 0.07, dur: 0.12, vol: 0.12, attack: 0.003, verb: 0.2 }); },
  unmute: () => bell(84, 0, { vol: 0.1, dur: 0.4 }),

  // ---- the boss's wind-up, and how much to believe it
  tellSure: () => { bell(69, 0, { vol: 0.13, dur: 0.9 }); bell(76, 0.1, { vol: 0.13, dur: 1.1 }); },                              // a clear fifth
  tellLikely: () => { bell(69, 0, { vol: 0.12, dur: 0.9 }); bell(72, 0.11, { vol: 0.11, dur: 0.8 }); bell(76, 0.22, { vol: 0.07, dur: 0.8, index: 3 }); }, // minor third, left hanging
  tellFlip: () => { for (let i = 0; i < 7; i++) voice({ type: "sine", f: 2600 + (i % 2) * 90, dur: 0.12, vol: 0.07, attack: 0.002, at: i * (0.12 - i * 0.012), fm: { ratio: 2.7, index: 1.2, decay: 0.08 }, pan: i % 2 ? 0.4 : -0.4, verb: 0.5 }); }, // a coin spinning to rest
  heavy: () => {
    tom(0, 70, 0.55); tom(0.2, 60, 0.6);                                                                                         // a heartbeat
    voice({ type: "sawtooth", f: 55, to: 82, slide: 1.0, dur: 1.2, vol: 0.22, attack: 0.5, unison: 3, spread: 20, filter: { f: 160, to: 900, time: 1.0, q: 2 }, verb: 0.4 });
    noise({ filter: { type: "bandpass", f: 200, to: 1200, q: 1.5, time: 1.0 }, dur: 1.2, vol: 0.1, attack: 0.6 });
  },
  bluff: () => {                                                                                                                   // pizzicato slipping down, a sneer
    run([76, 75, 72, 68, 63], 0.07, (n, at) => pluck(n, at, { dur: 0.3, vol: 0.14 }));
    voice({ type: "sine", f: 900, to: 330, slide: 0.45, dur: 0.5, vol: 0.09, at: 0.05, vib: { rate: 14, cents: 60 }, verb: 0.4 });
  },

  // ---- the plants' moves: each one has a sound of its own, played as the move starts
  move_generic: () => noise({ filter: { type: "bandpass", f: 500, to: 2600, q: 1.5, time: 0.2 }, dur: 0.22, vol: 0.2 }),
  move_haymaker: () => {                              // Ember's burning fist: wind-up, whoosh, flame
    noise({ filter: { type: "bandpass", f: 300, to: 1800, q: 1.2, time: 0.4 }, dur: 0.5, vol: 0.2, attack: 0.15 });
    voice({ type: "sawtooth", f: 110, to: 220, dur: 0.5, vol: 0.12, attack: 0.2, filter: { f: 500, to: 2200, time: 0.45 }, drive: true });
    noise({ filter: { type: "highpass", f: 3500 }, dur: 0.35, vol: 0.06, at: 0.3, verb: 0.2 });
  },
  move_aegis: () => {                                 // a wheel of petals: a bright shimmering chord swelling up
    run([76, 79, 83, 88], 0.06, (n, at) => bell(n, at, { vol: 0.09, dur: 1.4, index: 1.2, verb: 0.7 }));
    voice({ type: "triangle", f: NOTE(64), dur: 1.0, vol: 0.1, attack: 0.25, unison: 3, spread: 10, filter: { f: 1800 }, verb: 0.5 });
  },
  move_flare: () => {                                 // burning petals corkscrewing
    voice({ type: "sawtooth", f: 260, to: 1300, dur: 0.7, vol: 0.1, attack: 0.1, unison: 2, filter: { f: 1200, to: 4000, time: 0.6, q: 2 }, vib: { rate: 18, cents: 40 }, verb: 0.3 });
    noise({ filter: { type: "highpass", f: 2500, to: 6000, time: 0.7 }, dur: 0.7, vol: 0.12, attack: 0.1, pan: 0.3 });
  },
  move_inferno: () => {                               // the skill: a long charge, then the pillar of fire
    voice({ type: "sawtooth", f: 90, to: 700, slide: 1.0, dur: 1.15, vol: 0.2, attack: 0.6, unison: 4, spread: 18, filter: { f: 300, to: 3500, time: 1.0, q: 2 }, verb: 0.3 });
    noise({ filter: { type: "bandpass", f: 400, to: 5000, q: 1.8, time: 1.0 }, dur: 1.1, vol: 0.16, attack: 0.7 });
    voice({ type: "sine", f: 130, to: 36, slide: 0.7, dur: 1.2, vol: 0.55, attack: 0.002, at: 1.0 });
    noise({ filter: { type: "lowpass", f: 4000, to: 150, time: 1.1 }, dur: 1.3, vol: 0.4, at: 1.0, attack: 0.004, verb: 0.4 });
    sparkle(1.05, 76, 8, { vol: 0.06 });
    duck(0.4, 1.4);
  },
  move_bladeRush: () => {                             // Zest darts in and cuts three times
    for (let i = 0; i < 3; i++) {
      const at = i * 0.12;
      noise({ filter: { type: "bandpass", f: 3500, to: 9000, q: 2, time: 0.09 }, dur: 0.1, vol: 0.2, at, attack: 0.002, pan: [-0.4, 0.3, -0.1][i] });
      voice({ type: "sine", f: 3300 + i * 250, dur: 0.22, vol: 0.06, at, attack: 0.002, fm: { ratio: 1.4, index: 3, decay: 0.1 }, verb: 0.4 });
    }
  },
  move_stripeWall: () => {                            // striped blades stab up as a fence
    for (let i = 0; i < 4; i++) {
      pluck(55 + i * 4, i * 0.07, { dur: 0.35, vol: 0.14 });
      noise({ filter: { type: "bandpass", f: 1500, q: 1.5 }, dur: 0.05, vol: 0.12, at: i * 0.07 });
    }
    voice({ type: "triangle", f: NOTE(67), dur: 0.9, vol: 0.09, at: 0.28, attack: 0.05, verb: 0.5 });
  },
  move_citrusVolt: () => {                            // a ball of lightning
    for (let i = 0; i < 14; i++) {
      voice({ type: "square", f: rand(400, 2400), dur: 0.045, vol: 0.06, at: i * 0.035, attack: 0.002, filter: { f: 3000 }, pan: rand(-0.5, 0.5) });
    }
    noise({ filter: { type: "highpass", f: 4000 }, dur: 0.55, vol: 0.14, attack: 0.01, verb: 0.2 });
    voice({ type: "sawtooth", f: 120, dur: 0.5, vol: 0.12, drive: true, filter: { f: 900 }, trem: { rate: 50, depth: 0.8 } });
  },
  move_sunburst: () => {                              // a small sun: warm and rising, then a bloom
    voice({ type: "triangle", f: NOTE(60), dur: 1.4, vol: 0.12, attack: 0.5, unison: 3, spread: 12, filter: { f: 1200, to: 3000, time: 1.2 }, verb: 0.6 });
    voice({ type: "triangle", f: NOTE(67), dur: 1.4, vol: 0.1, attack: 0.5, unison: 3, spread: 12, filter: { f: 1200, to: 3000, time: 1.2 }, verb: 0.6 });
    voice({ type: "triangle", f: NOTE(76), dur: 1.4, vol: 0.08, attack: 0.5, unison: 3, spread: 12, filter: { f: 1200, to: 3000, time: 1.2 }, verb: 0.6 });
    sparkle(1.0, 79, 9, { vol: 0.06 });
  },
  move_thorns: () => { for (let i = 0; i < 4; i++) { voice({ type: "square", f: 700 - i * 40, to: 300, dur: 0.07, vol: 0.12, at: i * 0.06, filter: { f: 2500 } }); noise({ filter: { type: "highpass", f: 5000 }, dur: 0.03, vol: 0.1, at: i * 0.06 }); } },
  move_sunlight: () => { run([72, 76, 79, 84], 0.1, (n, at) => voice({ type: "sine", f: NOTE(n), dur: 1.2, vol: 0.09, at, attack: 0.2, unison: 2, spread: 8, verb: 0.7 })); },
  move_bark: () => { for (let i = 0; i < 2; i++) { voice({ type: "sine", f: 200, to: 90, dur: 0.18, vol: 0.4, at: i * 0.12 }); noise({ filter: { type: "bandpass", f: 900, q: 1 }, dur: 0.07, vol: 0.2, at: i * 0.12 }); } },

  // ---- the boss's moves, played as the move starts: the blow lands about half a second in
  boss_bite: () => {
    voice({ type: "sawtooth", f: 120, to: 75, dur: 0.4, vol: 0.2, drive: true, filter: { f: 700, q: 3 }, trem: { rate: 24, depth: 0.5 }, attack: 0.04 });
    noise({ filter: { type: "bandpass", f: 900, to: 400, q: 2 }, dur: 0.4, vol: 0.2, attack: 0.05 });
    noise({ filter: { type: "bandpass", f: 1800, q: 1.2 }, dur: 0.1, vol: 0.4, at: 0.42 });                                    // the jaws shut
    voice({ type: "sine", f: 150, to: 45, slide: 0.15, dur: 0.35, vol: 0.5, at: 0.42 });
    voice({ type: "square", f: 90, to: 60, dur: 0.12, vol: 0.2, at: 0.42, filter: { f: 700 } });
  },
  boss_ray: () => {
    voice({ type: "sawtooth", f: 90, to: 880, slide: 0.5, dur: 0.55, vol: 0.14, attack: 0.3, unison: 3, spread: 22, filter: { f: 300, to: 3200, time: 0.5, q: 3 }, verb: 0.2 });
    voice({ type: "sine", f: 300, to: 1500, slide: 0.5, dur: 0.55, vol: 0.08, attack: 0.3, vib: { rate: 30, cents: 80 } });
    noise({ filter: { type: "bandpass", f: 600, to: 3500, q: 2, time: 0.5 }, dur: 0.55, vol: 0.12, attack: 0.35 });
    noise({ filter: { type: "bandpass", f: 2200, q: 0.9 }, dur: 0.7, vol: 0.28, at: 0.5, attack: 0.01, hold: 0.25, verb: 0.3 });  // the beam
    voice({ type: "sawtooth", f: 330, to: 200, dur: 0.7, vol: 0.14, at: 0.5, drive: true, filter: { f: 2000 }, trem: { rate: 45, depth: 0.4 } });
    voice({ type: "sine", f: 90, to: 40, dur: 0.6, vol: 0.4, at: 0.5 });
  },
  boss_quake: () => {
    voice({ type: "sine", f: 40, to: 62, slide: 0.45, dur: 0.6, vol: 0.45, attack: 0.25, trem: { rate: 12, depth: 0.4 } });
    noise({ filter: { type: "lowpass", f: 200, to: 700, time: 0.5 }, dur: 0.55, vol: 0.3, attack: 0.3 });
    voice({ type: "sine", f: 110, to: 30, slide: 0.3, dur: 0.6, vol: 0.55, at: 0.5 });                                         // the ground cracks
    noise({ filter: { type: "bandpass", f: 700, to: 150, q: 1.5 }, dur: 0.55, vol: 0.35, at: 0.5, attack: 0.003 });
    for (let i = 0; i < 4; i++) noise({ filter: { type: "bandpass", f: 1200 + i * 200, q: 3 }, dur: 0.06, vol: 0.14, at: 0.55 + i * 0.05 });  // roots snapping up
  },

  // ---- the blows
  hit: () => {                                                  // a plant lands a clean hit
    const p = rand(0.9, 1.1);
    noise({ filter: { type: "lowpass", f: 3500 * p, to: 200, time: 0.14 }, dur: 0.16, vol: 0.4, attack: 0.001 });
    voice({ type: "sine", f: 190 * p, to: 55, slide: 0.12, dur: 0.22, vol: 0.55, attack: 0.001 });
    voice({ type: "square", f: 520 * p, to: 200, slide: 0.06, dur: 0.07, vol: 0.12, filter: { f: 1500 } });
    duck(0.65, 0.3);
  },
  crit: () => {                                                 // a big one, or the finishing blow
    noise({ filter: { type: "lowpass", f: 6000, to: 150, time: 0.3 }, dur: 0.34, vol: 0.6, attack: 0.001, verb: 0.3 });
    voice({ type: "sine", f: 220, to: 38, slide: 0.25, dur: 0.5, vol: 0.75, attack: 0.001 });
    voice({ type: "sawtooth", f: 330, to: 90, slide: 0.15, dur: 0.18, vol: 0.2, drive: true, filter: { f: 3000 } });
    bell(88, 0.02, { vol: 0.09, dur: 1.0, index: 3 });
    bell(95, 0.06, { vol: 0.06, dur: 1.0, index: 3 });
    crash(0, 0.07);
    duck(0.35, 0.8);
  },
  hurt: () => {                                                 // the plant takes a hit
    noise({ filter: { type: "lowpass", f: 2200, to: 180, time: 0.15 }, dur: 0.18, vol: 0.4, attack: 0.001 });
    voice({ type: "sine", f: 150, to: 50, slide: 0.15, dur: 0.25, vol: 0.5, attack: 0.001 });
    voice({ type: "triangle", f: 420, to: 190, slide: 0.2, dur: 0.28, vol: 0.14, at: 0.04, vib: { rate: 22, cents: 50 }, verb: 0.2 });
    duck(0.65, 0.3);
  },
  graze: () => {
    noise({ filter: { type: "lowpass", f: 1800, to: 200, time: 0.1 }, dur: 0.12, vol: 0.22 });
    voice({ type: "sine", f: 120, to: 60, dur: 0.14, vol: 0.3 });
  },
  block: () => {                                                // a clang: metal on shield
    voice({ type: "sine", f: 1180, dur: 0.9, vol: 0.2, attack: 0.001, fm: { ratio: 1.41, index: 4, decay: 0.25 }, verb: 0.45 });
    voice({ type: "sine", f: 1760, dur: 0.6, vol: 0.1, attack: 0.001, fm: { ratio: 2.3, index: 3, decay: 0.15 }, verb: 0.45 });
    noise({ filter: { type: "highpass", f: 3500 }, dur: 0.07, vol: 0.3, attack: 0.001 });
    voice({ type: "sine", f: 130, to: 60, dur: 0.18, vol: 0.35 });
    duck(0.6, 0.4);
  },
  clash: () => {                                                // two moves meet: a blast and ringing
    SOUNDS.block();
    voice({ type: "sine", f: 160, to: 35, slide: 0.3, dur: 0.6, vol: 0.6, attack: 0.001 });
    noise({ filter: { type: "lowpass", f: 5000, to: 200, time: 0.3 }, dur: 0.4, vol: 0.4, verb: 0.4 });
    bell(84, 0.03, { vol: 0.08, dur: 1.2, index: 3 });
    duck(0.4, 0.7);
  },
  miss: () => {                                                 // a whiff: air, then a flat little drop
    noise({ filter: { type: "bandpass", f: 1800, to: 500, q: 1, time: 0.25 }, dur: 0.28, vol: 0.14, attack: 0.04 });
    voice({ type: "triangle", f: 360, to: 150, slide: 0.25, dur: 0.3, vol: 0.1, vib: { rate: 9, cents: 40 }, verb: 0.2 });
  },

  // ---- a plant leaves the cube or is set back on it
  poofOut: () => {                                              // a puff of air and a falling "pop"
    noise({ filter: { type: "bandpass", f: 2400, to: 700, q: 0.8, time: 0.22 }, dur: 0.26, vol: 0.14, attack: 0.01 });
    voice({ type: "sine", f: 760, to: 220, slide: 0.12, dur: 0.18, vol: 0.12, attack: 0.002, verb: 0.3 });
  },
  poofIn: () => {                                               // the same in reverse, ending in a bright chime
    noise({ filter: { type: "bandpass", f: 700, to: 2600, q: 0.8, time: 0.18 }, dur: 0.22, vol: 0.12, attack: 0.1 });
    voice({ type: "sine", f: 300, to: 900, slide: 0.12, dur: 0.16, vol: 0.1, attack: 0.002, verb: 0.3 });
    bell(88, 0.14, { vol: 0.09, dur: 0.6, verb: 0.4 });
  },

  // ---- the team
  heal: () => {                                                 // a harp, rising
    run([69, 73, 76, 81, 85, 88], 0.065, (n, at) => pluck(n, at, { dur: 0.9, vol: 0.12, verb: 0.6 }));
    sparkle(0.4, 88, 5, { vol: 0.05 });
  },
  charged: () => {                                              // the skill is ready: a power-up
    run([76, 83, 88], 0.06, (n, at) => voice({ type: "square", f: NOTE(n), dur: 0.2, vol: 0.07, at, attack: 0.003, filter: { f: 4000 }, verb: 0.3 }));
    bell(95, 0.2, { vol: 0.09, dur: 1.0, index: 2 });
    voice({ type: "sawtooth", f: 300, to: 1800, dur: 0.3, vol: 0.05, attack: 0.1, filter: { f: 2500 } });
  },
  faint: () => {                                                // tumbling over
    voice({ type: "triangle", f: 460, to: 70, slide: 0.65, dur: 0.75, vol: 0.2, vib: { rate: 7, cents: 90 }, verb: 0.3 });
    voice({ type: "sine", f: 90, to: 40, dur: 0.4, vol: 0.5, at: 0.62 });
    noise({ filter: { type: "lowpass", f: 800, to: 120, time: 0.3 }, dur: 0.3, vol: 0.2, at: 0.62 });
  },
  swap: () => {                                                 // "go!": a whoosh, two bounds, a bright note
    noise({ filter: { type: "bandpass", f: 300, to: 3500, q: 1.2, time: 0.3 }, dur: 0.32, vol: 0.18, attack: 0.1 });
    for (let i = 0; i < 2; i++) { voice({ type: "sine", f: 260, to: 520, slide: 0.12, dur: 0.18, vol: 0.2, at: 0.22 + i * 0.32, attack: 0.005 }); voice({ type: "sine", f: 110, to: 60, dur: 0.1, vol: 0.3, at: 0.34 + i * 0.32 }); }
    run([72, 79, 84], 0.07, (n, at) => bell(n, 0.1 + at, { vol: 0.09, dur: 0.8 }));
  },

  // ---- the forest and the boss's arrival
  alarm: () => {                                                // a siren, then a low swell: something is coming
    for (let i = 0; i < 4; i++) {
      voice({ type: "square", f: i % 2 ? 620 : 880, dur: 0.3, vol: 0.12, at: i * 0.3, attack: 0.01, hold: 0.12, filter: { f: 2200 }, verb: 0.25 });
    }
    voice({ type: "sawtooth", f: 45, to: 70, slide: 1.4, dur: 1.6, vol: 0.2, attack: 0.9, unison: 3, spread: 18, filter: { f: 120, to: 600, time: 1.4 }, verb: 0.3 });
  },
  bound: () => {                                                // the first bound, far off: a small thump
    voice({ type: "sine", f: 90, to: 38, dur: 0.4, vol: 0.45, attack: 0.002 });
    noise({ filter: { type: "lowpass", f: 600, to: 100 }, dur: 0.35, vol: 0.25 });
    noise({ filter: { type: "highpass", f: 4000 }, dur: 0.15, vol: 0.05, at: 0.05, pan: 0.3 });
  },
  treeFall: () => {                                             // a tree breaks and goes over
    noise({ filter: { type: "bandpass", f: 1500, q: 2 }, dur: 0.1, vol: 0.4, attack: 0.001 });                                  // the crack
    voice({ type: "sawtooth", f: 90, to: 50, dur: 0.6, vol: 0.12, filter: { f: 400 }, vib: { rate: 20, cents: 80 }, at: 0.1 });
    noise({ filter: { type: "lowpass", f: 900, to: 150, time: 0.7 }, dur: 0.8, vol: 0.35, at: 0.55, attack: 0.1 });              // the crash
    voice({ type: "sine", f: 80, to: 32, dur: 0.6, vol: 0.55, at: 0.6 });
  },
  land: () => {                                                 // the boss lands: the ground jumps
    voice({ type: "sine", f: 120, to: 28, slide: 0.5, dur: 1.0, vol: 0.8, attack: 0.001 });
    noise({ filter: { type: "lowpass", f: 5000, to: 90, time: 0.9 }, dur: 1.2, vol: 0.55, attack: 0.002, verb: 0.4 });
    noise({ filter: { type: "bandpass", f: 3000, q: 0.5 }, dur: 0.5, vol: 0.12, at: 0.1, verb: 0.5 });
    voice({ type: "sawtooth", f: 55, to: 40, dur: 1.4, vol: 0.2, at: 0.1, filter: { f: 200 }, verb: 0.3 });
    duck(0.2, 1.6);
  },
  roar: () => {
    voice({ type: "sawtooth", f: 100, to: 52, dur: 1.1, vol: 0.34, attack: 0.05, drive: true, filter: { f: 1100, to: 320, q: 3 }, trem: { rate: 28, depth: 0.5 }, verb: 0.3 });
    voice({ type: "square", f: 66, to: 42, dur: 1.1, vol: 0.22, attack: 0.05, filter: { f: 500 } });
    noise({ filter: { type: "bandpass", f: 760, to: 280, q: 2.4 }, dur: 1.1, vol: 0.34, attack: 0.06, verb: 0.3 });
    noise({ filter: { type: "bandpass", f: 2000, to: 700, q: 3 }, dur: 0.95, vol: 0.14, attack: 0.07 });
    duck(0.3, 1.4);
  },
  cut: () => {                                                  // the screen flashes and cuts to the fight
    for (let i = 0; i < 2; i++) { noise({ filter: { type: "highpass", f: 2500 }, dur: 0.09, vol: 0.25, at: i * 0.17, attack: 0.001 }); voice({ type: "sine", f: 90, to: 50, dur: 0.15, vol: 0.4, at: i * 0.17 }); }
    voice({ type: "sawtooth", f: 120, to: 1400, slide: 0.55, dur: 0.6, vol: 0.12, at: 0.2, attack: 0.3, filter: { f: 400, to: 5000, time: 0.5, q: 2 }, verb: 0.3 });
    noise({ filter: { type: "bandpass", f: 500, to: 6000, q: 1.5, time: 0.55 }, dur: 0.6, vol: 0.14, at: 0.2, attack: 0.4 });
  },
  battleStart: () => {                                          // the fight begins: a sting
    kick(0, 0.7); crash(0, 0.14);
    stab([57, 60, 64, 69], 0, { dur: 0.7, vol: 0.12, verb: 0.4 });
    tom(0.2, 130, 0.35); tom(0.3, 100, 0.4);
    voice({ type: "sawtooth", f: 55, dur: 0.8, vol: 0.2, filter: { f: 300 } });
  },
  enrage: () => {                                               // the boss loses its temper
    SOUNDS.roar();
    voice({ type: "sawtooth", f: 80, to: 800, slide: 0.9, dur: 1.0, vol: 0.14, attack: 0.5, unison: 4, spread: 25, filter: { f: 300, to: 4000, time: 0.9, q: 2 }, drive: true });
    kick(0.9, 0.8); crash(0.9, 0.15);
    stab([57, 60, 63, 69], 0.9, { dur: 0.9, vol: 0.14, verb: 0.4 });
    for (let i = 0; i < 4; i++) tom(1.0 + i * 0.1, 150 - i * 20, 0.35);
  },

  // ---- the end of the fight
  boom: () => {                                                 // the boss comes apart
    voice({ type: "sine", f: 150, to: 26, slide: 0.9, dur: 1.4, vol: 0.85, attack: 0.001 });
    noise({ filter: { type: "lowpass", f: 7000, to: 100, time: 1.2 }, dur: 1.5, vol: 0.6, attack: 0.001, verb: 0.5 });
    crash(0, 0.16);
    sparkle(0.12, 83, 14, { vol: 0.055, step: 0.075 });
    voice({ type: "sawtooth", f: 200, to: 40, dur: 0.8, vol: 0.2, drive: true, filter: { f: 1500, to: 150 } });
    duck(0.15, 2.0);
  },
  victory: () => {                                              // a rising brass fanfare in C, timpani and a shower of bells
    const tune = [[0, 64, 0.14], [0.17, 67, 0.14], [0.34, 72, 0.14], [0.51, 76, 0.5], [1.05, 74, 0.2], [1.28, 76, 0.2], [1.5, 79, 1.5]];
    for (const [at, n, len] of tune) {
      voice({ type: "sawtooth", f: NOTE(n), at, dur: len + 0.1, vol: 0.13, attack: 0.012, unison: 3, spread: 15, filter: { f: 500, to: 3600, time: 0.1, q: 1.3 }, vib: len > 0.4 ? { rate: 5.5, cents: 14 } : undefined, verb: 0.3 });
    }
    stab([60, 64, 67], 0.51, { dur: 0.6, vol: 0.08 });
    stab([60, 67, 72, 76], 1.5, { dur: 1.7, vol: 0.09, verb: 0.4 });
    tom(0, 110, 0.5); tom(0.51, 100, 0.5); tom(1.5, 90, 0.7); crash(1.5, 0.14);
    voice({ type: "sine", f: NOTE(36), dur: 2.2, vol: 0.35, at: 1.5, attack: 0.02 });
    sparkle(1.7, 84, 12, { vol: 0.05, step: 0.09 });
  },
  defeat: () => {                                               // slow and falling, in A minor
    [[0, 69, 0.7], [0.8, 67, 0.7], [1.6, 64, 1.9]].forEach(([at, n, len]) => {
      voice({ type: "sawtooth", f: NOTE(n), at, dur: len + 0.3, vol: 0.12, attack: 0.04, unison: 3, spread: 14, filter: { f: 1100, to: 400, time: len }, vib: { rate: 5, cents: 18 }, verb: 0.5 });
    });
    voice({ type: "sawtooth", f: NOTE(45), dur: 3.0, vol: 0.14, attack: 0.3, filter: { f: 250 }, verb: 0.3 });
    voice({ type: "triangle", f: NOTE(57), to: NOTE(54), slide: 1.0, dur: 2.2, vol: 0.1, at: 1.6, attack: 0.1, verb: 0.5 });
    tom(1.6, 80, 0.5);
  },
  water: (seconds = 2) => {                                     // the pump: a motor hum, a stream, bubbling, then drips
    voice({ type: "sawtooth", f: 78, dur: seconds, vol: 0.07, attack: 0.15, hold: seconds - 0.4, filter: { f: 260, q: 1.5 }, trem: { rate: 9, depth: 0.25 } });
    noise({ filter: { type: "bandpass", f: 1300, q: 0.5 }, dur: seconds, vol: 0.09, attack: 0.2, hold: seconds - 0.5, verb: 0.2 });
    noise({ filter: { type: "highpass", f: 3500 }, dur: seconds, vol: 0.025, attack: 0.3, hold: seconds - 0.6 });
    for (let t = 0.2; t < seconds - 0.1; t += rand(0.04, 0.1)) {
      voice({ type: "sine", f: rand(450, 900), to: rand(1000, 1900), slide: 0.07, dur: 0.09, vol: 0.05, at: t, attack: 0.004, pan: rand(-0.6, 0.6), verb: 0.4 });
    }
    for (let i = 0; i < 3; i++) voice({ type: "sine", f: 1500 + i * 220, to: 900 + i * 100, slide: 0.08, dur: 0.25, vol: 0.07, at: seconds + 0.15 + i * 0.28, attack: 0.003, verb: 0.7, pan: i - 1 });
  },
};

// ------------------------------------------------------------------ the two songs
// A song is a function that plays one bar of itself. The sequencer books bars a little ahead of
// time, so a busy frame never makes the music stumble. n is the bar number, b the length of a
// beat in seconds, `at` is when the bar starts (seconds from now), `rage` is whether the boss is
// enraged and `bus` is the song's own volume knob.

// FOREST: D major, slow and open. Pad, harp, a flute-like tune, birds and wind.
const FOREST_CHORDS = [
  { root: 38, tones: [62, 66, 69, 73] },   // Dmaj7
  { root: 35, tones: [59, 62, 66, 69] },   // Bm7
  { root: 43, tones: [62, 67, 71, 74] },   // Gmaj7
  { root: 45, tones: [61, 64, 69, 73] },   // A
  { root: 38, tones: [62, 66, 69, 73] },   // Dmaj7
  { root: 42, tones: [61, 64, 69, 73] },   // F#m7
  { root: 43, tones: [62, 67, 71, 74] },   // Gmaj7
  { root: 45, tones: [61, 64, 69, 76] },   // A
];
const FOREST_TUNE = [   // [beat, note, beats long]
  [[0, 78, 1.5], [1.5, 76, 0.5], [2, 74, 2]],
  [[0, 73, 1], [1, 74, 1], [2, 76, 2]],
  [[0, 79, 1.5], [1.5, 78, 0.5], [2, 76, 1], [3, 74, 1]],
  [[0, 73, 2], [2, 76, 1], [3, 81, 1]],
  [[0, 81, 1.5], [1.5, 78, 0.5], [2, 74, 2]],
  [[0, 81, 1], [1, 78, 1], [2, 73, 2]],
  [[0, 79, 1.5], [1.5, 83, 0.5], [2, 81, 1], [3, 79, 1]],
  [[0, 81, 1], [1, 78, 1], [2, 76, 1], [3, 73, 1]],
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3];

function forestBar(n, b, at, rage, bus) {
  const bar = n % 8;
  const chord = FOREST_CHORDS[bar];
  const len = b * 4;
  chord.tones.forEach((note) => voice({ type: "sawtooth", f: NOTE(note - 12), at, dur: len * 1.15, vol: 0.05, attack: 1.0, unison: 3, spread: 18,
    filter: { f: 700, to: 1100, time: len, q: 0.6 }, verb: 0.7, bus }));
  voice({ type: "sine", f: NOTE(chord.root), at, dur: len * 1.05, vol: 0.22, attack: 0.25, bus });
  voice({ type: "triangle", f: NOTE(chord.root + 12), at: at + b * 2, dur: b * 1.9, vol: 0.06, attack: 0.1, bus });
  // the harp: eighth notes up and down the chord, a little different each time round
  ARP.forEach((idx, i) => {
    const skip = (bar + i) % 5 === 4;     // a few gaps keep it breathing
    if (skip) return;
    const note = chord.tones[idx] + (i % 4 === 3 ? 12 : 0);
    pluck(note, at + i * b * 0.5, { dur: 0.9, vol: 0.075 + (i % 2) * 0.015, pan: i % 2 ? 0.35 : -0.35, verb: 0.5, bus });
  });
  // the tune, in a flute-like voice
  FOREST_TUNE[bar].forEach(([beat, note, beats]) => voice({ type: "sine", f: NOTE(note), at: at + beat * b, dur: beats * b * 0.97 + 0.15, vol: bar < 4 ? 0.075 : 0.1,
    attack: 0.05, vib: { rate: 5.2, cents: 14 }, filter: { f: 2800 }, verb: 0.6, bus }));
  if (bar >= 4) FOREST_TUNE[bar].forEach(([beat, note, beats]) => bell(note - 12, at + beat * b + b * 0.5, { vol: 0.035, dur: 1.2, verb: 0.7, bus }));
  // birds, now and then
  if (Math.random() < 0.55) {
    const base = rand(2600, 3800); const when = at + rand(0.3, len - 0.8); const pan = rand(-0.8, 0.8);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      voice({ type: "sine", f: base, to: base * rand(1.2, 1.5), slide: 0.06, dur: 0.1, vol: 0.022, at: when + i * 0.11, attack: 0.005, pan, verb: 0.5, bus });
    }
  }
}

// BATTLE: A minor, driving. Drums, a bass that never stops, a fast arpeggio, a hook on the lead.
const BATTLE_CHORDS = [
  { root: 45, tones: [57, 60, 64, 69] },   // Am
  { root: 41, tones: [53, 57, 60, 65] },   // F
  { root: 48, tones: [55, 60, 64, 67] },   // C
  { root: 43, tones: [55, 59, 62, 67] },   // G
  { root: 45, tones: [57, 60, 64, 69] },   // Am
  { root: 41, tones: [53, 57, 60, 65] },   // F
  { root: 40, tones: [52, 56, 59, 64] },   // E
  { root: 40, tones: [52, 56, 59, 64] },   // E
];
const BATTLE_LEAD = [
  [[0, 81, 2], [2, 84, 2]], [[0, 77, 2], [2, 81, 2]], [[0, 79, 2], [2, 84, 2]], [[0, 83, 2], [2, 79, 1], [3, 83, 1]],
  [[0, 81, 0.5], [0.5, 84, 0.5], [1, 88, 1], [2, 86, 0.5], [2.5, 84, 0.5], [3, 81, 1]],
  [[0, 84, 0.5], [0.5, 81, 0.5], [1, 77, 1], [2, 81, 0.5], [2.5, 84, 0.5], [3, 88, 1]],
  [[0, 83, 1], [1, 80, 1], [2, 83, 1], [3, 88, 1]],
  [[0, 88, 0.5], [0.5, 86, 0.5], [1, 83, 1], [2, 80, 2]],
];
const ARP16 = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 1, 3, 2];

function battleBar(n, b, at, rage, bus) {
  const bar = n % 8;
  const chord = BATTLE_CHORDS[bar];
  const s = b / 4;                    // one sixteenth
  const first = n < 2;                // the song starts a little lighter
  // drums
  [0, 6, 10].forEach((step) => kick(at + step * s, 0.55, bus));
  if (rage) [4, 12, 14].forEach((step) => kick(at + step * s, 0.4, bus));
  [4, 12].forEach((step) => snare(at + step * s, 0.28, bus));
  for (let i = 0; i < 16; i += rage ? 1 : 2) hat(at + i * s, i % 4 === 2 ? 0.075 : 0.045, rage ? false : i === 14, bus);
  if (bar === 7) {                    // the last bar rolls into the next loop
    for (let i = 0; i < 4; i++) snare(at + (12 + i) * s, 0.12 + i * 0.07, bus);
    tom(at + 10 * s, 150, 0.25, bus);
  }
  if (bar === 0) crash(at, 0.07, bus);
  // bass: a saw and a sub, pumping eighths with an octave jump
  for (let i = 0; i < 16; i += 2) {
    const up = i === 6 || i === 14;
    voice({ type: "sawtooth", f: NOTE(chord.root + (up ? 12 : 0)), at: at + i * s, dur: s * 1.8, vol: 0.2, attack: 0.004,
      filter: { f: 1300, to: 260, time: s * 1.6, q: 3 }, bus });
    voice({ type: "sine", f: NOTE(chord.root + (up ? 12 : 0)), at: at + i * s, dur: s * 1.9, vol: 0.2, attack: 0.004, bus });
  }
  // pad stab on the downbeat
  stab(chord.tones, at, { dur: b * 1.1, vol: 0.045, from: 400, to: 1800, verb: 0.3, bus });
  // arpeggio
  if (!first || n === 1) ARP16.forEach((idx, i) => {
    const note = chord.tones[idx] + (rage && i % 8 >= 4 ? 12 : 0);
    voice({ type: "square", f: NOTE(note), at: at + i * s, dur: s * 1.2, vol: 0.04, attack: 0.002, filter: { f: 3200, to: 900, time: s, q: 1.5 },
      pan: i % 2 ? 0.3 : -0.3, verb: 0.2, bus });
  });
  // the lead
  BATTLE_LEAD[bar].forEach(([beat, note, beats]) => {
    voice({ type: "sawtooth", f: NOTE(note), at: at + beat * b, dur: beats * b * 0.95 + 0.05, vol: bar < 4 ? 0.055 : 0.08, attack: 0.01, unison: 2, spread: 14,
      filter: { f: 3800, q: 0.8 }, vib: { rate: 5.5, cents: 16 }, verb: 0.3, bus });
    if (rage) voice({ type: "square", f: NOTE(note + 12), at: at + beat * b, dur: beats * b * 0.9 + 0.05, vol: 0.03, attack: 0.01, filter: { f: 5000 }, verb: 0.3, bus });
  });
}

const SONGS = {
  forest: { bpm: 72, bar: forestBar, wind: true },
  battle: { bpm: 138, rageBpm: 160, bar: battleBar },
};

let tune = null;          // the name of the song that is playing
let tuneBus = null;       // that song's own volume knob
let rage = false;
let barNo = 0;
let nextAt = 0;           // when the next bar starts, on the audio clock
let timer = null;
let wind = null;          // the forest's wind, running while the forest song plays

function startWind(bus) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.Q.value = 0.8; band.frequency.value = 520;
  const sweep = ctx.createOscillator(); const sweepAmt = ctx.createGain();
  sweep.frequency.value = 0.07; sweepAmt.gain.value = 260;
  sweep.connect(sweepAmt).connect(band.frequency);
  const gust = ctx.createOscillator(); const gustAmt = ctx.createGain(); const level = ctx.createGain();
  level.gain.value = 0.05; gust.frequency.value = 0.11; gustAmt.gain.value = 0.035;
  gust.connect(gustAmt).connect(level.gain);
  src.connect(band).connect(level).connect(bus);
  src.start(); sweep.start(); gust.start();
  return { stop() { for (const node of [src, sweep, gust]) { try { node.stop(); } catch { /* already stopped */ } } } };
}

function schedule() {
  if (!ctx || !tune || !tuneBus || ctx.state !== "running") return;
  const song = SONGS[tune];
  if (nextAt < ctx.currentTime - 0.1) nextAt = ctx.currentTime + 0.05;   // woke up late: do not replay what was missed
  const beat = 60 / (rage && song.rageBpm ? song.rageBpm : song.bpm);
  while (nextAt < ctx.currentTime + 0.45) {
    song.bar(barNo, beat, Math.max(0, nextAt - ctx.currentTime), rage, tuneBus);
    barNo++;
    nextAt += beat * 4;
  }
}

export const audio = {
  // Call from the first key press or click: the browser allows sound from then on.
  unlock() {
    if (!start()) return;
    if (ctx.state === "suspended") ctx.resume();
  },

  // Plays an effect. A move with no sound of its own gets the plain whoosh.
  play(name, ...args) {
    if (muted || !ctx || ctx.state !== "running") return;
    const fn = SOUNDS[name] || (name.startsWith("move_") ? SOUNDS.move_generic : null);
    if (!fn) return;
    trim = TRIM[name] ?? 1;
    try { fn(...args); } finally { trim = 1; }
  },

  // Starts a song, fading the last one out. delay: seconds to wait before it starts.
  music(name, delay = 0) {
    if (name === tune) return;
    tune = name && SONGS[name] ? name : null;
    barNo = 0;
    if (!ctx) { if (!timer) timer = window.setInterval(schedule, 80); return; }
    const t = ctx.currentTime;
    if (tuneBus) {
      const old = tuneBus;
      old.gain.cancelScheduledValues(t); old.gain.setValueAtTime(old.gain.value, t); old.gain.linearRampToValueAtTime(0, t + 0.6);
      window.setTimeout(() => { try { old.disconnect(); } catch { /* gone */ } }, 800);
    }
    if (wind) { const w = wind; wind = null; window.setTimeout(() => w.stop(), 700); }
    tuneBus = null;
    if (tune) {
      tuneBus = ctx.createGain();
      tuneBus.gain.setValueAtTime(0.0001, t);
      tuneBus.gain.linearRampToValueAtTime(1, t + 0.6 + delay);
      tuneBus.connect(musicBus);
      if (SONGS[tune].wind) wind = startWind(tuneBus);
      nextAt = t + 0.06 + delay;
    }
    if (!timer) timer = window.setInterval(schedule, 80);
  },

  setRage(on) { rage = Boolean(on); },

  isMuted: () => muted,
  toggleMute() {
    muted = !muted;
    try { window.localStorage.setItem("incube-muted", muted ? "1" : "0"); } catch { /* storage is optional */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03);
    if (!muted) audio.play("unmute");
    for (const fn of listeners) fn(muted);
    return muted;
  },
  // fn(muted) is called on every change. Returns a function that stops the calls.
  onMute(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  names: () => Object.keys(SOUNDS),
  songs: () => Object.keys(SONGS),

  // For testing: renders one effect (or `bars` bars of a song) with no speakers and says how
  // loud it was, how long it rang, and whether anything went wrong.
  async measure(name, { seconds = 4, args = [], bars = 0 } = {}) {
    const live = { ctx, master, sfxBus, musicBus, reverbIn, noiseBuffer, crush, tune, tuneBus, wind };
    try {
      const rate = 44100;
      const off = new OfflineAudioContext(2, rate * seconds, rate);
      build(off);
      if (bars) {
        const song = SONGS[name]; const bus = off.createGain(); bus.connect(musicBus);
        const beat = 60 / song.bpm;
        for (let i = 0; i < bars; i++) song.bar(i, beat, i * beat * 4, false, bus);
      } else if (SOUNDS[name]) SOUNDS[name](...args);
      else return { name, error: "no such sound" };
      const out = await off.startRendering();
      let peak = 0, sum = 0, count = 0, last = 0, bad = 0;
      const a = out.getChannelData(0), z = out.getChannelData(1);
      for (let i = 0; i < a.length; i++) {
        const v = Math.max(Math.abs(a[i]), Math.abs(z[i]));
        if (!Number.isFinite(v)) { bad++; continue; }
        peak = Math.max(peak, v); sum += a[i] * a[i]; count++;
        if (v > 0.003) last = i;
      }
      return { name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / count).toFixed(4), rings: +(last / rate).toFixed(2), bad };
    } finally {
      ({ ctx, master, sfxBus, musicBus, reverbIn, noiseBuffer, crush, tune, tuneBus, wind } = live);
    }
  },
};

if (typeof window !== "undefined") {
  const wake = () => { audio.unlock(); if (ctx && tune && !tuneBus) { const t = tune; tune = null; audio.music(t); } };
  window.addEventListener("pointerdown", wake);
  window.addEventListener("keydown", (event) => {
    wake();
    if (event.code === "KeyM" && !event.repeat) audio.toggleMute();
  });
  // a tab in the background is quiet
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
}
