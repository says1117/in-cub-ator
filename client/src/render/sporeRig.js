// client/src/render/sporeRig.js: The Sporeling Trio, drawn from moving pieces. Owner: Role 3 (client, art, demo).
// Three sad mushrooms on one patch of ground. Each one is a stem and a cap, and each of those is cut
// into thin strips (sliced from the pictures in client/public/assets/bosses/sporelings), so a stem can
// bend like a soft stalk, swell and squash like something plump, and the goo hanging off a cap can
// swing and lag behind it. Every mushroom has a live face: eyes that open, close, blink and look,
// a mouth that opens, and feelings (see MOODS) that it moves between on its own and when the fight
// tells it to.
//
// It returns a Phaser container, the same way render/bossRig.js does, so a scene can treat it like
// a picture: x, y is the spot it stands on, setHeight() sizes it. It animates itself and stops when
// it is destroyed. What the fight can ask of it:
//   roar()                      rear back and roar, all three
//   act(name)                   a move: "gnash" (a three-bite combo), "volley" (a breath in, then a
//                               heave), "mycelium" (three stomps). Returns how long it runs, in ms.
//   emote(name, ms, stagger)    a feeling for a while: hurt, angry, shock, smug, alert, dizzy
//   setMood(name)               a lasting one: "enraged" or "dizzy", or null to go back to normal
//   react(power)                a shove: it jolts and wobbles, 1 is a normal hit
//   mouthPoint(i), mouthPoints()   where the mouths are on screen, for what comes out of them
//   capPoints()                 where the three caps are on screen
import Phaser from "phaser";
import { rigPartKey } from "../data/bosses.js";
import { createCastShadow, outlineOfPicture } from "./castShadow.js";

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (v) => v * v * (3 - 2 * v);
const easeOut = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const sin = Math.sin;

const INK = 0x2a1030;
const PINK = 0xd878a8;
const PINK_DARK = 0x9c3f78;
const PINK_LIGHT = 0xf4a8c8;
const SKIN = 0xf6e6d2;
const WHITE = 0xfff6ec;
const TEAR = 0x7fd0ff;

// What a face moves toward for each feeling. Anything left out is 0.
//   open: the eyes, 0 shut to 1 wide.   lid: -1 a sad droop to 1 an angry frown.   mouth: 0 shut to 1 wide.
//   curve: -1 a frown to 1 a smile.   squint, happy, ko: a kind of eye (> <, ^ ^, x x).   wide: bigger eyes and mouth.
//   teeth, tongue, round (an "o" mouth), tear, shiver: extras.   look: where the eyes point, [-1..1, -1..1].
const MOODS = {
  hurt: { squint: 1, mouth: 0.9, curve: -1, tear: 1, shiver: 1 },
  angry: { open: 0.85, lid: 0.9, mouth: 0.42, curve: -0.3, teeth: 1, brow: 1, look: [-1, 0.1] },
  roar: { open: 0.25, lid: 1, mouth: 1, curve: 0, teeth: 1, wide: 1, brow: 1 },
  shock: { open: 1, lid: 0, mouth: 0.55, curve: 0, wide: 1, round: 1, look: [0, 0] },
  smug: { happy: 1, mouth: 0.18, curve: 0.9 },
  alert: { open: 0.95, lid: 0.35, mouth: 0.1, curve: -0.4, look: [-1, 0.2] },
  dizzy: { ko: 1, mouth: 0.45, curve: -0.3, tongue: 1 },
  enraged: { open: 0.95, lid: 0.95, mouth: 0.38, curve: -0.4, teeth: 1, brow: 1, shiver: 0.4, look: [-1, 0.1] },
};
const KEYS = ["open", "lid", "mouth", "curve", "squint", "happy", "ko", "wide", "teeth", "tongue", "round", "tear", "shiver", "brow", "lookX", "lookY"];

