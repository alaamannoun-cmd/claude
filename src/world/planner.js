import { Rng, Simplex, smoothstep, clamp } from '../core/noise.js';
import { ROAD_HALF_WIDTH as HW, WATER_LEVEL, SHRINE, PAGODA, HOUSES, PADDIES, PLAY_HALF, LAKE_CENTER } from './layout.js';

// Decides where everything goes: flower fields, forests, trees, lanterns, torii...
// Works purely on the heightfield data so every visual module shares one plan.

class Occupancy {
  constructor(cell = 2, half = 1000) {
    this.cell = cell;
    this.half = half;
    this.n = Math.ceil((half * 2) / cell);
    this.grid = new Uint8Array(this.n * this.n);
  }
  key(x, z) {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }
  free(x, z, r) {
    const c = this.cell;
    for (let dz = -r; dz <= r; dz += c)
      for (let dx = -r; dx <= r; dx += c) {
        if (dx * dx + dz * dz > r * r + c) continue;
        const k = this.key(x + dx, z + dz);
        if (k < 0 || this.grid[k]) return false;
      }
    return true;
  }
  mark(x, z, r) {
    const c = this.cell;
    for (let dz = -r; dz <= r; dz += c)
      for (let dx = -r; dx <= r; dx += c) {
        if (dx * dx + dz * dz > r * r + c) continue;
        const k = this.key(x + dx, z + dz);
        if (k >= 0) this.grid[k] = 1;
      }
  }
}

export class Planner {
  constructor(hf, seed = 11) {
    this.hf = hf;
    this.rng = new Rng(seed);
    this.noise = new Simplex(seed + 5);
    this.occ = new Occupancy(2);
    this.trees = { sakura: [], weeping: [], maple: [], cedar: [], pine: [] };
    this.bamboo = [];
    this.lanterns = [];
    this.toriiTunnel = [];
    this.bigTorii = null;
    this.rocks = [];
    this.colliders = [];
    this.signs = [];
    this.benches = [];
  }

