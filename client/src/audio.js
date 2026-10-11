// client/src/audio.js: Every sound in the game. Owner: Role 3 (client, art, demo).
// There are no sound files: each effect and both tunes are built from oscillators and noise
// with the browser's Web Audio, so the game still runs offline from a small bundle.
//
//   audio.play("hit")             one effect: see SOUNDS below for the names
//   audio.music("battle")         start a tune ("forest", "battle" or null for silence)
//   audio.setRage(true)           the battle tune speeds up while the boss is enraged
//   audio.toggleMute()            also on the M key
//
// A browser only lets a page make sound after a key press or a click, so nothing is heard until
// the first one. For a kiosk, start Chromium with --autoplay-policy=no-user-gesture-required.

let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuffer = null;
let muted = false;
try { muted = window.localStorage.getItem("incube-muted") === "1"; } catch { /* storage is optional */ }
const listeners = new Set();

const MASTER = 0.5;
const MUSIC = 0.34;

function start() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  // a gentle limiter, so many sounds at once never crackle
  const squash = ctx.createDynamicsCompressor();
  squash.threshold.value = -14; squash.ratio.value = 8; squash.attack.value = 0.003; squash.release.value = 0.2;
  master.connect(squash).connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = MUSIC; musicBus.connect(master);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

// One note. f: start pitch, to: end pitch (a slide), at: seconds from now, dur: seconds.
function tone(o, bus = sfxBus) {
  const t = ctx.currentTime + (o.at || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = o.type || "square";
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  if (o.wobble) {                                   // a quick shake of the pitch
    const lfo = ctx.createOscillator(); const depth = ctx.createGain();
    lfo.frequency.value = o.wobble; depth.gain.value = o.f * 0.06;
    lfo.connect(depth).connect(osc.frequency); lfo.start(t); lfo.stop(t + o.dur + 0.05);
  }
  const vol = o.vol ?? 0.2;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.005));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(gain).connect(bus);
  osc.start(t); osc.stop(t + o.dur + 0.05);
}

// A burst of hiss through a filter. f: filter pitch, to: where it slides to.
function noise(o, bus = sfxBus) {
  const t = ctx.currentTime + (o.at || 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer; src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = o.kind || "lowpass";
  filter.Q.value = o.q ?? 1;
  filter.frequency.setValueAtTime(o.f || 1000, t);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + o.dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + (o.attack ?? 0.004));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(filter).connect(gain).connect(bus);
  src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
}

const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);   // a MIDI note number as a pitch
// a few notes one after another
const run = (notes, step, o = {}) => notes.forEach((n, i) => tone({ type: "square", vol: 0.14, dur: step * 1.6, ...o, f: NOTE(n), at: (o.at || 0) + i * step }));

