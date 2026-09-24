import * as THREE from 'three';
import { Simplex, clamp, smoothstep, lerp } from '../core/noise.js';
import {
  WORLD_HALF,
  GRID_STEP,
  GRID_N,
  WATER_LEVEL,
  ROAD_HALF_WIDTH,
  LAKE_CENTER,
  lakeRadius,
  RIVER_POINTS,
  roadControlPoints,
  PAGODA,
  SHRINE,
  HOUSES,
  PADDIES,
} from './layout.js';

const N = GRID_N;
const BIG = 1e9;

// A densely sampled spline (1 sample every `step` meters)
class PathSamples {
  constructor(points2d, closed, step) {
    const curve = new THREE.CatmullRomCurve3(
      points2d.map((p) => new THREE.Vector3(p[0], 0, p[1])),
      closed,
      'centripetal'
    );
    const length = curve.getLength();
    const count = Math.max(8, Math.round(length / step));
    const pts = curve.getSpacedPoints(closed ? count : count - 1);
    if (closed) pts.pop();
    this.closed = closed;
    this.count = pts.length;
    this.length = length;
    this.spacing = closed ? length / this.count : length / (this.count - 1);
    this.x = new Float32Array(this.count);
    this.z = new Float32Array(this.count);
    this.tx = new Float32Array(this.count);
    this.tz = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      this.x[i] = pts[i].x;
      this.z[i] = pts[i].z;
    }
    for (let i = 0; i < this.count; i++) {
      const a = this.wrap(i - 1);
      const b = this.wrap(i + 1);
      let dx = this.x[b] - this.x[a];
      let dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
  }
  wrap(i) {
    if (this.closed) return ((i % this.count) + this.count) % this.count;
    return clamp(i, 0, this.count - 1);
  }
  // Interpolated position at a (float) sample index
  pointAt(fi, out = { x: 0, z: 0 }) {
    const i0 = Math.floor(fi);
    const f = fi - i0;
    const a = this.wrap(i0);
    const b = this.wrap(i0 + 1);
    out.x = lerp(this.x[a], this.x[b], f);
    out.z = lerp(this.z[a], this.z[b], f);
    return out;
  }
  tangentAt(fi, out = { x: 0, z: 0 }) {
    const i0 = Math.floor(fi);
    const f = fi - i0;
    const a = this.wrap(i0);
    const b = this.wrap(i0 + 1);
    let x = lerp(this.tx[a], this.tx[b], f);
    let z = lerp(this.tz[a], this.tz[b], f);
    const l = Math.hypot(x, z) || 1;
    out.x = x / l;
    out.z = z / l;
    return out;
  }
  // Exact nearest sample search around a guess index
  refine(x, z, guess, range = 6) {
    let best = BIG;
    let bestI = guess;
    for (let k = -range; k <= range; k++) {
      const i = this.wrap(Math.round(guess) + k);
      const dx = x - this.x[i];
      const dz = z - this.z[i];
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bestI = i;
      }
    }
    // project on neighbouring segment for sub-sample precision
    const i = bestI;
    const j = this.wrap(i + 1);
    const h = this.wrap(i - 1);
    let fi = i;
    let dist = Math.sqrt(best);
    for (const [a, b] of [
      [i, j],
      [h, i],
    ]) {
      if (!this.closed && ((a === b) || (a === this.count - 1 && b === 0))) continue;
      const ax = this.x[a],
        az = this.z[a];
      const bx = this.x[b] - ax,
        bz = this.z[b] - az;
      const l2 = bx * bx + bz * bz;
      if (l2 < 1e-6) continue;
      const t = clamp(((x - ax) * bx + (z - az) * bz) / l2, 0, 1);
      const px = ax + bx * t - x;
      const pz = az + bz * t - z;
      const d = Math.hypot(px, pz);
      if (d < dist + 1e-6) {
        dist = d;
        fi = a + t;
        if (this.closed && fi >= this.count) fi -= this.count;
      }
    }
    return { index: fi, dist };
  }
}

export class Heightfield {
  constructor(seed = 7) {
    this.noise = new Simplex(seed);
    this.noise2 = new Simplex(seed + 101);
    this.N = N;
    this.step = GRID_STEP;
    this.half = WORLD_HALF;
    this.H = new Float32Array(N * N);
    this.base = new Float32Array(N * N);
    this.roadD = new Float32Array(N * N).fill(BIG);
    this.roadI = new Float32Array(N * N);
    this.riverD = new Float32Array(N * N).fill(BIG);
    this.riverI = new Float32Array(N * N);
    this.waterD = new Float32Array(N * N); // signed distance to shore (negative in water)
    this.flatZones = [];
    this.bridges = [];
  }

