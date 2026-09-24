// Realistic 3D avatars (Three.js) — Microsoft Rocketbox humans (MIT) with ARKit blendshapes.
// Live stages (idle life, gaze, moods, text-driven lip-sync) + cached portrait snapshots.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { AURAS, MODELS } from './catalog.js';
import { normalizeAvatar } from './avatar.js';

const BASE = new URL('../avatars/', import.meta.url).href;
export const modelUrl = id => `${BASE}models/${id}.glb`;
export const thumbUrl = id => `${BASE}thumbs/${id}.webp`;

export const webglOK = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch { return false; }
})();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// software rasterizers (no GPU) get a lighter render budget
let softwareGL = false;
function detectSoftware(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    softwareGL = /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- loading
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map();
function loadGLTF(id) {
  if (!gltfCache.has(id)) {
    gltfCache.set(id, loader.loadAsync(modelUrl(id)).catch(e => { gltfCache.delete(id); throw e; }));
  }
  return gltfCache.get(id);
}
export const preload = id => loadGLTF(id).catch(() => {});

function upgradeMaterial(m) {
  const kind = m.name || 'body';
  const p = new THREE.MeshPhysicalMaterial({
    name: kind, map: m.map, normalMap: m.normalMap, alphaMap: m.alphaMap,
    alphaTest: m.alphaTest, side: m.side, metalness: 0,
  });
  p.normalScale.copy(m.normalScale);
  if (kind === 'skin') {
    Object.assign(p, { roughness: 0.5, specularIntensity: 0.42, sheen: 0.22, sheenRoughness: 0.7 });
    p.sheenColor.set('#ffcbb4');
    p.normalScale.multiplyScalar(0.85);
  } else if (kind === 'hair') {
    Object.assign(p, { roughness: 0.52, specularIntensity: 0.35, sheen: 0.45, sheenRoughness: 0.45, alphaToCoverage: true });
    p.sheenColor.set('#ffffff');
  } else if (kind === 'glasses') {
    Object.assign(p, { roughness: 0.18, specularIntensity: 0.8, alphaToCoverage: true });
  } else {
    Object.assign(p, { roughness: 0.82, specularIntensity: 0.22, sheen: 0.5, sheenRoughness: 0.85 });
    p.sheenColor.set('#ffffff');
  }
  return p;
}

// ---------------------------------------------------------------- glasses
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
function buildGlasses(style, eyeL, eyeR) {
  const g = new THREE.Group();
  g.name = 'glasses';
  const ipd = eyeL.distanceTo(eyeR);
  const metal = style === 'round';
  const frame = metal
    ? new THREE.MeshPhysicalMaterial({ color: '#C9A15B', metalness: 1, roughness: 0.28 })
    : new THREE.MeshPhysicalMaterial({ color: style === 'bold' ? '#141418' : '#3A2A22', roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.12, specularIntensity: 1, depthWrite: false });
  const w = ipd * (metal ? 0.72 : 0.8), h = metal ? w : ipd * (style === 'bold' ? 0.6 : 0.52);
  const thick = metal ? 0.11 : style === 'bold' ? 0.42 : 0.3;
  const fwd = ipd * 0.36;
  const centers = [eyeL, eyeR].map(e => e.clone().add(new THREE.Vector3(0, 0.1, fwd)));
  for (const c of centers) {
    let rim;
    if (metal) rim = new THREE.Mesh(new THREE.TorusGeometry(w / 2, thick, 10, 56), frame);
    else {
      const outer = roundedRect(w + thick * 2, h + thick * 2, h * 0.35);
      outer.holes.push(roundedRect(w, h, h * 0.3));
      rim = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: thick * 0.7, bevelEnabled: false, curveSegments: 10 }), frame);
      rim.position.z = -thick * 0.35;
    }
    const lens = new THREE.Mesh(metal ? new THREE.CircleGeometry(w / 2, 40) : new THREE.ShapeGeometry(roundedRect(w, h, h * 0.3), 10), lensMat);
    const holder = new THREE.Group();
    holder.position.copy(c);
    holder.add(rim, lens);
    g.add(holder);
  }
  // bridge
  const [a, b] = centers;
  const left = a.x > b.x ? a : b, right = a.x > b.x ? b : a;
  const bridge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(left.x - w / 2, left.y + h * 0.12, left.z),
    new THREE.Vector3((left.x + right.x) / 2, left.y + h * 0.3, left.z + 0.2),
    new THREE.Vector3(right.x + w / 2, right.y + h * 0.12, right.z)), 12, metal ? thick : thick * 0.6, 6), frame);
  g.add(bridge);
  // temples (arms) going back towards the ears
  for (const [c, sgn] of [[left, 1], [right, -1]]) {
    const len = ipd * 1.55;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(metal ? 0.14 : thick * 0.5, metal ? 0.14 : thick * 0.8, len), frame);
    arm.position.set(c.x + sgn * (w / 2 + thick * 0.6), c.y + h * 0.18, c.z - len / 2);
    arm.rotation.y = sgn * 0.06;
    g.add(arm);
  }
  return g;
}

