import * as THREE from 'three';
import { patchMaterial, addFogUniforms } from '../core/fog.js';

// Shared uniforms for all animated vegetation
export const vegUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uNight: { value: 0 },
};

const windChunk = (swayBase, swayAmt, flutter) => /* glsl */ `
  vec3 transformed = vec3( position );
  #ifdef USE_INSTANCING
    vec3 iPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
  #else
    vec3 iPos = vec3( modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2] );
  #endif
  float windPh = iPos.x * 0.071 + iPos.z * 0.053;
  float windH = max( position.y - ${swayBase.toFixed(2)}, 0.0 );
  float gust = 0.65 + 0.35 * sin( uTime * 0.37 + iPos.x * 0.011 );
  float swayA = ( sin( uTime * 1.05 + windPh ) * 0.6 + sin( uTime * 2.2 + windPh * 1.7 ) * 0.25 ) * gust * uWind;
  float swayB = cos( uTime * 0.83 + windPh * 1.3 ) * 0.45 * gust * uWind;
  transformed.x += swayA * windH * windH * ${swayAmt.toFixed(5)};
  transformed.z += swayB * windH * windH * ${swayAmt.toFixed(5)};
  ${flutter > 0 ? `transformed += objectNormal * sin( uTime * 5.3 + dot( position, vec3( 3.1, 1.7, 2.3 ) ) + windPh ) * ${flutter.toFixed(3)} * uWind;` : ''}
`;

// Adds wind sway (and optional flutter / backlit translucency) to a standard material and its depth material.
export function windMaterial(material, { swayBase = 0.5, swayAmt = 0.004, flutter = 0, translucent = 0, key = 'veg' } = {}) {
  patchMaterial(
    material,
    (shader) => {
      shader.uniforms.uTime = vegUniforms.uTime;
      shader.uniforms.uWind = vegUniforms.uWind;
      shader.uniforms.uSunDir = vegUniforms.uSunDir;
      shader.uniforms.uSunColor = vegUniforms.uSunColor;
      shader.uniforms.uNight = vegUniforms.uNight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
        .replace('#include <begin_vertex>', windChunk(swayBase, swayAmt, flutter));
      if (material.alphaTest > 0) {
        // keep alpha-tested foliage from thinning out in the distance (mip-aware alpha boost)
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <alphatest_fragment>',
          `#ifdef USE_MAP
            vec2 texSz = vec2( textureSize( map, 0 ) );
            vec2 mdx = dFdx( vMapUv * texSz ), mdy = dFdy( vMapUv * texSz );
            float mipL = max( 0.0, 0.5 * log2( max( dot( mdx, mdx ), dot( mdy, mdy ) ) ) );
            diffuseColor.a *= 1.0 + mipL * 0.3;
          #endif
          #include <alphatest_fragment>`
        );
      }
      if (material.side === THREE.DoubleSide) {
        // foliage uses crown-shaped normals: don't flip them on back faces
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_begin>',
          THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, '')
        );
      }
      if (translucent > 0) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunColor;')
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
            {
              vec3 vdir = normalize( vViewPosition );
              vec3 sunV = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
              float back = pow( max( dot( vdir, sunV ), 0.0 ), 3.0 );
              float wrap = max( dot( normal, sunV ) * 0.5 + 0.5, 0.0 );
              totalEmissiveRadiance += diffuseColor.rgb * uSunColor * ( back * 0.9 + wrap * 0.12 ) * ${translucent.toFixed(3)};
            }`
          );
      }
    },
    `${key}-${swayBase}-${swayAmt}-${flutter}-${translucent}`
  );
  return material;
}

export function windDepthMaterial(map, opts = {}) {
  const m = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: map || null,
    alphaTest: map ? 0.5 : 0,
    side: THREE.DoubleSide,
  });
  const { swayBase = 0.5, swayAmt = 0.004, key = 'vegd' } = opts;
  m.onBeforeCompile = (shader) => {
    addFogUniforms(shader);
    shader.uniforms.uTime = vegUniforms.uTime;
    shader.uniforms.uWind = vegUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', windChunk(swayBase, swayAmt, 0));
  };
  m.customProgramCacheKey = () => `${key}-${swayBase}-${swayAmt}`;
  return m;
}
