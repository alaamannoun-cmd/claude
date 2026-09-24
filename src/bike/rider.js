import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { BIKE } from './bicycle.js';
import { damp, clamp, lerp, smoothstep } from '../core/noise.js';
import { mergeStatic } from '../core/merge.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

// Segment lengths (m) for a ~1.68 m rider
const L = {
  thigh: 0.44,
  shin: 0.44,
  upperArm: 0.28,
  forearm: 0.25,
  hipHalf: 0.088,
  shoulderHalf: 0.172,
};

// ---------------- geometry helpers ----------------

// A limb along local -Y from 0 to -len, radii through profile [t, r] pairs, elliptical section
function limbGeometry(len, profile, sx = 1, sz = 1, seg = 16) {
  const pts = [];
  const r0 = profile[0][1];
  const r1 = profile[profile.length - 1][1];
  // bottom cap
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.sin(a) * r1, -len - Math.cos(a) * r1 * 0.8));
  }
  for (let i = profile.length - 2; i >= 1; i--) pts.push(new THREE.Vector2(profile[i][1], -profile[i][0] * len));
  // top cap
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, Math.sin(a) * r0 * 0.8));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

// Loft of super-ellipse sections along an axis; sections: [pos, halfW, halfH, offsetY]
function loft(sections, axis = 'z', seg = 20, power = 2.4) {
  const pos = [];
  const idx = [];
  const ring = seg + 1;
  sections.forEach(([p, hw, hh, oy]) => {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / power) * hw;
      const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / power) * hh + oy;
      if (axis === 'z') pos.push(x, y, p);
      else pos.push(x, p, y);
    }
  });
  for (let j = 0; j < sections.length - 1; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * ring + i;
      idx.push(a, a + ring, a + 1, a + 1, a + ring, a + ring + 1);
    }
  // caps
  const addCap = (j, flip) => {
    const c = pos.length / 3;
    const [p, , , oy] = sections[j];
    if (axis === 'z') pos.push(0, oy, p);
    else pos.push(0, p, oy);
    for (let i = 0; i < seg; i++) {
      const a = j * ring + i;
      if (flip) idx.push(c, a + 1, a);
      else idx.push(c, a, a + 1);
    }
  };
  addCap(0, false);
  addCap(sections.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function fabricTexture(base, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.04})`;
    ctx.fillRect(0, y, 128, 1);
  }
  for (let x = 0; x < 128; x += 2) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.04})`;
    ctx.fillRect(x, 0, 1, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function hairTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2a1c16';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 256;
    const b = Math.random();
    ctx.strokeStyle = b > 0.6 ? 'rgba(120,86,62,0.35)' : 'rgba(10,6,4,0.35)';
    ctx.lineWidth = 0.6 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (Math.random() - 0.5) * 12, 90, x + (Math.random() - 0.5) * 12, 170, x + (Math.random() - 0.5) * 8, 256);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Orient an object so its local -Y runs from `from` to `to`, local +Z towards `pole`
function orient(obj, from, to, pole) {
  _y.subVectors(from, to).normalize();
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
  obj.position.copy(from);
}

// Two-bone IK: returns joint position (knee / elbow), clamps the end to the reachable range
function solveIK(root, target, a, b, pole, outMid, outEnd) {
  const d = new THREE.Vector3().subVectors(target, root);
  let len = d.length();
  const maxL = a + b - 1e-4;
  const minL = Math.abs(a - b) + 0.02;
  len = clamp(len, minL, maxL);
  d.normalize();
  const cosA = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = pole.clone().addScaledVector(d, -pole.dot(d));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
  bend.normalize();
  outMid.copy(root).addScaledVector(d, a * cosA).addScaledVector(bend, a * sinA);
  outEnd.copy(root).addScaledVector(d, len);
}

// Verlet rope in world space
class Rope {
  constructor(n, segLen) {
    this.n = n;
    this.segLen = segLen;
    this.p = Array.from({ length: n }, () => new THREE.Vector3());
    this.prev = Array.from({ length: n }, () => new THREE.Vector3());
    this.init = false;
  }
  reset(anchor, dir) {
    for (let i = 0; i < this.n; i++) {
      this.p[i].copy(anchor).addScaledVector(dir, i * this.segLen);
      this.prev[i].copy(this.p[i]);
    }
    this.init = true;
  }
  step(dt, anchor, anchorDir, airVel, drag, gravity, stiffness, collide) {
    if (!this.init || this.p[0].distanceToSquared(anchor) > 1.5 * 1.5) this.reset(anchor, anchorDir);
    const dt2 = dt * dt;
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i],
        q = this.prev[i];
      const vx = p.x - q.x,
        vy = p.y - q.y,
        vz = p.z - q.z;
      q.copy(p);
      // air drag towards the relative air velocity
      const ax = (airVel.x - vx / dt) * drag;
      const ay = (airVel.y - vy / dt) * drag - gravity;
      const az = (airVel.z - vz / dt) * drag;
      p.x += vx * 0.985 + ax * dt2;
      p.y += vy * 0.985 + ay * dt2;
      p.z += vz * 0.985 + az * dt2;
      // bias towards the rest direction (stiffness near the root)
      const k = stiffness * (1 - i / this.n);
      if (k > 0) {
        const rest = _x.copy(this.p[i - 1]).addScaledVector(anchorDir, this.segLen);
        p.lerp(rest, k);
      }
    }
    this.p[0].copy(anchor);
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < this.n; i++) {
        const a = this.p[i - 1],
          b = this.p[i];
        const d = _y.subVectors(b, a);
        const l = d.length() || 1e-6;
        const diff = (l - this.segLen) / l;
        if (i === 1) b.addScaledVector(d, -diff);
        else {
          a.addScaledVector(d, diff * 0.5);
          b.addScaledVector(d, -diff * 0.5);
        }
      }
      if (collide) for (let i = 1; i < this.n; i++) collide(this.p[i]);
      this.p[0].copy(anchor);
    }
  }
}