  idx(ix, iz) {
    return iz * N + ix;
  }
  gx(ix) {
    return -WORLD_HALF + ix * GRID_STEP;
  }

  riverHalfWidth(s) {
    const L = this.river.length;
    let w = 7.2 + 1.8 * Math.sin(s * 0.013 + 0.7) + 1.1 * Math.sin(s * 0.041 + 2.0);
    w = lerp(w, 15, smoothstep(L - 260, L - 90, s));
    return w;
  }

  lakeSD(x, z) {
    const dx = x - LAKE_CENTER.x;
    const dz = z - LAKE_CENTER.z;
    const r = Math.hypot(dx, dz);
    const th = Math.atan2(dz, dx);
    return r - lakeRadius(th);
  }

  baseHeight(x, z) {
    const S = this.noise;
    const q = Math.hypot(x / 820, z / 820);
    const outer = smoothstep(0.6, 1.25, q);
    // keep the north (towards Fuji) open and low beyond the lake
    const northOpen = smoothstep(-560, -900, z) * (1 - smoothstep(250, 700, Math.abs(x + 150)));
    const rise = Math.pow(outer, 1.6) * 250 * (1 - 0.8 * northOpen);
    const n1 = S.fbm(x * 0.0024, z * 0.0024, 5);
    const r1 = S.ridged(x * 0.0011 + 3.1, z * 0.0011 - 7.3, 5);
    const inner = smoothstep(0.3, 0.85, q);
    const hills = (n1 * 0.5 + 0.5) * 30 * (0.3 + 0.7 * inner) + r1 * 110 * outer * (1 - 0.6 * northOpen);
    const floor = 3.6 + S.fbm(x * 0.0065 + 11, z * 0.0065 - 4, 3) * 2.2;
    let h = floor + hills * lerp(0.22, 1, inner) + rise;
    // pagoda hill
    const pdx = x - PAGODA.x,
      pdz = z - PAGODA.z;
    h += 44 * Math.exp(-(pdx * pdx + pdz * pdz) / (2 * 58 * 58));
    // soft wooded hill behind the shrine
    const sdx = x - (SHRINE.x + 60),
      sdz = z - (SHRINE.z + 10);
    h += 16 * Math.exp(-(sdx * sdx + sdz * sdz) / (2 * 55 * 55));
    return h;
  }

