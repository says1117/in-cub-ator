// client/src/ui/font.js: The one font every scene uses, and a helper for text styles. Owner: Role 3.
// Tiny5 (SIL Open Font License 1.1) is bundled with the page by @fontsource, so the kiosk needs no
// network. It was picked over Pixelify Sans because its C, G, Z, 2 and 3 stay distinct at small sizes.
// It has one weight: never ask for bold, a synthetic bold smears a pixel font.
// Phaser draws text into a canvas once, so the font must be loaded before the first text is made:
// main.js waits for loadFont() before it starts the game.
import "@fontsource/tiny5/400.css";

export const FONT = '"Tiny5", monospace';

// Contrast for text drawn over the painted scenes, for a font drawn at `px` real pixels.
// A pixel font's openings (C, G, 2, 3) are only a pixel or two wide, and a thick outline fills them
// in, so small text gets a hard drop shadow instead, and only big text a thin outline as well.
export function outline(px) {
  const drop = Math.max(1, Math.round(px / 12));
  return {
    stroke: "#0d1020",
    strokeThickness: px >= 24 ? Math.max(2, Math.round(px / 12)) : 0,
    shadow: { offsetX: drop, offsetY: drop, color: "#0a0c18", blur: 0, fill: true, stroke: px >= 24 },
  };
}

// The usual look. size is in the scene's own pixels.
export function textStyle(size, color = "#ffffff", extra = {}) {
  const px = Math.round(size);
  return { fontFamily: FONT, fontSize: `${px}px`, color, ...outline(px), ...extra };
}

// Resolves once the font is ready (or after a short wait, so a missing font never blocks the game).
export function loadFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wanted = document.fonts.load(`16px ${FONT}`);
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.race([wanted, timeout]).catch(() => {});
}
