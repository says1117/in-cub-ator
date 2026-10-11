// client/src/render/plantRig.js: A plant drawn from moving pieces. Owner: Role 3 (client, art, demo).
// Its arms and loose leaves each sway at their own speed, its leaves bend like grass in wind, it
// breathes, blinks and changes expression. Everything loose also swings on a spring, so whenever
// the plant moves (a hop, a lunge, a knock back) its arms and leaves trail behind and settle after.
//
// It returns a Phaser container. x, y is the spot the pot stands on. Move, fade or destroy it like
// a picture. It animates itself and stops when it is destroyed.
//
//   plant.setHeight(pixels)        how tall it is drawn (use this, not setScale)
//   plant.setMood("fierce")        how it stands and looks until told otherwise: see MOODS
//   plant.play("strike", { ... })  a one-off action on top of that: see ACTIONS. Returns its length in ms.
//   plant.emote("alert")           a little mark above its head: see EMOTES
//   plant.point("fist")            where a spot is on screen right now, for effects (see `points` in data/plantRigs.js)
//   plant.pose.lift = 0.1          the same dials the actions use, for a scene to drive by hand
//   plant.flashWhite(90)           turns it solid white for a moment, for a hit (see flashWhite below)
//
// TIME: it runs on its own clock, which moves by delta x scene.time.timeScale each frame. Set the
// scene's time.timeScale to 0 (a hit-stop) and the plant freezes mid-move with everything else.
//
// ADDING A MOVE LATER
// 1. An action is a small function: given how far through it is (k, from 0 to 1) it turns the pose
//    dials listed under POSE below. Add it with definePlantAction("spin", { ms: 600, run(k, pose) { ... } }).
// 2. An arm pose is a named set of angles in data/plants.js (`gestures`). An action turns it on with
//    pose.gesture.punch = 1, so each plant can punch or shield in its own way.
// 3. Name the action in data/plants.js under `moves` or `skills`, next to the effect it goes with.
import Phaser from "phaser";
import { plantPartKey } from "../data/plants.js";
import { createCastShadow, outlineOfParts } from "./castShadow.js";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smooth = (v) => { const c = clamp01(v); return c * c * (3 - 2 * c); };
const backOut = (v) => { const c = clamp01(v) - 1; return 1 + 2.7 * c * c * c + 1.7 * c * c; };
const arc = (v) => Math.sin(Math.PI * clamp01(v));          // 0, up to 1, back to 0
const mix = (a, b, k) => a + (b - a) * clamp01(k);

// POSE: the dials. They all start at zero every frame and every running action adds to them.
// Distances are a share of the plant's height, so an action looks the same at any size.
const newPose = () => ({
  lift: 0,       // off the ground
  x: 0,          // sideways, positive is forward (toward the boss)
  stretch: 0,    // above 0 taller and thinner, below 0 squashed
  lean: 0,       // the whole plant tips, in radians, positive is forward
  bend: 0,       // the leaves bend sideways above the pot
  open: 0,       // arms: above 0 thrown up and out, below 0 folded down
  shake: 0,      // trembles on the spot
  scale: 0,      // -1 is shrunk to nothing, 0 is its own size
  face: null,    // an expression for this moment: see drawFace
  gesture: {},   // named arm poses from data/plants.js, 0 to 1
  turn: {},      // extra turn for single pieces by name, in radians
});

const MOOD_DIALS = ["open", "lean", "sway", "stretch", "tremble", "tip"];
const POSE_DIALS = ["lift", "x", "stretch", "lean", "bend", "open", "shake", "scale"];

// Starts a pose over for a new frame without making a new object: the dials go back to the
// scene's own nudges (`manual`), and the named arm poses and piece turns back to zero.
function resetPose(pose, manual) {
  for (let i = 0; i < POSE_DIALS.length; i++) pose[POSE_DIALS[i]] = manual[POSE_DIALS[i]];
  for (const name in pose.gesture) pose.gesture[name] = 0;
  for (const name in pose.turn) pose.turn[name] = 0;
  Object.assign(pose.gesture, manual.gesture);
  Object.assign(pose.turn, manual.turn);
  pose.face = manual.face;
  return pose;
}

