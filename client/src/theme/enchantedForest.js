// Enchanted forest look for the adventure map, in the style of the Knight Hacks 2026 theme:
// hanging wisteria, lilac canopies, a deep teal and indigo forest, glowing runes, crystals,
// glowing mushrooms, fireflies, mossy ground and a lily pond.
//
// Everything is painted in code. Nothing is copied from the Knight Hacks site.
//
// paintEnchantedForest(scene)  replaces the textures the scene uses for its layers (same keys).
//                              Call it right after the scene has created its own textures.
// addForestAmbience(scene)     adds fireflies, drifting petals, light shafts and a vignette.
//                              Call it at the end of create().
import Phaser from "phaser";

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- palettes

const WISTERIA = ["#3a2790", "#5538bb", "#7653dc", "#9877ee", "#bb9df7", "#dcc0fb"];
const WISTERIA_DIM = ["#2a2470", "#3d3396", "#5347b4", "#6c5fcb", "#8a7fdd"];
const LILAC = ["#40458f", "#6172c2", "#8b90e6", "#ae9cf3", "#cfa7f7", "#eec4fb"];
const TEAL = ["#0b2530", "#10393d", "#175048", "#216a57", "#348a64"];
const MOSS = ["#11331f", "#1b4d30", "#2a6f3e", "#479748", "#80c651", "#c0e862"];
const SAGE = ["#274435", "#375a44", "#4f7557", "#779674"];
const BARK = ["#2a1630", "#4d2b42", "#7d4c58"];
const BARK_WARM = ["#2c1728", "#5a3140", "#8f5d57"];
const STONE = ["#3b2e3c", "#584551", "#765d66", "#93767b"];

