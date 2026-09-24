import * as THREE from 'three';
import { smoothstep, clamp, lerp } from '../core/noise.js';
import { patchMaterial } from '../core/fog.js';
import { WORLD_HALF, GRID_STEP, GRID_N, ROAD_HALF_WIDTH as HW, PLAY_HALF } from './layout.js';

const N = GRID_N;

function srgb(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b]; // THREE.Color converts hex (sRGB) to linear working space
}

const C = {
  grassA: srgb(0x5f8f3a),
  grassB: srgb(0x8aa64c),
  grassC: srgb(0x42702e),
  grassDry: srgb(0x9f9b5c),
  forest: srgb(0x3a5329),
  forestBrown: srgb(0x5b4a33),
  dirt: srgb(0x8b7a5c),
  gravel: srgb(0x9d937f),
  sand: srgb(0xa89d86),
  wet: srgb(0x6a604e),
  bed: srgb(0x55604a),
  bedDeep: srgb(0x33413a),
  rock: srgb(0x7b776c),
  nanohanaTint: srgb(0xc7bf3b),
  mud: srgb(0x5e5038),
  petal: srgb(0xe9b9c6),
  shiba: [srgb(0xd8317c), srgb(0xf27fab), srgb(0xf1e2f0), srgb(0xa985da)],
};

function mix3(out, a, t) {
  out[0] += (a[0] - out[0]) * t;
  out[1] += (a[1] - out[1]) * t;
  out[2] += (a[2] - out[2]) * t;
}

