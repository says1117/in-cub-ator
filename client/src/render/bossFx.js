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

// ------------------------------------------------------------------ the Sporeling Trio's moves
// Three mushrooms, so every move is made of three: a three-bite combo, three lobbed spore bombs, and
// three stamps that send a web of glowing threads under the plant before mushrooms burst up.
const SPORE_COLORS = [0xff9ad0, 0xb890ff, 0xffffff, 0xe0508f];

// One jaw of a round, blunt-toothed mouth. y is the inner edge, where it meets the other jaw; dir is
// 1 for the upper jaw (its body is above y, its teeth hang down) and -1 for the lower.
function lip(g, x, y, width, dir, color, alpha) {
  const h = width * 0.3, left = x - width / 2;
  const bodyTop = dir > 0 ? y - h : y;
  g.fillStyle(0x2a1030, alpha); g.fillRoundedRect(left - 6, bodyTop - 6, width + 12, h + 12, h * 0.5);
  g.fillStyle(color, alpha); g.fillRoundedRect(left, bodyTop, width, h, h * 0.45);
  g.fillStyle(0xffffff, alpha * 0.3); g.fillRoundedRect(left + width * 0.08, bodyTop + (dir > 0 ? h * 0.12 : h * 0.55), width * 0.4, h * 0.22, 6);
  const tooth = width * 0.1;
  g.fillStyle(0x2a1030, alpha);
  for (let i = 0; i < 6; i++) g.fillRect(left + width * 0.1 + i * width * 0.145 - 2, dir > 0 ? y - 4 : y - tooth * 1.1 - 2, tooth + 4, tooth * 1.1 + 6);
  g.fillStyle(0xfff6ec, alpha);
  for (let i = 0; i < 6; i++) g.fillRect(left + width * 0.1 + i * width * 0.145, dir > 0 ? y - 2 : y - tooth * 1.1, tooth, tooth * 1.1);
}

// A mushroom shooting up out of the ground. rise: 0 hidden, 1 fully grown.
function shroom(g, x, groundY, tall, rise, color, alpha) {
  if (rise <= 0) return;
  const h = tall * rise, w = tall * 0.2 * Math.min(1, rise * 1.6);
  g.fillStyle(0x2a1030, alpha); g.fillRoundedRect(x - w / 2 - 4, groundY - h - 2, w + 8, h + 10, 8);
  g.fillStyle(0xfff0dc, alpha); g.fillRoundedRect(x - w / 2, groundY - h, w, h + 6, 6);
  const cw = tall * 0.62 * Math.min(1, rise * 1.3), ch = tall * 0.36 * Math.min(1, rise * 1.3);
  g.fillStyle(0x2a1030, alpha); g.fillEllipse(x, groundY - h, cw + 10, ch + 10);
  g.fillStyle(color, alpha); g.fillEllipse(x, groundY - h, cw, ch);
  g.fillStyle(0xffffff, alpha * 0.8);
  g.fillCircle(x - cw * 0.2, groundY - h - ch * 0.12, cw * 0.07);
  g.fillCircle(x + cw * 0.15, groundY - h - ch * 0.22, cw * 0.05);
  g.fillCircle(x + cw * 0.28, groundY - h - ch * 0.02, cw * 0.06);
}

BOSS_FX.gnash = function gnash(ctx) {
  // SPORE GNASH: all three snap at the plant, one after another, left to right
  const { kit, palette } = ctx;
  ctx.act("gnash");
  const mouths = ctx.mouths();
  const closes = [300, 430, 560];       // when each one's jaws shut: the rig's own dives land about here
  const where = ctx.lands ? ctx.target : ctx.blocked ? { x: ctx.target.x + 150, y: ctx.target.y - 20 } : ctx.meet || between(ctx.boss, ctx.target, 0.5);
  const spots = [-70, 0, 70].map((dx, i) => ({ x: where.x + dx * (ctx.lands ? 1 : 0.5), y: where.y + (i === 1 ? -36 : 8) }));
  mouths.forEach((m, i) => {
    const t = closes[i];
    // a puff of spores leaves each mouth as it winds up
    kit.at(t - 150, () => kit.burst(m.x, m.y, { count: 8, colors: SPORE_COLORS, shape: "dia", speed: [80, 260], angle: Math.PI, spread: 1.5, size: [6, 13], life: [300, 600], gravity: -40, add: true }));
    const size = [0.7, 0.85, 1.15][i] * (ctx.lands ? 1 : 0.75);
    const at = spots[i];
    kit.draw(t + 230, (g, k, ms) => {
      const appear = kit.ease.out(Math.min(1, ms / 90));
      const close = ms < t - 140 ? 0 : kit.ease.in(Math.min(1, (ms - (t - 140)) / 140));
      const after = ms > t ? (ms - t) / 230 : 0;
      const gap = kit.lerp(150, 6, close) * size + after * 24;
      const alpha = appear * (1 - after);
      lip(g, at.x, at.y - gap, 190 * size, 1, 0xd878a8, alpha);
      lip(g, at.x, at.y + gap, 180 * size, -1, 0xc0609a, alpha);
    }, { delay: Math.max(0, t - 250) });
    kit.at(t, () => {
      if (ctx.lands) {
        const last = i === 2;
        kit.impact(at.x, at.y, { power: last ? 1.3 : 0.6, color: palette.main, color2: palette.hot, shape: "petal" });
        kit.burst(at.x, at.y, { count: last ? 22 : 9, colors: SPORE_COLORS, shape: "dia", speed: [120, 520], size: [8, 20], life: [500, 1100], gravity: -80, add: true });
        if (last) kit.flash(palette.main, 0.28, 140);
      } else {
        kit.ring(at.x, at.y, { from: 20, to: 110, color: 0xffffff, thick: 5, ms: 220 });
        kit.burst(at.x, at.y, { count: 6, colors: SPORE_COLORS, shape: "dia", speed: [100, 300], size: [6, 12], life: [300, 600], gravity: -40 });
        if (i === 2) kit.shake(90, 0.004);
      }
    });
  });
  return closes[2] + 40;
};