export class Rider {
  constructor(bike) {
    this.bike = bike;
    const g = (this.group = new THREE.Group());
    g.name = 'rider';
    bike.lean.add(g);
    this.buildMaterials();
    this.buildBody();
    // bake rigid body parts into few meshes per material
    const P = this.parts;
    mergeStatic(P.pelvis);
    mergeStatic(P.chest);
    for (const e of this.eyes) mergeStatic(e);
    mergeStatic(P.head, this.eyes);
    for (const a of P.arms) {
      mergeStatic(a.fore);
      mergeStatic(a.hand);
    }
    for (const l of P.legs) {
      mergeStatic(l.shin);
      mergeStatic(l.foot);
    }
    this.state = {
      t: 0,
      blinkT: 2,
      blink: 0,
      lookYaw: 0,
      lookPitch: 0,
      lookTargetYaw: 0,
      lookTargetPitch: 0,
      lookTimer: 3,
      breath: 0,
      wave: 0,
      waveT: 0,
    };
    this.ponytail = new Rope(8, 0.045);
    this.scarfL = new Rope(9, 0.05);
    this.scarfR = new Rope(7, 0.05);
    this.tmp = {
      hip: V(0, 0, 0),
      hipL: V(0, 0, 0),
      hipR: V(0, 0, 0),
      knee: V(0, 0, 0),
      ankle: V(0, 0, 0),
      elbow: V(0, 0, 0),
      wrist: V(0, 0, 0),
    };
  }

  buildMaterials() {
    const P = (o) => new THREE.MeshPhysicalMaterial(o);
    this.mat = {
      skin: P({ color: 0xe2b08c, roughness: 0.58, sheen: 0.2, sheenColor: 0xff9f8f, sheenRoughness: 0.6 }),
      shirt: P({ color: 0xffffff, map: fabricTexture('#2e426f', 3), roughness: 0.88, sheen: 0.7, sheenColor: 0x7b90c4, sheenRoughness: 0.6 }),
      shirtLight: P({ color: 0xffffff, map: fabricTexture('#f3efe6', 5), roughness: 0.9, sheen: 0.5, sheenColor: 0xffffff, sheenRoughness: 0.7 }),
      pants: P({ color: 0xffffff, map: fabricTexture('#a8946c', 7), roughness: 0.92, sheen: 0.3, sheenColor: 0xd8c8a0, sheenRoughness: 0.7 }),
      shoe: P({ color: 0xf4f1ea, roughness: 0.75, sheen: 0.3, sheenColor: 0xffffff }),
      sole: new THREE.MeshStandardMaterial({ color: 0xa8743e, roughness: 0.85 }),
      shoeAccent: new THREE.MeshStandardMaterial({ color: 0x23386b, roughness: 0.7 }),
      hair: P({ color: 0xffffff, map: hairTexture(), roughness: 0.4, sheen: 1.0, sheenColor: 0x8a6448, sheenRoughness: 0.35 }),
      scarf: P({ color: 0xa8242f, roughness: 0.85, sheen: 0.6, sheenColor: 0xff7a7a, sheenRoughness: 0.5, side: THREE.DoubleSide }),
      bag: P({ color: 0xffffff, map: fabricTexture('#b39460', 9), roughness: 0.9, sheen: 0.3, sheenColor: 0xe8d0a0 }),
      strap: new THREE.MeshStandardMaterial({ color: 0x5e3a22, roughness: 0.55 }),
      sclera: new THREE.MeshStandardMaterial({ color: 0xf7f3ec, roughness: 0.3 }),
      iris: new THREE.MeshStandardMaterial({ color: 0x3a2517, roughness: 0.25 }),
      shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
      brow: new THREE.MeshStandardMaterial({ color: 0x2a1b14, roughness: 0.8 }),
      lip: new THREE.MeshStandardMaterial({ color: 0xc9776e, roughness: 0.5 }),
      tie: new THREE.MeshStandardMaterial({ color: 0xc9363d, roughness: 0.7 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xc9a553, metalness: 1, roughness: 0.3 }),
    };
    this.mat.shirt.map.repeat.set(4, 4);
  }