// Compute per-vertex ground colors and store them on the heightfield
export function computeGroundColors(hf, planner) {
  const colors = new Float32Array(N * N * 3);
  const normals = new Float32Array(N * N * 3);
  const H = hf.H;
  const S = hf.noise;
  // petal density from sakura trees
  const petal = new Float32Array(N * N);
  const stamp = (arr, x, z, r, w) => {
    const ix0 = Math.max(0, Math.floor((x - r + WORLD_HALF) / GRID_STEP));
    const ix1 = Math.min(N - 1, Math.ceil((x + r + WORLD_HALF) / GRID_STEP));
    const iz0 = Math.max(0, Math.floor((z - r + WORLD_HALF) / GRID_STEP));
    const iz1 = Math.min(N - 1, Math.ceil((z + r + WORLD_HALF) / GRID_STEP));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -WORLD_HALF + ix * GRID_STEP - x;
        const dz = -WORLD_HALF + iz * GRID_STEP - z;
        const d = Math.hypot(dx, dz) / r;
        if (d < 1) arr[iz * N + ix] = Math.min(1, arr[iz * N + ix] + w * (1 - d * d));
      }
  };
  for (const t of planner.trees.sakura) stamp(petal, t.x, t.z, 7 * t.scale, 0.8);
  for (const t of planner.trees.weeping) stamp(petal, t.x, t.z, 6 * t.scale, 0.9);
  hf.petal = petal;

  // forest floor darkening from cedar density
  const forestDen = new Float32Array(N * N);
  for (const t of planner.trees.cedar) stamp(forestDen, t.x, t.z, 6, 0.5);

  const col = [0, 0, 0];
  for (let iz = 0; iz < N; iz++) {
    const z = -WORLD_HALF + iz * GRID_STEP;
    for (let ix = 0; ix < N; ix++) {
      const x = -WORLD_HALF + ix * GRID_STEP;
      const k = iz * N + ix;
      // normal
      const hL = H[iz * N + Math.max(ix - 1, 0)];
      const hR = H[iz * N + Math.min(ix + 1, N - 1)];
      const hD = H[Math.max(iz - 1, 0) * N + ix];
      const hU = H[Math.min(iz + 1, N - 1) * N + ix];
      let nx = hL - hR,
        ny = 2 * GRID_STEP,
        nz = hD - hU;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl;
      ny /= nl;
      nz /= nl;
      normals[k * 3] = nx;
      normals[k * 3 + 1] = ny;
      normals[k * 3 + 2] = nz;
      const h = H[k];
      const slope = 1 - ny;

      // meadow base with large-scale variation
      const n1 = S.noise(x * 0.004 + 3, z * 0.004 - 1);
      const n2 = S.noise(x * 0.02 - 7, z * 0.02 + 5);
      const n3 = S.noise(x * 0.09, z * 0.09);
      col[0] = C.grassA[0];
      col[1] = C.grassA[1];
      col[2] = C.grassA[2];
      mix3(col, C.grassB, smoothstep(-0.2, 0.7, n1) * 0.7);
      mix3(col, C.grassC, smoothstep(0.0, 0.8, n2) * 0.5);
      mix3(col, C.grassDry, smoothstep(0.45, 0.9, n1 * 0.6 + n3 * 0.4) * 0.35);

      // hills get darker, forest floors brownish
      const fd = forestDen[k];
      mix3(col, C.forest, Math.min(1, fd * 1.2 + smoothstep(40, 140, h) * 0.6));
      mix3(col, C.forestBrown, fd * 0.25);

      // steep rock
      mix3(col, C.rock, smoothstep(0.28, 0.5, slope + n3 * 0.05));

      // flower fields
      const nano = planner.nanohana(x, z);
      if (nano > 0) mix3(col, C.nanohanaTint, nano * 0.55);
      const sh = planner.shibazakura(x, z);
      if (sh.m > 0) mix3(col, C.shiba[sh.color], sh.m * 0.92);

      // water banks
      const wd = hf.waterD[k];
      if (wd < 6) {
        mix3(col, C.sand, 1 - smoothstep(1.5, 5.5, wd + n3 * 0.8));
        mix3(col, C.wet, 1 - smoothstep(0.0, 1.6, wd));
        if (wd < 0) {
          mix3(col, C.bed, 1);
          mix3(col, C.bedDeep, smoothstep(0, 9, -wd));
        }
      }

      // road shoulders
      const rd = hf.roadD[k];
      if (rd < HW + 4) {
        mix3(col, C.dirt, (1 - smoothstep(HW + 0.4, HW + 1.6 + n3 * 0.5, rd)) * 0.75);
      }

      // fallen petals under cherry trees
      const pd = petal[k];
      if (pd > 0) mix3(col, C.petal, Math.min(0.55, pd * (0.45 + 0.35 * n3)));

      // paddies: muddy
      if (planner.inPaddies(x, z, -0.4)) mix3(col, C.mud, 0.85);

      colors[k * 3] = col[0];
      colors[k * 3 + 1] = col[1];
      colors[k * 3 + 2] = col[2];
    }
  }
  // flat zones (house yards, shrine, pagoda) -> gravel
  for (const Z of hf.flatZones) {
    if (Z.hx > 20) continue;
    const r = Math.hypot(Z.hx, Z.hz) + 1;
    const ix0 = Math.max(0, Math.floor((Z.x - r + WORLD_HALF) / GRID_STEP));
    const ix1 = Math.min(N - 1, Math.ceil((Z.x + r + WORLD_HALF) / GRID_STEP));
    const iz0 = Math.max(0, Math.floor((Z.z - r + WORLD_HALF) / GRID_STEP));
    const iz1 = Math.min(N - 1, Math.ceil((Z.z + r + WORLD_HALF) / GRID_STEP));
    for (let iz = iz0; iz <= iz1; iz++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -WORLD_HALF + ix * GRID_STEP - Z.x;
        const dz = -WORLD_HALF + iz * GRID_STEP - Z.z;
        const lx = dx * Z.c + dz * Z.s;
        const lz = -dx * Z.s + dz * Z.c;
        const e = Math.hypot(Math.max(Math.abs(lx) - Z.hx + 1.5, 0), Math.max(Math.abs(lz) - Z.hz + 1.5, 0));
        const w = 1 - smoothstep(0, 3, e);
        if (w <= 0) continue;
        const k = iz * N + ix;
        for (let c = 0; c < 3; c++) colors[k * 3 + c] = lerp(colors[k * 3 + c], C.gravel[c], w * 0.85);
      }
  }
  hf.colors = colors;
  hf.normals = normals;
}