// ---------------------------------------------------------------- small tools

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tools(ctx, seed) {
  const r = makeRng(seed);
  return {
    ctx,
    r,
    rand: (a, b) => a + (b - a) * r(),
    int: (a, b) => Math.floor(a + (b - a + 1) * r()),
    pick: (list) => list[Math.floor(r() * list.length)],
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d") };
}

// Paints the same thing three times, shifted by one tile width, so the left and right edges match.
function tiled(ctx, width, seed, paint) {
  for (const dx of [-width, 0, width]) {
    ctx.save();
    ctx.translate(dx, 0);
    paint(tools(ctx, seed));
    ctx.restore();
  }
}

// A soft-edged irregular patch of flat colour, like one brush dab.
function blob(t, x, y, rx, ry, color, rough = 0.28, n = 8) {
  const { ctx, r } = t;
  const pts = [];
  const a0 = r() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    const k = 1 + (r() - 0.5) * 2 * rough;
    pts.push([x + Math.cos(a) * rx * k, y + Math.sin(a) * ry * k]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const e = mid(p, pts[(i + 1) % n]);
    ctx.quadraticCurveTo(p[0], p[1], e[0], e[1]);
  }
  ctx.fill();
}

function glow(ctx, x, y, radius, rgb, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.4, `rgba(${rgb},${alpha * 0.4})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

// One leaf-shaped brush mark.
function leafDab(t, x, y, length, color) {
  const { ctx } = t;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, length, length * t.rand(0.36, 0.6), t.rand(0, Math.PI), 0, TAU);
  ctx.fill();
}

// A clump of leaves, painted the way the reference art is: a dark ragged mass, then flat
// irregular patches of lighter colour, each breaking up into small leaf marks at its edge,
// all leaning toward the light (upper left).
function foliage(t, cx, cy, rx, ry, tones, density = 1, light = [-0.22, -0.34]) {
  const levels = tones.length;
  const leaf = Math.max(1.5, Math.min(rx, ry) * 0.14);

  // dark mass
  const massCount = Math.max(3, Math.round(7 * density));
  for (let i = 0; i < massCount; i++) {
    const a = t.r() * TAU;
    const d = Math.sqrt(t.r()) * 0.55;
    blob(t, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, rx * 0.52, ry * 0.52, tones[0], 0.4, 10);
  }
  // ragged rim of leaves
  const rim = Math.round(64 * density);
  for (let i = 0; i < rim; i++) {
    const a = t.r() * TAU;
    const d = t.rand(0.72, 1.08);
    leafDab(t, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, leaf * t.rand(0.8, 1.5), tones[t.r() < 0.7 ? 0 : Math.min(1, levels - 1)]);
  }

  for (let level = 1; level < levels; level++) {
    const f = level / (levels - 1); // 0 dark .. 1 lightest
    const reach = 0.86 - f * 0.4;
    const ox = light[0] * rx * f * 0.95;
    const oy = light[1] * ry * f * 0.95;

    // flat patches
    const patches = Math.max(1, Math.round((5 - 3.2 * f) * density));
    const centers = [];
    for (let i = 0; i < patches; i++) {
      const a = t.r() * TAU;
      const d = Math.sqrt(t.r()) * reach * 0.8;
      const px = cx + Math.cos(a) * rx * d + ox;
      const py = cy + Math.sin(a) * ry * d + oy;
      const size = (0.34 - f * 0.2) * t.rand(0.7, 1.15);
      blob(t, px, py, rx * size, ry * size, tones[level], 0.5, 11);
      centers.push([px, py, size]);
    }
    // leaf marks scattered around the patches
    const dabs = Math.round((44 - 20 * f) * density);
    for (let i = 0; i < dabs; i++) {
      const [px, py, size] = centers[Math.floor(t.r() * centers.length)];
      const a = t.r() * TAU;
      const d = t.rand(0.5, 1.9) * size;
      leafDab(t, px + Math.cos(a) * rx * d, py + Math.sin(a) * ry * d, leaf * t.rand(0.7, 1.3) * (1 - f * 0.25), tones[level]);
    }
  }

  // a few dark gaps so the mass has depth
  const gaps = Math.round(9 * density);
  for (let i = 0; i < gaps; i++) {
    const a = t.r() * TAU;
    const d = Math.sqrt(t.r()) * 0.7;
    leafDab(t, cx + Math.cos(a) * rx * d - light[0] * rx * 0.2, cy + Math.sin(a) * ry * d - light[1] * ry * 0.3, leaf * t.rand(0.8, 1.4), tones[0]);
  }
}

// One hanging wisteria cluster: wide near the top, tapering to a point, lighter on the left.
function raceme(t, x, y, length, width, tones, sway = 0, pinkTips = tones === WISTERIA) {
  const { ctx } = t;
  ctx.strokeStyle = "rgba(38,58,48,0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + sway * 0.4, y + length * 0.5, x + sway, y + length * 0.9);
  ctx.stroke();

  const count = Math.max(6, Math.floor(length / 2.4));
  const top = tones.length - 1;
  for (let i = 0; i < count; i++) {
    const k = i / (count - 1);
    const px = x + sway * k * k;
    const w = width * (1 - k * 0.82) * (0.5 + 0.5 * Math.min(1, k * 5));
    for (let j = 0; j < 3; j++) {
      const ox = (t.r() - 0.5) * 2 * w;
      const lit = 0.5 - ox / (2 * w + 0.001); // 1 on the left edge, 0 on the right
      const index = Math.round(lit * top * 0.85 + t.rand(-1, 1) + k * 0.8);
      const tone = tones[Math.max(0, Math.min(top, index))];
      const size = t.rand(1.5, 2.9) * (1 - k * 0.45) * (width / 7);
      const py = y + k * length + t.rand(-1.5, 1.5);
      blob(t, px + ox, py, size, size * 1.25, tone, 0.3, 6);
      // now and then a pink glint on the lit side
      if (pinkTips && lit > 0.6 && t.r() < 0.12) {
        blob(t, px + ox - size * 0.3, py - size * 0.3, size * 0.55, size * 0.7, "#f4c2f7", 0.3, 6);
      }
    }
  }
}

// A tapered, slightly twisting trunk with a lit left side and a flare at the roots.
function trunk(t, x, baseY, topY, wBase, wTop, cols, lean = 0, wobble = 6) {
  const { ctx } = t;
  const phase = t.r() * TAU;
  const steps = 26;
  const center = (s) => x + lean * s + Math.sin(s * 3.2 + phase) * wobble * s;
  const width = (s) =>
    wTop + (wBase - wTop) * Math.pow(1 - s, 1.6) + (s < 0.14 ? (0.14 - s) * wBase * 3 : 0);
  const band = (k0, k1, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      ctx.lineTo(center(s) + width(s) * k0, baseY + (topY - baseY) * s);
    }
    for (let i = steps; i >= 0; i--) {
      const s = i / steps;
      ctx.lineTo(center(s) + width(s) * k1, baseY + (topY - baseY) * s);
    }
    ctx.closePath();
    ctx.fill();
  };
  band(-0.5, 0.5, cols[0]);
  band(-0.5, 0.12, cols[1]);
  band(-0.4, -0.14, cols[2]);

  // bark lines
  ctx.strokeStyle = cols[0];
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(1, wBase * 0.05);
  for (let i = 0; i < 4; i++) {
    const k = t.rand(-0.3, 0.3);
    const s0 = t.rand(0.05, 0.5);
    const s1 = s0 + t.rand(0.15, 0.4);
    ctx.beginPath();
    for (let j = 0; j <= 8; j++) {
      const s = s0 + ((s1 - s0) * j) / 8;
      ctx.lineTo(center(s) + width(s) * (k + Math.sin(j) * 0.04), baseY + (topY - baseY) * s);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return { center, width };
}

function branch(ctx, x0, y0, x1, y1, w, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.25, y0 + (y1 - y0) * 0.85, x1, y1);
  ctx.stroke();
}

function grassBlade(t, x, y, height, lean, color, w = 1.6) {
  const { ctx } = t;
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * 0.2, y - height * 0.6, x + lean, y - height);
  ctx.stroke();
}

function fern(t, x, y, size, tones) {
  const fronds = t.int(4, 6);
  for (let i = 0; i < fronds; i++) {
    const lean = ((i / (fronds - 1)) * 2 - 1) * size * 0.9 + t.rand(-3, 3);
    const h = size * t.rand(0.7, 1.05) * (1 - Math.abs(lean) / (size * 2.2));
    grassBlade(t, x, y, h, lean, tones[1], 1.4);
    for (let j = 1; j <= 5; j++) {
      const k = j / 6;
      const px = x + lean * k * k * 0.9 + lean * k * 0.1;
      const py = y - h * k;
      blob(t, px, py, size * 0.11 * (1.2 - k), size * 0.06, tones[t.int(2, tones.length - 1)], 0.3, 5);
    }
  }
}

function flowerDot(t, x, y, size, petal, heart) {
  const { ctx } = t;
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * size * 0.6, y + Math.sin(a) * size * 0.6, size * 0.55, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(x, y, size * 0.42, 0, TAU);
  ctx.fill();
}

function mushroom(t, x, y, height, capW, glowRGB = "90,235,255", glowScale = 2.1) {
  const { ctx } = t;
  if (glowScale > 0) glow(ctx, x, y - height, capW * glowScale, glowRGB, 0.4);
  // stem
  ctx.strokeStyle = "#bdf3fb";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.6, capW * 0.2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + capW * 0.18, y - height * 0.5, x, y - height + 1);
  ctx.stroke();
  ctx.strokeStyle = "#5fc7dc";
  ctx.lineWidth = Math.max(0.8, capW * 0.07);
  ctx.beginPath();
  ctx.moveTo(x + capW * 0.06, y - 1);
  ctx.quadraticCurveTo(x + capW * 0.24, y - height * 0.5, x + capW * 0.06, y - height + 2);
  ctx.stroke();
  // cap: underside, dome, highlight
  ctx.fillStyle = "#1c93b6";
  ctx.beginPath();
  ctx.ellipse(x, y - height + 1, capW * 0.5, capW * 0.16, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#3fd0ea";
  ctx.beginPath();
  ctx.ellipse(x, y - height + 1, capW * 0.5, capW * 0.42, 0, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = "#9ff3ff";
  ctx.beginPath();
  ctx.ellipse(x - capW * 0.12, y - height - capW * 0.12, capW * 0.26, capW * 0.2, -0.3, Math.PI, TAU);
  ctx.fill();
  ctx.fillStyle = "#e9feff";
  ctx.beginPath();
  ctx.ellipse(x - capW * 0.18, y - height - capW * 0.22, capW * 0.09, capW * 0.06, -0.4, 0, TAU);
  ctx.fill();
}

function crystal(t, x, y, height, w, cols, glowRGB, glowScale = 1.2) {
  const { ctx } = t;
  if (glowScale > 0) glow(ctx, x, y - height * 0.5, height * glowScale, glowRGB, 0.34);
  const tip = [x + w * 0.05, y - height];
  ctx.fillStyle = cols[1];
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, y);
  ctx.lineTo(x - w * 0.38, y - height * 0.68);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(x + w * 0.42, y - height * 0.6);
  ctx.lineTo(x + w * 0.5, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = cols[2]; // lit left facet
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, y);
  ctx.lineTo(x - w * 0.38, y - height * 0.68);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(x - w * 0.06, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = cols[0]; // shaded right facet
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.42, y - height * 0.6);
  ctx.lineTo(tip[0], tip[1]);
  ctx.lineTo(x + w * 0.2, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.3, y - height * 0.62);
  ctx.lineTo(tip[0] - w * 0.02, tip[1] + height * 0.06);
  ctx.stroke();
}

const CRYSTAL_PINK = ["#a23fc4", "#e36bea", "#ffc0f6"];
const CRYSTAL_VIOLET = ["#5a3fc8", "#9272f2", "#d6c4ff"];
const CRYSTAL_CYAN = ["#1c8fb8", "#4fd6ee", "#c8fbff"];

function crystalCluster(t, x, y, size, kind) {
  const cols = kind === 0 ? CRYSTAL_PINK : kind === 1 ? CRYSTAL_VIOLET : CRYSTAL_CYAN;
  const rgb = kind === 0 ? "255,130,235" : kind === 1 ? "160,130,255" : "110,235,255";
  crystal(t, x - size * 0.42, y, size * 0.6, size * 0.26, cols, rgb);
  crystal(t, x + size * 0.4, y, size * 0.7, size * 0.3, cols, rgb);
  crystal(t, x, y, size, size * 0.38, cols, rgb);
}

// ---------------------------------------------------------------- the layers

// Deep forest interior with a glowing clearing, light shafts and a dark canopy fringe along the top.
function paintSky() {
  const W = 800;
  const H = 450;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, 11);

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0d0a28");
  g.addColorStop(0.22, "#16184a");
  g.addColorStop(0.45, "#193262");
  g.addColorStop(0.66, "#1c586a");
  g.addColorStop(0.86, "#2c7f73");
  g.addColorStop(1, "#398c76");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // the clearing: light coming through the trees
  glow(ctx, 560, 215, 380, "185,245,225", 0.55);
  glow(ctx, 560, 215, 160, "236,255,242", 0.5);
  glow(ctx, 150, 175, 270, "150,128,255", 0.3);
  glow(ctx, 330, 265, 250, "90,220,220", 0.2);

  // very distant trunks, soft and faint
  for (let i = 0; i < 18; i++) {
    const x = t.rand(-10, W);
    const w = t.rand(10, 34);
    const a = t.rand(0.1, 0.24);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = `rgba(16,22,64,${a})`;
      ctx.fillRect(x - k * 2, 0, w + k * 4, H);
    }
  }

  // light shafts from the upper right
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 8; i++) {
    const x0 = t.rand(360, 930);
    const w = t.rand(16, 62);
    const reach = t.rand(0.62, 0.9) * H;
    const shaft = ctx.createLinearGradient(x0, 0, x0 - 250, reach);
    shaft.addColorStop(0, `rgba(205,236,255,${t.rand(0.07, 0.13)})`);
    shaft.addColorStop(1, "rgba(205,236,255,0)");
    ctx.fillStyle = shaft;
    ctx.beginPath();
    ctx.moveTo(x0, -10);
    ctx.lineTo(x0 + w, -10);
    ctx.lineTo(x0 + w - 250, reach);
    ctx.lineTo(x0 - 250 - w * 0.7, reach);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // floating light specks
  for (let i = 0; i < 80; i++) {
    const rgb = t.pick(["255,246,200", "190,255,240", "205,190,255"]);
    glow(ctx, t.rand(0, W), t.rand(40, 330), t.rand(2, 7), rgb, t.rand(0.12, 0.4));
  }

  // dark canopy along the top, with a few lilac edges
  const canopyDark = ["#090b24", "#0e1436", "#13204c", "#19305e"];
  for (let i = 0; i < 26; i++) {
    foliage(t, i * 33 + t.rand(-12, 12), t.rand(-8, 22), t.rand(34, 58), t.rand(20, 34), canopyDark, 0.8);
  }
  for (let i = 0; i < 12; i++) {
    foliage(t, t.rand(0, W), t.rand(20, 44), t.rand(16, 30), t.rand(9, 15), ["#2f2a7e", "#4a40a8", "#6c5fcc"], 0.5);
  }

  // distant wisteria hanging from the canopy
  for (let i = 0; i < 26; i++) {
    raceme(t, t.rand(0, W), t.rand(18, 46), t.rand(34, 96), t.rand(4, 7), WISTERIA_DIM, t.rand(-6, 6));
  }
  return canvas;
}

// A drape of wisteria on a vine. These replace the clouds and drift slowly across the top.
function paintDrape(width, height, seed) {
  const { canvas, ctx } = makeCanvas(width, height);
  const t = tools(ctx, seed);

  glow(ctx, width / 2, height * 0.4, width * 0.5, "170,130,255", 0.2);

  // vine
  const sag = t.rand(8, 16);
  ctx.strokeStyle = "#2c2a3a";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(4, 10);
  ctx.quadraticCurveTo(width / 2, 10 + sag * 2, width - 4, 12);
  ctx.stroke();
  const vineY = (x) => {
    const k = x / width;
    return 10 + sag * 2 * 2 * k * (1 - k) + 2 * k;
  };

  // back row first (dimmer, shorter), then the front row
  const backCount = Math.round(width / 15);
  for (let i = 0; i < backCount; i++) {
    const x = 10 + ((width - 20) * (i + t.rand(0.1, 0.9))) / backCount;
    const mid = 1 - Math.abs(x / width - 0.5) * 1.1;
    raceme(t, x, vineY(x), height * t.rand(0.3, 0.62) * (0.55 + mid * 0.45), t.rand(5, 8), WISTERIA_DIM, t.rand(-7, 7));
  }
  const frontCount = Math.round(width / 12);
  for (let i = 0; i < frontCount; i++) {
    const x = 9 + ((width - 18) * (i + t.rand(0.1, 0.9))) / frontCount;
    const mid = 1 - Math.abs(x / width - 0.5) * 1.2;
    raceme(t, x, vineY(x) + 2, (height - 34) * t.rand(0.5, 1) * (0.5 + mid * 0.5), t.rand(6.5, 10), WISTERIA, t.rand(-9, 9));
  }

  // leaves along the vine
  const leafTones = ["#0f2c2a", "#164436", "#226042", "#3a8049"];
  for (let i = 0; i < width / 16; i++) {
    const x = 6 + t.rand(0, width - 12);
    foliage(t, x, vineY(x) - 1, t.rand(9, 15), t.rand(5, 9), leafTones, 0.45);
  }
  return canvas;
}

// Far layer: tall hazy trees in the mist.
function paintFarTrees() {
  const W = 1024;
  const H = 260;
  const { canvas, ctx } = makeCanvas(W, H);
  const trunkCols = ["rgba(14,32,74,0.82)", "rgba(22,52,98,0.82)", "rgba(40,84,128,0.62)"];
  const canopy = ["rgba(18,42,86,0.88)", "rgba(26,64,112,0.88)", "rgba(40,92,136,0.85)", "rgba(64,124,158,0.8)", "rgba(104,166,184,0.72)"];

  tiled(ctx, W, 21, (t) => {
    for (let i = 0; i < 13; i++) {
      const x = i * 79 + t.rand(-18, 18) + 30;
      const top = t.rand(58, 108);
      const tr = trunk(t, x, H + 4, top, t.rand(14, 30), 5, trunkCols, t.rand(-16, 16), 6);
      const cx = tr.center(1);
      foliage(t, cx, top - 6, t.rand(46, 74), t.rand(26, 42), canopy, 0.9);
      foliage(t, cx + t.rand(-44, 44), top + t.rand(4, 22), t.rand(30, 48), t.rand(18, 28), canopy, 0.6);
    }
  });

  // ground mist
  const mist = ctx.createLinearGradient(0, H * 0.45, 0, H);
  mist.addColorStop(0, "rgba(130,215,205,0)");
  mist.addColorStop(1, "rgba(130,215,205,0.3)");
  ctx.fillStyle = mist;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
  return canvas;
}

// Middle layer: the big lilac trees. Each has its own umbrella crown, with gaps between
// the trees so the glowing clearing shows through.
function paintMidTrees() {
  const W = 1024;
  const H = 260;
  const { canvas, ctx } = makeCanvas(W, H);

  tiled(ctx, W, 33, (t) => {
    // dark shrubs along the bottom, behind the trunks
    for (let i = 0; i < 16; i++) {
      foliage(t, i * 64 + t.rand(-14, 14), t.rand(214, 236), t.rand(40, 62), t.rand(20, 30), ["#0c2334", "#123343", "#1a4a52", "#25625e"], 0.7);
    }

    const count = 5;
    for (let i = 0; i < count; i++) {
      const x = i * (W / count) + t.rand(-22, 22) + 90;
      const tall = i % 2 === 0;
      const top = tall ? t.rand(84, 100) : t.rand(112, 132);
      const lean = t.rand(-20, 20);
      const tr = trunk(t, x, H + 4, top, t.rand(28, 40), 10, BARK, lean, 7);
      const cx = tr.center(1);
      const yAt = (s) => H + 4 + (top - H - 4) * s;

      // limbs fanning out into the crown
      const limbs = [];
      const limbCount = t.int(4, 5);
      for (let k = 0; k < limbCount; k++) {
        const side = (k / (limbCount - 1)) * 2 - 1; // -1 left .. 1 right
        const lx = cx + side * t.rand(58, 76);
        const ly = top - t.rand(30, 52) + Math.abs(side) * t.rand(14, 26);
        const from = t.rand(0.6, 0.92);
        branch(ctx, tr.center(from), yAt(from), lx, ly + 8, t.rand(4.5, 7.5), k % 2 ? BARK[0] : BARK[1]);
        limbs.push([lx, ly, side]);
      }

      glow(ctx, cx, top - 30, 130, "190,150,255", 0.13);

      // hanging blossoms behind the crown
      for (let k = 0; k < 7; k++) {
        raceme(t, cx + t.rand(-84, 84), top - t.rand(6, 26), t.rand(24, 62), t.rand(4.5, 6.5), WISTERIA_DIM, t.rand(-5, 5));
      }

      // crown: outer clumps first, then the centre on top
      limbs.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
      for (const [lx, ly, side] of limbs) {
        const edge = Math.abs(side);
        foliage(t, lx, ly, t.rand(40, 54) - edge * 6, t.rand(24, 32) - edge * 4, LILAC, 0.95);
      }
      foliage(t, cx + t.rand(-8, 8), top - t.rand(46, 58), t.rand(48, 60), t.rand(26, 34), LILAC, 1.05);

      // short wisteria in front
      for (let k = 0; k < 6; k++) {
        raceme(t, cx + t.rand(-78, 78), top - t.rand(2, 22), t.rand(20, 46), t.rand(4.5, 7), WISTERIA, t.rand(-5, 5));
      }
    }
  });
  return canvas;
}

// The dark shrubs behind the lilac trees. Used when the trees themselves are separate, moving parts.
function paintMidShrubs() {
  const W = 1024;
  const H = 260;
  const { canvas, ctx } = makeCanvas(W, H);
  tiled(ctx, W, 33, (t) => {
    for (let i = 0; i < 16; i++) {
      foliage(t, i * 64 + t.rand(-14, 14), t.rand(214, 236), t.rand(40, 62), t.rand(20, 30), ["#0c2334", "#123343", "#1a4a52", "#25625e"], 0.7);
    }
  });
  return canvas;
}

// Undergrowth: dark teal bushes with crystals and glowing mushrooms.
function paintUndergrowth() {
  const W = 1024;
  const H = 190;
  const { canvas, ctx } = makeCanvas(W, H);

  ctx.fillStyle = TEAL[0];
  ctx.fillRect(0, 104, W, H - 104);

  tiled(ctx, W, 47, (t) => {
    for (let i = 0; i < 17; i++) {
      foliage(t, i * 61 + t.rand(-16, 16), t.rand(78, 108), t.rand(44, 70), t.rand(26, 42), TEAL, 1);
    }
    // ferns and blades poking out of the top
    for (let i = 0; i < 26; i++) {
      fern(t, t.rand(0, W), t.rand(70, 94), t.rand(14, 24), ["#0f3a3a", "#1b5a4c", "#2a7a5c", "#48a070"]);
    }
    // crystals
    for (let i = 0; i < 8; i++) {
      crystalCluster(t, i * 128 + t.rand(10, 100), t.rand(84, 108), t.rand(22, 36), i % 3);
    }
    // glowing mushrooms
    for (let i = 0; i < 10; i++) {
      const x = i * 102 + t.rand(0, 80);
      const y = t.rand(88, 110);
      mushroom(t, x, y, t.rand(14, 24), t.rand(13, 21));
      mushroom(t, x + t.rand(9, 15), y + 2, t.rand(7, 12), t.rand(8, 12));
    }
    // leaves in front of the bases so nothing floats
    for (let i = 0; i < 20; i++) {
      foliage(t, t.rand(0, W), t.rand(110, 124), t.rand(26, 44), t.rand(10, 16), TEAL.slice(1), 0.5);
    }
    for (let i = 0; i < 40; i++) {
      glow(t.ctx, t.rand(0, W), t.rand(56, 116), t.rand(2, 5), t.pick(["255,240,170", "150,245,255", "215,170,255"]), t.rand(0.25, 0.6));
    }
  });
  return canvas;
}

// Foreground hedge: bright mossy mounds with flowers.
function paintHedge() {
  const W = 1024;
  const H = 160;
  const { canvas, ctx } = makeCanvas(W, H);

  ctx.fillStyle = MOSS[1];
  ctx.fillRect(0, 88, W, H - 88);

  tiled(ctx, W, 59, (t) => {
    // back row, darker
    for (let i = 0; i < 15; i++) {
      foliage(t, i * 69 + t.rand(-16, 16), t.rand(70, 84), t.rand(44, 66), t.rand(20, 30), MOSS.slice(0, 4), 0.8);
    }
    // tall purple flower spikes
    for (let i = 0; i < 12; i++) {
      const x = t.rand(0, W);
      const y = t.rand(72, 88);
      const h = t.rand(22, 38);
      grassBlade(t, x, y, h, t.rand(-4, 4), "#2a6f3e", 1.6);
      for (let k = 0; k < 7; k++) {
        const f = k / 6;
        blob(t, x + t.rand(-1.5, 1.5), y - h * (0.4 + f * 0.6), 3.2 - f * 1.8, 2.8 - f * 1.4, t.pick(["#8d63e8", "#b48cf5", "#d7b4fb"]), 0.3, 6);
      }
    }
    // front row, bright
    for (let i = 0; i < 14; i++) {
      foliage(t, i * 73 + t.rand(-18, 18) + 20, t.rand(84, 100), t.rand(48, 72), t.rand(20, 30), MOSS, 1);
    }
    // grass blades along the top edge
    for (let i = 0; i < 150; i++) {
      grassBlade(t, t.rand(0, W), t.rand(66, 92), t.rand(6, 15), t.rand(-5, 5), t.pick(["#479748", "#80c651", "#c0e862", "#2a6f3e"]), 1.3);
    }
    // flowers
    for (let i = 0; i < 110; i++) {
      const petal = t.pick(["#ff8ecf", "#fff3fb", "#c59bff", "#ffe27a", "#ffb3e6"]);
      flowerDot(t, t.rand(0, W), t.rand(72, 106), t.rand(1.6, 2.8), petal, petal === "#ffe27a" ? "#fff8d0" : "#fff2a0");
    }
  });
  return canvas;
}

// Ground: grass verge, a purple-earth path with stepping stones and fallen petals, then a lily pond.
function paintGround() {
  const W = 1024;
  const H = 130;
  const { canvas, ctx } = makeCanvas(W, H);
  const wave = (x, k, amp, phase = 0) => Math.sin((x / W) * TAU * k + phase) * amp;
  const vergeEdge = (x) => 31 + wave(x, 3, 3) + wave(x, 7, 1.6, 1.3);
  const pondEdge = (x) => 92 + wave(x, 2, 4, 0.7) + wave(x, 5, 2.2, 2.1);
  // The top of the ground is not a straight line: the first rows are see-through and grass
  // grows up into them, so the hedge behind shows between the blades.
  const topEdge = (x) => 12 + wave(x, 5, 2.2) + wave(x, 11, 1.3, 0.6);

  // path
  const earth = ctx.createLinearGradient(0, 24, 0, 100);
  earth.addColorStop(0, "#3d2d50");
  earth.addColorStop(1, "#2f2242");
  ctx.fillStyle = earth;
  ctx.fillRect(0, 22, W, H - 22);

  tiled(ctx, W, 71, (t) => {
    for (let i = 0; i < 170; i++) {
      blob(t, t.rand(0, W), t.rand(30, 96), t.rand(8, 24), t.rand(2.5, 6), t.pick(["#2a1f3c", "#44335c", "#4f3d68", "#35284a"]), 0.4, 7);
    }
    // stepping stones
    for (let i = 0; i < 11; i++) {
      const x = i * 93 + t.rand(0, 40) + 20;
      const y = t.rand(52, 76);
      const rx = t.rand(18, 28);
      const ry = t.rand(5, 8);
      blob(t, x + 2, y + 3, rx, ry, "#221833", 0.18, 9);
      blob(t, x, y, rx, ry, "#6b5b88", 0.18, 9);
      blob(t, x - rx * 0.15, y - ry * 0.3, rx * 0.72, ry * 0.55, "#8a7aa6", 0.2, 8);
      blob(t, x - rx * 0.3, y - ry * 0.5, rx * 0.3, ry * 0.22, "#a99ac2", 0.25, 6);
    }
    // small pebbles
    for (let i = 0; i < 60; i++) {
      const x = t.rand(0, W);
      const y = t.rand(36, 92);
      blob(t, x, y + 1, 2.6, 1.5, "#221833", 0.2, 6);
      blob(t, x, y, 2.4, 1.4, t.pick(["#7c6c98", "#9486ae", "#5d4e78"]), 0.2, 6);
    }
    // fallen wisteria petals
    for (let i = 0; i < 230; i++) {
      const x = t.rand(0, W);
      const y = t.rand(32, 94);
      ctx.fillStyle = t.pick(["#b99cf7", "#dcc0fb", "#9877ee", "#f1b4f4", "#ffffff"]);
      ctx.globalAlpha = t.rand(0.55, 0.95);
      ctx.beginPath();
      ctx.ellipse(x, y, t.rand(1.2, 2.4), t.rand(0.6, 1.1), t.rand(0, Math.PI), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // grass verge along the top
  const verge = ctx.createLinearGradient(0, 8, 0, 36);
  verge.addColorStop(0, "#56a84a");
  verge.addColorStop(1, "#236338");
  ctx.fillStyle = verge;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, topEdge(x));
  for (let x = W; x >= 0; x -= 4) ctx.lineTo(x, vergeEdge(x));
  ctx.closePath();
  ctx.fill();

  tiled(ctx, W, 83, (t) => {
    for (let i = 0; i < 210; i++) {
      const x = t.rand(0, W);
      blob(t, x, t.rand(topEdge(x) + 4, vergeEdge(x) - 2), t.rand(5, 14), t.rand(2, 4.5), t.pick(["#2a6f3e", "#479748", "#80c651", "#1b4d30", "#63b24c"]), 0.4, 7);
    }
    // shadow under the verge lip, then the lip of grass hanging over the path
    for (let i = 0; i < 260; i++) {
      const x = t.rand(0, W);
      grassBlade(t, x, vergeEdge(x) + t.rand(-2, 1), t.rand(4, 9), t.rand(-4, 4), "#1b4d30", 1.6);
    }
    for (let i = 0; i < 300; i++) {
      const x = t.rand(0, W);
      grassBlade(t, x, vergeEdge(x) + t.rand(0, 4), -t.rand(3, 8), t.rand(-3, 3), t.pick(["#2a6f3e", "#479748", "#80c651"]), 1.4);
    }
    // tufts along the very top
    for (let i = 0; i < 420; i++) {
      const x = t.rand(0, W);
      grassBlade(t, x, topEdge(x) + t.rand(0, 6), t.rand(6, 15), t.rand(-5, 5), t.pick(["#80c651", "#c0e862", "#479748", "#2a6f3e", "#63b24c"]), 1.5);
    }
    for (let i = 0; i < 70; i++) {
      const x = t.rand(0, W);
      const petal = t.pick(["#fff3fb", "#ff8ecf", "#c59bff", "#ffe27a"]);
      flowerDot(t, x, t.rand(topEdge(x) + 3, vergeEdge(x) - 4), t.rand(1.5, 2.6), petal, "#fff2a0");
    }
  });

  // pond
  const water = ctx.createLinearGradient(0, 86, 0, H);
  water.addColorStop(0, "#b4ecd9");
  water.addColorStop(0.45, "#74cdc0");
  water.addColorStop(1, "#3b93a2");
  ctx.fillStyle = water;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, pondEdge(x));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // bank: dark lip with a bright mossy edge
  for (const [width, color, dy] of [[5, "#1b2f33", 0], [2.2, "#80c651", -2.6]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, pondEdge(x) + dy);
    ctx.stroke();
  }

  tiled(ctx, W, 97, (t) => {
    // reflections and ripples
    for (let i = 0; i < 34; i++) {
      const x = t.rand(0, W);
      const y = t.rand(100, 128);
      ctx.strokeStyle = `rgba(255,255,255,${t.rand(0.22, 0.5)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - t.rand(6, 18), y);
      ctx.lineTo(x + t.rand(6, 18), y);
      ctx.stroke();
    }
    for (let i = 0; i < 10; i++) {
      glow(t.ctx, t.rand(0, W), t.rand(100, 126), t.rand(10, 22), "200,255,240", 0.3);
    }
    // lily pads
    for (let i = 0; i < 15; i++) {
      const x = i * 68 + t.rand(0, 44);
      const y = t.rand(104, 126);
      const rx = t.rand(9, 16);
      const cut = t.rand(0, TAU);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1, 0.42);
      for (const [radius, color] of [[rx + 1.5, "#1f5f4a"], [rx, "#3f9a5a"], [rx * 0.62, "#6fc46a"]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius, cut, cut + TAU - 0.55);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      if (i % 3 === 0) {
        // lotus on the pad
        for (let k = 0; k < 5; k++) {
          const a = -Math.PI * (0.15 + 0.7 * (k / 4));
          blob(t, x + Math.cos(a) * 3.4, y - 2 + Math.sin(a) * 3.2, 2.2, 3.2, k % 2 ? "#ff7fa6" : "#ffc2d6", 0.2, 6);
        }
        blob(t, x, y - 2, 1.5, 1.3, "#ffe680", 0.2, 6);
      }
    }
    // reeds on the bank
    for (let i = 0; i < 16; i++) {
      const x = t.rand(0, W);
      const base = pondEdge(x) + 2;
      for (let k = 0; k < 5; k++) {
        grassBlade(t, x + t.rand(-6, 6), base, t.rand(12, 26), t.rand(-6, 6), t.pick(["#2a6f3e", "#479748", "#1b4d30", "#80c651"]), 1.5);
      }
    }
  });
  return canvas;
}