// ---------------------------------------------------------------- expression presets (ARKit names)
const EXPRESSIONS = {
  serious: { mouthPressLeft: 0.25, mouthPressRight: 0.25, browDownLeft: 0.08, browDownRight: 0.08 },
  friendly: { mouthSmileLeft: 0.55, mouthSmileRight: 0.55, auLipCornerPuller: 0.45, mouthDimpleLeft: 0.2, mouthDimpleRight: 0.2 },
  smile: { mouthSmileLeft: 1, mouthSmileRight: 1, auLipCornerPuller: 0.9, mouthDimpleLeft: 0.4, mouthDimpleRight: 0.4, cheekSquintLeft: 0.35, cheekSquintRight: 0.35, auCheekRaiser: 0.3 },
};
const MOODS = {
  idle: {},
  listening: { browInnerUp: 0.3, browOuterUpLeft: 0.15, browOuterUpRight: 0.15 },
  thinking: { browInnerUp: 0.6, browDownLeft: 0.35, mouthPressLeft: 0.6, mouthPressRight: 0.5, mouthRollLower: 0.3 },
  happy: { mouthSmileLeft: 1.35, mouthSmileRight: 1.35, auLipCornerPuller: 1.2, mouthDimpleLeft: 0.6, mouthDimpleRight: 0.6, mouthUpperUpLeft: 0.3, mouthUpperUpRight: 0.3, cheekSquintLeft: 0.7, cheekSquintRight: 0.7, auCheekRaiser: 0.6, eyeSquintLeft: 0.35, eyeSquintRight: 0.35, browInnerUp: 0.1 },
  talking: {},
};

