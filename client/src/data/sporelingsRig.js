// client/src/data/sporelingsRig.js: Where the cut-out pieces of the Sporeling Trio go. Owner: Role 3.
// The picture was cut into seven pieces (the ground, and a stem and a cap for each mushroom) and
// the painted faces were wiped off, so render/sporeRig.js can move every piece and draw live faces.
// Every number is a pixel in the uncut 1218 x 1140 picture, so they can be read straight off it.
//   parts     where each piece sits (its top left corner) and how big it is
//   origin    the spot the whole boss stands on: the same spot a flat picture of it is placed by
//   mushrooms one entry for each of the three. base: where its roots meet the ground (it bends and
//             squashes about here). neck: where its cap sits on it. face: where its face goes,
//             how far apart the eyes are, how far down the mouth is, how big, and how much it tilts.
//             sway: how far its top drifts side to side, in pixels. drip: how far the goo
//             hanging off its cap swings.

export const SPORELING_RIG = {
  kind: "spores",
  folder: "/assets/bosses/sporelings",
  height: 1140,
  origin: { x: 609, y: 1060 },
  parts: {
    puddle: { x: 1, y: 790, w: 1217, h: 350 },
    lstem: { x: 212, y: 306, w: 343, h: 697 },
    lcap: { x: 77, y: 1, w: 510, h: 502 },
    rstem: { x: 736, y: 413, w: 440, h: 591 },
    rcap: { x: 675, y: 94, w: 483, h: 513 },
    fbody: { x: 416, y: 734, w: 425, h: 363 },
    fcap: { x: 398, y: 523, w: 479, h: 393 },
  },
  // back to front
  mushrooms: [
    {
      id: "L", stem: "lstem", cap: "lcap", base: { x: 385, y: 990 }, neck: { x: 372, y: 345 },
      face: { x: 370, y: 380, rot: -0.35, spacing: 64, drop: 72, size: 1.05 },
      sway: 30, drip: 12, phase: 0, rate: 1.0, strips: [26, 18],
      // how it looks when nothing is happening: wide-eyed and wailing, as in the picture
      mood: { open: 0.65, lid: -0.35, mouth: 0.55, curve: -0.6, look: [0.2, 0.5] },
    },
    {
      id: "R", stem: "rstem", cap: "rcap", base: { x: 962, y: 1000 }, neck: { x: 928, y: 482 },
      face: { x: 919, y: 604, rot: 0.02, spacing: 92, drop: 84, size: 1.3 },
      sway: 20, drip: 9, phase: 2.1, rate: 0.9, strips: [24, 18],
      // eyes shut, mouth sagging
      mood: { open: 0.05, lid: -0.5, mouth: 0.3, curve: -0.8, look: [0, 0.4] },
    },
    {
      id: "F", stem: "fbody", cap: "fcap", base: { x: 625, y: 1085 }, neck: { x: 632, y: 835 },
      face: { x: 621, y: 928, rot: -0.05, spacing: 168, drop: 30, size: 1.45 },
      sway: 12, drip: 8, phase: 4.2, rate: 1.15, strips: [14, 14],
      // half asleep, lips pushed out
      mood: { open: 0.28, lid: -0.4, mouth: 0.0, curve: -0.5, look: [0, 0.5] },
    },
  ],
};
