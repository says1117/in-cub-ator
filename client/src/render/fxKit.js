// client/src/render/fxKit.js: The paint box every battle effect is made from. Owner: Role 3 (client, art, demo).
// Sparks, beams, lightning, slashes, shockwaves, screen flashes. Nothing here knows about plants
// or bosses: render/battleFx.js and render/bossFx.js put these together into moves.
//
//   const kit = createFxKit(scene, { back, front });     // two layers: behind the fighters and in front of them
//   kit.burst(x, y, { count: 20, colors: [0xffd45e] });  // bits flying outward
//   kit.beam(a, b, { color: 0xff5040, ms: 400 });        // a beam between two points
//   kit.at(300, () => kit.shake(200, 0.01));             // do something a little later
//
// Everything is drawn fresh every frame and removes itself when its time is up, so an effect never
// has anything to tidy away. All positions are on the 1280 x 720 battle stage.
import Phaser from "phaser";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const range = (v, fallback) => (Array.isArray(v) ? rand(v[0], v[1]) : v ?? fallback);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, k) => a + (b - a) * k;
export const ease = {
  out: (k) => 1 - Math.pow(1 - clamp01(k), 3),
  in: (k) => Math.pow(clamp01(k), 3),
  inOut: (k) => { const c = clamp01(k); return c * c * (3 - 2 * c); },
  back: (k) => { const c = clamp01(k) - 1; return 1 + 2.7 * c * c * c + 1.7 * c * c; },
  arc: (k) => Math.sin(Math.PI * clamp01(k)),
};

// Outlines for bits, one unit big, pointing right. A bit is one of these, turned and sized.
const SHAPES = {
  sq: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]],
  dia: [[-0.6, 0], [0, -0.6], [0.6, 0], [0, 0.6]],
  shard: [[-0.7, -0.22], [0.8, 0], [-0.7, 0.22]],
  leaf: [[-0.9, 0], [-0.3, -0.36], [0.4, -0.3], [1, 0], [0.4, 0.3], [-0.3, 0.36]],
  petal: [[-0.8, 0], [-0.2, -0.5], [0.5, -0.42], [0.9, 0], [0.5, 0.42], [-0.2, 0.5]],
  heart: [[0.9, 0], [0.2, -0.75], [-0.5, -0.8], [-0.85, -0.35], [-0.5, 0], [-0.85, 0.35], [-0.5, 0.8], [0.2, 0.75]],
  plus: [[-0.2, -0.6], [0.2, -0.6], [0.2, -0.2], [0.6, -0.2], [0.6, 0.2], [0.2, 0.2], [0.2, 0.6], [-0.2, 0.6], [-0.2, 0.2], [-0.6, 0.2], [-0.6, -0.2], [-0.2, -0.2]],
  star: [[1, 0], [0.28, -0.28], [0, -1], [-0.28, -0.28], [-1, 0], [-0.28, 0.28], [0, 1], [0.28, 0.28]],
  fang: [[-0.5, -0.5], [0.5, -0.5], [0, 0.9]],
  rock: [[-0.6, -0.2], [-0.1, -0.6], [0.6, -0.3], [0.5, 0.4], [-0.2, 0.6]],
};

function mixColor(a, b, k) {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, k);
  const bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function fillShape(g, shape, x, y, size, turn, stretch = 1) {
  const points = SHAPES[shape] || SHAPES.sq;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  g.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = points[i][0] * size * stretch;
    const py = points[i][1] * size;
    const sx = x + px * cos - py * sin;
    const sy = y + px * sin + py * cos;
    if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
  }
  g.closePath();
  g.fillPath();
}

