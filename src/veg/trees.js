import * as THREE from 'three';
import { Rng, clamp, smoothstep } from '../core/noise.js';
import { windMaterial, windDepthMaterial } from './common.js';
import { makeBarkTexture, makeBlossomTexture, makeLeafTexture, makeCedarTexture } from '../core/textures.js';

const _v = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Geometry buffers for one level of detail
class Mesher {
  constructor() {
    this.bp = [];
    this.bn = [];
    this.buv = [];
    this.bi = [];
    this.fp = [];
    this.fn = [];
    this.fuv = [];
    this.fc = [];
    this.fi = [];
  }
  build() {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(this.bp, 3));
    bg.setAttribute('normal', new THREE.Float32BufferAttribute(this.bn, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(this.buv, 2));
    bg.setIndex(this.bi);
    bg.computeBoundingSphere();
    let fg = null;
    if (this.fp.length) {
      fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(this.fp, 3));
      fg.setAttribute('normal', new THREE.Float32BufferAttribute(this.fn, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(this.fuv, 2));
      fg.setAttribute('color', new THREE.Float32BufferAttribute(this.fc, 3));
      fg.setIndex(this.fi);
      fg.computeBoundingSphere();
    }
    return { branchGeo: bg, foliageGeo: fg };
  }
}

// Accumulates tube limbs (bark) and foliage cards for a tree template, in two LODs
class TreeBuilder {
  constructor() {
    this.near = new Mesher();
    this.far = new Mesher();
    this.crownCenter = new THREE.Vector3(0, 4, 0);
    this.crownRadius = new THREE.Vector3(4, 2.5, 4);
    this.clusters = [];
  }

  // Tube through points with per-point radii; thick limbs also go into the far LOD
  addLimb(points, radii, sides, depth = 0) {
    this.tube(this.near, points, radii, sides);
    if (depth <= 1) this.tube(this.far, [points[0], points[points.length - 1]], [radii[0], radii[radii.length - 1]], Math.max(4, sides - 2));
  }

  tube(M, points, radii, sides) {
    const base = M.bp.length / 3;
    const normal = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    tangent.subVectors(points[1], points[0]).normalize();
    normal.copy(Math.abs(tangent.y) < 0.9 ? UP : new THREE.Vector3(1, 0, 0)).cross(tangent).normalize();
    let along = 0;
    for (let i = 0; i < points.length; i++) {
      if (i > 0) {
        const t2 = new THREE.Vector3().subVectors(points[Math.min(i + 1, points.length - 1)], points[i - 1]).normalize();
        const axis = new THREE.Vector3().crossVectors(tangent, t2);
        const s = axis.length();
        if (s > 1e-5) {
          axis.divideScalar(s);
          normal.applyAxisAngle(axis, Math.acos(clamp(tangent.dot(t2), -1, 1)));
        }
        tangent.copy(t2);
        along += points[i].distanceTo(points[i - 1]);
      }
      binormal.crossVectors(tangent, normal).normalize();
      const r = radii[i];
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const cx = Math.cos(a),
          sx = Math.sin(a);
        _v.set(normal.x * cx + binormal.x * sx, normal.y * cx + binormal.y * sx, normal.z * cx + binormal.z * sx);
        M.bp.push(points[i].x + _v.x * r, points[i].y + _v.y * r, points[i].z + _v.z * r);
        M.bn.push(_v.x, _v.y, _v.z);
        M.buv.push((j / sides) * Math.max(1, Math.round(r * 12)) * 0.5, along / 1.6);
      }
    }
    const row = sides + 1;
    for (let i = 0; i < points.length - 1; i++)
      for (let j = 0; j < sides; j++) {
        const a = base + i * row + j;
        const b = a + row;
        M.bi.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }

