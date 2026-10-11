// client/src/render/heroSprite.js: The dragon, the character who walks the forest. Owner: Role 3 (client, art, demo).
// It is one picture cut into nine layers (client/public/assets/characters/dragon): tail, wing, two
// legs, torso, two arms, hat and head (headBack and torsoBack are the head and torso with nothing drawn on them). Every frame they are put back together on one small canvas,
// each moved a little, and that canvas is the texture "plantHero" the scenes already draw. So
// nothing that shows it (the forest walk, the boss arrival, the battle screen) needs to know it moves.
// A second texture, "heroBack", is the same dragon seen from behind, for when it turns to face a boss.
//
//   preloadHeroArt(scene)        call from a scene's preload()
//   ensureHeroTexture(scene)     makes both textures and starts them moving. Safe to call from any scene, any number of times.
//   setHeroWalking(true)         walking: legs step, arms swing, tail streams, wing beats. false: it stands and idles.
//   setHeroMood("brave")         the face and stance it holds from now on. null: back to its own moods.
//   setHeroMood("worry", 900)    the same, but only for that many milliseconds.
//   heroStartle(1300)            a fright: it shoots into the air flapping, for that long, then drops.
//   heroFlutter()                a small happy hop on its wings.
//   showHeroBack(true)           keep the back view moving too (only while something is showing it).
//
// Moods: calm, walk, happy, shock, scared, brave, shout, worry, cheer, sad.
//
// What moves: the tail waves along its whole length, the wing folds, flicks and beats (a second
// wing opens behind it when it flies), the hat bounces and its spire whips about a beat behind the
// head, the head nods and tilts, the legs step, the arms swing or fly up, the chest breathes, the
// whole body squashes when it lands. The eyes, brows and mouth are not part of the picture: they
// are drawn here, so they can blink, look about, widen, squint and shout.
//
// Every number below that is a place is a pixel in the uncut 226 x 288 picture.

export const HERO_KEY = "plantHero";
export const HERO_BACK_KEY = "heroBack";
const FOLDER = "/assets/characters/dragon";
const LAYERS = ["tail", "wing", "legL", "legR", "torso", "armL", "armR", "hat", "head", "headBack", "torsoBack"];
const layerKey = (name) => `hero-${name}`;

const ART = { w: 226, h: 288 };
const PAD = 44;                 // room at the sides for the tail and the far wing
const TOP = 96;                 // room above: it flies up inside its own picture, so its shadow stays on the ground
const FLOOR = 4;
export const HERO_SIZE = { w: ART.w + PAD * 2, h: ART.h + TOP + FLOOR };
export const HERO_BODY_SHARE = ART.h / HERO_SIZE.h;   // how much of the picture's height is dragon

const FEET = { x: 140, y: 286 };
const HIPS = { x: 148, y: 250 };        // the torso leans and breathes about here
const NECK = { x: 160, y: 156 };        // the head turns about here
const SHOULDER_L = { x: 124, y: 167 };
const SHOULDER_R = { x: 178, y: 179 };
const HIP_L = { x: 104, y: 232 };
const HIP_R = { x: 170, y: 243 };
const WING = { x: 109, y: 167 };        // where the wing joins the back
const WING_MIRROR = 141;                // the far wing is the near one flipped about this line
const TAIL = { x: 95, y: 248 };         // where the tail joins the body
const TAIL_ROWS = [166, 288];
const HAT_BASE = 96;                    // the row the hat sits on
const HAT_ROWS = 116;
const SPIRE_ROWS = 58;                  // the rows above the brim, which whip about
const HEAD_ROWS = 166;
const EYE_L = { x: 147, y: 125, w: 8.5, h: 10 };
const EYE_R = { x: 185.5, y: 124, w: 6.5, h: 10 };
const MOUTH = { x: 168, y: 148 };
const STEP_RATE = 0.012;                // the same beat AdventureScene bounces it to

const SHADE = "#2c9a3e";
const INK = "#06180c";

