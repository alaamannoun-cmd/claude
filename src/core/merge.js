import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Bake all static descendant meshes of `group` into one mesh per material.
// Objects in `exclude` (and everything below them) are left untouched.
export function mergeStatic(group, exclude = []) {
  const skip = new Set(exclude);
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const byMat = new Map();
  const victims = [];
  const visit = (obj) => {
    for (const child of [...obj.children]) {
      if (skip.has(child)) continue;
      if (child.isMesh && !child.isInstancedMesh && !child.isSkinnedMesh && !Array.isArray(child.material)) {
        const m = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
        let g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(m);
        if (m.determinant() < 0) flipWinding(g);
        if (!byMat.has(child.material)) byMat.set(child.material, []);
        byMat.get(child.material).push(g);
        victims.push(child);
      }
      visit(child);
    }
  };
  visit(group);
  for (const v of victims) {
    // keep children of a merged mesh (rare) by re-parenting them
    for (const c of [...v.children]) v.parent.add(c);
    v.parent.remove(v);
  }
  const merged = [];
  for (const [mat, list] of byMat) {
    const geo = mergeGeometries(list, false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    merged.push(mesh);
  }
  return merged;
}

function flipWinding(g) {
  for (const key of Object.keys(g.attributes)) {
    const a = g.attributes[key];
    const n = a.itemSize;
    const arr = a.array;
    for (let t = 0; t < a.count; t += 3) {
      for (let c = 0; c < n; c++) {
        const i1 = (t + 1) * n + c,
          i2 = (t + 2) * n + c;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
  }
}