// ------------------------------------------------------------------ a move, as numbers over time
// Each returns how that one mushroom is posed `ms` after its own start. lean and shift are pixels at
// the mushroom's neck (+ is away from the plant), squash is how flat it is, capTilt turns the cap.
function pose(name, ms) {
  const v = { lean: 0, shift: 0, squash: 0, capLift: 0, capTilt: 0, mouth: -1, mood: null, done: false };
  if (name === "gnash") {
    // rear back, dive at the plant with the mouth open, snap it shut, pull back
    const rear = easeOut(ms / 190);
    const dive = smooth(clamp01((ms - 190) / 110));
    const back = smooth(clamp01((ms - 330) / 300));
    v.lean = ms < 190 ? 60 * rear : lerp(60, -150, dive) * (1 - back);
    v.shift = -60 * dive * (1 - back);
    v.mouth = ms < 190 ? rear : ms < 300 ? 1 - dive * 0.9 : 0.1 * (1 - back);
    v.squash = ms < 190 ? -0.05 * rear : 0.08 * dive * (1 - back);
    v.capTilt = (ms < 190 ? 0.12 * rear : lerp(0.12, -0.26, dive)) * (1 - back);
    v.capLift = ms < 190 ? -18 * rear : 8 * (1 - back);
    v.mood = "angry";
    v.done = ms > 650;
  } else if (name === "volley") {
    // breathe in: swell up and lean back with the cap thrown open, then heave it all out
    const breath = smooth(clamp01(ms / 300));
    const heave = smooth(clamp01((ms - 300) / 110));
    const back = smooth(clamp01((ms - 480) / 380));
    v.lean = lerp(70 * breath, -120, heave) * (1 - back);
    v.squash = lerp(-0.1 * breath, 0.16, heave) * (1 - back);
    v.capTilt = lerp(0.2 * breath, -0.3, heave) * (1 - back);
    v.capLift = lerp(-34 * breath, 14, heave) * (1 - back);
    v.mouth = ms < 300 ? 0.35 + 0.3 * breath : 1 - back;
    v.mood = ms < 300 ? "shock" : "roar";
    v.done = ms > 900;
  } else if (name === "mycelium") {
    // rise on the roots, then slam down hard
    const rise = smooth(clamp01(ms / 150));
    const slam = smooth(clamp01((ms - 150) / 55));
    const rebound = smooth(clamp01((ms - 205) / 300));
    v.squash = lerp(-0.12 * rise, 0.26, slam) * (1 - rebound * 0.95);
    v.lean = (1 - slam) * 30 * rise;
    v.capLift = -24 * rise * (1 - slam) + 12 * slam * (1 - rebound);
    v.capTilt = 0.1 * rise * (1 - slam);
    v.mouth = 0.5 * (1 - slam);
    v.mood = "angry";
    v.done = ms > 700;
  } else if (name === "roar") {
    const rear = smooth(clamp01(ms / 320));
    const back = smooth(clamp01((ms - 1000) / 400));
    const buzz = ms > 340 && ms < 1100 ? sin(ms * 0.08) : 0;
    v.lean = 80 * rear * (1 - back) + buzz * 8;
    v.squash = -0.06 * rear * (1 - back) + buzz * 0.012;
    v.capTilt = 0.22 * rear * (1 - back) + buzz * 0.03;
    v.capLift = -30 * rear * (1 - back);
    v.mouth = rear * (1 - back);
    v.mood = "roar";
    v.done = ms > 1400;
  } else v.done = true;
  return v;
}

const ACT_DELAYS = {
  gnash: { L: 0, F: 130, R: 260 },        // left to right
  volley: { L: 0, F: 30, R: 60 },
  mycelium: { L: 0, F: 130, R: 260 },
  roar: { L: 0, F: 70, R: 140 },
};
const ACT_LENGTH = { gnash: 910, volley: 900, mycelium: 700, roar: 1540 };

// ------------------------------------------------------------------ faces
const poly = (g, points, color, alpha = 1) => {
  g.fillStyle(color, alpha);
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.fillPath();
};
const line = (g, points, width, color = INK) => {
  g.lineStyle(width, color, 1);
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.strokePath();
};
const curveY = (u, curve) => curve * 12 * (1 - (2 * u - 1) ** 2);

