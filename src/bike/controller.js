import * as THREE from 'three';
import { BIKE } from './bicycle.js';
import { clamp, damp, dampAngle, lerp, smoothstep, wrapAngle } from '../core/noise.js';
import { ROAD_HALF_WIDTH as HW, WATER_LEVEL, PLAY_HALF } from '../world/layout.js';

const G = 9.81;

// Spatial hash of circular colliders
class ColliderGrid {
  constructor(list, cell = 8) {
    this.cell = cell;
    this.map = new Map();
    for (const c of list) {
      const x0 = Math.floor((c.x - c.r) / cell),
        x1 = Math.floor((c.x + c.r) / cell);
      const z0 = Math.floor((c.z - c.r) / cell),
        z1 = Math.floor((c.z + c.r) / cell);
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const k = x * 73856093 ^ z * 19349663;
          if (!this.map.has(k)) this.map.set(k, []);
          this.map.get(k).push(c);
        }
    }
  }
  query(x, z) {
    const k = Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663;
    return this.map.get(k) || [];
  }
}

export class BikeController {
  constructor(hf, colliders) {
    this.hf = hf;
    this.grid = new ColliderGrid(colliders);
    const r = hf.road;
    const i0 = 6;
    const p = r.pointAt(i0);
    const t = r.tangentAt(i0);
    // start on the right-hand side of the road... Japan drives on the left
    this.pos = new THREE.Vector3(p.x - -t.z * 1.2, 0, p.z - t.x * 1.2);
    this.yaw = Math.atan2(t.x, t.z);
    this.pos.y = hf.groundHeight(this.pos.x, this.pos.z);
    this.speed = 0;
    this.steer = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.pitch = 0;
    this.crank = 0.9;
    this.rearSpin = 0;
    this.frontSpin = 0;
    this.pedaling = 0;
    this.standing = 0;
    this.footDown = 1;
    this.brake = 0;
    this.vy = 0;
    this.yVis = this.pos.y;
    this.surface = 'road';
    this.onBridge = false;
    this.distance = 0;
    this.bump = 0;
    this.velocity = new THREE.Vector3();
    this.yawRate = 0;
    this.accel = 0;
    this.autopilot = false;
    this.roadIndex = i0;
    this.bumpNoise = 0;
    this.events = [];
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  blocked(x, z) {
    if (Math.abs(x) > PLAY_HALF || Math.abs(z) > PLAY_HALF) return 'edge';
    const hf = this.hf;
    const br = hf.onBridge(x, z);
    if (br) {
      if (br.dist > HW + 0.05) return 'rail';
      return null;
    }
    const gh = hf.terrainHeight(x, z);
    const road = hf.roadInfo(x, z);
    const onRoad = road.index >= 0 && road.dist < HW + 0.3;
    if (!onRoad && gh < WATER_LEVEL + 0.18) return 'water';
    for (const c of this.grid.query(x, z)) {
      const dx = x - c.x,
        dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + 0.28) ** 2) return 'tree';
    }
    return null;
  }

  // Look-ahead steering along the road loop
  autopilotInput() {
    const hf = this.hf;
    const r = hf.road;
    const near = r.refine(this.pos.x, this.pos.z, this.roadIndex, 12);
    this.roadIndex = near.index;
    const ahead = 7 + this.speed * 1.1;
    const tgt = r.pointAt(near.index + ahead / r.spacing);
    const tan = r.tangentAt(near.index + ahead / r.spacing);
    // keep to the left side of the road like Japanese traffic
    const tx = tgt.x + tan.z * 1.1,
      tz = tgt.z - tan.x * 1.1;
    const desired = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    const diff = wrapAngle(desired - this.yaw);
    return { steer: clamp(diff * 2.6, -1, 1), throttle: this.speed < 6.3 ? 1 : 0, brake: 0 };
  }

  update(dt, input) {
    const hf = this.hf;
    let { throttle, brake, steer: steerIn, sprint } = input;
    if (this.autopilot) {
      const a = this.autopilotInput();
      if (Math.abs(steerIn) < 0.1) steerIn = a.steer;
      if (throttle === 0 && brake === 0) throttle = a.throttle;
    } else {
      const near = hf.roadInfo(this.pos.x, this.pos.z);
      if (near.index >= 0) this.roadIndex = near.index;
    }
    this.brake = damp(this.brake, brake, 10, dt);

    // ---- terrain under the wheels ----
    const fwd = this.forward();
    const half = BIKE.wheelbase / 2;
    const hR = hf.groundHeight(this.pos.x - fwd.x * half, this.pos.z - fwd.z * half);
    const hF = hf.groundHeight(this.pos.x + fwd.x * half, this.pos.z + fwd.z * half);
    const targetPitch = Math.atan2(hR - hF, BIKE.wheelbase);
    this.pitch = damp(this.pitch, targetPitch, 14, dt);
    const slope = Math.sin(-this.pitch);

    const road = hf.roadInfo(this.pos.x, this.pos.z);
    const bridge = hf.onBridge(this.pos.x, this.pos.z);
    this.onBridge = !!bridge;
    const onRoad = road.index >= 0 && road.dist < HW + 0.25;
    if (bridge) this.surface = 'wood';
    else if (onRoad) this.surface = this.surfaceKind ? this.surfaceKind(road.index) : 'road';
    else this.surface = 'grass';

    // ---- longitudinal dynamics ----
    const sprintOn = sprint && throttle > 0;
    const vmax = sprintOn ? 12.5 : 8.6;
    const push = throttle * (sprintOn ? 2.4 : 1.55) * clamp(1 - this.speed / vmax, 0, 1);
    const rolling = this.surface === 'grass' ? 0.55 : this.surface === 'gravel' ? 0.14 : 0.05;
    const drag = 0.0045 * this.speed * this.speed;
    const brakeA = this.brake * 5.5;
    let a = push - G * slope * 0.92 - (this.speed > 0.01 ? rolling + drag + brakeA : 0);
    if (this.speed <= 0.01 && a < 0) a = Math.max(a, -G * slope * 0.92) > 0 ? a : 0;
    this.accel = a;
    this.speed = Math.max(0, this.speed + a * dt);
    if (this.speed < 0.05 && throttle === 0) this.speed = Math.max(0, this.speed - dt);

    // ---- steering & lean ----
    const v = this.speed;
    const maxSteer = lerp(0.6, 0.11, smoothstep(0.5, 11, v));
    const targetSteer = steerIn * maxSteer;
    this.steer = damp(this.steer, targetSteer, 7, dt);
    // tiny balance corrections at walking pace
    const wobble = v > 0.3 && v < 2.5 ? Math.sin(performance.now() * 0.004) * 0.02 * (1 - v / 2.5) : 0;
    const steerEff = this.steer + wobble;
    this.yawRate = (v * Math.tan(steerEff)) / BIKE.wheelbase;
    this.yaw = wrapAngle(this.yaw + this.yawRate * dt);

    this.footDown = damp(this.footDown, v < 0.4 && throttle === 0 ? 1 : 0, throttle > 0 ? 9 : 3.5, dt);
    let leanTarget = -Math.atan((v * this.yawRate) / G);
    leanTarget = clamp(leanTarget, -0.62, 0.62);
    // out of the saddle the bike rocks with each pedal stroke
    leanTarget += Math.sin(this.crank) * 0.13 * this.standing * smoothstep(0.5, 3, v);
    leanTarget = lerp(leanTarget, -0.13, this.footDown);
    // critically damped spring
    const k = 60,
      c = 2 * Math.sqrt(k);
    this.leanVel += (k * (leanTarget - this.lean) - c * this.leanVel) * dt;
    this.lean += this.leanVel * dt;

    // ---- move with collision ----
    const step = v * dt;
    fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const nx = this.pos.x + fwd.x * step;
    const nz = this.pos.z + fwd.z * step;
    const frontX = nx + fwd.x * 0.6,
      frontZ = nz + fwd.z * 0.6;
    const hit = this.blocked(frontX, frontZ) || this.blocked(nx, nz);
    if (!hit) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      // try to slide along the obstacle
      const sx = this.pos.x + fwd.x * step,
        sz = this.pos.z;
      const tx = this.pos.x,
        tz = this.pos.z + fwd.z * step;
      if (!this.blocked(sx + fwd.x * 0.6, sz) && Math.abs(fwd.x) > 0.3) this.pos.x = sx;
      else if (!this.blocked(tx, tz + fwd.z * 0.6) && Math.abs(fwd.z) > 0.3) this.pos.z = tz;
      if (v > 1.5) {
        this.events.push({ type: 'bump', strength: Math.min(1, v / 8), what: hit });
        this.bump = Math.min(1, v / 8);
      }
      this.speed *= hit === 'water' || hit === 'edge' ? 0.25 : 0.35;
    }
    this.distance += step;

    // ---- height ----
    const gh = (hR + hF) / 2;
    const rough = this.surface === 'grass' ? 0.018 : this.surface === 'gravel' ? 0.006 : this.surface === 'wood' ? 0.004 : 0.0;
    this.bumpNoise += dt * v * 9;
    const bumpY = rough * Math.min(1, v / 5) * (Math.sin(this.bumpNoise) * 0.6 + Math.sin(this.bumpNoise * 2.7) * 0.4);
    this.pos.y = gh;
    this.yVis = damp(this.yVis, gh + bumpY, 25, dt);
    this.bump = Math.max(0, this.bump - dt * 2);

    // ---- drivetrain ----
    const R = BIKE.wheelR;
    this.rearSpin += (v / R) * dt;
    this.frontSpin += (v / R) * dt;
    const pedalTarget = throttle > 0 ? 1 : 0;
    this.pedaling = damp(this.pedaling, pedalTarget, 6, dt);
    this.standing = damp(this.standing, sprintOn && v > 0.8 ? 1 : 0, 3.5, dt);
    if (throttle > 0) {
      const cadence = Math.max(v / (R * BIKE.gear), v < 2 ? 2.2 * throttle : 0);
      this.crank += cadence * dt;
    } else if (this.footDown > 0.5) {
      // set the right pedal up at 2 o'clock, ready to push off
      this.crank = dampAngle(this.crank, 0.9, 3, dt);
    } else {
      // coasting: pedals drift level
      const lvl = Math.round((this.crank - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.crank = damp(this.crank, lvl, 1.5, dt);
    }
    this.crank = ((this.crank % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    this.velocity.set(fwd.x * v, 0, fwd.z * v);
  }
}