// The real time now, in ms. A flash runs on it so it shows even while the scene's clock is stopped.
const realNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// MOODS: how it stands and looks between actions. Changes are eased, never snapped.
// sway: how lively the idle is. tip: 1 is fallen over on its side.
export const MOODS = {
  happy: { face: "open", open: 0, lean: 0, sway: 1, stretch: 0, tremble: 0, tip: 0 },
  thirsty: { face: "sad", open: -0.32, lean: -0.03, sway: 0.55, stretch: -0.05, tremble: 0, tip: 0 },
  alarmed: { face: "shock", open: 0.5, lean: -0.08, sway: 1.5, stretch: 0.02, tremble: 1, tip: 0 },
  fierce: { face: "angry", open: 0.22, lean: 0.07, sway: 1.35, stretch: 0.01, tremble: 0, tip: 0 },
  proud: { face: "happy", open: 0.55, lean: 0, sway: 1.2, stretch: 0.02, tremble: 0, tip: 0 },
  fainted: { face: "fainted", open: -0.55, lean: 0, sway: 0.12, stretch: 0, tremble: 0, tip: 1 },
};

// ACTIONS: one-off moves. run(k, pose, options) is called every frame with k going from 0 to 1.
export const ACTIONS = {
  // A hop on the spot. options.height: how high, as a share of its own height.
  hop: {
    ms: 460,
    run(k, pose, o) {
      const height = o.height ?? 0.2;
      if (k < 0.18) {
        pose.stretch -= 0.16 * smooth(k / 0.18);                 // crouch
      } else if (k < 0.84) {
        const a = (k - 0.18) / 0.66;
        pose.lift += height * 4 * a * (1 - a);                   // up and down again
        pose.stretch += a < 0.25 ? mix(-0.16, 0.14, smooth(a / 0.25)) : mix(0.14, 0.04, (a - 0.25) / 0.75);
        pose.open += 0.3 * arc(a);
      } else {
        const b = (k - 0.84) / 0.16;                             // land and settle
        pose.stretch += b < 0.35 ? mix(0.04, -0.18, b / 0.35) : -0.18 * (1 - smooth((b - 0.35) / 0.65));
      }
    },
  },
  // Jumps out of its skin: straight up, arms thrown wide, eyes like saucers.
  startle: {
    ms: 640,
    run(k, pose) {
      pose.face = "shock";
      pose.lift += 0.3 * 4 * clamp01(k / 0.7) * (1 - clamp01(k / 0.7));
      pose.open += 1.05 * arc(Math.min(1, k * 1.25));
      pose.stretch += k < 0.7 ? 0.14 * arc(k / 0.7) : -0.16 * arc((k - 0.7) / 0.3);
      pose.shake += k > 0.7 ? 1.5 * (1 - (k - 0.7) / 0.3) : 0;
      pose.lean -= 0.12 * arc(k);
    },
  },
  // Two happy bounces with its arms in the air.
  cheer: {
    ms: 900,
    run(k, pose) {
      const hop = (k * 2) % 1;
      pose.face = "happy";
      pose.lift += 0.16 * 4 * hop * (1 - hop);
      pose.open += 0.85 * arc(Math.min(1, k * 1.4)) + 0.2 * arc(hop);
      pose.stretch += 0.08 * arc(hop) - 0.1 * (hop > 0.85 ? (hop - 0.85) / 0.15 : 0);
      pose.lean += 0.07 * Math.sin(k * Math.PI * 4);
    },
  },
  // Winds back, throws itself at the enemy fist first, bounces home.
  // options.reach: how far it travels, as a share of its own height.
  strike: {
    ms: 640,
    hitAt: 0.42,          // the share of the action where the blow lands, for effects to wait on
    run(k, pose, o) {
      const reach = o.reach ?? 0.7;
      pose.face = "angry";
      if (k < 0.26) {
        const a = smooth(k / 0.26);                              // wind up
        pose.x -= 0.1 * a; pose.lean -= 0.2 * a; pose.stretch -= 0.1 * a; pose.open -= 0.25 * a;
        pose.gesture.punch = -0.35 * a;
      } else if (k < 0.42) {
        const a = backOut((k - 0.26) / 0.16);                    // launch
        pose.x += mix(-0.1, reach, a); pose.lean += mix(-0.2, 0.32, a); pose.stretch += mix(-0.1, 0.1, a);
        pose.lift += 0.1 * arc((k - 0.26) / 0.16);
        pose.gesture.punch = mix(-0.35, 1, a);
      } else if (k < 0.56) {
        pose.x += reach; pose.lean += 0.32; pose.stretch += 0.1 - 0.16 * arc((k - 0.42) / 0.14);   // the hit
        pose.gesture.punch = 1;
      } else {
        const a = smooth((k - 0.56) / 0.44);                     // hop back home
        pose.x += reach * (1 - a); pose.lean += 0.32 * (1 - a); pose.lift += 0.12 * arc(a);
        pose.gesture.punch = 1 - a;
      }
    },
  },
  // Tucks in behind its own arms and holds.
  guard: {
    ms: 760,
    hitAt: 0.3,
    run(k, pose) {
      const hold = k < 0.22 ? backOut(k / 0.22) : 1 - smooth((k - 0.72) / 0.28);
      pose.face = "angry";
      pose.gesture.shield = hold;
      pose.stretch -= 0.12 * hold;
      pose.lean -= 0.08 * hold;
      pose.x -= 0.03 * hold;
    },
  },
  // Gathers itself, floats a little with its arms up, then lets go.
  cast: {
    ms: 820,
    hitAt: 0.55,
    run(k, pose) {
      const gather = k < 0.5 ? smooth(k / 0.5) : 1 - smooth((k - 0.62) / 0.38);
      pose.face = "angry";
      pose.lift += 0.07 * gather;
      pose.open += 1.0 * gather;
      pose.stretch += 0.08 * gather - (k > 0.5 && k < 0.66 ? 0.14 * arc((k - 0.5) / 0.16) : 0);
      pose.bend += 0.07 * Math.sin(k * Math.PI * 7) * gather;
      pose.lean += k > 0.5 ? 0.16 * arc((k - 0.5) / 0.5) : -0.06 * gather;
    },
  },
  // Gathers power for a big skill: rises off the ground trembling, arms spread, then slams it out.
  channel: {
    ms: 1500,
    hitAt: 0.55,
    run(k, pose) {
      pose.face = "angry";
      if (k < 0.55) {
        const a = smooth(k / 0.4);                               // rise and gather
        pose.lift += 0.16 * a + 0.012 * Math.sin(k * 60);
        pose.open += 1.15 * a;
        pose.stretch += 0.1 * a;
        pose.lean -= 0.1 * a;
        pose.shake += 1.2 * clamp01((k - 0.2) / 0.35);
        pose.bend += 0.05 * Math.sin(k * 40) * a;
      } else {
        const b = (k - 0.55) / 0.45;                             // let go: drop, squash, lean into it
        const drop = backOut(Math.min(1, b / 0.25));
        pose.lift += 0.16 * (1 - drop);
        pose.open += b < 0.5 ? mix(1.15, -0.4, backOut(b / 0.3)) : mix(-0.4, 0, smooth((b - 0.5) / 0.5));
        pose.stretch += b < 0.3 ? mix(0.1, -0.2, b / 0.3) : -0.2 * (1 - smooth((b - 0.3) / 0.7));
        pose.lean += b < 0.5 ? mix(-0.1, 0.3, backOut(b / 0.25)) : 0.3 * (1 - smooth((b - 0.5) / 0.5));
        pose.x += 0.05 * arc(b);
      }
    },
  },
  // Darts in and cuts three times before the eye can follow, then springs back.
  // options.reach: how far it travels, as a share of its own height.
  rush: {
    ms: 960,
    hitAt: 0.34,
    run(k, pose, o) {
      const reach = o.reach ?? 0.7;
      pose.face = "angry";
      if (k < 0.16) {
        const a = smooth(k / 0.16);                              // coil
        pose.x -= 0.09 * a; pose.lean -= 0.24 * a; pose.stretch -= 0.14 * a; pose.open -= 0.3 * a;
      } else if (k < 0.34) {
        const a = backOut((k - 0.16) / 0.18);                    // dart in, stretched thin
        pose.x += mix(-0.09, reach, a); pose.lean += mix(-0.24, 0.42, a); pose.stretch += mix(-0.14, 0.16, a);
        pose.gesture.punch = a;
      } else if (k < 0.66) {
        const c = (k - 0.34) / 0.32;                             // three cuts: it whips side to side
        const swing = Math.cos(c * Math.PI * 3);
        pose.x += reach + 0.04 * Math.sin(c * Math.PI * 3);
        pose.lean += 0.3 * swing;
        pose.bend += 0.12 * swing;
        pose.lift += 0.05 * Math.abs(Math.sin(c * Math.PI * 3));
        pose.gesture.punch = 0.4 + 0.6 * Math.abs(swing);
        pose.turn.fist = 0.5 * swing;
        pose.turn.handT = -0.4 * swing;
      } else {
        const a = smooth((k - 0.66) / 0.34);                     // spring back home in one bound
        pose.x += reach * (1 - a); pose.lift += 0.2 * arc(a); pose.lean -= 0.2 * arc(a);
        pose.stretch += 0.08 * arc(a) - (a > 0.85 ? 0.12 * arc((a - 0.85) / 0.15) : 0);
        pose.gesture.punch = 0.4 * (1 - a);
      }
    },
  },
  // Takes a hit: thrown back, flinches, shakes it off.
  hurt: {
    ms: 520,
    run(k, pose, o) {
      const force = o.force ?? 1;
      const away = k < 0.25 ? backOut(k / 0.25) : 1 - smooth((k - 0.25) / 0.75);
      pose.face = "hurt";
      pose.x -= 0.13 * away * force;
      pose.lean -= 0.26 * away * force;
      pose.stretch -= 0.1 * arc(k * 2);
      pose.shake += 2 * (1 - k);
      pose.open += 0.5 * away;
    },
  },
  // Pops out of nothing with a little jump. Use it when a plant arrives.
  enter: {
    ms: 560,
    run(k, pose) {
      pose.scale += backOut(k / 0.6) - 1;
      pose.lift += 0.22 * arc(k);
      pose.open += 0.7 * arc(k);
      pose.stretch += 0.12 * arc(k * 1.2) - 0.12 * (k > 0.85 ? arc((k - 0.85) / 0.15) : 0);
    },
  },
  // Shrinks away to nothing. The plant stays shrunk until something else is played.
  leave: {
    ms: 280,
    hold: true,
    run(k, pose) {
      pose.scale -= smooth(k);
      pose.lift += 0.1 * arc(k);
    },
  },
};