function drawEye(g, s, ex, cx, S) {
  const W = 40 * S * (1 + 0.28 * ex.wide);
  const lw = 6.5 * S;
  const inner = -s;   // which way the middle of the face is
  if (ex.ko > 0.5) {
    line(g, [[cx - W * 0.4, -W * 0.4], [cx + W * 0.4, W * 0.4]], lw);
    line(g, [[cx + W * 0.4, -W * 0.4], [cx - W * 0.4, W * 0.4]], lw);
    return;
  }
  if (ex.happy > 0.5) {
    line(g, [[cx - W * 0.5, 7 * S], [cx - W * 0.25, -5 * S], [cx, -10 * S], [cx + W * 0.25, -5 * S], [cx + W * 0.5, 7 * S]], lw);
    return;
  }
  if (ex.squint > 0.5) {
    line(g, [[cx - inner * W * 0.4, -W * 0.36], [cx + inner * W * 0.4, 0], [cx - inner * W * 0.4, W * 0.36]], lw);
    return;
  }
  const open = ex.open;
  if (open < 0.16) {
    // shut: a drooping arc when sad, a frowning one when angry
    const sad = Math.max(0, -ex.lid), mad = Math.max(0, ex.lid);
    const outerY = 5 * S + 8 * S * sad - 3 * S * mad;
    const innerY = -4 * S - 6 * S * sad + 9 * S * mad;
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const x = lerp(cx - inner * W * 0.5, cx + inner * W * 0.5, k);
      pts.push([x, lerp(outerY, innerY, k) + sin(Math.PI * k) * 9 * S]);
    }
    line(g, pts, lw + 1);
    return;
  }
  const H = (10 + open * (W * 1.15)) * (1 + 0.15 * ex.wide);
  g.fillStyle(INK, 1); g.fillEllipse(cx, 0, W + 11 * S, H + 11 * S);
  g.fillStyle(WHITE, 1); g.fillEllipse(cx, 0, W, H);
  const pr = Math.min(W, H) * (ex.wide > 0.5 && ex.round > 0.5 ? 0.3 : 0.5);
  const px = cx + ex.lookX * W * 0.2, py = ex.lookY * H * 0.2;
  g.fillStyle(INK, 1); g.fillEllipse(px, py, pr * 1.9, pr * 2.1);
  g.fillStyle(0xffffff, 1); g.fillCircle(px - pr * 0.35, py - pr * 0.4, Math.max(2, pr * 0.3));
  // an eyelid: sad lids sag at the outer corner, angry ones come down at the inner corner
  const lid = ex.lid;
  if (Math.abs(lid) > 0.08) {
    const top = -H / 2 - 7 * S;
    const down = H * (0.2 + 0.5 * Math.abs(lid));
    const innerY = lid > 0 ? top + down + 7 * S : top + 9 * S + down * 0.2;
    const outerY = lid > 0 ? top + 9 * S + down * 0.2 : top + down + 7 * S;
    const xi = cx + inner * (W / 2 + 7 * S), xo = cx - inner * (W / 2 + 7 * S);
    poly(g, [[xi, top], [xo, top], [xo, outerY], [xi, innerY]], SKIN);
    line(g, [[xi, innerY], [xo, outerY]], lw * 0.9);
  }
  if (ex.brow > 0.3) {
    const y0 = -H / 2 - 16 * S;
    line(g, [[cx + inner * W * 0.6, y0 + 9 * S * ex.lid], [cx - inner * W * 0.6, y0 - 7 * S * ex.lid]], lw * 1.2);
  }
}

