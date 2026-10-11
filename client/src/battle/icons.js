// client/src/battle/icons.js: Little pixel icons for the three moves, the boss's hidden sign and a bloom.
// Drawn from text grids into textures once, so they stay crisp at any size (scale by whole numbers).
// Each move has a colour, used for its button, its icon and the boss's sign.

export const MOVE_COLORS = { attack: 0x2f76c4, guard: 0xc0842c, special: 0x3d9a58, skill: 0x7b55b0, "?": 0x8a8fb0 };
export const MOVE_CSS = { attack: "#7fb8ff", guard: "#ffc56b", special: "#86e39d", skill: "#cfa8ff", "?": "#d4d8f0" };
export const MOVE_NAMES = { attack: "ATTACK", guard: "GUARD", special: "SPECIAL" };

const PALETTE = { K: 0x10121e, W: 0xffffff, L: 0xdfe8ff, Y: 0xffd34d, O: 0xe08a2a, B: 0x6aa8ff, D: 0x2a5fa8, G: 0x7be38f, E: 0x2f8f4a, P: 0xff8fc0, R: 0xe24a6a, S: 0xbfc6d8, V: 0xb58cff };

const GRIDS = {
  attack: [
    "..........KK",
    ".........KLK",
    "........KLLK",
    ".......KLLK.",
    "......KLLK..",
    ".KK..KLLK...",
    ".KYKKLLK....",
    "..KYKLK.....",
    "...KYK......",
    "..KYKYK.....",
    ".KYK.KYK....",
    "KYK...KK....",
  ],
  guard: [
    ".KKKKKKKKKK.",
    "KOOOOOOOOOOK",
    "KOYYYYYYYYOK",
    "KOYYYOOYYYOK",
    "KOYYYOOYYYOK",
    "KOYOOOOOOYOK",
    "KOYYYOOYYYOK",
    ".KOYYOOYYOK.",
    ".KOYYYYYYOK.",
    "..KOYYYYOK..",
    "...KOOOOK...",
    "....KKKK....",
  ],
  special: [
    ".....KK.....",
    "....KGGK....",
    "....KGGK....",
    "KKKKKGGKKKKK",
    "KGGGGGGGGGGK",
    ".KGGGWWGGGK.",
    "..KGGWWGGK..",
    "..KGGGGGGK..",
    ".KGGGKKGGGK.",
    ".KGGK..KGGK.",
    "KGGK....KGGK",
    "KKK......KKK",
  ],
  unknown: [
    "...KKKKKK...",
    "..KSSSSSSK..",
    ".KSSKKKKSSK.",
    ".KSK....KSK.",
    "..K....KSSK.",
    "......KSSK..",
    ".....KSSK...",
    ".....KSSK...",
    "......KK....",
    ".....KKKK...",
    ".....KSSK...",
    "......KK....",
  ],
  bloom: [
    "....KKK.....",
    "...KPPPK....",
    ".KKKPPPKKK..",
    "KPPKPPPKPPK.",
    "KPPPKYKPPPK.",
    ".KPPYYYPPK..",
    "KPPPKYKPPPK.",
    "KPPKPPPKPPK.",
    ".KKKPPPKKK..",
    "...KPPPK....",
    "....KKK.....",
    "............",
  ],
  bloomEmpty: [
    "....KKK.....",
    "...KSSSK....",
    ".KKK...KKK..",
    "KSSK...KSSK.",
    "K...K.K...K.",
    ".K.......K..",
    "K...K.K...K.",
    "KSSK...KSSK.",
    ".KKK...KKK..",
    "...KSSSK....",
    "....KKK.....",
    "............",
  ],
};

export const iconKey = (name) => `ico-${name}`;
const NAME_FOR = { attack: "attack", guard: "guard", special: "special", "?": "unknown", unknown: "unknown", bloom: "bloom", bloomEmpty: "bloomEmpty" };
export const iconFor = (move) => iconKey(NAME_FOR[move] || "unknown");

export function ensureIcons(scene) {
  for (const [name, rows] of Object.entries(GRIDS)) {
    const key = iconKey(name);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === ".") return;
        g.fillStyle(PALETTE[ch], 1);
        g.fillRect(x, y, 1, 1);
      });
    });
    g.generateTexture(key, 12, 12);
    g.destroy();
  }
}
