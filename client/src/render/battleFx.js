// client/src/render/battleFx.js: What the plants' moves look like. Owner: Role 3 (client, art, demo).
// Each effect is one function built from the paint box in render/fxKit.js. data/plants.js says
// which effect goes with which move or skill, so every plant fights in its own style:
// Ember with fire and petals, Zest with blades and lightning.
//
// ADDING AN EFFECT: add a function to BATTLE_FX below, then name it in data/plants.js. It is given:
//   kit             the paint box (render/fxKit.js). Use kit.at(ms, fn) for every later step.
//   plant           the plant's entry from data/plants.js (plant.glow is its colour)
//   from(name)      where a spot on the plant is right now: "fist", "handT", "face", "top", "pot" ...
//   ground          where the plant stands: { x, y }
//   boss, bossGround   the middle of the boss, and the spot it stands on
//   at              ms from now until the plant's own action reaches its blow
//   lands           true if the move does damage this turn; false if it was beaten or tied
// It may return a number: extra ms after `at` before the damage really arrives (a thing that has
// to fly across the screen first). The battle screen waits that long to show the hit.
const FIRE = [0xfff0b0, 0xffd45e, 0xff8a3d, 0xff4d3d];
const PETAL = [0xff4d5e, 0xff7a8a, 0xffb0b8, 0xffffff];
const LIME = [0xf4ff8a, 0xc8f04a, 0x7fd13b, 0xffffff];
const VOLT = [0xffffff, 0xfff7a0, 0xffe14a];
const DULL = [0xb8c4d8, 0x8f9bb5];

const between = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

// Something that flies from a to b along a wobbling path, leaving bits behind it.
// draw(g, x, y, heading, k) paints it. Returns nothing; onArrive(x, y) runs at the end.
function flyer(kit, a, b, o, draw, onArrive) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const stop = o.stop ?? 1;
  let last = a;
  kit.draw(o.ms, (g, k) => {
    const s = (o.easeIn ? kit.ease.in(k) * 0.5 + k * 0.5 : k) * stop;
    const wave = Math.sin(s * Math.PI * (o.turns ?? 0) * 2 + (o.phase ?? 0)) * (o.wide ?? 0) * (1 - s);
    const lift = (o.rise ?? 0) * 4 * s * (1 - s);
    const x = a.x + dx * s - (dy / len) * wave;
    const y = a.y + dy * s + (dx / len) * wave - lift;
    draw(g, x, y, Math.atan2(y - last.y, x - last.x || 0.001), k);
    if (o.trail) o.trail(x, y);
    last = { x, y };
  }, { add: o.add, delay: o.delay, done: () => onArrive && onArrive(last.x, last.y) });
}

const heartAt = (g, x, y, size, turn, color, alpha = 1) => {
  // two round lobes and a point: a little anthurium spathe
  const cos = Math.cos(turn), sin = Math.sin(turn);
  const place = (px, py) => ({ x: x + (px * cos - py * sin) * size, y: y + (px * sin + py * cos) * size });
  g.fillStyle(color, alpha);
  const l = place(-0.3, -0.42), r = place(-0.3, 0.42), tip = place(1, 0), a = place(-0.2, -0.86), b = place(-0.2, 0.86);
  g.fillCircle(l.x, l.y, size * 0.48);
  g.fillCircle(r.x, r.y, size * 0.48);
  g.fillTriangle(a.x, a.y, b.x, b.y, tip.x, tip.y);
};

