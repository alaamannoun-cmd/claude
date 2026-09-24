import * as THREE from 'three';
import { makeGlowTexture } from '../core/textures.js';
import { groundUniforms, groundGLSL } from '../veg/grass.js';
import { vegUniforms } from '../veg/common.js';
import { patchMaterial } from '../core/fog.js';

// Butterflies drifting over the meadows, birds circling high up, fireflies at night.
function wingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const cols = [
    ['#fbf6ea', '#1f1a16'],
    ['#f6d34a', '#2a1f10'],
    ['#f08a3c', '#2b1a10'],
    ['#b9d6f2', '#1c2530'],
  ];
  cols.forEach(([fill, edge], i) => {
    const ox = (i % 2) * 128,
      oy = Math.floor(i / 2) * 128;
    ctx.save();
    ctx.translate(ox, oy);
    // one wing: body edge at x = 0, tip at x = 128
    ctx.fillStyle = fill;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(4, 60);
    ctx.bezierCurveTo(30, 0, 110, 4, 120, 30);
    ctx.bezierCurveTo(124, 52, 90, 64, 60, 66);
    ctx.bezierCurveTo(96, 78, 104, 112, 74, 122);
    ctx.bezierCurveTo(44, 126, 20, 96, 4, 68);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(92, 30, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildWildlife(hf) {
  const group = new THREE.Group();
  group.name = 'wildlife';

  // ---------------- butterflies ----------------
  const BN = 16;
  const wing = new THREE.BufferGeometry();
  // two wings; aSide = -1 / +1 decides the flap direction
  const pos = [];
  const uv = [];
  const side = [];
  for (const s of [-1, 1]) {
    const q = [
      [0, 0, -0.5, 0, 0.5],
      [s, 0, -0.5, 1, 0.5],
      [s, 0, 0.5, 1, 1],
      [0, 0, 0.5, 0, 1],
    ];
    for (const [x, y, z, u, v] of q) {
      pos.push(x * 0.05, y, z * 0.06);
      uv.push(u * 0.5, (z + 0.5) * 0.5);
      side.push(s);
    }
  }
  wing.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wing.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  wing.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  wing.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  wing.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const bflyMat = new THREE.MeshStandardMaterial({ map: wingTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
  const atlas = new Float32Array(BN * 2);
  const phase = new Float32Array(BN);
  for (let i = 0; i < BN; i++) {
    const k = i % 4;
    atlas[i * 2] = (k % 2) * 0.5;
    atlas[i * 2 + 1] = Math.floor(k / 2) * 0.5;
    phase[i] = Math.random() * 10;
  }
  wing.setAttribute('aAtlas', new THREE.InstancedBufferAttribute(atlas, 2));
  wing.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  patchMaterial(
    bflyMat,
    (shader) => {
      shader.uniforms.uTime = vegUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSide;\nattribute vec2 aAtlas;\nattribute float aPhase;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv = uv + aAtlas;
          #endif`
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = position;
          float flap = sin( uTime * 17.0 + aPhase ) * 1.05 + 0.25;
          float ca = cos( flap ), sa = sin( flap );
          transformed = vec3( position.x * ca, abs( position.x ) * sa, position.z );`
        );
    },
    'butterfly'
  );
  const bflies = new THREE.InstancedMesh(wing, bflyMat, BN);
  bflies.frustumCulled = false;
  bflies.layers.set(1);
  group.add(bflies);
  const bState = [];
  for (let i = 0; i < BN; i++) bState.push({ p: new THREE.Vector3(1e5, 0, 0), v: new THREE.Vector3(), t: Math.random() * 10, target: new THREE.Vector3() });

  // ---------------- birds ----------------
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0.25, -0.9, 0, -0.1, 0, 0, -0.15, 0, 0, 0.25, 0, 0, -0.15, 0.9, 0, -0.1], 3)
  );
  birdGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x2a2626, side: THREE.DoubleSide, fog: true });
  const birdPhase = new Float32Array(10);
  for (let i = 0; i < 10; i++) birdPhase[i] = Math.random() * 6;
  birdGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(birdPhase, 1));
  patchMaterial(
    birdMat,
    (shader) => {
      shader.uniforms.uTime = vegUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = position;
          transformed.y += abs( position.x ) * sin( uTime * 6.0 + aPhase ) * 0.6;`
        );
    },
    'bird'
  );
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, 10);
  birds.frustumCulled = false;
  group.add(birds);
  const flock = { center: new THREE.Vector3(), a: 0 };

  // ---------------- fireflies ----------------
  const FN = 260;
  const fGeo = new THREE.BufferGeometry();
  const fPos = new Float32Array(FN * 3);
  const fSeed = new Float32Array(FN * 4);
  for (let i = 0; i < FN; i++) for (let k = 0; k < 4; k++) fSeed[i * 4 + k] = Math.random();
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  fGeo.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 4));
  const fMat = new THREE.ShaderMaterial({
    uniforms: {
      ...groundUniforms,
      uTime: vegUniforms.uTime,
      uWind: vegUniforms.uWind,
      uNight: vegUniforms.uNight,
      uGlow: { value: makeGlowTexture() },
    },
    vertexShader: /* glsl */ `
      ${groundGLSL}
      attribute vec4 aSeed;
      uniform float uNight;
      varying float vA;
      void main() {
        vec3 box = vec3( 50.0, 3.0, 50.0 );
        vec2 base = ( aSeed.xz - 0.5 ) * box.xz;
        base += vec2( sin( uTime * 0.3 + aSeed.y * 20.0 ), cos( uTime * 0.25 + aSeed.w * 17.0 ) ) * 2.0;
        vec2 rel = mod( base - uCam.xz + box.xz * 0.5, box.xz ) - box.xz * 0.5;
        vec2 wxz = uCam.xz + rel;
        float h = gHeight( wxz ) + 0.4 + aSeed.y * 2.2 + sin( uTime * 0.8 + aSeed.x * 30.0 ) * 0.3;
        vec4 mv = modelViewMatrix * vec4( wxz.x, h, wxz.y, 1.0 );
        gl_Position = projectionMatrix * mv;
        float blink = smoothstep( 0.55, 1.0, sin( uTime * ( 1.5 + aSeed.z * 2.0 ) + aSeed.w * 40.0 ) );
        vA = blink * smoothstep( 0.5, 0.9, uNight ) * ( 1.0 - smoothstep( 18.0, 25.0, length( rel ) ) );
        gl_PointSize = ( 90.0 / -mv.z ) * ( 0.6 + aSeed.x * 0.6 ) * step( 0.01, vA );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uGlow;
      varying float vA;
      void main() {
        float g = texture2D( uGlow, gl_PointCoord ).r;
        gl_FragColor = vec4( vec3( 0.75, 1.0, 0.35 ) * g * vA * 2.5, 1.0 );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(fGeo, fMat);
  fireflies.frustumCulled = false;
  fireflies.layers.set(1);
  group.add(fireflies);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  return {
    group,
    update(dt, focus, night) {
      // butterflies: wander around the rider in daylight, respawn when too far
      bflies.visible = night < 0.5;
      for (let i = 0; i < BN; i++) {
        const b = bState[i];
        b.t -= dt;
        if (b.p.distanceTo(focus) > 45) {
          const a = Math.random() * Math.PI * 2;
          const r = 10 + Math.random() * 25;
          b.p.set(focus.x + Math.cos(a) * r, 0, focus.z + Math.sin(a) * r);
          b.p.y = hf.terrainHeight(b.p.x, b.p.z) + 0.6 + Math.random();
          b.t = 0;
        }
        if (b.t <= 0) {
          b.t = 0.6 + Math.random() * 1.8;
          b.target.set(b.p.x + (Math.random() - 0.5) * 8, 0, b.p.z + (Math.random() - 0.5) * 8);
          b.target.y = hf.terrainHeight(b.target.x, b.target.z) + 0.4 + Math.random() * 1.6;
        }
        const dir = b.target.clone().sub(b.p);
        b.v.lerp(dir.normalize().multiplyScalar(1.6), Math.min(1, dt * 2.5));
        b.v.y += Math.sin(performance.now() * 0.01 + i) * 0.08;
        b.p.addScaledVector(b.v, dt);
        const yaw = Math.atan2(b.v.x, b.v.z);
        e.set(Math.sin(i + performance.now() * 0.003) * 0.25, yaw, 0);
        q.setFromEuler(e);
        m.compose(b.p, q, one);
        bflies.setMatrixAt(i, m);
      }
      bflies.instanceMatrix.needsUpdate = true;

      // birds: a loose flock circling above the valley
      birds.visible = night < 0.6;
      flock.center.lerp(focus, Math.min(1, dt * 0.05));
      flock.a += dt * 0.12;
      for (let i = 0; i < 10; i++) {
        const a = flock.a + i * 0.35;
        const r = 70 + (i % 3) * 12;
        const p = new THREE.Vector3(flock.center.x + Math.cos(a) * r, flock.center.y + 55 + Math.sin(a * 2 + i) * 6 + i * 1.5, flock.center.z + Math.sin(a) * r);
        e.set(0, Math.atan2(-Math.sin(a), Math.cos(a)), 0.3);
        q.setFromEuler(e);
        m.compose(p, q, new THREE.Vector3(1.4, 1.4, 1.4));
        birds.setMatrixAt(i, m);
      }
      birds.instanceMatrix.needsUpdate = true;
      fireflies.visible = night > 0.3;
    },
  };
}
