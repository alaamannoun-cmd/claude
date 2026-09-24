import * as THREE from 'three';
import { GeoBuilder, materials, mtx, curvedRoof } from './kit.js';
import { ROAD_HALF_WIDTH as HW, WATER_LEVEL } from '../world/layout.js';
import { makeSignTexture } from '../core/textures.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Bend a subdivided box along x so its ends sweep upward (torii lintels)
function bentBox(w, h, d, lift, segs = 24) {
  const g = new THREE.BoxGeometry(w, h, d, segs, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const t = Math.abs(x) / (w / 2);
    p.setY(i, p.getY(i) + lift * Math.pow(t, 2.4));
  }
  g.computeVertexNormals();
  return g;
}

// ---------------- torii ----------------
export function toriiGeometry() {
  const M = materials();
  const gb = new GeoBuilder();
  const px = HW + 0.35;
  for (const s of [-1, 1]) {
    gb.cyl(0.17, 0.145, 4.25, M.vermilion, s * px, 2.12, 0, 16, 0, 0, s * 0.018);
    gb.cyl(0.21, 0.2, 0.5, M.black, s * px, 0.25, 0, 16);
    gb.cyl(0.19, 0.19, 0.12, M.black, s * (px - 0.07), 4.2, 0, 16);
    gb.box(0.08, 0.22, 0.22, M.vermilion, s * (px + 0.24), 3.35, 0);
  }
  gb.box((px + 0.55) * 2, 0.2, 0.13, M.vermilion, 0, 3.35, 0);
  gb.box(0.16, 0.66, 0.12, M.vermilion, 0, 3.78, 0);
  gb.add(bentBox((px + 0.85) * 2, 0.2, 0.36, 0.22), M.vermilion, mtx(0, 4.3, 0));
  gb.add(bentBox((px + 1.2) * 2, 0.24, 0.46, 0.38), M.black, mtx(0, 4.52, 0));
  return gb.build();
}

// ---------------- stone lantern ----------------
export function lanternGeometry() {
  const M = materials();
  const gb = new GeoBuilder();
  gb.cyl(0.36, 0.36, 0.18, M.stone, 0, 0.09, 0, 6);
  gb.cyl(0.34, 0.2, 0.12, M.stone, 0, 0.24, 0, 6);
  gb.cyl(0.11, 0.1, 0.85, M.stone, 0, 0.72, 0, 12);
  gb.cyl(0.13, 0.13, 0.05, M.stone, 0, 0.75, 0, 12);
  gb.cyl(0.17, 0.3, 0.16, M.stone, 0, 1.23, 0, 6);
  gb.cyl(0.3, 0.3, 0.05, M.stone, 0, 1.335, 0, 6);
  gb.cyl(0.19, 0.19, 0.34, M.lamp, 0, 1.53, 0, 6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    gb.box(0.06, 0.34, 0.06, M.stone, Math.cos(a) * 0.22, 1.53, Math.sin(a) * 0.22, 0, -a, 0);
  }
  gb.cyl(0.27, 0.27, 0.05, M.stone, 0, 1.725, 0, 6);
  gb.cyl(0.47, 0.08, 0.26, M.stone, 0, 1.88, 0, 6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    gb.sphere(0.05, M.stone, Math.cos(a) * 0.45, 1.8, Math.sin(a) * 0.45, 1, 1.4, 1);
  }
  gb.cyl(0.06, 0.09, 0.05, M.stone, 0, 2.02, 0, 8);
  gb.sphere(0.075, M.stone, 0, 2.1, 0);
  gb.cyl(0.05, 0.0, 0.09, M.stone, 0, 2.2, 0, 8);
  return gb.build();
}