export function createFxKit(scene, layers) {
  // four sheets to draw on: behind and in front of the fighters, each plain and glowing
  const sheets = {};
  for (const where of ["back", "front"]) {
    for (const glow of [false, true]) {
      const g = scene.add.graphics();
      if (glow) g.setBlendMode(Phaser.BlendModes.ADD);
      layers[where].add(g);
      sheets[where + (glow ? "+" : "")] = g;
    }
  }
  const sheetFor = (o) => sheets[(o.layer === "back" ? "back" : "front") + (o.add ? "+" : "")];

  let drawings = [];      // { start, ms, draw(g, k, ms), sheet }
  let bits = [];
  let now = scene.time.now;
  const timers = new Set();

  function update(time, delta) {
    now = time;
    const dt = Math.min(delta, 50) / 1000;
    for (const g of Object.values(sheets)) g.clear();

    const stillDrawing = [];
    for (const d of drawings) {
      const k = (time - d.start) / d.ms;
      if (k < 0) { stillDrawing.push(d); continue; }
      if (k >= 1) { if (d.done) d.done(); continue; }
      d.draw(d.sheet, k, time - d.start);
      stillDrawing.push(d);
    }
    drawings = stillDrawing;

    const alive = [];
    for (const b of bits) {
      b.age += dt;
      if (b.age < 0) { alive.push(b); continue; }
      if (b.age >= b.life) continue;
      const slow = Math.pow(b.drag, dt * 60);
      b.vx = b.vx * slow + b.ax * dt;
      b.vy = b.vy * slow + b.ay * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.floor !== undefined && b.y > b.floor) { b.y = b.floor; b.vy *= -0.38; b.vx *= 0.6; }
      b.turn += b.spin * dt;
      const k = b.age / b.life;
      const size = lerp(b.size, b.sizeEnd, k);
      const alpha = b.alpha * (b.fade ? 1 - Math.pow(k, b.fade) : 1);
      if (size <= 0.2 || alpha <= 0.01) { alive.push(b); continue; }
      const color = b.colorEnd === undefined ? b.color : mixColor(b.color, b.colorEnd, k);
      const g = b.sheet;
      if (b.shape === "streak") {
        const speed = Math.hypot(b.vx, b.vy) || 1;
        const len = Math.min(b.length, speed * 0.06) * (1 - k * 0.5);
        g.lineStyle(size, color, alpha);
        g.lineBetween(b.x, b.y, b.x - (b.vx / speed) * len, b.y - (b.vy / speed) * len);
      } else {
        g.fillStyle(color, alpha);
        if (b.shape === "sq" && !b.spin) g.fillRect(b.x - size / 2, b.y - size / 2, size, size);
        else fillShape(g, b.shape, b.x, b.y, size, b.heading ? Math.atan2(b.vy, b.vx) : b.turn, b.stretch);
      }
      alive.push(b);
    }
    bits = alive;
  }

  scene.events.on(Phaser.Scenes.Events.UPDATE, update);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, update);
    for (const timer of timers) timer.remove(false);
  });

  const kit = {
    rand, pick, ease, lerp, mixColor, TAU,
    get now() { return now; },

    // Runs fn after ms. Use this for every step of an effect so it all stops with the scene.
    at(ms, fn) {
      if (ms <= 0) { fn(); return; }
      const timer = scene.time.delayedCall(ms, () => { timers.delete(timer); fn(); });
      timers.add(timer);
    },

    // Draws something for ms: draw(g, k, elapsed) is called every frame with k going from 0 to 1.
    // o.layer: "front" (default) or "back".  o.add: true for a glowing, light-adding drawing.  o.delay: ms to wait.
    draw(ms, draw, o = {}) {
      drawings.push({ start: now + (o.delay || 0), ms, draw, sheet: sheetFor(o), done: o.done });
    },

    // One flying bit. See burst() for the options.
    bit(x, y, o = {}) {
      const angle = range(o.angle, rand(0, TAU)) + rand(-(o.spread ?? 0), o.spread ?? 0) / 2;
      const speed = range(o.speed, 200);
      const size = range(o.size, 8);
      bits.push({
        x, y,
        vx: Math.cos(angle) * speed + (o.vx || 0), vy: Math.sin(angle) * speed + (o.vy || 0),
        ax: o.pullX || 0, ay: o.gravity ?? 0,
        drag: o.drag ?? 0.95,
        age: -(range(o.delay, 0)) / 1000, life: range(o.life, 500) / 1000,
        size, sizeEnd: o.shrink === false ? size : size * (o.endSize ?? 0.1),
        color: Array.isArray(o.colors) ? pick(o.colors) : o.color ?? 0xffffff,
        colorEnd: o.colorEnd,
        alpha: o.alpha ?? 1, fade: o.fade ?? 2.5,
        shape: o.shape || "sq", turn: o.turn ?? rand(0, TAU), spin: range(o.spin, 0), stretch: o.stretch ?? 1,
        heading: Boolean(o.heading), length: o.length ?? 60, floor: o.floor,
        sheet: sheetFor(o),
      });
    },

    // Bits flying out from a point.
    //   count, colors, shape (sq dia shard leaf petal heart plus star fang rock streak)
    //   speed [min, max] px a second, angle (radians, where they head) and spread (how wide a fan)
    //   size [min, max], life [min, max] ms, gravity, drag (1 keeps speed, lower slows), spin
    //   heading: true to point where they fly.   floor: a height they bounce on.
    //   add: true to glow.   layer: "back" to go behind the fighters.   radius: start scattered this far out.
    burst(x, y, o = {}) {
      const count = o.count ?? 12;
      for (let i = 0; i < count; i++) {
        const out = o.radius ? rand(0, o.radius) : 0;
        const where = rand(0, TAU);
        kit.bit(x + Math.cos(where) * out, y + Math.sin(where) * out * (o.squash ?? 1), o);
      }
    },

    // Bits that are pulled in to a point from all round it: something charging up.
    gather(x, y, o = {}) {
      const count = o.count ?? 14;
      const ms = o.ms ?? 400;
      for (let i = 0; i < count; i++) {
        const angle = rand(0, TAU);
        const far = range(o.from, 120);
        const life = rand(ms * 0.5, ms);
        kit.bit(x + Math.cos(angle) * far, y + Math.sin(angle) * far, {
          ...o, angle: angle + Math.PI, speed: (far / life) * 1000, spread: 0, drag: 1, life, delay: rand(0, ms - life),
          shape: o.shape || "streak", heading: true, endSize: 0.5, fade: 6,
        });
      }
    },

    // A ring that swells and fades. squash below 1 lays it flat on the ground.
    ring(x, y, o = {}) {
      const from = o.from ?? 10;
      const to = o.to ?? 140;
      kit.draw(o.ms ?? 320, (g, k) => {
        const r = lerp(from, to, ease.out(k));
        g.lineStyle(Math.max(1.6, (o.thick ?? 8) * (1 - k)), o.color ?? 0xffffff, (o.alpha ?? 1) * (1 - k * k));
        g.strokeEllipse(x, y, r * 2, r * 2 * (o.squash ?? 1));
      }, o);
    },

    // A soft ball of light that swells and fades. o.hold: 0 to 1, the share of its life at full strength.
    glow(x, y, o = {}) {
      const from = o.from ?? o.r ?? 40;
      const to = o.to ?? from;
      kit.draw(o.ms ?? 300, (g, k) => {
        const r = lerp(from, to, ease.out(k));
        const a = (o.alpha ?? 0.5) * (k < (o.hold ?? 0) ? 1 : 1 - (k - (o.hold ?? 0)) / (1 - (o.hold ?? 0)));
        for (let i = 0; i < 4; i++) {
          g.fillStyle(i === 3 ? (o.core ?? 0xffffff) : (o.color ?? 0xffffff), a * (0.2 + i * 0.16));
          g.fillEllipse(x, y, r * 2 * (1 - i * 0.22), r * 2 * (1 - i * 0.22) * (o.squash ?? 1));
        }
      }, { add: true, ...o });
    },

    // Straight lines bursting out from a point: the mark of a hard hit.
    lines(x, y, o = {}) {
      const count = o.count ?? 10;
      const spokes = Array.from({ length: count }, (_, i) => ({
        a: (o.angle ?? 0) + (i / count) * (o.fan ?? TAU) + rand(-0.12, 0.12), len: rand(0.6, 1),
      }));
      kit.draw(o.ms ?? 220, (g, k) => {
        const inner = lerp(o.inner ?? 30, o.outer ?? 150, ease.out(k) * 0.75);
        g.lineStyle(Math.max(1.6, (o.thick ?? 6) * (1 - k)), o.color ?? 0xffffff, 1 - k);
        for (const s of spokes) {
          const outer = inner + (o.outer ?? 150) * 0.45 * s.len * (1 - k * 0.5);
          g.lineBetween(x + Math.cos(s.a) * inner, y + Math.sin(s.a) * inner, x + Math.cos(s.a) * outer, y + Math.sin(s.a) * outer);
        }
      }, o);
    },

    // A spiky star that pops and fades: the middle of an impact.
    star(x, y, o = {}) {
      const points = o.points ?? 8;
      const turn = o.turn ?? rand(0, 1);
      kit.draw(o.ms ?? 240, (g, k) => {
        const size = lerp(o.from ?? 0.3, 1, ease.back(Math.min(1, k * 2.2))) * (o.size ?? 80);
        g.fillStyle(o.color ?? 0xffffff, (o.alpha ?? 1) * (1 - Math.pow(k, 3)));
        g.beginPath();
        for (let i = 0; i < points * 2; i++) {
          const a = turn + k * (o.spin ?? 0.4) + (i / (points * 2)) * TAU;
          const r = i % 2 ? size * (o.inner ?? 0.42) : size;
          if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        g.fillPath();
      }, o);
    },

    // A curved cut through the air. angle: which way the cut travels. bow: how curved.
    slash(x, y, o = {}) {
      const angle = o.angle ?? -0.6;
      const length = o.length ?? 260;
      const bow = (o.bow ?? 0.32) * length;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const along = (s, off) => ({ x: x + cos * s - sin * off, y: y + sin * s + cos * off });
      kit.draw(o.ms ?? 240, (g, k) => {
        // the cut is drawn from tail to tip as it opens, then thins away
        const head = ease.out(Math.min(1, k * 2.4));
        const tail = ease.in(Math.max(0, (k - 0.35) / 0.65));
        const width = (o.width ?? 34) * (1 - tail * 0.7);
        const steps = 14;
        const outer = [];
        const inner = [];
        for (let i = 0; i <= steps; i++) {
          const s = lerp(tail, head, i / steps);
          const u = s * 2 - 1;                       // -1 to 1 along the cut
          const curve = (1 - u * u) * bow;
          const thick = (1 - u * u) * width * Math.sin(Math.PI * clamp01((i / steps) * 0.9 + 0.1));
          outer.push(along(u * length / 2, -curve));
          inner.push(along(u * length / 2, -curve + thick));
        }
        g.fillStyle(o.color ?? 0xffffff, (o.alpha ?? 1) * (1 - tail));
        g.beginPath();
        outer.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
        inner.reverse().forEach((p) => g.lineTo(p.x, p.y));
        g.closePath();
        g.fillPath();
      }, o);
    },

    // A beam between two points. from and to can be functions, for a beam that follows something.
    //   width, color, core (the bright middle), ms.   o.grow: share of its life spent widening (default 0.15)
    beam(from, to, o = {}) {
      const at = (p) => (typeof p === "function" ? p() : p);
      kit.draw(o.ms ?? 400, (g, k, ms) => {
        const a = at(from), b = at(to);
        const grow = o.grow ?? 0.15;
        const open = k < grow ? ease.out(k / grow) : 1 - ease.in((k - (o.holdUntil ?? 0.7)) / (1 - (o.holdUntil ?? 0.7)));
        const flicker = 1 + 0.12 * Math.sin(ms * 0.09);
        const width = (o.width ?? 40) * Math.max(0, open) * flicker;
        if (width < 1) return;
        const reach = o.shoot ? ease.out(k / (o.shoot ?? 0.12)) : 1;
        const ex = lerp(a.x, b.x, reach), ey = lerp(a.y, b.y, reach);
        for (const [share, color, alpha] of [[1.9, o.color ?? 0xff5040, 0.22], [1.25, o.color ?? 0xff5040, 0.55], [0.8, o.mid ?? o.color ?? 0xffa060, 0.9], [0.36, o.core ?? 0xffffff, 1]]) {
          g.lineStyle(width * share, color, alpha);
          g.lineBetween(a.x, a.y, ex, ey);
          g.fillStyle(color, alpha);
          g.fillCircle(a.x, a.y, width * share * 0.62);
          g.fillCircle(ex, ey, width * share * 0.75);
        }
      }, { add: true, ...o });
    },

    // Lightning between two points. It jumps to a new shape many times a second.
    bolt(from, to, o = {}) {
      const at = (p) => (typeof p === "function" ? p() : p);
      let path = null;
      let nextAt = 0;
      const forks = [];
      const build = (a, b, jag, steps) => {
        const points = [a];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        for (let i = 1; i < steps; i++) {
          const s = i / steps;
          const off = rand(-jag, jag) * Math.sin(Math.PI * s) + rand(-jag, jag) * 0.25;
          points.push({ x: a.x + dx * s - (dy / len) * off, y: a.y + dy * s + (dx / len) * off });
        }
        points.push(b);
        return points;
      };
      const stroke = (g, points, width, color, alpha) => {
        g.lineStyle(width, color, alpha);
        g.fillStyle(color, alpha);
        for (let i = 1; i < points.length; i++) {
          g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
          g.fillRect(points[i].x - width / 2, points[i].y - width / 2, width, width);
        }
      };
      kit.draw(o.ms ?? 260, (g, k, ms) => {
        if (ms >= nextAt) {
          const a = at(from), b = at(to);
          const steps = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (o.step ?? 46)));
          path = build(a, b, o.jag ?? 40, steps);
          forks.length = 0;
          for (let i = 0; i < (o.forks ?? 2); i++) {
            const start = path[Math.floor(rand(1, path.length - 2))];
            const dir = Math.atan2(b.y - a.y, b.x - a.x) + rand(-1.1, 1.1);
            const far = rand(50, 130);
            forks.push(build(start, { x: start.x + Math.cos(dir) * far, y: start.y + Math.sin(dir) * far }, 18, 4));
          }
          nextAt = ms + (o.every ?? 50);
        }
        const alpha = 1 - Math.pow(k, 4);
        const width = (o.width ?? 9) * (1 - k * 0.4);
        stroke(g, path, width * 3, o.color ?? 0xfff27a, alpha * 0.25);
        stroke(g, path, width * 1.5, o.color ?? 0xfff27a, alpha * 0.8);
        stroke(g, path, width * 0.6, o.core ?? 0xffffff, alpha);
        for (const fork of forks) stroke(g, fork, width * 0.55, o.color ?? 0xfff27a, alpha * 0.8);
      }, { add: true, ...o });
    },

    // A jagged crack that races along the ground from a to b and glows.
    crack(a, b, o = {}) {
      const steps = Math.max(5, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 34));
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const s = i / steps;
        points.push({ x: lerp(a.x, b.x, s) + (i % steps ? rand(-10, 10) : 0), y: lerp(a.y, b.y, s) + (i % steps ? rand(-9, 9) : 0) });
      }
      kit.draw(o.ms ?? 700, (g, k) => {
        const shown = Math.max(1, Math.floor(ease.out(k / (o.race ?? 0.35)) * steps));
        const alpha = 1 - ease.in((k - 0.6) / 0.4);
        for (const [width, color, a2] of [[13, 0x1a0d12, 0.85], [7, o.color ?? 0xff7a3d, 1], [2.5, o.core ?? 0xfff0b0, 1]]) {
          g.lineStyle(width, color, a2 * alpha);
          for (let i = 1; i <= shown; i++) g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
        }
      }, { layer: "back", ...o });
    },

    // The whole screen flashes a colour.
    flash(color = 0xffffff, alpha = 0.6, ms = 160) {
      kit.draw(ms, (g, k) => {
        g.fillStyle(color, alpha * (1 - k));
        g.fillRect(-40, -40, 1360, 800);
      });
    },

    // Darkens the world behind the fighters so a big move stands out. Returns nothing: it lifts by itself.
    dim(o = {}) {
      const ms = o.ms ?? 1200;
      const inMs = o.in ?? 160, outMs = o.out ?? 260;
      kit.draw(ms, (g, k, elapsed) => {
        const a = Math.min(1, elapsed / inMs, (ms - elapsed) / outMs);
        g.fillStyle(o.color ?? 0x05030f, (o.alpha ?? 0.62) * Math.max(0, a));
        g.fillRect(-40, -40, 1360, 800);
      }, { layer: "back" });
    },

    // Streaks rushing across the whole screen: speed.
    rush(o = {}) {
      const count = o.count ?? 16;
      const lines = Array.from({ length: count }, () => ({ y: rand(120, 560), x: rand(-200, 1280), len: rand(120, 380), speed: rand(1800, 3200), thick: rand(2, 6) }));
      kit.draw(o.ms ?? 420, (g, k, ms) => {
        const alpha = (o.alpha ?? 0.55) * ease.arc(k);
        for (const line of lines) {
          const x = ((line.x + (ms / 1000) * line.speed * (o.dir ?? 1)) % 1700 + 1700) % 1700 - 200;
          g.lineStyle(line.thick, o.color ?? 0xffffff, alpha);
          g.lineBetween(x, line.y, x + line.len, line.y);
        }
      }, o);
    },

    shake(ms = 160, strength = 0.008) { scene.cameras.main.shake(ms, Math.min(strength, 0.012)); },

    // A quick zoom in and back: the screen flinches with a hit.
    punch(amount = 0.03, ms = 160) {
      const cam = scene.cameras.main;
      scene.tweens.killTweensOf(cam);
      cam.setZoom(1);
      scene.tweens.add({ targets: cam, zoom: 1 + amount, duration: ms * 0.35, yoyo: true, ease: "Quad.easeOut", onComplete: () => cam.setZoom(1) });
    },

    // The usual marks of a blow landing, sized by `power` (1 is a normal hit, 2 is huge).
    impact(x, y, o = {}) {
      const power = o.power ?? 1;
      const color = o.color ?? 0xffe680;
      kit.star(x, y, { size: 70 * power, color: 0xffffff, ms: 180 });
      kit.star(x, y, { size: 56 * power, color, ms: 260, add: true, turn: 0.4 });
      kit.lines(x, y, { count: 12, inner: 40 * power, outer: 170 * power, color: 0xffffff, thick: 6 });
      kit.ring(x, y, { from: 30, to: 170 * power, color, thick: 9, ms: 320 });
      kit.glow(x, y, { r: 100 * power, color, alpha: 0.35, ms: 240 });
      kit.burst(x, y, { count: Math.round(14 * power), colors: [0xffffff, color, o.color2 ?? color], speed: [240, 620 * power], size: [6, 13], life: [260, 520], gravity: 900, shape: o.shape || "sq", spin: [-8, 8] });
      kit.shake(140 + 60 * power, 0.005 + 0.004 * power);
      kit.punch(0.018 * power);
    },
  };
  return kit;
}