function drawMouth(g, ex, cy, S) {
  const open = ex.mouth;
  let Wm = (56 + 26 * ex.wide) * S;
  const H = open > 0.06 ? (7 + open * 50) * S : 0;
  if (ex.round > 0.5) Wm = lerp(Wm, Math.max(H, 22 * S) * 0.85, ex.round);
  const lens = (top, bottom) => {
    const upper = [], lower = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, x = (u - 0.5) * Wm;
      upper.push([x, top(u)]);
      lower.push([x, bottom(u)]);
    }
    return upper.concat(lower.reverse());
  };
  const c = (u) => 1 - (2 * u - 1) ** 2;
  if (H === 0) {
    // lips, pushed out
    const shape = lens((u) => cy + curveY(u, ex.curve) - 7 * S * c(u), (u) => cy + curveY(u, ex.curve) + 7 * S * c(u));
    poly(g, shape, PINK);
    line(g, shape.concat([shape[0]]), 4.5 * S);
    line(g, Array.from({ length: 13 }, (_, i) => [((i / 12) - 0.5) * Wm, cy + curveY(i / 12, ex.curve)]), 3 * S, PINK_DARK);
    return;
  }
  const top = (u) => cy + curveY(u, ex.curve) - H * 0.3 * Math.pow(c(u), 0.6);
  const bottom = (u) => cy - curveY(u, ex.curve) * 0.5 + H * 0.7 * Math.pow(c(u), 0.7);
  const shape = lens(top, bottom);
  poly(g, shape, PINK_DARK);
  if (H > 22 * S) {
    // the tongue
    g.fillStyle(PINK_LIGHT, 1); g.fillEllipse(0, cy + H * 0.46, Wm * 0.5, H * 0.34);
  }
  line(g, shape.concat([shape[0]]), 5 * S);
  if (ex.teeth > 0.5) {
    for (let i = 1; i <= 5; i++) {
      const u = 0.12 + (i - 1) * 0.19, x = (u - 0.5) * Wm, y = top(u);
      poly(g, [[x - 5.5 * S, y + 2], [x + 5.5 * S, y + 2], [x, y + 12 * S]], WHITE);
    }
  }
  if (ex.tongue > 0.5) {
    const y = bottom(0.62);
    poly(g, [[Wm * 0.1, y - 3], [Wm * 0.3, y - 3], [Wm * 0.28, y + 20 * S], [Wm * 0.2, y + 25 * S], [Wm * 0.12, y + 20 * S]], PINK_LIGHT);
    line(g, [[Wm * 0.1, y - 3], [Wm * 0.12, y + 20 * S], [Wm * 0.2, y + 25 * S], [Wm * 0.28, y + 20 * S], [Wm * 0.3, y - 3]], 4 * S);
  }
}

function drawFace(g, ex, geo) {
  g.clear();
  const S = geo.size, half = geo.spacing / 2;
  if (ex.shiver > 0.05) {
    // the little marks a shaking thing gets
    g.lineStyle(7 * S, INK, Math.min(1, ex.shiver * 1.4));
    for (const s of [-1, 1]) {
      g.lineBetween(s * (half + 70 * S), -40 * S, s * (half + 70 * S), 48 * S);
      g.lineBetween(s * (half + 88 * S), -24 * S, s * (half + 88 * S), 36 * S);
    }
  }
  drawEye(g, -1, ex, -half, S);
  drawEye(g, 1, ex, half, S);
  if (ex.tear > 0.05) {
    for (const s of [-1, 1]) {
      const y = 26 * S + (1 - ex.tear) * 40 * S;
      g.fillStyle(TEAR, 0.9); g.fillEllipse(s * (half + 14 * S), y, 11 * S, 17 * S);
    }
  }
  drawMouth(g, ex, geo.drop, S);
}

