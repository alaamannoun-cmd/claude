import * as THREE from 'three';
import { patchMaterial } from '../core/fog.js';
import { vegUniforms } from './common.js';
import { smoothstep, clamp } from '../core/noise.js';
import { ROAD_HALF_WIDTH as HW, PLAY_HALF } from '../world/layout.js';
import { makeFlowerAtlas } from '../core/textures.js';

// Data textures over the play area that the grass shaders sample
export function buildGroundData(hf, planner) {
  const half = PLAY_HALF + 60;
  const res = 1; // meters per texel
  const n = Math.round((half * 2) / res) + 1;
  const hData = new Float32Array(n * n);
  const mData = new Uint8Array(n * n * 4);
  const cData = new Uint8Array(n * n * 4);
  const S = hf.noise;
  for (let j = 0; j < n; j++) {
    const z = -half + j * res;
    for (let i = 0; i < n; i++) {
      const x = -half + i * res;
      const k = j * n + i;
      hData[k] = hf.terrainHeight(x, z);
      const rd = planner.roadDist(x, z);
      const wd = planner.waterDist(x, z);
      let dens = smoothstep(HW + 0.25, HW + 1.3, rd);
      dens *= smoothstep(0.4, 1.8, wd);
      let hgt = 0.75 + 0.35 * S.noise(x * 0.05, z * 0.05);
      hgt *= 0.55 + 0.45 * smoothstep(HW + 1, HW + 6, rd); // mown verge
      if (wd < 6 && wd > 0.4) hgt *= 1.35; // lush banks
      const slope = planner.slope(x, z);
      dens *= 1 - smoothstep(0.55, 0.8, slope);
      const nano = planner.nanohana(x, z);
      dens *= 1 - nano * 0.5;
      const sh = planner.shibazakura(x, z).m;
      dens *= 1 - sh * 0.9;
      if (planner.inPaddies(x, z, 0.2)) dens = 0;
      for (const Z of hf.flatZones) {
        if (Z.hx > 20) continue;
        const dx = x - Z.x,
          dz = z - Z.z;
        const lx = dx * Z.c + dz * Z.s;
        const lz = -dx * Z.s + dz * Z.c;
        if (Math.abs(lx) < Z.hx - 1 && Math.abs(lz) < Z.hz - 1) dens *= 0.05;
      }
      // wildflowers: scattered meadows, more near the river and fields
      let fl = smoothstep(0.1, 0.6, S.noise(x * 0.02 + 9, z * 0.02 - 3)) * 0.7;
      fl = Math.max(fl, smoothstep(2, 6, wd) * (1 - smoothstep(10, 25, wd)) * 0.6);
      fl *= dens * (1 - nano);
      mData[k * 4] = clamp(dens, 0, 1) * 255;
      mData[k * 4 + 1] = clamp(hgt / 1.6, 0, 1) * 255;
      mData[k * 4 + 2] = clamp(fl, 0, 1) * 255;
      mData[k * 4 + 3] = clamp(nano, 0, 1) * 255;
      // terrain color (linear, sqrt-encoded for precision)
      const gi = hf.nearestCell(x, z);
      cData[k * 4] = Math.sqrt(clamp(hf.colors[gi * 3], 0, 1)) * 255;
      cData[k * 4 + 1] = Math.sqrt(clamp(hf.colors[gi * 3 + 1], 0, 1)) * 255;
      cData[k * 4 + 2] = Math.sqrt(clamp(hf.colors[gi * 3 + 2], 0, 1)) * 255;
      cData[k * 4 + 3] = 255;
    }
  }
  const hTex = new THREE.DataTexture(hData, n, n, THREE.RedFormat, THREE.FloatType);
  hTex.minFilter = hTex.magFilter = THREE.NearestFilter;
  hTex.needsUpdate = true;
  const mTex = new THREE.DataTexture(mData, n, n, THREE.RGBAFormat);
  mTex.minFilter = mTex.magFilter = THREE.LinearFilter;
  mTex.needsUpdate = true;
  const cTex = new THREE.DataTexture(cData, n, n, THREE.RGBAFormat);
  cTex.minFilter = cTex.magFilter = THREE.LinearFilter;
  cTex.needsUpdate = true;
  return { hTex, mTex, cTex, half, res, n };
}