// ---------------- bridges ----------------
export function buildBridge(hf, b) {
  const M = materials();
  const road = hf.road;
  const red = b.type === 'red';
  const gb = new GeoBuilder();
  const deckMat = red ? M.woodDark : M.woodGray;
  const frame = red ? M.vermilion : M.woodGray;
  const s0 = b.center - b.halfLen - 1;
  const s1 = b.center + b.halfLen + 1;
  const pts = [];
  for (let s = s0; s <= s1 + 1e-6; s += 0.5) {
    const p = road.pointAt(s);
    const t = road.tangentAt(s);
    pts.push({ s, x: p.x, z: p.z, tx: t.x, tz: t.z, nx: -t.z, nz: t.x, y: hf.roadHeightAtIndex(s) + 0.02 });
  }
  const half = HW + 0.35;
  // deck: ribbon with thickness
  const deck = [];
  const duv = [];
  const quad = (a, b2, c, d, ua, ub) => {
    deck.push(a.x, a.y, a.z, b2.x, b2.y, b2.z, c.x, c.y, c.z, b2.x, b2.y, b2.z, d.x, d.y, d.z, c.x, c.y, c.z);
    duv.push(ua[0], ua[1], ub[0], ua[1], ua[0], ub[1], ub[0], ua[1], ub[0], ub[1], ua[0], ub[1]);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const A = pts[i],
      B = pts[i + 1];
    const L = (P, off, dy) => V(P.x + P.nx * off, P.y + dy, P.z + P.nz * off);
    // top (normal up): order so that winding faces +y
    quad(L(A, -half, 0), L(A, half, 0), L(B, -half, 0), L(B, half, 0), [0, i * 0.5], [5, (i + 1) * 0.5]);
    // bottom
    quad(L(A, half, -0.3), L(A, -half, -0.3), L(B, half, -0.3), L(B, -half, -0.3), [0, i * 0.5], [5, (i + 1) * 0.5]);
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(deck, 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  dg.computeVertexNormals();
  gb.add(dg, deckMat);
  // side girders
  for (const side of [-1, 1]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const A = pts[i],
        B = pts[i + 1];
      const a = V(A.x + A.nx * side * (half + 0.04), A.y - 0.2, A.z + A.nz * side * (half + 0.04));
      const c = V(B.x + B.nx * side * (half + 0.04), B.y - 0.2, B.z + B.nz * side * (half + 0.04));
      gb.plank(a, c, 0.16, 0.5, frame);
    }
  }
  // railings
  const postEvery = red ? 4 : 5;
  const rail = (side) => {
    const posts = [];
    for (let i = 0; i < pts.length; i += postEvery) posts.push(pts[i]);
    if (posts[posts.length - 1] !== pts[pts.length - 1]) posts.push(pts[pts.length - 1]);
    const off = side * (half - 0.1);
    const top = [];
    posts.forEach((P, k) => {
      const x = P.x + P.nx * off,
        z = P.z + P.nz * off;
      gb.box(0.15, 1.05, 0.15, frame, x, P.y + 0.52, z, 0, Math.atan2(P.tx, P.tz), 0);
      top.push(V(x, P.y + 1.0, z));
      if (red && (k === 0 || k === posts.length - 1)) {
        // giboshi: bronze onion-shaped post cap
        gb.cyl(0.1, 0.1, 0.12, M.bronze, x, P.y + 1.1, z, 12);
        gb.sphere(0.14, M.bronze, x, P.y + 1.26, z, 1, 1.1, 1);
        gb.cyl(0.06, 0.0, 0.2, M.bronze, x, P.y + 1.46, z, 10);
      }
    });
    for (let k = 0; k < top.length - 1; k++) {
      gb.beam(top[k], top[k + 1], red ? 0.065 : 0.055, frame, 10);
      const m1 = top[k].clone().setY(top[k].y - 0.45);
      const m2 = top[k + 1].clone().setY(top[k + 1].y - 0.45);
      gb.plank(m1, m2, 0.07, 0.1, frame);
      const b1 = top[k].clone().setY(top[k].y - 0.85);
      const b2 = top[k + 1].clone().setY(top[k + 1].y - 0.85);
      gb.plank(b1, b2, 0.08, 0.14, frame);
    }
  };
  rail(-1);
  rail(1);
  // piers
  const pierStep = red ? 12 : 14;
  for (let i = pierStep; i < pts.length - pierStep / 2; i += pierStep) {
    const P = pts[i];
    for (const side of [-1, 1]) {
      const x = P.x + P.nx * side * (half - 0.5),
        z = P.z + P.nz * side * (half - 0.5);
      const top = P.y - 0.3;
      const bottom = -3;
      if (red) {
        gb.cyl(0.19, 0.19, top - bottom, M.vermilion, x, (top + bottom) / 2, z, 14);
        gb.cyl(0.24, 0.24, 0.3, M.black, x, WATER_LEVEL + 0.05, z, 14);
      } else {
        gb.box(0.55, top - bottom, 0.55, M.stone, x, (top + bottom) / 2, z);
      }
    }
    const a = V(P.x - P.nx * (half - 0.2), P.y - 0.55, P.z - P.nz * (half - 0.2));
    const c = V(P.x + P.nx * (half - 0.2), P.y - 0.55, P.z + P.nz * (half - 0.2));
    gb.plank(a, c, 0.25, 0.3, frame);
  }
  // stone abutments at both ends
  for (const end of [pts[0], pts[pts.length - 1]]) {
    const dir = end === pts[0] ? 1 : -1;
    const cx = end.x + end.tx * dir * 1.2,
      cz = end.z + end.tz * dir * 1.2;
    const h = end.y + 3;
    gb.box((half + 0.6) * 2, h, 3.2, M.stone, cx, end.y - 0.32 - h / 2 + 0.3, cz, 0, Math.atan2(end.tx, end.tz), 0);
  }
  const mesh = gb.mesh();
  mesh.name = `bridge-${b.type}`;
  return mesh;
}

// ---------------- five-story pagoda ----------------
export function buildPagoda() {
  const M = materials();
  const gb = new GeoBuilder();
  gb.box(11, 1.2, 11, M.stone, 0, 0.1, 0);
  gb.box(3.2, 0.4, 2.5, M.stone, 0, 0.3, 6.6);
  gb.box(3.2, 0.2, 1.4, M.stone, 0, 0.1, 7.9);
  let y = 0.7;
  for (let i = 0; i < 5; i++) {
    const b = 2.75 - i * 0.3;
    const h = i === 0 ? 3.1 : 2.3;
    // body
    gb.box(b * 2 - 0.25, h, b * 2 - 0.25, M.white, 0, y + h / 2, 0);
    // columns
    const cols = [-b, -b / 3, b / 3, b];
    for (const cx of cols)
      for (const cz of cols) {
        if (Math.abs(cx) < b - 0.01 && Math.abs(cz) < b - 0.01) continue;
        gb.cyl(0.13, 0.13, h, M.vermilion, cx * 0.95, y + h / 2, cz * 0.95, 10);
      }
    // beams
    for (const yy of [y + h - 0.12, y + 0.12]) {
      gb.box(b * 2, 0.22, 0.2, M.vermilion, 0, yy, b * 0.95);
      gb.box(b * 2, 0.22, 0.2, M.vermilion, 0, yy, -b * 0.95);
      gb.box(0.2, 0.22, b * 2, M.vermilion, b * 0.95, yy, 0);
      gb.box(0.2, 0.22, b * 2, M.vermilion, -b * 0.95, yy, 0);
    }
    // doors on each face (vermilion panels with gold studs on the ground floor)
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      const dx = Math.sin(a) * (b * 0.95 - 0.08),
        dz = Math.cos(a) * (b * 0.95 - 0.08);
      gb.box(b * 0.62, h * 0.72, 0.08, M.vermilionDark, dx, y + h * 0.42, dz, 0, a, 0);
      if (i === 0) {
        for (let r = 0; r < 3; r++)
          for (let c = -1; c <= 1; c += 2) {
            const off = c * b * 0.15;
            gb.sphere(0.035, M.gold, dx + Math.cos(a) * off + Math.sin(a) * 0.05, y + 0.8 + r * 0.6, dz - Math.sin(a) * off + Math.cos(a) * 0.05);
          }
      }
    }
    // balcony for upper stories
    if (i > 0) {
      const r = b + 0.45;
      gb.box(r * 2, 0.12, r * 2, M.woodDark, 0, y + 0.06, 0);
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        const ox = Math.sin(a) * r,
          oz = Math.cos(a) * r;
        gb.box(f % 2 === 0 ? r * 2 : 0.08, 0.08, f % 2 === 0 ? 0.08 : r * 2, M.vermilion, ox, y + 0.62, oz);
        for (let k = -3; k <= 3; k++) {
          const t = (k / 3) * r;
          gb.box(0.07, 0.6, 0.07, M.vermilion, ox + Math.cos(a) * t, y + 0.32, oz - Math.sin(a) * t);
        }
      }
    }
    // bracket layer
    const bt = y + h;
    gb.box(b * 2 + 0.5, 0.3, b * 2 + 0.5, M.vermilionDark, 0, bt + 0.15, 0);
    gb.box(b * 2 + 1.1, 0.25, b * 2 + 1.1, M.white, 0, bt + 0.42, 0);
    // roof
    curvedRoof(gb, {
      hx: b + 2.1,
      hz: b + 2.1,
      ix: b - 0.1,
      iz: b - 0.1,
      height: 1.05,
      lift: 0.62,
      thick: 0.3,
      rings: 7,
      per: 10,
      y: bt + 0.6,
      topMat: M.tiles,
      underMat: M.woodDark,
      fasciaMat: M.white,
    });
    y = bt + 1.55;
  }
  // top cap and spire (sorin)
  gb.box(3.2, 0.5, 3.2, M.tiles, 0, y - 0.25, 0);
  gb.box(1.3, 0.55, 1.3, M.bronze, 0, y + 0.25, 0);
  gb.sphere(0.55, M.bronze, 0, y + 0.6, 0, 1, 0.6, 1);
  gb.cyl(0.08, 0.06, 6.5, M.bronze, 0, y + 3.8, 0, 10);
  for (let r = 0; r < 9; r++) {
    const g = new THREE.TorusGeometry(0.42 - r * 0.018, 0.045, 6, 20);
    g.rotateX(Math.PI / 2);
    gb.add(g, M.bronze, mtx(0, y + 1.3 + r * 0.42, 0));
  }
  gb.sphere(0.32, M.bronze, 0, y + 5.6, 0, 1, 1.6, 0.35);
  gb.sphere(0.16, M.gold, 0, y + 6.5, 0, 1, 1.2, 1);
  gb.cyl(0.06, 0.0, 0.3, M.gold, 0, y + 6.8, 0, 8);
  const mesh = gb.mesh();
  mesh.name = 'pagoda';
  return mesh;
}

