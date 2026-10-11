// client/src/assets.js: Loads art listed in assets/manifest.json; falls back to drawn placeholders. Owner: Role 3 (client, art, demo).
const images = {};

export async function loadAssets() {
  try {
    const res = await fetch("assets/manifest.json");
    const manifest = await res.json();
    await Promise.all(Object.entries(manifest)
      .filter(([k, v]) => !k.startsWith("_") && typeof v === "string")
      .map(([name, path]) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { images[name] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = "assets/" + path;
      })));
  } catch (e) { /* no manifest: placeholders only */ }
}

// Draw sprite `name` if art exists, else call fallback(). Keeps the game playable with zero art.
export function sprite(ctx, name, x, y, w, h, fallback) {
  if (images[name]) ctx.drawImage(images[name], x, y, w, h);
  else fallback(ctx, x, y, w, h);
}