// ------------------------------------------------------------------ the rig
export function createSporeRig(scene, art, x, y, height, options = {}) {
  const rig = art.rig;
  const o = rig.origin;
  const root = scene.add.container(x, y);
  const body = scene.add.container(0, 0);

  if (scene.textures.exists(art.key)) {
    const picture = scene.textures.get(art.key).getSourceImage();
    root.add(createCastShadow(scene, outlineOfPicture(scene, art.key, 0.5, 0.93), { light: options.light, size: rig.height / picture.height }));
  }
  root.add(body);

  // the thin slices of a piece: one picture each, cut from the whole
  function slice(partName, count, anchor) {
    const spec = rig.parts[partName];
    const key = rigPartKey(art, partName);
    const texture = scene.textures.get(key);
    const items = [];
    for (let i = 0; i < count; i++) {
      const y0 = Math.floor((i * spec.h) / count);
      const y1 = Math.min(spec.h, Math.floor(((i + 1) * spec.h) / count) + 1);
      const frame = `${i}/${count}`;
      if (!texture.has(frame)) texture.add(frame, 0, 0, y0, spec.w, y1 - y0);
      const img = scene.add.image(0, 0, key, frame).setOrigin(0.5, 0);
      items.push({ img, cx: spec.x + spec.w / 2 - anchor.x, top: spec.y + y0 - anchor.y, mid: (y0 + y1) / 2 / spec.h, midY: spec.y + (y0 + y1) / 2 });
    }
    return items;
  }

  const ground = scene.add.image(rig.parts.puddle.x - o.x, rig.parts.puddle.y - o.y, rigPartKey(art, "puddle")).setOrigin(0, 0);
  body.add(ground);

  const folk = rig.mushrooms.map((spec, index) => {
    const base = spec.base, neck = spec.neck;
    const holder = scene.add.container(base.x - o.x, base.y - o.y);
    const stem = slice(spec.stem, spec.strips[0], base);
    holder.add(stem.map((s) => s.img));
    const faceC = scene.add.container(0, 0);
    const faceG = scene.add.graphics();
    faceC.add(faceG);
    holder.add(faceC);
    const capHolder = scene.add.container(neck.x - base.x, neck.y - base.y);
    const cap = slice(spec.cap, spec.strips[1], neck);
    capHolder.add(cap.map((s) => s.img));
    holder.add(capHolder);
    body.add(holder);
    const neckHeight = base.y - neck.y;
    const ex = { lookX: 0, lookY: 0 };
    for (const key of KEYS) if (ex[key] === undefined) ex[key] = 0;
    return {
      spec, index, holder, stem, cap, faceC, faceG, capHolder, neckHeight, ex,
      // springs: x is how far from rest, v how fast it is going
      leanS: { x: 0, v: 0 }, squashS: { x: 0, v: 0 }, capS: { x: 0, v: 0 },
      blinkAt: 1500 + index * 900, blinkUntil: 0,
      emote: null, act: null, wobble: 0,
    };
  });

  for (const m of folk) Object.assign(m.ex, moodTarget(m, null));   // start with its own face, not a blank one

  // floating spores drift up round the caps
  const sporeG = scene.add.graphics();
  root.add(sporeG);
  const spores = Array.from({ length: 22 }, (_, i) => ({ seed: (i * 0.6180339) % 1, who: i % 3, size: 4 + (i % 4) * 2, speed: 0.05 + (i % 5) * 0.012 }));

  let now = scene.time.now;
  let last = now;
  let mood = null;               // a lasting feeling
  let boost = 0;                 // when spores were last blown out
  const offset = Phaser.Math.FloatBetween(0, 20);

  const spring = (s, target, k, c, dt) => {
    s.v += (-k * (s.x - target) - c * s.v) * dt;
    s.x += s.v * dt;
  };

  function moodTarget(m, name) {
    const t = {};
    for (const key of KEYS) t[key] = 0;
    const base = m.spec.mood;
    Object.assign(t, { open: base.open, lid: base.lid, mouth: base.mouth, curve: base.curve, lookX: base.look[0], lookY: base.look[1] });
    const apply = (def) => {
      for (const [key, value] of Object.entries(def)) {
        if (key === "look") { t.lookX = value[0]; t.lookY = value[1]; } else t[key] = value;
      }
    };
    if (name) apply(MOODS[name]);
    return t;
  }

  function update(time) {
    const dt = Math.min(0.05, (time - last) / 1000);
    last = time;
    now = time;
    const clock = time / 1000 + offset;
    const enraged = mood === "enraged";
    const dizzy = mood === "dizzy";
    const fury = enraged ? 1 : 0;

    for (const m of folk) {
      const { spec, ex } = m;
      const t = clock * spec.rate * (1 + 0.45 * fury) + spec.phase;

      // what its current move asks of it
      let a = null;
      if (m.act) {
        const ms = time - m.act.start;
        if (ms >= 0) {
          a = pose(m.act.name, ms);
          if (a.done) m.act = null;
        }
      }
      if (m.emote && time > m.emote.until) m.emote = null;

      // the feeling it moves toward: a move's, then a short feeling, then a lasting one, then its own
      let name = dizzy ? "dizzy" : null;
      if (!name && a && a.mood) name = a.mood;
      if (!name && m.emote && time >= m.emote.start) name = m.emote.name;
      if (!name && enraged) name = "enraged";
      const target = moodTarget(m, name);
      if (!name) {
        // its own mood: it blinks, looks about and sighs
        if (time > m.blinkAt) { m.blinkUntil = time + 150; m.blinkAt = time + 2200 + ((m.index * 977 + Math.floor(time / 1000) * 331) % 3200); }
        target.lookX += 0.6 * sin(clock * 0.45 + spec.phase);
        target.lookY += 0.3 * sin(clock * 0.31 + spec.phase * 2);
        target.mouth += 0.12 * (0.5 + 0.5 * sin(clock * 0.9 + spec.phase)) * (spec.mood.mouth > 0 ? 1 : 0.4);
        if (time < m.blinkUntil && target.open > 0.2) target.open = 0;
      }
      if (a && a.mouth >= 0) target.mouth = a.mouth;
      if (dizzy) target.open = 0;
      const k = 1 - Math.exp(-dt * (name === "hurt" || (a && a.mood) ? 22 : 9));
      for (const key of KEYS) ex[key] += (target[key] - ex[key]) * k;

      // the body: a slow sway, a quicker ripple up it, a breath, and whatever it is doing
      const sway = spec.sway * (1 + 0.5 * fury) * (dizzy ? 0.35 : 1);
      const leanAct = a ? a.lean : 0;
      spring(m.leanS, 0, 70, 6.5, dt);
      spring(m.squashS, 0, 95, 8.5, dt);
      spring(m.capS, 0, 60, 5.5, dt);
      const lean = sway * (0.7 * sin(0.9 * t) + 0.3 * sin(1.9 * t + 1.3)) + leanAct + m.leanS.x + (dizzy ? 26 * sin(0.7 * t) : 0);
      const ripple = sway * 0.16 * (1 + fury);
      const bend = (u) => Math.pow(Math.max(0, u), 1.7);
      const dxAt = (u) => lean * bend(u) + ripple * sin(3.1 * t - u * 4) * Math.min(1, u) + (a ? a.shift * Math.min(1, u) : 0);
      const squash = (a ? a.squash : 0) + m.squashS.x + (dizzy ? 0.07 : 0) + 0.012 * sin(1.6 * t);
      const plump = 0.03 * sin(1.5 * t + 0.4);
      const sxAt = (u) => (1 + plump * (0.6 + 0.4 * sin(Math.PI * clamp01(u))) + squash * 0.75);
      m.holder.scaleY = 1 - squash;

      const span = spec.base.y - spec.neck.y;
      for (const s of m.stem) {
        const u = (spec.base.y - s.midY) / span;
        s.img.x = s.cx + dxAt(u);
        s.img.y = s.top;
        s.img.scaleX = sxAt(u);
      }

      // the cap sits on the top of the stem and lags behind it
      const slope = (1.7 * lean) / span;
      spring(m.capS, slope * 0.55, 60, 5.5, dt);
      const capTilt = m.capS.x + 0.035 * sin(1.3 * t + 0.9) + (a ? a.capTilt : 0) + (dizzy ? 0.2 : 0);
      m.capHolder.x = spec.neck.x - spec.base.x + dxAt(1);
      m.capHolder.y = spec.neck.y - spec.base.y + 3 * sin(2.0 * t) + (a ? a.capLift : 0);
      m.capHolder.rotation = capTilt;
      m.capHolder.scaleY = 1 + 0.02 * sin(1.7 * t + 0.6) - (a ? a.squash * 0.5 : 0);
      for (const s of m.cap) {
        // the dome holds still; the goo that hangs off it swings, a little behind
        const k2 = smooth(clamp01((s.mid - 0.4) / 0.6));
        s.img.x = s.cx + k2 * spec.drip * (sin(2.3 * t - s.mid * 3.4) + 0.45 * sin(4.3 * t + s.mid * 2) + m.wobble * sin(9 * t) * 0.8);
        s.img.y = s.top;
        s.img.scaleX = 1 + 0.02 * sin(1.6 * t + 0.6);
      }
      m.wobble *= Math.pow(0.04, dt);

      // the face rides on the stem
      const uf = (spec.base.y - spec.face.y) / span;
      m.faceC.x = spec.face.x - spec.base.x + dxAt(uf);
      m.faceC.y = spec.face.y - spec.base.y;
      m.faceC.rotation = spec.face.rot + (1.7 * lean * Math.pow(Math.max(0, uf), 0.7)) / span;
      m.faceC.scaleX = sxAt(uf);
      drawFace(m.faceG, ex, { size: spec.face.size, spacing: spec.face.spacing, drop: spec.face.drop });

      // it glows red and sweats when enraged
      const tint = enraged ? Phaser.Display.Color.GetColor(255, 170 + 50 * sin(time * 0.012), 170 + 50 * sin(time * 0.012)) : 0xffffff;
      for (const s of m.stem) s.img.setTint(tint);
      for (const s of m.cap) s.img.setTint(tint);
    }

    // spores: slow motes rising off the caps; more, and redder, when it is angry or just roared
    sporeG.clear();
    const burst = clamp01(1 - (time - boost) / 1400);
    for (const sp of spores) {
      const m = folk[sp.who];
      const progress = (clock * sp.speed * (1 + 1.2 * fury + burst * 2) + sp.seed) % 1;
      const wx = m.spec.neck.x - o.x + (sp.seed - 0.5) * 340 + 36 * sin(clock * 0.7 + sp.seed * 20);
      const wy = m.spec.neck.y - o.y - 40 - progress * 300;
      const alpha = Math.sin(Math.PI * progress) * (0.5 + 0.4 * burst + 0.2 * fury);
      sporeG.fillStyle(enraged ? 0xff6b8a : sp.who === 0 ? 0xff7aa8 : 0xb890ff, alpha);
      sporeG.fillCircle(wx, wy, sp.size * (1 + 0.4 * burst));
      sporeG.fillStyle(0xffffff, alpha * 0.6);
      sporeG.fillCircle(wx - sp.size * 0.25, wy - sp.size * 0.25, sp.size * 0.35);
    }
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  root.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, update));

  root.isBossRig = true;
  root.roarLength = ACT_LENGTH.roar;
  root.setHeight = (value) => root.setScale(value / rig.height);

  // a move or a roar, started now, a little later for each mushroom in turn
  root.act = (name) => {
    const delays = ACT_DELAYS[name] || {};
    for (const m of folk) m.act = { name, start: now + (delays[m.spec.id] || 0) };
    if (name === "roar" || name === "volley") boost = now + 400;
    return ACT_LENGTH[name] || 0;
  };
  root.roar = () => { root.act("roar"); boost = now; folk.forEach((m) => { m.wobble = 1; m.leanS.v += 120; }); };
  root.emote = (name, ms = 800, stagger = 90) => {
    if (!MOODS[name]) return;
    folk.forEach((m, i) => { m.emote = { name, start: now + i * stagger, until: now + i * stagger + ms }; });
  };
  root.setMood = (name) => { mood = name || null; };
  root.getMood = () => mood;
  // a shove: it lurches away and wobbles back, plumper than it is tall
  root.react = (power = 1) => {
    folk.forEach((m, i) => {
      const delay = i * 60;
      scene.time.delayedCall(delay, () => {
        m.leanS.v += 520 * power;
        m.squashS.v += 2.6 * power;
        m.capS.v += 1.8 * power;
        m.wobble = Math.min(2.5, m.wobble + power);
      });
    });
  };

  const screenAt = (m, lx, ly, source) => {
    const matrix = source.getWorldTransformMatrix();
    return { x: matrix.getX(lx, ly), y: matrix.getY(lx, ly) };
  };
  root.mouthPoint = (i = 0) => {
    const m = folk[i];
    return screenAt(m, 0, m.spec.face.drop, m.faceC);
  };
  root.mouthPoints = () => folk.map((m, i) => root.mouthPoint(i));
  root.capPoints = () => folk.map((m) => screenAt(m, 0, -160, m.capHolder));
  root.mushroomCount = folk.length;

  root.setHeight(height);
  update(now);
  return root;
}
