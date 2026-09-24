import * as THREE from 'three';
import { installFog } from './core/fog.js';
import { QUALITY, QUALITY_ORDER, detectQuality } from './core/quality.js';
import { makeTerrainTextures } from './core/textures.js';
import { Post } from './core/post.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { CameraRig } from './core/camera.js';
import { Heightfield } from './world/heightfield.js';
import { Planner } from './world/planner.js';
import { computeGroundColors, buildTerrain } from './world/terrain.js';
import { buildRoad } from './world/road.js';
import { SkySystem, TIMES, TIME_ORDER } from './world/sky.js';
import { buildWater } from './world/water.js';
import { buildDistant } from './world/distant.js';
import { buildTrees } from './veg/trees.js';
import { vegUniforms } from './veg/common.js';
import { buildGroundData, buildGrass } from './veg/grass.js';
import { buildBamboo } from './veg/bamboo.js';
import { buildPetals } from './veg/petals.js';
import { buildCarpets } from './veg/carpet.js';
import { buildStructures } from './structures/index.js';
import { Bicycle } from './bike/bicycle.js';
import { Rider } from './bike/rider.js';
import { BikeController } from './bike/controller.js';
import { Hud } from './ui/hud.js';
import { buildWildlife } from './world/wildlife.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

async function start() {
  installFog();
  const titleEl = $('title');
  titleEl.classList.add('loading');
  const loadFill = $('load-fill');
  const loadText = $('load-text');
  const loadBox = $('load');
  const progress = (p, text) => {
    loadFill.style.width = `${Math.round(p * 100)}%`;
    loadBox.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (text) loadText.textContent = text;
  };

  let qName = params.get('q') || detectQuality();
  try {
    const saved = localStorage.getItem('sakura-michi-quality');
    if (!params.get('q') && saved && QUALITY[saved]) qName = saved;
  } catch (e) {
    /* storage unavailable */
  }
  let q = QUALITY[qName] || QUALITY.medium;
  const qSelect = $('quality-select');
  qSelect.value = q.name;

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const tm = params.get('tm') || 'aces';
  renderer.toneMapping = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping }[tm] || THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  $('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.08, 24000);
  camera.layers.enable(1);

  // ---------- world ----------
  progress(0.02, 'تشكيل الوادي والنهر…');
  await tick();
  const hf = new Heightfield();
  await hf.generate((p) => progress(0.02 + p * 0.33));
  const planner = new Planner(hf);
  planner.plan();
  progress(0.4, 'تلوين الأرض…');
  await tick();
  computeGroundColors(hf, planner);
  const terrainTex = makeTerrainTextures();
  scene.add(buildTerrain(hf, terrainTex).group);
  scene.add(buildRoad(hf, planner, terrainTex));
  progress(0.5, 'رسم السماء والماء…');
  await tick();
  const sky = new SkySystem(renderer, scene);
  sky.configureShadows(q.shadowSize, q.shadowExtent);
  const water = buildWater(hf, q);
  scene.add(water.mesh);
  scene.add(buildDistant(hf));
  progress(0.6, 'زراعة أشجار الساكورا…');
  await tick();
  const trees = buildTrees(planner, q);
  scene.add(trees.group);
  progress(0.72, 'نموّ العشب والأزهار…');
  await tick();
  const ground = buildGroundData(hf, planner);
  const grass = buildGrass(ground, q);
  scene.add(grass.group);
  scene.add(buildBamboo(planner, q).group);
  scene.add(buildPetals(hf, q).mesh);
  scene.add(buildCarpets(hf, planner));
  progress(0.84, 'بناء البوابات والجسور…');
  await tick();
  const structures = buildStructures(hf, planner, scene);
  scene.add(structures.group);
  const wildlife = buildWildlife(hf);
  scene.add(wildlife.group);

  // ---------- bicycle & rider ----------
  progress(0.92, 'تجهيز الدرّاجة…');
  await tick();
  const bicycle = new Bicycle();
  scene.add(bicycle.root);
  const rider = new Rider(bicycle);
  const bike = new BikeController(hf, planner.colliders);
  const S = planner.sec;
  bike.surfaceKind = (i) => {
    const inside = (a, b) => i > a && i < b;
    if (inside(S.bambooStart - 15, S.bambooEnd + 15)) return 'gravel';
    if (inside(S.toriiStart - 60, S.toriiEnd + 60)) return 'stone';
    return 'road';
  };

  const post = new Post(renderer, scene, camera, q);
  post.setSize(window.innerWidth, window.innerHeight);
  const rig = new CameraRig(camera, hf);
  const input = new Input(renderer.domElement);
  const audio = new AudioEngine();
  const hud = new Hud(hf, planner);
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
  input.bindTouch(document);

  // ---------- state ----------
  const game = {
    started: false,
    paused: false,
    timeIndex: 0,
    waveTimer: 0,
    bell: 0,
    photo: false,
  };
  const focus = new THREE.Vector3();
  const headWorld = new THREE.Vector3();
  const tmpM = new THREE.Matrix4();
  const groundLocal = new THREE.Vector3();

  const setTime = (i) => {
    game.timeIndex = (i + TIME_ORDER.length) % TIME_ORDER.length;
    const name = TIME_ORDER[game.timeIndex];
    sky.setTime(name);
    $('chip-time').textContent = TIMES[name].label;
    return TIMES[name].label;
  };
  setTime(0);
  sky.transition = 0.999;

  const applyQuality = (name) => {
    q = QUALITY[name];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setQuality(q);
    post.setSize(window.innerWidth, window.innerHeight);
    sky.configureShadows(q.shadowSize, q.shadowExtent);
    water.setQuality(q);
    water.resize(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio(), q);
    $('pause-q').textContent = q.label;
    qSelect.value = name;
    try {
      localStorage.setItem('sakura-michi-quality', name);
    } catch (e) {
      /* ignore */
    }
  };
  qSelect.addEventListener('change', () => applyQuality(qSelect.value));
  $('pause-q').textContent = q.label;

  // ---------- actions ----------
  input.on('orbit', (dx, dy) => rig.orbit(dx, dy));
  input.on('zoom', (d) => rig.zoom(d));
  input.on('bell', () => {
    if (!game.started) return;
    audio.bell();
    game.bell = 1;
  });
  input.on('wave', () => {
    if (game.started) game.waveTimer = 2.4;
  });
  input.on('camera', () => {
    const m = rig.cycle();
    $('chip-cam').textContent = m.label;
    hud.toast(`الكاميرا: ${m.label}`);
  });
  input.on('time', () => hud.toast(`الوقت: ${setTime(game.timeIndex + 1)}`));
  input.on('autopilot', () => {
    bike.autopilot = !bike.autopilot;
    $('chip-auto').textContent = bike.autopilot ? 'قيادة تلقائية' : 'قيادة يدوية';
    hud.toast(bike.autopilot ? 'القيادة التلقائية تعمل: استمتع بالمناظر' : 'عدت إلى القيادة اليدوية');
  });
  input.on('mute', () => {
    audio.setMuted(!audio.muted);
    $('chip-sound').textContent = audio.muted ? 'الصوت: مكتوم' : 'الصوت: يعمل';
  });
  input.on('music', () => {
    audio.musicOn = !audio.musicOn;
    $('pause-music').textContent = audio.musicOn ? 'تعمل' : 'متوقفة';
  });
  input.on('hud', () => hud.toggle());
  input.on('quality', () => {
    const i = QUALITY_ORDER.indexOf(q.name);
    applyQuality(QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length]);
    hud.toast(`الجودة: ${q.label}`);
  });
  input.on('photo', () => {
    if (!game.started) return;
    game.photo = !game.photo;
    rig.photo = game.photo;
    rig.orbitIdle = 0;
    $('hud').classList.toggle('hidden-ui', game.photo);
    hud.toast(game.photo ? 'وضع التصوير: اسحب للدوران، واضغط P للعودة' : 'عدت إلى الرحلة');
  });
  const setPaused = (p) => {
    if (!game.started) return;
    game.paused = p;
    $('pause').hidden = !p;
    if (p) $('resume').focus();
  };
  input.on('pause', () => setPaused(!game.paused));
  $('resume').addEventListener('click', () => setPaused(false));
  document.querySelectorAll('#pause [data-action]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      input.emit(el.dataset.action);
      if (el.dataset.action === 'photo') setPaused(false);
    })
  );

  const startBtn = $('start');
  startBtn.addEventListener('click', () => {
    audio.start();
    game.started = true;
    input.enabled = true;
    titleEl.classList.add('gone');
    hud.show();
    rig.mode = 0;
    rig.initialized = false;
    hud.toast(document.body.classList.contains('touch') ? 'اضغط «دوس» للانطلاق واسحب للتوجيه' : 'اضغط W للانطلاق، وA / D للتوجيه');
    setTimeout(() => (titleEl.hidden = true), 1000);
    renderer.domElement.focus();
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    post.setSize(window.innerWidth, window.innerHeight);
    water.resize(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio(), q);
  });

  // ---------- frame ----------
  let fpsAcc = 0,
    fpsFrames = 0,
    lowFps = 0;
  let titleOrbit = 0;
  const fixedView = { on: false };
  function frame(dt) {
    const inp = input.state(dt);
    const riding = game.started && !game.paused && !game.photo;
    if (riding) bike.update(dt, inp);
    else if (!game.started) bike.update(dt, { throttle: 0, brake: 0, steer: 0, sprint: false });
    for (const e of bike.events) if (e.type === 'bump') audio.bump(e.strength);
    bike.events.length = 0;

    // bicycle transform
    bicycle.root.position.set(bike.pos.x, bike.yVis, bike.pos.z);
    bicycle.root.rotation.set(bike.pitch, bike.yaw, 0, 'YXZ');
    game.bell = Math.max(0, game.bell - dt * 3);
    if (game.waveTimer > 0) game.waveTimer -= dt;
    const pedalPitch = rider.parts.legs.map((l) => l.pedalPitch || 0);
    bicycle.pose({
      steer: bike.steer,
      rearSpin: bike.rearSpin,
      frontSpin: bike.frontSpin,
      crank: bike.crank,
      pedalPitch: [pedalPitch[0], pedalPitch[1]],
      lean: bike.lean,
      night: sky.night,
      bell: game.bell,
    });
    bicycle.root.updateMatrixWorld(true);
    // ground point for a planted foot, in the bike's lean frame
    let groundFoot = null;
    if (bike.footDown > 0.01) {
      const fwd = bike.forward();
      const leftX = Math.cos(bike.yaw),
        leftZ = -Math.sin(bike.yaw);
      const gx = bike.pos.x + leftX * 0.4 - fwd.x * 0.05;
      const gz = bike.pos.z + leftZ * 0.4 - fwd.z * 0.05;
      groundLocal.set(gx, hf.groundHeight(gx, gz), gz);
      tmpM.copy(bicycle.lean.matrixWorld).invert();
      groundFoot = groundLocal.applyMatrix4(tmpM);
    }
    rider.update({
      dt,
      speed: bike.speed,
      crank: bike.crank,
      pedaling: bike.pedaling,
      standing: bike.standing,
      lean: bike.lean,
      steer: bike.steer,
      brake: bike.brake,
      footDown: bike.footDown,
      bodyRoll: bike.footDown * -0.1,
      velocity: bike.velocity,
      groundLocalFoot: groundFoot,
      wave: game.waveTimer > 0 ? 1 : 0,
      bell: game.bell,
      lookAt: game.photo ? 0.5 : null,
    });

    // camera
    rider.parts.head.getWorldPosition(headWorld);
    if (fixedView.on) {
      // test hook: camera placed manually
    } else if (!game.started) {
      // slow cinematic orbit behind the title screen
      titleOrbit += dt * 0.06;
      const a = bike.yaw + 2.2 + Math.sin(titleOrbit) * 0.5;
      camera.position.set(bike.pos.x + Math.sin(a) * 5.4, bike.yVis + 1.45, bike.pos.z + Math.cos(a) * 5.4);
      camera.lookAt(bike.pos.x, bike.yVis + 1.0, bike.pos.z);
      // frame the rider on the left, leaving room for the title text on the right
      if (window.innerWidth > 720) camera.rotateY(-0.3 * Math.min(1, camera.aspect / 1.6));
      else camera.rotateX(0.12);
      if (camera.fov !== 50) {
        camera.fov = 50;
        camera.updateProjectionMatrix();
      }
    } else {
      rig.update(dt, bike, headWorld);
    }

    // world systems
    focus.set(bike.pos.x, bike.yVis, bike.pos.z);
    sky.update(dt, fixedView.on ? fixedView.focus : focus, camera);
    trees.update(camera, dt);
    grass.update(camera, focus);
    structures.update(focus, sky.night);
    wildlife.update(dt, focus, sky.night);
    vegUniforms.uTime.value += dt;
    vegUniforms.uWind.value = 1 + 0.25 * Math.sin(vegUniforms.uTime.value * 0.13);
    vegUniforms.uSunDir.value.copy(sky.night > 0.5 ? sky.moonDir : sky.sunDir);
    vegUniforms.uSunColor.value.copy(sky.sun.color).multiplyScalar(Math.max(sky.sun.intensity / 3, sky.night * 0.15));
    vegUniforms.uNight.value = sky.night;
    const wu = water.uniforms;
    wu.time.value += dt;
    wu.sunDir.value.copy(sky.night > 0.5 ? sky.moonDir : sky.sunDir);
    wu.sunColor.value.copy(sky.sun.color).multiplyScalar(sky.night > 0.5 ? 0.25 : sky.sun.intensity / 3);
    wu.skyColor.value.copy(sky.fogColor);
    wu.night.value = sky.night;

    if (game.started) {
      hud.update(dt, bike, TIMES[TIME_ORDER[game.timeIndex]].label);
      audio.update(dt, {
        speed: game.paused ? 0 : bike.speed,
        surface: bike.surface,
        pedaling: bike.pedaling,
        waterDist: hf.waterDistance(bike.pos.x, bike.pos.z),
        night: sky.night,
      });
    }
    if (!window.__norender) post.render(dt);

    // adaptive quality: step down if the frame rate stays low
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc > 2) {
      const fps = fpsFrames / fpsAcc;
      fpsAcc = 0;
      fpsFrames = 0;
      if (game.started && !params.has('noloop') && fps < 28 && q.name !== 'low') {
        lowFps++;
        if (lowFps >= 3) {
          const i = QUALITY_ORDER.indexOf(q.name);
          applyQuality(QUALITY_ORDER[i - 1]);
          hud.toast(`خفّضنا الجودة إلى «${q.label}» لتبقى الحركة سلسة`);
          lowFps = 0;
        }
      } else lowFps = 0;
    }
  }

  progress(1, 'الوادي جاهز');
  titleEl.classList.remove('loading');
  loadBox.classList.add('done');
  startBtn.disabled = false;
  startBtn.focus();

  // hooks used by the automated screenshot tests
  window.__game = {
    renderer,
    scene,
    camera,
    hf,
    planner,
    sky,
    water,
    bike,
    rider,
    bicycle,
    rig,
    game,
    input,
    hud,
    frame,
    start: () => startBtn.click(),
    setTime: (name) => {
      setTime(TIME_ORDER.indexOf(name));
      sky.transition = 0.999;
    },
    view(x, y, z, tx, ty, tz) {
      fixedView.on = true;
      fixedView.focus = new THREE.Vector3(tx, ty, tz);
      camera.position.set(x, y, z);
      camera.lookAt(tx, ty, tz);
    },
    viewRoad(i, height = 1.8, back = 0, ahead = 40, side = 0) {
      const r = hf.road;
      const p = r.pointAt(i - back);
      const t = r.tangentAt(i);
      const qq = r.pointAt(i + ahead);
      const x = p.x - t.z * side,
        z = p.z + t.x * side;
      const y = hf.groundHeight(x, z) + height;
      this.view(x, y, z, qq.x, hf.groundHeight(qq.x, qq.z) + height * 0.6, qq.z);
    },
    freeCamera() {
      fixedView.on = false;
    },
    // teleport the bike to a road index
    place(i, speed = 0) {
      const r = hf.road;
      const p = r.pointAt(i);
      const t = r.tangentAt(i);
      bike.pos.set(p.x + t.z * 1.1, 0, p.z - t.x * 1.1);
      bike.yaw = Math.atan2(t.x, t.z);
      bike.pos.y = hf.groundHeight(bike.pos.x, bike.pos.z);
      bike.yVis = bike.pos.y;
      bike.speed = speed;
      bike.roadIndex = i;
      bike.footDown = speed > 0.5 ? 0 : 1;
      rig.initialized = false;
    },
  };

  const clock = new THREE.Timer();
  const loop = (t) => {
    clock.update(t);
    const dt = Math.min(clock.getDelta(), 0.05);
    frame(dt);
    requestAnimationFrame(loop);
  };
  if (!params.has('noloop')) requestAnimationFrame(loop);
  window.__ready = true;
}

start().catch((e) => {
  console.error(e);
  const t = document.getElementById('load-text');
  if (t) t.textContent = 'تعذّر تشغيل اللعبة: ' + e.message;
});