// text → visemes (Arabic + Latin)
const VIS = {};
const put = (chars, v) => { for (const ch of chars) VIS[ch] = v; };
put('اأإآىةهحعaAhH', 'aa'); put('eE', 'E'); put('يئيiIyY', 'I'); put('oO', 'O'); put('وؤuUwW', 'U');
put('بمپbBmMpP', 'PP'); put('فڤfFvV', 'FF'); put('ثذظ', 'TH'); put('تدطضtTdD', 'DD');
put('كقغخkKgGcCqQxX', 'KK'); put('جشچjJ', 'CH'); put('سصزsSzZ', 'SS'); put('نلnNlL', 'nn'); put('رrR', 'RR');
const VISEMES = ['sil', 'PP', 'FF', 'TH', 'DD', 'KK', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
const VIS_OPEN = { aa: 0.12, E: 0.07, I: 0.04, O: 0.1, U: 0.05, RR: 0.04, KK: 0.05, DD: 0.04, CH: 0.04, SS: 0.02, nn: 0.03, TH: 0.03, FF: 0, PP: 0, sil: 0 };
// per-viseme strength: open vowels are strong in these rigs, consonants subtle
const VIS_GAIN = { aa: 0.55, O: 0.6, E: 0.6, I: 0.6, U: 0.65, PP: 0.8, FF: 0.7, TH: 0.6, DD: 0.6, KK: 0.55, CH: 0.6, SS: 0.6, nn: 0.6, RR: 0.6, sil: 0 };

// ---------------------------------------------------------------- rig / behaviour
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_Z = new THREE.Vector3(0, 0, 1);

class Rig {
  constructor(root, cfg) {
    this.root = root;
    this.cfg = cfg;
    const B = n => root.getObjectByName(n);
    this.b = {
      spine: B('Bip01_Spine'), spine1: B('Bip01_Spine1'), spine2: B('Bip01_Spine2'), neck: B('Bip01_Neck'), head: B('Bip01_Head'),
      eyeL: B('Bip01_LEye'), eyeR: B('Bip01_REye'), clavL: B('Bip01_L_Clavicle'), clavR: B('Bip01_R_Clavicle'),
      armL: B('Bip01_L_UpperArm'), armR: B('Bip01_R_UpperArm'), foreL: B('Bip01_L_Forearm'), foreR: B('Bip01_R_Forearm'),
    };
    root.updateMatrixWorld(true);
    this.rest = {};
    for (const [k, bone] of Object.entries(this.b)) {
      if (!bone) continue;
      this.rest[k] = { q: bone.quaternion.clone(), w: bone.getWorldQuaternion(new THREE.Quaternion()) };
    }
    // morph meshes
    this.meshes = [];
    root.traverse(o => { if (o.isMesh && o.morphTargetDictionary) this.meshes.push(o); });
    this.names = new Set(this.meshes.flatMap(m => Object.keys(m.morphTargetDictionary)));
    this.w = {}; this.tw = {};
    for (const n of this.names) { this.w[n] = 0; this.tw[n] = 0; }
    // behaviour state
    this.t = Math.random() * 100;
    this.mood = 'idle';
    this.blinkT = 1.5 + Math.random() * 2;
    this.blink = 0;
    this.gaze = new THREE.Vector2(); this.gazeT = new THREE.Vector2(); this.saccadeT = 0.5;
    this.look = new THREE.Vector2(); this.lookT = new THREE.Vector2();
    this.pointer = null;
    this.visQ = []; this.visT = 0; this.vis = 'sil'; this.visAmp = 0;
    this.nod = 0; this.nodT = 0; this.browFlash = 0;
    this.phase = Array.from({ length: 8 }, () => Math.random() * Math.PI * 2);
    this.overrides = null;
    this.pose();
  }

  rotWorld(key, dq) {
    const r = this.rest[key];
    if (!r) return;
    _q2.copy(r.w).invert().multiply(dq).multiply(r.w);
    this.b[key].quaternion.copy(r.q).multiply(_q2);
  }
  worldQ(yaw = 0, pitch = 0, roll = 0) {
    return new THREE.Quaternion().setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
  }

  /** Relaxed arms instead of the A-pose. */
  pose() {
    // character faces +Z; its left side is +X
    const down = 0.62, fwd = 0.1;
    this.armPoseL = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, -down).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, fwd));
    this.armPoseR = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, down).multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, fwd));
    this.rotWorld('armL', this.armPoseL);
    this.rotWorld('armR', this.armPoseR);
  }

  setMood(m) { this.mood = MOODS[m] ? m : 'idle'; if (m === 'happy') this.nodT = 0.6; }

  feed(text) {
    for (const ch of text) {
      const v = VIS[ch] || (/\s|[.,،!?؟:;]/.test(ch) ? 'sil' : null);
      if (!v) continue;
      if (v === 'sil' && this.visQ[this.visQ.length - 1] === 'sil') continue;
      this.visQ.push(v);
    }
    if (this.visQ.length > 60) this.visQ.splice(0, this.visQ.length - 60);
  }

  update(dt) {
    this.t += dt;
    const t = this.t, P = this.phase;
    const tw = this.tw;
    for (const n of this.names) tw[n] = 0;
    const add = obj => { for (const [k, v] of Object.entries(obj)) if (k in tw) tw[k] += v; };

    // expression baseline + mood overlay
    const talking = this.mood === 'talking';
    const base = EXPRESSIONS[this.cfg.expression] || EXPRESSIONS.friendly;
    const baseK = this.mood === 'happy' ? 0 : talking ? 0.5 : this.mood === 'thinking' ? 0.3 : 1;
    for (const [k, v] of Object.entries(base)) if (k in tw) tw[k] += v * baseK;
    add(MOODS[this.mood] || {});

    // subtle micro-expressions
    tw.browInnerUp = (tw.browInnerUp || 0) + Math.max(0, Math.sin(t * 0.37 + P[0])) * 0.06;
    if (this.browFlash > 0) { this.browFlash -= dt; const f = Math.sin(Math.min(1, this.browFlash / 0.5) * Math.PI) * 0.35; tw.browInnerUp += f; tw.browOuterUpLeft = (tw.browOuterUpLeft || 0) + f * 0.6; tw.browOuterUpRight = (tw.browOuterUpRight || 0) + f * 0.6; }

    // lip-sync
    if (talking) {
      this.visT -= dt;
      if (this.visT <= 0) {
        this.vis = this.visQ.length ? this.visQ.shift() : VISEMES[1 + Math.floor(Math.random() * 14)];
        this.visAmp = (VIS_GAIN[this.vis] ?? 0.5) * (0.65 + Math.random() * 0.35);
        this.visT = this.vis === 'sil' ? 0.12 : 0.065 + Math.random() * 0.05;
        if (Math.random() < 0.025) this.browFlash = 0.5;
        if (Math.random() < 0.02) this.nodT = 0.45;
      }
      const key = `viseme_${this.vis}`;
      if (key in tw) tw[key] += this.visAmp;
      tw.jawOpen = (tw.jawOpen || 0) + (VIS_OPEN[this.vis] || 0) * this.visAmp;
    } else if (this.visQ.length) this.visQ.length = 0;

    // blinking
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.16; this.blinkT = 1.8 + Math.random() * 3.8; if (Math.random() < 0.15) this.blinkT = 0.28; }
    let blink = 0;
    if (this.blink > 0) { this.blink -= dt; blink = Math.sin(Math.max(0, this.blink) / 0.16 * Math.PI); }
    const lidDown = Math.max(0, -this.gaze.y) * 0.35;

    // smooth morph weights (blink bypasses smoothing)
    const rate = 1 - Math.exp(-dt * (talking ? 22 : 9));
    for (const n of this.names) this.w[n] += (Math.min(1.6, tw[n]) - this.w[n]) * rate;
    if ('eyeBlinkLeft' in this.w) { this.w.eyeBlinkLeft = Math.min(1, blink + lidDown + this.w.eyeSquintLeft * 0.2); this.w.eyeBlinkRight = Math.min(1, blink + lidDown + this.w.eyeSquintRight * 0.2); }
    if (this.overrides) Object.assign(this.w, this.overrides);
    for (const m of this.meshes) {
      const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
      for (const n in d) inf[d[n]] = this.w[n];
    }

    // gaze: pointer (eye contact) + saccades + mood
    this.saccadeT -= dt;
    if (this.saccadeT <= 0) {
      this.saccadeT = 0.35 + Math.random() * (talking ? 1.2 : 2.4);
      const away = !this.pointer && Math.random() < (talking ? 0.3 : 0.45);
      this.gazeT.set(away ? (Math.random() - 0.5) * 0.5 : (Math.random() - 0.5) * 0.05, away ? (Math.random() - 0.5) * 0.25 : (Math.random() - 0.5) * 0.04);
    }
    const target = new THREE.Vector2();
    if (this.pointer) target.set(this.pointer.x, this.pointer.y);
    if (this.mood === 'thinking') target.set(0.35, 0.3);
    const eyeTarget = target.clone().add(this.gazeT);
    this.gaze.lerp(eyeTarget, 1 - Math.exp(-dt * 18));
    this.lookT.copy(target).multiplyScalar(0.55);
    this.look.lerp(this.lookT, 1 - Math.exp(-dt * 3.2));

    // head & body motion
    const breath = Math.sin(t * 1.45 + P[1]);
    const nx = Math.sin(t * 0.41 + P[2]) * 0.6 + Math.sin(t * 0.93 + P[3]) * 0.4;
    const ny = Math.sin(t * 0.33 + P[4]) * 0.6 + Math.sin(t * 0.77 + P[5]) * 0.4;
    const amp = reduceMotion ? 0.3 : 1;
    if (this.nodT > 0) { this.nodT -= dt; }
    const nod = this.nodT > 0 ? Math.sin((1 - this.nodT / 0.5) * Math.PI * 2) * 0.05 : 0;
    const talkMove = talking ? Math.sin(t * 2.3 + P[6]) * 0.025 : 0;
    const tilt = this.mood === 'thinking' ? 0.07 : this.mood === 'listening' ? -0.05 : 0;
    const yaw = (this.look.x * 0.45 + nx * 0.035 * amp);
    const pitch = (-this.look.y * 0.3 + ny * 0.025 * amp + nod + talkMove);
    this.rotWorld('neck', this.worldQ(yaw * 0.4, pitch * 0.4, tilt * 0.4));
    this.rotWorld('head', this.worldQ(yaw * 0.6, pitch * 0.6, tilt * 0.6 + Math.sin(t * 0.29 + P[7]) * 0.015 * amp));
    this.rotWorld('spine2', this.worldQ(nx * 0.012 * amp, -breath * 0.012 * amp, 0));
    this.rotWorld('spine1', this.worldQ(0, -breath * 0.006 * amp, ny * 0.006 * amp));
    // shoulders rise slightly with breath
    const sh = breath * 0.012 * amp;
    this.rotWorld('clavL', this.worldQ(0, 0, sh));
    this.rotWorld('clavR', this.worldQ(0, 0, -sh));
    // eyes (world space): yaw left/right, pitch up/down
    const eq = this.worldQ(this.gaze.x * 0.42, -this.gaze.y * 0.28, 0);
    this.rotWorld('eyeL', eq);
    this.rotWorld('eyeR', eq);
  }
}

