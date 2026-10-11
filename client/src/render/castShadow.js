// client/src/render/castShadow.js: A shadow thrown on the ground, in the shape of whoever throws it. Owner: Role 3 (client, art, demo).
// The shadow is the character's own outline, filled dark, laid flat and slanted away from the
// light. That is what makes a flat picture look like it is standing in the world.
//
//   const shadow = createCastShadow(scene, key, { light: FOREST_LIGHT, size: 1 });
//   shadow.setPosition(feetX, feetY);       // it grows from the spot the character stands on
//   shadow.setLift(0.2);                    // the character is off the ground: the shadow slides away and fades
//
// `key` is an outline made by outlineOfPicture() or outlineOfParts() below.
import Phaser from "phaser";

// Where the light is. `length`: how long the shadow is, as a share of the character's height.
// Above 0 it falls away from us (up the screen), below 0 it falls toward us.
// `slant`: how far it leans sideways for its height, positive to the right. `alpha`: how dark.
// In both places the light is low, in front and to the left, so shadows lie back and to the right.
export const FOREST_LIGHT = { length: 0.28, slant: 0.75, alpha: 0.58 };    // shorter: the grass behind the path is a narrow strip
export const BATTLE_LIGHT = { length: 0.4, slant: 0.75, alpha: 0.55 };

const SHADE = "#0d0a18";
const origins = {};      // outline key -> where the feet are inside the outline picture, 0 to 1

function fillDark(ctx, width, height) {
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = SHADE;
  ctx.fillRect(0, 0, width, height);
}

// The outline of one picture. originX, originY: where its feet are, 0 to 1. Returns the outline's key.
export function outlineOfPicture(scene, textureKey, originX = 0.5, originY = 1) {
  const key = `${textureKey}-outline`;
  if (scene.textures.exists(key)) return key;
  const source = scene.textures.get(textureKey).getSourceImage();
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0);
  fillDark(ctx, canvas.width, canvas.height);
  scene.textures.addCanvas(key, canvas);
  origins[key] = { x: originX, y: originY };
  return key;
}

// The outline of something built from several pictures.
// parts: [{ textureKey, x, y }] where x, y is the top left corner of each picture, measured in
// picture pixels from the feet. Returns the outline's key.
export function outlineOfParts(scene, key, parts) {
  if (scene.textures.exists(key)) return key;
  const sources = parts.map((part) => ({ ...part, image: scene.textures.get(part.textureKey).getSourceImage() }));
  const left = Math.floor(Math.min(...sources.map((s) => s.x)));
  const top = Math.floor(Math.min(...sources.map((s) => s.y)));
  const right = Math.ceil(Math.max(...sources.map((s) => s.x + s.image.width)));
  const bottom = Math.ceil(Math.max(...sources.map((s) => s.y + s.image.height)));
  const canvas = document.createElement("canvas");
  canvas.width = right - left;
  canvas.height = bottom - top;
  const ctx = canvas.getContext("2d");
  for (const s of sources) ctx.drawImage(s.image, Math.round(s.x - left), Math.round(s.y - top));
  fillDark(ctx, canvas.width, canvas.height);
  scene.textures.addCanvas(key, canvas);
  origins[key] = { x: -left / canvas.width, y: -top / canvas.height };
  return key;
}

// options.light: FOREST_LIGHT, BATTLE_LIGHT or your own.
// options.size: how much the outline picture is enlarged to match the character on screen.
export function createCastShadow(scene, outlineKey, options = {}) {
  const light = options.light || FOREST_LIGHT;
  const origin = origins[outlineKey] || { x: 0.5, y: 1 };

  // A slant cannot be set on a picture directly. A turn, a stretch and another turn make one:
  // the outer container does the first two, the inner container the last.
  const m00 = 1, m01 = -light.slant, m10 = 0, m11 = light.length;
  const e = (m00 + m11) / 2, f = (m00 - m11) / 2, g = (m10 + m01) / 2, h = (m10 - m01) / 2;
  const q = Math.hypot(e, h), r = Math.hypot(f, g);
  const a1 = Math.atan2(g, f), a2 = Math.atan2(h, e);

  const root = scene.add.container(0, 0);
  const flat = scene.add.container(0, 0).setRotation((a2 + a1) / 2).setScale(q + r, q - r);
  const turned = scene.add.container(0, 0).setRotation((a2 - a1) / 2);
  const image = scene.add.image(0, 0, outlineKey).setOrigin(origin.x, origin.y).setScale(options.size || 1);
  scene.textures.get(outlineKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
  turned.add(image);
  flat.add(turned);
  root.add(flat);
  root.setAlpha(light.alpha);

  const tall = image.height * (options.size || 1);
  root.light = light;
  // lift: how far off the ground the character is, as a share of its height. fade: 0 to 1, extra fading.
  root.setLift = (lift, fade = 0) => {
    const up = Math.max(0, lift) * tall;
    flat.setPosition(light.slant * up, -light.length * up);
    root.setAlpha(light.alpha * Math.max(0, 1 - lift * 1.6) * (1 - fade));
    return root;
  };
  return root;
}
