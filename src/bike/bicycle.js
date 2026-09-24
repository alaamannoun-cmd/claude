import * as THREE from 'three';
import { mergeStatic } from '../core/merge.js';

// Bike-local frame: +Z forward, +Y up, +X to the rider's left. Origin on the ground,
// halfway between the two tyre contact points.
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const BIKE = {
  wheelR: 0.34,
  wheelbase: 1.08,
  rearAxle: V(0, 0.34, -0.54),
  frontAxle: V(0, 0.34, 0.54),
  bb: V(0, 0.28, -0.1),
  crankLen: 0.17,
  pedalX: 0.13,
  seatTop: V(0, 0.95, -0.31),
  steerDir: V(0, Math.sin((70 * Math.PI) / 180), -Math.cos((70 * Math.PI) / 180)),
  gripL: V(0.285, 1.02, 0.1),
  gripR: V(-0.285, 1.02, 0.1),
  chainring: 0.1,
  cog: 0.038,
  gear: 2.6,
};
// steering pivot: a point on the steering axis at head tube height
BIKE.rakeDir = V(0, BIKE.steerDir.z * -1, BIKE.steerDir.y).normalize(); // perpendicular, pointing forward
BIKE.crown = BIKE.frontAxle.clone().addScaledVector(BIKE.rakeDir, -0.045).addScaledVector(BIKE.steerDir, 0.36);
BIKE.headTop = BIKE.crown.clone().addScaledVector(BIKE.steerDir, 0.16);
BIKE.stemTop = BIKE.headTop.clone().addScaledVector(BIKE.steerDir, 0.12);

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function makeMaterials() {
  const wicker = canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#6e4f2c';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16)
      for (let x = 0; x < w; x += 16) {
        const odd = ((x + y) / 16) % 2;
        const g = ctx.createLinearGradient(x, y, odd ? x + 16 : x, odd ? y : y + 16);
        g.addColorStop(0, '#8d6a3c');
        g.addColorStop(0.5, '#c9a066');
        g.addColorStop(1, '#8d6a3c');
        ctx.fillStyle = g;
        if (odd) ctx.fillRect(x + 1, y + 3, 14, 10);
        else ctx.fillRect(x + 3, y + 1, 10, 14);
      }
  });
  wicker.repeat.set(3, 2);
  const chain = canvasTex(64, 16, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      ctx.fillStyle = '#9ea3a8';
      ctx.beginPath();
      ctx.roundRect(x + 1, 3, 14, 10, 5);
      ctx.fill();
      ctx.fillStyle = '#3b3f44';
      ctx.fillRect(x + 6, 6, 4, 4);
    }
  });
  const tread = canvasTex(256, 32, (ctx, w, h) => {
    ctx.fillStyle = '#262626';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    for (let x = 0; x < w; x += 8) {
      ctx.fillRect(x, 4, 4, 10);
      ctx.fillRect(x + 4, 18, 4, 10);
    }
    // gum sidewalls at the edges of the tube (v near 0 and 1)
    ctx.fillStyle = '#b98b55';
    ctx.fillRect(0, 0, w, 3);
    ctx.fillRect(0, h - 3, w, 3);
  });
  tread.repeat.set(10, 1);
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: 0x3f9e8f, metalness: 0.25, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.06 }),
    paintCream: new THREE.MeshPhysicalMaterial({ color: 0xf0e7d3, metalness: 0.1, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.14 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, metalness: 0.85, roughness: 0.32 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tread, roughness: 0.92 }),
    black: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55 }),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x6d3d1f, roughness: 0.5, sheen: 0.4, sheenColor: 0x8a5a3a, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    wicker: new THREE.MeshStandardMaterial({ map: wicker, roughness: 0.85, side: THREE.DoubleSide }),
    chain: new THREE.MeshStandardMaterial({ map: chain, color: 0xffffff, metalness: 0.9, roughness: 0.35, alphaTest: 0.5, side: THREE.DoubleSide }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c8, emissiveIntensity: 0, roughness: 0.1 }),
    redLens: new THREE.MeshStandardMaterial({ color: 0x9a1010, emissive: 0xff2020, emissiveIntensity: 0, roughness: 0.2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc7a045, metalness: 1, roughness: 0.25 }),
    petal: new THREE.MeshStandardMaterial({ color: 0xf6b8cb, roughness: 0.7 }),
    petalWhite: new THREE.MeshStandardMaterial({ color: 0xfbf3e8, roughness: 0.7 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x5d8a3a, roughness: 0.7 }),
    treadTex: tread,
    chainTex: chain,
  };
}

