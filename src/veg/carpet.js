import * as THREE from 'three';
import { makeCarpetTexture } from '../core/textures.js';

// Moss phlox (shibazakura) carpets: terrain-hugging meshes tiled with tiny blossoms,
// coloured per stripe, cut out along the green paths with vertex alpha.
const PALETTE = [0xd6307c, 0xf07aaa, 0xf3e3f1, 0xa983d9].map((h) => new THREE.Color(h));

export function buildCarpets(hf, planner) {
  const tex = makeCarpetTexture();
  tex.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    vertexColors: true,
    alphaTest: 0.5,
    roughness: 0.85,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const group = new THREE.Group();
  group.name = 'carpets';
  const fields = [
    { x0: -330, x1: -140, z0: 530, z1: 690 },
    { x0: -290, x1: -190, z0: 455, z1: 520 },
  ];
  const step = 0.8;
  for (const f of fields) {
    const nx = Math.round((f.x1 - f.x0) / step) + 1;
    const nz = Math.round((f.z1 - f.z0) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const col = new Float32Array(nx * nz * 4);
    const uv = new Float32Array(nx * nz * 2);
    const nor = new Float32Array(nx * nz * 3);
    const n = new THREE.Vector3();
    let any = false;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = f.x0 + i * step,
          z = f.z0 + j * step;
        const k = j * nx + i;
        const sh = planner.shibazakura(x, z);
        pos[k * 3] = x;
        pos[k * 3 + 1] = hf.terrainHeight(x, z) + 0.05;
        pos[k * 3 + 2] = z;
        hf.normalAt(x, z, n);
        nor[k * 3] = n.x;
        nor[k * 3 + 1] = n.y;
        nor[k * 3 + 2] = n.z;
        const c = PALETTE[sh.color];
        const shade = 0.9 + 0.1 * Math.sin(x * 0.7) * Math.cos(z * 0.6);
        col[k * 4] = c.r * shade;
        col[k * 4 + 1] = c.g * shade;
        col[k * 4 + 2] = c.b * shade;
        col[k * 4 + 3] = sh.m > 0.55 ? 1 : sh.m / 0.55 * 0.9;
        if (sh.m > 0.3) any = true;
        uv[k * 2] = x / 1.6;
        uv[k * 2 + 1] = z / 1.6;
      }
    if (!any) continue;
    const idx = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        // skip quads that are fully outside the field
        if (col[a * 4 + 3] < 0.3 && col[(a + 1) * 4 + 3] < 0.3 && col[(a + nx) * 4 + 3] < 0.3 && col[(a + nx + 1) * 4 + 3] < 0.3) continue;
        idx.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
