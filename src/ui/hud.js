import { PLACES, PLAY_HALF, WORLD_HALF, GRID_N, GRID_STEP, WATER_LEVEL, PAGODA, SHRINE } from '../world/layout.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(hf, planner) {
    this.hf = hf;
    this.planner = planner;
    this.root = $('hud');
    this.el = {
      speed: $('speed'),
      fill: $('g-fill'),
      dist: $('dist'),
      tod: $('tod'),
      place: $('place'),
      placeJp: document.querySelector('.place-jp'),
      placeAr: document.querySelector('.place-ar'),
      toast: $('toast'),
      chipCam: $('chip-cam'),
      chipTime: $('chip-time'),
      chipAuto: $('chip-auto'),
      chipSound: $('chip-sound'),
      minimap: $('minimap'),
    };
    this.ctx = this.el.minimap.getContext('2d');
    this.placeId = null;
    this.placeTimer = 0;
    this.toastTimer = 0;
    this.lastSpeed = -1;
    this.buildMap();
  }

  show() {
    this.root.hidden = false;
  }

  toggle() {
    this.root.classList.toggle('hidden-ui');
  }

  toast(text) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('show');
    this.toastTimer = 2.2;
  }

  // Pre-render the valley map: 1 px = 2 m
  buildMap() {
    const hf = this.hf;
    const size = 700;
    const scale = size / (PLAY_HALF * 2 + 60);
    this.mapScale = scale;
    this.mapHalf = PLAY_HALF + 30;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let j = 0; j < size; j++) {
      const z = -this.mapHalf + j / scale;
      for (let i = 0; i < size; i++) {
        const x = -this.mapHalf + i / scale;
        const h = hf.terrainHeight(x, z);
        const k = (j * size + i) * 4;
        if (h < WATER_LEVEL + 0.05) {
          img.data[k] = 70;
          img.data[k + 1] = 120;
          img.data[k + 2] = 140;
          img.data[k + 3] = 235;
        } else {
          const t = Math.min(1, h / 120);
          const e = hf.normalAt(x, z);
          const shade = 0.75 + (e.x * 0.4 - e.z * 0.3);
          img.data[k] = (58 + t * 40) * shade;
          img.data[k + 1] = (78 + t * 20) * shade;
          img.data[k + 2] = (56 + t * 30) * shade;
          img.data[k + 3] = 235;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // sakura dots
    ctx.fillStyle = 'rgba(244,169,196,0.8)';
    for (const t of [...this.planner.trees.sakura, ...this.planner.trees.weeping]) {
      const [px, py] = this.toMap(t.x, t.z);
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // road
    const r = hf.road;
    ctx.strokeStyle = 'rgba(247,242,233,0.92)';
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= r.count; i += 2) {
      const w = r.wrap(i);
      const [px, py] = this.toMap(r.x[w], r.z[w]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    // landmarks
    const mark = (x, z, color, rr = 5) => {
      const [px, py] = this.toMap(x, z);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    mark(PAGODA.x, PAGODA.z, '#d9472b', 7);
    mark(SHRINE.x, SHRINE.z, '#d9472b', 6);
    for (const b of hf.bridges) mark(b.x, b.z, b.type === 'red' ? '#d9472b' : '#c9a36a', 5);
    if (this.planner.toriiTunnel.length) {
      const t0 = this.planner.toriiTunnel[0];
      mark(t0.x, t0.z, '#d9472b', 5);
    }
    this.mapCanvas = c;
  }

  toMap(x, z) {
    return [(x + this.mapHalf) * this.mapScale, (z + this.mapHalf) * this.mapScale];
  }

  drawMinimap(bike) {
    const ctx = this.ctx;
    const W = this.el.minimap.width;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();
    // heading-up map: rotate so the rider always points up
    const [mx, my] = this.toMap(bike.pos.x, bike.pos.z);
    const zoom = 1.5;
    ctx.translate(W / 2, W / 2);
    ctx.rotate(Math.PI + bike.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-mx, -my);
    ctx.drawImage(this.mapCanvas, 0, 0);
    ctx.restore();
    // rider marker
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.fillStyle = '#f4a9c4';
    ctx.strokeStyle = '#1a1418';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    // north marker direction
    const north = document.querySelector('.mm-north');
    if (north) {
      const a = Math.PI + bike.yaw;
      const r = 62;
      const nx = Math.sin(-a) * -r;
      const ny = Math.cos(-a) * -r;
      north.style.transform = `translate(calc(-50% + ${nx.toFixed(1)}px), ${(ny + 64).toFixed(1)}px)`;
    }
  }

  update(dt, bike, timeLabel) {
    const kmh = Math.round(bike.speed * 3.6);
    if (kmh !== this.lastSpeed) {
      this.el.speed.textContent = kmh;
      const frac = Math.min(1, bike.speed * 3.6 / 45);
      this.el.fill.setAttribute('stroke-dasharray', `${(frac * 273).toFixed(1)} 365`);
      this.lastSpeed = kmh;
    }
    this.el.dist.textContent = `${(bike.distance / 1000).toFixed(2)} كم`;
    this.el.tod.textContent = timeLabel;
    this.drawMinimap(bike);

    // location banner
    let here = null;
    for (const p of PLACES) {
      if (Math.hypot(bike.pos.x - p.x, bike.pos.z - p.z) < p.r) {
        here = p;
        break;
      }
    }
    if (here && here.id !== this.placeId) {
      this.placeId = here.id;
      this.el.placeJp.replaceChildren(...[...here.jp].map((ch) => Object.assign(document.createElement('span'), { textContent: ch })));
      this.el.placeAr.textContent = here.ar;
      this.el.place.classList.add('show');
      this.placeTimer = 5;
    } else if (!here && this.placeId && this.placeTimer <= 0) {
      this.placeId = null;
    }
    if (this.placeTimer > 0) {
      this.placeTimer -= dt;
      if (this.placeTimer <= 0) this.el.place.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }
  }
}
