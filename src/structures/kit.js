import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeRoofTileTexture,
  makeWoodTexture,
  makeStoneTexture,
  makeThatchTexture,
  makeShojiTexture,
  makePlasterTexture,
} from '../core/textures.js';

// Shared materials for all buildings (created once)
let MATS = null;
export const nightUniform = { value: 0 };

export function materials() {
  if (MATS) return MATS;
  const tiles = makeRoofTileTexture([62, 66, 72]);
  const tilesGreen = makeRoofTileTexture([74, 128, 112]);
  const stone = makeStoneTexture([150, 146, 136]);
  const wood = makeWoodTexture([112, 76, 48], 4);
  const woodDark = makeWoodTexture([58, 40, 30], 7);
  const woodGray = makeWoodTexture([118, 108, 96], 9);
  const lit = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...opts });
  MATS = {
    vermilion: lit(0xc8401f, { roughness: 0.42 }),
    vermilionDark: lit(0x9e2e17, { roughness: 0.5 }),
    black: lit(0x1a1818, { roughness: 0.45 }),
    white: lit(0xf1ece0, { roughness: 0.8, map: makePlasterTexture() }),
    wood: lit(0xffffff, { map: wood, roughness: 0.8 }),
    woodDark: lit(0xffffff, { map: woodDark, roughness: 0.75 }),
    woodGray: lit(0xffffff, { map: woodGray, roughness: 0.9 }),
    stone: lit(0xffffff, { map: stone.map, normalMap: stone.normalMap, roughness: 0.95 }),
    tiles: lit(0xffffff, { map: tiles.map, normalMap: tiles.normalMap, roughness: 0.55 }),
    tilesGreen: lit(0xffffff, { map: tilesGreen.map, normalMap: tilesGreen.normalMap, roughness: 0.6 }),
    thatch: lit(0xffffff, { map: makeThatchTexture(), roughness: 1 }),
    bronze: lit(0x8a6a32, { roughness: 0.35, metalness: 0.85 }),
    gold: lit(0xd4a73c, { roughness: 0.3, metalness: 1 }),
    paper: lit(0xfbf8f0, { roughness: 0.9, side: THREE.DoubleSide }),
    rope: lit(0xc9b27a, { roughness: 1 }),
    shoji: new THREE.MeshStandardMaterial({ map: makeShojiTexture(), roughness: 0.9, emissive: 0xffb45a, emissiveIntensity: 0 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.8, emissive: 0xffa447, emissiveIntensity: 0 }),
    mud: lit(0x4a3f2c, { roughness: 1 }),
    paddyWater: new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.88 }),
    rice: lit(0x6f9a3a, { roughness: 0.8, side: THREE.DoubleSide }),
    brush: lit(0x5a4630, { roughness: 1 }),
  };
  MATS.wood.map.repeat.set(1, 1);
  return MATS;
}

// Night glow for windows and lanterns
export function setNight(n) {
  const M = materials();
  M.shoji.emissiveIntensity = n * 1.6;
  M.lamp.emissiveIntensity = n * 4.0;
  M.lamp.color.setRGB(0.17 + n * 0.3, 0.13 + n * 0.2, 0.09 + n * 0.1);
}

// Collects geometries per material and merges them into one geometry with groups
export class GeoBuilder {
  constructor() {
    this.parts = new Map();
  }
  add(geo, mat, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  box(w, h, d, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleUv(g, w, h, d);
    return this.add(g, mat, mtx(x, y, z, rx, ry, rz));
  }
  cyl(r0, r1, h, mat, x = 0, y = 0, z = 0, seg = 12, rx = 0, ry = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg);
    return this.add(g, mat, mtx(x, y, z, rx, ry, rz));
  }
  // cylinder between two points
  beam(a, b, r, mat, seg = 8) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, mat, m);
  }
  // box between two points (square section)
  plank(a, b, w, h, mat, up = new THREE.Vector3(0, 1, 0)) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.BoxGeometry(w, h, len);
    scaleUv(g, w, h, len);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, up);
    m.setPosition(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5));
    return this.add(g, mat, m);
  }
  sphere(r, mat, x, y, z, sx = 1, sy = 1, sz = 1) {
    const g = new THREE.SphereGeometry(r, 12, 8);
    g.scale(sx, sy, sz);
    return this.add(g, mat, mtx(x, y, z));
  }
  build() {
    const mats = [];
    const geos = [];
    for (const [mat, list] of this.parts) {
      mats.push(mat);
      geos.push(mergeGeometries(list, false));
    }
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    return { geo, mats };
  }
  mesh() {
    const { geo, mats } = this.build();
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

export function mtx(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s)
  );
}