// ---------------------------------------------------------------- lighting
const LIGHT_PRESETS = {
  studio: { key: ['#fff3e6', 2.6], fill: ['#e3ebff', 0.9], rim: 1.7, env: 0.55, exposure: 1.0 },
  warm: { key: ['#ffd7a8', 2.8], fill: ['#ffe6d6', 0.7], rim: 1.9, env: 0.5, exposure: 1.02 },
  cool: { key: ['#f2f7ff', 2.5], fill: ['#d4e6ff', 1.1], rim: 1.4, env: 0.65, exposure: 1.0 },
  dramatic: { key: ['#fff0e0', 3.4], fill: ['#c9d6ff', 0.25], rim: 2.6, env: 0.3, exposure: 0.95 },
};

function setupScene(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const key = new THREE.DirectionalLight('#fff', 2.6); key.position.set(-70, 200, 140);
  const fill = new THREE.DirectionalLight('#fff', 0.9); fill.position.set(110, 150, 90);
  const rim = new THREE.DirectionalLight('#fff', 1.7); rim.position.set(60, 210, -130);
  const rim2 = new THREE.DirectionalLight('#fff', 0.8); rim2.position.set(-90, 190, -110);
  const hemi = new THREE.HemisphereLight('#ffffff', '#8c7b70', 0.35);
  scene.add(key, fill, rim, rim2, hemi);
  return { scene, lights: { key, fill, rim, rim2, hemi } };
}