  // A foliage card (quad) facing `normal`, lit with a crown-shaped normal
  card(M, center, normal, size, rot, ao, stretch = 1) {
    const base = M.fp.length / 3;
    _u.copy(Math.abs(normal.y) < 0.95 ? UP : new THREE.Vector3(1, 0, 0)).cross(normal).normalize();
    _w.crossVectors(normal, _u).normalize();
    const c = Math.cos(rot),
      s = Math.sin(rot);
    const tx = _u.clone().multiplyScalar(c).addScaledVector(_w, s);
    const ty = _w.clone().multiplyScalar(c).addScaledVector(_u, -s);
    const hx = size * 0.5,
      hy = size * 0.5 * stretch;
    const sn = new THREE.Vector3().subVectors(center, this.crownCenter);
    sn.x /= this.crownRadius.x;
    sn.y /= this.crownRadius.y;
    sn.z /= this.crownRadius.z;
    sn.normalize().multiplyScalar(0.8).addScaledVector(normal, 0.2).normalize();
    const corners = [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ];
    for (const [a, b, uu, vv] of corners) {
      M.fp.push(center.x + tx.x * hx * a + ty.x * hy * b, center.y + tx.y * hx * a + ty.y * hy * b, center.z + tx.z * hx * a + ty.z * hy * b);
      M.fn.push(sn.x, sn.y, sn.z);
      M.fuv.push(uu, vv);
      M.fc.push(ao, ao, ao);
    }
    M.fi.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  cluster(center, radius, count, rng, { flatten = 1, upBias = 0, sizeMin = 0.9, sizeMax = 1.4 } = {}) {
    this.clusters.push({ center: center.clone(), radius, count, flatten, upBias, sizeMin, sizeMax });
  }

  // Emit cards once the crown bounds are known so the volumetric normals are right
  finalizeClusters(rng, farKeep = 0.3, farScale = 1.8) {
    if (!this.clusters.length) return;
    const min = new THREE.Vector3(1e9, 1e9, 1e9),
      max = new THREE.Vector3(-1e9, -1e9, -1e9);
    for (const c of this.clusters) {
      min.min(_v.copy(c.center).subScalar(c.radius));
      max.max(_v.copy(c.center).addScalar(c.radius));
    }
    this.crownCenter.addVectors(min, max).multiplyScalar(0.5);
    this.crownRadius.subVectors(max, min).multiplyScalar(0.5).max(new THREE.Vector3(0.5, 0.5, 0.5));
    let acc = 0;
    for (const cl of this.clusters) {
      for (let k = 0; k < cl.count; k++) {
        const p = randomInSphere(rng).multiplyScalar(cl.radius * 0.85);
        p.y *= cl.flatten;
        p.add(cl.center);
        const out = new THREE.Vector3().subVectors(p, this.crownCenter).normalize();
        const n = randomInSphere(rng).normalize().addScaledVector(out, 0.6);
        n.y += cl.upBias;
        n.normalize();
        const rel = new THREE.Vector3().subVectors(p, this.crownCenter);
        const dy = rel.y / this.crownRadius.y;
        const dr = Math.min(1, Math.hypot(rel.x / this.crownRadius.x, rel.z / this.crownRadius.z, rel.y / this.crownRadius.y));
        const ao = clamp(0.62 + 0.25 * smoothstep(-1, 0.8, dy) + 0.2 * dr, 0.55, 1);
        const size = rng.float(cl.sizeMin, cl.sizeMax);
        const rot = rng.float(0, Math.PI * 2);
        this.card(this.near, p, n, size, rot, ao);
        // the far LOD keeps a fraction of the cards, enlarged
        acc += farKeep;
        if (acc >= 1) {
          acc -= 1;
          this.card(this.far, p, n, size * farScale, rot, Math.min(1, ao + 0.05));
        }
      }
    }
  }

  build() {
    return { near: this.near.build(), far: this.far.build() };
  }
}

function randomInSphere(rng) {
  for (;;) {
    const v = new THREE.Vector3(rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1));
    if (v.lengthSq() <= 1) return v;
  }
}

function perturb(dir, amount, rng) {
  return dir.clone().add(new THREE.Vector3(rng.float(-amount, amount), rng.float(-amount, amount), rng.float(-amount, amount))).normalize();
}