export const BATTLE_FX = {
  // ---------------------------------------------------------------- EMBER

  // VINE HAYMAKER: the fist catches fire on the way in and goes off like a bomb.
  haymaker(ctx) {
    const { kit } = ctx;
    for (let t = Math.max(0, ctx.at - 240); t < ctx.at; t += 22) {
      kit.at(t, () => {
        const fist = ctx.from("fist");
        kit.burst(fist.x, fist.y, { count: 3, colors: FIRE, speed: [20, 110], angle: Math.PI, spread: 1.6, size: [10, 22], life: [160, 340], gravity: -260, add: true, radius: 10 });
      });
    }
    kit.at(Math.max(0, ctx.at - 200), () => kit.rush({ ms: 260, color: 0xffe0b0, alpha: 0.35 }));
    kit.at(ctx.at, () => {
      const fist = ctx.from("fist");
      if (!ctx.lands) {
        kit.ring(fist.x + 30, fist.y, { from: 10, to: 70, color: 0xd7e3ff, thick: 5, ms: 240 });
        kit.burst(fist.x + 20, fist.y, { count: 6, colors: DULL, speed: [60, 200], size: [6, 10], life: [200, 380] });
        return;
      }
      const x = fist.x + 46, y = fist.y;
      kit.impact(x, y, { power: 1.35, color: 0xff8a3d, color2: 0xffd45e, shape: "shard" });
      kit.flash(0xffc070, 0.32, 140);
      kit.burst(x, y, { count: 26, colors: FIRE, speed: [120, 520], angle: 0, spread: 2.4, size: [10, 26], life: [300, 620], gravity: -380, add: true });
      kit.burst(x, y, { count: 10, colors: [0x3a2a2a, 0x5a4444], speed: [40, 160], size: [16, 30], life: [500, 900], gravity: -160, alpha: 0.55, fade: 1.2 });
    });
  },

  // PETAL AEGIS: red spathes wheel round into a shield. If it holds, they fly back as a counter.
  aegis(ctx) {
    const { kit } = ctx;
    const up = Math.max(0, ctx.at - 260);
    const life = ctx.lands ? ctx.at - up + 60 : 760;
    let centre = null;
    kit.at(up, () => {
      const face = ctx.from("face");
      centre = { x: face.x + 120, y: face.y - 40 };
      kit.ring(centre.x, centre.y, { from: 20, to: 190, color: 0xffb0b8, thick: 6, ms: 260 });
      kit.draw(life, (g, k, ms) => {
        const open = kit.ease.back(Math.min(1, ms / 170));
        const fade = ctx.lands ? 1 : 1 - kit.ease.in((k - 0.7) / 0.3);
        // the dome
        g.fillStyle(0xff5a6e, 0.16 * open * fade);
        g.fillEllipse(centre.x, centre.y, 200 * open, 330 * open);
        g.lineStyle(5, 0xffd0d6, 0.85 * fade);
        g.strokeEllipse(centre.x, centre.y, 200 * open, 330 * open);
        // six petals on a tilted wheel
        for (let i = 0; i < 6; i++) {
          const a = ms * 0.006 + (i / 6) * kit.TAU;
          const px = centre.x + Math.cos(a) * 62 * open;
          const py = centre.y + Math.sin(a) * 150 * open;
          const size = 34 + 10 * Math.cos(a);
          heartAt(g, px, py, size, a + Math.PI / 2, 0x9c1830, fade);
          heartAt(g, px, py, size * 0.72, a + Math.PI / 2, i % 2 ? 0xff4d5e : 0xff7a8a, fade);
        }
      });
    });
    if (!ctx.lands) return 0;
    const flight = 170;
    kit.at(ctx.at, () => {
      // whatever hit the shield bursts on it, and the petals answer
      kit.impact(centre.x + 60, centre.y, { power: 0.9, color: 0xffb0b8 });
      for (let i = 0; i < 6; i++) {
        const start = { x: centre.x + kit.rand(-30, 30), y: centre.y + (i - 2.5) * 52 };
        const end = { x: ctx.boss.x + kit.rand(-50, 50), y: ctx.boss.y + kit.rand(-90, 90) };
        flyer(kit, start, end, { ms: flight, delay: i * 12, rise: kit.rand(-40, 60), trail: (x, y) => kit.bit(x, y, { colors: PETAL, speed: [0, 40], size: [8, 14], life: [120, 240], add: true }) },
          (g, x, y, heading) => { heartAt(g, x, y, 40, heading, 0x9c1830); heartAt(g, x, y, 28, heading, 0xff5a6e); });
      }
    });
    kit.at(ctx.at + flight, () => {
      kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.1, color: 0xff4d5e, color2: 0xffb0b8, shape: "petal" });
      kit.burst(ctx.boss.x, ctx.boss.y, { count: 18, colors: PETAL, shape: "petal", speed: [160, 460], size: [14, 26], life: [400, 800], gravity: 500, spin: [-6, 6] });
    });
    return flight;
  },

  // FLAMINGO FLARE: a wheel of burning petals spins up over its hands, then corkscrews across.
  flare(ctx) {
    const { kit } = ctx;
    const flight = 300;
    const hub = () => { const a = ctx.from("handT"), b = ctx.from("fist"); return { x: (a.x + b.x) / 2 + 20, y: Math.min(a.y, b.y) - 56 }; };
    kit.draw(ctx.at, (g, k, ms) => {
      const c = hub();
      const size = kit.ease.out(k);
      for (let i = 0; i < 7; i++) {
        const a = ms * 0.012 + (i / 7) * kit.TAU;
        heartAt(g, c.x + Math.cos(a) * 58 * size, c.y + Math.sin(a) * 58 * size, 26 * size, a + Math.PI / 2, i % 2 ? 0xff4d5e : 0xff8a3d);
      }
    });
    kit.draw(ctx.at, (g, k) => { const c = hub(); g.fillStyle(0xffd45e, 0.5 * k); g.fillCircle(c.x, c.y, 44 * k); g.fillStyle(0xffffff, 0.8 * k); g.fillCircle(c.x, c.y, 20 * k); }, { add: true });
    kit.at(0, () => { const c = hub(); kit.gather(c.x, c.y, { count: 18, ms: ctx.at, from: [90, 190], colors: FIRE, size: [3, 6], add: true }); });
    kit.at(ctx.at, () => {
      const c = hub();
      kit.ring(c.x, c.y, { from: 30, to: 150, color: 0xff8a3d, thick: 7, ms: 240, add: true });
      for (let i = 0; i < 7; i++) {
        const end = ctx.lands ? { x: ctx.boss.x + kit.rand(-60, 60), y: ctx.boss.y + kit.rand(-100, 80) } : between(c, ctx.boss, 0.56 + kit.rand(-0.06, 0.06));
        flyer(kit, c, end, {
          ms: flight - 60 + i * 12, delay: i * 26, turns: 1.5, wide: 90, phase: i * 0.9, easeIn: true,
          trail: (x, y) => kit.bit(x, y, { colors: ctx.lands ? FIRE : DULL, speed: [0, 50], size: [10, 18], life: [140, 300], gravity: -200, add: ctx.lands }),
        }, (g, x, y, heading) => {
          heartAt(g, x, y, 36, heading, ctx.lands ? 0x9c1830 : 0x59607a);
          heartAt(g, x, y, 25, heading, ctx.lands ? 0xff6a4a : 0xa9b3cc);
        }, (x, y) => {
          if (ctx.lands) kit.burst(x, y, { count: 8, colors: FIRE, speed: [120, 380], size: [10, 20], life: [240, 460], add: true });
          else kit.burst(x, y, { count: 4, colors: DULL, speed: [40, 150], size: [6, 10], life: [200, 400], gravity: 400 });
        });
      }
    });
    if (!ctx.lands) return 0;
    kit.at(ctx.at + flight + 60, () => {
      kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.3, color: 0xff6a4a, color2: 0xff7a8a, shape: "petal" });
      kit.flash(0xff9a7a, 0.28, 150);
      kit.ring(ctx.boss.x, ctx.boss.y, { from: 40, to: 300, color: 0xffb0b8, thick: 6, ms: 420, add: true });
      kit.burst(ctx.boss.x, ctx.boss.y, { count: 30, colors: PETAL, shape: "heart", speed: [200, 560], size: [12, 22], life: [500, 900], gravity: 520, heading: true });
    });
    return flight + 60;
  },

  // INFERNO BLOOM: the sky goes dark, a burning flower opens on the ground under the boss, and a
  // pillar of fire comes up through it.
  inferno(ctx) {
    const { kit } = ctx;
    const g0 = ctx.bossGround;
    kit.dim({ ms: ctx.at + 1100, alpha: 0.7 });
    // Ember itself smoulders while it gathers the heat
    for (let t = 0; t < ctx.at; t += 50) {
      kit.at(t, () => {
        const pot = ctx.from("pot");
        kit.burst(pot.x, pot.y - 60, { count: 2, colors: FIRE, speed: [40, 160], angle: -Math.PI / 2, spread: 1.4, size: [8, 16], life: [400, 800], gravity: -220, radius: 120, add: true });
      });
    }
    kit.at(0, () => { const top = ctx.from("top"); kit.glow(top.x, top.y + 60, { from: 60, to: 230, color: 0xff6a3d, alpha: 0.45, ms: ctx.at, hold: 0.7 }); });
    // the flower drawn in fire on the ground
    kit.draw(ctx.at + 240, (g, k, ms) => {
      const open = kit.ease.out(Math.min(1, ms / (ctx.at * 0.8)));
      const beat = 1 + 0.06 * Math.sin(ms * 0.03);
      const gone = ms > ctx.at ? 1 - (ms - ctx.at) / 240 : 1;
      for (const [r, width, color] of [[210, 9, 0xff4d3d], [150, 5, 0xffd45e], [80, 4, 0xffffff]]) {
        g.lineStyle(width, color, 0.9 * gone);
        g.strokeEllipse(g0.x, g0.y, r * 2 * open * beat, r * 0.6 * open * beat);
      }
      for (let i = 0; i < 8; i++) {
        const a = ms * 0.0025 + (i / 8) * kit.TAU;
        const px = g0.x + Math.cos(a) * 150 * open, py = g0.y + Math.sin(a) * 45 * open;
        g.fillStyle(i % 2 ? 0xff8a3d : 0xff4d5e, 0.85 * gone);
        g.fillEllipse(px, py, 70 * open, 22 * open);
      }
    }, { layer: "back", add: true });
    kit.at(ctx.at * 0.25, () => kit.gather(g0.x, g0.y - 10, { count: 26, ms: ctx.at * 0.7, from: [160, 340], colors: FIRE, size: [3, 7], add: true }));
    for (let i = 0; i < 5; i++) {
      kit.at(ctx.at * 0.45 + i * 40, () => kit.crack(g0, { x: g0.x + Math.cos(i * 1.3 + 0.4) * 230, y: g0.y + Math.sin(i * 1.3 + 0.4) * 46 }, { ms: ctx.at * 0.55 + 300, color: 0xff6a3d }));
    }

    kit.at(ctx.at, () => {
      kit.flash(0xffd9a0, 0.5, 200);
      kit.shake(480, 0.012);
      // the pillar: ragged sheets of fire, widest at the start, hottest in the middle
      const edges = Array.from({ length: 30 }, () => kit.rand(-1, 1));
      const pillar = (g, ms, k, sheets) => {
        const wide = (k < 0.12 ? kit.ease.out(k / 0.12) : 1 - kit.ease.in((k - 0.45) / 0.55)) * 150;
        if (wide < 2) return;
        for (const [share, color, alpha] of sheets) {
          g.fillStyle(color, alpha);
          g.beginPath();
          const rows = 14;
          const side = (sign) => {
            for (let r = 0; r <= rows; r++) {
              const row = sign > 0 ? r : rows - r;
              const y = g0.y + 20 - row * 44;
              const flick = edges[(row + Math.floor(ms / 45) + (sign > 0 ? 0 : 7)) % edges.length] * 30 * share;
              const flare = row < 2 ? 1.5 - row * 0.25 : 1;
              const x = g0.x + sign * (wide * share * flare + flick);
              if (r === 0 && sign > 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
          };
          side(1); side(-1);
          g.closePath();
          g.fillPath();
        }
      };
      kit.draw(760, (g, k, ms) => pillar(g, ms, k, [[1.3, 0x8f1d1a, 0.8], [1.05, 0xe8402a, 0.95], [0.74, 0xff8a3d, 1], [0.44, 0xffd45e, 1], [0.18, 0xfff6d0, 1]]));
      kit.draw(760, (g, k, ms) => pillar(g, ms, k, [[1.7, 0xff5a2e, 0.22]]), { add: true });
      // the bloom: eight great petals open round the boss
      kit.draw(620, (g, k) => {
        const open = kit.ease.back(Math.min(1, k * 2));
        const alpha = 1 - kit.ease.in((k - 0.5) / 0.5);
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + (i / 8) * kit.TAU + k * 0.5;
          const x = ctx.boss.x + Math.cos(a) * 150 * open, y = ctx.boss.y + 40 + Math.sin(a) * 120 * open;
          heartAt(g, x, y, 84 * open, a, 0x8f1d1a, 0.9 * alpha);
          heartAt(g, x, y, 66 * open, a, 0xff4d5e, alpha);
          heartAt(g, x, y, 38 * open, a, 0xffb060, alpha);
        }
      });
      kit.ring(g0.x, g0.y, { from: 60, to: 520, squash: 0.3, color: 0xffd45e, thick: 12, ms: 520, layer: "back", add: true });
      kit.ring(g0.x, g0.y, { from: 30, to: 380, squash: 0.3, color: 0xffffff, thick: 7, ms: 420, delay: 80, layer: "back", add: true });
      kit.lines(ctx.boss.x, ctx.boss.y, { count: 16, inner: 120, outer: 330, color: 0xfff0b0, thick: 7, ms: 300 });
      kit.burst(g0.x, g0.y, { count: 70, colors: FIRE, speed: [200, 900], angle: -Math.PI / 2, spread: 1.5, size: [10, 24], life: [500, 1100], gravity: 500, add: true });
      kit.burst(g0.x, g0.y, { count: 16, colors: [0x4a3030, 0x2e2028], shape: "rock", speed: [200, 620], angle: -Math.PI / 2, spread: 2.2, size: [12, 24], life: [700, 1100], gravity: 1500, spin: [-8, 8], floor: g0.y + 20 });
    });
    for (let t = 80; t < 640; t += 50) {
      kit.at(ctx.at + t, () => kit.burst(g0.x, g0.y - 100, { count: 5, colors: FIRE, speed: [100, 420], angle: -Math.PI / 2, spread: 0.9, size: [12, 26], life: [300, 620], gravity: -300, radius: 80, add: true }));
    }
    kit.at(ctx.at + 620, () => kit.burst(g0.x, g0.y - 140, { count: 14, colors: [0x3a2a2a, 0x57444a], speed: [30, 120], size: [22, 44], life: [700, 1200], gravity: -140, radius: 110, alpha: 0.5, fade: 1.2 }));
    return 0;
  },

  // ---------------------------------------------------------------- ZEST

  // BLADE RUSH: three cuts so fast they hang in the air, then an X.
  bladeRush(ctx) {
    const { kit } = ctx;
    if (!ctx.lands) {
      kit.at(ctx.at, () => {
        const fist = ctx.from("fist");
        kit.slash(fist.x + 110, fist.y + 40, { angle: -0.5, length: 220, width: 22, color: 0xcfd8ea, ms: 240 });
        kit.burst(fist.x + 140, fist.y + 30, { count: 5, colors: DULL, shape: "leaf", speed: [60, 200], size: [8, 14], life: [240, 420], gravity: 400, spin: [-6, 6] });
      });
      return 0;
    }
    const cuts = [[-0.75, 0xf4ff8a, 0], [0.75, 0xc8f04a, 90], [-0.05, 0xffffff, 180]];
    kit.at(Math.max(0, ctx.at - 160), () => kit.rush({ ms: 420, color: 0xf4ff8a, alpha: 0.4 }));
    for (const [angle, color, wait] of cuts) {
      kit.at(ctx.at + wait, () => {
        const x = ctx.boss.x + kit.rand(-20, 20), y = ctx.boss.y + kit.rand(-20, 20);
        kit.slash(x, y, { angle, length: 380, width: 46, color: 0x2d6a1e, ms: 300, alpha: 0.9 });
        kit.slash(x, y, { angle, length: 360, width: 34, color, ms: 280, add: true });
        kit.slash(x, y, { angle, length: 340, width: 14, color: 0xffffff, ms: 240 });
        kit.burst(x, y, { count: 9, colors: LIME, shape: "leaf", speed: [200, 520], angle, spread: 1.2, size: [12, 22], life: [300, 560], gravity: 500, heading: true });
        kit.burst(x, y, { count: 6, colors: VOLT, shape: "streak", speed: [300, 700], size: [3, 5], life: [140, 260], add: true });
        kit.shake(90, 0.007);
      });
    }
    kit.at(ctx.at + 260, () => {
      kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.3, color: 0xc8f04a, color2: 0xf4ff8a, shape: "leaf" });
      kit.flash(0xf4ff8a, 0.25, 120);
    });
    return 260;
  },

  // STRIPE WALL: striped blades stab up out of the ground as a fence. If it holds, they launch.
  stripeWall(ctx) {
    const { kit } = ctx;
    const up = Math.max(0, ctx.at - 260);
    const hold = ctx.lands ? ctx.at - up + 40 : 720;
    const base = ctx.ground;
    const blades = [0, 1, 2, 3, 4].map((i) => ({ x: base.x + 150 + i * 30, tall: 250 - Math.abs(i - 2) * 34, tilt: (i - 2) * 0.07, wait: i * 30 }));
    const blade = (g, b, rise, alpha) => {
      const tipX = b.x + Math.sin(b.tilt) * b.tall * rise, tipY = base.y + 12 - b.tall * rise;
      const half = 22;
      g.fillStyle(0x1f5a1c, alpha); g.fillTriangle(b.x - half - 4, base.y + 14, b.x + half + 4, base.y + 14, tipX, tipY - 8);
      g.fillStyle(0x58c23a, alpha); g.fillTriangle(b.x - half, base.y + 12, b.x + half, base.y + 12, tipX, tipY);
      g.fillStyle(0xf4ff8a, alpha); g.fillTriangle(b.x - half * 0.5, base.y + 12, b.x + half * 0.15, base.y + 12, tipX, tipY);
      g.fillStyle(0xffffff, alpha * 0.8); g.fillTriangle(b.x + half * 0.5, base.y + 12, b.x + half * 0.72, base.y + 12, tipX, tipY);
    };
    kit.at(up, () => {
      kit.burst(base.x + 210, base.y + 10, { count: 14, colors: [0x7a5a3a, 0x5a3f28, 0xb8935a], shape: "rock", speed: [120, 380], angle: -Math.PI / 2, spread: 1.8, size: [8, 16], life: [300, 560], gravity: 1300, spin: [-8, 8], radius: 70, squash: 0.2 });
      kit.draw(hold, (g, k, ms) => {
        const alpha = ctx.lands ? 1 : 1 - kit.ease.in((k - 0.75) / 0.25);
        for (const b of blades) blade(g, b, kit.ease.back((ms - b.wait) / 150), alpha);
        // a shimmer that runs up the fence
        const sweep = (ms % 420) / 420;
        g.fillStyle(0xffffff, 0.35 * alpha);
        g.fillRect(base.x + 118, base.y - 250 * sweep, 150, 8);
      });
    });
    if (!ctx.lands) return 0;
    const flight = 150;
    kit.at(ctx.at, () => {
      kit.impact(base.x + 260, base.y - 150, { power: 0.9, color: 0xf4ff8a });
      blades.forEach((b, i) => {
        const start = { x: b.x, y: base.y - b.tall * 0.6 };
        const end = { x: ctx.boss.x + kit.rand(-50, 50), y: ctx.boss.y + (i - 2) * 46 };
        flyer(kit, start, end, { ms: flight, delay: i * 14, trail: (x, y) => kit.bit(x, y, { colors: LIME, speed: [0, 30], size: [6, 12], life: [100, 220], add: true }) },
          (g, x, y, heading) => {
            const cos = Math.cos(heading), sin = Math.sin(heading);
            const p = (a, s) => ({ x: x + cos * a - sin * s, y: y + sin * a + cos * s });
            const tip = p(70, 0), l = p(-60, -15), r = p(-60, 15), l2 = p(-60, -6), r2 = p(-60, 3);
            g.fillStyle(0x58c23a, 1); g.fillTriangle(l.x, l.y, r.x, r.y, tip.x, tip.y);
            g.fillStyle(0xf4ff8a, 1); g.fillTriangle(l2.x, l2.y, r2.x, r2.y, tip.x, tip.y);
          });
      });
    });
    kit.at(ctx.at + flight + 40, () => {
      kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.15, color: 0xc8f04a, color2: 0xffffff, shape: "leaf" });
      for (let i = 0; i < 3; i++) kit.slash(ctx.boss.x, ctx.boss.y + (i - 1) * 70, { angle: 0.05, length: 300, width: 16, color: 0xffffff, ms: 200, delay: i * 30 });
    });
    return flight + 40;
  },

  // CITRUS VOLT: a ball of lightning crackles between its hands, then jumps.
  citrusVolt(ctx) {
    const { kit } = ctx;
    const orb = () => { const a = ctx.from("handT"), b = ctx.from("fist"); return { x: (a.x + b.x) / 2 + 26, y: (a.y + b.y) / 2 - 50 }; };
    kit.draw(ctx.at + 120, (g, k, ms) => {
      const c = orb();
      const size = Math.min(1, ms / ctx.at);
      const flick = 1 + 0.15 * Math.sin(ms * 0.07);
      for (const [r, color, alpha] of [[70, 0xffe14a, 0.25], [46, 0xfff7a0, 0.55], [24, 0xffffff, 1]]) { g.fillStyle(color, alpha); g.fillCircle(c.x, c.y, r * size * flick); }
    }, { add: true });
    kit.at(0, () => { const c = orb(); kit.gather(c.x, c.y, { count: 20, ms: ctx.at, from: [80, 170], colors: VOLT, size: [3, 5], add: true }); });
    for (let t = 60; t < ctx.at; t += 70) {
      kit.at(t, () => {
        kit.bolt(() => ctx.from(t % 140 ? "handT" : "fist"), orb, { ms: 90, width: 4, forks: 0, jag: 16, step: 22 });
        const c = orb();
        kit.burst(c.x, c.y, { count: 2, colors: VOLT, shape: "streak", speed: [200, 420], size: [2, 4], life: [100, 200], add: true });
      });
    }
    kit.at(ctx.at, () => {
      const c = orb();
      const end = ctx.lands ? ctx.boss : { x: (c.x + ctx.boss.x) / 2 + 40, y: ctx.ground.y - 10 };
      kit.flash(0xfff7a0, ctx.lands ? 0.45 : 0.2, 130);
      kit.bolt(c, end, { ms: 340, width: 12, forks: 3, jag: 54 });
      kit.bolt(c, end, { ms: 300, width: 6, forks: 1, jag: 80, color: 0xc8f04a, delay: 40 });
      kit.shake(ctx.lands ? 260 : 120, ctx.lands ? 0.012 : 0.005);
      if (!ctx.lands) {
        kit.ring(end.x, end.y, { from: 10, to: 120, squash: 0.3, color: 0xfff7a0, thick: 5, ms: 260, layer: "back" });
        kit.burst(end.x, end.y, { count: 10, colors: VOLT, shape: "streak", speed: [200, 500], angle: -Math.PI / 2, spread: 2.4, size: [3, 5], life: [160, 300], add: true });
        return;
      }
      kit.impact(end.x, end.y, { power: 1.3, color: 0xffe14a, color2: 0xffffff, shape: "dia" });
      kit.burst(end.x, end.y, { count: 28, colors: VOLT, shape: "streak", speed: [300, 900], size: [3, 6], life: [180, 420], add: true, length: 90 });
      // the charge keeps crawling over the boss for a moment
      for (let t = 80; t < 460; t += 60) {
        kit.at(t, () => {
          const a = { x: end.x + kit.rand(-130, 130), y: end.y + kit.rand(-150, 130) };
          const b = { x: end.x + kit.rand(-130, 130), y: end.y + kit.rand(-150, 130) };
          kit.bolt(a, b, { ms: 90, width: 5, forks: 0, jag: 26, step: 28 });
        });
      }
    });
    return ctx.lands ? 40 : 0;
  },

  // SUNBURST: a little sun climbs over Zest and pours light on it, then spears the boss.
  sunburst(ctx) {
    const { kit } = ctx;
    kit.dim({ ms: ctx.at + 900, alpha: 0.6, color: 0x0a0a02 });
    let sun = null;
    kit.at(0, () => {
      const top = ctx.from("top");
      const start = { x: top.x + 20, y: top.y + 40 };
      const high = { x: top.x + 70, y: Math.max(96, top.y - 190) };
      sun = { ...start };
      kit.draw(ctx.at + 700, (g, k, ms) => {
        const rise = kit.ease.out(Math.min(1, ms / (ctx.at * 0.7)));
        sun.x = kit.lerp(start.x, high.x, rise);
        sun.y = kit.lerp(start.y, high.y, rise);
        const gone = ms > ctx.at + 420 ? 1 - (ms - ctx.at - 420) / 280 : 1;
        const size = (0.35 + 0.65 * rise) * gone;
        // rays: long and short, turning slowly
        for (let i = 0; i < 16; i++) {
          const a = ms * 0.0016 + (i / 16) * kit.TAU;
          const far = (i % 2 ? 150 : 230) * size * (1 + 0.08 * Math.sin(ms * 0.02 + i));
          const w = 0.11;
          g.fillStyle(i % 2 ? 0xffe14a : 0xfff7a0, 0.5);
          g.fillTriangle(sun.x + Math.cos(a - w) * 60 * size, sun.y + Math.sin(a - w) * 60 * size, sun.x + Math.cos(a + w) * 60 * size, sun.y + Math.sin(a + w) * 60 * size, sun.x + Math.cos(a) * far, sun.y + Math.sin(a) * far);
        }
        for (const [r, color, alpha] of [[110, 0xffb020, 0.25], [78, 0xffe14a, 0.7], [58, 0xfff7a0, 1], [36, 0xffffff, 1]]) { g.fillStyle(color, alpha); g.fillCircle(sun.x, sun.y, r * size); }
      }, { add: true });
    });
    // light pours down on Zest: shafts, rising pluses, a pulse on the ground
    kit.draw(ctx.at + 200, (g, k, ms) => {
      const pot = ctx.from("pot");
      const a = 0.26 * kit.ease.arc(k);
      for (let i = 0; i < 4; i++) {
        const x = pot.x - 110 + i * 62 + 12 * Math.sin(ms * 0.004 + i);
        g.fillStyle(0xfff7a0, a);
        g.fillTriangle(x - 12, 40, x + 30, 40, x + 60, ctx.ground.y + 10);
        g.fillTriangle(x - 12, 40, x + 60, ctx.ground.y + 10, x - 40, ctx.ground.y + 10);
      }
    }, { add: true, layer: "back" });
    for (let t = 200; t < ctx.at + 300; t += 70) {
      kit.at(t, () => {
        const pot = ctx.from("pot");
        kit.burst(pot.x, pot.y - 40, { count: 2, colors: [0x8dff9b, 0xd8ffb0, 0xfff7a0], shape: "plus", speed: [60, 160], angle: -Math.PI / 2, spread: 0.5, size: [16, 28], life: [600, 1000], gravity: -120, radius: 130, turn: 0, add: true });
        kit.burst(pot.x, pot.y - 20, { count: 2, colors: LIME, shape: "leaf", speed: [100, 240], angle: -Math.PI / 2, spread: 1.2, size: [10, 18], life: [500, 900], gravity: -60, radius: 140, spin: [-5, 5] });
      });
    }
    for (let i = 0; i < 3; i++) kit.at(260 + i * 220, () => kit.ring(ctx.ground.x, ctx.ground.y, { from: 30, to: 260, squash: 0.28, color: 0x8dff9b, thick: 7, ms: 520, layer: "back", add: true }));
    kit.at(ctx.at, () => {
      const pot = ctx.from("pot");
      kit.glow(pot.x, pot.y - 110, { from: 80, to: 240, color: 0x8dff9b, alpha: 0.5, ms: 420 });
      kit.flash(0xfff7a0, 0.4, 160);
      if (!ctx.lands) return;
      kit.beam(() => sun, ctx.boss, { width: 40, color: 0xffb020, mid: 0xffe14a, ms: 380, shoot: 0.14 });
    });
    if (!ctx.lands) return 0;
    kit.at(ctx.at + 90, () => {
      kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.1, color: 0xffe14a, color2: 0xffffff, shape: "dia" });
      kit.burst(ctx.boss.x, ctx.boss.y, { count: 20, colors: VOLT, speed: [160, 520], size: [8, 16], life: [300, 620], gravity: 300, add: true });
    });
    return 90;
  },

  // ---------------------------------------------------------------- SKILLS A FIGURE CAN BRING
  // (a tagged figure on a pad fights with its own skill: see server/creatures.json)

  // THORN BURST: a volley of thorns.
  thorns(ctx) {
    const { kit } = ctx;
    const flight = 170;
    for (let i = 0; i < 9; i++) {
      kit.at(Math.max(0, ctx.at - 60 + i * 24), () => {
        const start = ctx.from(i % 2 ? "fist" : "handT");
        const end = { x: ctx.boss.x + kit.rand(-60, 60), y: ctx.boss.y + kit.rand(-100, 90) };
        flyer(kit, start, end, { ms: flight, rise: kit.rand(-10, 40) }, (g, x, y, heading) => {
          const cos = Math.cos(heading), sin = Math.sin(heading);
          g.fillStyle(0xdfffc2, 1);
          g.fillTriangle(x + cos * 34, y + sin * 34, x - cos * 22 - sin * 9, y - sin * 22 + cos * 9, x - cos * 22 + sin * 9, y - sin * 22 - cos * 9);
          g.fillStyle(0x2f7a3a, 1);
          g.fillTriangle(x + cos * 26, y + sin * 26, x - cos * 20 - sin * 5, y - sin * 20 + cos * 5, x - cos * 20 + sin * 5, y - sin * 20 - cos * 5);
        }, (x, y) => kit.burst(x, y, { count: 5, colors: [0xdfffc2, 0x58b060, 0xffffff], shape: "shard", speed: [120, 360], size: [8, 14], life: [200, 380], heading: true }));
      });
    }
    kit.at(ctx.at + flight, () => kit.impact(ctx.boss.x, ctx.boss.y, { power: 1.2, color: 0xdfffc2, shape: "shard" }));
    return flight;
  },

  // PHOTOSYNTHESIS: sunbeams fall on the plant and it drinks them in.
  sunlight(ctx) {
    const { kit } = ctx;
    kit.draw(ctx.at + 400, (g, k, ms) => {
      const pot = ctx.from("pot");
      const a = 0.3 * kit.ease.arc(k);
      for (let i = 0; i < 4; i++) {
        const x = pot.x - 120 + i * 66 + 10 * Math.sin(ms * 0.005 + i);
        g.fillStyle(0xfff3a0, a);
        g.fillTriangle(x, 30, x + 44, 30, x + 80, ctx.ground.y + 10);
        g.fillTriangle(x, 30, x + 80, ctx.ground.y + 10, x - 30, ctx.ground.y + 10);
      }
    }, { add: true, layer: "back" });
    for (let t = 100; t < ctx.at + 300; t += 60) {
      kit.at(t, () => { const pot = ctx.from("pot"); kit.burst(pot.x, pot.y - 30, { count: 2, colors: [0x8dff9b, 0xfff3a0], shape: "plus", speed: [60, 170], angle: -Math.PI / 2, spread: 0.5, size: [14, 24], life: [600, 1000], gravity: -120, radius: 120, turn: 0, add: true }); });
    }
    kit.at(ctx.at, () => { const pot = ctx.from("pot"); kit.glow(pot.x, pot.y - 110, { from: 70, to: 220, color: 0x8dff9b, alpha: 0.5, ms: 420 }); kit.ring(ctx.ground.x, ctx.ground.y, { from: 30, to: 240, squash: 0.28, color: 0x8dff9b, thick: 7, ms: 480, layer: "back", add: true }); });
    return 0;
  },

  // BARK SHIELD: plates of bark slam down in front of the plant.
  bark(ctx) {
    const { kit } = ctx;
    const up = Math.max(0, ctx.at - 220);
    kit.at(up, () => {
      const face = ctx.from("face");
      const x = face.x + 150;
      kit.draw(760, (g, k, ms) => {
        const alpha = 1 - kit.ease.in((k - 0.75) / 0.25);
        for (let i = 0; i < 4; i++) {
          const drop = kit.ease.back((ms - i * 45) / 150);
          const y = kit.lerp(face.y - 520, face.y - 170 + i * 84, drop);
          g.fillStyle(0x2e1a0e, alpha); g.fillRect(x - 30 + (i % 2) * 14, y - 4, 60, 100);
          g.fillStyle(i % 2 ? 0x8a5a34 : 0x6e4426, alpha); g.fillRect(x - 26 + (i % 2) * 14, y, 52, 92);
          g.fillStyle(0xb8834c, alpha); g.fillRect(x - 20 + (i % 2) * 14, y + 8, 8, 70);
        }
      });
      kit.at(240, () => { kit.ring(x, face.y - 30, { from: 40, to: 250, color: 0xffe0b0, thick: 7, ms: 320 }); kit.shake(120, 0.006); });
    });
    if (!ctx.lands) return 0;
    kit.at(ctx.at + 120, () => kit.impact(ctx.boss.x, ctx.boss.y, { power: 0.9, color: 0xffe0b0, shape: "rock" }));
    return 120;
  },

  // ---------------------------------------------------------------- COMING AND GOING

  // Leaves swirl out of the ground where a plant arrives.
  arrive(ctx) {
    const { kit } = ctx;
    kit.at(ctx.at, () => {
      const pot = ctx.from("pot");
      const g0 = { x: pot.x, y: ctx.ground.y };
      kit.ring(g0.x, g0.y, { from: 30, to: 330, squash: 0.3, color: 0xffffff, thick: 9, ms: 420, layer: "back" });
      kit.ring(g0.x, g0.y, { from: 20, to: 240, squash: 0.3, color: ctx.plant.glow, thick: 7, ms: 520, delay: 60, layer: "back", add: true });
      kit.glow(pot.x, pot.y - 100, { from: 60, to: 260, color: ctx.plant.glow, alpha: 0.45, ms: 420 });
      kit.burst(g0.x, g0.y, { count: 22, colors: [0x57c264, 0x8be36a, ctx.plant.glow], shape: "leaf", speed: [200, 620], angle: -Math.PI / 2, spread: 2.2, size: [12, 22], life: [500, 900], gravity: 700, spin: [-7, 7] });
      kit.burst(g0.x, g0.y, { count: 12, colors: [0xffffff, ctx.plant.glow], shape: "star", speed: [80, 300], angle: -Math.PI / 2, spread: 2.6, size: [8, 16], life: [400, 800], gravity: -80, add: true });
    });
    return 0;
  },
};

// Runs a named effect and returns the extra ms before its damage arrives. An unknown name does
// nothing, so a move can be named before its effect exists.
export function playBattleFx(name, ctx) {
  const effect = BATTLE_FX[name];
  return (effect && effect(ctx)) || 0;
}