export const groundUniforms = {
  uHeight: { value: null },
  uMask: { value: null },
  uGroundColor: { value: null },
  uGroundHalf: { value: 0 },
  uGroundN: { value: 0 },
  uCenter: { value: new THREE.Vector2() },
  uCam: { value: new THREE.Vector3() },
  uBike: { value: new THREE.Vector3(1e5, 0, 1e5) },
};

export const groundGLSL = /* glsl */ `
  uniform sampler2D uHeight;
  uniform sampler2D uMask;
  uniform sampler2D uGroundColor;
  uniform float uGroundHalf;
  uniform float uGroundN;
  uniform vec3 uCam;
  uniform vec3 uBike;
  uniform float uTime;
  uniform float uWind;
  float gHeight( vec2 p ) {
    vec2 f = ( p + uGroundHalf ) / ( 2.0 * uGroundHalf ) * ( uGroundN - 1.0 );
    f = clamp( f, vec2( 0.0 ), vec2( uGroundN - 1.001 ) );
    ivec2 i = ivec2( floor( f ) );
    vec2 t = fract( f );
    float a = texelFetch( uHeight, i, 0 ).r;
    float b = texelFetch( uHeight, i + ivec2( 1, 0 ), 0 ).r;
    float c = texelFetch( uHeight, i + ivec2( 0, 1 ), 0 ).r;
    float d = texelFetch( uHeight, i + ivec2( 1, 1 ), 0 ).r;
    return mix( mix( a, b, t.x ), mix( c, d, t.x ), t.y );
  }
  vec2 gUv( vec2 p ) { return ( p + uGroundHalf ) / ( 2.0 * uGroundHalf ) * ( uGroundN - 1.0 ) / uGroundN + 0.5 / uGroundN; }
  // integer hash (stable on all GPUs, no sin precision issues)
  float ghash( vec2 p, uint seed ) {
    uvec2 q = uvec2( ivec2( floor( p ) ) + ivec2( 65536 ) );
    uint n = q.x * 1597334677u ^ q.y * 3812015801u ^ seed * 2654435769u;
    n = ( n ^ ( n >> 15u ) ) * 2246822519u;
    n = n ^ ( n >> 13u );
    return float( n & 0x00ffffffu ) / 16777216.0;
  }
`;

