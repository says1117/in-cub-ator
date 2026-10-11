// client/src/render/bossRig.js: A boss drawn from moving pieces. Owner: Role 3 (client, art, demo).
// The three flower heads and the three leaves each sway at their own speed, so the plant never
// repeats itself, and the whole plant leans and breathes with them. roar() lifts the middle head,
// opens it like a mouth and shakes everything.
//
// It returns a Phaser container. Move, scale, fade or destroy it like a picture: x, y is the spot
// it stands on. It animates itself and stops when it is destroyed.
//
//   boss.roar()                       the roar (see above)
//   boss.setIntent("guard")           shows what it will do next, as a pose: see INTENT_POSES
//   boss.flashWhite(90)               turns it solid white for a moment, for a hit
//   boss.mouthPoint()                 where the mouth is on screen, for anything that comes out of it
//
// TIME: it runs on its own clock, which moves by delta x scene.time.timeScale each frame. Set the
// scene's time.timeScale to 0 (a hit-stop) and the boss freezes mid-move with everything else.
import Phaser from "phaser";
import { createSporeRig } from "./sporeRig.js";
import { rigPartKey } from "../data/bosses.js";
import { createCastShadow, outlineOfPicture } from "./castShadow.js";
import { GLOW_KEY, ensureGlowTexture, createChargeSparks, toLayer } from "./bossTellFx.js";

const ROAR_MS = 1500;
const RAISE = 0.92;       // how far the middle head swings up, in radians
const GAPE_A = 0.3;       // how far each jaw opens
const GAPE_B = 0.5;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
const backOut = (v) => 1 + 2.7 * Math.pow(v - 1, 3) + 1.7 * Math.pow(v - 1, 2);

// The inside of the mouth: a dark halo, then the orb from its rim to its hot middle.
const MAW_RINGS = [[0xc21d36, 1, 0.3], [0xd8263a, 0.72, 0.6], [0xf0502f, 0.44, 1], [0xffb04a, 0.2, 1]];
const TOOTH_STEPS = [0.15, 0.65];

// INTENT POSES: what it will do next, shown as a pose. Each is a set of extra dials added on top of
// the idle sway and the roar (it never replaces them), eased in and out over INTENT_MS.
//   lean      the whole plant tips, radians; negative is toward the plant on the left
//   crouch    squashes it down (0.08 is 92% of its height)     widen  a little wider as it squats
//   headL/R   extra turn of the side heads; headL + / headR - swings them outward, the other way folds them in
//   raise     the middle head swings up toward the plant, as in the roar (1 = the roar's full lift)
//   sink      the middle head drops into the body, rig pixels
//   gape      the mouth opens (1 = the roar's full gape)       pulse  it throbs open and shut
//   shut      the resting mouth closes (1 = shut tight)        glow   a soft light in the mouth
//   bob       a slow menacing bob                              flutter  extra leaf speed (2 = three times)
//   sparks    sparks gathering at the mouth                    inPhase  all heads sway together
//   leafL/R/T extra turn of each leaf; leafL + and leafR - lift them
const INTENT_MS = 300;
const INTENT_POSES = {
  attack: { lean: -0.085, raise: 0.35, gape: 0.42, glow: 0.8, bob: 1, headL: 0.06, headR: -0.04, leafL: -0.12, leafR: 0.14, leafT: -0.16 },
  guard: { crouch: 0.08, widen: 0.04, headL: -0.5, headR: 0.5, shut: 1, raise: -0.04, sink: 16, leafL: 1.15, leafR: -1.2, leafT: 0.1 },
  special: { headL: 0.42, headR: -0.44, flutter: 2, gape: 0.34, pulse: 1, raise: 0.14, glow: 1.3, sparks: 1, leafL: 0.22, leafR: -0.26, leafT: 0.12 },
  "?": { shut: 1, inPhase: 1 },
};
const INTENTS = Object.keys(INTENT_POSES);
const DIALS = ["lean", "crouch", "widen", "headL", "headR", "raise", "sink", "gape", "pulse", "shut", "glow", "bob", "flutter",
  "sparks", "inPhase", "leafL", "leafR", "leafT", "lunge", "shake"];
const zeroDials = () => Object.fromEntries(DIALS.map((dial) => [dial, 0]));