// Box UVs in meters so textures keep a consistent scale
function scaleUv(g, w, h, d) {
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] * 0.5, uv.getY(i) * dims[f][1] * 0.5);
    }
}

// Japanese curved roof surface over a square/rectangle.
// hx,hz: eave half extents; ix,iz: top (ridge/body) half extents; height; lift: corner upturn
export function curvedRoof(gb, { hx, hz, ix, iz, height, lift = 0.4, thick = 0.22, rings = 8, per = 10, y = 0, topMat, underMat, fasciaMat }) {
  const loops = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const ex = ix + (hx - ix) * t;
    const ez = iz + (hz - iz) * t;
    const hh = height * Math.pow(1 - t, 1.7);
    const loop = [];
    for (let s = 0; s < 4; s++) {
      for (let p = 0; p < per; p++) {
        const f = p / per;
        let px, pz;
        if (s === 0) {
          px = -ex + 2 * ex * f;
          pz = -ez;
        } else if (s === 1) {
          px = ex;
          pz = -ez + 2 * ez * f;
        } else if (s === 2) {
          px = ex - 2 * ex * f;
          pz = ez;
        } else {
          px = -ex;
          pz = ez - 2 * ez * f;
        }
        const cx = Math.pow(Math.abs(px) / ex, 6);
        const cz = Math.pow(Math.abs(pz) / ez, 6);
        const corner = cx * cz;
        const up = lift * Math.pow(t, 2.2) * (0.25 + 0.75 * corner);
        loop.push(new THREE.Vector3(px, y + hh + up, pz));
      }
    }
    loops.push(loop);
  }
  const n = loops[0].length;
  const surface = (offsetY, flip, mat) => {
    const pos = [];
    const uv = [];
    for (let k = 0; k < rings; k++) {
      for (let i = 0; i < n; i++) {
        const a = loops[k][i],
          b = loops[k][(i + 1) % n],
          c = loops[k + 1][i],
          d = loops[k + 1][(i + 1) % n];
        const tri = flip ? [a, c, b, b, c, d] : [a, b, c, b, d, c];
        const uvs = flip
          ? [
              [i, k],
              [i, k + 1],
              [i + 1, k],
              [i + 1, k],
              [i, k + 1],
              [i + 1, k + 1],
            ]
          : [
              [i, k],
              [i + 1, k],
              [i, k + 1],
              [i + 1, k],
              [i + 1, k + 1],
              [i, k + 1],
            ];
        tri.forEach((v, j) => {
          pos.push(v.x, v.y + offsetY, v.z);
          uv.push((uvs[j][0] / per) * 1.5, uvs[j][1] * 0.6);
        });
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    gb.add(g, mat);
  };
  surface(0, false, topMat);
  surface(-thick, true, underMat);
  // fascia band around the eave
  const outer = loops[rings];
  const pos = [];
  const uv = [];
  for (let i = 0; i < n; i++) {
    const a = outer[i],
      b = outer[(i + 1) % n];
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, a.x, a.y - thick, a.z, b.x, b.y, b.z, b.x, b.y - thick, b.z, a.x, a.y - thick, a.z);
    uv.push(0, 0, 1, 0, 0, 0.2, 1, 0, 1, 0.2, 0, 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  gb.add(g, fasciaMat || underMat);
  return loops;
}
