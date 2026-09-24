import * as THREE from 'three';

// Height-based fog with sun scattering, installed into three.js' fog shader chunks.
// scene.fog is a THREE.Fog where `near` holds the base density and `far` the height falloff.

export const fogUniforms = {
  fogSunDir: { value: new THREE.Vector3(0, 1, 0) },
  fogSunColor: { value: new THREE.Color(1, 0.9, 0.7) },
};

let installed = false;

export function installFog() {
  if (installed) return;
  installed = true;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  varying vec3 vFogWorldPos;

  vec3 applyHeightFog( vec3 col, vec3 worldPos ) {
    vec3 rd = worldPos - cameraPosition;
    float dist = length( rd );
    rd /= max( dist, 1e-4 );
    float density = fogNear;
    float falloff = max( fogFar, 1e-5 );
    float camH = max( cameraPosition.y, 0.0 );
    float k = falloff * rd.y * dist;
    float integral = abs( k ) > 1e-3 ? ( 1.0 - exp( -k ) ) / k : 1.0 - 0.5 * k;
    float amount = density * exp( -camH * falloff ) * dist * integral;
    float fogFactor = 1.0 - exp( -amount );
    float sunAmt = pow( max( dot( rd, fogSunDir ), 0.0 ), 10.0 ) * 0.75;
    vec3 fogCol = mix( fogColor, fogSunColor, sunAmt );
    return mix( col, fogCol, clamp( fogFactor, 0.0, 1.0 ) );
  }
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyHeightFog( gl_FragColor.rgb, vFogWorldPos );
#endif`;

  const baseHook = THREE.Material.prototype.onBeforeCompile;
  THREE.Material.prototype.onBeforeCompile = function (shader, renderer) {
    addFogUniforms(shader);
    if (baseHook) baseHook.call(this, shader, renderer);
  };
}

export function addFogUniforms(shader) {
  shader.uniforms.fogSunDir = fogUniforms.fogSunDir;
  shader.uniforms.fogSunColor = fogUniforms.fogSunColor;
}

// Wrap a custom onBeforeCompile so fog uniforms are still injected
export function patchMaterial(material, fn, key) {
  material.onBeforeCompile = function (shader, renderer) {
    addFogUniforms(shader);
    fn.call(this, shader, renderer);
  };
  if (key) material.customProgramCacheKey = () => key;
  return material;
}