// What each mood does to the face and the body. Numbers are eased toward, so moods melt into each other.
//   open: how open the eyes are   size: how big   white: 1 = wide white eyes with pin pupils
//   tilt: brows, 1 = worried (inner ends up), -1 = fierce   lift: brows raised by this many pixels
//   arms: 1 = thrown up   flap: how hard the wings beat on the ground   wag: how fast the tail goes
const MOODS = {
  calm:   { open: 1,    size: 1,    white: 0, tilt: 0,    lift: 0,  arms: 0,    flap: 0,    wag: 0.25, mouth: "smile" },
  walk:   { open: 1,    size: 1,    white: 0, tilt: 0.1,  lift: 1,  arms: 0,    flap: 0.16, wag: 0.6,  mouth: "open" },
  happy:  { open: 1,    size: 1,    white: 0, tilt: 0.2,  lift: 2,  arms: 0.15, flap: 0.3,  wag: 1,    mouth: "grin", arcs: true },
  shock:  { open: 1.15, size: 1.22, white: 1, tilt: 0.5,  lift: 5,  arms: 0.35, flap: 0.35, wag: 0,    mouth: "oh" },
  scared: { open: 1.2,  size: 1.3,  white: 1, tilt: 1,    lift: 5,  arms: 1,    flap: 1,    wag: 0,    mouth: "scream" },
  brave:  { open: 0.82, size: 1,    white: 0, tilt: -1,   lift: -2, arms: 0.1,  flap: 0.22, wag: 0.45, mouth: "smirk" },
  shout:  { open: 0.9,  size: 1.05, white: 0, tilt: -1,   lift: -1, arms: 0.7,  flap: 0.6,  wag: 0.8,  mouth: "yell" },
  worry:  { open: 1.05, size: 1.1,  white: 0, tilt: 1,    lift: 3,  arms: 0.3,  flap: 0.2,  wag: 0.1,  mouth: "wobble" },
  cheer:  { open: 1,    size: 1,    white: 0, tilt: 0.2,  lift: 3,  arms: 1,    flap: 0.7,  wag: 1,    mouth: "grin", arcs: true },
  sad:    { open: 0.6,  size: 1,    white: 0, tilt: 1,    lift: 0,  arms: 0,    flap: 0,    wag: 0,    mouth: "frown" },
};

let walking = false;
let heldMood = null;                    // set by a scene, kept until changed
let briefMood = null, briefUntil = 0;   // set by a scene for a moment
let act = null, actUntil = 0, nextActAt = 2500;   // little things it does by itself while standing
let nextHopAt = 2500;
let flyUntil = 0, flyHeight = 0;
let backShown = false;
let started = false;
let clock = 0;

// everything that carries on from one frame to the next
const P = {
  walk: 0, air: 0, fall: 0, flap: 0, wingPhase: 0, tailPhase: 0, wasStep: 1, landedAt: -9999,
  open: 1, size: 1, white: 0, tilt: 0, lift: 0, arms: 0, wag: 0.25, lookX: 0, lookY: 0, scare: 0,
  blinkAt: 1500, blinkUntil: 0,
  squash: { x: 0, v: 0 }, hatLift: { x: 0, v: 0 }, hatTilt: { x: 0, v: 0 }, spire: { x: 0, v: 0 }, headTilt: { x: 0, v: 0 },
};

const spring = (s, target, stiff, damp, dt) => {
  s.v += ((target - s.x) * stiff - s.v * damp) * dt;
  s.x += s.v * dt;
};
const ease = (from, to, rate, dt) => from + (to - from) * Math.min(1, dt * rate);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function setHeroWalking(on) { walking = Boolean(on); }

export function setHeroMood(mood, ms = 0) {
  const known = mood && MOODS[mood] ? mood : null;
  if (ms > 0) { briefMood = known; briefUntil = clock + ms; }
  else { heldMood = known; briefMood = null; }
}

export function heroStartle(ms = 1300, height = 62) {
  flyUntil = clock + ms;
  flyHeight = height;
  briefMood = "scared";
  briefUntil = clock + ms + 350;
  P.squash.v = -0.004;                  // it stretches as it shoots up
  P.hatLift.v = 0.16;                   // and its hat is left behind for a moment
}

export function heroFlutter(ms = 820, height = 36) {
  if (clock < flyUntil || P.air > 1) return;
  flyUntil = clock + ms;
  flyHeight = height;
  P.squash.v = -0.002;
  P.hatLift.v = 0.07;
}