// Rotate `dir` away by `angle` around a random perpendicular axis, biased outward from the trunk axis
function spreadDir(dir, angle, rng, pos, outward = 0.5, upward = 0) {
  const axis = new THREE.Vector3().crossVectors(dir, randomInSphere(rng)).normalize();
  const d = dir.clone().applyAxisAngle(axis, angle);
  const out = new THREE.Vector3(pos.x, 0, pos.z);
  if (out.lengthSq() > 1e-4) d.addScaledVector(out.normalize(), outward);
  d.y += upward;
  return d.normalize();
}

function growLimb(b, rng, start, dir, length, r0, r1, segs, sides, droop = 0, curl = 0.18, depth = 0) {
  const pts = [start.clone()];
  const radii = [r0];
  let d = dir.clone();
  let p = start.clone();
  for (let s = 1; s <= segs; s++) {
    d = perturb(d, curl, rng);
    d.y -= droop * (s / segs);
    d.normalize();
    p = p.clone().addScaledVector(d, length / segs);
    pts.push(p);
    radii.push(r0 + (r1 - r0) * (s / segs));
  }
  b.addLimb(pts, radii, sides, depth);
  return { pts, end: p, dir: d };
}

const SIDES = [6, 5, 4, 3, 3];
const SEGS = [4, 3, 2, 2, 2];

// ---------------- species ----------------

function sakura(rng, weeping = false) {
  const b = new TreeBuilder();
  const trunkH = weeping ? rng.float(2.6, 3.4) : rng.float(1.5, 2.3);
  const trunkR = weeping ? rng.float(0.3, 0.38) : rng.float(0.24, 0.32);
  const lean = new THREE.Vector3(rng.float(-0.15, 0.15), 1, rng.float(-0.15, 0.15)).normalize();
  const trunk = growLimb(b, rng, new THREE.Vector3(0, -0.3, 0), lean, trunkH + 0.3, trunkR * 1.25, trunkR * 0.8, 4, 8, 0, 0.08, 0);
  // root flare
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const d = new THREE.Vector3(Math.cos(a), -0.35, Math.sin(a)).normalize();
    growLimb(b, rng, new THREE.Vector3(0, 0.35, 0), d, 0.9, trunkR * 0.55, 0.05, 2, 4, 0, 0.1, 2);
  }
  const scaffolds = rng.int(3, 5);
  const maxDepth = 3;
  const grow = (pos, dir, len, rad, depth) => {
    const droop = weeping && depth >= 1 ? 0.55 + depth * 0.2 : depth >= 2 ? 0.06 : 0;
    const limb = growLimb(b, rng, pos, dir, len, rad, rad * 0.62, SEGS[depth], SIDES[depth], droop, 0.16, depth);
    if (depth >= maxDepth || rad < 0.03) {
      if (weeping) hangingStrands(b, rng, limb.end, rng.int(3, 4));
      else b.cluster(limb.end, rng.float(1.1, 1.5), rng.int(9, 12), rng, { upBias: 0.25 });
      return;
    }
    // blossoms along the older twigs too
    if (!weeping && depth >= 1) b.cluster(limb.pts[1], rng.float(0.9, 1.15), rng.int(3, 4), rng, { upBias: 0.2 });
    const kids = depth === 0 ? rng.int(2, 3) : 2;
    for (let k = 0; k < kids; k++) {
      const t = rng.float(0.55, 1.0);
      const idx = Math.min(limb.pts.length - 1, Math.max(1, Math.round(t * (limb.pts.length - 1))));
      const p = limb.pts[idx];
      const nd = spreadDir(limb.dir, rng.float(0.35, 0.75), rng, p, weeping ? 0.3 : 0.55, weeping ? 0.15 : 0.12);
      grow(p, nd, len * rng.float(0.6, 0.78), rad * rng.float(0.55, 0.68), depth + 1);
    }
  };
  for (let s = 0; s < scaffolds; s++) {
    const a = (s / scaffolds) * Math.PI * 2 + rng.float(-0.4, 0.4);
    const elev = weeping ? rng.float(0.7, 1.0) : rng.float(0.45, 0.85);
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)).normalize();
    const start = trunk.pts[Math.max(2, trunk.pts.length - 1 - (s % 2))];
    grow(start, dir, weeping ? rng.float(2.6, 3.4) : rng.float(3.0, 4.0), trunkR * rng.float(0.55, 0.7), 0);
  }
  b.finalizeClusters(rng, weeping ? 0.35 : 0.3, 1.8);
  return b.build();
}

