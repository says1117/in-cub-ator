// client/src/audio.js: Sound effects (generated beeps; swap for files later). Owner: Role 3 (client, art, demo).
let ctx = null;

addEventListener("pointerdown", () => {
  if (!ctx && window.AudioContext) ctx = new AudioContext();
}, { once: true });

export function beep(freq = 440, ms = 90, type = "square", gain = 0.04) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq; g.gain.value = gain;
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + ms / 1000);
}

export const sfx = {
  hit: () => beep(220, 70, "square"),
  bossHit: () => beep(120, 90, "sawtooth"),
  bossAppear: () => { beep(110, 200, "sawtooth"); setTimeout(() => beep(90, 300, "sawtooth"), 180); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 120, "triangle"), i * 110)),
};