const SOUNDS = {
  // the screen
  tick: () => tone({ f: 1250, dur: 0.025, vol: 0.035 }),
  pick: () => { tone({ f: 660, dur: 0.06, vol: 0.12 }); tone({ f: 990, dur: 0.09, vol: 0.12, at: 0.06 }); },
  no: () => tone({ type: "sawtooth", f: 140, dur: 0.12, vol: 0.1 }),
  call: () => tone({ type: "triangle", f: 300, to: 620, dur: 0.12, vol: 0.2 }),
  // the boss shows its move: the surer the tell, the steadier the sound
  tellSure: () => run([69, 76], 0.07, { type: "triangle", vol: 0.2 }),
  tellLikely: () => run([69, 74], 0.07, { type: "triangle", vol: 0.2 }),
  tellFlip: () => run([69, 70, 69, 70], 0.055, { type: "triangle", vol: 0.18 }),
  heavy: () => { tone({ type: "sawtooth", f: 82, to: 55, dur: 0.6, vol: 0.26 }); tone({ type: "sawtooth", f: 123, to: 82, dur: 0.6, vol: 0.14 }); },
  // blows
  swing: () => noise({ kind: "bandpass", f: 500, to: 2600, q: 1.5, dur: 0.16, vol: 0.2 }),
  hit: () => { noise({ f: 1800, to: 200, dur: 0.14, vol: 0.4 }); tone({ type: "sine", f: 170, to: 55, dur: 0.16, vol: 0.5 }); },
  crit: () => { noise({ f: 3200, to: 160, dur: 0.3, vol: 0.5 }); tone({ type: "sine", f: 210, to: 40, dur: 0.34, vol: 0.6 }); run([84, 91], 0.05, { vol: 0.1, at: 0.02 }); },
  hurt: () => { tone({ type: "sawtooth", f: 320, to: 110, dur: 0.2, vol: 0.2 }); noise({ f: 900, to: 150, dur: 0.16, vol: 0.3 }); },
  graze: () => { tone({ type: "square", f: 260, to: 180, dur: 0.1, vol: 0.12 }); noise({ f: 700, dur: 0.07, vol: 0.14 }); },
  block: () => { tone({ f: 1180, dur: 0.14, vol: 0.14 }); tone({ f: 1770, dur: 0.2, vol: 0.1 }); noise({ kind: "highpass", f: 3000, dur: 0.08, vol: 0.18 }); },
  clash: () => { SOUNDS.block(); tone({ type: "sine", f: 150, to: 60, dur: 0.18, vol: 0.4 }); },
  miss: () => tone({ type: "triangle", f: 420, to: 200, dur: 0.22, vol: 0.14 }),
  bluff: () => run([74, 70, 67, 63], 0.07, { type: "sawtooth", vol: 0.12 }),
  // skills and other big moments
  skill: () => { tone({ type: "sawtooth", f: 180, to: 1400, dur: 0.55, vol: 0.16 }); noise({ kind: "bandpass", f: 400, to: 5000, q: 2, dur: 0.6, vol: 0.14 }); run([72, 76, 79, 84], 0.09, { type: "triangle", vol: 0.14, at: 0.25 }); },
  heal: () => run([72, 76, 79, 84, 88], 0.07, { type: "sine", vol: 0.2 }),
  charged: () => run([79, 84, 91], 0.06, { type: "square", vol: 0.1 }),
  roar: () => { noise({ f: 520, to: 140, dur: 0.9, vol: 0.5, attack: 0.05 }); tone({ type: "sawtooth", f: 96, to: 48, dur: 0.9, vol: 0.34, wobble: 22, attack: 0.04 }); },
  faint: () => tone({ type: "square", f: 420, to: 70, dur: 0.55, vol: 0.16 }),
  swap: () => { noise({ kind: "bandpass", f: 300, to: 3000, q: 1.2, dur: 0.3, vol: 0.2 }); run([67, 72, 79], 0.07, { type: "triangle", vol: 0.16, at: 0.18 }); },
  // the forest and the ends of a fight
  alarm: () => { for (let i = 0; i < 3; i++) { tone({ f: 740, dur: 0.16, vol: 0.14, at: i * 0.36 }); tone({ f: 554, dur: 0.16, vol: 0.14, at: i * 0.36 + 0.18 }); } },
  land: () => { tone({ type: "sine", f: 120, to: 32, dur: 0.6, vol: 0.7 }); noise({ f: 900, to: 80, dur: 0.7, vol: 0.5 }); },
  boom: () => { tone({ type: "sine", f: 150, to: 30, dur: 0.8, vol: 0.7 }); noise({ f: 4000, to: 100, dur: 0.9, vol: 0.5 }); },
  victory: () => { run([72, 72, 72, 76, 79, 84], 0.13, { vol: 0.16 }); run([60, 60, 60, 64, 67, 72], 0.13, { type: "triangle", vol: 0.2 }); tone({ f: NOTE(84), dur: 0.9, vol: 0.14, at: 0.78 }); tone({ type: "triangle", f: NOTE(76), dur: 0.9, vol: 0.14, at: 0.78 }); },
  defeat: () => run([67, 63, 60, 55], 0.24, { type: "triangle", vol: 0.2, dur: 0.5 }),
  // water running into the pot for `seconds`
  water: (seconds = 2) => {
    noise({ kind: "bandpass", f: 1400, q: 0.8, dur: seconds, vol: 0.1, attack: 0.15 });
    for (let t = 0; t < seconds; t += 0.07 + Math.random() * 0.06) {
      tone({ type: "sine", f: 500 + Math.random() * 700, to: 900 + Math.random() * 600, dur: 0.06, vol: 0.06, at: t });
    }
  },
};