function hangingStrands(b, rng, from, count) {
  for (let s = 0; s < count; s++) {
    const x0 = from.x + rng.float(-0.8, 0.8);
    const z0 = from.z + rng.float(-0.8, 0.8);
    const y0 = from.y + rng.float(-0.2, 0.3);
    const len = Math.max(1.2, y0 - rng.float(0.6, 1.6));
    const steps = Math.floor(len / 0.45);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const p = new THREE.Vector3(x0 + Math.sin(t * 3 + s) * 0.12, y0 - k * 0.45, z0 + Math.cos(t * 2.5 + s) * 0.12);
      b.clusters.push({ center: p, radius: 0.25, count: 1, flatten: 1, upBias: 0, sizeMin: 0.6, sizeMax: 0.85 });
    }
  }
}

function maple(rng) {
  const b = new TreeBuilder();
  const trunkH = rng.float(1.4, 2.0);
  const trunkR = rng.float(0.16, 0.22);
  const trunk = growLimb(b, rng, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(rng.float(-0.1, 0.1), 1, rng.float(-0.1, 0.1)).normalize(), trunkH, trunkR * 1.15, trunkR * 0.8, 3, 7, 0, 0.1, 0);
  const grow = (pos, dir, len, rad, depth) => {
    const limb = growLimb(b, rng, pos, dir, len, rad, rad * 0.6, SEGS[depth], SIDES[depth], depth >= 2 ? 0.12 : 0, 0.2, depth);
    if (depth >= 2 || rad < 0.025) {
      b.cluster(limb.end, rng.float(1.1, 1.4), rng.int(8, 11), rng, { flatten: 0.75, upBias: 0.35 });
      return;
    }
    if (depth >= 1) b.cluster(limb.pts[1], rng.float(0.9, 1.1), rng.int(3, 4), rng, { flatten: 0.8, upBias: 0.3 });
    const kids = rng.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const p = limb.pts[Math.min(limb.pts.length - 1, Math.max(1, rng.int(1, 3)))];
      grow(p, spreadDir(limb.dir, rng.float(0.4, 0.8), rng, p, 0.5, 0.25), len * rng.float(0.65, 0.8), rad * 0.62, depth + 1);
    }
  };
  const n = rng.int(3, 4);
  for (let s = 0; s < n; s++) {
    const a = (s / n) * Math.PI * 2 + rng.float(-0.5, 0.5);
    const elev = rng.float(0.6, 1.05);
    const dir = new THREE.Vector3(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev));
    grow(trunk.end, dir, rng.float(2.2, 3.0), trunkR * 0.65, 0);
  }
  b.finalizeClusters(rng, 0.3, 1.8);
  return b.build();
}

function pine(rng) {
  const b = new TreeBuilder();
  const pts = [];
  const radii = [];
  const H = rng.float(6, 8.5);
  const leanA = rng.float(0, Math.PI * 2);
  const leanAmt = rng.float(0.5, 1.6);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(Math.cos(leanA) * leanAmt * t * t + Math.sin(t * 5) * 0.25, t * H - 0.2, Math.sin(leanA) * leanAmt * t * t + Math.cos(t * 4) * 0.2));
    radii.push(0.3 * (1 - t * 0.75));
  }
  b.addLimb(pts, radii, 7, 0);
  // tiers of horizontal branches ending in cloud-pruned pads
  const tiers = rng.int(4, 6);
  for (let k = 0; k < tiers; k++) {
    const t = 0.45 + (k / tiers) * 0.55;
    const i = Math.min(6, Math.round(t * 6));
    const p = pts[i];
    const a = rng.float(0, Math.PI * 2);
    const len = (1 - t) * 3.2 + 1.0;
    const dir = new THREE.Vector3(Math.cos(a), rng.float(-0.05, 0.25), Math.sin(a)).normalize();
    const limb = growLimb(b, rng, p, dir, len, radii[i] * 0.5, 0.03, 2, 4, 0.1, 0.25, 1);
    b.cluster(limb.end.clone().add(new THREE.Vector3(0, 0.25, 0)), rng.float(1.0, 1.5), rng.int(9, 12), rng, { flatten: 0.35, upBias: 1.2, sizeMin: 0.9, sizeMax: 1.3 });
  }
  b.cluster(pts[6].clone().add(new THREE.Vector3(0, 0.3, 0)), 1.2, 10, rng, { flatten: 0.45, upBias: 1.2 });
  b.finalizeClusters(rng, 0.35, 1.7);
  return b.build();
}