function tube(a, b, r, mat, seg = 12) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function curveTube(points, r, mat, seg = 24) {
  const curve = new THREE.CatmullRomCurve3(points);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 10, false), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function buildWheel(M, withCog) {
  const g = new THREE.Group();
  const R = BIKE.wheelR;
  // tyre (torus in YZ plane)
  const tyre = new THREE.TorusGeometry(R - 0.019, 0.02, 12, 64);
  tyre.rotateY(Math.PI / 2);
  g.add(mesh(tyre, M.rubber));
  // rim
  const rim = new THREE.TorusGeometry(R - 0.041, 0.009, 6, 64);
  rim.rotateY(Math.PI / 2);
  rim.scale(1.8, 1, 1);
  g.add(mesh(rim, M.chrome));
  // spokes: 32, tangentially laced from two hub flanges
  const spokes = [];
  const n = 32;
  const rimR = R - 0.048;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const a = (i / n) * Math.PI * 2;
    const hubA = a + (i % 4 < 2 ? 0.35 : -0.35);
    const hub = V(side * 0.032, Math.sin(hubA) * 0.026, Math.cos(hubA) * 0.026);
    const rimP = V(side * 0.004, Math.sin(a) * rimR, Math.cos(a) * rimR);
    const dir = new THREE.Vector3().subVectors(rimP, hub);
    const len = dir.length();
    const s = new THREE.CylinderGeometry(0.0016, 0.0016, len, 4, 1, true);
    s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()));
    s.translate((hub.x + rimP.x) / 2, (hub.y + rimP.y) / 2, (hub.z + rimP.z) / 2);
    spokes.push(s);
  }
  const merged = mergeList(spokes);
  g.add(mesh(merged, M.chrome));
  // hub and flanges
  const hub = new THREE.CylinderGeometry(0.018, 0.018, 0.1, 16);
  hub.rotateZ(Math.PI / 2);
  g.add(mesh(hub, M.alu));
  for (const s of [-1, 1]) {
    const f = new THREE.CylinderGeometry(0.03, 0.03, 0.006, 20);
    f.rotateZ(Math.PI / 2);
    g.add(mesh(f, M.alu, s * 0.032, 0, 0));
  }
  if (withCog) {
    const cog = new THREE.CylinderGeometry(BIKE.cog, BIKE.cog, 0.006, 20);
    cog.rotateZ(Math.PI / 2);
    g.add(mesh(cog, M.alu, -0.045, 0, 0));
  }
  // valve and a small spoke reflector
  g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6), M.chrome, 0, rimR - 0.005, 0));
  const refl = new THREE.BoxGeometry(0.008, 0.05, 0.02);
  g.add(mesh(refl, M.redLens, 0.01, 0, rimR * 0.6));
  return g;
}

function mergeList(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx = [];
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + off);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

function fender(M, arcStart, arc) {
  const R = BIKE.wheelR + 0.028;
  const g = new THREE.TorusGeometry(R, 0.011, 6, 32, arc);
  g.rotateZ(arcStart);
  g.rotateY(Math.PI / 2);
  g.scale(3.2, 1, 1);
  return mesh(g, M.paintCream);
}

