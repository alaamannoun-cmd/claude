import * as THREE from 'three';
import { materials, GeoBuilder, setNight } from './kit.js';
import {
  toriiGeometry,
  lanternGeometry,
  buildBridge,
  buildPagoda,
  buildHouse,
  buildShrine,
  signMesh,
  benchGeometry,
  rockGeometry,
} from './buildings.js';
import { HOUSES, PAGODA, SHRINE, WATER_LEVEL, ROAD_HALF_WIDTH as HW } from '../world/layout.js';
import { Rng } from '../core/noise.js';

function instanced(geoMats, list, { cast = true, receive = true } = {}) {
  const { geo, mats } = geoMats;
  const mesh = new THREE.InstancedMesh(geo, mats, list.length);
  const m = new THREE.Matrix4();
  list.forEach((t, i) => {
    m.compose(
      new THREE.Vector3(t.x, t.y, t.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot || 0),
      new THREE.Vector3(t.s || 1, t.s || 1, t.s || 1)
    );
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildStructures(hf, planner, scene) {
  const M = materials();
  const group = new THREE.Group();
  group.name = 'structures';
  const colliders = planner.colliders;

  // torii tunnel
  const torii = toriiGeometry();
  if (planner.toriiTunnel.length) group.add(instanced(torii, planner.toriiTunnel));
  // big torii standing in the lake
  if (planner.bigTorii) {
    const t = planner.bigTorii;
    const big = new THREE.Mesh(torii.geo, torii.mats);
    big.scale.setScalar(1.9);
    big.position.set(t.x, t.y, t.z);
    // face the shore road (south)
    big.rotation.y = 0.35;
    big.castShadow = true;
    group.add(big);
  }

  // lanterns
  const lantern = lanternGeometry();
  const lanternList = [...planner.lanterns];
  // bridge (no stone lanterns inside the water)
  group.add(instanced(lantern, lanternList));

  // bridges
  for (const b of hf.bridges) group.add(buildBridge(hf, b));

  // pagoda on its hill, facing the lake / road
  const pagoda = buildPagoda();
  pagoda.position.set(PAGODA.x, hf.pagodaH - 0.4, PAGODA.z);
  pagoda.rotation.y = Math.atan2(40, 60);
  group.add(pagoda);
  colliders.push({ x: PAGODA.x, z: PAGODA.z, r: 6.2 });

  // shrine faces the nearest road point
  const shrine = buildShrine();
  const sk = hf.nearestCell(SHRINE.x, SHRINE.z);
  const sNear = hf.road.pointAt(hf.road.refine(SHRINE.x, SHRINE.z, hf.roadI[sk], 40).index);
  const sRot = Math.atan2(sNear.x - SHRINE.x, sNear.z - SHRINE.z);
  shrine.position.set(SHRINE.x, hf.shrineH - 0.3, SHRINE.z);
  shrine.rotation.y = sRot;
  group.add(shrine);
  colliders.push({ x: SHRINE.x, z: SHRINE.z, r: 6.5 });
  // shrine gate and lanterns
  const fwdX = Math.sin(sRot),
    fwdZ = Math.cos(sRot);
  const gate = new THREE.Mesh(torii.geo, torii.mats);
  gate.scale.setScalar(0.72);
  gate.position.set(SHRINE.x + fwdX * 11, hf.terrainHeight(SHRINE.x + fwdX * 11, SHRINE.z + fwdZ * 11) - 0.05, SHRINE.z + fwdZ * 11);
  gate.rotation.y = sRot;
  gate.castShadow = true;
  group.add(gate);
  const rx = Math.cos(sRot),
    rz = -Math.sin(sRot);
  const shrineLanterns = [];
  for (const side of [-1, 1]) {
    const x = SHRINE.x + fwdX * 7.5 + rx * side * 2.6;
    const z = SHRINE.z + fwdZ * 7.5 + rz * side * 2.6;
    shrineLanterns.push({ x, z, y: hf.terrainHeight(x, z), rot: sRot });
    colliders.push({ x, z, r: 0.45 });
  }
  group.add(instanced(lantern, shrineLanterns));

  // village
  for (const h of HOUSES) {
    const mesh = buildHouse(h);
    mesh.position.set(h.x, h.h - 0.1, h.z);
    mesh.rotation.y = h.rot;
    group.add(mesh);
    // footprint colliders (a few circles along the long axis)
    const ax = Math.cos(h.rot),
      az = -Math.sin(h.rot);
    const r = Math.min(h.w, h.d) / 2 + 0.4;
    const n = Math.max(1, Math.round(h.w / (r * 1.4)));
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0 : (k / (n - 1) - 0.5) * (h.w - r * 2);
      colliders.push({ x: h.x + ax * t, z: h.z + az * t, r });
    }
  }

  // signs & benches
  for (const s of planner.signs) {
    const sign = signMesh(s.text, s.sub);
    sign.position.set(s.x, s.y - 0.05, s.z);
    sign.rotation.y = s.rot;
    group.add(sign);
  }
  if (planner.benches.length) group.add(instanced(benchGeometry(), planner.benches));

  // rocks
  const rockGeos = [0, 1, 2].map((k) => rockGeometry(k + 1));
  const rockMat = M.stone;
  const buckets = [[], [], []];
  planner.rocks.forEach((r, i) => buckets[i % 3].push({ x: r.x, y: r.y - r.s * 0.25, z: r.z, rot: r.r, s: r.s }));
  buckets.forEach((list, k) => {
    if (list.length) {
      const g = rockGeos[k];
      group.add(instanced({ geo: g, mats: rockMat }, list));
    }
  });

  // rice paddies: water, levees and young rice
  group.add(buildPaddies(hf));

  // brushwood fence along the bamboo path
  group.add(buildFence(hf, planner));

  // pool of warm point lights that follow the nearest lanterns at night
  const allLanterns = [...lanternList, ...shrineLanterns];
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const l = new THREE.PointLight(0xffa24a, 0, 14, 2);
    l.castShadow = false;
    scene.add(l);
    lights.push(l);
  }
  const tmp = [];
  return {
    group,
    lanterns: allLanterns,
    update(focus, night) {
      setNight(night);
      if (night < 0.05) {
        for (const l of lights) l.intensity = 0;
        return;
      }
      tmp.length = 0;
      for (const L of allLanterns) {
        const d = (L.x - focus.x) ** 2 + (L.z - focus.z) ** 2;
        if (d < 90 * 90) tmp.push([d, L]);
      }
      tmp.sort((a, b) => a[0] - b[0]);
      lights.forEach((l, i) => {
        const e = tmp[i];
        if (!e) {
          l.intensity = 0;
          return;
        }
        const L = e[1];
        l.position.set(L.x, L.y + 1.55, L.z);
        l.intensity = night * 6;
      });
    },
  };
}

function buildPaddies(hf) {
  const M = materials();
  const group = new THREE.Group();
  const gb = new GeoBuilder();
  const rng = new Rng(9);
  const riceBlades = [];
  for (const p of hf.paddyPlots) {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), M.paddyWater);
    water.rotation.x = -Math.PI / 2;
    water.position.set(p.x, p.level + 0.02, p.z);
    water.receiveShadow = true;
    group.add(water);
    // levees on all four sides
    const lev = 0.55;
    gb.box(p.w + lev, 0.34, lev, M.mud, p.x, p.level + 0.08, p.z - p.d / 2);
    gb.box(p.w + lev, 0.34, lev, M.mud, p.x, p.level + 0.08, p.z + p.d / 2);
    gb.box(lev, 0.34, p.d + lev, M.mud, p.x - p.w / 2, p.level + 0.08, p.z);
    gb.box(lev, 0.34, p.d + lev, M.mud, p.x + p.w / 2, p.level + 0.08, p.z);
    // young rice in neat rows
    for (let x = -p.w / 2 + 0.6; x < p.w / 2 - 0.4; x += 0.55)
      for (let z = -p.d / 2 + 0.6; z < p.d / 2 - 0.4; z += 0.45) {
        riceBlades.push({ x: p.x + x + rng.float(-0.04, 0.04), y: p.level - 0.02, z: p.z + z + rng.float(-0.04, 0.04), rot: rng.float(0, 6.28), s: rng.float(0.8, 1.2) });
      }
  }
  const lev = gb.mesh();
  lev.castShadow = false;
  group.add(lev);
  // rice tuft: three thin crossed blades
  const tuft = new GeoBuilder();
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(0.05, 0.32);
    g.translate(0, 0.16, 0);
    g.rotateZ((k - 1) * 0.28);
    g.rotateY((k * Math.PI) / 3);
    tuft.add(g, M.rice);
  }
  const t = tuft.build();
  const mesh = instanced({ geo: t.geo, mats: M.rice }, riceBlades, { cast: false });
  mesh.layers.set(1);
  group.add(mesh);
  group.name = 'paddies';
  return group;
}

