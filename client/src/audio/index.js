// client/src/audio/index.js: All game sound, made procedurally with Web Audio. Owner: Role 3 (client, art, demo).
// No sound files: every effect and every note of music is synthesised (cues.js, music.js, synth.js).
//
//   import audio from "./audio/index.js";
//
//   audio.init(game)          Call once after the Phaser game exists. Reuses game.sound.context when it
//                             is a Web Audio context (else makes one), resumes it on the first pointer
//                             or key press, reads ?mute=1, restores mute from localStorage, and lets
//                             the M key toggle mute. Also turns off Phaser's pause-on-blur so the kiosk
//                             never goes silent when focus moves.
//   audio.sfx(name, opts?)    Fire and forget. Unknown names are a no-op (warned once).
//                             opts: { pitch (ratio, 1 = as written), gain (1 = as written), pan (-1..1),
//                                     durationMs (only for victory_water, unleash, tree_crack) }
//   audio.music(state)        "forest" | "boss" | "battle" | "victory" | "defeat" | null. Crossfades.
//                             victory and defeat are one-shot jingles (~1.9 s), then silence.
//   audio.setIntensity(x)     0..1: the battle's intensity layer (16th hats and arpeggio).
//   audio.setHeartbeat(on)    A double-thump heartbeat under the battle loop.
//   audio.duck(ms?)           Dips the music for big hits (default 250 ms). Several cues duck by themselves.
//   audio.setQuiet(bool)      Autopilot / attract: SFX -6 dB; no tick, time_up, ui_hover or step;
//                             no boss or battle loop. Jingles and the forest still play.
//   audio.toggleMute() -> bool, audio.isMuted() -> bool
//
// Cue names: see CUES in cues.js. step, hop, tick and ui_hover are rate-limited (MIN_GAP_MS), so
// they can be called from a walk cycle or every frame without piling up.
//
// Nothing here throws: with no AudioContext, or before it is unlocked, every call does nothing.
// Effects asked for while the context is still locked are dropped (not queued), so they cannot all
// burst out at once on the first click. The music state is remembered and starts on unlock.
//
// Mix: voices -> sfx bus (0.8) ─┐
//      music layers -> music bus (0.35) -> duck ─┴-> master (0.75, mute) -> low-pass 10 kHz
//      -> compressor (-18 dB, 4:1) -> limiter (-2 dB, 20:1) -> speakers.
// At most MAX_VOICES effects sound at once; the oldest is faded out to make room.
import { Synth } from "./synth.js";
import { CUES, MIN_GAP_MS, QUIET_SKIP } from "./cues.js";
import { Music } from "./music.js";

