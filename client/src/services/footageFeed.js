import { FOOTAGE_URL } from "../config.js";

// This feed belongs only to /footage. Other pages keep their plant artwork.
// A counter names each texture: crypto.randomUUID() does not exist on a plain-http page like the Jetson's.
let feedCount = 0;
export function attachFootage(scene, plantId, x, y, width, height, onState) {
  const key = `footage-${++feedCount}`;
  const texture = scene.textures.createCanvas(key, Math.round(width * 2), Math.round(height * 2));
  const video = scene.add.image(x, y, key).setDisplaySize(width, height).setVisible(false);
  video.setName(`footage-${plantId}`);
  let stopped = false, timer, controller;
  async function poll() {
    if (stopped) return;
    let success = false, bitmap;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      if (document.hidden) return;
      const response = await fetch(`${FOOTAGE_URL}/api/plants/${encodeURIComponent(plantId)}/footage/frame`,
        { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Camera unavailable");
      bitmap = await createImageBitmap(await response.blob());
      if (stopped) return;
      const canvas = texture.getSourceImage(), ctx = texture.context;
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
      const w = bitmap.width * scale, h = bitmap.height * scale;
      ctx.fillStyle = "#11172c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      texture.refresh(); video.setVisible(true); onState(true); success = true;
    } catch {
      if (!stopped) { video.setVisible(false); onState(false); }
    } finally {
      clearTimeout(timeout); bitmap?.close();
      if (!stopped) timer = setTimeout(poll, success ? 150 : 1200);
    }
  }
  function cleanup() {
    if (stopped) return;
    stopped = true; clearTimeout(timer); controller?.abort();
    scene.events.off("shutdown", cleanup); video.destroy(); scene.textures.remove(key);
  }
  scene.events.once("shutdown", cleanup);
  poll();
  return video;
}
