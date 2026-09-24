import * as THREE from 'three';
import { patchMaterial } from '../core/fog.js';
import { smoothstep, clamp } from '../core/noise.js';
import { ROAD_HALF_WIDTH as HW } from './layout.js';

// Road ribbon following the loop, with procedural asphalt / stone / gravel surfaces.
export function buildRoad(hf, planner, tex) {
  const road = hf.road;
  const n = road.count;
  const S = planner.sec;
  const inRange = (i, a, b) => i >= a && i <= b;
  const surfaceAt = (i) => {
    // 0 asphalt, 1 stone slabs, 2 fine gravel
    const stone = smoothstep(S.toriiStart - 70, S.toriiStart - 55, i) * (1 - smoothstep(S.toriiEnd + 55, S.toriiEnd + 70, i));
    const gravel = smoothstep(S.bambooStart - 25, S.bambooStart - 5, i) * (1 - smoothstep(S.bambooEnd + 5, S.bambooEnd + 25, i));
    return { stone, gravel };
  };

  // Mark samples covered by bridge decks
  const skip = new Uint8Array(n);
  for (const b of hf.bridges) {
    for (let i = Math.floor(b.center - b.halfLen) + 1; i <= Math.ceil(b.center + b.halfLen) - 1; i++) skip[road.wrap(i)] = 1;
  }

  const cols = [
    [-HW - 0.55, -0.12],
    [-HW, 0],
    [0, 0.012], // subtle crown
    [HW, 0],
    [HW + 0.55, -0.12],
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const surf = [];
  const index = [];
  let vStart = -1;
  let v = 0;
  let arc = 0;
  for (let ii = 0; ii <= n; ii++) {
    const i = ii % n;
    if (skip[i]) {
      vStart = -1;
      arc += road.spacing;
      continue;
    }
    const x = road.x[i],
      z = road.z[i];
    const nx = -road.tz[i],
      nz = road.tx[i];
    const h = hf.roadProfile[i] + 0.035;
    const { stone, gravel } = surfaceAt(i);
    const petal = hf.petal ? clamp(hf.sampleGrid(hf.petal, x, z) * 1.2, 0, 1) : 0;
    for (const [off, dy] of cols) {
      positions.push(x + nx * off, h + dy, z + nz * off);
      normals.push(0, 1, 0);
      uvs.push(off / HW, arc);
      surf.push(stone, gravel, petal);
    }
    if (vStart >= 0) {
      for (let c = 0; c < cols.length - 1; c++) {
        const a = vStart + c,
          b = vStart + c + 1,
          cc = v + c,
          d = v + c + 1;
        index.push(a, b, cc, b, d, cc);
      }
    }
    vStart = v;
    v += cols.length;
    arc += road.spacing;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 3));
  geo.setIndex(index);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  patchMaterial(
    mat,
    (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec3 aSurf;
          varying vec3 vSurf;
          varying vec2 vRoadUv;
          varying vec3 vRoadWorld;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vSurf = aSurf;
          vRoadUv = uv;
          vRoadWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
          #ifdef USE_NORMALMAP
            vNormalMapUv = vRoadWorld.xz * 0.35;
          #endif`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vSurf;
          varying vec2 vRoadUv;
          varying vec3 vRoadWorld;
          float rh( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
          float vnoise( vec2 p ) {
            vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
            return mix( mix( rh( i ), rh( i + vec2( 1, 0 ) ), f.x ), mix( rh( i + vec2( 0, 1 ) ), rh( i + vec2( 1, 1 ) ), f.x ), f.y );
          }
          float fbm2( vec2 p ) { return vnoise( p ) * 0.5 + vnoise( p * 2.1 ) * 0.3 + vnoise( p * 4.3 ) * 0.2; }
          `
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float u = vRoadUv.x;
          float au = abs( u );
          vec2 wp = vRoadWorld.xz;
          // --- asphalt ---
          float grain = rh( floor( wp * 40.0 ) );
          float blotch = fbm2( wp * 0.35 );
          vec3 asphalt = vec3( 0.075, 0.075, 0.078 ) * ( 0.82 + 0.3 * grain + 0.35 * ( blotch - 0.5 ) );
          // wheel tracks polished lighter
          float track = exp( -pow( ( au - 0.45 ) * 6.0, 2.0 ) );
          asphalt *= 1.0 + track * 0.18;
          // repair patches
          float patchN = fbm2( wp * 0.08 + 17.0 );
          asphalt = mix( asphalt, vec3( 0.05, 0.05, 0.055 ), smoothstep( 0.66, 0.7, patchN ) * 0.8 );
          // white edge lines (worn)
          float line = smoothstep( 0.86, 0.875, au ) * ( 1.0 - smoothstep( 0.925, 0.94, au ) );
          line *= smoothstep( 0.25, 0.55, fbm2( wp * 1.7 ) + 0.25 );
          asphalt = mix( asphalt, vec3( 0.62, 0.62, 0.6 ), line );
          // --- stone slabs ---
          float row = floor( vRoadUv.y / 0.9 );
          float sx = ( u * 2.7 + 0.5 * mod( row, 2.0 ) ) / 0.75;
          vec2 cellId = vec2( floor( sx ), row );
          vec2 cf = vec2( fract( sx ), fract( vRoadUv.y / 0.9 ) );
          float grout = smoothstep( 0.0, 0.05, cf.x ) * smoothstep( 1.0, 0.95, cf.x ) * smoothstep( 0.0, 0.05, cf.y ) * smoothstep( 1.0, 0.95, cf.y );
          vec3 stoneC = vec3( 0.28, 0.27, 0.25 ) * ( 0.8 + 0.4 * rh( cellId ) ) * ( 0.85 + 0.3 * fbm2( wp * 3.0 ) );
          stoneC = mix( vec3( 0.12, 0.13, 0.1 ), stoneC, grout );
          // --- gravel ---
          float peb = rh( floor( wp * 22.0 ) );
          vec3 gravelC = vec3( 0.36, 0.32, 0.26 ) * ( 0.7 + 0.5 * peb ) * ( 0.85 + 0.3 * fbm2( wp * 0.9 ) );
          vec3 surfC = mix( asphalt, stoneC, vSurf.x );
          surfC = mix( surfC, gravelC, vSurf.y );
          // shoulders (outside the paved width): dirt
          float shoulder = smoothstep( 1.0, 1.06, au );
          vec3 dirtC = vec3( 0.25, 0.2, 0.14 ) * ( 0.8 + 0.4 * fbm2( wp * 1.3 ) );
          surfC = mix( surfC, dirtC, shoulder );
          // fallen sakura petals, piling up near the edges
          float pet = vSurf.z;
          float petN = rh( floor( wp * 11.0 ) + 3.0 );
          float petalMask = step( 1.0 - pet * ( 0.25 + 0.6 * smoothstep( 0.4, 1.1, au ) ), petN );
          surfC = mix( surfC, vec3( 0.93, 0.7, 0.76 ), petalMask * 0.92 );
          diffuseColor.rgb = surfC;
          `
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix( 0.92, 0.75, line );`
        );
    },
    'road'
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}