  // ---------- masks ----------
  roadDist(x, z) {
    return this.hf.sampleGrid(this.hf.roadD, x, z);
  }
  waterDist(x, z) {
    return this.hf.sampleGrid(this.hf.waterD, x, z);
  }
  slope(x, z) {
    const hf = this.hf;
    const e = 2;
    const dx = hf.terrainHeight(x + e, z) - hf.terrainHeight(x - e, z);
    const dz = hf.terrainHeight(x, z + e) - hf.terrainHeight(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  // Yellow rapeseed fields east of the sakura avenue and south of the start
  nanohana(x, z) {
    let m = 0;
    // east of the avenue
    m = Math.max(m, smoothstep(40, 56, x) * (1 - smoothstep(170, 215, x)) * smoothstep(-70, -30, z) * (1 - smoothstep(420, 460, z)));
    // south meadow near start
    m = Math.max(m, smoothstep(-50, -20, x) * (1 - smoothstep(110, 150, x)) * smoothstep(505, 530, z) * (1 - smoothstep(620, 650, z)));
    if (m <= 0) return 0;
    const n = this.noise.fbm(x * 0.012, z * 0.012, 3);
    m *= smoothstep(-0.25, 0.05, n);
    const rd = this.roadDist(x, z);
    m *= smoothstep(HW + 3, HW + 7, rd);
    const wd = this.waterDist(x, z);
    m *= smoothstep(4, 9, wd);
    return clamp(m, 0, 1);
  }

  // Moss phlox carpet: returns {m, color} where color indexes the stripe palette
  shibazakura(x, z) {
    const cx = -232,
      cz = 606;
    const dx = (x - cx) / 82,
      dz = (z - cz) / 62;
    let m = 1 - smoothstep(0.75, 1.0, Math.hypot(dx, dz) + this.noise.noise(x * 0.02, z * 0.02) * 0.12);
    // second smaller field north of the road
    const dx2 = (x + 238) / 40,
      dz2 = (z - 486) / 26;
    m = Math.max(m, 1 - smoothstep(0.7, 1.0, Math.hypot(dx2, dz2)));
    if (m <= 0) return { m: 0, color: 0 };
    const rd = this.roadDist(x, z);
    m *= smoothstep(HW + 2, HW + 5, rd);
    const wd = this.waterDist(x, z);
    m *= smoothstep(3, 7, wd);
    // wavy stripes separated by thin green paths
    const s = (x * 0.55 + z * 0.84 + 9 * Math.sin(x * 0.045) + 5 * Math.sin(z * 0.07)) / 7.5;
    const band = Math.floor(s);
    const f = s - band;
    const path = smoothstep(0.0, 0.07, f) * (1 - smoothstep(0.93, 1.0, f));
    m *= 0.15 + 0.85 * path;
    const color = ((band % 4) + 4) % 4;
    return { m, color };
  }

  forest(x, z) {
    const hf = this.hf;
    const h = hf.terrainHeight(x, z);
    const q = Math.hypot(x / 820, z / 820);
    let f = Math.max(smoothstep(0.62, 0.8, q), smoothstep(16, 34, h));
    // sacred grove behind the shrine
    const sdx = x - (SHRINE.x + 55),
      sdz = z - (SHRINE.z + 5);
    f = Math.max(f, 1 - smoothstep(40, 70, Math.hypot(sdx, sdz)));
    // back of the pagoda hill
    const pdx = x - (PAGODA.x - 40),
      pdz = z - (PAGODA.z - 30);
    f = Math.max(f, 0.9 * (1 - smoothstep(40, 90, Math.hypot(pdx, pdz))));
    // keep the lake view towards Fuji open
    const lakeView = smoothstep(-560, -700, z) * (1 - smoothstep(180, 420, Math.abs(x + 100)));
    f *= 1 - 0.85 * lakeView;
    const n = this.noise.fbm(x * 0.008 + 40, z * 0.008 - 12, 3);
    f *= smoothstep(-0.35, 0.15, n);
    f *= smoothstep(20, 34, this.roadDist(x, z));
    f *= smoothstep(6, 14, this.waterDist(x, z));
    // clear the pagoda terrace and the slope facing the road and lake (sakura grow there)
    f *= smoothstep(16, 26, Math.hypot(x - PAGODA.x, z - PAGODA.z));
    if (Math.hypot(x - PAGODA.x, z - PAGODA.z) < 150 && x - PAGODA.x > -30 && z - PAGODA.z > -45) f = 0;
    f *= smoothstep(20, 30, Math.hypot(x - SHRINE.x, z - SHRINE.z));
    if (this.nanohana(x, z) > 0.05 || this.shibazakura(x, z).m > 0.05) f = 0;
    if (this.inPaddies(x, z, 10) || this.nearHouse(x, z, 14)) f = 0;
    return clamp(f, 0, 1);
  }

  inPaddies(x, z, margin = 0) {
    const P = PADDIES;
    const x1 = P.x0 + P.cols * (P.pw + P.gap);
    const z1 = P.z0 + P.rows * (P.pd + P.gap);
    return x > P.x0 - margin && x < x1 + margin && z > P.z0 - margin && z < z1 + margin;
  }

  nearHouse(x, z, r) {
    for (const h of HOUSES) if (Math.hypot(x - h.x, z - h.z) < r + Math.max(h.w, h.d) * 0.5) return true;
    return false;
  }

  sectionIndex(x, z) {
    const hf = this.hf;
    const k = hf.nearestCell(x, z);
    return hf.road.refine(x, z, hf.roadI[k], 40).index;
  }

  // ---------- placement ----------
  plan() {
    const hf = this.hf;
    const road = hf.road;
    const rng = this.rng;

    // road sections by index
    this.sec = {
      avenueEnd: this.sectionIndex(86, -196),
      lakeEnd: this.sectionIndex(-232, -352),
      bambooStart: this.sectionIndex(-352, -190),
      bambooEnd: this.sectionIndex(-334, -30),
      toriiStart: this.sectionIndex(-318, 44),
      toriiEnd: this.sectionIndex(-307, 122),
      villageStart: this.sectionIndex(-318, 212),
      villageEnd: this.sectionIndex(-306, 384),
      fieldsEnd: this.sectionIndex(-132, 552),
    };
    const S = this.sec;

    // occupy road corridor and structures
    for (let i = 0; i < road.count; i += 2) this.occ.mark(road.x[i], road.z[i], HW + 1.5);
    for (const h of HOUSES) this.occ.mark(h.x, h.z, Math.max(h.w, h.d) * 0.5 + 3);
    this.occ.mark(SHRINE.x, SHRINE.z, 13);
    this.occ.mark(PAGODA.x, PAGODA.z, 11);
    for (const b of hf.bridges) {
      for (let k = -b.halfLen - 4; k <= b.halfLen + 4; k += 2) {
        const p = road.pointAt(b.center + k);
        this.occ.mark(p.x, p.z, HW + 4);
      }
    }

    this.placeToriiTunnel();
    this.placeBigTorii();
    this.placeLanterns();

    // --- sakura avenue: both sides of the road ---
    const lineTrees = (i0, i1, spacing, offsetMin, offsetMax, kind, sides = [-1, 1], prob = 1) => {
      for (const side of sides) {
        let i = i0 + rng.float(0, spacing);
        while (i < i1) {
          const w = road.wrap(Math.floor(i));
          const nx = -road.tz[w],
            nz = road.tx[w];
          const off = rng.float(offsetMin, offsetMax) * side;
          const x = road.x[w] + nx * off + rng.float(-1, 1);
          const z = road.z[w] + nz * off + rng.float(-1, 1);
          if (rng.chance(prob)) this.tryTree(kind, x, z, 3.2);
          i += spacing * rng.float(0.8, 1.2);
        }
      }
    };
    lineTrees(0, S.avenueEnd, 12, HW + 3.4, HW + 5.5, 'sakura');
    lineTrees(S.avenueEnd, S.lakeEnd, 15, HW + 3.6, HW + 7, 'sakura', [-1, 1], 0.85);
    lineTrees(S.villageStart, S.villageEnd, 26, HW + 4, HW + 9, 'sakura', [-1, 1], 0.6);
    lineTrees(S.fieldsEnd, road.count - 1, 14, HW + 3.4, HW + 6, 'sakura', [-1, 1], 0.9);
    lineTrees(S.villageEnd, S.fieldsEnd, 24, HW + 4, HW + 8, 'sakura', [-1, 1], 0.55);

    // --- river banks ---
    const river = hf.river;
    for (let i = 5; i < river.count - 3; i += 1) {
      if (!rng.chance(0.26)) continue;
      const s = i * river.spacing;
      const hwR = hf.riverHalfWidth(s);
      const nx = -river.tz[i],
        nz = river.tx[i];
      const side = rng.chance(0.5) ? 1 : -1;
      const off = (hwR + rng.float(3.5, 8)) * side;
      const x = river.x[i] + nx * off;
      const z = river.z[i] + nz * off;
      if (Math.abs(x) > PLAY_HALF + 40 || Math.abs(z) > PLAY_HALF + 40) continue;
      this.tryTree(rng.chance(0.12) ? 'weeping' : 'sakura', x, z, 3.5);
    }

    // --- lake shore ---
    for (let a = 0; a < Math.PI * 2; a += 0.035) {
      if (!rng.chance(0.55)) continue;
      const hfLake = this.lakeShorePoint(a, rng.float(6, 16));
      if (!hfLake) continue;
      const kind = rng.chance(0.2) ? 'pine' : rng.chance(0.15) ? 'weeping' : 'sakura';
      this.tryTree(kind, hfLake.x, hfLake.z, 3.5);
    }

    // --- clusters around landmarks ---
    const cluster = (cx, cz, r, count, kinds, minR = 0) => {
      for (let n = 0; n < count * 4 && count > 0; n++) {
        const a = rng.float(0, Math.PI * 2);
        const d = rng.float(minR, r);
        const x = cx + Math.cos(a) * d,
          z = cz + Math.sin(a) * d;
        if (this.tryTree(rng.pick(kinds), x, z, 3.8)) count--;
      }
    };
    // Chureito-like: sakura below the pagoda facing the lake
    cluster(PAGODA.x + 25, PAGODA.z + 30, 55, 34, ['sakura', 'sakura', 'sakura', 'maple'], 14);
    cluster(SHRINE.x, SHRINE.z, 34, 16, ['maple', 'sakura', 'weeping'], 15);
    cluster(-320, 300, 90, 16, ['sakura', 'maple', 'sakura'], 10);
    cluster(-150, -330, 60, 10, ['sakura', 'pine'], 0);
    cluster(120, 20, 120, 12, ['sakura'], 0);
    cluster(-200, 520, 70, 8, ['sakura', 'weeping'], 10);
    cluster(-80, 120, 80, 12, ['sakura', 'maple'], 0);
    // weeping cherry stars
    this.tryTree('weeping', SHRINE.x + 14, SHRINE.z - 16, 4, true);
    this.tryTree('weeping', SHRINE.x - 16, SHRINE.z - 12, 4, true);
    this.tryTree('weeping', 44, 452, 4, true);
    this.tryTree('weeping', -14, -238, 4, true);

    // --- maples along bamboo edges and scattered meadow trees ---
    lineTrees(S.bambooEnd, S.toriiStart, 18, HW + 4, HW + 9, 'maple', [-1, 1], 0.8);

    // --- bamboo grove ---
    this.placeBamboo();

    // --- cedar forest on hills ---
    this.placeForest();

    // --- rocks along the river ---
    for (let i = 3; i < river.count; i += 2) {
      if (!rng.chance(0.25)) continue;
      const s = i * river.spacing;
      const hwR = hf.riverHalfWidth(s);
      const nx = -river.tz[i],
        nz = river.tx[i];
      const side = rng.chance(0.5) ? 1 : -1;
      const off = (hwR + rng.float(-2.5, 2.5)) * side;
      const x = river.x[i] + nx * off,
        z = river.z[i] + nz * off;
      if (this.roadDist(x, z) < HW + 3) continue;
      const size = rng.float(0.35, 1.3);
      this.rocks.push({ x, z, y: hf.terrainHeight(x, z), s: size, r: rng.float(0, 6.28), t: rng.float(0, 1) });
    }
    // meadow boulders
    for (let n = 0; n < 90; n++) {
      const x = rng.float(-620, 620),
        z = rng.float(-620, 620);
      if (this.roadDist(x, z) < HW + 5 || this.waterDist(x, z) < 3) continue;
      if (!this.occ.free(x, z, 2)) continue;
      const s = rng.float(0.5, 2.2);
      this.rocks.push({ x, z, y: hf.terrainHeight(x, z), s, r: rng.float(0, 6.28), t: rng.float(0, 1) });
      this.colliders.push({ x, z, r: s * 0.8 });
    }

    // signposts and benches at landmarks
    this.placeSignsAndBenches();
  }

  lakeShorePoint(a, out) {
    // march outward from the lake center until we leave the water
    const hf = this.hf;
    for (let r = 120; r < 300; r += 2) {
      const x = LAKE_CENTER.x + Math.cos(a) * r;
      const z = LAKE_CENTER.z + Math.sin(a) * r;
      if (hf.lakeSD(x, z) > out) return { x, z };
    }
    return null;
  }

  tryTree(kind, x, z, radius, force = false) {
    const hf = this.hf;
    if (Math.abs(x) > 960 || Math.abs(z) > 960) return false;
    const wd = this.waterDist(x, z);
    if (wd < 2.5) return false;
    if (!force && this.roadDist(x, z) < HW + 2.2) return false;
    if (!this.occ.free(x, z, radius)) return false;
    if (this.slope(x, z) > 0.6) return false;
    const y = hf.terrainHeight(x, z);
    const rng = this.rng;
    const t = {
      x,
      z,
      y,
      rot: rng.float(0, Math.PI * 2),
      scale: kind === 'weeping' ? rng.float(0.95, 1.2) : rng.float(0.8, 1.15),
      variant: rng.int(0, 7),
    };
    this.trees[kind].push(t);
    this.occ.mark(x, z, radius);
    const trunkR = kind === 'cedar' ? 0.35 : kind === 'weeping' ? 0.45 : 0.38;
    this.colliders.push({ x, z, r: trunkR * t.scale + 0.25 });
    return true;
  }

  placeForest() {
    const rng = this.rng;
    const hf = this.hf;
    const spacing = 7.5;
    for (let z = -980; z < 980; z += spacing) {
      for (let x = -980; x < 980; x += spacing) {
        const jx = x + rng.float(-3, 3),
          jz = z + rng.float(-3, 3);
        const f = this.forest(jx, jz);
        if (f <= 0.05 || !rng.chance(f * 0.95)) continue;
        if (this.waterDist(jx, jz) < 4) continue;
        const y = hf.terrainHeight(jx, jz);
        if (!this.occ.free(jx, jz, 2)) continue;
        const inPlay = Math.abs(jx) < PLAY_HALF + 30 && Math.abs(jz) < PLAY_HALF + 30;
        this.trees.cedar.push({
          x: jx,
          z: jz,
          y,
          rot: rng.float(0, Math.PI * 2),
          scale: rng.float(0.75, 1.25),
          variant: rng.int(0, 3),
        });
        if (inPlay) {
          this.occ.mark(jx, jz, 2);
          this.colliders.push({ x: jx, z: jz, r: 0.55 });
        }
      }
    }
    // Scatter a few broadleaf maples/sakura at forest edges for color
    const extra = this.trees.cedar.length;
    for (let n = 0; n < extra * 0.02; n++) {
      const c = this.trees.cedar[rng.int(0, this.trees.cedar.length - 1)];
      const x = c.x + rng.float(-14, 14),
        z = c.z + rng.float(-14, 14);
      if (this.forest(x, z) < 0.3) this.tryTree(rng.chance(0.6) ? 'sakura' : 'maple', x, z, 3.5);
    }
  }

  placeBamboo() {
    const hf = this.hf;
    const road = hf.road;
    const rng = this.rng;
    const { bambooStart, bambooEnd } = this.sec;
    for (let i = Math.round(bambooStart) - 10; i < bambooEnd + 10; i += 1) {
      const w = road.wrap(i);
      const nx = -road.tz[w],
        nz = road.tx[w];
      const fade = smoothstep(bambooStart - 10, bambooStart + 20, i) * (1 - smoothstep(bambooEnd - 20, bambooEnd + 10, i));
      for (const side of [-1, 1]) {
        const count = Math.round(rng.float(3, 6) * fade);
        for (let c = 0; c < count; c++) {
          const off = side * (HW + 1.6 + Math.pow(rng.next(), 1.4) * 26);
          const x = road.x[w] + nx * off + rng.float(-0.5, 0.5);
          const z = road.z[w] + nz * off + rng.float(-0.5, 0.5);
          if (this.waterDist(x, z) < 3) continue;
          const y = hf.terrainHeight(x, z);
          const dRoad = Math.abs(off);
          this.bamboo.push({
            x,
            z,
            y,
            h: rng.float(9, 15) * (dRoad < HW + 5 ? 0.9 : 1),
            r: rng.float(0.045, 0.085),
            lean: rng.float(0, 0.06) + (dRoad < HW + 6 ? 0.05 : 0),
            // lean towards the road to form a tunnel
            dir: Math.atan2(-nx * side, -nz * side) + rng.float(-0.5, 0.5),
            phase: rng.float(0, 6.28),
          });
          if (dRoad < 10) this.colliders.push({ x, z, r: 0.12 });
          this.occ.mark(x, z, 0.6);
        }
      }
    }
  }

  placeToriiTunnel() {
    const hf = this.hf;
    const road = hf.road;
    const { toriiStart, toriiEnd } = this.sec;
    const spacing = 2.6;
    for (let s = toriiStart; s <= toriiEnd; s += spacing / road.spacing) {
      const p = road.pointAt(s);
      const t = road.tangentAt(s);
      const y = hf.roadHeightAtIndex(s);
      const rot = Math.atan2(t.x, t.z);
      this.toriiTunnel.push({ x: p.x, z: p.z, y, rot, index: s });
      // pillar colliders
      const nx = -t.z,
        nz = t.x;
      const half = HW + 0.35;
      this.colliders.push({ x: p.x + nx * half, z: p.z + nz * half, r: 0.2 });
      this.colliders.push({ x: p.x - nx * half, z: p.z - nz * half, r: 0.2 });
    }
    for (let s = toriiStart - 5; s <= toriiEnd + 5; s += 2) {
      const p = road.pointAt(s);
      this.occ.mark(p.x, p.z, HW + 2.5);
    }
  }

  placeBigTorii() {
    // floating torii in the lake, framed with Fuji behind when looking north from the shore road
    const a = (122 * Math.PI) / 180;
    let pt = null;
    for (let r = 100; r < 260; r += 1) {
      const x = LAKE_CENTER.x + Math.cos(a) * r;
      const z = LAKE_CENTER.z + Math.sin(a) * r;
      if (this.hf.lakeSD(x, z) > -9) {
        pt = { x, z };
        break;
      }
    }
    if (pt) {
      this.bigTorii = { x: pt.x, z: pt.z, y: WATER_LEVEL - 0.6, rot: 0 };
    }
  }

  placeLanterns() {
    const hf = this.hf;
    const road = hf.road;
    const S = this.sec;
    const add = (s, side, off = HW + 1.4) => {
      const w = road.wrap(Math.round(s));
      const nx = -road.tz[w],
        nz = road.tx[w];
      const x = road.x[w] + nx * off * side;
      const z = road.z[w] + nz * off * side;
      if (this.waterDist(x, z) < 1.5) return;
      const y = hf.terrainHeight(x, z);
      const rot = Math.atan2(-nx * side, -nz * side);
      this.lanterns.push({ x, z, y, rot });
      this.colliders.push({ x, z, r: 0.45 });
      this.occ.mark(x, z, 1.4);
    };
    // approach to the torii tunnel and beyond
    for (let s = S.toriiStart - 60; s < S.toriiStart - 4; s += 14) {
      add(s, 1);
      add(s, -1);
    }
    for (let s = S.toriiEnd + 6; s < S.toriiEnd + 50; s += 14) {
      add(s, 1);
      add(s, -1);
    }
    // bridge heads
    for (const b of hf.bridges) {
      for (const k of [-1, 1]) {
        add(b.center + k * (b.halfLen + 3), 1);
        add(b.center + k * (b.halfLen + 3), -1);
      }
    }
    // along the lake shore, water side
    for (let s = S.avenueEnd + 30; s < S.lakeEnd; s += 38) add(s, 1, HW + 1.6);
    // along the avenue, alternating
    for (let s = 20; s < S.avenueEnd; s += 60) add(s, (Math.floor(s / 60) % 2) * 2 - 1, HW + 1.5);
    // village
    for (let s = S.villageStart; s < S.villageEnd; s += 45) add(s, -1, HW + 1.6);
  }

  placeSignsAndBenches() {
    const hf = this.hf;
    const road = hf.road;
    const S = this.sec;
    const sign = (s, side, text, sub) => {
      const w = road.wrap(Math.round(s));
      const nx = -road.tz[w],
        nz = road.tx[w];
      const x = road.x[w] + nx * (HW + 1.1) * side;
      const z = road.z[w] + nz * (HW + 1.1) * side;
      const rot = Math.atan2(road.tx[w], road.tz[w]) + (side > 0 ? -Math.PI / 2 : Math.PI / 2) * 0.35;
      this.signs.push({ x, z, y: hf.terrainHeight(x, z), rot: Math.atan2(-road.tx[w], -road.tz[w]), text, sub });
      this.colliders.push({ x, z, r: 0.2 });
    };
    sign(8, 1, '桜並木', 'SAKURA');
    sign(S.avenueEnd + 10, -1, '富士見湖', 'LAKE');
    sign(S.bambooStart - 12, 1, '竹林の道', 'BAMBOO');
    sign(S.toriiStart - 12, -1, '千本鳥居', 'TORII');
    sign(S.villageStart - 10, 1, '里山の村', 'VILLAGE');
    sign(S.villageEnd + 40, -1, '芝桜の丘', 'SHIBAZAKURA');

    const bench = (s, side) => {
      const w = road.wrap(Math.round(s));
      const nx = -road.tz[w],
        nz = road.tx[w];
      const x = road.x[w] + nx * (HW + 2.2) * side;
      const z = road.z[w] + nz * (HW + 2.2) * side;
      this.benches.push({ x, z, y: hf.terrainHeight(x, z), rot: Math.atan2(nx * side, nz * side) });
      this.colliders.push({ x, z, r: 0.8 });
      this.occ.mark(x, z, 1.5);
    };
    bench(S.avenueEnd + 60, 1);
    bench(S.avenueEnd + 140, 1);
    bench(200, -1);
    bench(S.lakeEnd + 20, 1);
  }
}
