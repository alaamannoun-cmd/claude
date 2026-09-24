// Avatar config (shared by browser and server). Rendering lives in avatar3d.js (Three.js).
// Shape: { model, glasses, aura, light, expression }
import { MODELS, AURAS, GLASSES, LIGHTS, EXPRESSIONS } from './catalog.js';

export const DEFAULT_AVATAR = { model: 'Business_Male_02', glasses: 'none', aura: 'aurora', light: 'studio', expression: 'friendly' };

const has = (list, v) => list.some(x => x.id === v);
const hashStr = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Maps an older 2D (SVG) avatar config to the closest realistic character. */
function legacyModel(a) {
  if (a.headwear === 'hijab') return a.outfitColor && /1E293B|000/i.test(a.outfitColor) ? 'Female_Adult_10' : 'Female_Adult_06';
  if (a.headwear === 'ghutra' || a.headwear === 'shemagh') return 'Male_Adult_19';
  if (a.kind === 'robot') return 'Business_Male_05';
  if (a.outfit === 'lab') return /long|bun|ponytail/.test(a.hair) ? 'Medical_Female_02' : 'Medical_Male_03';
  if (a.outfit === 'sport') return /long|bun|ponytail/.test(a.hair) ? 'Sports_Female_02' : 'Sports_Male_04';
  const female = /long|bun|ponytail/.test(a.hair || '') || (a.blush && a.facial === 'none');
  const pool = MODELS.filter(m => m.g === (female ? 'f' : 'm') && !m.tags.includes('traditional'));
  return pool[hashStr(JSON.stringify(a)) % pool.length].id;
}

export function normalizeAvatar(a) {
  const o = { ...DEFAULT_AVATAR };
  if (!a || typeof a !== 'object') return o;
  o.model = MODELS.some(m => m.id === a.model) ? a.model : legacyModel(a);
  const g = a.glasses === 'square' ? 'rect' : a.glasses === 'visor' ? 'none' : a.glasses;
  if (has(GLASSES, g)) o.glasses = g;
  if (a.aura in AURAS) o.aura = a.aura;
  if (has(LIGHTS, a.light)) o.light = a.light;
  if (has(EXPRESSIONS, a.expression)) o.expression = a.expression;
  return o;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export function randomAvatar(base = {}) {
  const pool = base.g ? MODELS.filter(m => m.g === base.g) : MODELS;
  return normalizeAvatar({
    model: pick(pool).id,
    glasses: Math.random() < 0.25 ? pick(GLASSES.slice(1)).id : 'none',
    aura: pick(Object.keys(AURAS)),
    light: Math.random() < 0.7 ? 'studio' : pick(LIGHTS).id,
    expression: pick(['friendly', 'friendly', 'smile', 'serious']),
  });
}

export const modelInfo = id => MODELS.find(m => m.id === id) || MODELS[0];
