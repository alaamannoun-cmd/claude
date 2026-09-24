// Procedural SVG avatars with live moods (idle / talking / thinking / happy).
// Pure string generation: works in the browser and in Node (server-side validation).
import { AVATAR, AURAS } from './catalog.js';

export const DEFAULT_AVATAR = {
  kind: 'human', skin: '#E8B48A', hair: 'short', hairColor: '#1F1B24', eyes: 'round', brows: 'soft',
  mouth: 'smile', facial: 'none', glasses: 'none', headwear: 'none', headwearColor: '#7C5CFF',
  accessory: 'none', outfit: 'tee', outfitColor: '#6D5DFC', aura: 'aurora', blush: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
const ENUMS = {
  kind: AVATAR.kinds, hair: AVATAR.hairs, eyes: AVATAR.eyes, brows: AVATAR.brows, mouth: AVATAR.mouths,
  facial: AVATAR.facials, glasses: AVATAR.glasses, headwear: AVATAR.headwears, accessory: AVATAR.accessories, outfit: AVATAR.outfits,
};

export function normalizeAvatar(a) {
  const o = { ...DEFAULT_AVATAR };
  if (!a || typeof a !== 'object') return o;
  for (const [k, list] of Object.entries(ENUMS)) if (list.includes(a[k])) o[k] = a[k];
  for (const k of ['hairColor', 'headwearColor', 'outfitColor', 'skin']) if (HEX.test(a[k] || '')) o[k] = a[k];
  const skins = o.kind === 'robot' ? AVATAR.robotSkins : AVATAR.skins;
  if (Number.isInteger(a.skin)) o.skin = skins[Math.max(0, Math.min(skins.length - 1, a.skin))];
  if (a.aura in AURAS) o.aura = a.aura;
  o.blush = !!a.blush;
  return o;
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export function randomAvatar(base = {}) {
  const kind = Math.random() < 0.12 ? 'robot' : 'human';
  const r = Math.random();
  const headwear = kind === 'robot' ? 'none' : r < 0.18 ? 'hijab' : r < 0.26 ? 'ghutra' : r < 0.3 ? 'shemagh' : r < 0.38 ? pick(['cap', 'beanie', 'gradcap']) : 'none';
  return normalizeAvatar({
    ...base,
    kind,
    skin: pick(kind === 'robot' ? AVATAR.robotSkins : AVATAR.skins),
    hair: pick(AVATAR.hairs), hairColor: pick(AVATAR.hairColors.slice(0, 8)),
    eyes: pick(AVATAR.eyes), brows: pick(AVATAR.brows), mouth: pick(AVATAR.mouths),
    facial: headwear === 'hijab' ? 'none' : Math.random() < 0.4 ? pick(AVATAR.facials) : 'none',
    glasses: Math.random() < 0.3 ? pick(AVATAR.glasses.slice(1)) : 'none',
    headwear, headwearColor: headwear === 'ghutra' ? '#F8FAFC' : pick(AVATAR.headwearColors),
    accessory: Math.random() < 0.3 ? pick(AVATAR.accessories.slice(1)) : 'none',
    outfit: pick(AVATAR.outfits), outfitColor: pick(AVATAR.outfitColors),
    aura: pick(Object.keys(AURAS)), blush: Math.random() < 0.3,
  });
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const ch = v => Math.round((t - v) * p + v);
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---------- parts ----------
const INK = '#1B1B2B';
const LIP = '#7A2E3A';

const EYES = {
  round: `<ellipse cx="84" cy="92" rx="5" ry="6" fill="${INK}"/><ellipse cx="116" cy="92" rx="5" ry="6" fill="${INK}"/><circle cx="86" cy="89.5" r="1.7" fill="#fff"/><circle cx="118" cy="89.5" r="1.7" fill="#fff"/>`,
  smile: `<path d="M78 94q6-8 12 0M110 94q6-8 12 0" stroke="${INK}" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  sharp: `<path d="M77 92q7-7 14 0q-7 5-14 0zM109 92q7-7 14 0q-7 5-14 0z" fill="${INK}"/><circle cx="86" cy="90.5" r="1.3" fill="#fff"/><circle cx="118" cy="90.5" r="1.3" fill="#fff"/>`,
  sleepy: `<path d="M77 90h14M109 90h14" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><path d="M79 90q5 7 10 0zM111 90q5 7 10 0z" fill="${INK}"/>`,
};
const HAPPY_EYES = `<path d="M78 94q6-8 12 0M110 94q6-8 12 0" stroke="${INK}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;

const BROWS = {
  soft: c => `<g class="av-brows" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"><path d="M77 80q7-4 14-1"/><path class="br" d="M109 79q7-3 14 1"/></g>`,
  bold: c => `<g class="av-brows" stroke="${c}" stroke-width="4.6" fill="none" stroke-linecap="round"><path d="M76 80l15-2"/><path class="br" d="M109 78l15 2"/></g>`,
  arched: c => `<g class="av-brows" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"><path d="M77 82q6-9 14-4"/><path class="br" d="M109 78q8-5 14 4"/></g>`,
};

const MOUTHS = {
  smile: `<path d="M89 115q11 9 22 0" stroke="${LIP}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  grin: `<path d="M87 113q13 15 26 0z" fill="${LIP}"/><path d="M89.5 114.2q10.5 3.6 21 0l-1 2.4q-9.5 3-19 0z" fill="#fff"/>`,
  calm: `<path d="M92 117q8 3 16 0" stroke="${LIP}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  smirk: `<path d="M90 117q10 3 20-4" stroke="${LIP}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
};

const FACIAL = {
  none: () => '',
  stubble: c => `<path d="M66 100c2 22 16 34 34 34s32-12 34-34c-4 12-12 18-20 19-4-4-24-4-28 0-8-1-16-7-20-19z" fill="${c}" opacity=".28"/>`,
  beard: c => `<path d="M64 96c0 26 16 42 36 42s36-16 36-42c-4 14-12 21-21 22-5-5-25-5-30 0-9-1-17-8-21-22z" fill="${c}"/><path d="M86 111q7-7 14-3q7-4 14 3q-7 3-14 1q-7 2-14-1z" fill="${c}"/>`,
  mustache: c => `<path d="M86 111q7-7 14-3q7-4 14 3q-7 3-14 1q-7 2-14-1z" fill="${c}"/>`,
  goatee: c => `<path d="M86 111q7-7 14-3q7-4 14 3q-7 3-14 1q-7 2-14-1z" fill="${c}"/><path d="M92 124q8 12 16 0q-8 4-16 0z" fill="${c}"/>`,
};

const HAIR_BACK = {
  long: c => `<path d="M56 92C50 52 76 30 100 30s50 22 44 62c2 28 6 52 12 76H44c6-24 10-48 12-76z" fill="${c}"/>`,
  bun: (c, d) => `<circle cx="100" cy="31" r="16" fill="${c}"/><path d="M88 41q12 4 24 0" stroke="${d}" stroke-width="3" fill="none"/>`,
  ponytail: c => `<path d="M128 58c30 2 40 44 30 82-3 10-10 10-12 2 4-28-2-52-22-66z" fill="${c}"/>`,
  afro: (c, d) => `<circle cx="100" cy="70" r="54" fill="${c}"/><g fill="${d}" opacity=".25"><circle cx="70" cy="40" r="6"/><circle cx="132" cy="44" r="5"/><circle cx="56" cy="80" r="5"/><circle cx="146" cy="84" r="6"/></g>`,
};

const PULLED = c => `<path d="M62 90C60 58 78 40 100 40s40 18 38 50c-6-18-20-28-38-28S68 72 62 90z" fill="${c}"/>`;
const HAIR_FRONT = {
  short: c => `<path d="M60 92C55 58 74 34 100 34s45 24 40 58l-4-2c-1-12-4-20-8-26-14 8-40 8-56 0-4 6-7 14-8 26z" fill="${c}"/>`,
  side: (c, d) => `<path d="M60 94C54 56 76 32 104 34s44 26 36 60l-4-2c0-14-4-24-12-32-14 6-34 4-48-2-8 8-12 20-12 34z" fill="${c}"/><path d="M96 37q-6 10-18 20" stroke="${d}" stroke-width="2" fill="none" opacity=".5"/>`,
  curly: (c, d) => `<g fill="${c}">${[[66, 80, 11], [70, 62, 14], [84, 48, 15], [102, 42, 16], [120, 48, 15], [132, 62, 14], [136, 80, 11], [61, 95, 8], [139, 95, 8], [88, 60, 11], [110, 59, 11], [99, 56, 10]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g><g fill="${d}" opacity=".35"><circle cx="80" cy="54" r="4"/><circle cx="110" cy="46" r="4"/><circle cx="128" cy="66" r="3.5"/></g>`,
  wavy: c => `<path d="M60 94C54 54 78 32 102 34s48 24 38 62c-4-10-7-18-12-24-4 6-12 6-16-2-6 8-16 8-20 0-6 8-14 8-18 0-6 8-10 16-12 24z" fill="${c}"/>`,
  long: c => `<path d="M60 96C54 58 76 34 100 34s46 24 40 62h-4c-2-18-8-30-18-36-10 10-30 14-52 12-2 8-3 16-2 24z" fill="${c}"/>`,
  bun: PULLED,
  ponytail: PULLED,
  afro: c => `<path d="M62 90C58 58 78 38 100 38s42 20 38 52c-6-18-20-28-38-28S68 72 62 90z" fill="${c}"/>`,
  buzz: c => `<path d="M62 86C60 58 78 40 100 40s40 18 38 46c-6-16-20-26-38-26S68 70 62 86z" fill="${c}" opacity=".85"/>`,
  bald: () => `<ellipse cx="86" cy="56" rx="11" ry="5" fill="#fff" opacity=".2" transform="rotate(-18 86 56)"/>`,
};

const HEADWEAR_BACK = {
  hijab: (f, d) => `<path d="M50 98C46 50 72 28 100 28s54 22 50 70c0 26 2 44 22 72H28c20-28 22-46 22-72z" fill="${f}"/><path d="M58 152q42 18 84 0" stroke="${d}" stroke-width="3" fill="none" opacity=".55"/>`,
  ghutra: (f, d) => `<path d="M54 86C50 50 76 28 100 28s50 22 46 58l12 66c3 16-6 24-18 26l-12-60c-2-8-54-8-56 0l-12 60c-12-2-21-10-18-26z" fill="${f}" stroke="${d}" stroke-width="1.5"/>`,
};
HEADWEAR_BACK.shemagh = HEADWEAR_BACK.ghutra;

const HEADWEAR_FRONT = {
  hijab: (f, d) => `<path d="M60 92C58 56 78 38 100 38s42 18 40 54c-5-20-20-32-40-32S65 72 60 92z" fill="${f}"/><path d="M64 86c5-15 18-24 36-24s31 9 36 24" stroke="${d}" stroke-width="2" fill="none" opacity=".6"/>`,
  ghutra: (f, d) => `<path d="M58 90C56 54 78 36 100 36s44 18 42 54c-6-16-20-26-42-26S64 74 58 90z" fill="${f}" stroke="${d}" stroke-width="1.5"/><g fill="none" stroke="#111827" stroke-width="4.5"><ellipse cx="100" cy="49" rx="40" ry="7"/><ellipse cx="100" cy="56" rx="41" ry="7"/></g>`,
  cap: (f, d) => `<path d="M60 80C60 52 78 34 100 34s40 18 40 46z" fill="${f}"/><path d="M100 34v46" stroke="${d}" stroke-width="2"/><circle cx="100" cy="35" r="3" fill="${d}"/><path d="M56 80c20-8 68-8 88 0l4 8c-28-8-68-8-96 0z" fill="${d}"/>`,
  beanie: (f, d) => `<path d="M58 84C56 48 78 30 100 30s44 18 42 54z" fill="${f}"/><rect x="55" y="72" width="90" height="16" rx="8" fill="${d}"/><circle cx="100" cy="27" r="8" fill="${d}"/>`,
  gradcap: () => `<path d="M70 52v14c20 10 40 10 60 0V52z" fill="#111827"/><path d="M100 28l56 18-56 18-56-18z" fill="#1F2937"/><path d="M100 46l38 8v22" stroke="#FBBF24" stroke-width="2.4" fill="none"/><circle cx="138" cy="78" r="3.5" fill="#FBBF24"/>`,
};
HEADWEAR_FRONT.shemagh = HEADWEAR_FRONT.ghutra;

const GLASSES = {
  round: () => `<g stroke="#1F2937" stroke-width="2.6" fill="rgba(255,255,255,.16)"><circle cx="84" cy="92" r="11"/><circle cx="116" cy="92" r="11"/></g><path d="M95 91q5-4 10 0M73 90l-10-3M127 90l10-3" stroke="#1F2937" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  square: () => `<g stroke="#1F2937" stroke-width="2.6" fill="rgba(255,255,255,.16)"><rect x="72" y="83" width="24" height="18" rx="5"/><rect x="104" y="83" width="24" height="18" rx="5"/></g><path d="M96 91q4-3 8 0M72 89l-9-2M128 89l9-2" stroke="#1F2937" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
  visor: accent => `<rect x="68" y="82" width="64" height="20" rx="10" fill="${accent}" opacity=".85" stroke="#0F172A" stroke-width="2"/><path d="M76 88h22" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>`,
};

const PHONES = accent => `<path d="M58 94C50 10 150 10 142 94" stroke="#1F2937" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="50" y="82" width="15" height="28" rx="7" fill="#1F2937"/><rect x="135" y="82" width="15" height="28" rx="7" fill="#1F2937"/><rect x="53" y="88" width="4" height="16" rx="2" fill="${accent}"/><rect x="143" y="88" width="4" height="16" rx="2" fill="${accent}"/>`;
const ACCESSORY = {
  headphones: PHONES,
  headset: accent => PHONES(accent) + `<path d="M57 106q2 16 26 15" stroke="#1F2937" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="85" cy="121" r="4" fill="#1F2937"/>`,
  earring: (accent, covered) => covered ? '' : `<circle cx="61" cy="107" r="3.2" fill="#FBBF24"/><circle cx="139" cy="107" r="3.2" fill="#FBBF24"/>`,
};

function outfit(a, skinD) {
  const c = a.outfitColor, d = shade(c, -0.22);
  const base = 'M26 200c2-32 30-50 74-50s72 18 74 50z';
  switch (a.outfit) {
    case 'hoodie': return `<path d="${base}" fill="${c}"/><path d="M80 151q20 20 40 0" fill="${d}"/><path d="M92 162l-2 18M108 162l2 18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><path d="M70 190q30 6 60 0" stroke="${d}" stroke-width="2.5" fill="none"/>`;
    case 'suit': return `<path d="${base}" fill="${c}"/><path d="M84 150l16 38 16-38z" fill="#F8FAFC"/><path d="M97 156h6l3 22-6 9-6-9z" fill="${a.aura === 'gold' ? '#B91C1C' : '#F59E0B'}"/><path d="M84 150l12 30-12-6-10-18zM116 150l-12 30 12-6 10-18z" fill="${d}"/>`;
    case 'lab': return `<path d="${base}" fill="#F1F5F9"/><path d="M86 150l14 28 14-28z" fill="${c}"/><path d="M86 150l12 36M114 150l-12 36" stroke="#CBD5E1" stroke-width="2.5" fill="none"/><rect x="124" y="170" width="16" height="12" rx="2" fill="none" stroke="#CBD5E1" stroke-width="2"/><path d="M128 165v10" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'sport': return `<path d="${base}" fill="${c}"/><path d="M86 150l2 10q12 7 24 0l2-10z" fill="${d}"/><path d="M100 160v40" stroke="${d}" stroke-width="2"/><path d="M42 174l14 26M158 174l-14 26" stroke="#fff" stroke-width="5" opacity=".75"/>`;
    case 'thobe': { const e = shade(c, -0.18); return `<path d="${base}" fill="${c}"/><path d="M88 150q12 10 24 0" stroke="${e}" stroke-width="2.5" fill="none"/><path d="M100 156v30" stroke="${e}" stroke-width="2"/><circle cx="100" cy="164" r="1.8" fill="${shade(c, -0.35)}"/><circle cx="100" cy="174" r="1.8" fill="${shade(c, -0.35)}"/>`; }
    default: return `<path d="${base}" fill="${c}"/><path d="M85 150q15 14 30 0z" fill="${skinD}"/><path d="M84 150q16 16 32 0" stroke="${d}" stroke-width="3" fill="none"/>`;
  }
}

function human(a, u, accent) {
  const S = a.skin, SD = shade(S, -0.14), SDD = shade(S, -0.3);
  const H = a.hairColor, HD = shade(H, -0.3);
  const hw = a.headwear;
  const hwFill = hw === 'shemagh' ? `url(#${u}p)` : a.headwearColor;
  const hwD = hw === 'shemagh' ? '#BDBDBD' : shade(a.headwearColor, -0.2);
  const wrapped = hw === 'hijab' || hw === 'ghutra' || hw === 'shemagh';
  const L = [];
  if (!wrapped && HAIR_BACK[a.hair]) L.push(HAIR_BACK[a.hair](H, HD));
  if (a.outfit === 'hoodie') L.push(`<path d="M66 158c-2-18 12-30 34-30s36 12 34 30z" fill="${shade(a.outfitColor, -0.3)}"/>`);
  L.push(`<path d="M86 116V148q14 11 28 0V116z" fill="${SD}"/>`);
  L.push(outfit(a, SD));
  if (HEADWEAR_BACK[hw]) L.push(HEADWEAR_BACK[hw](hwFill, hwD));

  const head = [];
  if (!wrapped) head.push(`<ellipse cx="62" cy="94" rx="8" ry="11" fill="${SD}"/><ellipse cx="138" cy="94" rx="8" ry="11" fill="${SD}"/>`);
  head.push(`<path d="M62 88c0-30 18-46 38-46s38 16 38 46c0 28-17 46-38 46S62 116 62 88z" fill="${S}"/>`);
  if (a.blush) head.push(`<ellipse cx="75" cy="107" rx="7" ry="4" fill="#FF7B8A" opacity=".3"/><ellipse cx="125" cy="107" rx="7" ry="4" fill="#FF7B8A" opacity=".3"/>`);
  head.push(FACIAL[a.facial](H));
  head.push(`<path d="M100 97q-3 7 0 9q3 1 5-1" stroke="${SDD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`);
  head.push(`<g class="av-look"><g class="av-eyes">${EYES[a.eyes]}</g></g><g class="av-eyes-happy">${HAPPY_EYES}</g>`);
  head.push(BROWS[a.brows](a.hair === 'bald' ? shade(S, -0.55) : HD));
  head.push(`<g class="av-mouth">${MOUTHS[a.mouth]}</g><ellipse class="av-talk" cx="100" cy="118" rx="7" ry="5.5" fill="#5A1F2B"/>`);
  if (!wrapped && HAIR_FRONT[a.hair]) head.push(HAIR_FRONT[a.hair](H, HD));
  if (HEADWEAR_FRONT[hw]) head.push(HEADWEAR_FRONT[hw](hwFill, hwD));
  if (GLASSES[a.glasses]) head.push(GLASSES[a.glasses](accent));
  if (ACCESSORY[a.accessory]) head.push(ACCESSORY[a.accessory](accent, wrapped));
  L.push(`<g class="av-head">${head.join('')}</g>`);
  return L.join('');
}

function robot(a, accent) {
  const P = a.skin, PD = shade(P, -0.18), PDD = shade(P, -0.38);
  const c = a.outfitColor, cd = shade(c, -0.3);
  const mouth = a.mouth === 'calm'
    ? `<rect x="90" y="101" width="20" height="3.5" rx="1.75" fill="${accent}" opacity=".9"/>`
    : `<path d="M88 100q12 8 24 0" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const extra = [];
  if (a.headwear === 'gradcap' || a.headwear === 'cap' || a.headwear === 'beanie') extra.push(HEADWEAR_FRONT[a.headwear](a.headwearColor, shade(a.headwearColor, -0.2)));
  if (a.accessory === 'headphones' || a.accessory === 'headset') extra.push(ACCESSORY[a.accessory](accent));
  if (a.glasses === 'visor') extra.push(GLASSES.visor(accent));
  return `<path d="M34 200c2-30 28-48 66-48s64 18 66 48z" fill="${c}"/>
<rect x="82" y="168" width="36" height="20" rx="7" fill="${cd}"/><circle class="av-core" cx="100" cy="178" r="5" fill="${accent}"/>
<rect x="88" y="124" width="24" height="32" rx="6" fill="${PD}"/><path d="M88 134h24M88 144h24" stroke="${PDD}" stroke-width="2"/>
<g class="av-head">
<path d="M100 42V24" stroke="${PD}" stroke-width="4" stroke-linecap="round"/><circle class="av-antenna" cx="100" cy="20" r="6" fill="${accent}"/>
<rect x="47" y="74" width="14" height="30" rx="6" fill="${PD}"/><rect x="139" y="74" width="14" height="30" rx="6" fill="${PD}"/>
<rect x="58" y="40" width="84" height="92" rx="32" fill="${P}"/>
<path d="M74 52q26-9 52 0" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".45"/>
<rect x="66" y="64" width="68" height="50" rx="20" fill="#0B1020"/>
<g class="av-look"><g class="av-eyes"><ellipse cx="86" cy="86" rx="11" ry="12" fill="${accent}" opacity=".22"/><ellipse cx="114" cy="86" rx="11" ry="12" fill="${accent}" opacity=".22"/><ellipse cx="86" cy="86" rx="5.5" ry="7.5" fill="${accent}"/><ellipse cx="114" cy="86" rx="5.5" ry="7.5" fill="${accent}"/></g></g>
<g class="av-eyes-happy"><path d="M80 89q6-9 12 0M108 89q6-9 12 0" stroke="${accent}" stroke-width="3.6" fill="none" stroke-linecap="round"/></g>
<g class="av-mouth">${mouth}</g><rect class="av-talk" x="86" y="98" width="28" height="9" rx="4.5" fill="${accent}"/>
${extra.join('')}
</g>`;
}

let seq = 0;
/**
 * @param {object} cfg avatar config
 * @param {{mood?: 'idle'|'talking'|'thinking'|'happy', cls?: string, label?: string}} opts
 */
export function avatarSVG(cfg, { mood = 'idle', cls = '', label = '' } = {}) {
  const a = normalizeAvatar(cfg);
  const u = `av${(++seq).toString(36)}`;
  const [c1, c2] = AURAS[a.aura];
  const accent = a.kind === 'robot' ? (a.aura === 'gold' ? '#FDE68A' : shade(c2, 0.35)) : c2;
  const fig = a.kind === 'robot' ? robot(a, accent) : human(a, u, accent);
  const pattern = a.headwear === 'shemagh'
    ? `<pattern id="${u}p" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#FAFAFA"/><path d="M0 0L9 9M9 0L0 9" stroke="#D92D2D" stroke-width="1.3"/></pattern>` : '';
  const aria = label ? `role="img" aria-label="${label.replace(/"/g, '')}"` : 'aria-hidden="true"';
  return `<svg class="avatar mood-${mood} ${cls}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" ${aria}><defs><linearGradient id="${u}g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient><radialGradient id="${u}r" cx=".5" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/></radialGradient>${pattern}</defs><rect width="200" height="200" fill="url(#${u}g)"/><rect width="200" height="200" fill="url(#${u}r)"/><g opacity=".16" fill="none" stroke="#fff" stroke-width="1.2"><circle cx="100" cy="92" r="70"/><circle cx="100" cy="92" r="90"/></g><g class="av-fig">${fig}</g><g class="av-think" fill="#fff"><circle cx="150" cy="44" r="5"/><circle cx="163" cy="30" r="7"/><circle cx="178" cy="14" r="9"/></g><g class="av-spark" fill="#FFE08A"><path d="M36 40l3 8 8 3-8 3-3 8-3-8-8-3 8-3z"/><path d="M166 58l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/></g></svg>`;
}

/** Change mood of an already-rendered avatar without re-rendering (smooth). */
export function setMood(el, mood) {
  const svgs = el?.matches?.('svg.avatar') ? [el] : [...(el?.querySelectorAll?.('svg.avatar') || [])];
  for (const s of svgs) s.setAttribute('class', s.getAttribute('class').replace(/mood-\w+/, `mood-${mood}`));
}
