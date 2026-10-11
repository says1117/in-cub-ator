// client/src/render/bossFx.js: What the boss's moves look like. Owner: Role 3 (client, art, demo).
// The boss has three moves, the same three the plants have, and each one looks like what it is:
//   attack   bite    a pair of huge jaws snaps shut on the plant
//   special  ray     its mouth opens, a ball of heat builds, and a beam burns across the field
//   guard    quake   it slams the ground: a crack races over and roots spike up under the plant
// data/bosses.js names the moves for each tier and gives each tier its own colours.
//
// An effect is given:
//   kit                      the paint box (render/fxKit.js)
//   palette                  this tier's colours: { hot, main, deep, core }
//   mouth()                  where the boss's mouth is right now
//   boss, bossGround         the middle of the boss, and the spot it stands on
//   target, targetGround     the middle of the plant, and the spot it stands on
//   lands                    true if this move hurts the plant this turn
//   blocked                  true if the plant's guard stopped it (it lands on the shield instead)
//   meet                     in a tie, the spot in the middle where both moves run into each other
//   roar(), lunge(dx, ms)    make the boss open its mouth, or throw itself forward and back
// It returns how many ms from now its blow arrives. The battle screen shows the damage then.

const between = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

// One jaw: a gum line with a row of fangs. dir is 1 for the upper jaw (fangs point down), -1 for the lower.
function jaw(g, x, y, width, dir, palette, alpha) {
  const fangs = 7;
  const curve = (s) => (1 - Math.pow(s * 2 - 1, 2)) * 34 * dir;      // the jaw bows away from the bite
  g.fillStyle(palette.deep, alpha);
  g.beginPath();
  for (let i = 0; i <= 12; i++) { const s = i / 12; const px = x - width / 2 + s * width, py = y - curve(s); if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
  for (let i = 12; i >= 0; i--) { const s = i / 12; g.lineTo(x - width / 2 + s * width, y - curve(s) - (44 + 22 * Math.sin(Math.PI * s)) * dir); }
  g.closePath();
  g.fillPath();
  for (let i = 0; i < fangs; i++) {
    const s = (i + 0.5) / fangs;
    const px = x - width / 2 + s * width;
    const py = y - curve(s);
    const long = (i % 2 ? 46 : 78) * (0.7 + 0.5 * Math.sin(Math.PI * s));
    const half = width / fangs * 0.42;
    g.fillStyle(0x3a1018, alpha); g.fillTriangle(px - half - 4, py - 2 * dir, px + half + 4, py - 2 * dir, px, py + (long + 8) * dir);
    g.fillStyle(0xfff3d6, alpha); g.fillTriangle(px - half, py, px + half, py, px, py + long * dir);
    g.fillStyle(0xd9b98a, alpha); g.fillTriangle(px + half * 0.2, py, px + half, py, px, py + long * dir);
  }
}

// A thorny root that stabs up out of the ground. rise: 0 hidden, 1 fully out.
function spike(g, x, groundY, tall, lean, rise, alpha) {
  if (rise <= 0) return;
  const tipX = x + lean * tall * rise, tipY = groundY - tall * rise;
  const half = 16 + tall * 0.07;
  g.fillStyle(0x2a1418, alpha); g.fillTriangle(x - half - 5, groundY + 10, x + half + 5, groundY + 10, tipX, tipY - 10);
  g.fillStyle(0x6b3a36, alpha); g.fillTriangle(x - half, groundY + 8, x + half, groundY + 8, tipX, tipY);
  g.fillStyle(0xa9655a, alpha); g.fillTriangle(x - half, groundY + 8, x - half * 0.2, groundY + 8, tipX, tipY);
  g.fillStyle(0xf2b8c0, alpha); g.fillTriangle(tipX - 7 * rise, tipY + 30 * rise, tipX + 7 * rise, tipY + 30 * rise, tipX, tipY);
  // thorns down its sides
  for (let i = 1; i <= 3; i++) {
    const s = i / 4;
    const cx = x + lean * tall * rise * s, cy = groundY - tall * rise * s;
    const w = half * (1 - s);
    const side = i % 2 ? 1 : -1;
    g.fillStyle(0xe8c9a8, alpha);
    g.fillTriangle(cx + side * w * 0.5, cy - 8, cx + side * w * 0.5, cy + 8, cx + side * (w + 20), cy - 6);
  }
}

export const BOSS_FX = {
  // BITE: jaws out of nowhere, as tall as the plant.
  bite(ctx) {
    const { kit, palette } = ctx;
    const shut = 430;
    ctx.roar();
    kit.at(120, () => ctx.lunge(ctx.lands || ctx.blocked ? -150 : -90, 300));
    // where the jaws close: on the plant, on its shield, or on thin air halfway there
    const where = ctx.lands ? ctx.target : ctx.blocked ? { x: ctx.target.x + 150, y: ctx.target.y - 20 } : ctx.meet || between(ctx.boss, ctx.target, 0.5);
    const size = ctx.lands ? 1 : 0.72;
    kit.draw(shut + 190, (g, k, ms) => {
      const appear = kit.ease.out(Math.min(1, ms / 150));
      const close = ms < 250 ? 0 : kit.ease.in(Math.min(1, (ms - 250) / (shut - 250)));
      const after = ms > shut ? (ms - shut) / 190 : 0;
      const gap = kit.lerp(230, 4, close) * size + after * 30;
      const alpha = appear * (1 - after);
      const shiver = ms < 250 ? Math.sin(ms * 0.09) * 5 : 0;
      jaw(g, where.x + shiver, where.y - gap, 330 * size, 1, palette, alpha);
      jaw(g, where.x - shiver, where.y + gap, 300 * size, -1, palette, alpha);
    });
    kit.draw(shut, (g, k) => { g.fillStyle(palette.main, 0.2 * kit.ease.arc(k)); g.fillEllipse(where.x, where.y, 420 * size, 420 * size); }, { add: true });
    kit.at(shut, () => {
      if (ctx.lands) {
        kit.impact(where.x, where.y, { power: 1.35, color: palette.main, color2: palette.hot, shape: "fang" });
        kit.slash(where.x, where.y, { angle: 0.9, length: 330, width: 34, color: palette.main, ms: 280, add: true });
        kit.slash(where.x, where.y, { angle: -0.9, length: 330, width: 34, color: palette.hot, ms: 280, add: true, delay: 50 });
        kit.flash(palette.main, 0.3, 140);
        kit.burst(where.x, where.y, { count: 12, colors: [0xfff3d6, 0xffffff], shape: "fang", speed: [200, 560], size: [10, 20], life: [400, 800], gravity: 1100, spin: [-10, 10] });
      } else {
        kit.ring(where.x, where.y, { from: 20, to: 150 * size, color: 0xffffff, thick: 6, ms: 240 });
        kit.burst(where.x, where.y, { count: 8, colors: [0xfff3d6, 0xd7e3ff], shape: "streak", speed: [200, 480], size: [3, 5], life: [140, 280] });
        kit.shake(90, 0.004);
      }
    });
    return shut;
  },

  // RAY: the beam. It is aimed for a moment first, so you see it coming.
  ray(ctx) {
    const { kit, palette } = ctx;
    const fire = 500;
    ctx.roar();
    const aim = ctx.lands ? ctx.target : ctx.blocked ? { x: ctx.target.x + 150, y: ctx.target.y - 20 } : { x: ctx.target.x - 40, y: ctx.target.y - 330 };
    const end = ctx.lands || ctx.blocked ? aim : ctx.meet || { x: -80, y: aim.y - 150 };
    // the build-up: a ball of heat in its mouth and a thin line showing where it will go
    kit.at(120, () => { const m = ctx.mouth(); kit.gather(m.x, m.y, { count: 26, ms: fire - 140, from: [90, 220], colors: [palette.hot, palette.main, 0xffffff], size: [3, 7], add: true }); });
    kit.draw(fire, (g, k, ms) => {
      const m = ctx.mouth();
      const size = kit.ease.in(k) * (1 + 0.2 * Math.sin(ms * 0.08));
      for (const [r, color, alpha] of [[96, palette.main, 0.25], [60, palette.hot, 0.6], [30, palette.core, 1]]) { g.fillStyle(color, alpha); g.fillCircle(m.x, m.y, r * size); }
      if (k > 0.3 && Math.floor(ms / 50) % 2) { g.lineStyle(3, palette.hot, 0.7); g.lineBetween(m.x, m.y, end.x, end.y); }
    }, { add: true });
    kit.at(fire, () => {
      const life = ctx.lands ? 560 : 320;
      kit.flash(palette.hot, ctx.lands ? 0.5 : 0.22, 160);
      kit.shake(life, ctx.lands ? 0.014 : 0.006);
      kit.beam(ctx.mouth, end, { width: ctx.lands ? 56 : 30, color: palette.main, mid: palette.hot, core: palette.core, ms: life, shoot: 0.12, holdUntil: 0.72 });
      const m = ctx.mouth();
      kit.ring(m.x, m.y, { from: 20, to: 170, color: palette.hot, thick: 8, ms: 260, add: true });
      kit.burst(m.x, m.y, { count: 12, colors: [palette.hot, palette.core], shape: "streak", speed: [200, 520], angle: Math.atan2(end.y - m.y, end.x - m.x), spread: 1.4, size: [3, 6], life: [160, 320], add: true });
      if (!ctx.lands && !ctx.blocked) return;
      for (let t = 0; t < life * 0.75; t += 36) {
        kit.at(t + 50, () => {
          kit.burst(aim.x, aim.y, { count: 4, colors: [palette.hot, palette.main, palette.core], speed: [200, 700], angle: 0, spread: 5.5, size: [8, 20], life: [200, 480], gravity: -200, add: true });
          if (ctx.lands) kit.burst(aim.x, ctx.targetGround.y, { count: 1, colors: [0x3a2a2a, 0x57444a], speed: [40, 140], angle: -Math.PI / 2, spread: 1.4, size: [22, 40], life: [500, 900], gravity: -160, alpha: 0.5, fade: 1.2 });
        });
      }
      kit.at(60, () => {
        if (ctx.lands) kit.impact(aim.x, aim.y, { power: 1.5, color: palette.main, color2: palette.hot, shape: "shard" });
        kit.glow(aim.x, aim.y, { from: 100, to: 260, color: palette.hot, alpha: 0.6, ms: life });
      });
    });
    return fire + 60;
  },

  // QUAKE: the counter. What it does when it is not countering is put up a wall of roots.
  quake(ctx) {
    const { kit, palette } = ctx;
    const g0 = ctx.bossGround;
    if (!ctx.lands) {
      // a wall of roots in front of itself: up, hold, down
      const wall = [0, 1, 2, 3].map((i) => ({ x: g0.x - 250 + i * 34, tall: 250 - Math.abs(i - 1.5) * 40, lean: -0.1 + i * 0.05, wait: i * 40 }));
      kit.burst(g0.x - 200, g0.y + 6, { count: 12, colors: [0x7a5a3a, 0x5a3f28], shape: "rock", speed: [120, 340], angle: -Math.PI / 2, spread: 1.8, size: [8, 16], life: [300, 560], gravity: 1300, spin: [-8, 8], radius: 60, squash: 0.2 });
      kit.draw(760, (g, k, ms) => {
        const down = kit.ease.in((k - 0.72) / 0.28);
        for (const s of wall) spike(g, s.x, g0.y, s.tall, s.lean, kit.ease.back((ms - s.wait) / 160) * (1 - down), 1);
      });
      kit.at(160, () => { kit.ring(g0.x - 200, g0.y, { from: 30, to: 220, squash: 0.3, color: 0xe8c9a8, thick: 6, ms: 320, layer: "back" }); kit.shake(110, 0.005); });
      return 220;
    }
    const strike = 470;
    const t0 = ctx.targetGround;
    kit.at(0, () => ctx.lunge(30, 240));
    kit.at(110, () => {
      kit.shake(360, 0.012);
      kit.ring(g0.x, g0.y, { from: 40, to: 300, squash: 0.3, color: palette.hot, thick: 10, ms: 380, layer: "back", add: true });
      kit.burst(g0.x, g0.y, { count: 14, colors: [0x7a5a3a, 0x5a3f28, 0xb8935a], shape: "rock", speed: [160, 460], angle: -Math.PI / 2, spread: 2.4, size: [10, 20], life: [400, 700], gravity: 1500, spin: [-8, 8], floor: g0.y + 16 });
      for (const spread of [-22, 0, 24]) kit.crack({ x: g0.x - 120, y: g0.y + 6 }, { x: t0.x + 40, y: t0.y + spread }, { ms: 900, race: 0.36, color: palette.main, core: palette.core });
    });
    // dust kicked up along the crack as it runs
    for (let i = 1; i <= 5; i++) {
      kit.at(110 + i * 55, () => { const p = between({ x: g0.x - 120, y: g0.y }, t0, i / 5); kit.burst(p.x, p.y, { count: 5, colors: [0xcbb08a, 0x9a7f5c], speed: [60, 220], angle: -Math.PI / 2, spread: 1.6, size: [10, 20], life: [300, 600], gravity: 300, alpha: 0.7, fade: 1.4 }); });
    }
    const spikes = [-2, -1, 0, 1, 2].map((i) => ({ x: t0.x + i * 46 + kit.rand(-8, 8), tall: 250 - Math.abs(i) * 56 + kit.rand(-14, 14), lean: i * 0.11, wait: Math.abs(i) * 34 }));
    kit.at(strike - 60, () => kit.glow(t0.x, t0.y, { from: 40, to: 240, squash: 0.3, color: palette.hot, alpha: 0.7, ms: 220, layer: "back" }));
    kit.at(strike, () => {
      kit.draw(900, (g, k, ms) => {
        const down = kit.ease.in((k - 0.7) / 0.3);
        for (const s of spikes) spike(g, s.x, t0.y, s.tall, s.lean, kit.ease.back((ms - s.wait) / 130) * (1 - down), 1);
      });
      kit.impact(t0.x, t0.y - 110, { power: 1.4, color: palette.hot, color2: 0xe8c9a8, shape: "rock" });
      kit.flash(palette.hot, 0.35, 140);
      kit.ring(t0.x, t0.y, { from: 40, to: 420, squash: 0.3, color: 0xffffff, thick: 10, ms: 460, layer: "back" });
      kit.burst(t0.x, t0.y, { count: 26, colors: [0x7a5a3a, 0x5a3f28, 0xb8935a, 0x3a2620], shape: "rock", speed: [260, 820], angle: -Math.PI / 2, spread: 1.9, size: [10, 24], life: [600, 1100], gravity: 1700, spin: [-9, 9], floor: t0.y + 18 });
      kit.burst(t0.x, t0.y - 40, { count: 18, colors: [palette.hot, palette.main, palette.core], speed: [200, 640], angle: -Math.PI / 2, spread: 2.2, size: [10, 22], life: [300, 620], gravity: -100, add: true });
      kit.burst(t0.x, t0.y - 30, { count: 12, colors: [0xcbb08a, 0x9a7f5c], speed: [60, 240], size: [24, 46], life: [600, 1000], gravity: -120, radius: 120, squash: 0.3, alpha: 0.6, fade: 1.3 });
    });
    return strike;
  },
};

// Runs a named boss effect and returns when its blow arrives, in ms from now.
export function playBossFx(name, ctx) {
  const effect = BOSS_FX[name];
  return (effect && effect(ctx)) || 0;
}