BOSS_FX.volley = function volley(ctx) {
  // SPORE CANNON: they breathe in, heave, and lob three spore bombs high over the field. They
  // burst into a cloud that hangs where the plant stands.
  const { kit, palette } = ctx;
  ctx.act("volley");
  const mouths = ctx.mouths();
  const fire = 320, flight = 300;
  mouths.forEach((m, i) => {
    kit.at(30 + i * 40, () => kit.gather(m.x, m.y, { count: 14, ms: fire - 120, from: [70, 150], colors: SPORE_COLORS, size: [3, 6], add: true }));
  });
  const aims = ctx.lands ? [-45, 0, 45] : [-60, 10, 80];
  const end = (i) => {
    if (ctx.lands) return { x: ctx.target.x + aims[i], y: ctx.target.y - 20 + Math.abs(aims[i]) * 0.2 };
    if (ctx.blocked) return { x: ctx.target.x + 150 + aims[i] * 0.5, y: ctx.target.y - 20 };
    if (ctx.meet) return { x: ctx.meet.x + aims[i], y: ctx.meet.y };
    return { x: ctx.target.x - 120 + aims[i], y: ctx.targetGround.y - 10 };
  };
  mouths.forEach((m, i) => {
    const start = fire + i * 70;
    const to = end(i);
    kit.at(start, () => {
      kit.burst(m.x, m.y, { count: 8, colors: SPORE_COLORS, shape: "dia", speed: [160, 420], angle: Math.atan2(to.y - m.y, to.x - m.x), spread: 1.2, size: [6, 12], life: [200, 400], add: true });
      kit.ring(m.x, m.y, { from: 10, to: 90, color: palette.hot, thick: 6, ms: 220, add: true });
    });
    // the bomb: a glowing ball on a high arc, shedding spores
    kit.draw(flight, (g, k, ms) => {
      const x = kit.lerp(m.x, to.x, k), y = kit.lerp(m.y, to.y, k) - Math.sin(Math.PI * k) * 190;
      const r = 20 + 6 * Math.sin(ms * 0.05);
      for (const [rr, color, a] of [[r * 1.9, palette.main, 0.25], [r * 1.3, palette.hot, 0.6], [r * 0.7, palette.core, 1]]) { g.fillStyle(color, a); g.fillCircle(x, y, rr); }
      if (Math.floor(ms / 28) !== Math.floor((ms - 16) / 28)) kit.burst(x, y, { count: 2, colors: SPORE_COLORS, shape: "dia", speed: [20, 120], size: [5, 11], life: [300, 600], gravity: 60, add: true });
    }, { add: true, delay: start });
    kit.at(start + flight, () => {
      if (ctx.lands || ctx.blocked) {
        kit.impact(to.x, to.y, { power: ctx.lands ? (i === 1 ? 1.2 : 0.7) : 0.6, color: palette.main, color2: palette.hot, shape: "petal" });
      } else {
        kit.ring(to.x, to.y, { from: 20, to: 130, squash: 0.4, color: palette.hot, thick: 6, ms: 300, layer: "back" });
      }
      // the cloud it leaves: big soft puffs that rise slowly and linger
      kit.burst(to.x, to.y, { count: 8, colors: [0xb890ff, 0xff9ad0, 0xe6d0ff], speed: [30, 150], size: [26, 52], life: [1100, 1900], gravity: -35, radius: 36, alpha: 0.5, fade: 1.2, drag: 0.93 });
      kit.burst(to.x, to.y, { count: 14, colors: SPORE_COLORS, shape: "dia", speed: [60, 420], size: [6, 14], life: [700, 1500], gravity: -70, add: true });
      if (i === 1 && ctx.lands) kit.flash(palette.main, 0.3, 160);
      kit.shake(100, 0.006);
    });
  });
  return fire + flight + 20;
};