function applyLights(ctx, renderer, cfg) {
  const L = LIGHT_PRESETS[cfg.light] || LIGHT_PRESETS.studio;
  const [c1, c2] = AURAS[cfg.aura] || AURAS.aurora;
  ctx.lights.key.color.set(L.key[0]); ctx.lights.key.intensity = L.key[1];
  ctx.lights.fill.color.set(L.fill[0]); ctx.lights.fill.intensity = L.fill[1];
  ctx.lights.rim.color.set(c2).lerp(new THREE.Color('#ffffff'), 0.35); ctx.lights.rim.intensity = L.rim;
  ctx.lights.rim2.color.set(c1).lerp(new THREE.Color('#ffffff'), 0.4); ctx.lights.rim2.intensity = L.rim * 0.5;
  ctx.scene.environmentIntensity = L.env;
  renderer.toneMappingExposure = L.exposure;
}

const FRAMING = {
  portrait: { up: 9, dist: 96, fov: 18, cy: 1 },
  bust: { up: 2, dist: 146, fov: 20, cy: 3 },
  close: { up: 10, dist: 72, fov: 18, cy: 0 },
};
function frameCamera(cam, rig, framing) {
  const f = FRAMING[framing] || FRAMING.bust;
  const head = rig.b.head.getWorldPosition(_v);
  const target = new THREE.Vector3(head.x, head.y + f.up, head.z + 4);
  cam.fov = f.fov;
  cam.position.set(target.x, target.y + f.cy, target.z + f.dist);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
}