// ---------------------------------------------------------------- objects along the path

// A wisteria tree with long hanging blossoms.
function paintTree(seed = 101) {
  const W = 128;
  const H = 176;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);

  glow(ctx, W / 2, 58, 74, "190,150,255", 0.2);
  const tr = trunk(t, W / 2 + 2, H, 76, 24, 8, BARK_WARM, -8, 6);
  // roots
  branch(ctx, W / 2 - 8, H - 10, W / 2 - 26, H - 1, 6, BARK_WARM[1]);
  branch(ctx, W / 2 + 10, H - 10, W / 2 + 28, H - 1, 6, BARK_WARM[0]);
  const cx = tr.center(1);
  branch(ctx, tr.center(0.7), H + (76 - H) * 0.7, cx - 34, 56, 6, BARK_WARM[1]);
  branch(ctx, tr.center(0.8), H + (76 - H) * 0.8, cx + 36, 52, 6, BARK_WARM[0]);

  // moss on the trunk
  for (let i = 0; i < 14; i++) {
    const s = t.rand(0.02, 0.4);
    leafDab(t, tr.center(s) + tr.width(s) * t.rand(-0.42, 0.1), H + (76 - H) * s, t.rand(1.6, 3.2), t.pick(["#2a6f3e", "#3d8446", "#1b4d30", "#5aa24c"]));
  }

  // back wisteria, canopy, front wisteria
  for (let i = 0; i < 9; i++) {
    raceme(t, t.rand(16, W - 16), t.rand(52, 68), t.rand(30, 56), t.rand(5, 7), WISTERIA_DIM, t.rand(-5, 5));
  }
  foliage(t, cx, 44, 44, 26, LILAC, 1.1);
  foliage(t, cx - 34, 54, 28, 18, LILAC, 0.9);
  foliage(t, cx + 36, 50, 28, 18, LILAC, 0.9);
  for (let i = 0; i < 12; i++) {
    const x = 12 + ((W - 24) * (i + t.rand(0.15, 0.85))) / 12;
    const side = Math.abs(x - W / 2) / (W / 2);
    raceme(t, x, t.rand(50, 66), t.rand(30, 58) + side * 26, t.rand(6, 8.5), WISTERIA, t.rand(-6, 6));
  }
  return canvas;
}

