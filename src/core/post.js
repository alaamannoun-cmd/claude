import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final colour grade: warm lift, gentle saturation, vignette, film grain
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.08 },
    uWarm: { value: 0.03 },
    uGrain: { value: 0.025 },
    uFade: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uSaturation;
    uniform float uWarm;
    uniform float uGrain;
    uniform float uFade;
    uniform float uAspect;
    varying vec2 vUv;
    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = dot( c, vec3( 0.299, 0.587, 0.114 ) );
      c = mix( vec3( l ), c, uSaturation );
      // split toning: warm highlights, slightly cool shadows
      c += vec3( uWarm, uWarm * 0.45, -uWarm * 0.6 ) * smoothstep( 0.35, 1.0, l );
      c += vec3( -0.008, 0.0, 0.012 ) * ( 1.0 - smoothstep( 0.0, 0.4, l ) );
      vec2 d = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
      float v = 1.0 - uVignette * smoothstep( 0.35, 1.05, length( d ) * 1.25 );
      c *= v;
      c += ( hash( vUv * 1000.0 + fract( uTime ) * 17.0 ) - 0.5 ) * uGrain;
      c = mix( c, vec3( 0.0 ), uFade );
      gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.16, 0.4, 3.2);
    this.bloom.enabled = quality.bloom;
    this.composer.addPass(this.bloom);
    this.output = new OutputPass();
    this.composer.addPass(this.output);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }
  setQuality(q) {
    this.bloom.enabled = q.bloom;
    this.composer.renderTarget1.samples = q.msaa;
    this.composer.renderTarget2.samples = q.msaa;
  }
  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
  }
  render(dt) {
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