export function hasBossRig(scene, art) {
  return Boolean(art.rig) && Object.keys(art.rig.parts).every((part) => scene.textures.exists(rigPartKey(art, part)));
}

// height: how tall the whole picture is drawn, the same meaning as `height` in data/bosses.js.
// options.light: where the light is, for the shadow it throws (see render/castShadow.js).
export function createBossRig(scene, art, x, y, height, options = {}) {
  const rig = art.rig;
  if (rig.kind === "spores") return createSporeRig(scene, art, x, y, height, options);
  const root = scene.add.container(x, y);
  const body = scene.add.container(0, 0);
  ensureGlowTexture(scene);
  // the shadow it throws: the outline of its whole picture, laid on the ground
  let cast = null;
  if (scene.textures.exists(art.key)) {
    const picture = scene.textures.get(art.key).getSourceImage();
    const outline = outlineOfPicture(scene, art.key, 0.5, 0.93);
    cast = createCastShadow(scene, outline, { light: options.light, size: rig.height / picture.height });
    root.add(cast);
  }
  root.add(body);
  const fx = scene.add.container(0, 0);     // sparks, in front of the plant, in rig pixels
  root.add(fx);

  const piece = (name) => {
    const spec = rig.parts[name];
    return scene.add.image(spec.x, spec.y, rigPartKey(art, name)).setOrigin(spec.ox, spec.oy);
  };

  const leafT = piece("leafT");
  const leafL = piece("leafL");
  const leafR = piece("leafR");
  const base = piece("base");
  const headL = piece("headL");
  const headR = piece("headR");

  // the middle head: the inside of the mouth, then the two jaws over it
  const neck = rig.parts.jawA;
  const headM = scene.add.container(neck.x, neck.y);
  const maw = scene.add.graphics();
  const glow = scene.add.image(0, 0, GLOW_KEY).setBlendMode(Phaser.BlendModes.ADD).setTint(0xff8a3a).setVisible(false);
  const jawB = piece("jawB").setPosition(0, 0);
  const jawA = piece("jawA").setPosition(0, 0);
  headM.add([maw, glow, jawB, jawA]);

  body.add([leafT, leafL, leafR, base, headL, headR, headM]);
  const pictures = [leafT, leafL, leafR, base, headL, headR, jawB, jawA];
  const sparks = createChargeSparks(scene, fx, { size: 1.1, reach: 170 });

  // where the edge between the two jaws is, turned by `angle`; written into `out` (no new objects per frame)
  const edgeA = rig.split.map(() => ({ x: 0, y: 0 }));
  const edgeB = rig.split.map(() => ({ x: 0, y: 0 }));
  const turned = (angle, out) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = 0; i < rig.split.length; i++) {
      const [px, py] = rig.split[i];
      out[i].x = px * cos - py * sin;
      out[i].y = px * sin + py * cos;
    }
    return out;
  };
  const throat = { x: 0, y: 0, size: 0 };   // the middle of the open mouth, in the middle head's own pixels
  let mawDrawn = true;
  let white = false;                         // drawn all white for a flash

  // The inside of the mouth, between the two jaws: a glowing red orb with a dark halo that fades out, and teeth.
  function drawMaw(a, b) {
    const wide = clamp01((a + b) / (GAPE_A + GAPE_B));
    if (a + b < 0.03 || wide < 0.25) {
      if (mawDrawn) maw.clear();
      mawDrawn = false;
      throat.size = 0;
      return;
    }
    maw.clear();
    mawDrawn = true;
    turned(a, edgeA);
    turned(-b, edgeB);
    // throat: lighter rings toward the middle of the opening
    throat.x = (edgeA[5].x + edgeB[5].x) / 2;
    throat.y = (edgeA[5].y + edgeB[5].y) / 2;
    const size = Math.hypot(edgeA[5].x - edgeB[5].x, edgeA[5].y - edgeB[5].y) * 0.58;
    throat.size = size;
    // a dark halo round the orb: about 60% black next to it, fading to nothing further out
    for (let i = 0; i < 6; i++) {
      const share = 2.1 - i * 0.2;
      maw.fillStyle(white ? 0xffffff : 0x1c040d, white ? 1 : 0.142);
      maw.fillEllipse(throat.x, throat.y, size * share * 1.1, size * share * 1.9);
    }
    for (const [color, share, alpha] of MAW_RINGS) {
      maw.fillStyle(white ? 0xffffff : color, white ? 1 : alpha);
      maw.fillEllipse(throat.x, throat.y, size * share * 1.1, size * share * 1.9);
    }
    // teeth along both jaws, pointing into the mouth
    maw.fillStyle(white ? 0xffffff : 0xf6ecc8, 1);
    for (let side = 0; side < 2; side++) {
      const edge = side ? edgeB : edgeA;
      const other = side ? edgeA : edgeB;
      for (let i = 4; i < edge.length - 1; i++) {
        for (const along of TOOTH_STEPS) {
          const x0 = Phaser.Math.Linear(edge[i].x, edge[i + 1].x, along);
          const y0 = Phaser.Math.Linear(edge[i].y, edge[i + 1].y, along);
          const x1 = Phaser.Math.Linear(edge[i].x, edge[i + 1].x, along + 0.3);
          const y1 = Phaser.Math.Linear(edge[i].y, edge[i + 1].y, along + 0.3);
          const tx = Phaser.Math.Linear(other[i].x, other[i + 1].x, along + 0.15);
          const ty = Phaser.Math.Linear(other[i].y, other[i + 1].y, along + 0.15);
          const reach = Math.min(0.42, 16 / Math.max(1, Math.hypot(tx - x0, ty - y0)));
          maw.fillTriangle(x0, y0, x1, y1, Phaser.Math.Linear(x0, tx, reach), Phaser.Math.Linear(y0, ty, reach));
        }
      }
    }
  }

  let roarAt = -1;                               // when the roar began, or -1
  const offset = Phaser.Math.FloatBetween(0, 20);   // so two plants never move in step

  // its own clock, in ms: it starts at the scene's time and moves by delta x scene.time.timeScale
  let now = scene.time.now;
  let leafTime = now / 1000;                     // the leaves' own time: it runs faster while they flutter

  // the intent pose: how far each pose is blended in (0 to 1, eased when used), and the one it is heading for
  let intent = null;
  const blend = Object.fromEntries(INTENTS.map((name) => [name, 0]));
  const dials = zeroDials();                     // this frame's pose dials
  let flashUntil = 0;                            // real time when a white flash ends, or 0
  let guardLayers = false;                       // side heads and leaves drawn over the middle head

  // In guard the side heads and the leaves come round in front of the middle head, closing over it.
  const restOrder = [leafT, leafL, leafR, base, headL, headR, headM];
  const guardOrder = [leafT, base, headM, headL, headR, leafL, leafR];
  function layerForGuard(on) {
    if (on === guardLayers) return;
    guardLayers = on;
    const order = on ? guardOrder : restOrder;
    for (let i = 0; i < order.length; i++) body.moveTo(order[i], i);
  }

  // Called every frame by the scene. delta is real ms; the boss's clock moves by delta x timeScale.
  function update(sceneTime, delta) {
    if (flashUntil && performance.now() >= flashUntil) setFlash(false);
    const step = delta * (scene.time.timeScale ?? 1);
    if (step > 0) advance(step);                 // a stopped clock (hit-stop): hold still
  }

  function advance(step) {
    now += step;
    const time = now;
    const t = time / 1000 + offset;
    const sin = Math.sin;

    let raise = 0;
    let gape = 0;
    let rattle = 0;
    if (roarAt >= 0) {
      const ms = time - roarAt;
      if (ms >= ROAR_MS) roarAt = -1;
      else {
        raise = ms < 320 ? backOut(clamp01(ms / 320)) : 1 - smooth(clamp01((ms - 1150) / 350));
        gape = ms < 420 ? backOut(clamp01((ms - 240) / 180)) * (ms >= 240) : 1 - smooth(clamp01((ms - 1080) / 260));
        rattle = ms > 380 && ms < 1120 ? 1 : 0;
      }
    }
    const calm = 1 - clamp01(raise);
    const buzz = rattle * sin(time * 0.09);

    // ---- the extra dials: the intent pose, eased in ----
    for (const dial of DIALS) dials[dial] = 0;
    for (const name of INTENTS) {
      blend[name] = clamp01(blend[name] + (name === intent ? 1 : -1) * (step / INTENT_MS));
      const w = smooth(blend[name]);
      if (w <= 0) continue;
      const pose = INTENT_POSES[name];
      for (const dial in pose) dials[dial] += pose[dial] * w;
    }
    const d = dials;
    const keep = 1 - 0.85 * clamp01(d.inPhase);             // how much of the out-of-phase idle stays
    const together = clamp01(d.inPhase) * (0.17 * sin(t * 1.5) + 0.04 * sin(t * 3.1 + 1));   // the in-phase sway
    const shake = d.shake * 0.02 * sin(time * 0.11);
    const bob = d.bob * sin(t * 2.4);
    const lift = Math.min(1.15, raise + d.raise);           // the roar and the pose together, never past over-the-top

    // the whole plant leans and breathes; during a roar it rears back and swells
    body.rotation = (0.014 * sin(t * 0.9) + 0.006 * sin(t * 1.7 + 1)) * calm + raise * 0.035 + buzz * 0.006
      + d.lean + bob * 0.012 + together * 0.2 + shake * 0.4;
    body.scaleY = (1 + 0.012 * sin(t * 1.8) + gape * 0.035) * (1 - d.crouch);
    body.scaleX = (1 - 0.006 * sin(t * 1.8) + gape * 0.02) * (1 + d.widen);
    body.x = d.lunge;
    if (cast) cast.x = d.lunge;

    // each head has its own slow swing with a quicker one on top; they flare out in a roar
    headL.rotation = (0.085 * sin(t * 1.25 + 0.4) + 0.03 * sin(t * 2.9)) * keep + raise * 0.2 + buzz * 0.03 + d.headL + together + shake;
    headR.rotation = (0.075 * sin(t * 1.05 + 2.3) + 0.03 * sin(t * 2.3 + 1)) * keep - raise * 0.22 - buzz * 0.03 + d.headR + together - shake;
    headM.rotation = (0.06 * sin(t * 0.85 + 4.1) + 0.025 * sin(t * 2.1 + 2)) * calm * keep + lift * RAISE + buzz * 0.02
      + together * calm + bob * 0.035 + shake;
    headM.y = neck.y - lift * 12 + d.sink;

    leafTime += (step / 1000) * (1 + d.flutter);
    const lt = leafTime + offset;
    const flutter = 1 + rattle * 2.2;
    leafT.rotation = 0.1 * sin(lt * 1.6 * flutter + 1) + 0.04 * sin(lt * 3.7) + d.leafT;
    leafL.rotation = 0.045 * sin(lt * 1.3 * flutter + 3) + 0.015 * sin(lt * 3.1) + d.leafL;
    leafR.rotation = 0.07 * sin(lt * 1.45 * flutter + 5) + 0.025 * sin(lt * 3.3 + 2) + d.leafR;
    layerForGuard(blend.guard > 0.5);

    // the mouth: barely parted at rest, as if breathing; shut tight in some poses, open in others
    const rest = (0.02 + 0.02 * sin(t * 1.1)) * calm * (1 - clamp01(d.shut));
    const open = Math.max(0, d.gape * (1 - 0.4 * clamp01(d.pulse) * (0.5 + 0.5 * sin(t * 9))));
    const a = rest + gape * GAPE_A + buzz * 0.025 + open * GAPE_A;
    const b = rest + gape * GAPE_B - buzz * 0.025 + open * GAPE_B;
    jawA.rotation = a;
    jawB.rotation = -b;
    drawMaw(a, b);

    // a soft light in the open mouth, and sparks gathering there while it charges
    const shine = throat.size > 0 ? clamp01(d.glow) : 0;
    glow.setVisible(shine > 0.01 && !white);
    if (shine > 0.01) {
      glow.setPosition(throat.x, throat.y);
      glow.setScale((throat.size / 64) * (2.6 + 0.4 * sin(t * 7)) * (0.8 + 0.4 * Math.min(1.5, d.glow)));
      glow.setAlpha(shine * (0.45 + 0.15 * sin(t * 7)));
    }
    mouthLocal();
    sparks.update(step, mouth.x, mouth.y, d.sparks);
  }

  // The mouth in the rig's own pixels (the parent of `fx`), worked out by hand to make no new objects.
  const mouth = { x: 0, y: 0 };
  function mouthLocal() {
    const [px, py] = rig.split[5];
    const ja = jawA.rotation * 0.5 - jawB.rotation * 0.5;    // halfway between the jaws
    const c0 = Math.cos(ja), s0 = Math.sin(ja);
    let x = px * c0 - py * s0;
    let y = px * s0 + py * c0;
    const c1 = Math.cos(headM.rotation), s1 = Math.sin(headM.rotation);
    const hx = headM.x + x * c1 - y * s1;
    const hy = headM.y + x * s1 + y * c1;
    x = hx * body.scaleX;
    y = hy * body.scaleY;
    const c2 = Math.cos(body.rotation), s2 = Math.sin(body.rotation);
    mouth.x = body.x + x * c2 - y * s2;
    mouth.y = body.y + x * s2 + y * c2;
    return mouth;
  }

  function setFlash(on) {
    if (!on) flashUntil = 0;
    white = on;
    for (const part of pictures) {
      if (!part.active) continue;
      if (on) part.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else part.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    }
    mawDrawn = true;                            // redraw the mouth in its own colours (or white) next frame
    drawMaw(jawA.rotation, -jawB.rotation);
    glow.setVisible(false);
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  root.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, update));

  root.isBossRig = true;
  root.roarLength = ROAR_MS;
  root.roar = () => { roarAt = now; };
  // How tall the picture is drawn. Sets the scale, so call it instead of setScale for sizing.
  root.setHeight = (value) => root.setScale(value / rig.height);
  // Where the open mouth is on screen, for anything that should come out of it.
  root.mouthPoint = () => {
    const matrix = headM.getWorldTransformMatrix();
    const [px, py] = rig.split[6];
    const cos = Math.cos(GAPE_A * 0.3);
    const sin = Math.sin(GAPE_A * 0.3);
    return { x: matrix.getX(px * cos - py * sin, px * sin + py * cos), y: matrix.getY(px * cos - py * sin, px * sin + py * cos) };
  };

  // Shows what it will do next: "attack", "guard", "special", "?" (it is hiding its move) or null
  // (no telegraph, just the idle). The pose eases in over 300 ms and the old one eases out.
  // Anything else counts as "?". Returns the boss.
  root.setIntent = (next) => {
    intent = next == null ? null : INTENT_POSES[next] ? next : "?";
    return root;
  };
  root.getIntent = () => intent;


  // Turns it solid white for `ms` of real time, for the moment a hit lands. It runs on real time,
  // not the boss's clock, so it shows during a hit-stop and ends on time. Returns the boss.
  root.flashWhite = (ms = 90) => {
    flashUntil = performance.now() + Math.max(0, ms);
    setFlash(true);
    return root;
  };
  // The boss's own clock, in ms.
  root.clock = () => now;

  // ---- for the effects in bossFx.js ----
  // A spot on the boss in `layer` coordinates: "mouth", or "middle" (the middle of the plant).
  // guess.raise/open: where the mouth will be once the head is up and open (for a spit planned ahead).
  root.fxPoint = (layer, spot = "mouth", guess = null) => {
    let x = 0;
    let y = -rig.height * 0.42;
    if (spot === "mouth") {
      if (guess) {
        const angle = guess.raise * RAISE;
        const [px, py] = rig.split[6];
        const c = Math.cos(angle), s = Math.sin(angle);
        x = neck.x + body.x + px * c - py * s;
        y = neck.y - guess.raise * 12 + px * s + py * c;
      } else {
        mouthLocal();
        x = mouth.x;
        y = mouth.y;
      }
    }
    const matrix = root.getWorldTransformMatrix();
    return toLayer(layer, { x: matrix.getX(x, y), y: matrix.getY(x, y) });
  };
  // How big the boss is drawn in `layer`, as a share of its size on the battle stage (330 tall),
  // so effects can be sized to it.
  root.fxScale = (layer) => {
    const matrix = root.getWorldTransformMatrix();
    const top = toLayer(layer, { x: matrix.getX(0, -rig.height), y: matrix.getY(0, -rig.height) });
    const foot = toLayer(layer, { x: matrix.getX(0, 0), y: matrix.getY(0, 0) });
    return Math.hypot(top.x - foot.x, top.y - foot.y) / 330;
  };

  root.setHeight(height);
  now -= 16;
  leafTime -= 0.016;
  advance(16);
  return root;
}