export function definePlantAction(name, action) {
  ACTIONS[name] = action;
}

// EMOTES: little marks above the head, drawn as chunky pixels. One letter is one pixel.
const EMOTE_COLORS = { K: 0x1a1208, Y: 0xffd93b, W: 0xffffff, B: 0x58c6ff, D: 0x2f86d6, R: 0xff4d5e, P: 0xff9db0, O: 0xff9a2e };
export const EMOTES = {
  alert: [".KKK.", "KYYYK", "KYYYK", "KYYYK", ".KYK.", ".KYK.", "..K..", ".KYK.", ".KKK."],
  sweat: ["..K....", ".KBK...", ".KBK.K.", "KBWBKBK", "KBBBKBK", ".KKK.K."],
  anger: ["KK...KK", "KRK.KRK", ".KRKRK.", "...K...", ".KRKRK.", "KRK.KRK", "KK...KK"],
  sparkle: ["...K...", "..KYK..", ".KKYKK.", "KYYWYYK", ".KKYKK.", "..KYK..", "...K..."],
  heart: [".KK.KK.", "KRRKRRK", "KRPRRRK", "KRRRRRK", ".KRRRK.", "..KRK..", "...K..."],
  cheer: ["K..K..K", "KY.Y.YK", ".KYKYK.", "..K.K..", "KKO.OKK", "KYK.KYK", ".K...K."],
};