function paintBush(seed = 113) {
  const W = 88;
  const H = 60;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  blob(t, W / 2, H - 4, 36, 5, "rgba(10,20,25,0.35)", 0.15, 9);
  foliage(t, W / 2, 40, 34, 16, MOSS.slice(0, 4), 0.9);
  foliage(t, W / 2 - 4, 34, 30, 15, MOSS, 1);
  for (let i = 0; i < 16; i++) {
    grassBlade(t, t.rand(10, W - 10), t.rand(22, 34), t.rand(5, 11), t.rand(-4, 4), t.pick(["#80c651", "#c0e862", "#479748"]), 1.3);
  }
  for (let i = 0; i < 16; i++) {
    const petal = t.pick(["#ff8ecf", "#fff3fb", "#ffb3e6", "#c59bff"]);
    flowerDot(t, t.rand(12, W - 12), t.rand(24, 48), t.rand(2, 3.2), petal, "#fff2a0");
  }
  return canvas;
}

// Three glowing bell flowers.
function paintFlowers(seed = 127, order = [0, 1, 2]) {
  const W = 48;
  const H = 60;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  const kinds = [["#ff9ad5", "#ffd9f0", "255,150,225"], ["#b48cf5", "#e6d4ff", "190,150,255"], ["#7fe6f5", "#e0fcff", "120,235,255"]];
  const spots = [[14, 22], [26, 12], [36, 26]];
  const stems = spots.map(([x, y], i) => [x + t.rand(-2, 2), y + t.rand(-2, 3), ...kinds[order[i]]]);

  for (const [, , , , rgb] of stems) glow(ctx, W / 2, 26, 26, rgb, 0.12);
  for (let i = 0; i < 7; i++) {
    grassBlade(t, t.rand(14, 34), H, t.rand(12, 24), t.rand(-10, 10), t.pick(["#2a6f3e", "#479748", "#80c651"]), 1.6);
  }
  for (const [x, y, petal, light, rgb] of stems) {
    ctx.strokeStyle = "#2a6f3e";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(W / 2, H);
    ctx.quadraticCurveTo(W / 2 + (x - W / 2) * 0.2, y + 16, x, y);
    ctx.stroke();
    glow(ctx, x, y, 11, rgb, 0.55);
    flowerDot(t, x, y, 4.6, petal, "#fff6b0");
    blob(t, x - 1.5, y - 2, 2, 1.6, light, 0.2, 6);
  }
  blob(t, 18, 48, 5, 2.4, "#479748", 0.3, 6);
  blob(t, 31, 44, 5, 2.4, "#2a6f3e", 0.3, 6);
  return canvas;
}

// A standing stone with a glowing cyan rune, sitting in a sage bush.
const RUNE_GLYPHS = [
  [[[25, 24], [31, 66]], [[26, 30], [45, 41], [29, 53]]],
  [[[24, 22], [27, 68]], [[24, 26], [43, 35], [27, 46], [45, 66]]],
  [[[34, 22], [46, 37], [34, 52], [22, 37], [34, 22]], [[34, 52], [24, 68]], [[34, 52], [44, 68]]],
];

function paintRuneStone(glyph = 0, seed = 139) {
  const W = 72;
  const H = 92;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);

  glow(ctx, W / 2, 44, 35, "110,235,255", 0.3);

  const stone = () => {
    ctx.beginPath();
    ctx.moveTo(12, H - 8);
    ctx.bezierCurveTo(6, 56, 12, 22, 26, 12);
    ctx.bezierCurveTo(36, 5, 48, 8, 54, 20);
    ctx.bezierCurveTo(63, 38, 62, 62, 60, H - 8);
    ctx.closePath();
  };
  ctx.fillStyle = STONE[1];
  stone();
  ctx.fill();
  ctx.save();
  stone();
  ctx.clip();
  // flat painted facets: shadow on the right, light on the upper left
  blob(t, 58, 52, 16, 44, STONE[0], 0.2, 9);
  blob(t, 20, 30, 18, 24, STONE[2], 0.25, 9);
  blob(t, 24, 20, 12, 10, STONE[3], 0.3, 8);
  blob(t, 34, 74, 30, 12, STONE[0], 0.25, 9);
  ctx.strokeStyle = "rgba(30,20,32,0.5)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(44, 12);
  ctx.quadraticCurveTo(50, 30, 46, 46);
  ctx.stroke();
  ctx.restore();

  // the rune: a wide soft glow, then the bright line, then a white core
  const rune = () => {
    ctx.beginPath();
    for (const stroke of RUNE_GLYPHS[glyph % RUNE_GLYPHS.length]) {
      stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    }
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(90,230,255,0.95)";
  ctx.shadowBlur = 12;
  ctx.strokeStyle = "rgba(100,225,250,0.6)";
  ctx.lineWidth = 7;
  rune();
  ctx.stroke();
  ctx.shadowBlur = 6;
  ctx.strokeStyle = "#8ff3ff";
  ctx.lineWidth = 3.6;
  rune();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#eafdff";
  ctx.lineWidth = 1.3;
  rune();
  ctx.stroke();

  // bush around the base
  foliage(t, 22, H - 12, 20, 9, SAGE, 0.8);
  foliage(t, 50, H - 10, 20, 9, SAGE, 0.8);
  foliage(t, 36, H - 7, 24, 7, SAGE.slice(1), 0.7);
  return canvas;
}

// A cluster of glowing mushrooms in the ferns.
function paintMushrooms(seed = 151) {
  const W = 120;
  const H = 96;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  const ox = 28; // the cluster sits in the middle, with room around it for the glow
  glow(ctx, ox + 30, H - 34, 46, "90,235,255", 0.3);
  fern(t, ox + 14, H - 2, 22, ["#143a2a", "#1f5a38", "#35803f", "#63aa4a"]);
  fern(t, ox + 52, H - 2, 20, ["#143a2a", "#1f5a38", "#35803f", "#63aa4a"]);
  mushroom(t, ox + 40, H - 4, t.rand(21, 27), 20, "90,235,255", 0);
  mushroom(t, ox + 24, H - 3, t.rand(30, 38), 26, "90,235,255", 0);
  mushroom(t, ox + 50, H - 2, 12, 12, "90,235,255", 0);
  mushroom(t, ox + 12, H - 2, 10, 10, "90,235,255", 0);
  for (let i = 0; i < 10; i++) {
    grassBlade(t, ox + t.rand(8, 56), H, t.rand(5, 11), t.rand(-4, 4), t.pick(["#35803f", "#63aa4a", "#1f5a38"]), 1.4);
  }
  return canvas;
}