function makeRenderer(canvas, { alpha = true } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NeutralToneMapping;
  r.setClearColor(0x000000, 0);
  return r;
}

async function buildCharacter(cfg) {
  const gltf = await loadGLTF(cfg.model);
  const root = cloneSkinned(gltf.scene);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = Array.isArray(o.material) ? o.material.map(upgradeMaterial) : upgradeMaterial(o.material);
  });
  const rig = new Rig(root, cfg);
  if (cfg.glasses !== 'none' && rig.b.eyeL && rig.b.eyeR && rig.b.head && !MODELS.find(m => m.id === cfg.model)?.glasses) {
    root.updateMatrixWorld(true);
    const g = buildGlasses(cfg.glasses, rig.b.eyeL.getWorldPosition(new THREE.Vector3()), rig.b.eyeR.getWorldPosition(new THREE.Vector3()));
    rig.b.head.attach(g);
  }
  return { root, rig };
}

function disposeCharacter(root) {
  root?.traverse(o => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) m.dispose();
    if (o.parent?.name === 'glasses' || o.parent?.parent?.name === 'glasses') o.geometry.dispose();
  });
}

// ---------------------------------------------------------------- live stage
const stages = new Set();
const pointer = { x: 0, y: 0, t: 0 };
addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.t = performance.now(); }, { passive: true });
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!document.hidden) for (const s of stages) s.tick(dt, now);
  if (stages.size) requestAnimationFrame(loop); else looping = false;
}
let looping = false;
const ensureLoop = () => { if (!looping) { looping = true; last = performance.now(); requestAnimationFrame(loop); } };
const registry = new WeakMap();