function saddle(M) {
  const grp = new THREE.Group();
  // top outline (seen from above): wide at the back, narrow nose
  const s = new THREE.Shape();
  s.moveTo(0, 0.15);
  s.bezierCurveTo(0.03, 0.15, 0.035, 0.06, 0.05, 0.0);
  s.bezierCurveTo(0.09, -0.05, 0.1, -0.1, 0.085, -0.12);
  s.bezierCurveTo(0.05, -0.135, -0.05, -0.135, -0.085, -0.12);
  s.bezierCurveTo(-0.1, -0.1, -0.09, -0.05, -0.05, 0.0);
  s.bezierCurveTo(-0.035, 0.06, -0.03, 0.15, 0, 0.15);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 4, curveSegments: 16 });
  g.rotateX(Math.PI / 2);
  // dip in the middle, raised tail
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    p.setY(i, p.getY(i) + 0.02 * Math.pow(Math.max(0, -z - 0.02) / 0.1, 2) - 0.008 * Math.cos((z / 0.15) * 1.5));
  }
  g.computeVertexNormals();
  const top = mesh(g, M.leather);
  top.position.y = 0.047;
  grp.add(top);
  // rails and coil springs
  for (const sx of [-1, 1]) {
    grp.add(tube(V(sx * 0.02, 0.0, 0.12), V(sx * 0.05, 0.0, -0.1), 0.004, M.chrome));
    const pts = [];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      const a = t * Math.PI * 2 * 7;
      pts.push(V(sx * 0.055 + Math.cos(a) * 0.014, -0.02 + t * 0.06, -0.1 + Math.sin(a) * 0.014));
    }
    grp.add(curveTube(pts, 0.0028, M.chrome, 120));
  }
  grp.add(tube(V(0, -0.04, 0.02), V(0, 0.005, 0.02), 0.012, M.chrome));
  return grp;
}

function basket(M) {
  const grp = new THREE.Group();
  const w = 0.36,
    h = 0.24,
    d = 0.28,
    t = 0.012;
  const panel = (pw, ph, x, y, z, rx, ry) => {
    const m = mesh(new THREE.BoxGeometry(pw, ph, t), M.wicker, x, y, z);
    m.rotation.set(rx, ry, 0);
    grp.add(m);
  };
  panel(w, h, 0, h / 2, d / 2, 0, 0);
  panel(w, h, 0, h / 2, -d / 2, 0, 0);
  panel(d, h, w / 2, h / 2, 0, 0, Math.PI / 2);
  panel(d, h, -w / 2, h / 2, 0, 0, Math.PI / 2);
  panel(w, d, 0, 0.006, 0, Math.PI / 2, 0);
  // rim
  const rimPts = [V(-w / 2, h, -d / 2), V(w / 2, h, -d / 2), V(w / 2, h, d / 2), V(-w / 2, h, d / 2)];
  const rimCurve = new THREE.CatmullRomCurve3(rimPts, true, 'catmullrom', 0.05);
  grp.add(mesh(new THREE.TubeGeometry(rimCurve, 48, 0.012, 8, true), M.wicker));
  // bouquet of spring flowers
  const bouquet = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = 0.03 + (i % 3) * 0.02;
    const top = V(Math.cos(a) * r * 1.6, h + 0.08 + (i % 4) * 0.03, Math.sin(a) * r - 0.02);
    bouquet.add(tube(V(Math.cos(a) * 0.02, 0.05, Math.sin(a) * 0.02), top, 0.004, M.leaf, 5));
    const bloomMat = i % 3 === 0 ? M.petalWhite : M.petal;
    for (let p = 0; p < 5; p++) {
      const pa = (p / 5) * Math.PI * 2;
      const pm = mesh(new THREE.SphereGeometry(0.018, 8, 6), bloomMat, top.x + Math.cos(pa) * 0.018, top.y, top.z + Math.sin(pa) * 0.018);
      pm.scale.set(1, 0.45, 1);
      bouquet.add(pm);
    }
    bouquet.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), M.brass, top.x, top.y + 0.006, top.z));
  }
  // a couple of leaves
  for (let i = 0; i < 4; i++) {
    const l = mesh(new THREE.SphereGeometry(0.03, 8, 6), M.leaf, Math.cos(i * 1.6) * 0.07, h + 0.02, Math.sin(i * 1.6) * 0.05);
    l.scale.set(0.35, 0.12, 1);
    l.rotation.y = i * 1.6;
    bouquet.add(l);
  }
  grp.add(bouquet);
  return grp;
}

