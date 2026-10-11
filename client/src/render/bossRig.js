// client/src/render/bossRig.js: A boss drawn from moving pieces. Owner: Role 3 (client, art, demo).
// The three flower heads and the three leaves each sway at their own speed, so the plant never
// repeats itself, and the whole plant leans and breathes with them. roar() lifts the middle head,
// opens it like a mouth and shakes everything.
//
// It returns a Phaser container. Move, scale, fade or destroy it like a picture: x, y is the spot
// it stands on. It animates itself and stops when it is destroyed.
import Phaser from "phaser";
import { rigPartKey } from "../data/bosses.js";
import { createCastShadow, outlineOfPicture } from "./castShadow.js";
import { createSporeRig } from "./sporeRig.js";

const ROAR_MS = 1500;
const RAISE = 0.92;       // how far the middle head swings up, in radians
const GAPE_A = 0.3;       // how far each jaw opens
const GAPE_B = 0.5;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
const backOut = (v) => 1 + 2.7 * Math.pow(v - 1, 3) + 1.7 * Math.pow(v - 1, 2);

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
  // the shadow it throws: the outline of its whole picture, laid on the ground
  if (scene.textures.exists(art.key)) {
    const picture = scene.textures.get(art.key).getSourceImage();
    const outline = outlineOfPicture(scene, art.key, 0.5, 0.93);
    root.add(createCastShadow(scene, outline, { light: options.light, size: rig.height / picture.height }));
  }
  root.add(body);

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
  const jawB = piece("jawB").setPosition(0, 0);
  const jawA = piece("jawA").setPosition(0, 0);
  headM.add([maw, jawB, jawA]);

  body.add([leafT, leafL, leafR, base, headL, headR, headM]);

  const turned = (angle) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return rig.split.map(([px, py]) => ({ x: px * cos - py * sin, y: px * sin + py * cos }));
  };

  // The inside of the mouth, between the two jaws: a glowing red orb with a dark halo that fades out, and teeth.
  function drawMaw(a, b) {
    maw.clear();
    if (a + b < 0.03) return;
    const edgeA = turned(a);
    const edgeB = turned(-b);
    const wide = clamp01((a + b) / (GAPE_A + GAPE_B));
    if (wide < 0.25) return;
    // throat: lighter rings toward the middle of the opening
    const mid = (index) => ({ x: (edgeA[index].x + edgeB[index].x) / 2, y: (edgeA[index].y + edgeB[index].y) / 2 });
    const gap = (index) => Math.hypot(edgeA[index].x - edgeB[index].x, edgeA[index].y - edgeB[index].y);
    const throat = mid(5);
    const size = gap(5) * 0.58;
    // a dark halo round the orb: about 60% black next to it, fading to nothing further out
    for (let i = 0; i < 6; i++) {
      const share = 2.1 - i * 0.2;
      maw.fillStyle(0x1c040d, 0.142);
      maw.fillEllipse(throat.x, throat.y, size * share * 1.1, size * share * 1.9);
    }
    for (const [color, share, alpha] of [[0xc21d36, 1, 0.3], [0xd8263a, 0.72, 0.6], [0xf0502f, 0.44, 1], [0xffb04a, 0.2, 1]]) {
      maw.fillStyle(color, alpha);
      maw.fillEllipse(throat.x, throat.y, size * share * 1.1, size * share * 1.9);
    }
    // teeth along both jaws, pointing into the mouth
    maw.fillStyle(0xf6ecc8, 1);
    for (const [edge, other] of [[edgeA, edgeB], [edgeB, edgeA]]) {
      for (let i = 4; i < edge.length - 1; i++) {
        for (const along of [0.15, 0.65]) {
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

  let now = scene.time.now;

  function update(time) {
    now = time;
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

    // the whole plant leans and breathes; during a roar it rears back and swells
    body.rotation = (0.014 * sin(t * 0.9) + 0.006 * sin(t * 1.7 + 1)) * calm + raise * 0.035 + buzz * 0.006;
    body.scaleY = 1 + 0.012 * sin(t * 1.8) + gape * 0.035;
    body.scaleX = 1 - 0.006 * sin(t * 1.8) + gape * 0.02;

    // each head has its own slow swing with a quicker one on top; they flare out in a roar
    headL.rotation = 0.085 * sin(t * 1.25 + 0.4) + 0.03 * sin(t * 2.9) + raise * 0.2 + buzz * 0.03;
    headR.rotation = 0.075 * sin(t * 1.05 + 2.3) + 0.03 * sin(t * 2.3 + 1) - raise * 0.22 - buzz * 0.03;
    headM.rotation = (0.06 * sin(t * 0.85 + 4.1) + 0.025 * sin(t * 2.1 + 2)) * calm + raise * RAISE + buzz * 0.02;
    headM.y = neck.y - raise * 12;

    const flutter = 1 + rattle * 2.2;
    leafT.rotation = 0.1 * sin(t * 1.6 * flutter + 1) + 0.04 * sin(t * 3.7);
    leafL.rotation = 0.045 * sin(t * 1.3 * flutter + 3) + 0.015 * sin(t * 3.1);
    leafR.rotation = 0.07 * sin(t * 1.45 * flutter + 5) + 0.025 * sin(t * 3.3 + 2);

    // the mouth: barely parted at rest, as if breathing
    const rest = 0.02 + 0.02 * sin(t * 1.1);
    const a = rest * calm + gape * GAPE_A + buzz * 0.025;
    const b = rest * calm + gape * GAPE_B - buzz * 0.025;
    jawA.rotation = a;
    jawB.rotation = -b;
    drawMaw(a, b);
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

  root.setHeight(height);
  update(now);
  return root;
}