// Two mossy boulders with a few flowers.
function paintBoulder(seed = 163) {
  const W = 84;
  const H = 56;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  blob(t, W / 2, H - 4, 38, 5, "rgba(10,14,26,0.4)", 0.15, 9);
  const rock = (x, y, rx, ry) => {
    blob(t, x, y, rx, ry, STONE[0], 0.16, 10);
    blob(t, x - rx * 0.12, y - ry * 0.12, rx * 0.86, ry * 0.84, STONE[1], 0.18, 10);
    blob(t, x - rx * 0.28, y - ry * 0.3, rx * 0.55, ry * 0.5, STONE[2], 0.22, 9);
    blob(t, x - rx * 0.4, y - ry * 0.48, rx * 0.24, ry * 0.2, STONE[3], 0.25, 7);
  };
  rock(56, 36, 22, 16);
  rock(30, 34, 26, 20);
  // moss draped over the top
  foliage(t, 28, 17, 20, 6, MOSS.slice(1, 6), 0.6);
  foliage(t, 58, 23, 14, 5, MOSS.slice(1, 5), 0.5);
  for (let i = 0; i < 9; i++) {
    grassBlade(t, t.rand(6, W - 6), H - 2, t.rand(6, 13), t.rand(-4, 4), t.pick(["#2a6f3e", "#479748", "#80c651"]), 1.4);
  }
  for (let i = 0; i < 5; i++) {
    flowerDot(t, t.rand(14, 64), t.rand(13, 22), t.rand(1.8, 2.6), t.pick(["#fff3fb", "#ff8ecf", "#c59bff"]), "#fff2a0");
  }
  return canvas;
}

// A tall crystal outcrop growing out of dark rock.
function paintCrystalRock(seed = 173, kind = 0) {
  const W = 76;
  const H = 86;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  const cols = kind === 0 ? CRYSTAL_PINK : kind === 1 ? CRYSTAL_VIOLET : CRYSTAL_CYAN;
  const rgb = kind === 0 ? "255,130,235" : kind === 1 ? "160,130,255" : "110,235,255";
  glow(ctx, W / 2, 46, 37, rgb, 0.5);
  crystal(t, 20, H - 12, 34, 13, cols, rgb, 0);
  crystal(t, 58, H - 12, 40, 15, cols, rgb, 0);
  crystal(t, 48, H - 10, 26, 11, cols, rgb, 0);
  crystal(t, 36, H - 10, 68, 22, cols, rgb, 0);
  crystal(t, 27, H - 9, 22, 10, cols, rgb, 0);
  // rock and leaves at the base
  blob(t, 38, H - 9, 30, 9, STONE[0], 0.2, 10);
  blob(t, 32, H - 12, 18, 6, STONE[1], 0.25, 9);
  foliage(t, 16, H - 9, 14, 7, SAGE, 0.6);
  foliage(t, 60, H - 8, 14, 7, SAGE, 0.6);
  return canvas;
}

// Ferns with a couple of small mushrooms.
function paintFernPatch(seed = 181) {
  const W = 72;
  const H = 54;
  const { canvas, ctx } = makeCanvas(W, H);
  const t = tools(ctx, seed);
  const greens = ["#143a2a", "#1f5a38", "#35803f", "#63aa4a", "#9ed95c"];
  fern(t, 18, H - 2, 26, greens);
  fern(t, 52, H - 2, 28, greens);
  fern(t, 36, H - 2, 34, greens);
  mushroom(t, 56, H - 3, 11, 10, "90,235,255", 1.3);
  mushroom(t, 15, H - 2, 9, 9, "90,235,255", 1.3);
  for (let i = 0; i < 12; i++) {
    grassBlade(t, t.rand(6, W - 6), H, t.rand(6, 13), t.rand(-5, 5), t.pick(["#35803f", "#63aa4a", "#1f5a38"]), 1.4);
  }
  return canvas;
}

// ---------------------------------------------------------------- hooks for the scene

function setTexture(textures, key, canvas) {
  if (textures.exists(key)) textures.remove(key);
  const texture = textures.addCanvas(key, canvas);
  // Painted art looks best smoothed, not hard pixels
  if (texture && texture.setFilter && Phaser.Textures.FilterMode) {
    texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }
}

export function paintEnchantedForest(scene) {
  const textures = scene.textures;
  setTexture(textures, "autumnSky", paintSky());
  setTexture(textures, "cloud1", paintDrape(132, 204, 201));
  setTexture(textures, "cloud2", paintDrape(172, 232, 202));
  setTexture(textures, "cloud3", paintDrape(112, 172, 203));
  setTexture(textures, "farMountains", paintFarTrees());
  setTexture(textures, "nearMountains", paintMidTrees());
  setTexture(textures, "farForest", paintUndergrowth());
  setTexture(textures, "nearForest", paintHedge());
  setTexture(textures, "ground", paintGround());
  setTexture(textures, "tree", paintTree());
  setTexture(textures, "bush", paintBush());
  setTexture(textures, "flower", paintFlowers());
  setTexture(textures, "rock", paintRuneStone());
  setTexture(textures, "grass", paintMushrooms());

  // variants, so the same object is not repeated every few steps (see dressDecorations)
  setTexture(textures, "efTree2", paintTree(211));
  setTexture(textures, "efTree3", paintTree(307));
  setTexture(textures, "efBush2", paintBush(223));
  setTexture(textures, "efFlower2", paintFlowers(229, [2, 0, 1]));
  setTexture(textures, "efFlower3", paintFlowers(233, [1, 2, 0]));
  setTexture(textures, "efRune2", paintRuneStone(1, 241));
  setTexture(textures, "efRune3", paintRuneStone(2, 251));
  setTexture(textures, "efBoulder", paintBoulder());
  setTexture(textures, "efCrystal", paintCrystalRock(173, 0));
  setTexture(textures, "efCrystal2", paintCrystalRock(191, 2));
  setTexture(textures, "efFern", paintFernPatch());
  setTexture(textures, "efMushrooms2", paintMushrooms(263));
}

// The scene lays out tree, bush, flower, rock, grass over and over. This swaps in variants
// and varies the size and facing, so the path does not look stamped.
function dressDecorations(scene) {
  if (!scene.decorations) return;
  const variants = {
    tree: ["tree", "efTree2", "efTree3"],
    bush: ["bush", "efBush2", "efBoulder"],
    flower: ["flower", "efFlower2", "efFern", "efFlower3"],
    rock: ["rock", "efBoulder", "efCrystal", "efRune2", "efCrystal2", "efRune3"],
    grass: ["grass", "efFern", "efMushrooms2"],
  };
  const noFlip = new Set(["rock", "efRune2", "efRune3"]);
  const seen = {};
  const r = makeRng(5);
  for (const item of scene.decorations) {
    const list = variants[item.type];
    if (!list) continue;
    const n = (seen[item.type] = (seen[item.type] || 0) + 1) - 1;
    const key = list[n % list.length];
    item.sprite.setTexture(key);
    if (!noFlip.has(key)) item.sprite.setFlipX(r() < 0.5);
    item.sprite.setScale(item.sprite.scaleX * (0.86 + r() * 0.3));
  }
}

// ================================================================ the living forest
//
// Everything below makes the scene move: one shared wind, trees built from parts that sway,
// wisteria strands that swing like pendulums, and petals that fall with simple physics.

const mod = (a, n) => ((a % n) + n) % n;

// The same edge shapes paintGround uses, so reeds and grass sit exactly on the painted bank.
const GROUND_W = 1024;
const groundWave = (x, k, amp, phase = 0) => Math.sin((x / GROUND_W) * TAU * k + phase) * amp;
const groundTopY = (x) => 12 + groundWave(x, 5, 2.2) + groundWave(x, 11, 1.3, 0.6);
const pondEdgeY = (x) => 92 + groundWave(x, 2, 4, 0.7) + groundWave(x, 5, 2.2, 2.1);

// Wind blows from right to left. There is always a light breeze, and every few seconds a gust
// comes in from the right edge and travels across the screen, so things react one after another.
// at(x, t) is about 0.1 to 0.3 in a breeze and around 1 or more inside a gust.
class Wind {
  constructor(seed) {
    this.r = makeRng(seed);
    this.gusts = [];
    this.nextGust = 2.5;
    this.onGust = null;
  }

  update(t) {
    if (t >= this.nextGust) {
      const gust = {
        t0: t,
        strength: 0.7 + this.r() * 0.75,
        speed: 300 + this.r() * 240,
        hold: 1.6 + this.r() * 1.8,
      };
      this.gusts.push(gust);
      this.nextGust = t + 6 + this.r() * 8;
      if (this.onGust) this.onGust(gust);
    }
    this.gusts = this.gusts.filter((g) => t - g.t0 < g.hold * 4 + 1200 / g.speed + 2);
  }

  at(x, t) {
    let w = 0.14 + 0.09 * Math.sin(t * 0.55 + x * 0.004) + 0.05 * Math.sin(t * 1.9 + x * 0.013);
    for (const g of this.gusts) {
      const local = t - g.t0 - (920 - x) / g.speed; // time since the gust front passed x
      if (local <= 0) continue;
      const rise = Math.min(1, local / 0.45);
      const fall = Math.exp(-Math.max(0, local - 0.45) / g.hold);
      w += g.strength * rise * fall;
    }
    return w;
  }
}

// ---- wisteria strands as separate images, in a range of lengths

const STRAND_LENGTHS = [22, 30, 38, 48, 58, 70, 84, 100, 120, 145, 175, 205];
const STRAND_PAD = 3;

function makeStrandTextures(textures) {
  STRAND_LENGTHS.forEach((length, i) => {
    for (const [name, tones, width] of [["bright", WISTERIA, 7.5], ["dim", WISTERIA_DIM, 6]]) {
      for (let v = 0; v < 2; v++) {
        const { canvas, ctx } = makeCanvas(30, length + STRAND_PAD * 2 + 2);
        raceme(tools(ctx, 500 + i * 7 + v + (name === "dim" ? 100 : 0)), 15, STRAND_PAD, length, width, tones, 0);
        setTexture(textures, `efStrand_${name}_${i}_${v}`, canvas);
      }
    }
  });
}

// A strand image of about the wanted length, hanging from its top.
function addStrand(scene, kind, length, r) {
  let index = 0;
  for (let i = 0; i < STRAND_LENGTHS.length; i++) {
    if (Math.abs(STRAND_LENGTHS[i] - length) < Math.abs(STRAND_LENGTHS[index] - length)) index = i;
  }
  const poolLength = STRAND_LENGTHS[index];
  const sprite = scene.add.image(0, 0, `efStrand_${kind}_${index}_${r() < 0.5 ? 0 : 1}`);
  sprite.setOrigin(0.5, STRAND_PAD / (poolLength + STRAND_PAD * 2 + 2));
  return { sprite, stretch: length / poolLength, length };
}

// ---- trees built from a trunk, leaf clumps and strands

