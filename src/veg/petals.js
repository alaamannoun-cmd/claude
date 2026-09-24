import * as THREE from 'three';
import { patchMaterial } from '../core/fog.js';
import { vegUniforms } from './common.js';
import { groundUniforms, groundGLSL } from './grass.js';
import { makePetalTexture } from '../core/textures.js';
import { WORLD_HALF, GRID_N } from '../world/layout.js';

// Falling sakura petals around the camera, denser under cherry trees. Fully GPU animated.
export function buildPetals(hf, quality) {
  const N = GRID_N;
  const data = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) data[i] = Math.min(255, hf.petal[i] * 255);
  const petalTex = new THREE.DataTexture(data, N, N, THREE.RedFormat);
  petalTex.minFilter = petalTex.magFilter = THREE.LinearFilter;
  petalTex.needsUpdate = true;

  const count = quality.petals;
  const base = new THREE.BufferGeometry();
  // slightly cupped petal: 4 triangles around a center vertex
  base.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0.12, -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)
  );
  base.setAttribute('uv', new THREE.Float32BufferAttribute([0.5, 0.5, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  base.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  for (const k in base.attributes) geo.setAttribute(k, base.attributes[k]);
  const seeds = new Float32Array(count * 4);
  const seeds2 = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) {
    seeds[i] = Math.random();
    seeds2[i] = Math.random();
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(seeds2, 4));
  geo.instanceCount = count;

  const uniforms = {
    uPetalTex: { value: petalTex },
    uWorldHalf: { value: WORLD_HALF },
    uWindV: { value: new THREE.Vector2(0.55, 0.25) },
  };
  const mat = new THREE.MeshStandardMaterial({
    map: makePetalTexture(),
    side: THREE.DoubleSide,
    alphaTest: 0.5,
    roughness: 0.6,
    color: 0xffffff,
  });
  patchMaterial(
    mat,
    (shader) => {
      Object.assign(shader.uniforms, groundUniforms, uniforms, {
        uTime: vegUniforms.uTime,
        uWind: vegUniforms.uWind,
        uSunDir: vegUniforms.uSunDir,
        uSunColor: vegUniforms.uSunColor,
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${groundGLSL}
          attribute vec4 aSeed;
          attribute vec4 aSeed2;
          uniform sampler2D uPetalTex;
          uniform float uWorldHalf;
          uniform vec2 uWindV;
          mat3 rotAxis( vec3 a, float ang ) {
            float c = cos( ang ), s = sin( ang ), t = 1.0 - c;
            return mat3( t*a.x*a.x + c, t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
                         t*a.x*a.y - s*a.z, t*a.y*a.y + c, t*a.y*a.z + s*a.x,
                         t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c );
          }`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `
          vec3 box = vec3( 40.0, 11.0, 40.0 );
          float fall = 0.28 + aSeed.w * 0.45;
          vec2 drift = uWindV * uWind * uTime * ( 0.7 + aSeed2.x * 0.6 );
          drift += vec2( sin( uTime * 0.9 + aSeed.x * 40.0 ), cos( uTime * 0.7 + aSeed.z * 30.0 ) ) * 0.5;
          vec2 pxz = ( aSeed.xz - 0.5 ) * box.xz + drift;
          vec2 rel = mod( pxz - uCam.xz + box.xz * 0.5, box.xz ) - box.xz * 0.5;
          vec2 wxz = uCam.xz + rel;
          float h = mod( aSeed.y * box.y - fall * uTime, box.y );
          vec2 puv = ( wxz + uWorldHalf ) / ( 2.0 * uWorldHalf );
          float dens = texture2D( uPetalTex, puv ).r;
          float show = step( aSeed2.y, dens * 1.6 + 0.015 );
          show *= smoothstep( 0.0, 0.4, h ) * ( 1.0 - smoothstep( 16.0, 20.0, length( rel ) ) );
          vec3 axis = normalize( aSeed2.yzw - 0.5 + vec3( 0.0, 0.3, 0.0 ) );
          mat3 R = rotAxis( axis, uTime * ( 1.5 + aSeed2.z * 3.0 ) + aSeed.x * 6.28 );
          R = R * rotAxis( vec3( 0.0, 1.0, 0.0 ), sin( uTime * 2.0 + aSeed.y * 9.0 ) * 1.2 );
          vec3 objectNormal = R * normal;
          `
        )
        .replace(
          '#include <begin_vertex>',
          `
          float size = ( 0.032 + aSeed2.w * 0.02 ) * show;
          vec3 transformed = R * ( position * size ) + vec3( wxz.x, gHeight( wxz ) + h + 0.05, wxz.y );
          `
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;')
        .replace(
          '#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, '')
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 vdir = normalize( vViewPosition );
            vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
            totalEmissiveRadiance += diffuseColor.rgb * uSunColor * ( 0.25 + pow( max( dot( vdir, sunV ), 0.0 ), 3.0 ) * 0.9 );
          }`
        );
    },
    'petals'
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.layers.set(1);
  mesh.name = 'petals';
  return { mesh };
}