const MAX_VOICES = 24;
const MASTER = 0.75;
const SFX_LEVEL = 0.8;
const MUSIC_LEVEL = 0.35;
const STORE_KEY = "incube.audio.muted";

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.manualClock = false;
    this.muted = false;
    this.quiet = false;
    this.voices = [];
    this.lastAt = {};
    this.warned = new Set();
    this.wantedMusic = null;
    this.clock = null;
    this.initialised = false;
  }

  // ---------------- setup ----------------

  init(game) {
    if (this.initialised) return this;
    this.initialised = true;
    try {
      let ctx = game && game.sound && game.sound.context;
      if (!ctx || typeof ctx.createGain !== "function" || ctx.state === "closed") {
        const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
        ctx = Ctor ? new Ctor({ latencyHint: "interactive" }) : null;
      }
      if (game && game.sound && "pauseOnBlur" in game.sound) game.sound.pauseOnBlur = false;
      if (!ctx) { this.warn("no-ctx", "audio: no Web Audio support, staying silent"); return this; }
      this.attach(ctx);
      this.restoreMute();
      this.listen();
    } catch (error) {
      this.warn("init", "audio: init failed, staying silent", error);
    }
    return this;
  }

  // Builds the mix on a context. Tests pass an OfflineAudioContext with { manualClock: true } and
  // drive time themselves with _sfxAt / _musicAt / _musicTick.
  attach(ctx, { manualClock = false } = {}) {
    this.ctx = ctx;
    this.manualClock = manualClock;
    this.synth = new Synth(ctx);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 10000;
    tone.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 6;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.08;
    this.master.connect(tone).connect(comp).connect(limit).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = SFX_LEVEL;
    this.sfxBus.connect(this.master);

    this.duckNode = ctx.createGain();
    this.duckNode.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_LEVEL;
    this.musicBus.connect(this.duckNode);
    this.musicEngine = new Music(ctx, this.synth, this.musicBus);

    if (!manualClock && ctx.addEventListener) {
      ctx.addEventListener("statechange", () => {
        if (ctx.state === "running" && this.wantedMusic !== undefined) this.applyMusic();
      });
    }
    return this;
  }

  listen() {
    if (typeof window === "undefined") return;
    const unlock = () => {
      if (!this.ctx || this.ctx.state === "running") return;
      try { this.ctx.resume().catch(() => {}); } catch { /* ignore */ }
    };
    for (const type of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(type, unlock, { capture: true, passive: true });
    window.addEventListener("keydown", (event) => {
      if (event.code !== "KeyM" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = event.target && event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      this.toggleMute();
    });
    unlock();   // works straight away when Chromium runs with --autoplay-policy=no-user-gesture-required
  }

  restoreMute() {
    let muted = false;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("mute") === "1") muted = true;
      else muted = window.localStorage.getItem(STORE_KEY) === "1";
    } catch { /* storage blocked: default to sound on */ }
    this.setMuted(muted, false);
  }

  live() {
    return this.ctx && (this.manualClock || this.ctx.state === "running");
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  warn(key, ...args) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(...args);
  }

  // ---------------- effects ----------------

  sfx(name, opts = {}) {
    try {
      if (!CUES[name]) { this.warn(`cue:${name}`, `audio: unknown cue "${name}"`); return; }
      if (!this.live() || this.manualClock) return;
      this._sfxAt(name, this.now() + 0.005, opts);
    } catch (error) {
      this.warn(`err:${name}`, `audio: cue "${name}" failed`, error);
    }
  }

  // Schedules a cue at context time t. Returns its length in seconds (0 if skipped).
  _sfxAt(name, t, opts = {}) {
    const cue = CUES[name];
    if (!cue || !this.ctx) return 0;
    if (this.quiet && QUIET_SKIP.has(name)) return 0;
    const gap = (MIN_GAP_MS[name] ?? 25) / 1000;
    if (this.lastAt[name] !== undefined && t - this.lastAt[name] < gap && t >= this.lastAt[name]) return 0;
    this.lastAt[name] = t;

    this.prune(t);
    while (this.voices.length >= MAX_VOICES) this.kill(this.voices.shift(), t);

    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, opts.gain ?? 1);
    let head = out;
    if (opts.pan && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
      out.connect(pan);
      head = pan;
    }
    head.connect(this.sfxBus);
    const voice = { name, out, head, sources: [], end: t };
    this.synth.p = opts.pitch > 0 ? opts.pitch : 1;
    this.synth.sink = voice.sources;
    let length = 0;
    try {
      length = cue(this.synth, out, t, opts, this) || 0;
    } finally {
      this.synth.sink = null;
      this.synth.p = 1;
    }
    voice.end = t + length + 0.05;
    this.voices.push(voice);
    if (!this.manualClock) setTimeout(() => this.prune(this.now()), (voice.end - this.now()) * 1000 + 200);
    return length;
  }

  prune(t) {
    this.voices = this.voices.filter((voice) => {
      if (voice.end > t) return true;
      this.release(voice);
      return false;
    });
  }

  release(voice) {
    try { voice.head.disconnect(); if (voice.head !== voice.out) voice.out.disconnect(); } catch { /* already gone */ }
  }

  // Cuts a voice short with a quick fade, to make room for a new one.
  kill(voice, t) {
    if (!voice) return;
    try {
      voice.out.gain.cancelScheduledValues(t);
      voice.out.gain.setTargetAtTime(0, t, 0.01);
      for (const src of voice.sources) { try { src.stop(t + 0.06); } catch { /* already stopped */ } }
    } catch { /* ignore */ }
    if (this.manualClock) return;
    setTimeout(() => this.release(voice), 120);
  }

  // Dips the music: down to `level` (0..1) at `at`, back up after ms.
  duck(ms = 250, at, level = 0.3) {
    try {
      if (!this.ctx) return;
      const t = at ?? this.now();
      const g = this.duckNode.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
      else g.cancelScheduledValues(t);
      g.setTargetAtTime(level, t, 0.02);
      g.setTargetAtTime(1, t + ms / 1000, 0.15);
    } catch { /* ignore */ }
  }

  // ---------------- music ----------------

  music(state) {
    try {
      this.wantedMusic = state ?? null;
      if (!this.ctx || !this.live()) return;
      this.applyMusic();
    } catch (error) {
      this.warn("music", "audio: music failed", error);
    }
  }

  applyMusic() {
    const state = this.wantedMusic;
    this.musicEngine.set(state, this.now() + 0.02);
    // a jingle plays once: do not restart it on the next unlock or statechange
    if (state === "victory" || state === "defeat") this.wantedMusic = null;
    this.runClock();
  }

  runClock() {
    if (this.manualClock || this.clock) return;
    const tick = () => {
      try {
        const alive = this.musicEngine.tick(this.now());
        if (!alive && !this.musicEngine.state) { clearInterval(this.clock); this.clock = null; }
      } catch (error) {
        this.warn("tick", "audio: music tick failed", error);
      }
    };
    this.clock = setInterval(tick, 25);
    tick();
  }

  _musicAt(state, t) { this.musicEngine.set(state, t); }
  _musicTick(now) { return this.musicEngine.tick(now); }

  setIntensity(x) {
    try { if (this.ctx) this.musicEngine.setIntensity(Number(x) || 0, this.now()); } catch { /* ignore */ }
  }

  setHeartbeat(on) {
    try { if (this.ctx) this.musicEngine.setHeartbeat(Boolean(on), this.now()); } catch { /* ignore */ }
  }

  // ---------------- levels ----------------

  setQuiet(on) {
    this.quiet = Boolean(on);
    try {
      if (!this.ctx) return;
      this.sfxBus.gain.setTargetAtTime(SFX_LEVEL * (this.quiet ? 0.5 : 1), this.now(), 0.1);
      this.musicEngine.setQuiet(this.quiet, this.now());
    } catch { /* ignore */ }
  }

  setMuted(muted, persist = true) {
    this.muted = Boolean(muted);
    try {
      if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.now(), 0.03);
    } catch { /* ignore */ }
    if (persist) {
      try { window.localStorage.setItem(STORE_KEY, this.muted ? "1" : "0"); } catch { /* storage blocked */ }
    }
    return this.muted;
  }

  toggleMute() { return this.setMuted(!this.muted); }
  isMuted() { return this.muted; }
}

const audio = new AudioEngine();
export default audio;