// ---------------- village houses ----------------
export function buildHouse(house) {
  const M = materials();
  const gb = new GeoBuilder();
  const { w, d, type } = house;
  gb.box(w + 0.4, 0.45, d + 0.4, M.stone, 0, 0.1, 0);
  const base = 0.35;
  const wallH = type === 'kura' ? 4.6 : type === 'thatch' ? 2.5 : 2.7;
  const wallMat = M.white;
  gb.box(w, wallH, d, wallMat, 0, base + wallH / 2, 0);
  // lower wainscot
  const wain = type === 'kura' ? 1.4 : 0.9;
  const wainMat = type === 'kura' ? M.black : M.woodDark;
  gb.box(w + 0.04, wain, d + 0.04, wainMat, 0, base + wain / 2, 0);
  // timber frame
  if (type !== 'kura') {
    const posts = Math.max(2, Math.round(w / 1.8));
    for (let k = 0; k <= posts; k++) {
      const x = -w / 2 + (k / posts) * w;
      for (const zz of [-d / 2, d / 2]) gb.box(0.17, wallH, 0.17, M.woodDark, x, base + wallH / 2, zz);
    }
    const pd = Math.max(2, Math.round(d / 1.8));
    for (let k = 1; k < pd; k++) {
      const z = -d / 2 + (k / pd) * d;
      for (const xx of [-w / 2, w / 2]) gb.box(0.17, wallH, 0.17, M.woodDark, xx, base + wallH / 2, z);
    }
    for (const yy of [base + wallH - 0.12, base + 1.9]) {
      gb.box(w + 0.1, 0.16, 0.2, M.woodDark, 0, yy, d / 2);
      gb.box(w + 0.1, 0.16, 0.2, M.woodDark, 0, yy, -d / 2);
      gb.box(0.2, 0.16, d + 0.1, M.woodDark, w / 2, yy, 0);
      gb.box(0.2, 0.16, d + 0.1, M.woodDark, -w / 2, yy, 0);
    }
    // shoji front with engawa veranda
    const panels = Math.max(2, Math.round((w - 1) / 1.5));
    const pw = (w - 1) / panels;
    for (let k = 0; k < panels; k++) {
      gb.box(pw - 0.06, 1.75, 0.05, M.shoji, -w / 2 + 0.5 + pw * (k + 0.5), base + 0.35 + 0.9, d / 2 + 0.04);
    }
    gb.box(w, 0.1, 1.2, M.wood, 0, base + 0.15, d / 2 + 0.62);
    for (const xx of [-w / 2 + 0.15, w / 2 - 0.15]) gb.box(0.14, wallH + 0.2, 0.14, M.woodDark, xx, base + wallH / 2, d / 2 + 1.15);
    // side window
    gb.box(0.05, 0.9, 1.4, M.shoji, w / 2 + 0.03, base + 1.4, 0);
  } else {
    // storehouse details: small barred windows and namako diagonal tiles
    gb.box(0.9, 0.8, 0.12, M.black, 0, base + 3.2, d / 2 + 0.04);
    gb.box(1.4, 2.0, 0.15, M.black, 0, base + 1.0, d / 2 + 0.05);
    for (let k = -2; k <= 2; k++) gb.box(0.04, 1.3, 0.06, M.white, k * 0.3, base + 0.7, d / 2 + 0.1, 0, 0, Math.PI / 4);
  }
  const top = base + wallH;
  if (type === 'thatch') {
    // steep gassho-zukuri thatched roof
    const pitch = (58 * Math.PI) / 180;
    const run = d / 2 + 1.0;
    const slope = run / Math.cos(pitch);
    const rise = run * Math.tan(pitch);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(w + 2.0, 0.75, slope, 1, 1, 1);
      const m = mtx(0, top + rise / 2 - 0.35, (s * run) / 2 - s * 0.35, s * pitch, 0, 0);
      gb.add(g, M.thatch, m);
    }
    // gable walls with dark boards and small windows
    for (const sx of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-d / 2, 0);
      shape.lineTo(d / 2, 0);
      shape.lineTo(0, rise - 0.6);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      gb.add(g, M.woodDark, mtx(sx * (w / 2 - 0.06) - 0.06, top, 0));
      gb.box(0.06, 0.7, 1.0, M.shoji, sx * (w / 2 + 0.03), top + rise * 0.35, 0);
    }
    gb.box(w + 2.2, 0.35, 0.8, M.woodDark, 0, top + rise - 0.1, 0);
  } else {
    // tiled hip roof with a ridge (kawara)
    const over = type === 'kura' ? 0.7 : 1.05;
    const hx = w / 2 + over,
      hz = d / 2 + over;
    const ridge = Math.max(0.3, hx - hz);
    const height = type === 'kura' ? d * 0.4 : d * 0.42;
    curvedRoof(gb, {
      hx,
      hz,
      ix: ridge,
      iz: 0.18,
      height,
      lift: 0.18,
      thick: 0.2,
      rings: 6,
      per: 10,
      y: top + 0.05,
      topMat: M.tiles,
      underMat: M.woodDark,
      fasciaMat: M.woodDark,
    });
    gb.box(ridge * 2 + 0.7, 0.34, 0.5, M.black, 0, top + height + 0.18, 0);
    for (const sx of [-1, 1]) gb.box(0.35, 0.55, 0.55, M.black, sx * (ridge + 0.3), top + height + 0.28, 0);
  }
  const mesh = gb.mesh();
  mesh.name = `house-${type}`;
  return mesh;
}