// A ring of instances following the camera in world-stable cells
function makeRingGeometry(baseGeo, cells) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = baseGeo.index;
  for (const k in baseGeo.attributes) g.setAttribute(k, baseGeo.attributes[k]);
  const off = new Float32Array(cells * cells * 2);
  let n = 0;
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      off[n++] = i - cells / 2;
      off[n++] = j - cells / 2;
    }
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(off, 2));
  g.instanceCount = cells * cells;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function bladeGeometry() {
  // 4 segments, 9 vertices; x in [-0.5,0.5] (scaled by width), y in [0,1]
  const pos = [];
  const uv = [];
  const segs = 4;
  for (let s = 0; s < segs; s++) {
    const t = s / segs;
    const w = 0.5 * (1 - t * 0.85);
    pos.push(-w, t, 0, w, t, 0);
    uv.push(0, t, 1, t);
  }
  pos.push(0, 1, 0);
  uv.push(0.5, 1);
  const idx = [];
  for (let s = 0; s < segs - 1; s++) {
    const a = s * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const t = (segs - 1) * 2;
  idx.push(t, t + 1, segs * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function crossQuadGeometry() {
  // two crossed quads, y in [0,1], x in [-0.5,0.5]
  const pos = [];
  const uv = [];
  const idx = [];
  for (let q = 0; q < 2; q++) {
    const a = (q * Math.PI) / 2;
    const cx = Math.cos(a) * 0.5,
      cz = Math.sin(a) * 0.5;
    const b = q * 4;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function grassMaterial(ring) {
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.93, metalness: 0 });
  patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, groundUniforms, {
        uTime: vegUniforms.uTime,
        uWind: vegUniforms.uWind,
        uSunDir: vegUniforms.uSunDir,
        uSunColor: vegUniforms.uSunColor,
        uSpacing: { value: ring.spacing },
        uRadius: { value: ring.radius },
        uInner: { value: ring.inner },
        uWidth: { value: ring.width },
        uRingCenter: ring.center,
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${groundGLSL}
          attribute vec2 aCell;
          uniform float uSpacing;
          uniform float uRadius;
          uniform float uInner;
          uniform float uWidth;
          uniform vec2 uRingCenter;
          varying vec3 vGrassCol;
          varying float vGrassT;`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `
          vec2 cellW = floor( uRingCenter / uSpacing ) + aCell;
          float r1 = ghash( cellW, 1u );
          float r2 = ghash( cellW, 2u );
          float r3 = ghash( cellW, 3u );
          vec2 wp = ( cellW + vec2( r1, r2 ) ) * uSpacing;
          vec4 mask = texture2D( uMask, gUv( wp ) );
          float dcam = length( wp - uCam.xz );
          float fade = ( 1.0 - smoothstep( uRadius * 0.8, uRadius, dcam ) ) * ( uInner > 0.0 ? smoothstep( uInner * 0.75, uInner, dcam ) : 1.0 );
          float keep = step( r3, mask.r ) * step( 0.02, mask.r ) * fade;
          float bladeH = ( 0.16 + 0.4 * mask.g * 1.6 * ( 0.55 + 0.9 * r2 ) ) * keep;
          float ang = r1 * 6.2831;
          vec2 facing = vec2( cos( ang ), sin( ang ) );
          vec3 objectNormal = normalize( vec3( -facing.y, 0.9, facing.x ) );
          `
        )
        .replace(
          '#include <begin_vertex>',
          `
          float t = position.y;
          float wdt = position.x * uWidth * ( 0.7 + 0.6 * r3 ) * step( 0.001, keep );
          // wind: travelling gusts
          float gust = sin( dot( wp, vec2( 0.11, 0.07 ) ) - uTime * 1.7 ) * 0.5 + 0.5;
          float windA = ( 0.25 + gust * 0.55 ) * uWind + sin( uTime * 3.1 + r1 * 20.0 ) * 0.08;
          vec2 windDir = normalize( vec2( 0.8, 0.6 ) );
          // bending away from the bicycle
          vec2 away = wp - uBike.xz;
          float bd = length( away );
          float push = ( 1.0 - smoothstep( 0.2, 1.1, bd ) ) * step( abs( gHeight( wp ) - uBike.y ), 1.5 );
          vec2 bendDir = windDir * windA + ( bd > 0.001 ? away / bd : vec2( 0.0 ) ) * push * 1.4;
          bendDir += facing * ( r2 - 0.5 ) * 0.5;
          float bend = t * t;
          vec3 transformed;
          transformed.x = wp.x + facing.x * wdt + bendDir.x * bend * bladeH * 0.55;
          transformed.z = wp.y + facing.y * wdt + bendDir.y * bend * bladeH * 0.55;
          transformed.y = gHeight( wp ) + t * bladeH * ( 1.0 - 0.18 * length( bendDir ) * bend ) - 0.02;
          vec3 gc = texture2D( uGroundColor, gUv( wp ) ).rgb;
          gc *= gc;
          gc = mix( gc, vec3( 0.1, 0.24, 0.045 ), 0.4 );
          vGrassCol = gc * mix( 0.5, 1.2, t ) * ( 0.85 + 0.3 * r3 );
          vGrassCol = mix( vGrassCol, vGrassCol * vec3( 1.12, 1.08, 0.75 ), smoothstep( 0.7, 1.0, t ) * r1 * 0.35 );
          vGrassT = t;
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGrassCol;
          varying float vGrassT;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;`
        )
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrassCol;')
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ''))
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 vdir = normalize( vViewPosition );
            vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
            float back = pow( max( dot( vdir, sunV ), 0.0 ), 4.0 );
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * 0.35 * vGrassT;
          }`
        )
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= mix( 0.45, 1.0, vGrassT );');
    },
    'grass'
  );
  return mat;
}

function flowerMaterial(ring, atlas) {
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8, map: atlas, alphaTest: 0.4 });
  patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, groundUniforms, {
        uTime: vegUniforms.uTime,
        uWind: vegUniforms.uWind,
        uSpacing: { value: ring.spacing },
        uRadius: { value: ring.radius },
        uRingCenter: ring.center,
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${groundGLSL}
          attribute vec2 aCell;
          uniform float uSpacing;
          uniform float uRadius;
          uniform vec2 uRingCenter;
          varying float vFlowerType;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vec2 cellW = floor( uRingCenter / uSpacing ) + aCell;
          float r1 = ghash( cellW, 4u );
          float r2 = ghash( cellW, 5u );
          float r3 = ghash( cellW, 6u );
          vec2 wp = ( cellW + vec2( r1, r2 ) ) * uSpacing;
          vec4 mask = texture2D( uMask, gUv( wp ) );
          float dcam = length( wp - uCam.xz );
          float fade = 1.0 - smoothstep( uRadius * 0.75, uRadius, dcam );
          // nanohana fields use cell 0, wildflowers use cells 1..3
          float isNano = step( r3, mask.a * 0.95 ) * step( 0.02, mask.a );
          float keepW = step( r3, mask.b * 0.45 ) * step( 0.02, mask.b ) * ( 1.0 - isNano );
          float keep = max( isNano, keepW ) * fade;
          float ftype = isNano > 0.5 ? 0.0 : 1.0 + floor( r1 * 2.999 );
          vec2 cell = vec2( mod( ftype, 2.0 ), 1.0 - floor( ftype / 2.0 ) );
          #ifdef USE_MAP
            vMapUv = ( uv + cell ) * 0.5;
          #endif
          vFlowerType = ftype;
          `
        )
        .replace(
          '#include <begin_vertex>',
          `
          float size = isNano > 0.5 ? ( 0.85 + 0.45 * r2 ) : ( 0.32 + 0.22 * r2 );
          size *= keep;
          float ang = r1 * 6.2831;
          float ca = cos( ang ), sa = sin( ang );
          vec3 p = position * size;
          p.xz = mat2( ca, -sa, sa, ca ) * p.xz;
          float sway = sin( uTime * 1.6 + dot( wp, vec2( 0.3, 0.2 ) ) ) * 0.12 * uWind * position.y;
          vec3 transformed = vec3( wp.x + p.x + sway * size, gHeight( wp ) + p.y - 0.03, wp.y + p.z + sway * 0.6 * size );
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFlowerType;')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= mix( 0.5, 1.0, vMapUv.y * 2.0 - floor( vMapUv.y * 2.0 ) );');
    },
    'flowers'
  );
  return mat;
}

