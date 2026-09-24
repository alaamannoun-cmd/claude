import * as THREE from 'three';
import { patchMaterial } from '../core/fog.js';
import { Simplex, smoothstep, lerp } from '../core/noise.js';
import { WORLD_HALF, FUJI } from './layout.js';

// Low resolution landscape beyond the detailed terrain, plus Mount Fuji.
export function buildDistant(hf) {
  const group = new THREE.Group();
  group.name = 'distant';
  const S = new Simplex(77);

  const EXT = 9000;
  const STEP = 75;
  const n = Math.round((EXT * 2) / STEP) + 1;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const forest = new THREE.Color(0x2c4629);
  const forest2 = new THREE.Color(0x3b5530);
  const rock = new THREE.Color(0x6d6a63);
  const fujiDirX = FUJI.x,
    fujiDirZ = FUJI.z;
  const fujiLen = Math.hypot(fujiDirX, fujiDirZ);
  const tmp = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -EXT + i * STEP,
        z = -EXT + j * STEP;
      const k = j * n + i;
      const r = Math.hypot(x, z);
      let h = hf.baseHeight(x, z);
      // big mountain ranges far away, low towards Fuji
      const along = (x * fujiDirX + z * fujiDirZ) / (r * fujiLen + 1e-6);
      const towardFuji = smoothstep(0.86, 0.985, along);
      const ridge = S.ridged(x * 0.00028 + 5, z * 0.00028 - 2, 5);
      const mount = ridge * 900 * smoothstep(1100, 3200, r) * (1 - 0.88 * towardFuji);
      h += mount;
      h = lerp(h, 60 + S.fbm(x * 0.0006, z * 0.0006, 3) * 40, towardFuji * smoothstep(1400, 3000, r));
      const inside = Math.abs(x) < WORLD_HALF - 1 && Math.abs(z) < WORLD_HALF - 1;
      if (inside) h -= 80;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      tmp.copy(forest).lerp(forest2, S.noise(x * 0.002, z * 0.002) * 0.5 + 0.5);
      tmp.lerp(rock, smoothstep(500, 900, h) * 0.7);
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
    }
  }
  const idx = [];
  for (let j = 0; j < n - 1; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const far = new THREE.Mesh(geo, mat);
  far.receiveShadow = false;
  group.add(far);

  group.add(buildFuji());
  return group;
}

function buildFuji() {
  const S = new Simplex(313);
  const H = 1500;
  const R = 4600;
  const radial = 110;
  const ang = 220;
  const pos = [];
  const col = [];
  const snow = new THREE.Color(0xf4f6fa);
  const snowShade = new THREE.Color(0xdfe6f0);
  const rockC = new THREE.Color(0x5b5552);
  const lower = new THREE.Color(0x3a4e36);
  const c = new THREE.Color();
  const profile = (t) => {
    // concave volcano profile with a small crater
    let h = Math.pow(1 - t, 1.9);
    if (t < 0.045) h -= (1 - t / 0.045) * 0.022;
    return h;
  };
  for (let j = 0; j <= radial; j++) {
    const t = Math.pow(j / radial, 1.35);
    for (let i = 0; i <= ang; i++) {
      const a = (i / ang) * Math.PI * 2;
      const r = t * R;
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      // erosion gullies that deepen downslope
      const gully = Math.abs(S.noise(a * 9, t * 3.0)) * 0.6 + Math.abs(S.noise(a * 23 + 4, t * 6)) * 0.4;
      const gAmt = smoothstep(0.04, 0.3, t) * (1 - smoothstep(0.6, 1.0, t));
      let h = profile(t) * H - gully * gAmt * 42 + S.fbm(x * 0.001, z * 0.001, 3) * 30 * t;
      pos.push(x, h - 40, z);
      // snow line lower inside gullies
      const snowLine = 0.5 + (gully - 0.5) * 0.18 + S.noise(a * 5, 0.3) * 0.05;
      const hh = h / H;
      const snowAmt = smoothstep(snowLine - 0.03, snowLine + 0.03, hh);
      c.copy(lower).lerp(rockC, smoothstep(0.12, 0.35, hh));
      c.lerp(gully > 0.55 ? snowShade : snow, snowAmt);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  const row = ang + 1;
  for (let j = 0; j < radial; j++)
    for (let i = 0; i < ang; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  // Fuji reads a little clearer through the haze than the physical fog would allow
  patchMaterial(
    mat,
    (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          vec3 fogged = applyHeightFog( gl_FragColor.rgb, vFogWorldPos );
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogged, 0.72 );
        #endif`
      );
    },
    'fuji'
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(FUJI.x, 0, FUJI.z);
  mesh.name = 'fuji';
  return mesh;
}