export class AvatarStage {
  constructor(container, cfg, { framing = 'bust', mood = 'idle', interactive = true } = {}) {
    this.container = container;
    this.cfg = normalizeAvatar(cfg);
    this.framing = framing;
    this.interactive = interactive;
    this.mood = mood;
    this.visible = true;
    container.classList.add('stage3d', 'loading');
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    registry.set(container, this);
    this.renderer = makeRenderer(this.canvas);
    if (stages.size === 0) detectSoftware(this.renderer);
    this.ctx = setupScene(this.renderer);
    this.acc = 0;
    this.cam = new THREE.PerspectiveCamera(20, 1, 1, 2000);
    applyLights(this.ctx, this.renderer, this.cfg);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; }, { threshold: 0.01 });
    this.io.observe(container);
    this.resize();
    this.load();
    stages.add(this);
    ensureLoop();
  }

  async load() {
    const token = (this.token = {});
    try {
      const ch = await buildCharacter(this.cfg);
      if (token !== this.token || this.disposed) { disposeCharacter(ch.root); return; }
      if (this.char) { this.ctx.scene.remove(this.char.root); disposeCharacter(this.char.root); }
      this.char = ch;
      ch.rig.setMood(this.mood);
      this.ctx.scene.add(ch.root);
      frameCamera(this.cam, ch.rig, this.framing);
      this.container.classList.remove('loading');
      this.container.classList.add('ready');
    } catch (e) {
      console.warn('avatar load failed', e);
      this.container.classList.add('failed');
    }
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.renderer.setPixelRatio(softwareGL ? 1 : Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.dirty = true;
  }

  setConfig(cfg) {
    const next = normalizeAvatar(cfg);
    const reload = next.model !== this.cfg.model || next.glasses !== this.cfg.glasses;
    this.cfg = next;
    applyLights(this.ctx, this.renderer, next);
    if (this.char) this.char.rig.cfg = next;
    if (reload) { this.container.classList.add('loading'); this.load(); }
  }
  setFraming(f) { this.framing = f; if (this.char) frameCamera(this.cam, this.char.rig, f); }
  setMood(m) { this.mood = m; this.char?.rig.setMood(m); }
  feed(text) { this.char?.rig.feed(text); }
  nod() { if (this.char) this.char.rig.nodT = 0.5; }

  tick(dt, now) {
    if (!this.canvas.isConnected) { this.lost = (this.lost || 0) + dt; if (this.lost > 1) this.dispose(); return; }
    this.lost = 0;
    if (!this.visible || !this.char) return;
    const rig = this.char.rig;
    if (this.interactive && now - pointer.t < 4000) {
      const r = this.canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.3;
      rig.pointer = { x: THREE.MathUtils.clamp((pointer.x - cx) / (innerWidth * 0.5), -1, 1) * 0.8, y: THREE.MathUtils.clamp((cy - pointer.y) / (innerHeight * 0.5), -1, 1) * 0.6 };
    } else rig.pointer = null;
    // frame budget: 60fps while talking/reacting, 30fps when idle, 15fps on software GL
    this.acc += dt;
    const budget = softwareGL ? 1 / 15 : this.mood === 'idle' && !rig.pointer ? 1 / 30 : 0;
    if (this.acc < budget) return;
    rig.update(this.acc);
    this.acc = 0;
    this.renderer.render(this.ctx.scene, this.cam);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    stages.delete(this);
    this.ro.disconnect(); this.io.disconnect();
    if (this.char) disposeCharacter(this.char.root);
    this.ctx.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}

export const stageOf = el => registry.get(el) || (el?.querySelector && registry.get(el.querySelector('.stage3d')));

// ---------------------------------------------------------------- portraits (small avatars)
let snap = null;
const portraitCache = new Map();
const queue = [];
let busy = false;
const PKEY = 'majlis.portrait.v1.';

function snapCtx() {
  if (snap) return snap;
  const canvas = document.createElement('canvas');
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(1);
  snap = { canvas, renderer, ...setupScene(renderer), cam: new THREE.PerspectiveCamera(18, 1, 1, 2000) };
  return snap;
}

async function renderPortrait(cfg, size, mood) {
  const s = snapCtx();
  s.renderer.setSize(size, size, false);
  s.cam.aspect = 1;
  applyLights(s, s.renderer, cfg);
  const ch = await buildCharacter(cfg);
  ch.rig.setMood(mood);
  ch.rig.gazeT.set(0, 0);
  for (let i = 0; i < 40; i++) ch.rig.update(1 / 30);
  ch.rig.blink = 0; ch.rig.blinkT = 5;
  ch.rig.update(0.001);
  s.scene.add(ch.root);
  frameCamera(s.cam, ch.rig, 'portrait');
  s.renderer.render(s.scene, s.cam);
  const url = s.canvas.toDataURL('image/webp', 0.9);
  s.scene.remove(ch.root);
  disposeCharacter(ch.root);
  return url;
}

/** Cached portrait data URL for a config (transparent background). */
export function portrait(cfg, { size = 256, mood = 'idle' } = {}) {
  const c = normalizeAvatar(cfg);
  const key = JSON.stringify([c.model, c.glasses, c.expression, c.light, c.aura, size, mood]);
  if (portraitCache.has(key)) return portraitCache.get(key);
  try {
    const stored = localStorage.getItem(PKEY + key);
    if (stored) { const p = Promise.resolve(stored); portraitCache.set(key, p); return p; }
  } catch { /* storage unavailable */ }
  const p = new Promise((resolve, reject) => { queue.push({ c, size, mood, resolve, reject }); pump(); });
  p.then(url => { try { localStorage.setItem(PKEY + key, url); } catch { /* quota */ } }).catch(() => portraitCache.delete(key));
  portraitCache.set(key, p);
  return p;
}
async function pump() {
  if (busy || !queue.length) return;
  busy = true;
  const job = queue.shift();
  try { job.resolve(await renderPortrait(job.c, job.size, job.mood)); } catch (e) { job.reject(e); }
  busy = false;
  setTimeout(pump, 0);
}
