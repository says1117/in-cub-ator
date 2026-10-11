// client/src/data/plantRigs.js: Where each moving piece of the two plants sits. Owner: Role 3 (client, art, demo).
// Made from the plant pictures by a script; the numbers are not meant to be edited by hand.
// Units are pixels of the medium pictures, measured from the bottom middle of the pot (y is negative going up).
//   height: the whole plant, pot to highest fingertip.   rim: the top of the pot, where the leaves start to bend.
//   sizes: the picture sets ("m" for the battle screen, "s" for the forest) and how much each is enlarged.
//   parts: x, y is the joint a piece turns on; ox, oy is that joint inside the piece's own picture.
//   parent: the piece it is attached to (the fist grows from a leaf). No parent means the plant itself.
//   order: back to front.   points: handy spots for effects.   eyes: x, y, half width, half height.

export const EMBER_RIG = {
  folder: "/assets/plants/ember", height: 217.96, rim: -71.45,
  sizes: {"m": 1.0, "s": 2.6613},
  parts: {
    base: {"x": 0.0, "y": 0.0, "m": {"ox": 0.48, "oy": 0.9899, "w": 124, "h": 178}, "s": {"ox": 0.4848, "oy": 0.9673, "w": 48, "h": 69}},
    leafL: {"x": -29.7, "y": -143.22, "m": {"ox": 0.9092, "oy": 0.7195, "w": 57, "h": 50}, "s": {"ox": 0.8743, "oy": 0.6965, "w": 23, "h": 20}},
    fist: {"x": -58.58, "y": -157.58, "m": {"ox": 0.5676, "oy": 0.9204, "w": 51, "h": 55}, "parent": "leafL", "s": {"ox": 0.5838, "oy": 0.888, "w": 21, "h": 22}},
    handT: {"x": 46.7, "y": -144.38, "m": {"ox": 0.1055, "oy": 0.9353, "w": 40, "h": 80}, "s": {"ox": 0.176, "oy": 0.8938, "w": 16, "h": 33}},
    handL: {"x": -51.65, "y": -90.92, "m": {"ox": 0.8976, "oy": 0.6809, "w": 50, "h": 43}, "s": {"ox": 0.8432, "oy": 0.6436, "w": 20, "h": 18}},
    handR: {"x": 47.36, "y": -86.3, "m": {"ox": 0.0758, "oy": 0.438, "w": 38, "h": 50}, "s": {"ox": 0.1376, "oy": 0.4438, "w": 15, "h": 21}},
    leafT: {"x": 25.91, "y": -144.87, "m": {"ox": 0.4798, "oy": 0.8929, "w": 53, "h": 53}, "s": {"ox": 0.5002, "oy": 0.8719, "w": 22, "h": 21}},
  },
  order: ["leafT", "leafL", "fist", "handT", "handL", "handR"],
  points: {"fist": [-54.45, -194.37], "handT": [64.35, -192.72], "handL": [-75.9, -97.84], "handR": [62.7, -85.47], "face": [-4.62, -81.34], "top": [-4.12, -173.75], "pot": [-0.83, -38.45]},
  eyes: [[-14.36, -81.34, 6.11, 6.6], [4.95, -81.34, 5.94, 6.6]],
  mouth: [-4.62, -73.92],
};

export const ZEST_RIG = {
  folder: "/assets/plants/zest", height: 190.41, rim: -55.77,
  sizes: {"m": 1.0, "s": 2.6613},
  parts: {
    base: {"x": 0.0, "y": 0.0, "m": {"ox": 0.3982, "oy": 0.9876, "w": 127, "h": 180}, "s": {"ox": 0.3961, "oy": 0.9708, "w": 49, "h": 70}},
    fist: {"x": -39.11, "y": -134.15, "m": {"ox": 0.7459, "oy": 0.9294, "w": 69, "h": 62}, "s": {"ox": 0.7302, "oy": 0.902, "w": 27, "h": 25}},
    handT: {"x": 47.85, "y": -110.22, "m": {"ox": 0.1793, "oy": 0.7473, "w": 47, "h": 73}, "s": {"ox": 0.2311, "oy": 0.718, "w": 19, "h": 30}},
    handL: {"x": -40.43, "y": -58.25, "m": {"ox": 0.9144, "oy": 0.6377, "w": 45, "h": 51}, "s": {"ox": 0.8537, "oy": 0.6224, "w": 19, "h": 21}},
    handR: {"x": 36.3, "y": -45.87, "m": {"ox": 0.0871, "oy": 0.4544, "w": 56, "h": 79}, "s": {"ox": 0.1386, "oy": 0.46, "w": 22, "h": 32}},
    leafL: {"x": -28.05, "y": -106.92, "m": {"ox": 0.9332, "oy": 0.6631, "w": 67, "h": 42}, "s": {"ox": 0.9181, "oy": 0.6341, "w": 26, "h": 17}},
    leafB: {"x": -30.2, "y": -46.2, "m": {"ox": 0.8289, "oy": 0.1235, "w": 27, "h": 37}, "s": {"ox": 0.7553, "oy": 0.1623, "w": 12, "h": 16}},
  },
  order: ["leafL", "leafB", "fist", "handT", "handL", "handR"],
  points: {"fist": [-49.5, -177.05], "handT": [61.05, -136.62], "handL": [-59.4, -67.32], "handR": [57.75, -50.82], "face": [0.0, -72.27], "top": [-2.48, -166.32], "pot": [0.83, -29.37]},
  eyes: [[-11.22, -73.42, 5.94, 7.59], [11.22, -73.42, 5.94, 7.59]],
  mouth: [0.0, -62.04],
};