BOSS_FX.mycelium = function mycelium(ctx) {
  // MYCELIUM QUAKE: they stamp one after another and glowing threads race through the ground
  // under the plant, then a ring of mushrooms bursts up. Used to counter, it only raises a row.
  const { kit, palette } = ctx;
  const g0 = ctx.bossGround;
  ctx.act("mycelium");
  const caps = [0.1, 0.5, 0.9].map((s) => ({ x: g0.x - 220 + s * 400, y: g0.y + 6 }));
  const stamps = [190, 320, 450];
  if (!ctx.lands) {
    // a row of mushrooms springs up in front of the Trio: up, hold, down
    const row = [0, 1, 2, 3, 4].map((i) => ({ x: g0.x - 300 + i * 42, tall: 150 + (i % 2) * 40, color: [0xd878a8, 0x8f6bff][i % 2], wait: i * 35 }));
    kit.draw(760, (g, k, ms) => {
      const down = kit.ease.in((k - 0.72) / 0.28);
      for (const m of row) shroom(g, m.x, g0.y + 8, m.tall, kit.ease.back((ms - 180 - m.wait) / 150) * (1 - down), m.color, 1);
    });
    caps.forEach((c, i) => kit.at(stamps[i], () => { kit.ring(c.x, c.y, { from: 20, to: 150, squash: 0.3, color: palette.hot, thick: 5, ms: 260, layer: "back" }); kit.shake(80, 0.004); }));
    return 220;
  }
  const t0 = ctx.targetGround;
  const strike = 560;
  caps.forEach((c, i) => {
    kit.at(stamps[i], () => {
      kit.shake(120, 0.008);
      kit.ring(c.x, c.y, { from: 30, to: 210, squash: 0.3, color: palette.hot, thick: 8, ms: 320, layer: "back", add: true });
      kit.burst(c.x, c.y, { count: 8, colors: SPORE_COLORS, shape: "dia", speed: [80, 300], angle: -Math.PI / 2, spread: 2.4, size: [8, 16], life: [400, 800], gravity: 200, add: true });
      kit.crack({ x: c.x, y: c.y }, { x: t0.x + (i - 1) * 40, y: t0.y + (i - 1) * 12 }, { ms: 800, race: 0.5, color: palette.main, core: 0xffffff });
    });
    // the thread glows on its way: spores trail along the ground
    for (let n = 1; n <= 4; n++) {
      kit.at(stamps[i] + n * 50, () => {
        const p = between(c, { x: t0.x + (i - 1) * 40, y: t0.y }, n / 5);
        kit.burst(p.x, p.y, { count: 4, colors: SPORE_COLORS, shape: "dia", speed: [30, 140], angle: -Math.PI / 2, spread: 1.8, size: [5, 11], life: [300, 650], gravity: -20, add: true });
      });
    }
  });
  kit.at(strike - 60, () => kit.glow(t0.x, t0.y, { from: 40, to: 230, squash: 0.3, color: palette.hot, alpha: 0.7, ms: 240, layer: "back" }));
  const ring = [-3, -2, -1, 0, 1, 2, 3].map((i) => ({ x: t0.x + i * 46 + kit.rand(-8, 8), tall: 230 - Math.abs(i) * 30 + kit.rand(-14, 14), color: [0xd878a8, 0x8f6bff, 0xff9ad0][Math.abs(i) % 3], wait: Math.abs(i) * 30 }));
  kit.at(strike, () => {
    kit.draw(900, (g, k, ms) => {
      const down = kit.ease.in((k - 0.7) / 0.3);
      for (const m of ring) shroom(g, m.x, t0.y + 8, m.tall, kit.ease.back((ms - m.wait) / 140) * (1 - down), m.color, 1);
    });
    kit.impact(t0.x, t0.y - 110, { power: 1.35, color: palette.hot, color2: 0xffffff, shape: "petal" });
    kit.flash(palette.main, 0.32, 150);
    kit.ring(t0.x, t0.y, { from: 40, to: 420, squash: 0.3, color: 0xffffff, thick: 10, ms: 460, layer: "back" });
    kit.burst(t0.x, t0.y - 40, { count: 30, colors: SPORE_COLORS, shape: "dia", speed: [200, 700], angle: -Math.PI / 2, spread: 2.4, size: [8, 20], life: [500, 1100], gravity: 120, add: true });
    kit.burst(t0.x, t0.y - 30, { count: 10, colors: [0xb890ff, 0xff9ad0, 0xe6d0ff], speed: [40, 200], size: [30, 60], life: [900, 1600], gravity: -50, radius: 120, squash: 0.3, alpha: 0.5, fade: 1.2 });
    kit.shake(320, 0.012);
  });
  return strike;
};

// Runs a named boss effect and returns when its blow arrives, in ms from now.
export function playBossFx(name, ctx) {
  const effect = BOSS_FX[name];
  return (effect && effect(ctx)) || 0;
}
