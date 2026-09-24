import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { fogUniforms } from '../core/fog.js';
import { makeWaterNormal } from '../core/textures.js';
import { WORLD_HALF, GRID_STEP, GRID_N, WATER_LEVEL } from './layout.js';
import { smoothstep } from '../core/noise.js';

const N = GRID_N;

// Water data texture over the whole terrain: R = depth, GB = flow direction, A = floating petals
function buildWaterData(hf) {
  const S = 512;
  const data = new Uint8Array(S * S * 4);
  const scale = (WORLD_HALF * 2) / S;
  const river = hf.river;
  for (let j = 0; j < S; j++) {
    const z = -WORLD_HALF + (j + 0.5) * scale;
    for (let i = 0; i < S; i++) {
      const x = -WORLD_HALF + (i + 0.5) * scale;
      const k = (j * S + i) * 4;
      const h = hf.terrainHeight(x, z);
      const depth = Math.max(0, WATER_LEVEL - h);
      data[k] = Math.min(255, (depth / 4) * 255);
      let fx = 0,
        fz = 0;
      const cell = hf.nearestCell(x, z);
      const rd = hf.riverD[cell];
      if (rd < 40) {
        const t = river.tangentAt(hf.riverI[cell]);
        const s = hf.riverI[cell] * river.spacing;
        const hw = hf.riverHalfWidth(s);
        // faster in the middle, slower near banks and near the lake
        const speed = (1 - smoothstep(0.2, 1.2, rd / hw)) * (1 - smoothstep(river.length - 240, river.length - 60, s));
        fx = t.x * (0.25 + 0.75 * speed);
        fz = t.z * (0.25 + 0.75 * speed);
        if (hf.lakeSD(x, z) < 0) {
          fx *= 0.2;
          fz *= 0.2;
        }
      }
      data[k + 1] = (fx * 0.5 + 0.5) * 255;
      data[k + 2] = (fz * 0.5 + 0.5) * 255;
      const pet = hf.petal ? hf.sampleGrid(hf.petal, x, z) : 0;
      data[k + 3] = Math.min(255, pet * 255 * 1.4);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const WaterShader = {
  name: 'SakuraWater',
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      color: { value: null },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      tNormal: { value: null },
      tData: { value: null },
      time: { value: 0 },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color(1, 1, 1) },
      skyColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
      reflectStrength: { value: 1 },
      worldHalf: { value: WORLD_HALF },
      night: { value: 0 },
    },
  ]),
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tData;
    uniform float time;
    uniform vec3 sunDir;
    uniform vec3 sunColor;
    uniform vec3 skyColor;
    uniform float reflectStrength;
    uniform float worldHalf;
    uniform float night;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <fog_pars_fragment>

    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }

    vec3 sampleNormal( vec2 uv ) {
      return texture2D( tNormal, uv ).xyz * 2.0 - 1.0;
    }

    void main() {
      vec2 duv = ( vWorld.xz + worldHalf ) / ( 2.0 * worldHalf );
      vec4 data = texture2D( tData, duv );
      float depth = data.r * 4.0;
      vec2 flow = data.gb * 2.0 - 1.0;

      // two-phase flow mapping so ripples travel downstream without stretching forever
      float ph0 = fract( time * 0.12 );
      float ph1 = fract( time * 0.12 + 0.5 );
      float w0 = 1.0 - abs( 1.0 - 2.0 * ph0 );
      vec2 base = vWorld.xz * 0.11;
      vec2 fl = flow * 1.8;
      vec3 n0 = sampleNormal( base - fl * ph0 );
      vec3 n1 = sampleNormal( base - fl * ph1 + 0.37 );
      vec3 nFlow = mix( n1, n0, w0 );
      // slow wind ripples everywhere + fine detail
      vec3 nWind = sampleNormal( vWorld.xz * 0.035 + vec2( time * 0.006, time * 0.004 ) );
      vec3 nFine = sampleNormal( vWorld.xz * 0.45 + vec2( -time * 0.03, time * 0.02 ) );
      vec3 nt = normalize( nFlow * 0.9 + nWind * 0.8 + nFine * 0.35 );
      vec3 N = normalize( vec3( nt.x * 0.22, 1.0, nt.y * 0.22 ) );

      vec3 V = normalize( cameraPosition - vWorld );
      float dist = length( cameraPosition - vWorld );

      // reflection with distortion
      vec2 ruv = vUv.xy / vUv.w;
      ruv += N.xz * 0.035 / ( 1.0 + dist * 0.01 );
      vec3 refl = mix( skyColor, texture2D( tDiffuse, ruv ).rgb, reflectStrength );

      float cosV = clamp( dot( N, V ), 0.0, 1.0 );
      float fresnel = 0.02 + 0.98 * pow( 1.0 - cosV, 5.0 );
      fresnel = clamp( fresnel * 1.15 + 0.08, 0.0, 1.0 );

      // body color: clear shallows, deep jade green
      vec3 shallow = vec3( 0.10, 0.20, 0.17 );
      vec3 deep = vec3( 0.012, 0.045, 0.05 );
      vec3 body = mix( shallow, deep, smoothstep( 0.2, 3.2, depth ) );
      body *= mix( 1.0, 0.25, night );
      body += skyColor * 0.04;

      vec3 col = mix( body, refl, fresnel );

      // sun glints
      vec3 H = normalize( sunDir + V );
      float spec = pow( max( dot( N, H ), 0.0 ), 280.0 ) * 6.0;
      spec += pow( max( dot( N, H ), 0.0 ), 40.0 ) * 0.25;
      col += sunColor * spec * step( 0.0, sunDir.y );

      // floating sakura petals (hanaikada) drifting downstream
      float pet = data.a;
      if ( pet > 0.01 ) {
        vec2 pp = vWorld.xz * 3.2 - flow * time * 1.2;
        vec2 cell = floor( pp );
        vec2 f = fract( pp ) - 0.5;
        float rnd = hash( cell );
        vec2 off = vec2( hash( cell + 3.1 ), hash( cell + 7.7 ) ) - 0.5;
        float d = length( ( f - off * 0.6 ) * vec2( 1.0, 1.6 ) );
        float petal = ( 1.0 - smoothstep( 0.08, 0.13, d ) ) * step( 1.0 - pet * 0.9, rnd );
        col = mix( col, vec3( 0.95, 0.72, 0.78 ) * mix( 1.0, 0.25, night ), petal * 0.9 );
      }

      // shoreline foam
      float foamN = texture2D( tNormal, vWorld.xz * 0.3 + time * 0.02 ).b;
      float foam = ( 1.0 - smoothstep( 0.0, 0.18, depth + ( foamN - 0.5 ) * 0.1 ) ) * 0.5;
      col = mix( col, vec3( 0.85, 0.88, 0.86 ) * mix( 1.0, 0.2, night ), foam );

      float alpha = mix( smoothstep( 0.0, 1.2, depth ) * 0.82 + 0.1, 1.0, fresnel );
      alpha = max( alpha, foam );
      gl_FragColor = vec4( col, alpha );
      #include <fog_fragment>
    }`,
};

export function buildWater(hf, quality) {
  const data = buildWaterData(hf);
  // bounding box of all water cells
  let minX = 1e9,
    maxX = -1e9,
    minZ = 1e9,
    maxZ = -1e9;
  for (let iz = 0; iz < N; iz += 2)
    for (let ix = 0; ix < N; ix += 2) {
      if (hf.H[iz * N + ix] < WATER_LEVEL + 0.1) {
        const x = -WORLD_HALF + ix * GRID_STEP,
          z = -WORLD_HALF + iz * GRID_STEP;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
    }
  minX -= 10;
  maxX += 10;
  minZ -= 10;
  maxZ += 10;
  const w = maxX - minX,
    h = maxZ - minZ;
  const geo = new THREE.PlaneGeometry(w, h, 1, 1);
  const size = new THREE.Vector2();
  const scale = quality.reflectionScale;
  const width = Math.max(256, Math.round(window.innerWidth * Math.min(window.devicePixelRatio, 1.5) * scale));
  const height = Math.max(256, Math.round(window.innerHeight * Math.min(window.devicePixelRatio, 1.5) * scale));
  const water = new Reflector(geo, {
    textureWidth: width,
    textureHeight: height,
    clipBias: 0.02,
    multisample: 0,
    shader: WaterShader,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set((minX + maxX) / 2, WATER_LEVEL, (minZ + maxZ) / 2);
  water.material.transparent = true;
  water.material.fog = true;
  water.material.depthWrite = true;
  const u = water.material.uniforms;
  u.tNormal.value = makeWaterNormal();
  u.tData.value = data;
  u.fogSunDir = fogUniforms.fogSunDir;
  u.fogSunColor = fogUniforms.fogSunColor;
  water.renderOrder = 1;
  water.frustumCulled = true;
  water.enabled = quality.reflections;
  const origBefore = water.onBeforeRender;
  water.onBeforeRender = function (renderer, scene, camera) {
    if (!water.enabled) return;
    origBefore.call(this, renderer, scene, camera);
  };
  return {
    mesh: water,
    uniforms: u,
    resize(wPx, hPx, q) {
      const rt = water.getRenderTarget();
      rt.setSize(Math.max(256, Math.round(wPx * q.reflectionScale)), Math.max(256, Math.round(hPx * q.reflectionScale)));
    },
    setQuality(q) {
      water.enabled = q.reflections;
      u.reflectStrength.value = q.reflections ? 1 : 0;
    },
  };
}