// ------------------------------------------------------------------ the two tunes
// Each tune is a row of steps (sixteenths). A number is a MIDI note, 0 is a rest.
const TUNES = {
  // calm, slow and sparse: a walk in the woods
  forest: {
    bpm: 76, steps: 32,
    lead: { type: "sine", vol: 0.16, len: 2.4, notes: [76, 0, 0, 79, 0, 0, 81, 0, 0, 0, 79, 0, 76, 0, 0, 0, 74, 0, 0, 76, 0, 0, 72, 0, 0, 0, 69, 0, 72, 0, 0, 0] },
    bass: { type: "triangle", vol: 0.2, len: 7, notes: [45, 0, 0, 0, 0, 0, 0, 0, 41, 0, 0, 0, 0, 0, 0, 0, 48, 0, 0, 0, 0, 0, 0, 0, 43, 0, 0, 0, 0, 0, 0, 0] },
  },
  // driving: a bass line that never stops, an arpeggio over it and a tick on the off beat
  battle: {
    bpm: 132, rageBpm: 156, steps: 32, hat: true,
    lead: { type: "square", vol: 0.07, len: 0.9, notes: [69, 72, 76, 72, 69, 72, 76, 81, 65, 69, 72, 69, 65, 69, 72, 77, 67, 71, 74, 71, 67, 71, 74, 79, 64, 68, 71, 68, 76, 74, 71, 68] },
    bass: { type: "triangle", vol: 0.24, len: 0.9, notes: [45, 0, 45, 57, 45, 0, 45, 57, 41, 0, 41, 53, 41, 0, 41, 53, 43, 0, 43, 55, 43, 0, 43, 55, 40, 0, 40, 52, 40, 0, 52, 40] },
  },
};

let tune = null;       // the name of the tune that is playing
let rage = false;
let step = 0;
let nextAt = 0;
let timer = null;

function schedule() {
  if (!ctx || !tune) return;
  const song = TUNES[tune];
  const stepTime = 60 / (rage && song.rageBpm ? song.rageBpm : song.bpm) / 4;
  // notes are booked a little ahead of time, so a busy frame never makes the tune stumble
  if (nextAt < ctx.currentTime - 0.1) nextAt = ctx.currentTime + 0.05;   // woke up late: do not replay what was missed
  while (nextAt < ctx.currentTime + 0.2) {
    const at = Math.max(0, nextAt - ctx.currentTime);
    const i = step % song.steps;
    for (const part of [song.lead, song.bass]) {
      const n = part.notes[i];
      if (n) tone({ type: part.type, f: NOTE(n), dur: stepTime * part.len, vol: part.vol, at, attack: 0.01 }, musicBus);
    }
    if (song.hat && i % 2 === 1) noise({ kind: "highpass", f: 6000, dur: 0.03, vol: 0.05, at }, musicBus);
    if (song.hat && i % 8 === 0) tone({ type: "sine", f: 110, to: 40, dur: 0.12, vol: 0.3, at }, musicBus);
    step++;
    nextAt += stepTime;
  }
}

export const audio = {
  // Call from the first key press or click: the browser allows sound from then on.
  unlock() {
    if (!start()) return;
    if (ctx.state === "suspended") ctx.resume();
  },

  play(name, ...args) {
    if (muted || !ctx || ctx.state !== "running" || !SOUNDS[name]) return;
    SOUNDS[name](...args);
  },

  music(name) {
    if (name === tune) return;
    tune = name && TUNES[name] ? name : null;
    step = 0;
    if (!timer) timer = window.setInterval(schedule, 60);
    if (ctx) nextAt = ctx.currentTime + 0.08;
  },

  setRage(on) { rage = Boolean(on); },

  isMuted: () => muted,
  toggleMute() {
    muted = !muted;
    try { window.localStorage.setItem("incube-muted", muted ? "1" : "0"); } catch { /* storage is optional */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, ctx.currentTime, 0.03);
    for (const fn of listeners) fn(muted);
    return muted;
  },
  // fn(muted) is called on every change. Returns a function that stops the calls.
  onMute(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

if (typeof window !== "undefined") {
  const wake = () => { audio.unlock(); if (ctx && tune) nextAt = Math.max(nextAt, ctx.currentTime + 0.05); };
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