// Tall Japanese cedar (sugi): straight trunk + layered drooping sprays
function cedar(rng) {
  const b = new TreeBuilder();
  const H = rng.float(13, 18);
  b.tube(b.near, [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, H * 0.5, 0), new THREE.Vector3(0, H, 0)], [0.32, 0.2, 0.04], 6);
  const crownBase = H * 0.3;
  const layers = 6;
  b.crownCenter.set(0, (crownBase + H) / 2, 0);
  b.crownRadius.set(2.5, (H - crownBase) / 2, 2.5);
  for (let l = 0; l < layers; l++) {
    const t = l / (layers - 1);
    const y = crownBase + t * (H - crownBase) * 0.95;
    const r = (1 - t) * 2.6 + 0.4;
    const cards = Math.round(3 + r * 2.4);
    for (let k = 0; k < cards; k++) {
      const a = (k / cards) * Math.PI * 2 + rng.float(-0.3, 0.3) + l;
      const dist = r * rng.float(0.35, 0.8);
      const p = new THREE.Vector3(Math.cos(a) * dist, y + rng.float(-0.3, 0.3), Math.sin(a) * dist);
      const n = new THREE.Vector3(Math.cos(a), rng.float(-0.2, 0.9), Math.sin(a)).normalize();
      const ao = 0.5 + 0.5 * t + rng.float(-0.05, 0.05);
      b.card(b.near, p, n, (r * 0.9 + 1.3) * 1.15, rng.float(-0.4, 0.4), clamp(ao, 0.35, 1), 1.25);
    }
  }
  return b.build().near;
}