function buildTreeTextures(textures, key, spec) {
  const reach = Math.max(70, ...spec.crown.map((c) => Math.abs(c.x) + c.rx)) + 12;
  const tall = Math.max(spec.height, ...spec.crown.map((c) => -c.y)) + 14;
  const { canvas, ctx } = makeCanvas(reach * 2, tall);
  const t = tools(ctx, spec.seed);
  const baseX = reach;
  const baseY = tall;
  const topY = tall - spec.height;
  const tr = trunk(t, baseX, baseY, topY, spec.wBase, spec.wTop, spec.bark, spec.lean, spec.wobble);
  const yAt = (k) => baseY + (topY - baseY) * k;

  if (spec.roots) {
    branch(ctx, baseX - 8, baseY - 10, baseX - 26, baseY - 1, 6, spec.bark[1]);
    branch(ctx, baseX + 10, baseY - 10, baseX + 28, baseY - 1, 6, spec.bark[0]);
  }
  spec.crown.forEach((c, i) => {
    if (c.central) return;
    const from = t.rand(0.6, 0.92);
    branch(ctx, tr.center(from), yAt(from), baseX + c.x, baseY + c.y + 8, t.rand(4.5, 7.5), spec.bark[i % 2]);
  });
  if (spec.moss) {
    for (let i = 0; i < 14; i++) {
      const k = t.rand(0.02, 0.4);
      leafDab(t, tr.center(k) + tr.width(k) * t.rand(-0.42, 0.1), yAt(k), t.rand(1.6, 3.2), t.pick(["#2a6f3e", "#3d8446", "#1b4d30", "#5aa24c"]));
    }
  }
  setTexture(textures, `${key}_base`, canvas);

  spec.crown.forEach((c, i) => {
    const pad = Math.max(8, c.rx * 0.3);
    const clump = makeCanvas(Math.ceil((c.rx + pad) * 2), Math.ceil((c.ry + pad) * 2));
    foliage(tools(clump.ctx, spec.seed + 31 * (i + 1)), c.rx + pad, c.ry + pad, c.rx, c.ry, spec.tones, c.density || 1);
    setTexture(textures, `${key}_c${i}`, clump.canvas);
  });
}

// Puts one tree in the scene. getX() says where its base is each frame.
function plantTree(scene, life, key, spec, getX, y, scale, flip, depth, alpha = 1) {
  const r = makeRng(spec.seed * 3 + 1);
  const side = flip ? -1 : 1;
  const parts = [];
  const base = scene.add.image(0, 0, `${key}_base`).setOrigin(0.5, 1).setScale(scale).setFlipX(flip).setDepth(depth).setAlpha(alpha);
  parts.push({ sprite: base, lx: 0, ly: 0, kind: "base" });

  const strand = (list, kind, d) => {
    for (const st of list) {
      const made = addStrand(scene, kind, st.len, r);
      made.sprite.setScale(scale * made.stretch).setDepth(d).setAlpha(alpha);
      parts.push({
        sprite: made.sprite, lx: st.x * side, ly: st.y, kind: "strand",
        angle: 0, vel: 0, phase: r() * TAU,
        gain: 0.1 + Math.min(0.1, st.len / 900) + r() * 0.04,
        stiff: 22 - Math.min(10, st.len / 16) + r() * 3,
      });
    }
  };

  strand(spec.backStrands, "dim", depth + 0.001);
  spec.crown.forEach((c, i) => {
    const sprite = scene.add.image(0, 0, `${key}_c${i}`).setScale(scale).setFlipX(flip).setDepth(depth + 0.002).setAlpha(alpha);
    parts.push({ sprite, lx: c.x * side, ly: c.y, kind: "clump", phase: r() * TAU, sway: 1 + Math.abs(c.x) / 90 });
  });
  strand(spec.frontStrands, "bright", depth + 0.003);

  life.trees.push({ getX, y, scale, parts });
}

function updateTrees(life, t, dt) {
  for (const tree of life.trees) {
    const x = tree.getX();
    const hidden = x < -260 || x > 1060;
    for (const part of tree.parts) {
      const px = x + part.lx * tree.scale;
      const py = tree.y + part.ly * tree.scale;
      if (part.kind === "base") {
        part.sprite.setPosition(px, py);
        continue;
      }
      if (hidden) {
        part.sprite.setPosition(px, py);
        continue;
      }
      const w = life.wind.at(px, t);
      if (part.kind === "clump") {
        // the crown leans with the wind and rustles
        const rustle = Math.sin(t * 1.4 + part.phase) * 0.012 + Math.sin(t * 5.3 + part.phase * 2) * 0.006 * (0.4 + w);
        part.sprite.setRotation(-w * 0.022 * part.sway + rustle);
        part.sprite.setPosition(px - w * 2.4 * part.sway * tree.scale, py + Math.sin(t * 1.1 + part.phase) * 0.8);
      } else {
        // a hanging strand is a damped pendulum pushed by the wind
        const target = w * part.gain + Math.sin(t * 2.4 + part.phase) * 0.035 * (0.5 + w);
        part.vel += (-(part.angle - target) * part.stiff - part.vel * 3.4) * dt;
        part.angle += part.vel * dt;
        part.sprite.setRotation(part.angle);
        part.sprite.setPosition(px - w * 1.6 * tree.scale, py);
      }
    }
  }
}

function decorTreeSpec(seed) {
  const r = makeRng(seed);
  const rand = (a, b) => a + (b - a) * r();
  const cx = rand(-10, 4);
  const crown = [
    { x: cx - 36, y: -122, rx: 28, ry: 18, density: 0.9 },
    { x: cx + 36, y: -126, rx: 28, ry: 18, density: 0.9 },
    { x: cx, y: -132, rx: 44, ry: 26, density: 1.1, central: true },
  ];
  const backStrands = [];
  for (let i = 0; i < 9; i++) backStrands.push({ x: rand(-48, 48), y: rand(-122, -108), len: rand(30, 56) });
  const frontStrands = [];
  for (let i = 0; i < 12; i++) {
    const x = -54 + (108 * (i + rand(0.15, 0.85))) / 12;
    frontStrands.push({ x, y: rand(-124, -110), len: rand(30, 58) + (Math.abs(x) / 54) * 26 });
  }
  return { seed, height: 100, wBase: 24, wTop: 8, lean: cx, wobble: 6, bark: BARK_WARM, tones: LILAC, roots: true, moss: true, crown, backStrands, frontStrands };
}

function midTreeSpec(seed, index) {
  const r = makeRng(seed);
  const rand = (a, b) => a + (b - a) * r();
  const height = index % 2 === 0 ? rand(160, 178) : rand(132, 150);
  const lean = rand(-20, 20);
  const crown = [];
  const limbs = 4 + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < limbs; k++) {
    const side = (k / (limbs - 1)) * 2 - 1;
    const edge = Math.abs(side);
    crown.push({
      x: lean + side * rand(58, 76),
      y: -height - rand(30, 52) + edge * rand(14, 26),
      rx: rand(40, 54) - edge * 6,
      ry: rand(24, 32) - edge * 4,
      density: 0.95,
      edge,
    });
  }
  crown.sort((a, b) => b.edge - a.edge);
  crown.push({ x: lean + rand(-8, 8), y: -height - rand(46, 58), rx: rand(48, 60), ry: rand(26, 34), density: 1.05, central: true });
  const backStrands = [];
  for (let i = 0; i < 7; i++) backStrands.push({ x: lean + rand(-84, 84), y: -height - rand(6, 26), len: rand(24, 62) });
  const frontStrands = [];
  for (let i = 0; i < 6; i++) frontStrands.push({ x: lean + rand(-78, 78), y: -height - rand(2, 22), len: rand(20, 46) });
  return { seed, height, wBase: rand(28, 40), wTop: 10, lean, wobble: 7, bark: BARK, tones: LILAC, crown, backStrands, frontStrands };
}

// ---- the hanging wisteria at the top: a vine with leaves, and every strand on its own

function buildDrape(scene, life, cloud, index) {
  const sizes = [[132, 204], [172, 232], [112, 172]];
  const [W, H] = sizes[index % 3];
  const seed = 201 + (index % 3);
  const key = `efVine_${index % 3}`;
  const r = makeRng(seed * 7 + index);
  const rand = (a, b) => a + (b - a) * r();
  const sag = 8 + ((seed * 13) % 9);
  const vineY = (x) => {
    const k = x / W;
    return 10 + sag * 4 * k * (1 - k) + 2 * k;
  };

  if (!scene.textures.exists(key)) {
    const { canvas, ctx } = makeCanvas(W, 46);
    const t = tools(ctx, seed);
    ctx.strokeStyle = "#2c2a3a";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let x = 4; x <= W - 4; x += 4) ctx.lineTo(x, vineY(x));
    ctx.stroke();
    const leafTones = ["#0f2c2a", "#164436", "#226042", "#3a8049"];
    for (let i = 0; i < W / 14; i++) {
      const x = 6 + t.rand(0, W - 12);
      foliage(t, x, vineY(x) - 1, t.rand(9, 15), t.rand(5, 9), leafTones, 0.45);
    }
    setTexture(scene.textures, key, canvas);
  }

  const scale = cloud.scaleX;
  const alpha = cloud.alpha;
  const depth = cloud.depth;
  const parts = [];
  const strand = (count, kind, lengthOf, d, dy) => {
    for (let i = 0; i < count; i++) {
      const x = 10 + ((W - 20) * (i + rand(0.1, 0.9))) / count;
      const middle = 1 - Math.abs(x / W - 0.5) * 1.15;
      const made = addStrand(scene, kind, lengthOf(middle), r);
      made.sprite.setScale(scale * made.stretch, scale * made.stretch).setDepth(d).setAlpha(alpha);
      parts.push({
        sprite: made.sprite, lx: x - W / 2, ly: vineY(x) + dy - H / 2, kind: "strand",
        angle: 0, vel: 0, phase: r() * TAU,
        gain: 0.085 + Math.min(0.11, made.length / 1000) + r() * 0.035,
        stiff: 20 - Math.min(11, made.length / 17) + r() * 3,
      });
    }
  };
  strand(Math.round(W / 15), "dim", (m) => H * rand(0.3, 0.62) * (0.55 + m * 0.45), depth + 0.001, 0);
  const vine = scene.add.image(0, 0, key).setOrigin(0.5, 0).setScale(scale).setDepth(depth + 0.002).setAlpha(alpha);
  parts.push({ sprite: vine, lx: 0, ly: -H / 2, kind: "base" });
  strand(Math.round(W / 12), "bright", (m) => (H - 34) * rand(0.5, 1) * (0.5 + m * 0.5), depth + 0.003, 2);

  life.trees.push({ getX: () => cloud.x, y: cloud.y, scale, parts });
  cloud.setVisible(false);
}

// ---- petals with simple physics

class Petals {
  constructor(scene, wind, count = 120) {
    this.wind = wind;
    this.r = makeRng(99);
    this.items = [];
    const colors = [0xbb9df7, 0xdcc0fb, 0xf1b4f4, 0x9877ee, 0xffffff, 0xe6ccff];
    for (let i = 0; i < count; i++) {
      const sprite = scene.add.image(-50, -50, "efPetal").setVisible(false).setTint(colors[i % colors.length]);
      this.items.push({ sprite, alive: false });
    }
    for (let i = 0; i < 28; i++) this.spawn(this.r() * 900, 40 + this.r() * 260);
  }

  spawn(x, y) {
    const p = this.items.find((q) => !q.alive);
    if (!p) return false;
    const r = this.r;
    const roll = r();
    p.layer = roll < 0.28 ? "back" : roll < 0.9 ? "mid" : "front";
    p.size = p.layer === "back" ? 0.38 + r() * 0.2 : p.layer === "mid" ? 0.6 + r() * 0.4 : 1.1 + r() * 0.5;
    p.sprite.setDepth(p.layer === "back" ? 3.8 : p.layer === "mid" ? 7 : 12);
    p.x = x;
    p.y = y;
    p.vx = -10 - r() * 20;
    p.vy = 6 + r() * 14;
    p.phase = r() * TAU;
    p.flutter = 2.6 + r() * 2.6;
    p.rot = r() * TAU;
    p.spin = (r() - 0.5) * 5;
    p.fall = (30 + r() * 18) * (0.75 + p.size * 0.3); // settling speed in still air
    p.landY = p.layer === "back" ? 300 : p.layer === "front" ? 520 : 356 + r() * 88;
    p.state = "air";
    p.rest = 0;
    p.alpha = 0;
    p.alive = true;
    p.sprite.setVisible(true);
    return true;
  }