function buildFence(hf, planner) {
  const M = materials();
  const road = hf.road;
  const gb = new GeoBuilder();
  const { bambooStart, bambooEnd } = planner.sec;
  for (const side of [-1, 1]) {
    let prev = null;
    for (let s = bambooStart + 8; s <= bambooEnd - 8; s += 2.5) {
      const p = road.pointAt(s);
      const t = road.tangentAt(s);
      const off = side * (HW + 1.05);
      const x = p.x - t.z * off,
        z = p.z + t.x * off;
      const y = hf.terrainHeight(x, z);
      const cur = new THREE.Vector3(x, y, z);
      if (prev) {
        const mid = prev.clone().add(cur).multiplyScalar(0.5);
        const a = prev.clone(),
          b = cur.clone();
        a.y = b.y = mid.y + 0.55;
        gb.plank(a, b, 0.16, 1.1, M.brush);
        const a2 = prev.clone(),
          b2 = cur.clone();
        a2.y = b2.y = mid.y + 0.95;
        gb.plank(a2, b2, 0.2, 0.08, M.woodDark);
      }
      gb.box(0.1, 1.25, 0.1, M.woodDark, x, y + 0.6, z);
      planner.colliders.push({ x, z, r: 0.45 });
      prev = cur;
    }
  }
  const mesh = gb.mesh();
  mesh.name = 'fence';
  return mesh;
}
