// client/src/ui/hudArt.js: Pixel-drawn pieces for the in-canvas HUD (scenes/HudScene.js). Owner: Role 3.
// Everything is drawn with whole-pixel rectangles so it stays crisp at the native 800 x 450 and
// scales up cleanly. The bundled font has no arrows or triangles, so those are drawn here too.

export const HUD = {
  plate: 0x0b0d1a,
  plateAlpha: 0.72,
  border: 0xe8d5a6,       // warm parchment
  borderAlpha: 0.75,
  text: "#f6ecd2",
  dim: "#a9a3b8",
  gold: "#ffd77a",
  goldHex: 0xffd77a,
  water: 0x56b8ff,
  waterEmpty: 0x1b2440,
  thirsty: 0xff9a4a,
  thirstyText: "#ffb06a",
  grey: 0x8a8798,
  greyText: "#9c98aa",
  shadow: "#05060d",
};

// A plate with a 1 px border and clipped (one-pixel rounded) corners.
export function drawPlate(g, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const fill = o.fill ?? HUD.plate;
  const alpha = o.alpha ?? HUD.plateAlpha;
  const border = o.border ?? HUD.border;
  const borderAlpha = o.borderAlpha ?? HUD.borderAlpha;
  g.fillStyle(fill, alpha);
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  g.fillStyle(border, borderAlpha);
  g.fillRect(x + 1, y, w - 2, 1);
  g.fillRect(x + 1, y + h - 1, w - 2, 1);
  g.fillRect(x, y + 1, 1, h - 2);
  g.fillRect(x + w - 1, y + 1, 1, h - 2);
  if (o.highlight) {
    // a faint inner top line, like light catching the edge
    g.fillStyle(0xffffff, 0.08);
    g.fillRect(x + 2, y + 1, w - 4, 1);
  }
}

// Draws a bitmap given as rows of characters. colors maps a character to a colour
// (or [colour, alpha]); any other character is left empty.
export function drawBitmap(g, rows, x, y, colors, scale = 1) {
  x = Math.round(x); y = Math.round(y);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const spec = colors[row[c]];
      if (spec === undefined) continue;
      const [color, alpha] = Array.isArray(spec) ? spec : [spec, 1];
      g.fillStyle(color, alpha);
      g.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  });
}

const DROP = [
  "....#....",
  "...###...",
  "...###...",
  "..#####..",
  ".#######.",
  ".#######.",
  "#########",
  "#########",
  "#########",
  ".#######.",
  "..#####..",
];
export const DROP_W = DROP[0].length;
export const DROP_H = DROP.length;

// A droplet that fills from the bottom: the forest pets' water meter.
// level is 0..1, or null for "unknown" (drawn empty).
export function drawDroplet(g, x, y, level, o = {}) {
  const outline = o.outline ?? 0xcfe6ff;
  const fill = o.fill ?? HUD.water;
  const empty = o.empty ?? HUD.waterEmpty;
  const at = (r, c) => DROP[r] && DROP[r][c] === "#";
  // inner pixels are the shape shrunk by one
  let top = DROP_H, bottom = -1;
  for (let r = 0; r < DROP_H; r++) {
    for (let c = 0; c < DROP_W; c++) {
      if (at(r, c) && at(r - 1, c) && at(r + 1, c) && at(r, c - 1) && at(r, c + 1)) {
        top = Math.min(top, r); bottom = Math.max(bottom, r);
      }
    }
  }
  const rows = bottom - top + 1;
  const filledRows = level == null ? 0 : Math.round(Math.max(0, Math.min(1, level)) * rows);
  const fillFrom = bottom + 1 - filledRows;
  x = Math.round(x); y = Math.round(y);
  for (let r = 0; r < DROP_H; r++) {
    for (let c = 0; c < DROP_W; c++) {
      if (!at(r, c)) continue;
      const inner = at(r - 1, c) && at(r + 1, c) && at(r, c - 1) && at(r, c + 1);
      let color = outline;
      if (inner) color = r >= fillFrom ? fill : empty;
      g.fillStyle(color, 1);
      g.fillRect(x + c, y + r, 1, 1);
    }
  }
  // a glint, only on water
  if (filledRows > 0 && fillFrom <= 6) {
    g.fillStyle(0xffffff, 0.85);
    g.fillRect(x + 2, y + 6, 1, 2);
  }
}

// Glyphs drawn on the font's own grid: 16 px Tiny5 has 2 x 2 screen pixels per font pixel and
// capitals 5 font pixels tall, so these are 5 rows drawn at GLYPH_SCALE.
export const GLYPH_SCALE = 2;

// "▶" for the summon button.
export const PLAY = ["#..", "##.", "###", "##.", "#.."];

// "→" for captions.
export const ARROW = [
  "...#..",
  "...##.",
  "######",
  "...##.",
  "...#..",
];

// A small speaker, sound on (w = waves) or off (x = cross).
export const SPEAKER_ON = [
  "...#.......",
  "..##....w..",
  "####.w...w.",
  "####..w..w.",
  "####..w..w.",
  "####..w..w.",
  "####.w...w.",
  "..##....w..",
  "...#.......",
];
export const SPEAKER_OFF = [
  "...#.......",
  "..##.......",
  "####.x...x.",
  "####..x.x..",
  "####...x...",
  "####..x.x..",
  "####.x...x.",
  "..##.......",
  "...#.......",
];

// The little tail under a pet tag, pointing down at the plant.
export const TAIL = ["#####", ".###.", "..#.."];