  update(t, dt, walking, groundSpeed) {
    const r = this.r;
    // a slow steady fall everywhere, and many more petals shaken loose where the wind is strong
    for (let i = 0; i < 3; i++) {
      const x = r() * 960 - 20;
      const w = this.wind.at(x, t);
      const perSecond = 0.5 + 7 * Math.max(0, w - 0.45);
      if (r() < perSecond * dt) this.spawn(x, 30 + r() * 210);
    }

    for (const p of this.items) {
      if (!p.alive) continue;
      const w = this.wind.at(p.x, t);

      if (p.state === "air") {
        // the petal is dragged toward the speed of the air around it, and sinks at its own rate
        const airVx = -w * 150 - (walking ? 22 : 0);
        const airVy = p.fall - Math.max(0, w - 0.55) * 60 + Math.sin(t * 2.1 + p.phase) * 9;
        const drag = 2.6;
        p.vx += (airVx - p.vx) * drag * dt;
        p.vy += (airVy - p.vy) * drag * dt;
        p.phase += p.flutter * dt;
        p.x += (p.vx + Math.cos(p.phase) * 16) * dt; // side to side flutter
        p.y += (p.vy + Math.sin(p.phase * 2) * 5) * dt;
        p.rot += (p.spin + p.vx * 0.012) * dt;
        p.alpha = Math.min(1, p.alpha + dt * 2);
        if (p.y >= p.landY) {
          if (p.layer !== "mid") {
            p.alive = false;
          } else {
            p.state = p.landY >= 414 ? "water" : "ground";
            p.y = p.landY;
            p.rest = 0;
          }
        }
      } else {
        p.rest += dt;
        const scroll = walking ? groundSpeed : 0;
        if (p.state === "ground") {
          const push = Math.max(0, w - 0.75) * 120; // a strong gust skitters it along the path
          p.x -= (scroll + push) * dt;
          p.rot += push * 0.05 * dt;
          if (p.rest > 4) p.alpha -= dt * 0.8;
        } else {
          p.x -= (scroll + w * 14) * dt; // floating on the pond
          if (p.rest > 6) p.alpha -= dt * 0.6;
        }
        if (p.alpha <= 0) p.alive = false;
      }

      if (p.x < -40 || p.x > 1000 || p.y < -60) p.alive = false;
      if (!p.alive) {
        p.sprite.setVisible(false);
        continue;
      }
      const inAir = p.state === "air";
      const turn = inAir ? Math.abs(Math.cos(p.phase * 0.9)) : 1; // tumbling shows the thin edge
      p.sprite
        .setPosition(p.x, p.y)
        .setRotation(p.rot)
        .setScale(p.size * (0.25 + 0.75 * turn), p.size * (inAir ? 1 : 0.6))
        .setAlpha(Math.max(0, p.alpha) * (p.layer === "back" ? 0.55 : 0.92));
    }
  }
}

// ---- reeds, grass and pond glints

function makeReedTextures(textures) {
  const greens = ["#1b4d30", "#2a6f3e", "#479748", "#80c651"];
  for (let v = 0; v < 3; v++) {
    const { canvas, ctx } = makeCanvas(48, 58);
    const t = tools(ctx, 600 + v);
    for (let i = 0; i < 8; i++) {
      const h = t.rand(20, 52);
      const lean = t.rand(-12, 12);
      const x = 24 + t.rand(-8, 8);
      grassBlade(t, x, 58, h, lean, t.pick(greens), 1.8);
      if (i % 3 === 0) {
        // seed head
        ctx.fillStyle = "#7a4a3a";
        ctx.beginPath();
        ctx.ellipse(x + lean, 58 - h, 1.8, 4.6, lean * 0.03, 0, TAU);
        ctx.fill();
      }
    }
    setTexture(textures, `efReed${v}`, canvas);
  }
  for (let v = 0; v < 2; v++) {
    const { canvas, ctx } = makeCanvas(36, 24);
    const t = tools(ctx, 620 + v);
    for (let i = 0; i < 9; i++) {
      grassBlade(t, 18 + t.rand(-10, 10), 24, t.rand(8, 21), t.rand(-7, 7), t.pick(["#479748", "#80c651", "#c0e862", "#63b24c"]), 1.6);
    }
    setTexture(textures, `efTuft${v}`, canvas);
  }
}

function addGroundLife(scene, life) {
  const r = makeRng(77);
  const groundTop = 320; // world y of the top of the ground texture
  for (let i = 0; i < 11; i++) {
    const bx = i * 93 + r() * 50;
    const sprite = scene.add.image(0, groundTop + pondEdgeY(bx) + 3, `efReed${i % 3}`).setOrigin(0.5, 1).setDepth(5.5).setScale(0.5 + r() * 0.3);
    life.blades.push({ sprite, bx, phase: r() * TAU, bend: 0.11 + r() * 0.05 });
  }
  for (let i = 0; i < 20; i++) {
    const bx = i * 51 + r() * 30;
    const sprite = scene.add.image(0, groundTop + groundTopY(bx) + 9, `efTuft${i % 2}`).setOrigin(0.5, 1).setDepth(5.4).setScale(0.8 + r() * 0.5);
    life.blades.push({ sprite, bx, phase: r() * TAU, bend: 0.16 + r() * 0.06 });
  }
  for (let i = 0; i < 18; i++) {
    const sprite = scene.add.image(0, 424 + r() * 22, "efGlow").setBlendMode(Phaser.BlendModes.ADD).setDepth(5.6).setScale(0.05 + r() * 0.08, 0.03 + r() * 0.03);
    life.glints.push({ sprite, bx: r() * GROUND_W, phase: r() * TAU, speed: 1.4 + r() * 2.2 });
  }
}

function updateGroundLife(scene, life, t) {
  const scroll = scene.ground ? scene.ground.tilePositionX : 0;
  for (const b of life.blades) {
    const x = mod(b.bx - scroll + 60, GROUND_W) - 60;
    const w = life.wind.at(x, t);
    b.sprite.x = x;
    b.sprite.setRotation(-(w * b.bend + Math.sin(t * 2.2 + b.phase) * 0.03 * (0.5 + w)));
  }
  for (const g of life.glints) {
    g.sprite.x = mod(g.bx - scroll + 60, GROUND_W) - 60;
    g.sprite.setAlpha(0.1 + 0.75 * Math.pow(Math.max(0, Math.sin(t * g.speed + g.phase)), 3));
  }
}

// faint streaks of air that race across with each gust
function showGust(scene, gust) {
  if (!scene.textures.exists("efStreak")) {
    // a soft, curling wisp of air, not a hard line
    const { canvas, ctx } = makeCanvas(240, 44);
    const g = ctx.createLinearGradient(0, 0, 240, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.45, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.strokeStyle = g;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 7;
    for (const [width, dy] of [[3.2, 0], [1.6, 7]]) {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(10, 30 + dy * 0.4);
      ctx.bezierCurveTo(70, 4 + dy, 150, 40 - dy, 230, 16 + dy);
      ctx.stroke();
    }
    setTexture(scene.textures, "efStreak", canvas);
  }
  const rand = Phaser.Math.FloatBetween;
  const count = 2 + Math.round(gust.strength * 2);
  for (let i = 0; i < count; i++) {
    const streak = scene.add.image(960 + rand(0, 220), rand(70, 330), "efStreak");
    streak.setBlendMode(Phaser.BlendModes.ADD).setDepth(11).setAlpha(0).setScale(rand(0.7, 1.5), rand(0.7, 1.3));
    const duration = (1400 / gust.speed) * 1000 * rand(0.8, 1.1);
    const delay = rand(0, 500);
    scene.tweens.add({ targets: streak, x: -260, duration, delay, ease: "Sine.easeIn", onComplete: () => streak.destroy() });
    scene.tweens.add({ targets: streak, alpha: 0.07 + gust.strength * 0.05, duration: duration * 0.35, delay, yoyo: true, hold: duration * 0.2 });
  }
}

// Turns the painted scene into a moving one. If anything here fails, the still version stays.
function bringForestToLife(scene) {
  const life = { wind: new Wind(4242), trees: [], blades: [], glints: [], t: 0 };
  life.wind.onGust = (gust) => showGust(scene, gust);

  makeStrandTextures(scene.textures);
  makeReedTextures(scene.textures);

  // the lilac trees: six of them on a loop, moving with the middle layer
  const PERIOD = 1200;
  for (let i = 0; i < 6; i++) {
    const spec = midTreeSpec(900 + i * 17, i);
    const key = `efMid${i}`;
    buildTreeTextures(scene.textures, key, spec);
    const bx = i * (PERIOD / 6) + (((i * 53) % 44) - 22) + 90;
    const getX = () => mod(bx - (scene.nearMountains ? scene.nearMountains.tilePositionX : 0) + 260, PERIOD) - 260;
    plantTree(scene, life, key, spec, getX, 389, 1, i % 3 === 1, 2.01);
  }
  // the middle layer's own picture now holds only the dark shrubs
  setTexture(scene.textures, "nearMountains", paintMidShrubs());
  if (scene.nearMountains) scene.nearMountains.setTexture("nearMountains");

  // the wisteria trees along the path
  const decorSpecs = [101, 211, 307].map((seed, i) => {
    const spec = decorTreeSpec(seed);
    buildTreeTextures(scene.textures, `efDecor${i}`, spec);
    return spec;
  });
  let treeCount = 0;
  for (const item of scene.decorations || []) {
    if (item.type !== "tree") continue;
    const which = treeCount++ % decorSpecs.length;
    const sprite = item.sprite;
    plantTree(scene, life, `efDecor${which}`, decorSpecs[which], () => sprite.x, sprite.y, sprite.scaleX, sprite.flipX, sprite.depth);
    sprite.setVisible(false);
  }

  // the hanging wisteria along the top
  (scene.clouds || []).forEach((cloud, i) => buildDrape(scene, life, cloud, i));

  addGroundLife(scene, life);
  const petals = new Petals(scene, life.wind);

  const onUpdate = (time, delta) => {
    const dt = Math.min(delta / 1000, 0.05);
    life.t += dt;
    life.wind.update(life.t);
    updateTrees(life, life.t, dt);
    updateGroundLife(scene, life, life.t);
    petals.update(life.t, dt, scene.walking, scene.speed || 85);
  };
  scene.events.on("update", onUpdate);
  scene.events.once("shutdown", () => scene.events.off("update", onUpdate));
}

// The dragon stands a little lower than the scene puts him, on the purple path, not on the
// grass line. Nothing else about him is changed.
function placeHeroOnPath(scene) {
  const hero = scene.player;
  if (!hero) return;
  const FEET_Y = 386;

  scene.basePlayerY = FEET_Y;
  hero.y = FEET_Y;
  for (const foot of [scene.footL, scene.footR]) {
    if (foot) foot.y = FEET_Y;
  }
  if (scene.shadow) scene.shadow.setPosition(hero.x, FEET_Y - 2);
}

// ---- footprints: each time a foot lands it presses a print into the path and kicks up dust.
// The path scrolls away behind him, so the prints form a trail that fades out.

function makePrintTexture(textures) {
  if (textures.exists("efPrint")) return;
  const { canvas, ctx } = makeCanvas(24, 16);
  const draw = (dx, dy, color) => {
    ctx.fillStyle = color;
    const e = (x, y, rx, ry, rot = 0) => {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, rx, ry, rot, 0, TAU);
      ctx.fill();
    };
    e(7, 8, 5.4, 4.4);             // heel
    e(16, 3.2, 3.6, 2, 0.35);      // upper toe
    e(18.6, 8, 4, 2.2);            // middle toe
    e(16, 12.8, 3.6, 2, -0.35);    // lower toe
  };
  draw(1.2, 1.2, "rgba(255,240,205,0.5)");  // soft pale rim on the lower right
  draw(0, 0, "rgba(240,186,96,0.8)");       // the dent, a warm firefly gold
  draw(-0.4, -0.6, "rgba(176,104,44,0.6)"); // deepest part
  setTexture(textures, "efPrint", canvas);
}

