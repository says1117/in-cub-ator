import { plantFor, plantPartKey } from "../data/plants.js";

// Assemble a resting portrait from the exact PNG pieces used by the forest and
// battle rigs. Keeping the shared catalog avoids a second set of plant artwork.
export function ensurePlantPortrait(scene, id, key) {
  if (scene.textures.exists(key)) return key;
  const plant = plantFor(id), rig = plant.rig;
  const parts = ["base", ...rig.order].map(name => {
    const spec = rig.parts[name], art = spec.m;
    return {
      image: scene.textures.get(plantPartKey(plant, name, "m")).getSourceImage(),
      x: spec.x - art.ox * art.w, y: spec.y - art.oy * art.h,
      width: art.w, height: art.h
    };
  });
  const left = Math.floor(Math.min(...parts.map(p => p.x)));
  const top = Math.floor(Math.min(...parts.map(p => p.y)));
  const right = Math.ceil(Math.max(...parts.map(p => p.x + p.width)));
  const bottom = Math.ceil(Math.max(...parts.map(p => p.y + p.height)));
  const texture = scene.textures.createCanvas(key, right - left, bottom - top);
  for (const part of parts) {
    texture.context.drawImage(part.image, Math.round(part.x - left), Math.round(part.y - top));
  }
  texture.refresh();
  return key;
}
