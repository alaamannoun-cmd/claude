import * as THREE from 'three';
import { damp, dampAngle, clamp, lerp, smoothstep, wrapAngle } from './noise.js';

export const CAMERA_MODES = [
  { id: 'chase', label: 'خلف الدرّاجة' },
  { id: 'cinematic', label: 'سينمائي' },
  { id: 'side', label: 'جانبي' },
  { id: 'front', label: 'أمامي' },
  { id: 'fpv', label: 'منظور الراكب' },
];

// Camera director: chase, cinematic shots, side, front and first-person views
export class CameraRig {
  constructor(camera, hf) {
    this.camera = camera;
    this.hf = hf;
    this.mode = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitIdle = 10;
    this.dist = 4.4;
    this.shake = 0;
    this.shot = 0;
    this.shotTime = 0;
    this.shotAnchor = new THREE.Vector3();
    this.initialized = false;
    this.fov = 55;
    this.photo = false;
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.shotTime = 0;
    this.shot = 0;
    return CAMERA_MODES[this.mode];
  }

  orbit(dx, dy) {
    this.orbitYaw -= dx * 0.005;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.004, -0.35, 1.1);
    this.orbitIdle = 0;
  }

  zoom(delta) {
    this.dist = clamp(this.dist * (1 + delta * 0.001), 2.2, 14);
  }

  groundClamp(p, margin = 0.35) {
    const g = this.hf.groundHeight(p.x, p.z) + margin;
    if (p.y < g) p.y = g;
    return p;
  }

  update(dt, bike, headWorld) {
    const cam = this.camera;
    const yaw = bike.yaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const base = new THREE.Vector3(bike.pos.x, bike.yVis, bike.pos.z);
    const riderCenter = base.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.orbitIdle += dt;
    if (this.orbitIdle > 3 && !this.photo) {
      this.orbitYaw = dampAngle(this.orbitYaw, 0, 1.2, dt);
      this.orbitPitch = damp(this.orbitPitch, 0, 1.2, dt);
    }
    const mode = CAMERA_MODES[this.mode].id;
    let targetPos = new THREE.Vector3();
    let targetLook = new THREE.Vector3();
    let posLambda = 5,
      lookLambda = 9;
    let fov = 55 + Math.min(bike.speed, 12) * 0.9;

    if (mode === 'chase' || this.photo) {
      if (!this.chaseYaw) this.chaseYaw = yaw;
      this.chaseYaw = dampAngle(this.chaseYaw, yaw, this.photo ? 0 : 3.2, dt);
      const a = this.chaseYaw + Math.PI + this.orbitYaw;
      const pitch = 0.2 + this.orbitPitch;
      const d = this.dist;
      targetPos.set(
        base.x + Math.sin(a) * Math.cos(pitch) * d,
        base.y + 1.25 + Math.sin(pitch) * d,
        base.z + Math.cos(a) * Math.cos(pitch) * d
      );
      targetLook.copy(riderCenter).addScaledVector(fwd, 1.2 * (1 - Math.min(1, Math.abs(this.orbitYaw))));
      targetLook.y += 0.05;
      posLambda = this.photo ? 20 : 6;
    } else if (mode === 'side') {
      targetPos.copy(base).addScaledVector(left, 3.6).addScaledVector(fwd, 0.3);
      targetPos.y += 1.05;
      targetLook.copy(riderCenter).addScaledVector(fwd, 0.5);
      targetLook.y -= 0.2;
      posLambda = 8;
    } else if (mode === 'front') {
      targetPos.copy(base).addScaledVector(fwd, 3.4).addScaledVector(left, 0.9);
      targetPos.y += 1.45;
      targetLook.copy(base).add(new THREE.Vector3(0, 1.3, 0));
      posLambda = 8;
      fov = 46;
    } else if (mode === 'fpv') {
      targetPos.copy(headWorld).addScaledVector(fwd, 0.06);
      targetPos.y += 0.04;
      targetLook.copy(targetPos).addScaledVector(fwd, 6).add(new THREE.Vector3(0, -1.5, 0));
      targetLook.addScaledVector(left, bike.steer * 2);
      posLambda = 60;
      lookLambda = 20;
      fov = 70;
    } else {
      // cinematic director
      this.shotTime += dt;
      const shots = 4;
      const len = [7, 7, 9, 9][this.shot];
      if (this.shotTime > len) {
        this.shotTime = 0;
        this.shot = (this.shot + 1) % shots;
        this.shotAnchor.set(0, 0, 0);
        this.initialized = false;
      }
      const t = this.shotTime;
      if (this.shot === 0) {
        // low tracking shot beside the wheels
        targetPos.copy(base).addScaledVector(left, -2.6).addScaledVector(fwd, 0.8 - t * 0.1);
        targetPos.y += 0.55;
        targetLook.copy(base).add(new THREE.Vector3(0, 0.95, 0)).addScaledVector(fwd, 0.3);
        fov = 42;
        posLambda = 10;
      } else if (this.shot === 1) {
        // front three-quarter: the rider's face
        targetPos.copy(base).addScaledVector(fwd, 4.2).addScaledVector(left, 1.8);
        targetPos.y += 1.2;
        targetLook.copy(base).add(new THREE.Vector3(0, 1.35, 0));
        fov = 38;
        posLambda = 10;
      } else if (this.shot === 2) {
        // slow drone orbit
        const a = yaw + Math.PI * 0.6 + t * 0.12;
        targetPos.set(base.x + Math.sin(a) * 16, base.y + 8 + t * 0.4, base.z + Math.cos(a) * 16);
        targetLook.copy(riderCenter);
        fov = 45;
        posLambda = 3;
      } else {
        // roadside: a fixed camera the rider passes by
        if (this.shotAnchor.lengthSq() === 0) {
          this.shotAnchor.copy(base).addScaledVector(fwd, 10 + bike.speed * 2.2).addScaledVector(left, -3.8);
          this.shotAnchor.y = this.hf.groundHeight(this.shotAnchor.x, this.shotAnchor.z) + 1.1;
        }
        targetPos.copy(this.shotAnchor);
        targetLook.copy(riderCenter);
        fov = 40;
        posLambda = 50;
        if (this.shotAnchor.distanceTo(base) > 26 && t > 2) this.shotTime = 99;
      }
    }

    if (!this.initialized) {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.initialized = true;
    }
    this.pos.x = damp(this.pos.x, targetPos.x, posLambda, dt);
    this.pos.y = damp(this.pos.y, targetPos.y, posLambda, dt);
    this.pos.z = damp(this.pos.z, targetPos.z, posLambda, dt);
    this.look.x = damp(this.look.x, targetLook.x, lookLambda, dt);
    this.look.y = damp(this.look.y, targetLook.y, lookLambda, dt);
    this.look.z = damp(this.look.z, targetLook.z, lookLambda, dt);
    if (mode !== 'fpv') this.groundClamp(this.pos, 0.4);
    this.fov = damp(this.fov, fov, 3, dt);

    cam.position.copy(this.pos);
    // subtle shake on bumps and rough ground
    this.shake = Math.max(this.shake - dt * 3, bike.bump);
    if (this.shake > 0) {
      const s = this.shake * 0.05;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.lookAt(this.look);
    if (mode === 'fpv') cam.rotateZ(-bike.lean * 0.6);
    else if (mode === 'chase') cam.rotateZ(-bike.lean * 0.12);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