// One step of the walk is half a cycle of sin(time * 0.012), about a quarter of a second.
const STEP_SECONDS = Math.PI / 0.012 / 1000;

// Which print goes with which foot. false: the left foot makes the print on the left.
// true: the left foot makes the print on the right (and the right foot the one on the left).
const SWAP_FEET = true;

function addFootprints(scene) {
  const hero = scene.player;
  if (!hero) return;
  makePrintTexture(scene.textures);
  const rand = Phaser.Math.FloatBetween;
  const prints = [];
  const puffs = [];
  let lastStep = 0;

  const stepOn = (landing) => {
    const side = SWAP_FEET ? -landing : landing;
    // the left print sits a little behind, the right print a little in front, so the trail zigzags
    // the print on the left sits further forward: it is made a step after the other one, by which
    // time the path has already slid away, so it needs a head start to line up with the foot
    const x = hero.x + (side > 0 ? 7 : 3);
    const y = scene.basePlayerY - 2 + side * 3.2;

    const glowSprite = scene.add.image(x, y, "efGlow").setDepth(5.85).setBlendMode(Phaser.BlendModes.ADD);
    glowSprite.setTint(0xfff3d6).setScale(0.55, 0.26).setAlpha(0.3);
    const print = scene.add.image(x, y, "efPrint").setOrigin(0.5, 0.5).setDepth(5.8);
    print.setScale(1.2, 0.72).setAlpha(0);
    prints.push({ sprite: print, glow: glowSprite, age: 0 });

    for (let i = 0; i < 4; i++) {
      const puff = scene.add.image(x + rand(-5, 5), y - 1, "efGlow").setDepth(9.4).setTint(0xd2bfe9);
      puff.setScale(rand(0.1, 0.2)).setAlpha(rand(0.3, 0.5));
      puffs.push({
        sprite: puff, age: 0, life: rand(0.55, 0.95),
        vx: rand(-34, -8), vy: rand(-22, -8), grow: rand(0.12, 0.22),
      });
    }
    // a couple of loose petals are kicked up too
    for (let i = 0; i < 2; i++) {
      const bit = scene.add.image(x, y - 2, "efPetal").setDepth(9.4).setTint(i ? 0xbb9df7 : 0xf1b4f4);
      bit.setScale(rand(0.5, 0.8));
      puffs.push({ sprite: bit, age: 0, life: rand(0.5, 0.8), vx: rand(-40, 10), vy: rand(-45, -22), grow: 0, spin: rand(-8, 8), gravity: 120 });
    }
    // two tiny white motes drift up from the print
    for (let i = 0; i < 2; i++) {
      const mote = scene.add.image(x + rand(-6, 6), y - 2, "efGlow").setDepth(9.5).setBlendMode(Phaser.BlendModes.ADD);
      mote.setTint(0xfff6e0).setScale(rand(0.05, 0.08)).setAlpha(0.5);
      puffs.push({ sprite: mote, age: 0, life: rand(0.8, 1.3), vx: rand(-14, -4), vy: rand(-26, -14), grow: 0, gravity: -2, peak: 0.55 });
    }
  };

  const onUpdate = (time, delta) => {
    const dt = Math.min(delta / 1000, 0.05);

    // a foot lands each time the step wave crosses zero
    if (scene.walking) {
      const wave = Math.sin(time * 0.012);
      const sign = wave > 0 ? 1 : -1;
      if (lastStep !== 0 && sign !== lastStep) stepOn(lastStep > 0 ? -1 : 1);
      lastStep = sign;
    } else {
      lastStep = 0;
    }

    // prints move with the path, so they stay put while the dragon stands still
    const scroll = scene.walking ? (scene.speed || 85) * dt : 0;
    for (let i = prints.length - 1; i >= 0; i--) {
      const p = prints[i];
      p.sprite.x -= scroll;
      p.age += dt;
      p.glow.x -= scroll;
      // a print stays for two steps, then fades out over the next two
      const holdFor = STEP_SECONDS * 2;
      const fadeOver = STEP_SECONDS * 2;
      const fade = p.age < holdFor ? 0.85 : Math.max(0, 0.85 * (1 - (p.age - holdFor) / fadeOver));
      // the foot presses in: a quick stamp from a bit larger and lighter down to the final print
      const stamp = Math.min(1, p.age / 0.09);
      p.sprite.setScale(1.2 - 0.3 * stamp, 0.72 - 0.22 * stamp);
      p.sprite.setAlpha(fade * stamp);
      // a faint white flash on impact that settles to a barely-there shimmer
      const flash = Math.max(0, 1 - p.age / 0.55);
      p.glow.setAlpha(flash * flash * 0.34 + (fade / 0.85) * 0.07);
      p.glow.setScale(0.55 + flash * 0.3, 0.26 + flash * 0.1);
      if (fade <= 0 || p.sprite.x < -30) {
        p.sprite.destroy();
        p.glow.destroy();
        prints.splice(i, 1);
      }
    }

    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.age += dt;
      const k = q.age / q.life;
      if (k >= 1) {
        q.sprite.destroy();
        puffs.splice(i, 1);
        continue;
      }
      q.vy += (q.gravity || -6) * dt;
      q.sprite.x += (q.vx - scroll / dt * 0) * dt - scroll;
      q.sprite.y += q.vy * dt;
      if (q.spin) q.sprite.rotation += q.spin * dt;
      if (q.grow) q.sprite.setScale(q.sprite.scaleX + q.grow * dt);
      q.sprite.setAlpha((1 - k) * (q.peak || (q.gravity ? 0.9 : 0.5)));
    }
  };
  scene.events.on("update", onUpdate);
  scene.events.once("shutdown", () => scene.events.off("update", onUpdate));
}

export function addForestAmbience(scene) {
  const rand = Phaser.Math.FloatBetween;
  dressDecorations(scene);

  // a soft dot of light, reused for every firefly and mote
  if (!scene.textures.exists("efGlow")) {
    const { canvas, ctx } = makeCanvas(64, 64);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    setTexture(scene.textures, "efGlow", canvas);
  }

  placeHeroOnPath(scene);
  addFootprints(scene);

  // fireflies: most behind the dragon, a few in front
  const colors = [0xffe98a, 0xfff3b8, 0xffd76a, 0x9ff4ff, 0xd9b8ff];
  for (let i = 0; i < 38; i++) {
    const front = i % 5 === 0;
    const fly = scene.add.image(rand(0, 800), rand(70, front ? 430 : 330), "efGlow");
    fly.setBlendMode(Phaser.BlendModes.ADD);
    fly.setTint(colors[i % colors.length]);
    fly.setScale(rand(0.1, front ? 0.34 : 0.24));
    fly.setDepth(front ? 12 : 7);
    fly.setAlpha(rand(0.2, 0.9));
    scene.tweens.add({
      targets: fly,
      x: fly.x + rand(-60, 60),
      y: fly.y + rand(-34, 34),
      duration: rand(3200, 7600),
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    scene.tweens.add({
      targets: fly,
      alpha: rand(0.02, 0.2),
      duration: rand(700, 2100),
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
      delay: rand(0, 1500),
    });
  }

  // a single petal shape, tinted per petal (see the Petals class)
  if (!scene.textures.exists("efPetal")) {
    const { canvas, ctx } = makeCanvas(10, 6);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(5, 3, 4.6, 2.4, 0, 0, TAU);
    ctx.fill();
    setTexture(scene.textures, "efPetal", canvas);
  }

  // wind, swaying trees and strands, falling petals, reeds and pond glints
  try {
    bringForestToLife(scene);
  } catch (error) {
    console.warn("enchanted forest: the moving parts failed, showing the still scene", error);
  }

  // light shafts falling through the trees, in front of the lilac trees and behind the hedge
  if (!scene.textures.exists("efRays")) {
    const { canvas, ctx } = makeCanvas(800, 450);
    const r = makeRng(7);
    for (let i = 0; i < 9; i++) {
      const x0 = 300 + r() * 620;
      const w = 14 + r() * 54;
      const reach = (0.6 + r() * 0.26) * 450;
      const shaft = ctx.createLinearGradient(x0, 0, x0 - 230, reach);
      shaft.addColorStop(0, `rgba(215,235,255,${0.16 + r() * 0.16})`);
      shaft.addColorStop(1, "rgba(215,235,255,0)");
      ctx.fillStyle = shaft;
      ctx.beginPath();
      ctx.moveTo(x0, -10);
      ctx.lineTo(x0 + w, -10);
      ctx.lineTo(x0 + w - 230, reach);
      ctx.lineTo(x0 - 230 - w * 0.8, reach);
      ctx.closePath();
      ctx.fill();
    }
    setTexture(scene.textures, "efRays", canvas);
  }
  const rays = scene.add.image(400, 225, "efRays").setDepth(2.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6);
  scene.tweens.add({ targets: rays, alpha: 0.32, duration: 5200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // low mist where the forest floor meets the trees
  if (!scene.textures.exists("efMist")) {
    const { canvas, ctx } = makeCanvas(800, 120);
    const g = ctx.createLinearGradient(0, 0, 0, 120);
    g.addColorStop(0, "rgba(150,235,220,0)");
    g.addColorStop(0.6, "rgba(150,235,220,0.34)");
    g.addColorStop(1, "rgba(150,235,220,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 120);
    setTexture(scene.textures, "efMist", canvas);
  }
  const mist = scene.add.image(400, 262, "efMist").setDepth(3.5).setAlpha(0.8);
  scene.tweens.add({ targets: mist, alpha: 0.5, duration: 6400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // dark edges so the middle of the scene glows
  if (!scene.textures.exists("efVignette")) {
    const { canvas, ctx } = makeCanvas(800, 450);
    const g = ctx.createRadialGradient(400, 235, 170, 400, 235, 520);
    g.addColorStop(0, "rgba(6,5,26,0)");
    g.addColorStop(1, "rgba(6,5,26,0.62)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 450);
    setTexture(scene.textures, "efVignette", canvas);
  }
  scene.add.image(400, 225, "efVignette").setDepth(19);
}
