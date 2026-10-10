import Phaser from 'phaser';

// Cast Iron Plant detail scene for Phaser 3.
// Required asset: public/assets/plants/cast-iron.png
export default class CastIronScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CastIronScene' });
    this.plant = { water: 70, light: 60, co2: 80, level: 3, xp: 65 };
  }

  init(data) {
    // Supply { plant: { water, light, co2, level, xp } } when opening the scene.
    this.plant = { water: 70, light: 60, co2: 80, level: 3, xp: 65, ...(data?.plant || {}) };
  }

  preload() {
    if (!this.textures.exists('castIronPlant')) {
      this.load.image('castIronPlant', '/assets/plants/cast_iron_big.png');
    }
  }

  create() {
    const { width: W, height: H } = this.scale;
    this.W = W;
    this.H = H;
    this.cameras.main.setBackgroundColor('#3b2419');
    this.drawBackground();
    this.drawHeader();
    this.drawPlant();
    this.drawActions();
    this.drawStats();
    this.drawAbout();
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
  }

  onResize() {
    // Rebuild layout for the new game size, without resetting plant stats.
    this.scene.restart({ plant: { ...this.plant } });
  }

  rect(x, y, w, h, fill, stroke = 0x20130e, line = 3, radius = 0) {
    const g = this.add.graphics();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(x, y, w, h, radius);
    if (line) {
      g.lineStyle(line, stroke, 1);
      g.strokeRoundedRect(x, y, w, h, radius);
    }
    return g;
  }

  label(x, y, value, size = 18, color = '#ffe0a3', options = {}) {
    return this.add.text(x, y, value, {
      fontFamily: 'monospace', fontSize: `${size}px`, fontStyle: 'bold',
      color, align: 'center', stroke: '#24150f', strokeThickness: 3,
      ...options
    }).setOrigin(0.5);
  }

  drawBackground() {
    const { W, H } = this;
    const g = this.add.graphics();
    g.fillGradientStyle(0x563421, 0x563421, 0x2c1b15, 0x2c1b15);
    g.fillRect(0, 0, W, H);
    // Seeded decorative soil pixels, stable across scene refreshes.
    let seed = 3719;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const colors = [0x6e4228, 0x7c4c2d, 0x382218, 0x84512e];
    for (let i = 0; i < Math.floor(W * H / 1700); i++) {
      const x = random() * W, y = random() * H;
      g.fillStyle(colors[Math.floor(random() * colors.length)], 0.55);
      g.fillRect(x, y, 3 + Math.floor(random() * 5), 3);
    }
    // Tiny grass tufts at the sides.
    for (let i = 0; i < 18; i++) {
      const x = (i % 2 === 0 ? 0.04 : 0.92) * W + random() * W * 0.045;
      const y = H * (0.13 + random() * 0.65);
      g.lineStyle(3, 0x59632c, 0.65);
      g.lineBetween(x, y, x - 6, y - 13);
      g.lineBetween(x, y, x + 5, y - 16);
      g.lineBetween(x, y, x, y - 18);
    }
  }

  drawHeader() {
    const { W, H } = this;
    const titleY = H * 0.07;
    const titleWidth = Math.min(W * 0.68, 510);
    this.rect(W / 2 - titleWidth / 2, titleY - 29, titleWidth, 58, 0x83502e, 0x24150e, 4, 8);
    this.label(W / 2, titleY, 'CAST IRON PLANT', Math.max(16, Math.min(29, W * 0.032)));
    this.rect(18, titleY - 25, 62, 50, 0x89522f, 0x21130c, 4, 8);
    const arrow = this.label(49, titleY, '←', 32);
    const hit = this.add.zone(49, titleY, 68, 58).setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => arrow.setColor('#ffffff'));
    hit.on('pointerout', () => arrow.setColor('#ffe0a3'));
    hit.on('pointerdown', () => {
      if (this.scene.manager.keys.StorageScene) this.scene.start('StorageScene');
      else console.warn('StorageScene has not been registered.');
    });
  }

  drawPlant() {
    const { W, H } = this;
    const centerY = H * 0.39;
    this.plantY = centerY;
    const glow = this.add.graphics();
    glow.fillStyle(0xb57a37, 0.12);
    glow.fillEllipse(W / 2, centerY, W * 0.43, H * 0.47);
    const shadow = this.add.graphics();
    shadow.fillStyle(0x1b110c, 0.55);
    shadow.fillEllipse(W / 2, H * 0.625, W * 0.26, 20);
    this.plantSprite = this.add.image(W / 2, centerY, 'castIronPlant');
    const target = Math.min(W * 0.47, H * 0.47, 410);
    this.plantSprite.setDisplaySize(target, target);
    this.tweens.add({ targets: this.plantSprite, y: centerY - 6, duration: 2300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    for (let i = 0; i < 6; i++) {
      const x = W / 2 + (i % 2 ? 1 : -1) * (target * (0.22 + (i % 3) * 0.13));
      const y = centerY - target * 0.28 + Math.floor(i / 2) * 54;
      const star = this.label(x, y, '✦', 16, '#ffd279');
      this.tweens.add({ targets: star, alpha: 0.25, duration: 800 + i * 140, yoyo: true, repeat: -1 });
    }
  }

  drawActions() {
    const { W, H } = this;
    const actions = [
      { name: 'WATER', icon: '💧', x: W * 0.17, y: H * 0.27, stat: 'water', amount: 10, color: 0x4fc7fa },
      { name: 'BRIGHTEN', icon: '☀', x: W * 0.83, y: H * 0.27, stat: 'light', amount: 10, color: 0xffc74d },
      { name: 'ADD CO₂', icon: 'CO₂', x: W * 0.17, y: H * 0.52, stat: 'co2', amount: 10, color: 0x9ce7a0 },
      { name: 'FERTILIZE', icon: '✿', x: W * 0.83, y: H * 0.52, stat: null, amount: 15, color: 0x94d56e }
    ];
    const radius = Math.max(29, Math.min(W * 0.07, H * 0.078, 62));
    actions.forEach(a => {
      const ring = this.add.graphics();
      ring.fillStyle(0x6a4026); ring.fillCircle(a.x, a.y, radius);
      ring.lineStyle(5, 0xeab975); ring.strokeCircle(a.x, a.y, radius);
      ring.lineStyle(3, 0x2c1b12); ring.strokeCircle(a.x, a.y, radius - 6);
      const symbol = this.label(a.x, a.y - 4, a.icon, a.icon === 'CO₂' ? radius * 0.5 : radius * 0.8, '#ffffff');
      symbol.setStroke('#332015', 3);
      this.rect(a.x - radius * 1.05, a.y + radius * 0.65, radius * 2.1, 29, 0xe8b875, 0x342015, 3, 4);
      this.label(a.x, a.y + radius * 0.65 + 14, a.name, Math.max(10, Math.min(15, radius * 0.29)), '#3b2315', { strokeThickness: 0 });
      const hit = this.add.zone(a.x, a.y, radius * 2.2, radius * 2.4).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => ring.setAlpha(0.75));
      hit.on('pointerout', () => ring.setAlpha(1));
      hit.on('pointerdown', () => this.applyAction(a));
    });
  }

  applyAction(action) {
    if (action.stat) {
      this.plant[action.stat] = Phaser.Math.Clamp(this.plant[action.stat] + action.amount, 0, 100);
    } else {
      this.plant.xp += action.amount;
      while (this.plant.xp >= 100) { this.plant.xp -= 100; this.plant.level += 1; }
    }
    this.refreshStats();
    this.particleBurst(action.icon, action.color);
    this.tweens.add({ targets: this.plantSprite, scaleX: this.plantSprite.scaleX * 1.035,
      scaleY: this.plantSprite.scaleY * 1.035, duration: 170, yoyo: true });
    this.events.emit('castiron:care', { action: action.name, plant: { ...this.plant } });
  }

  particleBurst(icon, color) {
    const { W, H } = this;
    for (let i = 0; i < 9; i++) {
      const x = W / 2 + Phaser.Math.Between(-75, 75);
      const y = H * 0.39 + Phaser.Math.Between(-40, 65);
      const p = this.label(x, y, icon, 16, '#ffffff');
      this.tweens.add({ targets: p, x: x + Phaser.Math.Between(-35, 35), y: y - Phaser.Math.Between(50, 120),
        alpha: 0, duration: 700 + i * 60, onComplete: () => p.destroy() });
    }
  }

  drawStats() {
    const { W, H } = this;
    const panelY = H * 0.69, panelH = H * 0.18;
    this.rect(W * 0.045, panelY, W * 0.91, panelH, 0x482918, 0xc18a4b, 4, 10);
    this.statWidgets = {};
    const entries = [
      { key: 'water', name: 'WATER', icon: '💧', color: 0x49bdf2 },
      { key: 'light', name: 'LIGHT', icon: '☀', color: 0xffc34a },
      { key: 'co2', name: 'CO₂', icon: '☁', color: 0x78d969 },
      { key: 'level', name: 'LEVEL', icon: '★', color: 0xa681f7 }
    ];
    const colW = W * 0.91 / 4;
    entries.forEach((e, i) => {
      const x = W * 0.045 + colW * (i + 0.5);
      const top = panelY + panelH * 0.19;
      this.label(x, top, e.icon, Math.min(29, H * 0.035), '#ffe2a7');
      this.label(x, panelY + panelH * 0.43, e.name, Math.max(10, Math.min(16, W * 0.018)));
      const barX = x - colW * 0.36, barY = panelY + panelH * 0.61;
      const barW = colW * 0.72, barH = Math.max(9, panelH * 0.115);
      const bg = this.add.graphics();
      bg.fillStyle(0x1e1816); bg.fillRoundedRect(barX, barY, barW, barH, 4);
      const fill = this.add.graphics();
      const text = this.label(x, panelY + panelH * 0.88, '', Math.max(10, Math.min(15, W * 0.019)), '#ffffff');
      this.statWidgets[e.key] = { fill, text, barX, barY, barW, barH, color: e.color };
      if (i < 3) {
        const div = this.add.graphics();
        div.lineStyle(2, 0x926039, 0.8);
        div.lineBetween(W * 0.045 + colW * (i + 1), panelY + 14,
          W * 0.045 + colW * (i + 1), panelY + panelH - 14);
      }
    });
    this.refreshStats();
  }

  refreshStats() {
    Object.entries(this.statWidgets).forEach(([key, widget]) => {
      const val = key === 'level' ? this.plant.xp : this.plant[key];
      widget.fill.clear();
      widget.fill.fillStyle(widget.color);
      widget.fill.fillRoundedRect(widget.barX + 2, widget.barY + 2,
        Math.max(0, (widget.barW - 4) * Phaser.Math.Clamp(val / 100, 0, 1)), widget.barH - 4, 3);
      widget.text.setText(key === 'level' ? `Lv. ${this.plant.level}` : `${this.plant[key]} / 100`);
    });
  }

  drawAbout() {
    const { W, H } = this;
    const y = H * 0.895, h = H * 0.085;
    this.rect(W * 0.045, y, W * 0.91, h, 0x482918, 0xb9854c, 4, 9);
    this.label(W * 0.14, y + h / 2, '🌿 ABOUT', Math.max(12, Math.min(19, W * 0.024)));
    this.add.text(W * 0.28, y + h / 2,
      'Tough and low-maintenance. Thrives in shade and indirect light.',
      { fontFamily: 'monospace', fontSize: `${Math.max(10, Math.min(16, W * 0.018))}px`,
        color: '#ffe0a3', wordWrap: { width: W * 0.64 } }).setOrigin(0, 0.5);
  }
}
