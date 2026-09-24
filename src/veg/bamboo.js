import * as THREE from 'three';
import { Rng } from '../core/noise.js';
import { windMaterial, windDepthMaterial } from './common.js';
import { makeBambooTexture, makeLeafTexture } from '../core/textures.js';

const H = 12; // template height, instances are scaled

function stalkGeometry() {
  const g = new THREE.CylinderGeometry(0.068, 0.068, H, 6, 6, true);
  g.translate(0, H / 2, 0);
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setY(i, pos.getY(i) / 1.6);
  // taper towards the top
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / H;
    const k = 1 - t * 0.55;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function leafCrown(rng) {
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const cards = 26;
  for (let c = 0; c < cards; c++) {
    const y = H * (0.5 + 0.5 * Math.pow(rng.next(), 0.7));
    const a = rng.float(0, Math.PI * 2);
    const out = rng.float(0.3, 1.9) * (1.1 - (y / H) * 0.5);
    const center = new THREE.Vector3(Math.cos(a) * out, y - out * 0.25, Math.sin(a) * out);
    const n = new THREE.Vector3(Math.cos(a), rng.float(0.2, 1.0), Math.sin(a)).normalize();
    const u = new THREE.Vector3().crossVectors(up, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u).normalize();
    const s = rng.float(1.1, 1.7);
    const base = pos.length / 3;
    const shadeN = new THREE.Vector3(center.x, (y - H * 0.75) * 0.4, center.z).normalize();
    const ao = 0.6 + 0.4 * (y / H);
    for (const [a1, b1, uu, vv] of [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ]) {
      pos.push(center.x + (u.x * a1 + v.x * b1) * s * 0.5, center.y + (u.y * a1 + v.y * b1) * s * 0.5, center.z + (u.z * a1 + v.z * b1) * s * 0.5);
      nor.push(shadeN.x, shadeN.y + 0.3, shadeN.z);
      uv.push(uu, vv);
      col.push(ao, ao, ao);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

export function buildBamboo(planner, quality) {
  const group = new THREE.Group();
  group.name = 'bamboo';
  const list = planner.bamboo;
  if (!list.length) return { group };
  const rng = new Rng(55);
  const stalkMat = windMaterial(new THREE.MeshStandardMaterial({ map: makeBambooTexture(), roughness: 0.45, metalness: 0 }), {
    swayBase: 1,
    swayAmt: 0.0022,
    key: 'bamboo',
  });
  const leafTex = makeLeafTexture('bamboo', 31);
  const leafMat = windMaterial(
    new THREE.MeshStandardMaterial({
      map: leafTex,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      vertexColors: true,
      roughness: 0.7,
      alphaToCoverage: quality.msaa > 0,
    }),
    { swayBase: 1, swayAmt: 0.0022, flutter: 0.05, translucent: 0.9, key: 'bleaf' }
  );
  const leafDepth = windDepthMaterial(leafTex, { swayBase: 1, swayAmt: 0.0022 });

  const stalk = stalkGeometry();
  const crowns = [0, 1, 2].map(() => leafCrown(rng));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const buckets = crowns.map(() => []);
  const stalkMats = [];
  list.forEach((b, i) => {
    axis.set(Math.cos(b.dir), 0, -Math.sin(b.dir));
    tilt.setFromAxisAngle(axis, b.lean);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.phase).premultiply(tilt);
    const sy = b.h / H;
    const rs = b.r / 0.068;
    const stalkM = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y - 0.2, b.z), q, new THREE.Vector3(rs, sy, rs));
    stalkMats.push(stalkM);
    const crownM = new THREE.Matrix4().compose(new THREE.Vector3(b.x, b.y - 0.2, b.z), q, new THREE.Vector3(1, sy, 1));
    buckets[i % crowns.length].push(crownM);
  });
  const stalks = new THREE.InstancedMesh(stalk, stalkMat, stalkMats.length);
  stalkMats.forEach((mm, i) => stalks.setMatrixAt(i, mm));
  stalks.castShadow = true;
  stalks.receiveShadow = true;
  stalks.computeBoundingSphere();
  group.add(stalks);
  crowns.forEach((geo, i) => {
    if (!buckets[i].length) return;
    const mesh = new THREE.InstancedMesh(geo, leafMat, buckets[i].length);
    buckets[i].forEach((mm, k) => mesh.setMatrixAt(k, mm));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = leafDepth;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return { group };
}