// Build one chunk geometry at a given grid stride
function chunkGeometry(hf, ix0, iz0, cells, stride, skirt) {
  const n = cells / stride + 1;
  const vCount = n * n + (skirt > 0 ? 4 * n : 0);
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const H = hf.H;
  let v = 0;
  const put = (ix, iz, dy) => {
    const k = iz * N + ix;
    const x = -WORLD_HALF + ix * GRID_STEP;
    const z = -WORLD_HALF + iz * GRID_STEP;
    pos[v * 3] = x;
    pos[v * 3 + 1] = H[k] - dy;
    pos[v * 3 + 2] = z;
    nor[v * 3] = hf.normals[k * 3];
    nor[v * 3 + 1] = hf.normals[k * 3 + 1];
    nor[v * 3 + 2] = hf.normals[k * 3 + 2];
    col[v * 3] = hf.colors[k * 3];
    col[v * 3 + 1] = hf.colors[k * 3 + 1];
    col[v * 3 + 2] = hf.colors[k * 3 + 2];
    uv[v * 2] = x / 5;
    uv[v * 2 + 1] = z / 5;
    v++;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) put(ix0 + i * stride, iz0 + j * stride, 0);
  const idx = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i,
        b = a + 1,
        c = a + n,
        d = c + 1;
      // alternate diagonals to reduce directional artifacts
      if ((i + j) % 2 === 0) idx.push(a, c, b, b, c, d);
      else idx.push(a, c, d, a, d, b);
    }
  if (skirt > 0) {
    // four edges: bottom (j=0), top (j=n-1), left (i=0), right (i=n-1)
    const edges = [
      (t) => [t, 0],
      (t) => [t, n - 1],
      (t) => [0, t],
      (t) => [n - 1, t],
    ];
    for (let e = 0; e < 4; e++) {
      const start = v;
      for (let t = 0; t < n; t++) {
        const [i, j] = edges[e](t);
        put(ix0 + i * stride, iz0 + j * stride, skirt);
      }
      for (let t = 0; t < n - 1; t++) {
        const [i0, j0] = edges[e](t);
        const [i1, j1] = edges[e](t + 1);
        const a = j0 * n + i0,
          b = j1 * n + i1;
        const sa = start + t,
          sb = start + t + 1;
        // double-sided skirt triangles
        idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function makeTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: tex.map,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.93,
    metalness: 0,
  });
  patchMaterial(
    mat,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 d1 = texture2D( map, vMapUv );
        vec4 d2 = texture2D( map, vMapUv * 0.131 + vec2( 0.31, 0.67 ) );
        vec4 d3 = texture2D( map, vMapUv * 0.023 + vec2( 0.7, 0.2 ) );
        diffuseColor.rgb *= d1.rgb * d2.rgb * mix( 0.85, 1.15, d3.g ) * 1.32;
        `
      );
    },
    'terrain'
  );
  return mat;
}

export function buildTerrain(hf, tex) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const material = makeTerrainMaterial(tex);
  const CH = 100; // cells per chunk (200 m)
  const chunksPerSide = (N - 1) / CH;
  for (let cz = 0; cz < chunksPerSide; cz++) {
    for (let cx = 0; cx < chunksPerSide; cx++) {
      const ix0 = cx * CH,
        iz0 = cz * CH;
      const centerX = -WORLD_HALF + (ix0 + CH / 2) * GRID_STEP;
      const centerZ = -WORLD_HALF + (iz0 + CH / 2) * GRID_STEP;
      const inner = Math.max(Math.abs(centerX), Math.abs(centerZ)) < PLAY_HALF + 160;
      const lod = new THREE.LOD();
      const levels = inner
        ? [
            [1, 0],
            [2, 290],
            [5, 700],
          ]
        : [
            [2, 0],
            [5, 600],
          ];
      for (const [stride, dist] of levels) {
        const geo = chunkGeometry(hf, ix0, iz0, CH, stride, stride * 0.9 + 0.4);
        const mesh = new THREE.Mesh(geo, material);
        mesh.receiveShadow = true;
        mesh.castShadow = stride === 1;
        mesh.matrixAutoUpdate = false;
        lod.addLevel(mesh, dist, 0.08);
      }
      lod.position.set(centerX, 0, centerZ);
      // geometry is in world coordinates, so offset children back
      for (const l of lod.levels) {
        l.object.position.set(-centerX, 0, -centerZ);
        l.object.updateMatrix();
      }
      lod.updateMatrix();
      lod.matrixAutoUpdate = false;
      group.add(lod);
    }
  }
  return { group, material };
}