export function hasPlantRig(scene, plant, size = "m") {
  return Object.keys(plant.rig.parts).every((part) => scene.textures.exists(plantPartKey(plant, part, size)));
}

// height: how tall the whole plant is drawn, pot to highest fingertip.
// options.size: which picture set, "s" for small on screen (the forest) or "m" (the battle screen).
// options.shadow: draw its own shadow on the ground (default true).
// options.light: where the light is, for the shadow it throws (see render/castShadow.js).
export function createPlantRig(scene, plant, x, y, height, options = {}) {
  const rig = plant.rig;
  const size = options.size || "m";
  const enlarge = rig.sizes[size];         // this picture set's pixels to rig units
  const H = rig.height;

  const root = scene.add.container(x, y);
  const shadow = scene.add.ellipse(0, 0, H * 0.56, H * 0.085, 0x120a1c, 0.45).setVisible(options.shadow !== false);
  const body = scene.add.container(0, 0);
  const emoteLayer = scene.add.container(0, -H * 1.04).setVisible(false);
  const emoteArt = scene.add.graphics();
  emoteLayer.add(emoteArt);
  // the shadow it throws: its own outline (every piece, at rest), laid on the ground
  const outline = outlineOfParts(scene, `${plant.key}-outline-${size}`, ["base", ...rig.order].map((name) => {
    const art = rig.parts[name][size];
    return {
      textureKey: plantPartKey(plant, name, size),
      x: rig.parts[name].x / rig.sizes[size] - art.ox * art.w,
      y: rig.parts[name].y / rig.sizes[size] - art.oy * art.h,
    };
  }));
  const cast = createCastShadow(scene, outline, { light: options.light, size: enlarge }).setVisible(options.shadow !== false);
  root.add([shadow, cast, body, emoteLayer]);

  // ---- the body: the pot stays put, everything above its rim is cut into thin strips that slide sideways ----
  const baseKey = plantPartKey(plant, "base", size);
  const baseSpec = rig.parts.base[size];
  const baseTexture = scene.textures.get(baseKey);
  const left = -baseSpec.ox * baseSpec.w * enlarge;
  const top = -baseSpec.oy * baseSpec.h * enlarge;
  const crown = rig.rim - top;                                   // how tall the leaves stand above the pot
  const rimRow = clamp(Math.round(crown / enlarge), 1, baseSpec.h - 1);
  const stripRows = size === "s" ? 2 : 3;
  const overlap = 2;                                             // strips overlap so no gap can open between them

  // How far something at height `at` slides when the leaves bend: nothing at the rim, most at the top.
  let bend = 0;
  const slide = (at) => bend * crown * Math.pow(clamp01((rig.rim - at) / crown), 1.6);

  const frame = (name, row, rows) => {
    if (!baseTexture.has(name)) baseTexture.add(name, 0, 0, row, baseSpec.w, rows);
    return name;
  };
  const strips = [];
  for (let row = 0; row < rimRow; row += stripRows) {
    const rows = Math.min(stripRows + overlap, baseSpec.h - row);
    const image = scene.add.image(left, top + row * enlarge, baseKey, frame(`strip-${stripRows}-${row}`, row, rows));
    image.setOrigin(0, 0).setScale(enlarge);
    const at = top + (row + stripRows / 2) * enlarge;
    strips.push({ image, at, reach: crown * Math.pow(clamp01((rig.rim - at) / crown), 1.6) });
    body.add(image);
  }
  const pot = scene.add.image(left, top + rimRow * enlarge, baseKey, frame(`pot-${rimRow}`, rimRow, baseSpec.h - rimRow));
  pot.setOrigin(0, 0).setScale(enlarge);
  body.add(pot);

  // ---- the loose pieces: each turns on its own joint, and a piece can grow from another piece ----
  const pieces = {};
  for (const name of rig.order) {
    const spec = rig.parts[name];
    const art = spec[size];
    const node = scene.add.container(spec.x, spec.y);
    const image = scene.add.image(0, 0, plantPartKey(plant, name, size)).setOrigin(art.ox, art.oy).setScale(enlarge);
    node.add(image);
    // which way the piece points from its joint, to know which way is "up" and how it trails behind
    const dx = (0.5 - art.ox) * art.w;
    const dy = (0.5 - art.oy) * art.h;
    const length = Math.hypot(dx, dy) || 1;
    pieces[name] = {
      name, spec, node,
      dx: dx / length, dy: dy / length,
      raise: dx < 0 ? 1 : -1,                 // the turn that lifts it
      lag: 0, speed: 0,                       // its spring
      // its own idle sway: a slow swing with a quicker one on top, never in step with the others
      a1: Phaser.Math.FloatBetween(0.05, 0.085), f1: Phaser.Math.FloatBetween(1.0, 1.7), p1: Phaser.Math.FloatBetween(0, 6.28),
      a2: Phaser.Math.FloatBetween(0.015, 0.035), f2: Phaser.Math.FloatBetween(2.3, 3.6), p2: Phaser.Math.FloatBetween(0, 6.28),
    };
  }
  const pieceList = Object.values(pieces);
  for (const piece of pieceList) {
    const parent = pieces[piece.spec.parent];
    if (parent) {
      piece.node.setPosition(piece.spec.x - parent.spec.x, piece.spec.y - parent.spec.y);
      parent.node.add(piece.node);
    } else {
      body.add(piece.node);
    }
  }

  // ---- the face: lids and expressions drawn over the eyes of the picture ----
  const face = scene.add.graphics();
  body.add(face);
  const DARK = 0x1a1208;
  let faceMode = null;          // what the face shows now: an expression, or "blink"
  let faceStep = NaN;           // and how far the leaves had bent it sideways, in half pixels
  // How far the eyes slide for a bend of 1, at the eye that moves the most.
  const eyeReach = Math.max(...rig.eyes.map(([, ey]) => Math.abs(crown * Math.pow(clamp01((rig.rim - ey) / crown), 1.6))));
  // How many screen pixels one rig unit is drawn as right now (its own scale and every container it sits in).
  const screenScale = () => {
    let k = Math.abs(root.scaleX * body.scaleX);
    for (let parent = root.parentContainer; parent; parent = parent.parentContainer) k *= Math.abs(parent.scaleX);
    return k;
  };

  // The face is redrawn only when it would look different: a new expression, or the leaves have
  // bent the eyes at least half a pixel further on screen.
  function drawFace(mode, blinking) {
    const shown = blinking ? "blink" : mode;
    const step = shown === "open" ? 0 : Math.round(bend * eyeReach * screenScale() * 2);
    if (shown === faceMode && step === faceStep) return;
    faceMode = shown;
    faceStep = step;
    face.clear();
    if (mode === "open" && !blinking) return;
    rig.eyes.forEach(([ex, ey, rx, ry], index) => {
      const cx = ex + slide(ey);
      const nose = index === 0 ? 1 : -1;        // which side of this eye the nose is on
      const thick = Math.max(1, rx * 0.34);
      const lid = () => { face.fillStyle(plant.lid, 1); face.fillEllipse(cx, ey, rx * 2 + 1, ry * 2 + 1); };
      const line = (x0, y0, x1, y1) => { face.lineStyle(thick, DARK, 1); face.lineBetween(cx + x0 * rx, ey + y0 * ry, cx + x1 * rx, ey + y1 * ry); };

      if (blinking) {
        lid();
        line(-0.85, 0.15, 0.85, 0.15);
      } else if (mode === "happy") {          // closed and smiling: an arch
        lid();
        line(-0.8, 0.3, -0.3, -0.3); line(-0.3, -0.3, 0.3, -0.3); line(0.3, -0.3, 0.8, 0.3);
      } else if (mode === "angry" || mode === "sad") {
        // a brow that cuts across the top of the eye: low by the nose when angry, low at the outside when sad
        const tilt = mode === "angry" ? nose : -nose;
        const lowX = tilt, highX = -tilt;
        face.fillStyle(plant.lid, 1);
        face.fillPoints([
          { x: cx + highX * rx * 1.25, y: ey - ry * 1.35 }, { x: cx + lowX * rx * 1.25, y: ey - ry * 1.35 },
          { x: cx + lowX * rx * 1.25, y: ey - ry * 0.02 }, { x: cx + highX * rx * 1.25, y: ey - ry * 0.85 },
        ], true);
        line(lowX * 1.25, -0.02, highX * 1.25, -0.85);
      } else if (mode === "shock") {          // wide white eyes, tiny pupils
        face.fillStyle(DARK, 1); face.fillEllipse(cx, ey, rx * 2.5, ry * 2.4);
        face.fillStyle(0xffffff, 1); face.fillEllipse(cx, ey, rx * 1.95, ry * 1.9);
        face.fillStyle(DARK, 1); face.fillEllipse(cx + nose * rx * 0.1, ey, rx * 0.62, ry * 0.6);
      } else if (mode === "hurt") {           // screwed shut: > <
        lid();
        line(-0.6 * nose, -0.55, 0.5 * nose, 0); line(0.5 * nose, 0, -0.6 * nose, 0.55);
      } else if (mode === "fainted") {        // x x
        lid();
        line(-0.6, -0.55, 0.6, 0.55); line(-0.6, 0.55, 0.6, -0.55);
      }
    });
  }

  // ---- state ----
  const mood = { ...MOODS.happy };
  let moodName = "happy";
  let plays = [];                              // actions running now
  let emote = null;                            // { name, start, ms }
  let bendSpeed = 0;
  let lastX = null;
  let lastY = null;
  let velX = 0;
  let velY = 0;
  // its own clock: it starts at the scene's time and moves by delta x scene.time.timeScale, so a
  // hit-stop (timeScale 0) freezes it and slow motion slows it
  let now = scene.time.now;
  let blinkAt = now + Phaser.Math.Between(600, 3200);
  let blinkUntil = 0;
  const beat = Phaser.Math.FloatBetween(0, 40);     // so two plants never move in step
  const manual = newPose();                         // root.pose: a scene's own nudges
  const pose = newPose();                           // this frame's dials, reused every frame
  const gestureSets = [];                           // this frame's arm poses that are switched on
  const gestureAmounts = [];
  const ended = [];
  let flashUntil = 0;                               // real time when a white flash ends, or 0

  function drawEmote(name) {
    const rows = EMOTES[name];
    emoteArt.clear();
    if (!rows) return;
    const cell = H / 26;
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row, r) => {
      [...row].forEach((letter, c) => {
        const color = EMOTE_COLORS[letter];
        if (color === undefined) return;
        emoteArt.fillStyle(color, 1);
        emoteArt.fillRect((c - width / 2) * cell, (r - rows.length) * cell, cell + 0.5, cell + 0.5);
      });
    });
  }

  // Called every frame by the scene. delta is real ms; the plant's clock moves by delta x timeScale.
  function update(sceneTime, delta) {
    if (flashUntil && realNow() >= flashUntil) setFlash(false);
    const step = delta * (scene.time.timeScale ?? 1);
    if (step > 0) advance(step);               // a stopped clock (hit-stop): hold still
  }

  // One frame of the plant's own time, `step` ms long.
  function advance(step) {
    now += step;
    const time = now;
    const dt = clamp(step, 1, 50) / 1000;
    const t = time / 1000 + beat;
    const sin = Math.sin;

    // the mood eases toward where it should be
    const target = MOODS[moodName];
    const ease = Math.min(1, dt * (moodName === "fainted" ? 5 : 7));
    for (let i = 0; i < MOOD_DIALS.length; i++) {
      const dial = MOOD_DIALS[i];
      mood[dial] += (target[dial] - mood[dial]) * ease;
    }

    // add up every running action
    resetPose(pose, manual);
    ended.length = 0;
    let kept = 0;
    for (let i = 0; i < plays.length; i++) {
      const play = plays[i];
      const k = (time - play.start) / play.ms;
      if (k < 1 || play.action.hold) {
        if (k >= 0) play.action.run(Math.min(1, k), pose, play.options, root);
        plays[kept++] = play;                  // an action marked `hold` keeps its last pose
      }
      if (k >= 1 && !play.done) { play.done = true; ended.push(play); }
    }
    plays.length = kept;
    for (let i = 0; i < ended.length; i++) if (ended[i].options.onDone) ended[i].options.onDone();

    // the body: where it is, how it leans, how squashed it is
    const stretch = pose.stretch + mood.stretch + 0.012 * sin(t * 2.1) * mood.sway;
    const tremble = mood.tremble * 0.6 + pose.shake;
    const grow = Math.max(0, 1 + pose.scale);
    body.x = (pose.x + 0.008 * tremble * sin(time * 0.09)) * H;
    body.y = -(pose.lift + mood.tip * 0.085) * H;
    body.rotation = pose.lean + mood.lean - mood.tip * 1.42 + 0.012 * sin(t * 0.9) * mood.sway;
    body.scaleY = (1 + stretch) * grow;
    body.scaleX = (1 - stretch * 0.55) * grow;

    // how fast it is moving, in heights per second: this is what makes everything loose trail behind
    const scale = root.scaleX || 1;
    const hereX = root.x / scale + body.x;
    const hereY = root.y / scale + body.y;
    if (lastX !== null) {
      const follow = Math.min(1, dt * 18);
      velX += (clamp((hereX - lastX) / dt / H, -5, 5) - velX) * follow;
      velY += (clamp((hereY - lastY) / dt / H, -5, 5) - velY) * follow;
    }
    lastX = hereX;
    lastY = hereY;

    // the leaves bend: a slow drift, whatever the actions ask for, and they lag behind a sideways move
    const wind = (0.035 * sin(t * 0.8) + 0.018 * sin(t * 1.9 + 1.3)) * mood.sway;
    const bendTo = clamp(wind + pose.bend - velX * 0.045 - pose.lean * 0.12, -0.22, 0.22);
    bendSpeed += ((bendTo - bend) * 70 - bendSpeed * 9) * dt;
    bend += bendSpeed * dt;
    for (let i = 0; i < strips.length; i++) strips[i].image.x = left + bend * strips[i].reach;

    // the arm poses switched on this frame
    let gestureCount = 0;
    for (const name in pose.gesture) {
      const set = plant.gestures && plant.gestures[name];
      if (!set || !pose.gesture[name]) continue;
      gestureSets[gestureCount] = set;
      gestureAmounts[gestureCount++] = pose.gesture[name];
    }

    // the loose pieces
    for (let p = 0; p < pieceList.length; p++) {
      const piece = pieceList[p];
      const idle = (piece.a1 * sin(t * piece.f1 + piece.p1) + piece.a2 * sin(t * piece.f2 + piece.p2)) * mood.sway;
      let turn = idle + (pose.open + mood.open) * 0.3 * piece.raise + (pose.turn[piece.name] || 0);
      for (let g = 0; g < gestureCount; g++) {
        const amount = gestureSets[g][piece.name];
        if (amount) turn += amount * gestureAmounts[g];
      }
      const trailTo = clamp(0.24 * (-piece.dx * velY + piece.dy * velX), -0.75, 0.75);
      piece.speed += ((trailTo - piece.lag) * 95 - piece.speed * 7.5) * dt;
      piece.lag += piece.speed * dt;
      piece.node.rotation = turn + piece.lag;
      if (!piece.spec.parent) piece.node.x = piece.spec.x + slide(piece.spec.y);
    }

    // the face
    if (time >= blinkAt) {
      blinkUntil = time + 130;
      blinkAt = time + (Math.random() < 0.2 ? 260 : Phaser.Math.Between(1800, 4600));
    }
    const look = pose.face || target.face;
    drawFace(look, look === "open" && time < blinkUntil);

    // its shadow shrinks and fades as it leaves the ground
    const air = clamp01(pose.lift * 3);
    shadow.x = body.x;
    shadow.setScale((1 - air * 0.35) * grow, (1 - air * 0.3) * grow);
    shadow.setAlpha(0.45 - air * 0.2);
    cast.x = body.x;
    cast.setScale(grow).setLift(pose.lift, mood.tip);      // a plant lying on its side throws none

    // the mark above its head pops in, bobs and fades
    if (emote) {
      const k = (time - emote.start) / emote.ms;
      if (k >= 1) { emote = null; emoteLayer.setVisible(false); }
      else {
        const pop = backOut(k * emote.ms / 180);
        emoteLayer.setVisible(true).setScale(pop, pop).setAlpha(k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1);
        emoteLayer.setPosition(body.x + 0.1 * H, -H * (1.02 + pose.lift * 0.6) + sin(time * 0.012) * H * 0.012);
      }
    }
  }

  // A white flash: every picture piece is filled solid white; the drawn face is hidden under it.
  const tinted = [...strips.map((strip) => strip.image), pot, ...pieceList.map((piece) => piece.node.list[0])];
  function setFlash(on) {
    flashUntil = on ? flashUntil : 0;
    for (const image of tinted) {
      if (!image.active) continue;
      if (on) image.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else image.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    }
    face.setVisible(!on);
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  root.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, update));

  // ---- what a scene can ask of it ----
  root.isPlantRig = true;
  root.plant = plant;
  root.pose = manual;
  root.setHeight = (value) => { root.setScale(value / H); return root; };
  root.getHeight = () => root.scaleY * H;

  root.setMood = (name, instant = false) => {
    if (!MOODS[name]) return root;
    moodName = name;
    if (instant) Object.assign(mood, MOODS[name]);
    return root;
  };
  root.getMood = () => moodName;

  // Runs an action. options are the action's own (height, reach, force ...), plus:
  //   delay: ms to wait first.   ms: a different length.   onDone: called when it ends.
  // Returns how long it lasts, delay included, so effects can be timed to it.
  root.play = (name, playOptions = {}) => {
    const action = ACTIONS[name];
    if (!action) return 0;
    plays = plays.filter((play) => !play.action.hold);     // anything new undoes a held "leave"
    const ms = playOptions.ms || action.ms;
    plays.push({ action, options: playOptions, start: now + (playOptions.delay || 0), ms, done: false });
    return ms + (playOptions.delay || 0);
  };
  // When the blow of an action lands, in ms from when it is played.
  root.hitTime = (name, playOptions = {}) => {
    const action = ACTIONS[name];
    if (!action) return 0;
    return (playOptions.delay || 0) + (playOptions.ms || action.ms) * (action.hitAt ?? 0.5);
  };
  root.isBusy = () => plays.some((play) => !play.done);
  // Turns it solid white for `ms` of real time, for the moment a hit lands. It runs on real time,
  // not the plant's clock, so it shows during a hit-stop and ends on time. Returns the plant.
  root.flashWhite = (ms = 90) => {
    flashUntil = realNow() + Math.max(0, ms);
    setFlash(true);
    return root;
  };
  // The plant's own clock, in ms: what play() and hitTime() count from.
  root.clock = () => now;
  root.stopActions = () => { plays = []; return root; };

  root.emote = (name, ms = 1100) => {
    if (!EMOTES[name]) return root;
    drawEmote(name);
    emote = { name, start: now, ms };
    return root;
  };

  // Where a named spot is on screen right now. Spots on a hand or leaf move with it.
  root.point = (name) => {
    const spot = rig.points[name] || rig.points.face;
    const piece = pieces[name];
    if (piece) {
      const matrix = piece.node.getWorldTransformMatrix();
      const lx = spot[0] - piece.spec.x;
      const ly = spot[1] - piece.spec.y;
      return { x: matrix.getX(lx, ly), y: matrix.getY(lx, ly) };
    }
    const matrix = body.getWorldTransformMatrix();
    const lx = spot[0] + slide(spot[1]);
    return { x: matrix.getX(lx, spot[1]), y: matrix.getY(lx, spot[1]) };
  };

  root.setHeight(height);
  // draw the first frame where it stands (the clock is moved back so this first step lands on now)
  now -= 16;
  advance(16);
  return root;
}