// ---------------- shrine ----------------
export function buildShrine() {
  const M = materials();
  const gb = new GeoBuilder();
  gb.box(13, 0.7, 10, M.stone, 0, 0.1, 0);
  // gravel yard steps
  gb.box(3, 0.35, 1.2, M.stone, 0, 0.1, 5.4);
  // raised hall
  const fw = 7.2,
    fd = 5.6,
    floorY = 1.3;
  gb.box(fw + 1.2, 0.18, fd + 1.2, M.woodDark, 0, floorY, 0);
  for (const x of [-fw / 2, -fw / 6, fw / 6, fw / 2])
    for (const z of [-fd / 2, fd / 2]) gb.cyl(0.16, 0.16, 4.2, M.vermilion, x, 0.45 + 2.1, z, 12);
  for (const z of [-fd / 6, fd / 6]) for (const x of [-fw / 2, fw / 2]) gb.cyl(0.16, 0.16, 4.2, M.vermilion, x, 0.45 + 2.1, z, 12);
  gb.box(fw - 0.2, 2.9, fd - 0.2, M.white, 0, floorY + 1.55, 0);
  for (let k = 0; k < 3; k++) gb.box(fw / 3 - 0.3, 2.3, 0.06, M.shoji, -fw / 3 + k * (fw / 3), floorY + 1.3, fd / 2 - 0.05);
  gb.box(fw + 0.4, 0.25, 0.25, M.vermilion, 0, floorY + 2.95, fd / 2);
  gb.box(fw + 0.4, 0.25, 0.25, M.vermilion, 0, floorY + 2.95, -fd / 2);
  // railing around the veranda
  for (const z of [fd / 2 + 0.55]) {
    gb.box(fw + 1.2, 0.08, 0.08, M.vermilion, 0, floorY + 0.75, z);
    for (let k = -6; k <= 6; k++) if (Math.abs(k) > 1) gb.box(0.07, 0.7, 0.07, M.vermilion, (k / 6) * (fw / 2 + 0.55), floorY + 0.42, z);
  }
  // wooden steps
  for (let k = 0; k < 5; k++) gb.box(2.4, 0.12, 0.35, M.wood, 0, 0.5 + k * 0.2, fd / 2 + 2.3 - k * 0.3);
  // offering box
  gb.box(1.4, 0.7, 0.6, M.wood, 0, floorY + 0.45, fd / 2 + 0.2);
  // copper-green roof
  curvedRoof(gb, {
    hx: fw / 2 + 1.8,
    hz: fd / 2 + 1.7,
    ix: fw / 2 - fd / 2 + 0.5,
    iz: 0.2,
    height: 2.6,
    lift: 0.55,
    thick: 0.28,
    rings: 7,
    per: 10,
    y: floorY + 3.05,
    topMat: M.tilesGreen,
    underMat: M.woodDark,
    fasciaMat: M.white,
  });
  const ridgeY = floorY + 3.05 + 2.6;
  const rl = fw / 2 - fd / 2 + 0.5;
  gb.box(rl * 2 + 0.6, 0.35, 0.55, M.tilesGreen, 0, ridgeY + 0.12, 0);
  // katsuogi logs across the ridge and chigi crossed finials
  for (let k = -2; k <= 2; k++) {
    const g = new THREE.CylinderGeometry(0.14, 0.14, 1.1, 10);
    g.rotateX(Math.PI / 2);
    gb.add(g, M.woodDark, mtx((k / 2) * rl * 0.9, ridgeY + 0.45, 0));
    gb.cyl(0.15, 0.15, 0.06, M.gold, (k / 2) * rl * 0.9, ridgeY + 0.45, 0.56, 10, Math.PI / 2, 0, 0);
    gb.cyl(0.15, 0.15, 0.06, M.gold, (k / 2) * rl * 0.9, ridgeY + 0.45, -0.56, 10, Math.PI / 2, 0, 0);
  }
  for (const sx of [-1, 1]) {
    for (const lean of [-1, 1]) gb.box(0.12, 1.8, 0.35, M.woodDark, sx * (rl + 0.25), ridgeY + 0.6, lean * 0.35, lean * 0.55, 0, 0);
  }
  // shimenawa rope with paper streamers
  const ropePts = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    ropePts.push(V(-fw / 2 + 0.3 + t * (fw - 0.6), floorY + 2.7 - Math.sin(t * Math.PI) * 0.35, fd / 2 + 0.22));
  }
  const rope = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts), 40, 0.12, 8);
  gb.add(rope, M.rope);
  for (let k = 1; k <= 4; k++) {
    const t = k / 5;
    const p = ropePts[Math.round(t * 16)];
    const shape = new THREE.Shape();
    shape.moveTo(-0.08, 0);
    shape.lineTo(0.08, 0);
    shape.lineTo(0.08, -0.14);
    shape.lineTo(-0.02, -0.14);
    shape.lineTo(-0.02, -0.28);
    shape.lineTo(0.08, -0.28);
    shape.lineTo(0.08, -0.42);
    shape.lineTo(-0.08, -0.42);
    shape.lineTo(-0.08, -0.3);
    shape.lineTo(0.02, -0.3);
    shape.lineTo(0.02, -0.16);
    shape.lineTo(-0.08, -0.16);
    shape.closePath();
    gb.add(new THREE.ShapeGeometry(shape), M.paper, mtx(p.x, p.y - 0.08, p.z + 0.13));
  }
  // bell and rope
  gb.sphere(0.2, M.gold, 0, floorY + 2.3, fd / 2 + 0.25);
  gb.cyl(0.035, 0.035, 1.6, M.vermilion, 0.05, floorY + 1.4, fd / 2 + 0.27, 8);
  gb.cyl(0.035, 0.035, 1.6, M.paper, -0.05, floorY + 1.4, fd / 2 + 0.27, 8);
  const mesh = gb.mesh();
  mesh.name = 'shrine';
  return mesh;
}