  rasterize(path, radius, outD, outI) {
    const segs = path.closed ? path.count : path.count - 1;
    for (let i = 0; i < segs; i++) {
      const j = path.wrap(i + 1);
      const ax = path.x[i],
        az = path.z[i];
      const bx = path.x[j] - ax,
        bz = path.z[j] - az;
      const l2 = bx * bx + bz * bz || 1e-6;
      const minX = Math.min(ax, ax + bx) - radius;
      const maxX = Math.max(ax, ax + bx) + radius;
      const minZ = Math.min(az, az + bz) - radius;
      const maxZ = Math.max(az, az + bz) + radius;
      const ix0 = Math.max(0, Math.floor((minX + WORLD_HALF) / GRID_STEP));
      const ix1 = Math.min(N - 1, Math.ceil((maxX + WORLD_HALF) / GRID_STEP));
      const iz0 = Math.max(0, Math.floor((minZ + WORLD_HALF) / GRID_STEP));
      const iz1 = Math.min(N - 1, Math.ceil((maxZ + WORLD_HALF) / GRID_STEP));
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = -WORLD_HALF + iz * GRID_STEP;
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = -WORLD_HALF + ix * GRID_STEP;
          let t = ((x - ax) * bx + (z - az) * bz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + bx * t - x;
          const pz = az + bz * t - z;
          const d = Math.sqrt(px * px + pz * pz);
          const k = iz * N + ix;
          if (d < outD[k]) {
            outD[k] = d;
            outI[k] = i + t;
          }
        }
      }
    }
  }

  // Bilinear sample of a grid array
  sampleGrid(arr, x, z) {
    const fx = clamp((x + WORLD_HALF) / GRID_STEP, 0, N - 1.001);
    const fz = clamp((z + WORLD_HALF) / GRID_STEP, 0, N - 1.001);
    const ix = Math.floor(fx),
      iz = Math.floor(fz);
    const tx = fx - ix,
      tz = fz - iz;
    const k = iz * N + ix;
    const a = arr[k],
      b = arr[k + 1],
      c = arr[k + N],
      d = arr[k + N + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  nearestCell(x, z) {
    const ix = clamp(Math.round((x + WORLD_HALF) / GRID_STEP), 0, N - 1);
    const iz = clamp(Math.round((z + WORLD_HALF) / GRID_STEP), 0, N - 1);
    return iz * N + ix;
  }

  async generate(report = () => {}) {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    this.road = new PathSamples(roadControlPoints(), true, 1.0);
    this.river = new PathSamples(RIVER_POINTS, false, 3.0);
    report(0.05);
    await tick();

    this.rasterize(this.road, 44, this.roadD, this.roadI);
    this.rasterize(this.river, 150, this.riverD, this.riverI);
    report(0.2);
    await tick();

    // Base terrain + river floodplain
    const { H, base } = this;
    for (let iz = 0; iz < N; iz++) {
      const z = -WORLD_HALF + iz * GRID_STEP;
      for (let ix = 0; ix < N; ix++) {
        const x = -WORLD_HALF + ix * GRID_STEP;
        const k = iz * N + ix;
        let h = this.baseHeight(x, z);
        const rd = this.riverD[k];
        if (rd < 150) {
          const f = Math.exp(-(rd * rd) / (2 * 58 * 58));
          h = lerp(h, 2.2 + (h - 2.2) * 0.25, f);
        }
        const ld = this.lakeSD(x, z);
        if (ld < 120) {
          const f = smoothstep(120, 10, ld);
          h = lerp(h, 2.4 + (h - 2.4) * 0.3, f);
        }
        base[k] = h;
      }
      if ((iz & 63) === 0) {
        report(0.2 + 0.35 * (iz / N));
        await tick();
      }
    }

    this.buildRoadProfile();
    report(0.6);
    await tick();

    this.buildFlatZones();

    // Final heights: road flattening, flat zones, water carving
    const hwRoad = ROAD_HALF_WIDTH;
    for (let iz = 0; iz < N; iz++) {
      const z = -WORLD_HALF + iz * GRID_STEP;
      for (let ix = 0; ix < N; ix++) {
        const x = -WORLD_HALF + ix * GRID_STEP;
        const k = iz * N + ix;
        let h = base[k];

        // flat zones (buildings, paddies)
        for (let f = 0; f < this.flatZones.length; f++) {
          const Z = this.flatZones[f];
          const dx = x - Z.x,
            dz = z - Z.z;
          if (Math.abs(dx) > Z.reach || Math.abs(dz) > Z.reach) continue;
          const lx = dx * Z.c + dz * Z.s;
          const lz = -dx * Z.s + dz * Z.c;
          const ex = Math.max(Math.abs(lx) - Z.hx, 0);
          const ez = Math.max(Math.abs(lz) - Z.hz, 0);
          const e = Math.hypot(ex, ez);
          const w = 1 - smoothstep(0, Z.margin, e);
          if (w > 0) h = lerp(h, Z.h, w);
        }

        // road flattening
        const rd = this.roadD[k];
        if (rd < 40) {
          const ri = this.roadI[k];
          const rh = this.roadHeightAtIndex(ri);
          let w = 1 - smoothstep(hwRoad + 1.6, hwRoad + 11, rd);
          w *= 1 - this.bridgeMaskAtIndex(ri);
          if (w > 0) h = lerp(h, rh - 0.06, w);
        }

        // water carving
        let wd = BIG;
        if (this.riverD[k] < 60) {
          const s = this.riverI[k] * this.river.spacing;
          wd = this.riverD[k] - this.riverHalfWidth(s);
        }
        const ld = this.lakeSD(x, z);
        wd = Math.min(wd, ld);
        this.waterD[k] = wd;
        if (wd < 40) {
          let bed;
          if (wd < 0) bed = WATER_LEVEL - (0.45 + Math.min(-wd, 14) * 0.17);
          else bed = WATER_LEVEL - 0.45 + wd * 0.32 + wd * wd * 0.004;
          // gentle noise on banks
          bed += this.noise2.noise(x * 0.08, z * 0.08) * 0.25;
          if (bed < h) h = bed;
        }
        // keep the road bed intact next to water (acts like a levee)
        if (rd < hwRoad + 1.2) {
          const ri = this.roadI[k];
          if (this.bridgeMaskAtIndex(ri) === 0) h = Math.max(h, this.roadHeightAtIndex(ri) - 0.06);
        }
        H[k] = h;
      }
      if ((iz & 63) === 0) {
        report(0.6 + 0.35 * (iz / N));
        await tick();
      }
    }
    report(1);
  }

  buildRoadProfile() {
    const road = this.road;
    const n = road.count;
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = this.sampleGrid(this.base, road.x[i], road.z[i]);
    // gaussian smoothing along the loop
    const sigma = 16;
    const win = 40;
    const weights = [];
    let wsum = 0;
    for (let k = -win; k <= win; k++) {
      const w = Math.exp(-(k * k) / (2 * sigma * sigma));
      weights.push(w);
      wsum += w;
    }
    let prof = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -win; k <= win; k++) s += raw[road.wrap(i + k)] * weights[k + win];
      prof[i] = Math.max(s / wsum, WATER_LEVEL + 1.9);
    }
    // detect bridges where the road crosses the river
    const riverHW = new Float32Array(n);
    const onRiver = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.nearestCell(road.x[i], road.z[i]);
      const d = this.riverD[k];
      if (d < 60) {
        const s = this.riverI[k] * this.river.spacing;
        riverHW[i] = this.riverHalfWidth(s);
        if (d < riverHW[i] + 1.5) onRiver[i] = 1;
      }
    }
    const bridges = [];
    for (let i = 0; i < n; i++) {
      if (onRiver[i] && !onRiver[road.wrap(i - 1)]) {
        let j = i;
        while (onRiver[road.wrap(j + 1)]) j++;
        const center = (i + j) / 2;
        const ci = road.wrap(Math.round(center));
        // crossing angle
        const k = this.nearestCell(road.x[ci], road.z[ci]);
        const ri = this.riverI[k];
        const rt = this.river.tangentAt(ri);
        const sinA = Math.abs(road.tx[ci] * rt.z - road.tz[ci] * rt.x);
        const halfLen = riverHW[ci] / Math.max(sinA, 0.5) + 12;
        bridges.push({ center, halfLen, hw: riverHW[ci], riverIndex: ri });
      }
    }
    // Pick bridge types: the one near the lake is the red arched bridge
    for (const b of bridges) {
      const p = road.pointAt(b.center);
      b.x = p.x;
      b.z = p.z;
      b.type = p.z < -150 ? 'red' : 'wood';
      const t = road.tangentAt(b.center);
      b.dirX = t.x;
      b.dirZ = t.z;
    }
    this.bridges = bridges;

    // bridge decks: fixed clearance above the water plus an arch
    this.bridgeMask = new Float32Array(n);
    const pinned = new Uint8Array(n);
    for (const b of bridges) {
      const L = b.halfLen;
      const endH = WATER_LEVEL + 2.7;
      const arch = b.type === 'red' ? 1.9 : 0.45;
      b.deckEnd = endH;
      b.arch = arch;
      for (let i = Math.floor(b.center - L); i <= Math.ceil(b.center + L); i++) {
        const w = road.wrap(i);
        const u = clamp((i - b.center) / L, -1, 1);
        prof[w] = endH + arch * (0.5 + 0.5 * Math.cos(Math.PI * u));
        this.bridgeMask[w] = 1 - smoothstep(0.72, 0.98, Math.abs(u));
        pinned[w] = 1;
      }
    }
    // grade limit (max 5.5%) via relaxation, bridges stay pinned
    const maxGrade = 0.055 * road.spacing;
    for (let it = 0; it < 80; it++) {
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const a = prof[road.wrap(i - 1)];
        if (prof[i] - a > maxGrade) prof[i] = a + maxGrade;
        if (a - prof[i] > maxGrade) prof[i] = a - maxGrade;
      }
      for (let i = n - 1; i >= 0; i--) {
        if (pinned[i]) continue;
        const a = prof[road.wrap(i + 1)];
        if (prof[i] - a > maxGrade) prof[i] = a + maxGrade;
        if (a - prof[i] > maxGrade) prof[i] = a - maxGrade;
      }
    }
    // light smoothing to remove kinks
    const out = new Float32Array(n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const inBridge = pinned[i] > 0;
        out[i] = inBridge ? prof[i] : (prof[road.wrap(i - 2)] + prof[road.wrap(i - 1)] * 2 + prof[i] * 3 + prof[road.wrap(i + 1)] * 2 + prof[road.wrap(i + 2)]) / 9;
      }
      prof.set(out);
    }
    this.roadProfile = prof;
  }

  roadHeightAtIndex(fi) {
    const road = this.road;
    const i0 = Math.floor(fi);
    const f = fi - i0;
    return lerp(this.roadProfile[road.wrap(i0)], this.roadProfile[road.wrap(i0 + 1)], f);
  }

  bridgeMaskAtIndex(fi) {
    return this.bridgeMask[this.road.wrap(Math.round(fi))];
  }

  buildFlatZones() {
    const zones = [];
    const add = (x, z, hx, hz, rot, margin, h) => {
      const hh = h !== undefined ? h : this.sampleGrid(this.base, x, z);
      zones.push({ x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), margin, h: hh, reach: Math.hypot(hx, hz) + margin + 2 });
    };
    // houses face the road
    this.houseRot = [];
    for (const house of HOUSES) {
      const k = this.nearestCell(house.x, house.z);
      const near = this.road.refine(house.x, house.z, this.roadI[k] || 0, 30);
      const p = this.road.pointAt(near.index);
      const rot = Math.atan2(p.x - house.x, p.z - house.z);
      house.rot = rot;
      house.h = this.sampleGrid(this.base, house.x, house.z);
      add(house.x, house.z, house.w * 0.5 + 2.5, house.d * 0.5 + 2.5, -rot, 8, house.h);
    }
    // shrine platform and pagoda
    this.shrineH = this.sampleGrid(this.base, SHRINE.x, SHRINE.z);
    add(SHRINE.x, SHRINE.z, 9, 12, 0, 8, this.shrineH);
    this.pagodaH = this.sampleGrid(this.base, PAGODA.x, PAGODA.z);
    add(PAGODA.x, PAGODA.z, 10, 10, 0, 10, this.pagodaH);

    // paddies: stepped terraces
    const P = PADDIES;
    this.paddyPlots = [];
    for (let r = 0; r < P.rows; r++) {
      for (let c = 0; c < P.cols; c++) {
        const cx = P.x0 + c * (P.pw + P.gap) + P.pw / 2;
        const cz = P.z0 + r * (P.pd + P.gap) + P.pd / 2;
        const bh = this.sampleGrid(this.base, cx, cz);
        const level = Math.round(bh * 2.5) / 2.5;
        this.paddyPlots.push({ x: cx, z: cz, w: P.pw, d: P.pd, level });
        add(cx, cz, P.pw / 2 + P.gap / 2, P.pd / 2 + P.gap / 2, 0, 5, level - 0.12);
      }
    }
    this.flatZones = zones;
  }

  // ---------- runtime queries ----------

  terrainHeight(x, z) {
    return this.sampleGrid(this.H, x, z);
  }

  // Nearest road info at a world position
  roadInfo(x, z) {
    const k = this.nearestCell(x, z);
    const d0 = this.roadD[k];
    if (d0 > 42) return { dist: d0, index: -1 };
    const r = this.road.refine(x, z, this.roadI[k], 4);
    return r;
  }

  roadHeightAt(x, z) {
    const r = this.roadInfo(x, z);
    if (r.index < 0) return null;
    return { h: this.roadHeightAtIndex(r.index), ...r };
  }

  // Height the bike rides on (road surface, bridge deck or terrain)
  groundHeight(x, z) {
    const r = this.roadInfo(x, z);
    const th = this.terrainHeight(x, z);
    if (r.index >= 0 && r.dist < ROAD_HALF_WIDTH + 0.35) {
      const rh = this.roadHeightAtIndex(r.index) + 0.02;
      const bm = this.bridgeMaskAtIndex(r.index);
      if (bm > 0) return Math.max(rh, th);
      // blend at the road edge
      const w = smoothstep(ROAD_HALF_WIDTH - 0.1, ROAD_HALF_WIDTH + 0.35, r.dist);
      return lerp(rh, Math.max(th, rh - 0.1), w);
    }
    return th;
  }

  onBridge(x, z) {
    const r = this.roadInfo(x, z);
    if (r.index < 0) return null;
    const bm = this.bridgeMask[this.road.wrap(Math.round(r.index))];
    if (bm <= 0) return null;
    for (const b of this.bridges) {
      if (Math.abs(r.index - b.center) <= b.halfLen + 1) return { bridge: b, dist: r.dist, index: r.index };
    }
    return null;
  }

  waterDistance(x, z) {
    return this.sampleGrid(this.waterD, x, z);
  }

  // Terrain normal via central differences
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.0;
    const hL = this.terrainHeight(x - e, z);
    const hR = this.terrainHeight(x + e, z);
    const hD = this.terrainHeight(x, z - e);
    const hU = this.terrainHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }
}
