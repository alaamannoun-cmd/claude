import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { fogUniforms } from '../core/fog.js';
import { lerp, smoothstep, clamp } from '../core/noise.js';
import { makeGlowTexture } from '../core/textures.js';

// ---- JS port of the Preetham sky used by three's Sky shader (no sun disc / clouds) ----
const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const cutoffAngle = 1.6110731556870734;
const steepness = 1.5;
const EE = 1000.0;

function skyRadiance(dir, sunDir, p) {
  const sunE = EE * Math.max(0, 1 - Math.exp(-((cutoffAngle - Math.acos(clamp(sunDir.y, -1, 1))) / steepness)));
  const sunfade = 1 - clamp(1 - Math.exp(sunDir.y / 450000), 0, 1);
  const rayleighCoefficient = p.rayleigh - 1 * (1 - sunfade);
  const betaR = totalRayleigh.map((v) => v * rayleighCoefficient);
  const c = 0.2 * p.turbidity * 10e-18;
  const betaM = MieConst.map((v) => 0.434 * c * v * p.mieCoefficient);
  const zenithAngle = Math.acos(Math.max(0, dir.y));
  const inverse = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inverse;
  const sM = 1.25e3 * inverse;
  const cosTheta = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5));
  const out = [0, 0, 0];
  const horizonMix = clamp(Math.pow(1 - sunDir.y, 5), 0, 1);
  for (let i = 0; i < 3; i++) {
    const Fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    Lin *= lerp(1, Math.pow(sunE * ratio * Fex, 0.5), horizonMix);
    const L0 = 0.1 * Fex;
    out[i] = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
  }
  return out;
}