// ---------------- small props ----------------
export function signMesh(text, sub) {
  const M = materials();
  const gb = new GeoBuilder();
  gb.box(0.12, 2.2, 0.12, M.woodDark, 0, 1.1, -0.05);
  gb.box(0.55, 0.08, 0.3, M.woodDark, 0, 2.25, 0);
  const { geo, mats } = gb.build();
  const group = new THREE.Group();
  const post = new THREE.Mesh(geo, mats);
  post.castShadow = true;
  group.add(post);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 1.36),
    new THREE.MeshStandardMaterial({ map: makeSignTexture(text, sub), roughness: 0.85 })
  );
  board.position.set(0, 1.45, 0.02);
  board.castShadow = true;
  group.add(board);
  const back = board.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.12;
  group.add(back);
  return group;
}

export function benchGeometry() {
  const M = materials();
  const gb = new GeoBuilder();
  gb.box(1.8, 0.07, 0.42, M.wood, 0, 0.45, 0);
  gb.box(1.8, 0.35, 0.05, M.wood, 0, 0.72, -0.2, -0.15, 0, 0);
  for (const x of [-0.75, 0.75]) {
    gb.box(0.07, 0.45, 0.07, M.woodDark, x, 0.22, 0.15);
    gb.box(0.07, 0.8, 0.07, M.woodDark, x, 0.4, -0.18);
  }
  return gb.build();
}

export function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const rnd = (i) => {
    const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const dirs = [0, 1, 2, 3].map((k) => new THREE.Vector3(rnd(k) - 0.5, rnd(k + 9) - 0.5, rnd(k + 17) - 0.5).normalize());
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    let k = 1;
    for (const d of dirs) k += Math.max(0, v.dot(d)) * 0.25;
    k *= 0.85 + 0.15 * Math.sin(v.x * 5 + seed) * Math.cos(v.z * 4);
    v.multiplyScalar(k);
    v.y *= 0.62;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const geo = g.toNonIndexed();
  geo.computeVertexNormals();
  return geo;
}