export class Bicycle {
  constructor() {
    const M = (this.M = makeMaterials());
    this.root = new THREE.Group();
    this.root.name = 'bicycle';
    this.lean = new THREE.Group();
    this.root.add(this.lean);
    const L = this.lean;
    const B = BIKE;

    // ---- frame (classic roadster with a sloping top tube) ----
    const seatDir = V(0, Math.sin((73 * Math.PI) / 180), -Math.cos((73 * Math.PI) / 180));
    const seatTubeTop = B.bb.clone().addScaledVector(seatDir, 0.53);
    this.seatDir = seatDir;
    const headBottom = B.crown.clone().addScaledVector(B.steerDir, 0.015);
    const headTop = B.headTop.clone();
    L.add(tube(B.bb, headBottom.clone().addScaledVector(B.steerDir, 0.02), 0.019, M.paint)); // down tube
    L.add(tube(seatTubeTop.clone().addScaledVector(seatDir, -0.03), headTop.clone().addScaledVector(B.steerDir, -0.02), 0.016, M.paint)); // top tube
    L.add(tube(B.bb.clone().addScaledVector(seatDir, -0.02), seatTubeTop, 0.017, M.paint)); // seat tube
    // head tube
    L.add(tube(headBottom, headTop, 0.022, M.paint));
    // chain stays and seat stays
    for (const s of [-1, 1]) {
      const drop = B.rearAxle.clone().setX(s * 0.066);
      L.add(tube(B.bb.clone().setX(s * 0.03), drop, 0.009, M.paint));
      L.add(tube(seatTubeTop.clone().setX(s * 0.018).addScaledVector(seatDir, -0.04), drop, 0.008, M.paint));
    }
    // bottom bracket shell
    const bbShell = new THREE.CylinderGeometry(0.024, 0.024, 0.075, 16);
    bbShell.rotateZ(Math.PI / 2);
    L.add(mesh(bbShell, M.paint, B.bb.x, B.bb.y, B.bb.z));
    // seat post and saddle
    const saddleBase = B.seatTop.clone().addScaledVector(seatDir, -0.06);
    L.add(tube(seatTubeTop.clone().addScaledVector(seatDir, -0.04), saddleBase, 0.0135, M.chrome));
    const sad = saddle(M);
    sad.position.copy(saddleBase).add(V(0, 0.005, 0.01));
    L.add(sad);
    // rear rack
    const rackY = B.wheelR * 2 + 0.07;
    for (const s of [-1, 1]) {
      L.add(tube(V(s * 0.075, rackY, -0.28), V(s * 0.075, rackY, -0.8), 0.006, M.chrome));
      L.add(tube(V(s * 0.075, rackY, -0.72), B.rearAxle.clone().setX(s * 0.07), 0.005, M.chrome));
      L.add(tube(V(s * 0.075, rackY, -0.3), seatTubeTop.clone().setX(s * 0.02).addScaledVector(seatDir, -0.05), 0.005, M.chrome));
    }
    for (let k = 0; k < 4; k++) L.add(tube(V(-0.075, rackY, -0.36 - k * 0.14), V(0.075, rackY, -0.36 - k * 0.14), 0.005, M.chrome));
    // rear fender with a red reflector
    const rf = fender(M, Math.PI * 0.05, Math.PI * 0.85);
    rf.position.copy(B.rearAxle);
    L.add(rf);
    const tail = mesh(new THREE.BoxGeometry(0.05, 0.03, 0.015), M.redLens, 0, rackY - 0.04, -0.83);
    L.add(tail);
    this.tailLight = tail;
    // kickstand (folded along the left chain stay)
    L.add(tube(V(0.05, 0.25, -0.18), V(0.07, 0.3, -0.45), 0.008, M.alu));
    // chain guard free drivetrain: chain as a textured ribbon
    this.buildChain();

    // ---- rear wheel ----
    this.rearWheel = buildWheel(M, true);
    this.rearWheel.position.copy(B.rearAxle);
    L.add(this.rearWheel);

    // ---- crankset ----
    this.crank = new THREE.Group();
    this.crank.position.copy(B.bb);
    L.add(this.crank);
    const ring = new THREE.Group();
    const teeth = 42;
    const shape = new THREE.Shape();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? B.chainring + 0.004 : B.chainring - 0.002;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, B.chainring - 0.018, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: 0.004, bevelEnabled: false, curveSegments: 4 });
    rg.rotateY(Math.PI / 2);
    ring.add(mesh(rg, M.chrome, -0.055, 0, 0));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      ring.add(tube(V(-0.053, 0, 0), V(-0.053, Math.sin(a) * (B.chainring - 0.018), Math.cos(a) * (B.chainring - 0.018)), 0.006, M.alu, 6));
    }
    this.crank.add(ring);
    const axle = new THREE.CylinderGeometry(0.01, 0.01, B.pedalX * 2 - 0.02, 8);
    axle.rotateZ(Math.PI / 2);
    this.crank.add(mesh(axle, M.alu));
    this.pedals = [];
    for (const side of [1, -1]) {
      // side +1 = left crank; angle offset pi from right
      const armGrp = new THREE.Group();
      armGrp.rotation.x = side === 1 ? Math.PI : 0;
      const arm = mesh(new THREE.BoxGeometry(0.014, B.crankLen + 0.02, 0.026), M.alu, side * 0.075, B.crankLen / 2, 0);
      armGrp.add(arm);
      const pedalPivot = new THREE.Group();
      pedalPivot.position.set(side * B.pedalX, B.crankLen, 0);
      armGrp.add(pedalPivot);
      const pedal = new THREE.Group();
      pedal.add(mesh(new THREE.BoxGeometry(0.095, 0.022, 0.07), M.black, side * 0.05, 0, 0));
      pedal.add(mesh(new THREE.BoxGeometry(0.1, 0.006, 0.075), M.alu, side * 0.05, 0.012, 0));
      pedal.add(mesh(new THREE.BoxGeometry(0.02, 0.012, 0.015), M.redLens, side * 0.1, 0, 0));
      pedalPivot.add(pedal);
      this.crank.add(armGrp);
      this.pedals.push({ side, armGrp, pedalPivot });
    }

    // ---- steering assembly ----
    this.steerOuter = new THREE.Group();
    this.steerOuter.position.copy(B.crown);
    L.add(this.steerOuter);
    this.steerRot = new THREE.Group();
    this.steerOuter.add(this.steerRot);
    const S = new THREE.Group();
    S.position.copy(B.crown).negate();
    this.steerRot.add(S);
    this.steerParts = S;
    // fork blades with a gentle rake curve
    for (const s of [-1, 1]) {
      const top = B.crown.clone().setX(s * 0.045);
      const bottom = B.frontAxle.clone().setX(s * 0.05);
      const mid = top.clone().lerp(bottom, 0.55).addScaledVector(B.rakeDir, 0.02);
      S.add(curveTube([top, mid, bottom], 0.011, M.paint, 12));
    }
    S.add(tube(B.crown.clone().setX(-0.05), B.crown.clone().setX(0.05), 0.016, M.paint));
    S.add(tube(B.headTop, B.stemTop, 0.012, M.chrome));
    // swept-back city handlebar
    const clamp = B.stemTop.clone().add(V(0, 0.01, 0.04));
    S.add(tube(B.stemTop, clamp, 0.013, M.chrome));
    const barPts = (s) => [
      clamp.clone().setX(0),
      clamp.clone().setX(s * 0.1).add(V(0, 0.005, 0.0)),
      V(s * 0.22, B.gripL.y + 0.005, 0.2),
      V(s * 0.285, B.gripL.y, 0.12),
      V(s * 0.29, B.gripL.y - 0.005, 0.04),
    ];
    S.add(curveTube(barPts(1), 0.011, M.chrome, 24));
    S.add(curveTube(barPts(-1), 0.011, M.chrome, 24));
    // leather grips
    for (const s of [-1, 1]) {
      S.add(tube(V(s * 0.287, B.gripL.y - 0.001, 0.15), V(s * 0.29, B.gripL.y - 0.004, 0.035), 0.017, M.leather));
      // brake lever
      S.add(tube(V(s * 0.25, B.gripL.y + 0.01, 0.17), V(s * 0.29, B.gripL.y - 0.03, 0.2), 0.005, M.alu));
    }
    // bell on the right side of the bar
    const bell = new THREE.Group();
    const dome = new THREE.SphereGeometry(0.026, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    bell.add(mesh(dome, M.brass));
    bell.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 6), M.chrome, 0, -0.01, 0));
    this.bellLever = mesh(new THREE.BoxGeometry(0.004, 0.004, 0.025), M.chrome, 0.015, 0.005, -0.012);
    bell.add(this.bellLever);
    bell.position.set(-0.205, B.gripL.y + 0.035, 0.2);
    S.add(bell);
    this.bell = bell;
    // headlight
    const lamp = new THREE.Group();
    const bodyG = new THREE.CylinderGeometry(0.032, 0.026, 0.06, 20);
    bodyG.rotateX(Math.PI / 2);
    lamp.add(mesh(bodyG, M.chrome));
    const lensG = new THREE.CircleGeometry(0.029, 20);
    const lens = mesh(lensG, M.lens, 0, 0, 0.031);
    lamp.add(lens);
    lamp.position.copy(B.crown).add(V(0, 0.07, 0.1));
    S.add(lamp);
    S.add(tube(B.crown.clone().add(V(0, 0.02, 0.02)), lamp.position, 0.005, M.chrome));
    this.lamp = lamp;
    // front rack + basket
    const bask = basket(M);
    bask.position.copy(B.crown).add(V(0, 0.1, 0.2));
    bask.rotation.x = -0.05;
    S.add(bask);
    for (const s of [-1, 1]) {
      S.add(tube(B.frontAxle.clone().setX(s * 0.06), bask.position.clone().add(V(s * 0.15, 0, -0.05)), 0.005, M.chrome));
      S.add(tube(B.stemTop.clone().add(V(0, -0.03, 0.03)), bask.position.clone().add(V(s * 0.1, 0.22, -0.13)), 0.004, M.chrome));
    }
    // front fender
    const ff = fender(M, Math.PI * 0.1, Math.PI * 0.62);
    ff.position.copy(B.frontAxle);
    S.add(ff);
    // front wheel
    this.frontWheel = buildWheel(M, false);
    this.frontWheel.position.copy(B.frontAxle);
    S.add(this.frontWheel);

    // spot light for night riding
    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 38, 0.5, 0.45, 1.4);
    this.headlight.position.set(0, 0, 0.04);
    this.headlight.castShadow = false;
    lamp.add(this.headlight);
    this.headlightTarget = new THREE.Object3D();
    this.headlightTarget.position.set(0, -0.7, 5);
    lamp.add(this.headlightTarget);
    this.headlight.target = this.headlightTarget;

    // bake static parts into a handful of meshes (far fewer draw calls)
    mergeStatic(this.rearWheel);
    mergeStatic(this.frontWheel);
    for (const p of this.pedals) mergeStatic(p.pedalPivot);
    mergeStatic(this.crank, this.pedals.map((p) => p.pedalPivot));
    mergeStatic(this.lamp);
    mergeStatic(this.steerParts, [this.frontWheel, this.lamp, this.bell]);
    mergeStatic(this.lean, [this.rearWheel, this.crank, this.steerOuter]);
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  buildChain() {
    const B = BIKE;
    const M = this.M;
    const x = -0.055;
    // chain path: around the front of the chainring, straight bottom run,
    // around the back of the cog, straight top run
    const ringC = B.bb,
      cogC = B.rearAxle;
    const pts = [];
    const P = (c, r, a) => V(x, c.y + Math.sin(a) * r, c.z + Math.cos(a) * r);
    const arc = (c, r, a0, a1, n) => {
      for (let i = 0; i <= n; i++) pts.push(P(c, r, a0 + ((a1 - a0) * i) / n));
    };
    const line = (a, b, n) => {
      for (let i = 1; i < n; i++) pts.push(a.clone().lerp(b, i / n));
    };
    arc(ringC, B.chainring, Math.PI / 2, -Math.PI / 2, 16);
    line(P(ringC, B.chainring, -Math.PI / 2), P(cogC, B.cog, -Math.PI / 2), 10);
    arc(cogC, B.cog, -Math.PI / 2, -Math.PI * 1.5, 8);
    line(P(cogC, B.cog, Math.PI / 2), P(ringC, B.chainring, Math.PI / 2), 10);
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.1);
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, 160, 0.004, 4, true);
    geo.scale(1.8, 1, 1);
    const tex = M.chainTex;
    tex.repeat.set(Math.round(len / 0.0254), 1);
    this.chainLength = len;
    const chain = mesh(geo, M.chain);
    this.lean.add(chain);
  }

  // Steering angle about the head axis, wheel spin and crank angle (radians)
  pose({ steer = 0, rearSpin = 0, frontSpin = 0, crank = 0, pedalPitch = [0, 0], lean = 0, night = 0, bell = 0 }) {
    this.lean.rotation.z = lean;
    this.steerRot.quaternion.setFromAxisAngle(BIKE.steerDir, steer);
    this.rearWheel.rotation.x = rearSpin;
    this.frontWheel.rotation.x = frontSpin;
    this.crank.rotation.x = crank;
    // keep pedals level relative to the frame, plus rider's ankle pitch
    this.pedals.forEach((p, i) => {
      p.pedalPivot.rotation.x = -crank - p.armGrp.rotation.x + pedalPitch[i];
    });
    this.M.chainTex.offset.x = -((crank * BIKE.chainring) / 0.0254) % 1;
    this.M.lens.emissiveIntensity = night * 6;
    this.M.redLens.emissiveIntensity = night * 3;
    this.headlight.intensity = night * 55;
    this.bellLever.rotation.y = bell * 0.8;
  }

  // Positions in bike-local (lean frame) coordinates, accounting for steering
  gripPosition(side, out = new THREE.Vector3()) {
    const g = side > 0 ? BIKE.gripL : BIKE.gripR;
    out.copy(g).sub(BIKE.crown).applyQuaternion(this.steerRot.quaternion).add(BIKE.crown);
    return out;
  }

  pedalPosition(side, crank, out = new THREE.Vector3()) {
    // right pedal angle = crank; left = crank + pi. Rotation about +X: (y,z) -> (cos, sin)
    const a = side > 0 ? crank + Math.PI : crank;
    out.set(side * (BIKE.pedalX + 0.05), BIKE.bb.y + Math.cos(a) * BIKE.crankLen, BIKE.bb.z + Math.sin(a) * BIKE.crankLen);
    return out;
  }
}