// Time-of-day presets. elevation/azimuth in degrees (azimuth 0 = east, 90 = south, 180 = west)
export const TIMES = {
  morning: {
    label: 'الصباح',
    elevation: 9,
    azimuth: 70,
    turbidity: 3.2,
    rayleigh: 1.4,
    mie: 0.006,
    mieG: 0.82,
    sun: 3.4,
    sunTint: 0xffd6b0,
    env: 0.85,
    fogDensity: 0.0011,
    exposure: 1.05,
    clouds: 0.3,
  },
  day: {
    label: 'الظهيرة',
    elevation: 52,
    azimuth: 150,
    turbidity: 2.2,
    rayleigh: 1.0,
    mie: 0.004,
    mieG: 0.8,
    sun: 2.7,
    sunTint: 0xfff4e6,
    env: 0.65,
    fogDensity: 0.0006,
    exposure: 0.55,
    clouds: 0.38,
  },
  golden: {
    label: 'الغروب الذهبي',
    elevation: 7.5,
    azimuth: 205,
    turbidity: 4.2,
    rayleigh: 1.8,
    mie: 0.008,
    mieG: 0.86,
    sun: 3.6,
    sunTint: 0xffbe86,
    env: 0.8,
    fogDensity: 0.00095,
    exposure: 1.1,
    clouds: 0.34,
  },
  night: {
    label: 'الليل',
    elevation: -14,
    azimuth: 250,
    turbidity: 2,
    rayleigh: 0.6,
    mie: 0.003,
    mieG: 0.8,
    sun: 0.0,
    sunTint: 0x9fb8ff,
    env: 0.35,
    fogDensity: 0.0009,
    exposure: 1.25,
    clouds: 0.2,
  },
};
export const TIME_ORDER = ['golden', 'night', 'morning', 'day'];

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    this.sky.material.uniforms.cloudScale.value = 0.00018;
    this.sky.material.uniforms.cloudSpeed.value = 0.00003;
    this.sky.material.uniforms.cloudElevation.value = 0.55;
    this.sky.material.uniforms.cloudDensity.value = 0.5;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.sunDir = new THREE.Vector3();
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.5;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // soft fill from the sky dome (IBL does most of the ambient work)
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x5a6b3a, 0.25);
    scene.add(this.hemi);

    // moon light for the night preset
    this.moon = new THREE.DirectionalLight(0x9db4ff, 0);
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    this.envTarget = null;

    this.buildStars();
    this.buildMoon();

    this.current = { ...TIMES.golden };
    this.target = TIMES.golden;
    this.transition = 1;
    this.envDirty = true;
    this.envTimer = 0;
    this.night = 0;
    this.fog = new THREE.Fog(0xcccccc, 0.001, 0.0045);
    scene.fog = this.fog;
    this.apply(true);
  }

  buildStars() {
    const count = 2600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos[i * 3] = Math.cos(a) * r * 9000;
      pos[i * 3 + 1] = y * 9000;
      pos[i * 3 + 2] = Math.sin(a) * r * 9000;
      const b = 0.4 + Math.random() * 0.6;
      const warm = Math.random();
      col[i * 3] = b * (0.85 + warm * 0.15);
      col[i * 3 + 1] = b * 0.9;
      col[i * 3 + 2] = b * (1.0 - warm * 0.1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.scene.add(this.stars);
  }

  buildMoon() {
    const glow = makeGlowTexture();
    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glow, color: 0xdfe8ff, transparent: true, opacity: 0, depthWrite: false, fog: false })
    );
    this.moonSprite.scale.setScalar(900);
    this.moonSprite.renderOrder = -8;
    this.scene.add(this.moonSprite);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(120, 48),
      new THREE.MeshBasicMaterial({ color: 0xf4f1e6, transparent: true, opacity: 0, fog: false, depthWrite: false })
    );
    this.moonDisc = disc;
    disc.renderOrder = -7;
    this.scene.add(disc);
    this.moonDir = new THREE.Vector3(0.35, 0.55, -0.75).normalize();
  }

  setTime(name) {
    if (!TIMES[name]) return;
    this.from = { ...this.current };
    this.target = TIMES[name];
    this.targetName = name;
    this.transition = 0;
  }

  apply(force = false) {
    const p = this.current;
    const el = THREE.MathUtils.degToRad(p.elevation);
    const az = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    const skyDir = this.sunDir.clone();
    for (const s of [this.sky, this.envSky]) {
      const u = s.material.uniforms;
      u.sunPosition.value.copy(skyDir);
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = p.mie;
      u.mieDirectionalG.value = p.mieG;
      u.cloudCoverage.value = p.clouds;
    }
    this.night = smoothstep(-2, -12, p.elevation);
    const tint = new THREE.Color(p.sunTint);
    // sun color: sky transmittance towards the sun, tinted
    const horizonK = smoothstep(2, 25, p.elevation);
    const sunCol = new THREE.Color().copy(tint).lerp(new THREE.Color(0xfff6ea), horizonK * 0.6);
    this.sun.color.copy(sunCol);
    this.sun.intensity = p.sun * smoothstep(-1.5, 4, p.elevation);
    this.moon.intensity = 0.55 * this.night;
    this.moon.color.set(0xa8bdff);
    this.hemi.intensity = lerp(0.3, 0.12, this.night);
    this.hemi.color.set(this.night > 0.5 ? 0x4a5a90 : 0xc4d8ff);

    // fog colors from the analytic sky
    const skyParams = { turbidity: p.turbidity, rayleigh: p.rayleigh, mieCoefficient: p.mie, mieDirectionalG: p.mieG };
    const sd = { x: this.sunDir.x, y: this.sunDir.y, z: this.sunDir.z };
    const avg = [0, 0, 0];
    let cnt = 0;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const d = { x: Math.cos(a) * 0.996, y: 0.08, z: Math.sin(a) * 0.996 };
      const dot = d.x * sd.x + d.z * sd.z;
      if (dot > 0.3) continue;
      const c = skyRadiance(d, sd, skyParams);
      avg[0] += c[0];
      avg[1] += c[1];
      avg[2] += c[2];
      cnt++;
    }
    const fogCol = new THREE.Color(avg[0] / cnt, avg[1] / cnt, avg[2] / cnt);
    // haze colour towards the sun, sampled 25 degrees off the sun and capped so it never blows out
    const sunAz = Math.atan2(sd.z, sd.x) + 0.44;
    const towards = skyRadiance({ x: Math.cos(sunAz) * 0.995, y: 0.1, z: Math.sin(sunAz) * 0.995 }, sd, skyParams);
    const sunFog = new THREE.Color(towards[0], towards[1], towards[2]);
    const lumF = fogCol.r * 0.3 + fogCol.g * 0.59 + fogCol.b * 0.11;
    const lumS = sunFog.r * 0.3 + sunFog.g * 0.59 + sunFog.b * 0.11;
    if (lumS > lumF * 1.45) sunFog.multiplyScalar((lumF * 1.45) / lumS);
    // night: deep blue haze
    const nightFog = new THREE.Color(0.012, 0.018, 0.04);
    fogCol.lerp(nightFog, this.night);
    sunFog.lerp(nightFog, this.night);
    this.fog.color.copy(fogCol);
    fogUniforms.fogSunColor.value.copy(sunFog);
    fogUniforms.fogSunDir.value.copy(this.sunDir);
    this.fog.near = p.fogDensity;
    this.fog.far = 0.0042;
    this.fogColor = fogCol;

    this.starMat.opacity = this.night;
    this.moonSprite.material.opacity = 0.55 * this.night;
    this.moonDisc.material.opacity = this.night;
    this.renderer.toneMappingExposure = p.exposure;
    if (force) this.updateEnvironment();
    else this.envDirty = true;
  }

  updateEnvironment() {
    if (this.envTarget) this.envTarget.dispose();
    // at night the sky is nearly black: lift the environment a bit so shading stays readable
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = this.current.env;
    this.envDirty = false;
  }

  update(dt, focus, camera) {
    if (this.transition < 1) {
      this.transition = Math.min(1, this.transition + dt / 3.0);
      const t = smoothstep(0, 1, this.transition);
      const a = this.from,
        b = this.target;
      for (const k of ['elevation', 'turbidity', 'rayleigh', 'mie', 'mieG', 'sun', 'env', 'fogDensity', 'exposure', 'clouds']) {
        this.current[k] = lerp(a[k], b[k], t);
      }
      // azimuth: take the short way around
      let da = b.azimuth - a.azimuth;
      this.current.azimuth = a.azimuth + da * t;
      const ca = new THREE.Color(a.sunTint),
        cb = new THREE.Color(b.sunTint);
      this.current.sunTint = ca.lerp(cb, t).getHex();
      this.apply();
    }
    this.envTimer += dt;
    if (this.envDirty && (this.envTimer > 0.25 || this.transition >= 1)) {
      this.envTimer = 0;
      this.updateEnvironment();
    }
    this.sky.material.uniforms.time.value += dt;

    // shadow frustum follows the focus point, snapped to texels to avoid shimmering
    const s = this.sun.shadow;
    const cam = s.camera;
    const lightDir = this.night > 0.5 ? this.moonDir : this.sunDir;
    const ext = this.shadowExtent || 70;
    const texel = (ext * 2) / (s.mapSize.x || 2048);
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 400, focus.y + Math.max(this.sunDir.y, 0.05) * 400, fz + this.sunDir.z * 400);
    this.moon.target.position.set(fx, focus.y, fz);
    this.moon.position.set(fx + lightDir.x * 400, focus.y + lightDir.y * 400, fz + lightDir.z * 400);

    if (camera) {
      const md = this.moonDir;
      this.moonSprite.position.copy(camera.position).addScaledVector(md, 8000);
      this.moonDisc.position.copy(camera.position).addScaledVector(md, 8000);
      this.moonDisc.lookAt(camera.position);
      this.stars.position.copy(camera.position);
    }
  }

  configureShadows(size, extent) {
    const s = this.sun.shadow;
    s.mapSize.set(size, size);
    this.shadowExtent = extent;
    s.camera.left = -extent;
    s.camera.right = extent;
    s.camera.top = extent;
    s.camera.bottom = -extent;
    s.camera.near = 50;
    s.camera.far = 900;
    s.camera.updateProjectionMatrix();
    if (s.map) {
      s.map.dispose();
      s.map = null;
    }
  }
}