export function buildGrass(ground, quality) {
  groundUniforms.uHeight.value = ground.hTex;
  groundUniforms.uMask.value = ground.mTex;
  groundUniforms.uGroundColor.value = ground.cTex;
  groundUniforms.uGroundHalf.value = ground.half;
  groundUniforms.uGroundN.value = ground.n;

  const group = new THREE.Group();
  group.name = 'grass';
  const blade = bladeGeometry();
  const dens = quality.grassDensity;
  const ringDefs = [
    { spacing: 0.2, radius: 16, inner: 0, width: 0.08 },
    { spacing: 0.46, radius: 40, inner: 14, width: 0.17 },
    { spacing: 0.95, radius: 72, inner: 37, width: 0.34 },
  ].slice(0, quality.grassRings);
  const rings = [];
  for (const def of ringDefs) {
    const spacing = def.spacing / Math.sqrt(dens);
    const cells = Math.ceil((def.radius * 2) / spacing);
    const ring = { ...def, spacing, cells, center: { value: new THREE.Vector2() } };
    const mesh = new THREE.Mesh(makeRingGeometry(blade, cells), grassMaterial(ring));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.layers.set(1);
    group.add(mesh);
    ring.mesh = mesh;
    rings.push(ring);
  }
  // wildflowers & nanohana
  const atlas = makeFlowerAtlas();
  const fRing = { spacing: 0.9 / Math.sqrt(dens), radius: quality.flowerDistance * 0.3, center: { value: new THREE.Vector2() } };
  fRing.cells = Math.ceil((fRing.radius * 2) / fRing.spacing);
  const fMesh = new THREE.Mesh(makeRingGeometry(crossQuadGeometry(), fRing.cells), flowerMaterial(fRing, atlas));
  fMesh.frustumCulled = false;
  fMesh.receiveShadow = true;
  fMesh.layers.set(1);
  group.add(fMesh);
  rings.push(fRing);

  const fwd = new THREE.Vector3();
  return {
    group,
    update(camera, bikePos) {
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() > 1e-6) fwd.normalize();
      groundUniforms.uCam.value.copy(camera.position);
      if (bikePos) groundUniforms.uBike.value.copy(bikePos);
      for (const r of rings) {
        // push the ring forward so most instances are in view
        const ahead = r.radius * 0.55;
        r.center.value.set(camera.position.x + fwd.x * ahead, camera.position.z + fwd.z * ahead);
      }
    },
  };
}