  buildBody() {
    const M = this.mat;
    const G = this.group;
    const parts = (this.parts = {});

    // ---- pelvis / hips (trousers) ----
    const hipProfile = [];
    const hp = [
      [-0.155, 0.02],
      [-0.15, 0.085],
      [-0.12, 0.13],
      [-0.07, 0.158],
      [-0.01, 0.165],
      [0.05, 0.152],
      [0.09, 0.14],
      [0.12, 0.134],
    ];
    for (const [y, r] of hp) hipProfile.push(new THREE.Vector2(r, y));
    const hipsG = new THREE.LatheGeometry(hipProfile, 24);
    hipsG.scale(1.12, 1, 0.8);
    parts.pelvis = new THREE.Group();
    parts.pelvis.add(mesh(hipsG, M.pants));
    // belt
    const belt = new THREE.TorusGeometry(0.137, 0.012, 6, 32);
    belt.rotateX(Math.PI / 2);
    belt.scale(1.12, 1, 0.8);
    const beltM = mesh(belt, M.strap);
    beltM.position.y = 0.105;
    parts.pelvis.add(beltM);
    G.add(parts.pelvis);

    // ---- chest (shirt) with an untucked hem ----
    const cp = [
      [0.06, 0.148],
      [0.1, 0.141],
      [0.16, 0.14],
      [0.24, 0.152],
      [0.32, 0.162],
      [0.39, 0.158],
      [0.44, 0.14],
      [0.475, 0.105],
      [0.495, 0.06],
    ];
    const chestProfile = [new THREE.Vector2(0.001, 0.06)];
    for (const [y, r] of cp) chestProfile.push(new THREE.Vector2(r, y));
    const chestG = new THREE.LatheGeometry(chestProfile, 28);
    chestG.scale(1.1, 1, 0.74);
    // translate so the chest pivots at the waist (y = 0.18 of the profile)
    chestG.translate(0, -0.18, 0);
    parts.chest = new THREE.Group();
    const chestMesh = mesh(chestG, M.shirt);
    parts.chest.add(chestMesh);
    // collar
    const collar = new THREE.TorusGeometry(0.06, 0.014, 8, 24);
    collar.rotateX(Math.PI / 2 - 0.25);
    const collarM = mesh(collar, M.shirtLight);
    collarM.position.set(0, 0.305, 0.004);
    parts.chest.add(collarM);
    // placket and buttons
    for (let k = 0; k < 4; k++) {
      const b = mesh(new THREE.SphereGeometry(0.0055, 6, 4), M.shirtLight);
      b.position.set(0, 0.26 - k * 0.075, 0.117 - Math.abs(0.1 - k * 0.04) * 0.02);
      parts.chest.add(b);
    }
    // shoulders (deltoids)
    for (const s of [-1, 1]) {
      const sh = mesh(new THREE.SphereGeometry(0.05, 16, 12), M.shirt);
      sh.scale.set(1.0, 0.85, 0.95);
      sh.position.set(s * L.shoulderHalf, 0.245, -0.005);
      parts.chest.add(sh);
    }
    // backpack with straps
    const bag = mesh(new RoundedBoxGeometry(0.27, 0.34, 0.12, 4, 0.04), M.bag);
    bag.position.set(0, 0.2, -0.155);
    parts.chest.add(bag);
    const pocket = mesh(new RoundedBoxGeometry(0.19, 0.12, 0.05, 3, 0.02), M.bag);
    pocket.position.set(0, 0.1, -0.225);
    parts.chest.add(pocket);
    const flap = mesh(new RoundedBoxGeometry(0.28, 0.1, 0.13, 3, 0.03), M.strap);
    flap.position.set(0, 0.34, -0.155);
    parts.chest.add(flap);
    // shoulder straps hugging the chest (surface sampled from the lathe profile)
    const chestR = (y) => {
      const py = y + 0.18;
      for (let k = 0; k < cp.length - 1; k++) {
        if (py >= cp[k][0] && py <= cp[k + 1][0]) {
          const t = (py - cp[k][0]) / (cp[k + 1][0] - cp[k][0]);
          return cp[k][1] + (cp[k + 1][1] - cp[k][1]) * t;
        }
      }
      return cp[cp.length - 1][1];
    };
    for (const s of [-1, 1]) {
      const pts = [];
      // from the top of the bag, over the shoulder, down the front, back under the arm
      pts.push(V(s * 0.085, 0.33, -0.12));
      pts.push(V(s * 0.095, 0.335, -0.02));
      for (let y = 0.3; y >= 0.02; y -= 0.035) {
        const r = chestR(y);
        const rx = r * 1.1,
          rz = r * 0.74;
        const x = s * (0.085 + (0.3 - y) * 0.08);
        const zz = rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) + 0.007;
        pts.push(V(x, y, zz));
      }
      const strap = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.009, 5);
      parts.chest.add(mesh(strap, M.strap));
      const buckle = mesh(new THREE.BoxGeometry(0.028, 0.02, 0.008), M.metal);
      const by = 0.14;
      const bx = s * (0.085 + (0.3 - by) * 0.08);
      const br = chestR(by);
      buckle.position.set(bx, by, br * 0.74 * Math.sqrt(Math.max(0, 1 - (bx / (br * 1.1)) ** 2)) + 0.012);
      parts.chest.add(buckle);
    }
    G.add(parts.chest);

    // ---- neck & head ----
    parts.neck = mesh(limbGeometry(0.1, [[0, 0.046], [1, 0.05]]), M.skin);
    G.add(parts.neck);
    parts.head = this.buildHead();
    G.add(parts.head);

    // scarf ring around the neck (tails are simulated ribbons)
    const scarfRing = new THREE.TorusGeometry(0.06, 0.021, 10, 28);
    scarfRing.rotateX(Math.PI / 2);
    scarfRing.scale(1.1, 0.9, 1);
    parts.scarfRing = mesh(scarfRing, M.scarf);
    G.add(parts.scarfRing);
    const knot = mesh(new THREE.SphereGeometry(0.024, 12, 10), M.scarf);
    knot.scale.set(1.2, 0.8, 0.7);
    parts.scarfKnot = knot;
    G.add(knot);
    this.scarfGeo = [this.makeRibbon(9), this.makeRibbon(7)];
    for (const rg of this.scarfGeo) {
      const m = new THREE.Mesh(rg, M.scarf);
      m.castShadow = true;
      m.frustumCulled = false;
      G.add(m);
    }

    // ---- arms ----
    const upperArmG = limbGeometry(L.upperArm, [[0, 0.05], [0.3, 0.047], [0.7, 0.042], [1, 0.038]], 1, 1.05);
    // forearm: rolled sleeve at the top, bare skin below
    const forearmG = limbGeometry(L.forearm, [[0, 0.037], [0.25, 0.038], [0.7, 0.031], [1, 0.026]], 1.1, 0.9);
    const cuffG = limbGeometry(0.06, [[0, 0.047], [1, 0.045]]);
    parts.arms = [1, -1].map((side) => {
      const upper = mesh(upperArmG, M.shirt);
      const fore = new THREE.Group();
      fore.add(mesh(forearmG, M.skin));
      const cuff = mesh(cuffG, M.shirt);
      cuff.position.y = -0.005;
      fore.add(cuff);
      const hand = this.buildHand(side);
      G.add(upper, fore, hand);
      return { side, upper, fore, hand };
    });

    // ---- legs ----
    const thighG = limbGeometry(L.thigh, [[0, 0.086], [0.25, 0.08], [0.6, 0.068], [1, 0.054]], 0.95, 1.08);
    const shinG = limbGeometry(L.shin, [[0, 0.056], [0.25, 0.06], [0.6, 0.05], [0.88, 0.045], [1, 0.044]], 1, 1.05);
    const turnupG = new THREE.TorusGeometry(0.047, 0.012, 8, 20);
    turnupG.rotateX(Math.PI / 2);
    parts.legs = [1, -1].map((side) => {
      const thigh = mesh(thighG, M.pants);
      const shin = new THREE.Group();
      shin.add(mesh(shinG, M.pants));
      const cuff = mesh(turnupG, M.pants);
      cuff.position.y = -L.shin + 0.035;
      shin.add(cuff);
      // bare ankle
      const ankle = mesh(limbGeometry(0.05, [[0, 0.036], [1, 0.034]]), M.skin);
      ankle.position.y = -L.shin + 0.03;
      shin.add(ankle);
      const foot = this.buildShoe(side);
      G.add(thigh, shin, foot);
      return { side, thigh, shin, foot };
    });
  }

  buildHead() {
    const M = this.mat;
    const head = new THREE.Group();
    const R = 0.1;
    const deform = (v, hairLayer) => {
      // v on unit-ish sphere scaled by R
      let { x, y, z } = v;
      x *= 0.88;
      y *= 1.1;
      if (z < 0) z *= 1.06;
      // jaw & chin taper
      if (y < -0.01) {
        const t = clamp((-0.01 - y) / 0.1, 0, 1);
        const k = lerp(1, 0.7, t * t);
        x *= k;
        if (z > 0) z *= lerp(1, 0.9, t);
        else z *= lerp(1, 0.75, t);
      }
      if (!hairLayer) {
        // nose
        const nd = Math.hypot(x / 0.018, (y + 0.018) / 0.03);
        if (z > 0.05 && nd < 1) z += (1 - nd * nd) * 0.02;
        // eye sockets
        for (const s of [-1, 1]) {
          const ed = Math.hypot((x - s * 0.034) / 0.022, (y - 0.012) / 0.016);
          if (z > 0.05 && ed < 1) z -= (1 - ed * ed) * 0.006;
        }
      }
      v.set(x, y, z);
    };
    const skull = new THREE.SphereGeometry(R, 40, 32);
    const p = skull.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      deform(v, false);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    skull.computeVertexNormals();
    head.add(mesh(skull, M.skin));

    // hair cap: slightly larger skull with the face and ears pushed inside
    const cap = new THREE.SphereGeometry(R * 1.07, 44, 34);
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      v.fromBufferAttribute(cp, i);
      deform(v, true);
      const hairline = 0.052 + 0.03 * Math.pow(Math.abs(v.x) / 0.09, 2);
      const face = v.z > 0.02 && v.y < hairline;
      const sides = v.z > -0.035 && v.y < -0.005 && Math.abs(v.x) > 0.03;
      if (face || sides) v.multiplyScalar(0.9);
      cp.setXYZ(i, v.x, v.y, v.z);
    }
    cap.computeVertexNormals();
    head.add(mesh(cap, M.hair));
    // fringe: a thin shell over the forehead with a soft, wavy lower edge
    {
      const cols = 40,
        rows = 10;
      const pos = [];
      const uv = [];
      const idx = [];
      const tmpV = new THREE.Vector3();
      for (let j = 0; j <= rows; j++) {
        for (let i = 0; i <= cols; i++) {
          const u = i / cols;
          const az = (u - 0.5) * 2.1; // around the front of the head
          const edge = 0.028 + 0.012 * Math.abs(Math.sin(u * Math.PI * 7)) + 0.02 * Math.pow(Math.abs(u - 0.42) * 2, 2);
          const top = 0.09;
          const y = top - (top - edge) * (j / rows);
          const el = Math.asin(Math.min(0.99, y / (R * 1.1)));
          tmpV.set(Math.sin(az) * Math.cos(el) * R, y / 1.1, Math.cos(az) * Math.cos(el) * R);
          deform(tmpV, true);
          tmpV.multiplyScalar(1.085 + 0.012 * (j / rows));
          tmpV.z += 0.004 * (j / rows);
          pos.push(tmpV.x, tmpV.y, tmpV.z);
          uv.push(u, 1 - j / rows);
        }
      }
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const a0 = j * (cols + 1) + i;
          idx.push(a0, a0 + cols + 1, a0 + 1, a0 + 1, a0 + cols + 1, a0 + cols + 2);
        }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      fg.setIndex(idx);
      fg.computeVertexNormals();
      const fm = mesh(fg, M.hair);
      fm.material = M.hair.clone();
      fm.material.side = THREE.DoubleSide;
      head.add(fm);
    }
    // ears
    for (const s of [-1, 1]) {
      const ear = mesh(new THREE.SphereGeometry(0.02, 10, 8), M.skin);
      ear.scale.set(0.45, 1.25, 0.9);
      ear.position.set(s * 0.084, 0.004, -0.006);
      head.add(ear);
    }
    // eyes
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(s * 0.034, 0.012, 0.0895);
      const sclera = mesh(new THREE.SphereGeometry(0.0125, 16, 12), M.sclera);
      sclera.scale.set(1.15, 0.9, 0.7);
      eye.add(sclera);
      const iris = mesh(new THREE.SphereGeometry(0.0085, 16, 12), M.iris);
      iris.position.z = 0.0065;
      iris.scale.set(1, 1.08, 0.6);
      eye.add(iris);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 4), M.shine);
      shine.position.set(0.003, 0.004, 0.012);
      eye.add(shine);
      // upper lash line
      const lash = new THREE.TorusGeometry(0.0125, 0.0018, 4, 16, Math.PI);
      const lm = mesh(lash, M.brow);
      lm.scale.set(1.15, 0.85, 1);
      lm.position.z = 0.004;
      lm.rotation.z = s * 0.08;
      eye.add(lm);
      head.add(eye);
      this.eyes.push(eye);
      // eyebrow
      const brow = new THREE.TorusGeometry(0.02, 0.0028, 4, 12, Math.PI * 0.7);
      const bm = mesh(brow, M.brow);
      bm.position.set(s * 0.034, 0.034, 0.0965);
      bm.rotation.z = Math.PI * 0.15 + (s > 0 ? 0.08 : -0.08);
      bm.scale.set(1.2, 0.55, 1);
      head.add(bm);
    }
    // lips: gentle smile
    const lip = new THREE.TorusGeometry(0.013, 0.0035, 6, 16, Math.PI * 0.8);
    const lm = mesh(lip, M.lip);
    lm.position.set(0, -0.045, 0.0915);
    lm.rotation.z = Math.PI + Math.PI * 0.1;
    lm.scale.set(1.2, 0.6, 1);
    head.add(lm);
    // ponytail base: hair tie
    const tie = new THREE.TorusGeometry(0.02, 0.009, 8, 16);
    const tm = mesh(tie, M.tie);
    tm.position.set(0, 0.03, -0.108);
    tm.rotation.x = 0.4;
    head.add(tm);
    this.tailAnchor = new THREE.Object3D();
    this.tailAnchor.position.set(0, 0.025, -0.118);
    head.add(this.tailAnchor);
    // ponytail segments (placed each frame)
    this.tailSegs = [];
    for (let i = 0; i < 7; i++) {
      const r0 = lerp(0.03, 0.012, i / 7);
      const r1 = lerp(0.03, 0.008, (i + 1) / 7);
      const seg = mesh(limbGeometry(0.05, [[0, r0], [0.5, (r0 + r1) / 2 + 0.004], [1, r1]], 1.2, 0.9, 10), M.hair);
      this.group.add(seg);
      this.tailSegs.push(seg);
    }
    return head;
  }

  buildHand(side) {
    const M = this.mat;
    // Hand frame: origin at the grip centre, X along the bar (outward), Y up, Z forward
    const hand = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.x = side; // mirror for the right hand
    hand.add(inner);
    const palm = mesh(new RoundedBoxGeometry(0.085, 0.03, 0.09, 3, 0.012), M.skin);
    palm.position.set(-0.005, 0.03, -0.03);
    palm.rotation.x = 0.55;
    inner.add(palm);
    // four fingers curled around the bar
    for (let f = 0; f < 4; f++) {
      const x = -0.03 + f * 0.021;
      const len = f === 0 || f === 3 ? 0.8 : 1;
      const arc = new THREE.TorusGeometry(0.027, 0.0095, 8, 12, Math.PI * 1.25 * len);
      arc.rotateY(Math.PI / 2);
      const fm = mesh(arc, M.skin);
      fm.position.set(x, 0, 0);
      fm.rotation.x = -Math.PI * 0.45;
      inner.add(fm);
    }
    // thumb wrapping underneath
    const thumb = new THREE.TorusGeometry(0.024, 0.011, 8, 10, Math.PI * 0.9);
    thumb.rotateY(Math.PI / 2);
    const tm = mesh(thumb, M.skin);
    tm.position.set(-0.045, -0.005, -0.012);
    tm.rotation.x = Math.PI * 0.35;
    inner.add(tm);
    return hand;
  }

  buildShoe(side) {
    const M = this.mat;
    // Foot frame: origin at the ankle, +Z towards the toes, sole at y = -0.075
    const foot = new THREE.Group();
    const upper = loft(
      [
        [-0.075, 0.03, 0.035, -0.03],
        [-0.06, 0.04, 0.05, -0.03],
        [-0.02, 0.043, 0.055, -0.03],
        [0.04, 0.047, 0.045, -0.042],
        [0.1, 0.05, 0.034, -0.05],
        [0.15, 0.046, 0.027, -0.055],
        [0.185, 0.035, 0.02, -0.058],
        [0.2, 0.018, 0.013, -0.06],
      ],
      'z',
      20,
      2.6
    );
    foot.add(mesh(upper, M.shoe));
    const sole = loft(
      [
        [-0.082, 0.032, 0.012, -0.068],
        [-0.06, 0.045, 0.012, -0.068],
        [0.05, 0.051, 0.012, -0.068],
        [0.15, 0.052, 0.012, -0.066],
        [0.195, 0.038, 0.012, -0.063],
        [0.212, 0.018, 0.01, -0.06],
      ],
      'z',
      18,
      3
    );
    foot.add(mesh(sole, M.sole));
    // side stripe and laces
    const stripe = mesh(new THREE.BoxGeometry(0.004, 0.018, 0.1), M.shoeAccent);
    stripe.position.set(side * 0.046, -0.04, 0.05);
    stripe.rotation.x = 0.15;
    foot.add(stripe);
    for (let k = 0; k < 4; k++) {
      const lace = mesh(new THREE.BoxGeometry(0.05, 0.004, 0.008), M.shoe);
      lace.position.set(0, -0.012 - k * 0.006, 0.02 + k * 0.025);
      lace.rotation.x = 0.35;
      foot.add(lace);
    }
    const tongue = mesh(new RoundedBoxGeometry(0.045, 0.012, 0.07, 2, 0.005), M.shoeAccent);
    tongue.position.set(0, -0.004, 0.015);
    tongue.rotation.x = 0.55;
    foot.add(tongue);
    return foot;
  }

  makeRibbon(n) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(idx);
    return g;
  }

  // ------------------------------------------------------------------
  // s: { dt, speed, crank, pedaling, standing, lean, steer, brake, footDown,
  //      bikeWorld (Matrix4 of the lean frame), velocity (world), groundLocalFoot (Vector3|null), wave, bell }
  update(s) {
    const st = this.state;
    const P = this.parts;
    const dt = s.dt;
    st.t += dt;
    const B = BIKE;
    const stand = s.standing;
    const fd = s.footDown;

    // ---------- pelvis ----------
    const crank = s.crank;
    const seated = V(0, 1.03, -0.29);
    const standing = V(0, 1.17, -0.14);
    const hip = this.tmp.hip.copy(seated).lerp(standing, stand);
    hip.x += Math.sin(crank) * 0.035 * stand;
    hip.y += Math.abs(Math.cos(crank)) * 0.02 * stand;
    // slide forward off the saddle to put a foot down
    hip.add(V(0.01 * fd, -0.085 * fd, 0.11 * fd));
    const effort = s.pedaling;
    const pelvisPitch = lerp(0.3, 0.62, stand) + 0.08 * effort + s.brake * -0.06;
    const pelvisRoll = Math.sin(crank) * (0.03 * effort + 0.1 * stand) - s.bodyRoll;
    const pelvisYaw = Math.sin(crank) * 0.05 * effort;
    P.pelvis.position.copy(hip);
    _e.set(pelvisPitch, pelvisYaw, pelvisRoll, 'YXZ');
    P.pelvis.quaternion.setFromEuler(_e);
    P.pelvis.position.addScaledVector(V(0, 1, 0).applyQuaternion(P.pelvis.quaternion), 0.0);

    // ---------- chest ----------
    const speedLean = smoothstep(2, 9, s.speed);
    const torsoLean = lerp(0.36, 0.5, speedLean) + stand * 0.18 + 0.05 * effort - s.brake * 0.05 - fd * 0.2;
    const waist = V(0, 0.18, 0).applyQuaternion(P.pelvis.quaternion).add(hip);
    P.chest.position.copy(waist);
    st.breath += dt * lerp(1.4, 3.2, effort);
    const breath = Math.sin(st.breath) * 0.012;
    _e.set(torsoLean - 0.1 + breath * 0.5, -pelvisYaw * 0.8 + s.steer * 0.25, -s.bodyRoll * 1.1 + pelvisRoll * -0.4, 'YXZ');
    P.chest.quaternion.setFromEuler(_e);
    P.chest.scale.set(1 + breath * 0.4, 1, 1 + breath);

    const chestQ = P.chest.quaternion;
    const toChest = (x, y, z) => V(x, y, z).applyQuaternion(chestQ).add(waist);
    const shoulderL = toChest(L.shoulderHalf, 0.245, -0.005);
    const shoulderR = toChest(-L.shoulderHalf, 0.245, -0.005);
    const neckBase = toChest(0, 0.29, 0.005);

    // ---------- head ----------
    st.lookTimer -= dt;
    if (st.lookTimer <= 0) {
      st.lookTimer = 2.5 + Math.random() * 4.5;
      const curious = s.speed < 7 && Math.abs(s.steer) < 0.08 && Math.random() < 0.6;
      st.lookTargetYaw = curious ? (Math.random() - 0.5) * 1.3 : 0;
      st.lookTargetPitch = curious ? (Math.random() - 0.3) * 0.25 : 0;
    }
    let yawT = st.lookTargetYaw * (1 - smoothstep(0.05, 0.2, Math.abs(s.steer))) + s.steer * 1.4;
    if (s.wave > 0.1) yawT = lerp(yawT, 0.9, s.wave);
    if (s.lookAt !== undefined && s.lookAt !== null) yawT = s.lookAt;
    st.lookYaw = damp(st.lookYaw, yawT, 3, dt);
    st.lookPitch = damp(st.lookPitch, st.lookTargetPitch, 3, dt);
    const neckTop = V(0, 0.1, 0).applyQuaternion(chestQ).add(neckBase);
    orient(P.neck, neckTop, neckBase, V(0, 0, 1).applyQuaternion(chestQ));
    // head keeps the eyes level: counter the torso pitch and the bike lean
    const headPitch = -0.12 + st.lookPitch - s.brake * 0.05;
    _e.set(headPitch, st.lookYaw, -s.lean * 0.55 - s.bodyRoll * 0.3, 'YXZ');
    P.head.quaternion.setFromEuler(_e);
    P.head.position.copy(neckTop).add(V(0, 0.075, 0.01));
    // scarf follows the neck
    P.scarfRing.position.copy(neckBase).add(V(0, 0.035, 0).applyQuaternion(chestQ));
    P.scarfRing.quaternion.copy(chestQ);
    P.scarfKnot.position.copy(toChest(0.05, 0.29, 0.06));

    // blinking
    st.blinkT -= dt;
    if (st.blinkT < 0) {
      st.blink = 0.14;
      st.blinkT = 2 + Math.random() * 4;
    }
    st.blink = Math.max(0, st.blink - dt);
    const lid = st.blink > 0 ? 0.12 : 1;
    for (const e of this.eyes) e.scale.y = lid;

    // ---------- arms ----------
    const steerQ = this.bike.steerRot.quaternion;
    st.wave = damp(st.wave, s.wave, 6, dt);
    for (const arm of P.arms) {
      const side = arm.side;
      const shoulder = side > 0 ? shoulderL : shoulderR;
      const grip = this.bike.gripPosition(side, V(0, 0, 0));
      // hand frame follows the steering; wrist sits behind and above the grip
      arm.hand.quaternion.copy(steerQ);
      const wristOnBar = V(side * -0.005, 0.045, -0.07).applyQuaternion(steerQ).add(grip);
      let wristT = wristOnBar;
      let handQ = steerQ.clone();
      if (side > 0 && st.wave > 0.01) {
        // waving: hand up beside the head, forearm swinging
        const wave = Math.sin(st.t * 11) * 0.09;
        const up = toChest(0.36 + wave, 0.55, 0.18);
        wristT = wristOnBar.clone().lerp(up, st.wave);
        const qWave = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.3, 0.4, 0.4 + wave * 2));
        handQ.slerp(qWave, st.wave);
      }
      if (side < 0 && s.bell > 0) {
        // thumb flick: tiny hand rotation
        handQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.25 * s.bell)));
      }
      const pole = V(side * 0.45, -0.85, -0.55).applyQuaternion(chestQ);
      solveIK(shoulder, wristT, L.upperArm, L.forearm, pole, this.tmp.elbow, this.tmp.wrist);
      orient(arm.upper, shoulder, this.tmp.elbow, V(0, 0, 1).applyQuaternion(chestQ));
      orient(arm.fore, this.tmp.elbow, this.tmp.wrist, V(side * 0.2, 1, 0));
      // hand placed so the wrist meets the forearm
      arm.hand.quaternion.copy(handQ);
      const handOff = V(side * -0.005, 0.045, -0.07).applyQuaternion(handQ);
      arm.hand.position.copy(this.tmp.wrist).sub(handOff);
    }

    // ---------- legs ----------
    const pelvisQ = P.pelvis.quaternion;
    for (const leg of P.legs) {
      const side = leg.side;
      const hipJ = V(side * L.hipHalf, -0.02, 0.01).applyQuaternion(pelvisQ).add(hip);
      // ankle target from the pedal, with natural ankling through the stroke
      const pedal = this.bike.pedalPosition(side, crank, V(0, 0, 0));
      const a = side > 0 ? crank + Math.PI : crank;
      const ankling = -0.22 + 0.2 * Math.cos(a + 0.9);
      const footQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-ankling, side * 0.08, 0));
      let ankleT = V(side * -0.004, 0.075, -0.125).applyQuaternion(footQ).add(pedal);
      let fq = footQ;
      if (side > 0 && fd > 0.001 && s.groundLocalFoot) {
        // left foot planted on the ground beside the bike
        const g = s.groundLocalFoot;
        const lift = Math.sin(fd * Math.PI) * 0.08 * (1 - fd);
        const planted = V(g.x, g.y + 0.075 + lift, g.z + 0.1);
        ankleT = ankleT.clone().lerp(planted, fd);
        fq = footQ.clone().slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.15, -s.lean)), fd);
      }
      const knee = this.tmp.knee;
      const ankle = this.tmp.ankle;
      const kpole = V(side * 0.18, 0.25, 1).normalize();
      solveIK(hipJ, ankleT, L.thigh, L.shin, kpole, knee, ankle);
      orient(leg.thigh, hipJ, knee, V(0, 1, 0.3));
      orient(leg.shin, knee, ankle, V(0, -0.3, 1));
      leg.foot.position.copy(ankle);
      leg.foot.quaternion.copy(fq);
      leg.pedalPitch = ankling;
    }

    // ---------- secondary motion: ponytail & scarf (world space) ----------
    this.simulateCloth(s);
  }

  simulateCloth(s) {
    const dt = Math.min(s.dt, 1 / 30);
    const G = this.group;
    G.updateMatrixWorld(true);
    const air = s.velocity.clone().negate();
    // gentle ambient breeze
    air.x += 0.6 * Math.sin(this.state.t * 0.7);
    air.z += 0.4 * Math.cos(this.state.t * 0.5);
    const headW = new THREE.Vector3();
    this.parts.head.getWorldPosition(headW);
    const chestW = new THREE.Vector3();
    this.parts.chest.localToWorld(chestW.set(0, 0.2, -0.05));
    const collide = (p) => {
      // keep hair and scarf outside the head and back
      for (const [c, r] of [
        [headW, 0.12],
        [chestW, 0.17],
      ]) {
        const d = _z.subVectors(p, c);
        const l = d.length();
        if (l < r) p.addScaledVector(d, (r - l) / (l || 1));
      }
    };
    // ponytail
    const anchor = new THREE.Vector3();
    this.tailAnchor.getWorldPosition(anchor);
    const back = new THREE.Vector3(0, -0.6, -1).applyQuaternion(this.parts.head.getWorldQuaternion(_q)).normalize();
    const sub = 2;
    for (let k = 0; k < sub; k++) this.ponytail.step(dt / sub, anchor, back, air, 1.6, 9.8, 0.08, collide);
    const inv = new THREE.Matrix4().copy(G.matrixWorld).invert();
    const pts = this.ponytail.p.map((p) => p.clone().applyMatrix4(inv));
    for (let i = 0; i < this.tailSegs.length; i++) {
      orient(this.tailSegs[i], pts[i], pts[i + 1], V(1, 0, 0));
    }
    // scarf tails from the knot, streaming behind
    const knotW = new THREE.Vector3();
    this.parts.scarfKnot.getWorldPosition(knotW);
    const chestQW = this.parts.chest.getWorldQuaternion(new THREE.Quaternion());
    const tailsDir = new THREE.Vector3(0.3, -1, -0.6).applyQuaternion(chestQW).normalize();
    const ropes = [this.scarfL, this.scarfR];
    ropes.forEach((rope, r) => {
      const a = knotW.clone().add(new THREE.Vector3(r === 0 ? 0.01 : -0.01, -0.01, 0).applyQuaternion(chestQW));
      for (let k = 0; k < sub; k++) rope.step(dt / sub, a, tailsDir, air, 2.4, 9.8, 0.05, collide);
      const geo = this.scarfGeo[r];
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQW);
      for (let i = 0; i < rope.n; i++) {
        const p = rope.p[i].clone().applyMatrix4(inv);
        const w = lerp(0.028, 0.036, i / rope.n) * (r === 0 ? 1 : 0.85);
        const flutter = Math.sin(this.state.t * 14 + i * 0.9 + r) * 0.25 * Math.min(1, s.speed / 6);
        const sd = side.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), flutter).transformDirection(inv);
        pos.setXYZ(i * 2, p.x - sd.x * w, p.y - sd.y * w, p.z - sd.z * w);
        pos.setXYZ(i * 2 + 1, p.x + sd.x * w, p.y + sd.y * w, p.z + sd.z * w);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      nor.needsUpdate = true;
    });
  }
}
