import * as THREE from 'three';
import { mulberry32 } from './noise.js';

// ---------- periodic gradient noise for tileable textures ----------
function makePeriodicNoise(seed) {
  const rnd = mulberry32(seed);
  const G = 256;
  const gx = new Float32Array(G * G);
  const gy = new Float32Array(G * G);
  for (let i = 0; i < G * G; i++) {
    const a = rnd() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y, period) {
    const x0 = Math.floor(x),
      y0 = Math.floor(y);
    const fx = x - x0,
      fy = y - y0;
    const X0 = ((x0 % period) + period) % period;
    const Y0 = ((y0 % period) + period) % period;
    const X1 = (X0 + 1) % period;
    const Y1 = (Y0 + 1) % period;
    const g = (ix, iy, dx, dy) => {
      const k = (iy & 255) * G + (ix & 255);
      return gx[k] * dx + gy[k] * dy;
    };
    const u = fade(fx),
      v = fade(fy);
    const a = g(X0, Y0, fx, fy);
    const b = g(X1, Y0, fx - 1, fy);
    const c = g(X0, Y1, fx, fy - 1);
    const d = g(X1, Y1, fx - 1, fy - 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.414;
  };
}

const pnoise = makePeriodicNoise(1234);

export function tileFbm(u, v, basePeriod, octaves = 4, gain = 0.5) {
  let sum = 0,
    amp = 1,
    norm = 0,
    p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * p, v * p, p);
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finishTexture(tex, { srgb = true, repeat = true, aniso = 8, mips = true } = {}) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = aniso;
  tex.generateMipmaps = mips;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Height field (Float32Array size*size) -> normal map DataTexture
function normalFromHeight(hgt, size, strength) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = hgt[y * size + ((x - 1 + size) % size)];
      const r = hgt[y * size + ((x + 1) % size)];
      const d = hgt[((y - 1 + size) % size) * size + x];
      const u = hgt[((y + 1) % size) * size + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (y * size + x) * 4;
      data[k] = (nx * 0.5 + 0.5) * 255;
      data[k + 1] = (ny * 0.5 + 0.5) * 255;
      data[k + 2] = (nz * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finishTexture(tex, { srgb: false });
}

// ---------- terrain ----------
export function makeTerrainTextures() {
  const S = 256;
  const hgt = new Float32Array(S * S);
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S,
        v = y / S;
      const n1 = tileFbm(u, v, 8, 4);
      const n2 = tileFbm(u + 0.37, v + 0.11, 32, 3);
      const n3 = tileFbm(u + 0.7, v + 0.5, 64, 2);
      const h = n1 * 0.5 + n2 * 0.35 + n3 * 0.25;
      hgt[y * S + x] = h;
      const b = 0.86 + n1 * 0.12 + n2 * 0.1 + n3 * 0.08;
      const k = (y * S + x) * 4;
      // slight hue variation (yellower / bluer patches)
      img.data[k] = Math.min(255, 255 * b * (1 + n1 * 0.06));
      img.data[k + 1] = Math.min(255, 255 * b);
      img.data[k + 2] = Math.min(255, 255 * b * (1 - n1 * 0.08));
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = finishTexture(new THREE.CanvasTexture(c));
  const normalMap = normalFromHeight(hgt, S, 3.0);
  return { map, normalMap };
}

// ---------- bark ----------
export function makeBarkTexture(kind = 'sakura') {
  const W = 256,
    H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const hgt = new Float32Array(W * W);
  const base = kind === 'sakura' ? [74, 52, 48] : kind === 'cedar' ? [92, 60, 44] : [86, 76, 66];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W,
        v = y / H;
      let n;
      if (kind === 'cedar') {
        // vertical fibrous strips
        n = tileFbm(u * 1, v * 0.25, 16, 4) * 0.7 + tileFbm(u, v, 64, 2) * 0.3;
      } else {
        // horizontal lenticels typical of cherry bark
        const lent = Math.max(0, tileFbm(u * 0.25, v * 2, 8, 3) - 0.25) * 2.2;
        n = tileFbm(u, v, 8, 5) * 0.55 - lent * 0.6;
      }
      const b = 0.8 + n * 0.45;
      const k = (y * W + x) * 4;
      img.data[k] = Math.max(0, Math.min(255, base[0] * b));
      img.data[k + 1] = Math.max(0, Math.min(255, base[1] * b));
      img.data[k + 2] = Math.max(0, Math.min(255, base[2] * b));
      img.data[k + 3] = 255;
      if (y % 2 === 0 && x < W) hgt[(y >> 1) * W + x] = n;
    }
  }
  ctx.putImageData(img, 0, 0);
  const map = finishTexture(new THREE.CanvasTexture(c));
  const normalMap = normalFromHeight(hgt, W, 4.0);
  return { map, normalMap };
}

