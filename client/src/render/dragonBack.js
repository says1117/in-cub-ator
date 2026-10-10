// client/src/render/dragonBack.js: The dragon seen from behind, for the battle screen. Owner: Role 3.
// Hand-drawn pixel grid in the same palette as the side-view sticker. One character is one pixel.

const PALETTE = {
  K: "#151515", // outline
  R: "#8f3636", // hat
  r: "#b65353", // hat, lit side
  P: "#f3b4b4", // hat brim
  p: "#d98f8f", // brim, shaded
  C: "#f4edb8", // cream: ears, wings, claws
  c: "#d5c98a", // cream, shaded
  G: "#4aa73b", // green
  L: "#6fc956", // green, lit
  g: "#36892d", // green, shaded
  D: "#236a22", // spine
  W: "#ffffff", // the one eye you can see from behind
};

const ROWS = [
  "...........KK",
  "..........KrRK",
  ".........KrRRK",
  ".........KrRRRK",
  "........KrrRRRRK",
  ".......KrrRRRRRRK",
  "......KrrrRRRRRRRK",
  "...KKKPPPrRRRRRRPPKKK",
  "..KPPPPPPPPPPPPPPPPPPK",
  "...KKpppPPPPPPPPpppKK",
  "....KKKKpppppppKKKK",
  "...KCKGGGGGGGGGGGGK",
  "...KCcKGLGGGDGGGGGGK",
  "....KKGLGGGGDGGGGGWKK",
  ".....KGLGGGGDDGGGGWKGK",
  ".....KGGGGGGGDGGGGGGGLK",
  ".....KGGGGGGGDGGGGGGGGK",
  ".....KgGGGGGGDDGGGGGKK",
  "......KgGGGGGGDGGGgKK",
  ".....KKggGGGGGDGGggK",
  "...KKCKGGGGGGDGGGGKCKK",
  "..KCCcKGLGGGGCCGGGKcCCK",
  "..KCcKGGLGGGGGDGGGGKcCK",
  "...KKGGLGGGGGGDGGGGGKK",
  "....KGGLGGGGGGCCGGGGK",
  "...KGGGLGGGGGGGDGGGGGK",
  "...KGGGGGGGGGGGDGGGGGK",
  "...KgGGGGGGGGGGCCGGGgK",
  "...KgGGGGGGGGGGGDGGGgKKK",
  "....KggGGGGGGGGGDGGgKGGK",
  "....KKgggGGGGGGGGggKGGgK",
  "...KGGKKgggggggggKKGGgK",
  "..KGGGgKKKKKKKKKKKGggK",
  "..KCCGgK.........KKKK",
  "..KKKKKK",
];

export const DRAGON_BACK_KEY = "dragonBack";

// Makes the texture once. Safe to call from any scene, any number of times.
export function ensureDragonBackTexture(scene) {
  if (scene.textures.exists(DRAGON_BACK_KEY)) return;

  const width = Math.max(...ROWS.map((row) => row.length)) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = ROWS.length;
  const ctx = canvas.getContext("2d");

  ROWS.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const color = PALETTE[cell];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });

  scene.textures.addCanvas(DRAGON_BACK_KEY, canvas);
}
