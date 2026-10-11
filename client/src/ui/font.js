// client/src/ui/font.js: The one font every scene uses, and a helper for text styles. Owner: Role 3.
// Pixelify Sans (SIL Open Font License 1.1) is bundled with the page by @fontsource, so the kiosk
// needs no network. Phaser draws text into a canvas once, so the font must be loaded before the
// first text is made: main.js waits for loadFont() before it starts the game.
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";

export const FONT = '"Pixelify Sans", monospace';

// The usual outlined look. size is in the scene's own pixels.
export function textStyle(size, color = "#ffffff", extra = {}) {
  return {
    fontFamily: FONT,
    fontSize: `${Math.round(size)}px`,
    color,
    stroke: "#11182b",
    strokeThickness: Math.max(2, Math.round(size / 7)),
    ...extra,
  };
}

// Resolves once both weights are ready (or after a short wait, so a missing font never blocks the game).
export function loadFont() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const wanted = Promise.all([
    document.fonts.load(`16px ${FONT}`),
    document.fonts.load(`bold 16px ${FONT}`),
  ]);
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
  return Promise.race([wanted, timeout]).catch(() => {});
}