// ---------- foliage cards ----------
function drawFivePetal(ctx, x, y, r, rot, col, centerCol) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = col;
  for (let i = 0; i < 5; i++) {
    ctx.rotate((Math.PI * 2) / 5);
    ctx.beginPath();
    // notched petal (cherry blossom petals have a small notch at the tip)
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(r * 0.55, -r * 0.2, r * 0.62, -r * 0.95, r * 0.12, -r * 1.02);
    ctx.lineTo(0, -r * 0.86);
    ctx.lineTo(-r * 0.12, -r * 1.02);
    ctx.bezierCurveTo(-r * 0.62, -r * 0.95, -r * 0.55, -r * 0.2, 0, 0);
    ctx.fill();
  }
  ctx.fillStyle = centerCol;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  // stamens
  ctx.strokeStyle = centerCol;
  ctx.lineWidth = Math.max(1, r * 0.05);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
    ctx.stroke();
  }
  ctx.restore();
}

// Sakura blossom cluster card (RGBA with alpha cut-out)
export function makeBlossomTexture(seed = 3, palette = 'sakura') {
  const S = 512;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  const pinks =
    palette === 'weeping'
      ? ['#f7b9cf', '#f4a6c1', '#fbd0de', '#f19bb8', '#fde2eb']
      : ['#fbd6e1', '#f8c3d4', '#f4b0c6', '#fde6ee', '#f7bdd0', '#fff4f7'];
  // a few fine twigs
  ctx.strokeStyle = '#6b4a42';
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    ctx.lineWidth = 1.5 + rnd() * 1.5;
    ctx.beginPath();
    const x0 = S / 2 + (rnd() - 0.5) * 80,
      y0 = S * 0.98;
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(S / 2 + (rnd() - 0.5) * 300, S * 0.5, S * 0.5 + (rnd() - 0.5) * 380, S * 0.12 + rnd() * 120);
    ctx.stroke();
  }
  // flower clumps concentrated in a soft round blob
  const count = 230;
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6) * S * 0.42;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S / 2 + Math.sin(a) * rr * 0.9;
    const r = 13 + rnd() * 13;
    const col = pinks[Math.floor(rnd() * pinks.length)];
    const shade = 0.82 + rnd() * 0.18;
    ctx.globalAlpha = 1;
    ctx.filter = `brightness(${shade})`;
    if (rnd() < 0.12) {
      // bud
      ctx.fillStyle = palette === 'weeping' ? '#e2728f' : '#e98ea8';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.3, r * 0.42, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawFivePetal(ctx, x, y, r, rnd() * Math.PI, col, rnd() < 0.5 ? '#d9637f' : '#c4485f');
    }
  }
  ctx.filter = 'none';
  // a few fresh leaves
  for (let i = 0; i < 10; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.75;
    const y = S / 2 + (rnd() - 0.5) * S * 0.7;
    ctx.fillStyle = rnd() < 0.5 ? '#8a9a4a' : '#9c7a4a';
    ctx.beginPath();
    ctx.ellipse(x, y, 5, 11, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

export function makeLeafTexture(kind = 'maple', seed = 5) {
  const S = 512;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, S, S);
  ctx.strokeStyle = kind === 'bamboo' ? '#6d7d3a' : '#4a3226';
  ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 2 + rnd() * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S);
    ctx.quadraticCurveTo(S / 2 + (rnd() - 0.5) * 200, S * 0.55, S / 2 + (rnd() - 0.5) * 420, S * 0.1 + rnd() * 150);
    ctx.stroke();
  }
  const count = kind === 'maple' ? 90 : kind === 'bamboo' ? 70 : kind === 'pine' ? 220 : 120;
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.6) * S * 0.42;
    const x = S / 2 + Math.cos(a) * rr;
    const y = S / 2 + Math.sin(a) * rr;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI * 2);
    if (kind === 'maple') {
      const cols = ['#b3261e', '#c9342a', '#9d1c1c', '#d8452f', '#e0643a', '#8a1a22'];
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const r = 18 + rnd() * 14;
      ctx.beginPath();
      // seven-lobed palmate leaf
      for (let k = 0; k <= 14; k++) {
        const ang = -Math.PI / 2 + ((k / 14) * Math.PI * 2);
        const rad = k % 2 === 0 ? r : r * 0.42;
        const px = Math.cos(ang) * rad;
        const py = Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'bamboo') {
      const cols = ['#7e9a3c', '#6f8c32', '#94ad4c', '#5f7a2c', '#a6b95a'];
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      const L = 38 + rnd() * 26;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L * 0.14, -L * 0.5, 0, -L);
      ctx.quadraticCurveTo(-L * 0.14, -L * 0.5, 0, 0);
      ctx.fill();
    } else if (kind === 'pine') {
      const cols = ['#2f4a2a', '#3a5a30', '#27402a', '#44643a'];
      ctx.strokeStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.lineWidth = 2;
      for (let n = 0; n < 7; n++) {
        const ang = (n / 7) * Math.PI - Math.PI / 2 + (rnd() - 0.5) * 0.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * 22, Math.sin(ang) * 22);
        ctx.stroke();
      }
    } else {
      // generic green leaf
      const cols = ['#5d8a3a', '#4f7a30', '#6e9b44', '#3f6a2a'];
      ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// Cedar foliage card: a dense drooping spray with a jagged needle outline
export function makeCedarTexture(seed = 9) {
  const S = 256;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  const fronds = 4;
  for (let f = 0; f < fronds; f++) {
    const cx = S * (0.3 + rnd() * 0.4);
    const cy = S * (0.35 + rnd() * 0.3);
    const rx = S * (0.26 + rnd() * 0.12);
    const ry = S * (0.2 + rnd() * 0.1);
    const pts = 70;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      // wider and droopier at the bottom, jagged needles all around
      const jag = 0.78 + 0.22 * (i % 2 === 0 ? rnd() : 1);
      const droop = Math.sin(a) > 0 ? 1.15 : 0.9;
      const x = cx + Math.cos(a) * rx * jag;
      const y = cy + Math.sin(a) * ry * jag * droop;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
    g.addColorStop(0, f % 2 ? '#3f6034' : '#35552f');
    g.addColorStop(1, '#1b2e1d');
    ctx.fillStyle = g;
    ctx.fill();
  }
  // needle highlights
  for (let i = 0; i < 500; i++) {
    const x = rnd() * S,
      y = rnd() * S;
    const d = ctx.getImageData(x | 0, y | 0, 1, 1).data;
    if (d[3] < 200) continue;
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(96,130,74,0.55)' : 'rgba(20,34,22,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const a = Math.PI / 2 + (rnd() - 0.5) * 2.2;
    ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
    ctx.stroke();
  }
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// ---------- bamboo culm ----------
export function makeBambooTexture() {
  const W = 64,
    H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#5c7a2e');
  g.addColorStop(0.35, '#86a447');
  g.addColorStop(0.55, '#9bb65a');
  g.addColorStop(1, '#55722a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(77);
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(40,60,20,${0.05 + rnd() * 0.08})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 10 + rnd() * 50);
  }
  // nodes
  for (let y = 0; y < H; y += 128) {
    ctx.fillStyle = 'rgba(210,220,170,0.55)';
    ctx.fillRect(0, y, W, 3);
    ctx.fillStyle = 'rgba(40,55,20,0.6)';
    ctx.fillRect(0, y + 3, W, 3);
    ctx.fillStyle = 'rgba(230,235,200,0.25)';
    ctx.fillRect(0, y - 6, W, 6);
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// ---------- flowers ----------
export function makeFlowerAtlas() {
  // 4 cells: nanohana plant, white daisy, purple, dandelion
  const S = 512;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(21);
  const cell = S / 2;

  // cell 0: nanohana (rapeseed) plant: stems + yellow clusters
  ctx.save();
  ctx.translate(0, 0);
  for (let i = 0; i < 7; i++) {
    const x0 = cell * 0.5 + (rnd() - 0.5) * cell * 0.5;
    const top = cell * (0.1 + rnd() * 0.25);
    ctx.strokeStyle = '#5d7f2c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cell * 0.5 + (rnd() - 0.5) * 20, cell);
    ctx.quadraticCurveTo(x0 + (rnd() - 0.5) * 30, cell * 0.6, x0, top + 14);
    ctx.stroke();
    // leaves
    ctx.fillStyle = '#6c9236';
    for (let l = 0; l < 2; l++) {
      ctx.beginPath();
      ctx.ellipse(x0 + (rnd() - 0.5) * 30, cell * (0.6 + rnd() * 0.3), 8, 22, (rnd() - 0.5) * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let f = 0; f < 26; f++) {
      const fx = x0 + (rnd() - 0.5) * 34;
      const fy = top + rnd() * 34;
      ctx.fillStyle = rnd() < 0.2 ? '#e8c21a' : rnd() < 0.5 ? '#f7d93a' : '#ffe45c';
      for (let p = 0; p < 4; p++) {
        const a = (p / 4) * Math.PI * 2 + rnd();
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(a) * 3.2, fy + Math.sin(a) * 3.2, 3.2, 2.2, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();

  // cell 1: white daisies
  ctx.save();
  ctx.translate(cell, 0);
  for (let i = 0; i < 4; i++) {
    const x0 = cell * (0.25 + rnd() * 0.5);
    const y0 = cell * (0.25 + rnd() * 0.35);
    ctx.strokeStyle = '#5f8a33';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cell * 0.5, cell);
    ctx.quadraticCurveTo(x0, cell * 0.7, x0, y0);
    ctx.stroke();
    ctx.fillStyle = '#fbfbf4';
    for (let p = 0; p < 14; p++) {
      const a = (p / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x0 + Math.cos(a) * 11, y0 + Math.sin(a) * 11, 10, 3.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f2c230';
    ctx.beginPath();
    ctx.arc(x0, y0, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // cell 2: purple / violet small flowers
  ctx.save();
  ctx.translate(0, cell);
  for (let i = 0; i < 6; i++) {
    const x0 = cell * (0.2 + rnd() * 0.6);
    const y0 = cell * (0.25 + rnd() * 0.4);
    ctx.strokeStyle = '#557d2e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cell * 0.5, cell);
    ctx.quadraticCurveTo(x0, cell * 0.75, x0, y0);
    ctx.stroke();
    ctx.fillStyle = rnd() < 0.5 ? '#8a5cc7' : '#a979e0';
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6, 7, 4.5, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f5e27a';
    ctx.beginPath();
    ctx.arc(x0, y0, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // cell 3: dandelions / buttercups
  ctx.save();
  ctx.translate(cell, cell);
  for (let i = 0; i < 5; i++) {
    const x0 = cell * (0.2 + rnd() * 0.6);
    const y0 = cell * (0.3 + rnd() * 0.4);
    ctx.strokeStyle = '#5a862f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cell * 0.5, cell);
    ctx.quadraticCurveTo(x0, cell * 0.8, x0, y0);
    ctx.stroke();
    for (let p = 0; p < 22; p++) {
      const a = (p / 22) * Math.PI * 2;
      ctx.fillStyle = p % 2 ? '#f5c518' : '#ffd93b';
      ctx.beginPath();
      ctx.ellipse(x0 + Math.cos(a) * 7, y0 + Math.sin(a) * 7, 7, 2.2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// Moss phlox (shibazakura) carpet, grayscale-ish blossoms tinted per stripe via vertex color
export function makeCarpetTexture() {
  const S = 512;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(99);
  ctx.fillStyle = '#6d7f45';
  ctx.fillRect(0, 0, S, S);
  const drawWrapped = (fn, x, y) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(x + ox, y + oy);
  };
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * S,
      y = rnd() * S;
    const r = 7 + rnd() * 5;
    const b = 0.78 + rnd() * 0.22;
    const col = `rgb(${255 * b},${245 * b},${250 * b})`;
    const rot = rnd() * 6;
    drawWrapped(
      (px, py) => {
        if (px < -20 || py < -20 || px > S + 20 || py > S + 20) return;
        ctx.fillStyle = col;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(rot);
        for (let p = 0; p < 5; p++) {
          ctx.rotate((Math.PI * 2) / 5);
          ctx.beginPath();
          ctx.ellipse(0, -r * 0.55, r * 0.34, r * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(150,60,110,0.8)';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      },
      x,
      y
    );
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Single falling petal
export function makePetalTexture() {
  const S = 64;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S * 0.75, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, '#f7c7d6');
  g.addColorStop(1, '#fdeef3');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(S / 2, S * 0.95);
  ctx.bezierCurveTo(S * 0.05, S * 0.7, S * 0.12, S * 0.12, S * 0.42, S * 0.06);
  ctx.lineTo(S / 2, S * 0.16);
  ctx.lineTo(S * 0.58, S * 0.06);
  ctx.bezierCurveTo(S * 0.88, S * 0.12, S * 0.95, S * 0.7, S / 2, S * 0.95);
  ctx.fill();
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// ---------- architecture ----------
export function makeRoofTileTexture(color = [58, 62, 66]) {
  const W = 256,
    H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W,
        v = y / H;
      // rounded tile channels along v, courses along u
      const ch = Math.abs(Math.sin(u * Math.PI * 8));
      const course = (v * 6) % 1;
      const lip = course > 0.9 ? -0.4 : 0;
      const n = tileFbm(u, v, 16, 3) * 0.12;
      const h = ch * 0.8 + lip + n;
      hgt[y * W + x] = h;
      const b = 0.7 + ch * 0.35 + lip * 0.5 + n;
      const k = (y * W + x) * 4;
      img.data[k] = color[0] * b;
      img.data[k + 1] = color[1] * b;
      img.data[k + 2] = color[2] * b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finishTexture(new THREE.CanvasTexture(c)), normalMap: normalFromHeight(hgt, W, 2.5) };
}

export function makeWoodTexture(base = [120, 82, 52], seed = 4) {
  const W = 256,
    H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W,
        v = y / H;
      const grain = tileFbm(u * 0.25 + seed, v * 4, 4, 4);
      const rings = Math.sin((u * 30 + grain * 6) * Math.PI) * 0.5 + 0.5;
      const b = 0.78 + rings * 0.16 + grain * 0.12;
      const k = (y * W + x) * 4;
      img.data[k] = base[0] * b;
      img.data[k + 1] = base[1] * b;
      img.data[k + 2] = base[2] * b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

export function makeStoneTexture(base = [150, 146, 136]) {
  const S = 256;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S,
        v = y / S;
      const n = tileFbm(u, v, 6, 5);
      const moss = Math.max(0, tileFbm(u + 0.3, v + 0.8, 4, 3) - 0.15) * 1.6;
      hgt[y * S + x] = n;
      const b = 0.82 + n * 0.3;
      const k = (y * S + x) * 4;
      img.data[k] = (base[0] * (1 - moss) + 88 * moss) * b;
      img.data[k + 1] = (base[1] * (1 - moss) + 104 * moss) * b;
      img.data[k + 2] = (base[2] * (1 - moss) + 62 * moss) * b;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: finishTexture(new THREE.CanvasTexture(c)), normalMap: normalFromHeight(hgt, S, 3) };
}

export function makeThatchTexture() {
  const W = 256,
    H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a7148';
  ctx.fillRect(0, 0, W, H);
  const rnd = mulberry32(13);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * W,
      y = rnd() * H;
    const b = 0.6 + rnd() * 0.6;
    ctx.strokeStyle = `rgb(${150 * b},${122 * b},${78 * b})`;
    ctx.lineWidth = 1 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y + 14 + rnd() * 16);
    ctx.stroke();
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

export function makeShojiTexture() {
  const S = 128;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#6b4a2e';
  for (let i = 0; i <= 4; i++) ctx.fillRect((i * S) / 4 - 2, 0, 4, S);
  for (let i = 0; i <= 4; i++) ctx.fillRect(0, (i * S) / 4 - 2, S, 4);
  return finishTexture(new THREE.CanvasTexture(c));
}

export function makePlasterTexture() {
  const S = 128;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = tileFbm(x / S, y / S, 8, 3);
      const b = 0.92 + n * 0.08;
      const k = (y * S + x) * 4;
      img.data[k] = 238 * b;
      img.data[k + 1] = 232 * b;
      img.data[k + 2] = 218 * b;
      img.data[k + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Glow sprite (lanterns, moon halo, fireflies)
export function makeGlowTexture() {
  const S = 128;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false, srgb: false });
}

// Kanji signboard
export function makeSignTexture(text, sub = '') {
  const W = 128,
    H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9c7a0';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#6b4a2e';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.fillStyle = '#231a14';
  ctx.font = 'bold 84px "Shippori Mincho", "Noto Serif JP", "Hiragino Mincho ProN", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  const step = Math.min(96, (H - 60) / chars.length);
  chars.forEach((ch, i) => ctx.fillText(ch, W / 2, 50 + step * (i + 0.5)));
  if (sub) {
    ctx.font = '22px sans-serif';
    ctx.fillText(sub, W / 2, H - 26);
  }
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// Tileable water ripple normal map
export function makeWaterNormal() {
  const S = 256;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = x / S,
        v = y / S;
      hgt[y * S + x] = tileFbm(u, v, 4, 5, 0.55) * 0.7 + tileFbm(u * 1 + 0.3, v + 0.6, 16, 3) * 0.3;
    }
  return normalFromHeight(hgt, S, 5.0);
}
