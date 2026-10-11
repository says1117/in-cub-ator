// client/src/data/chomperRig.js: Where the cut-out pieces of the Drought Chomper go. Owner: Role 3.
// The picture was cut into layers so each one can move on its own (render/bossRig.js moves them).
// Numbers are pixels in the cut-out files. x, y is where a piece's pivot sits, measured from the
// spot the plant stands on. ox, oy is where that pivot is inside the piece's own picture.
// The middle head is two pieces, jawA and jawB, that open like a mouth. `split` is the line
// between them, measured from the pivot they share.

export const CHOMPER_RIG = {
  folder: "/assets/bosses/chomper",
  height: 685,   // height of the whole uncut picture, roots included
  parts: {
    base: { x: 0, y: 0, ox: 0.5046, oy: 0.9151 },
    headL: { x: -76, y: -461, ox: 0.8717, oy: 0.0178 },
    headR: { x: 125.5, y: -486, ox: 0.3596, oy: 0.0259 },
    jawA: { x: 8, y: -375, ox: 0.8776, oy: 0.0261 },
    jawB: { x: 8, y: -375, ox: 0.4805, oy: -0.0508 },
    leafT: { x: 37, y: -480, ox: 0.827, oy: 0.9662 },
    leafR: { x: 99, y: -162, ox: 0.0274, oy: 0.8219 },
    leafL: { x: 19, y: -175, ox: 0.9946, oy: 0.5261 },
  },
  split: [[3, 12], [-2, 38], [-6, 68], [-9, 88], [-15, 94], [-16.5, 113], [-25, 128], [-34, 138], [-36, 168], [-35, 205.5], [-37.5, 233]],
};