export function showHeroBack(on) { backShown = Boolean(on); }

export function preloadHeroArt(scene) {
  for (const name of LAYERS) {
    if (!scene.textures.exists(layerKey(name))) scene.load.image(layerKey(name), `${FOLDER}/${name}.png`);
  }
}

export const heroLayer = (scene, name) => scene.textures.get(layerKey(name)).getSourceImage();
export const hasHeroArt = (scene) => LAYERS.every((name) => scene.textures.exists(layerKey(name)));
export const ensureHeroBackTexture = (scene) => ensureHeroTexture(scene);

const scratch = (w, h) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
};

export function ensureHeroTexture(scene) {
  if (scene.textures.exists(HERO_KEY) || !hasHeroArt(scene)) return;
  const front = scene.textures.createCanvas(HERO_KEY, HERO_SIZE.w, HERO_SIZE.h);
  const rear = scene.textures.createCanvas(HERO_BACK_KEY, HERO_SIZE.w, HERO_SIZE.h);
  const img = Object.fromEntries(LAYERS.map((name) => [name, heroLayer(scene, name)]));

  // a copy of a layer with something painted over it, staying inside the layer's own shape
  const repaint = (image, paint) => {
    const copy = scratch(ART.w, ART.h);
    copy.ctx.drawImage(image, 0, 0);
    copy.ctx.globalCompositeOperation = "source-atop";
    paint(copy.ctx);
    return copy.canvas;
  };
  // the far wing sits in the body's shadow
  img.farWing = repaint(img.wing, (c) => { c.fillStyle = "rgba(4,40,22,0.36)"; c.fillRect(0, 0, ART.w, ART.h); });
  // from behind: no face on the head, no pale belly on the body, a ridge of scales down the spine instead
  img.headBack = repaint(img.headBack, (c) => {
    c.fillStyle = SHADE;
    for (let i = 0; i < 3; i++) c.fillRect(154 + i * 2, 118 + i * 11, 9 - i * 2, 6);
  });
  img.torsoBack = repaint(img.torsoBack, (c) => {
    c.fillStyle = SHADE;
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.moveTo(148, 164 + i * 15);
      c.lineTo(164, 164 + i * 15);
      c.lineTo(156, 175 + i * 15);
      c.fill();
    }
  });

  const TM = 26;   // margin round the tail's own canvas
  const tailArt = scratch(ART.w + TM * 2, ART.h + TM * 2);
  const HP = 36, HT = 46;   // margin round the head's own canvas, at the sides and above
  const headArt = scratch(ART.w + HP * 2, HEAD_ROWS + HT);

  // ---- the face -------------------------------------------------------------------------------

  const block = (c, x, y, w, h, corner) => {
    const r = Math.min(corner, w / 2, h / 2);
    c.fillRect(x + r, y, w - r * 2, h);
    c.fillRect(x, y + r, w, h - r * 2);
  };

  function drawEye(c, eye, side, mood, t) {
    const W = eye.w * P.size;
    const blink = t < P.blinkUntil ? 0.08 : 1;
    const H = eye.h * P.size * clamp(P.open, 0.05, 1.3) * blink;
    const x = eye.x + P.lookX * 1.2, y = eye.y + P.lookY;
    c.fillStyle = INK;
    if (mood.arcs && blink === 1) {
      // squeezed shut and smiling: an arch
      for (let i = -W; i <= W; i += 2) c.fillRect(x + i - 1, y + 3 - (1 - (i / W) ** 2) * 8, 3, 4);
    } else if (H < 3) {
      block(c, x - W, y + 2, W * 2, 4, 1);              // shut
      c.fillRect(x - W - 2, y, 3, 3);
      c.fillRect(x + W - 1, y, 3, 3);
    } else {
      block(c, x - W, y - H, W * 2, H * 2, 3);
      const iw = W - 2.5, ih = H - 2.5;
      if (P.white > 0.5) {
        // fright: the whole eye goes white and the pupil shrinks to a dot that shakes
        c.fillStyle = "#ffffff";
        block(c, x - iw, y - ih, iw * 2, ih * 2, 2);
        const jx = Math.sin(t * 0.07 + side) * 1.2 * P.scare, jy = Math.cos(t * 0.09 + side * 2) * 1.2 * P.scare;
        c.fillStyle = INK;
        block(c, x - 2.5 + P.lookX * 2 + jx, y - 3 + P.lookY * 2 + jy, 5, 6, 1);
      } else {
        // a dark pupil above, a brown iris below, and a bright square of light in it
        c.fillStyle = "#12080a";
        block(c, x - iw, y - ih, iw * 2, ih * 2, 2);
        c.fillStyle = "#8c4a1a";
        block(c, x - iw, y + ih * 0.05, iw * 2, ih * 0.95, 2);
        c.fillStyle = "#5d2c0d";
        c.fillRect(x - iw + 1, y + ih * 0.05, iw * 2 - 2, 2);
        c.fillStyle = "#b9682a";
        c.fillRect(x - iw * 0.5 + P.lookX, y + ih * 0.62, iw, 2);
        c.fillStyle = "#ffffff";
        const lw = Math.max(3, iw * 0.9), lh = Math.max(2.5, ih * 0.5);
        c.fillRect(x - iw * 0.55 + P.lookX * 1.6, y - ih * 0.78 + P.lookY, lw, lh);
        c.fillRect(x + iw * 0.3 + P.lookX * 1.6, y + ih * 0.2 + P.lookY, 2, 2);
      }
    }
    // the brow: side is -1 for the eye on our left, whose inner end is its right end
    const by = eye.y - eye.h * P.size * Math.max(0.75, Math.min(1.1, P.open)) - 5 - P.lift;
    const slope = P.tilt * 3.4 * -side;   // worried: the inner end rides up
    c.fillStyle = INK;
    for (let i = -W - 1; i <= W + 1; i += 2) {
      c.fillRect(eye.x + i - 1, by + slope * (i / W) + (1 - (i / W) ** 2) * -1.5, 3, 3.5);
    }
  }

  function drawMouth(c, mood, t, stepBeat) {
    const { x, y } = MOUTH;
    const curve = (half, depth, thick = 3) => {
      for (let i = -half; i <= half; i += 2) c.fillRect(x + i - 1, y + depth * (1 - (i / half) ** 2), 3, thick);
    };
    // an open mouth: flat on top, round below, dark inside with a tongue
    const gape = (half, depth, tongue = true, teeth = false) => {
      c.fillStyle = INK;
      c.beginPath();
      c.moveTo(x - half - 2, y - 2);
      c.lineTo(x + half + 2, y - 2);
      c.quadraticCurveTo(x + half + 2, y + depth + 2, x, y + depth + 2);
      c.quadraticCurveTo(x - half - 2, y + depth + 2, x - half - 2, y - 2);
      c.fill();
      c.fillStyle = "#7c1226";
      c.beginPath();
      c.moveTo(x - half, y);
      c.lineTo(x + half, y);
      c.quadraticCurveTo(x + half, y + depth, x, y + depth);
      c.quadraticCurveTo(x - half, y + depth, x - half, y);
      c.fill();
      if (tongue && depth > 4) {
        c.fillStyle = "#f2869a";
        c.beginPath();
        c.ellipse(x, y + depth - 1, half * 0.55, depth * 0.36, 0, Math.PI, 0);
        c.fill();
      }
      if (teeth) {
        c.fillStyle = "#ffffff";
        c.fillRect(x - half + 2, y, 3, 3);
        c.fillRect(x + half - 5, y, 3, 3);
      }
    };
    c.fillStyle = INK;
    switch (mood.mouth) {
      case "open":   gape(9, 3.5 + 3 * Math.abs(stepBeat)); break;
      case "grin":   gape(12, 7.5 + Math.sin(t * 0.012)); break;
      case "yell":   gape(11, 8.5, true, true); break;
      case "oh":
        c.beginPath(); c.ellipse(x, y + 2, 5, 5.5, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#7c1226";
        c.beginPath(); c.ellipse(x, y + 2, 3, 3.5, 0, 0, Math.PI * 2); c.fill();
        break;
      case "scream": {
        // a wide mouth with a wobbling lip
        const half = 11 + Math.sin(t * 0.045), depth = 7.5 + Math.sin(t * 0.06) * 1.2;
        gape(half, depth, true, true);
        c.fillStyle = INK;
        for (let i = -half; i <= half; i += 2) c.fillRect(x + i - 1, y - 3 + Math.sin(i * 0.9 + t * 0.05) * 1.4, 3, 3);
        break;
      }
      case "smirk":
        for (let i = -13; i <= 13; i += 2) c.fillRect(x + i - 1, y + 1 - i * 0.16 + (1 - (i / 13) ** 2) * 1.5, 3, 3);
        c.fillStyle = "#ffffff";
        c.fillRect(x + 6, y + 1, 3, 4);                    // one small fang
        break;
      case "wobble":
        for (let i = -11; i <= 11; i += 2) c.fillRect(x + i - 1, y + 1 + Math.sin(i * 0.75 + t * 0.02) * 2, 3, 3);
        break;
      case "frown":  curve(12, -4); break;
      default:       curve(15, 4.5);                      // the smile it was drawn with
    }
  }

  // ---- the hat and head, on their own canvas so the hat can bend without the head ------------

  function drawHead(t, mood, back, stepBeat) {
    const c = headArt.ctx;
    c.clearRect(0, 0, headArt.canvas.width, headArt.canvas.height);
    // The hat, in thin strips. Each strip is pushed further over the higher it is, so the hat
    // leans as one piece and the spire above the brim whips further still, with a ripple along it.
    const lift = Math.max(-3, P.hatLift.x);
    const tall = 1 + clamp(P.hatLift.v * 1.6, -0.12, 0.2);     // it stretches as it flies up and flattens as it drops
    for (let row = 0; row < HAT_ROWS; row += 2) {
      const up = Math.max(0, (HAT_BASE - row) / HAT_BASE);
      const high = Math.max(0, (SPIRE_ROWS - row) / SPIRE_ROWS) ** 1.5;
      const shift = P.hatTilt.x * up + P.spire.x * high + Math.sin(t * 0.0062 + row * 0.085) * (1.5 + 2.5 * P.walk + 3 * P.scare) * high;
      const y = HAT_BASE - (HAT_BASE - row) * tall - lift;
      c.drawImage(img.hat, 0, row, ART.w, 2, HP + shift, HT + y, ART.w, 2 * tall + 0.6);
    }
    c.drawImage(back ? img.headBack : img.head, HP, HT);
    if (back) return;
    c.save();
    c.translate(HP, HT);
    drawEye(c, EYE_L, -1, mood, t);
    drawEye(c, EYE_R, 1, mood, t);
    drawMouth(c, mood, t, stepBeat);
    // a blush when it is pleased with itself
    if (mood.arcs) {
      c.fillStyle = "rgba(255,120,130,0.5)";
      c.fillRect(124, 138, 12, 6);
      c.fillRect(190, 137, 8, 6);
    }
    c.restore();
  }

  // The tail, in thin upright strips. A wave runs from its root to its tip, growing as it goes.
  function drawTail(t) {
    const c = tailArt.ctx;
    c.clearRect(0, 0, tailArt.canvas.width, tailArt.canvas.height);
    const rows = TAIL_ROWS[1] - TAIL_ROWS[0];
    const reach = 6 + 2.5 * P.wag + 5 * P.walk + 3 * P.flap;
    const raise = -16 * P.scare - 5 * P.walk - 7 * P.flap;            // up in a fright, streaming when it moves
    for (let x = 0; x < TAIL.x + 14; x += 2) {
      const s = clamp((TAIL.x - x) / TAIL.x, 0, 1);
      const dy = raise * s * s + Math.sin(P.tailPhase - s * 3.3) * reach * s ** 1.25 + Math.sin(t * 0.07 + s * 9) * 1.6 * P.scare * s;
      const dx = Math.cos(P.tailPhase - s * 3.3) * 1.5 * s;
      c.drawImage(img.tail, x, TAIL_ROWS[0], 2, rows, TM + x + dx, TM + TAIL_ROWS[0] + dy, 2.5, rows);
    }
  }

  // ---- one frame ------------------------------------------------------------------------------

  function update(t, dt) {
    clock = t;
    P.walk = ease(P.walk, walking ? 1 : 0, 0.008, dt);

    // which mood: one a scene asked for, else its own
    const flying = t < flyUntil;
    let name = briefMood && t < briefUntil ? briefMood : heldMood;
    if (!name) {
      if (flying || P.air > 2) name = "happy";
      else if (walking) name = "walk";
      else name = act === "happy" || act === "wag" ? "happy" : "calm";
      // by itself: a hop now and then as it walks, and small things to do while it waits
      if (walking && t > nextHopAt) { heroFlutter(700 + Math.random() * 500, 30 + Math.random() * 14); nextHopAt = t + 2400 + Math.random() * 2600; }
      if (!walking && t > nextActAt) {
        act = ["lookL", "lookR", "happy", "wag", "stretch", "lookL", "lookR"][Math.floor(Math.random() * 7)];
        actUntil = t + 900 + Math.random() * 900;
        nextActAt = actUntil + 1100 + Math.random() * 2200;
        if (act === "happy" || act === "stretch" || Math.random() < 0.35) heroFlutter(600 + Math.random() * 400, 24 + Math.random() * 12);
      }
    }
    if (t > actUntil || walking || heldMood) act = null;
    const mood = MOODS[name] || MOODS.calm;

    // flying: it rises toward its height and hangs there bobbing, then falls and lands with a squash
    if (flying) {
      P.air = ease(P.air, flyHeight + Math.sin(t * 0.016) * 3, 0.011, dt);
      P.fall = 0;
    } else if (P.air > 0) {
      P.fall += 0.0012 * dt;
      P.air -= P.fall * dt;
      if (P.air <= 0) {
        P.squash.v += 0.0022 + P.fall * 0.004;
        P.hatLift.v -= 0.05;
        P.landedAt = t;
        P.air = 0;
        P.fall = 0;
      }
    }
    const aloft = flying || P.air > 1;

    const stretching = act === "stretch";
    P.flap = ease(P.flap, aloft ? 1 : Math.max(mood.flap, stretching ? 0.55 : 0), 0.012, dt);
    P.wingPhase += dt * (0.0034 + 0.026 * P.flap * P.flap + (aloft ? 0.012 : 0));
    P.wag = ease(P.wag, mood.wag, 0.006, dt);
    P.tailPhase += dt * (0.0042 + 0.0105 * P.wag + 0.004 * P.walk);
    P.scare = ease(P.scare, name === "scared" ? 1 : name === "shock" ? 0.45 : 0, 0.012, dt);

    P.open = ease(P.open, mood.open, 0.02, dt);
    P.size = ease(P.size, mood.size, 0.02, dt);
    P.white = ease(P.white, mood.white, 0.03, dt);
    P.tilt = ease(P.tilt, mood.tilt, 0.018, dt);
    P.lift = ease(P.lift, mood.lift, 0.018, dt);
    P.arms = ease(P.arms, mood.arms, 0.014, dt);
    const lookX = act === "lookL" ? -2.2 : act === "lookR" ? 2 : name === "sad" ? -0.5 : P.walk * 0.8;
    P.lookX = ease(P.lookX, lookX, 0.012, dt);
    P.lookY = ease(P.lookY, name === "sad" ? 2 : aloft && name === "scared" ? 1.5 : 0, 0.012, dt);
    if (t >= P.blinkAt) {
      P.blinkUntil = t + 110;
      P.blinkAt = t + (Math.random() < 0.22 ? 260 : 1500 + Math.random() * 3200);
    }

    // each footfall jolts the hat and squashes the body a touch
    const step = Math.sin(t * STEP_RATE);
    if (P.walk > 0.5 && !aloft && Math.sign(step) !== P.wasStep) {
      P.hatLift.v += 0.03;
      P.squash.v += 0.0007;
    }
    P.wasStep = Math.sign(step);

    // springs: the hat is always a beat behind the head, the body rings when it lands
    const lean = -5 * P.walk + (act === "lookL" ? 3 : act === "lookR" ? -3 : 0) - 6 * P.scare;
    spring(P.squash, 0, 0.0005, 0.016, dt);
    spring(P.hatLift, 0, 0.00042, 0.011, dt);
    spring(P.hatTilt, lean, 0.00026, 0.009, dt);
    spring(P.spire, lean * 2 + (aloft ? -6 : 0), 0.00016, 0.006, dt);
    const tiltTo = (act === "lookL" ? -0.07 : act === "lookR" ? 0.07 : 0) + (name === "sad" ? 0.09 : 0) - 0.1 * P.scare
      + (name === "happy" || name === "cheer" ? 0.07 * Math.sin(t * 0.009) : 0);
    spring(P.headTilt, tiltTo, 0.0003, 0.02, dt);
    P.squash.x = clamp(P.squash.x, -0.16, 0.2);
    return { mood, step, aloft };
  }

  function paint(texture, t, { mood, step, aloft }, back) {
    const ctx = texture.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, HERO_SIZE.w, HERO_SIZE.h);
    ctx.imageSmoothingEnabled = false;
    // seen from behind it is the same dragon flipped, so its tail is on the other side
    if (back) { ctx.translate(HERO_SIZE.w, 0); ctx.scale(-1, 1); }
    ctx.translate(PAD, TOP);

    const walk = P.walk;
    const sway = Math.sin(t * 0.0019);
    const breath = Math.sin(t * 0.0031);
    const beat = Math.sin(P.wingPhase);
    const tremble = Math.sin(t * 0.08) * P.scare;

    // dust kicked up where it lands
    const dust = (t - P.landedAt) / 420;
    if (dust >= 0 && dust < 1) {
      ctx.fillStyle = "#e6f2d2";
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1;
        ctx.globalAlpha = 0.6 * (1 - dust);
        const size = 5 + dust * 7 + (i % 3);
        ctx.fillRect(FEET.x + side * (18 + i * 6 + dust * 34) - size / 2, FEET.y - 4 - dust * (6 + i * 2) - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    }

    // off the ground, and squashed or stretched about its feet
    ctx.translate(0, -P.air);
    ctx.translate(FEET.x, FEET.y);
    ctx.scale(1 + P.squash.x * 0.75, 1 - P.squash.x);
    ctx.translate(-FEET.x, -FEET.y);

    const bodyY = -Math.abs(step) * 2.2 * walk + 0.8 * breath + 3.2 * P.flap * beat * (aloft ? 1 : 0.25) + tremble * 0.8;
    const lean = walk * (0.03 + step * 0.03) + 0.012 * sway - 0.05 * P.scare + (aloft ? 0.05 : 0);
    const body = () => {
      ctx.translate(HIPS.x, HIPS.y + bodyY);
      ctx.rotate(lean);
      ctx.scale(1, 1 + 0.016 * breath);
      ctx.translate(-HIPS.x, -HIPS.y);
    };
    const hinge = (image, at, angle, sx = 1, sy = 1) => {
      ctx.save();
      ctx.translate(at.x, at.y);
      ctx.rotate(angle);
      ctx.scale(sx, sy);
      ctx.drawImage(image, -at.x, -at.y);
      ctx.restore();
    };

    // The wings. Folded, the near one hangs and flicks and the far one is tucked out of sight.
    // The harder they beat the wider both open; in the air they row up and down together.
    const wingAngle = -0.1 + 0.34 * P.flap + (0.07 + 0.78 * P.flap) * beat + 0.05 * Math.sin(t * 0.0027) + 0.14 * walk * Math.sin(t * STEP_RATE * 0.5);
    const wingWide = 1 + 0.16 * P.flap - 0.1 * P.flap * Math.max(0, beat);
    const wings = () => {
      ctx.save();
      ctx.translate(WING_MIRROR * 2, 0);
      ctx.scale(-1, 1);
      hinge(img.farWing, WING, wingAngle * 0.9 - 0.1, clamp((P.flap - 0.12) * 1.5, 0, 1.05) * wingWide, 1);   // tucked away until the wings open
      ctx.restore();
      hinge(img.wing, WING, wingAngle, wingWide, 1);
    };
    const backWings = () => {
      // from behind both wings are in plain view, spread from the middle of its back
      for (const flip of [false, true]) {
        ctx.save();
        if (flip) { ctx.translate(310, 0); ctx.scale(-1, 1); }
        ctx.translate(26, 4);
        hinge(img.wing, WING, wingAngle + 0.12, wingWide * 0.95, 1);
        ctx.restore();
      }
    };
    drawTail(t);
    const tailSwing = 0.05 * Math.sin(P.tailPhase + 0.9) * (0.5 + P.wag) - 0.1 * P.scare - 0.05 * walk + (aloft ? -0.14 : 0);
    const tail = () => {
      ctx.save();
      ctx.translate(TAIL.x, TAIL.y);
      ctx.rotate(tailSwing);
      ctx.drawImage(tailArt.canvas, -TAIL.x - TM, -TAIL.y - TM);
      ctx.restore();
    };

    if (!back) {
      ctx.save();
      body();
      tail();
      wings();
      ctx.restore();
    }

    // the legs step in turn; in the air they dangle and paddle
    const stride = 9 * walk * (aloft ? 0 : 1);
    const paddle = aloft ? 1 : 0;
    ctx.save();
    ctx.translate(step * 2.5 * walk, -Math.max(0, step) * stride + paddle * 2);
    hinge(img.legL, HIP_L, step * 0.07 * walk + paddle * (0.16 + 0.2 * Math.sin(t * 0.021)));
    ctx.restore();
    ctx.save();
    ctx.translate(-step * 2.5 * walk, -Math.max(0, -step) * stride + paddle * 2);
    hinge(img.legR, HIP_R, -step * 0.07 * walk - paddle * (0.12 + 0.2 * Math.sin(t * 0.021 + 1.7)));
    ctx.restore();

    ctx.save();
    body();
    ctx.drawImage(back ? img.torsoBack : img.torso, 0, 0);

    // the arms swing against the legs; in a fright or a cheer they fly up and wave
    const swing = walk * step * 0.24;
    const wave = Math.sin(t * 0.024) * 0.2 * P.arms;
    hinge(img.armL, SHOULDER_L, swing + 0.04 * Math.sin(t * 0.0023) + P.arms * 0.95 + wave);
    hinge(img.armR, SHOULDER_R, -swing + 0.04 * Math.sin(t * 0.0023 + 2) - P.arms * 0.95 - wave);
    if (back) { tail(); backWings(); }

    // the head: a beat behind the body, so it nods as it walks and drifts as it stands
    drawHead(t, mood, back, step);
    const nod = P.headTilt.x + 0.035 * sway + walk * 0.05 * Math.sin(t * STEP_RATE - 1.0) + tremble * 0.02;
    const bob = 1.4 * Math.sin(t * 0.0031 + 1) - walk * 2.6 * Math.abs(Math.sin(t * STEP_RATE - 0.6)) - 3 * P.scare;
    ctx.translate(NECK.x, NECK.y + bob);
    ctx.rotate(nod);
    ctx.drawImage(headArt.canvas, -NECK.x - HP, -NECK.y - HT);
    ctx.restore();

    // drops of sweat fly off it when it is frightened
    if (P.scare > 0.3 && !back) {
      ctx.fillStyle = "#bfeaff";
      for (let i = 0; i < 5; i++) {
        const life = (t * 0.0021 + i * 0.23) % 1;
        const side = i % 2 ? 1 : -1;
        const x = 160 + side * (52 + life * 26 + i * 3), y = 96 - Math.sin(life * Math.PI) * 20 + life * 16 + i * 5;
        ctx.globalAlpha = (1 - life) * P.scare;
        ctx.fillRect(x - 2, y - 3, 4, 6);
        ctx.fillRect(x - 1, y - 5, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    texture.refresh();
  }

  function frame(t, dt) {
    const now = update(t, Math.min(34, Math.max(0, dt)));
    paint(front, t, now, false);
    if (backShown) paint(rear, t, now, true);
  }

  const first = update(scene.game.loop.time || 0, 16);
  paint(front, clock, first, false);
  paint(rear, clock, first, true);
  if (!started) {
    started = true;
    scene.game.events.on("step", frame);
  }
}
