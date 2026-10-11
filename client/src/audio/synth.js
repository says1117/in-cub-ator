// client/src/audio/synth.js: Small building blocks for procedural sound. Owner: Role 3 (client, art, demo).
// Everything is scheduled at an exact AudioContext time, so cues and music line up with each other.
// One Synth is made per AudioContext. It owns the shared noise buffer and distortion curve, so no
// cue ever allocates a big buffer.
//
//   s.tone(dest, { type, f0, f1, t, a, d, gain, glide, filter, vibrato, tremolo })
//   s.noise(dest, { t, a, d, gain, filter: { type, f0, f1, q } })
//
// t: start time (seconds, context time). a: attack, d: decay after the attack (seconds).
// f0 -> f1: frequency sweep over a + d (exponential unless glide: "lin").
// Every source a call starts is pushed to s.sink (when set), so a voice can be cut short.

const MIN = 0.0001;

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    this.p = 1;          // pitch multiplier for the cue being built
    this.sink = null;    // array that collects started sources (a voice's)
    this.noiseBuf = makeNoise(ctx, 1);
    this.curve = makeCurve(18);
  }

  track(node) {
    if (this.sink) this.sink.push(node);
    return node;
  }

  // An envelope on a gain AudioParam: silent, up to peak over a, exponential fall over d.
  env(param, t, a, d, peak) {
    param.setValueAtTime(MIN, t);
    if (a > 0) param.linearRampToValueAtTime(peak, t + a);
    else param.setValueAtTime(peak, t);
    param.exponentialRampToValueAtTime(MIN, t + a + d);
    param.setValueAtTime(0, t + a + d + 0.005);
  }

  filter(o, t, len) {
    const f = this.ctx.createBiquadFilter();
    f.type = o.type || "lowpass";
    f.Q.value = o.q ?? 0.7;
    const f0 = Math.max(20, o.f0 * (o.fixed ? 1 : this.p));
    f.frequency.setValueAtTime(f0, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * (o.fixed ? 1 : this.p)), t + (o.over ?? len));
    return f;
  }

  // A slow wobble added onto an AudioParam (vibrato on frequency, tremolo on gain).
  lfo(param, t, end, rate, depth, type = "sine") {
    const osc = this.track(this.ctx.createOscillator());
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = rate;
    g.gain.value = depth;
    osc.connect(g).connect(param);
    osc.start(t);
    osc.stop(end);
    return osc;
  }

  tone(dest, o) {
    const ctx = this.ctx;
    const t = o.t;
    const a = o.a ?? 0.005;
    const d = o.d ?? 0.1;
    const len = a + d;
    const osc = this.track(ctx.createOscillator());
    osc.type = o.type || "sine";
    const p = o.fixed ? 1 : this.p;
    const f0 = Math.max(10, o.f0 * p);
    osc.frequency.setValueAtTime(f0, t);
    if (o.f1) {
      const f1 = Math.max(10, o.f1 * p);
      const at = t + (o.over ?? len);
      if (o.glide === "lin") osc.frequency.linearRampToValueAtTime(f1, at);
      else osc.frequency.exponentialRampToValueAtTime(f1, at);
    }
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    this.env(g.gain, t, a, d, o.gain ?? 0.2);
    let head = osc;
    if (o.shape) { const w = ctx.createWaveShaper(); w.curve = this.curve; head.connect(w); head = w; }
    if (o.filter) { const f = this.filter(o.filter, t, len); head.connect(f); head = f; }
    head.connect(g);
    if (o.tremolo) {
      const tg = ctx.createGain();
      tg.gain.value = 1 - o.tremolo.depth;
      g.connect(tg);
      this.lfo(tg.gain, t, t + len + 0.02, o.tremolo.rate, o.tremolo.depth);
      tg.connect(dest);
    } else {
      g.connect(dest);
    }
    if (o.vibrato) this.lfo(osc.frequency, t, t + len + 0.02, o.vibrato.rate, o.vibrato.depth * p);
    osc.start(t);
    osc.stop(t + len + 0.02);
    return t + len;
  }

  noise(dest, o) {
    const ctx = this.ctx;
    const t = o.t;
    const a = o.a ?? 0.002;
    const d = o.d ?? 0.05;
    const len = a + d;
    const src = this.track(ctx.createBufferSource());
    src.buffer = this.noiseBuf;
    src.loop = true;
    const g = ctx.createGain();
    this.env(g.gain, t, a, d, o.gain ?? 0.2);
    let head = src;
    if (o.shape) { const w = ctx.createWaveShaper(); w.curve = this.curve; head.connect(w); head = w; }
    if (o.filter) { const f = this.filter(o.filter, t, len); head.connect(f); head = f; }
    if (o.filter2) { const f = this.filter(o.filter2, t, len); head.connect(f); head = f; }
    head.connect(g).connect(dest);
    src.start(t, Math.random() * 0.8);
    src.stop(t + len + 0.02);
    return t + len;
  }
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// Soft clipping for a bit of grit on thumps and roars.
function makeCurve(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)) * 0.8;
  }
  return curve;
}