// Far LOD cedar: two stacked cones with vertex-colored shading
function cedarFarGeometry() {
  const cone1 = new THREE.ConeGeometry(2.7, 9, 7, 1, true);
  cone1.translate(0, 8.5, 0);
  const cone2 = new THREE.ConeGeometry(1.8, 7, 7, 1, true);
  cone2.translate(0, 13, 0);
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, 5, 5, 1, true);
  trunk.translate(0, 2.2, 0);
  const geo = mergeSimple([cone1, cone2, trunk]);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const n1 = cone1.attributes.position.count + cone2.attributes.position.count;
  for (let i = 0; i < pos.count; i++) {
    const k = i >= n1 ? 0.5 : 0.45 + (pos.getY(i) / 16) * 0.55;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function mergeSimple(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx = [];
  let off = 0;
  for (const g of geos) {
    const gi = g.index ? g.index.array : [...Array(g.attributes.position.count).keys()];
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

// ---------------- instancing ----------------

function instanceMatrix(t, m = new THREE.Matrix4()) {
  return m.compose(
    new THREE.Vector3(t.x, t.y, t.z),
    new THREE.Quaternion().setFromAxisAngle(UP, t.rot),
    new THREE.Vector3(t.scale, t.scale, t.scale)
  );
}

function makeInstanced(geo, material, capacity, { cast = true, receive = true, depth = null, layer = 0 } = {}) {
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  if (depth) mesh.customDepthMaterial = depth;
  if (layer) mesh.layers.set(layer);
  return mesh;
}

export function buildTrees(planner, quality) {
  const group = new THREE.Group();
  group.name = 'trees';
  const rng = new Rng(4242);

  const barkS = makeBarkTexture('sakura');
  const barkC = makeBarkTexture('cedar');
  const barkMat = windMaterial(new THREE.MeshStandardMaterial({ map: barkS.map, normalMap: barkS.normalMap, roughness: 0.95 }), { swayBase: 2.5, swayAmt: 0.0022, key: 'bark' });
  const cedarBarkMat = windMaterial(new THREE.MeshStandardMaterial({ map: barkC.map, normalMap: barkC.normalMap, roughness: 0.95 }), { swayBase: 6, swayAmt: 0.0006, key: 'cbark' });

  const foliage = (tex, { color = 0xffffff, rough = 0.75, translucent = 0.6, sway = 0.0022, base = 2.5, flutter = 0.035 } = {}) => {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      color,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: rough,
      metalness: 0,
      alphaToCoverage: quality.msaa > 0,
    });
    windMaterial(mat, { swayBase: base, swayAmt: sway, flutter, translucent, key: 'fol' });
    const depth = windDepthMaterial(tex, { swayBase: base, swayAmt: sway });
    return { mat, depth };
  };
  const blossom = foliage(makeBlossomTexture(3, 'sakura'), { translucent: 0.8 });
  const blossomW = foliage(makeBlossomTexture(8, 'weeping'), { translucent: 0.8, sway: 0.0035, base: 1.5, flutter: 0.06 });
  const mapleF = foliage(makeLeafTexture('maple', 5), { translucent: 0.9 });
  const pineF = foliage(makeLeafTexture('pine', 6), { rough: 0.85, translucent: 0.25, sway: 0.0012, flutter: 0.015 });
  const cedarF = foliage(makeCedarTexture(12), { color: 0x9fb096, rough: 0.9, translucent: 0.2, sway: 0.0005, base: 6, flutter: 0.01 });

  // Broadleaf species: instances are re-bucketed into near / far meshes as the camera moves
  const lodSets = [];
  const addSpecies = (list, templates, barkMaterial, fol) => {
    if (!list.length) return;
    const buckets = templates.map(() => []);
    list.forEach((t) => buckets[t.variant % templates.length].push(t));
    templates.forEach((tpl, i) => {
      const items = buckets[i];
      if (!items.length) return;
      const n = items.length;
      const set = {
        items,
        matrices: items.map((t) => instanceMatrix(t)),
        nearBark: makeInstanced(tpl.near.branchGeo, barkMaterial, n),
        nearFol: makeInstanced(tpl.near.foliageGeo, fol.mat, n, { depth: fol.depth }),
        farBark: makeInstanced(tpl.far.branchGeo, barkMaterial, n, { cast: false }),
        farFol: makeInstanced(tpl.far.foliageGeo, fol.mat, n, { cast: false }),
      };
      for (const m of [set.nearBark, set.nearFol, set.farBark, set.farFol]) {
        m.frustumCulled = false;
        m.count = 0;
        group.add(m);
      }
      lodSets.push(set);
    });
  };

  const T = planner.trees;
  addSpecies(T.sakura, Array.from({ length: 6 }, () => sakura(rng)), barkMat, blossom);
  addSpecies(T.weeping, Array.from({ length: 3 }, () => sakura(rng, true)), barkMat, blossomW);
  addSpecies(T.maple, Array.from({ length: 4 }, () => maple(rng)), barkMat, mapleF);
  addSpecies(T.pine, Array.from({ length: 3 }, () => pine(rng)), barkMat, pineF);

  // Cedars: chunked with near/far LOD. Near cedars stay out of water reflections (layer 1).
  const cedarNear = [0, 1, 2].map(() => cedar(rng));
  const farGeo = cedarFarGeometry();
  const farMat = new THREE.MeshStandardMaterial({ color: 0x2b4a2c, vertexColors: true, roughness: 0.95 });
  // near chunks (200 m) hold detailed cedars; far chunks (400 m) hold the simple ones,
  // minus any trees whose near chunk is currently active
  const CH = 200;
  const FCH = 400;
  const nearChunks = new Map();
  const farChunks = new Map();
  for (const t of T.cedar) {
    const nk = `${Math.floor(t.x / CH)},${Math.floor(t.z / CH)}`;
    const fk = `${Math.floor(t.x / FCH)},${Math.floor(t.z / FCH)}`;
    t.nearKey = nk;
    if (!nearChunks.has(nk)) nearChunks.set(nk, []);
    nearChunks.get(nk).push(t);
    if (!farChunks.has(fk)) farChunks.set(fk, []);
    farChunks.get(fk).push(t);
  }
  const cedarNearChunks = [];
  for (const [key, list] of nearChunks) {
    const [cx, cz] = key.split(',').map(Number);
    const center = new THREE.Vector3((cx + 0.5) * CH, 0, (cz + 0.5) * CH);
    const near = new THREE.Group();
    near.visible = false;
    const buckets = cedarNear.map(() => []);
    list.forEach((t) => buckets[t.variant % cedarNear.length].push(t));
    cedarNear.forEach((tpl, i) => {
      if (!buckets[i].length) return;
      const mats = buckets[i].map((t) => instanceMatrix(t));
      const bark = makeInstanced(tpl.branchGeo, cedarBarkMat, mats.length, { layer: 1 });
      const fol = makeInstanced(tpl.foliageGeo, cedarF.mat, mats.length, { depth: cedarF.depth, layer: 1 });
      mats.forEach((m, k) => {
        bark.setMatrixAt(k, m);
        fol.setMatrixAt(k, m);
      });
      bark.computeBoundingSphere();
      fol.computeBoundingSphere();
      near.add(bark, fol);
    });
    group.add(near);
    cedarNearChunks.push({ key, center, near, active: false });
  }
  const cedarFarChunks = [];
  for (const [, list] of farChunks) {
    const far = makeInstanced(farGeo, farMat, list.length, { cast: false });
    const matrices = list.map((t) => instanceMatrix(t));
    list.forEach((t, k) => far.setMatrixAt(k, matrices[k]));
    far.computeBoundingSphere();
    group.add(far);
    cedarFarChunks.push({ list, matrices, far });
  }
  const activeNear = new Set();
  const refreshFar = () => {
    for (const fc of cedarFarChunks) {
      let n = 0;
      for (let i = 0; i < fc.list.length; i++) {
        if (activeNear.has(fc.list[i].nearKey)) continue;
        fc.far.setMatrixAt(n++, fc.matrices[i]);
      }
      fc.far.count = n;
      fc.far.instanceMatrix.needsUpdate = true;
    }
  };

  const NEAR_BROADLEAF = 150;
  let lodTimer = 0;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  const rebucket = (cp) => {
    for (const s of lodSets) {
      let nn = 0,
        nf = 0;
      for (let i = 0; i < s.items.length; i++) {
        const t = s.items[i];
        if (Math.hypot(t.x - cp.x, t.z - cp.z) < NEAR_BROADLEAF) {
          s.nearBark.setMatrixAt(nn, s.matrices[i]);
          s.nearFol.setMatrixAt(nn, s.matrices[i]);
          nn++;
        } else {
          s.farBark.setMatrixAt(nf, s.matrices[i]);
          s.farFol.setMatrixAt(nf, s.matrices[i]);
          nf++;
        }
      }
      s.nearBark.count = s.nearFol.count = nn;
      s.farBark.count = s.farFol.count = nf;
      for (const m of [s.nearBark, s.nearFol, s.farBark, s.farFol]) m.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    group,
    update(camera, dt = 0.016) {
      const cp = camera.position;
      lodTimer -= dt;
      if (lodTimer <= 0 || cp.distanceToSquared(lastCam) > 30 * 30) {
        lodTimer = 0.5;
        lastCam.copy(cp);
        rebucket(cp);
      }
      let changed = false;
      for (const c of cedarNearChunks) {
        const dx = Math.max(Math.abs(cp.x - c.center.x) - CH / 2, 0);
        const dz = Math.max(Math.abs(cp.z - c.center.z) - CH / 2, 0);
        const on = Math.hypot(dx, dz) < 110;
        if (on !== c.active) {
          c.active = on;
          c.near.visible = on;
          if (on) activeNear.add(c.key);
          else activeNear.delete(c.key);
          changed = true;
        }
      }
      if (changed) refreshFar();
    },
  };
}
