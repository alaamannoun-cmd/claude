import * as S from './store.js';
import { initialMemory, addItems, removeItems, logLine } from './memory.js';
import { normalizeAvatar } from '../public/js/avatar.js';
import { DIRECTOR } from '../public/js/templates.js';
import { TRAITS, STYLES, DIALECTS } from '../public/js/catalog.js';

const SAFE_ID = /^[a-z0-9_-]{1,48}$/i;
export const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
export function assertId(id) {
  if (!SAFE_ID.test(id || '')) throw httpError('معرّف غير صالح');
  return id;
}
const now = () => new Date().toISOString();
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// ---------------- config ----------------
export const getConfig = () => S.readJSON('config.json', {});
export const patchConfig = patch => S.update('config.json', {}, c => {
  for (const [k, v] of Object.entries(patch)) (v === null ? delete c[k] : (c[k] = v));
});

// ---------------- profile & gamification ----------------
const profileDefaults = () => ({
  name: '', bio: '', preferences: '', xp: 0, streak: 0, bestStreak: 0, lastActive: null,
  activity: {}, stats: { lessons: 0, goals: 0, messages: 0, sessions: 0, milestones: 0, paths: 0 },
  onboarded: false, createdAt: now(),
});
const withDefaults = p => {
  const d = profileDefaults();
  return { ...d, ...p, stats: { ...d.stats, ...(p?.stats || {}) }, activity: { ...(p?.activity || {}) } };
};

export const getProfile = async () => withDefaults(await S.readJSON('profile.json', {}));

export const saveProfile = patch => S.update('profile.json', {}, p => {
  Object.assign(p, withDefaults(p));
  for (const k of ['name', 'bio', 'preferences']) if (k in patch) p[k] = str(patch[k], k === 'name' ? 40 : 600);
  if ('onboarded' in patch) p.onboarded = !!patch.onboarded;
  return p;
});

export function gainXp(amount, stat) {
  return S.update('profile.json', {}, p => {
    Object.assign(p, withDefaults(p));
    p.xp += amount;
    if (stat) p.stats[stat] = (p.stats[stat] || 0) + 1;
    const t = S.today();
    if (p.lastActive !== t) {
      const yesterday = S.today(new Date(Date.now() - 864e5));
      p.streak = p.lastActive === yesterday ? p.streak + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      p.lastActive = t;
    }
    p.activity[t] = (p.activity[t] || 0) + 1;
    const days = Object.keys(p.activity).sort();
    while (days.length > 90) delete p.activity[days.shift()];
    return p;
  });
}

// ---------------- mentors ----------------
export function sanitizeMentor(m) {
  const personality = {};
  for (const t of TRAITS) personality[t.id] = clamp(m.personality?.[t.id] ?? 50);
  const styleIds = STYLES.map(s => s.id);
  return {
    id: m.id,
    role: m.role === 'director' ? 'director' : 'mentor',
    name: str(m.name, 40) || 'مدرب',
    title: str(m.title, 80) || 'مدرب شخصي',
    specialty: str(m.specialty, 300) || 'تدريب عام',
    scope: str(m.scope, 400),
    description: str(m.description, 500),
    personality,
    styles: (Array.isArray(m.styles) ? m.styles : []).filter(s => styleIds.includes(s)).slice(0, 3),
    dialect: DIALECTS.some(d => d.id === m.dialect) ? m.dialect : 'msa',
    catchphrase: str(m.catchphrase, 140),
    rules: str(m.rules, 1500),
    avatar: normalizeAvatar(m.avatar),
    template: m.template ? str(m.template, 30) : undefined,
    bond: Number(m.bond) || 0,
    createdAt: m.createdAt || now(),
    updatedAt: now(),
    lastInteraction: m.lastInteraction || null,
  };
}

export async function listMentors() {
  const ids = (await S.listDirs('mentors')).filter(id => SAFE_ID.test(id));
  const all = (await Promise.all(ids.map(id => S.readJSON(`mentors/${id}/mentor.json`, null)))).filter(Boolean);
  return all.sort((a, b) => (b.role === 'director') - (a.role === 'director') || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getMentor(id) {
  assertId(id);
  const m = await S.readJSON(`mentors/${id}/mentor.json`, null);
  if (!m) throw httpError('المدرب غير موجود', 404);
  return m;
}

export async function createMentor(data, profile) {
  const id = data.role === 'director' ? 'director' : S.uid('m');
  const m = sanitizeMentor({ ...data, id, bond: 0, createdAt: now() });
  await S.writeJSON(`mentors/${id}/mentor.json`, m);
  await S.writeText(`mentors/${id}/memory.md`, initialMemory(m, profile || await getProfile()));
  return m;
}

export async function ensureDirector() {
  const existing = await S.readJSON('mentors/director/mentor.json', null);
  if (!existing) await createMentor(DIRECTOR);
}

export function updateMentor(id, patch) {
  assertId(id);
  return S.update(`mentors/${id}/mentor.json`, null, m => {
    if (!m) throw httpError('المدرب غير موجود', 404);
    Object.assign(m, sanitizeMentor({ ...m, ...patch, id: m.id, role: m.role, bond: m.bond, createdAt: m.createdAt, lastInteraction: m.lastInteraction }));
  });
}

export function bumpBond(id, n = 1) {
  assertId(id);
  return S.update(`mentors/${id}/mentor.json`, null, m => {
    if (!m) return null;
    m.bond = (m.bond || 0) + n;
    m.lastInteraction = now();
  });
}

export async function deleteMentor(id) {
  if (assertId(id) === 'director') throw httpError('لا يمكن حذف مدير المجلس');
  await S.remove(`mentors/${id}`);
  await S.update('goals.json', [], goals => { for (const g of goals) if (g.mentorId === id) g.mentorId = null; });
}

// ---------------- memory ----------------
export const memoryPath = id => `mentors/${assertId(id)}/memory.md`;
export const getMemory = id => S.readText(memoryPath(id), '');
export const memoryUpdatedAt = id => S.mtime(memoryPath(id));
export const saveMemory = (id, md) => S.writeText(memoryPath(id), String(md).slice(0, 60000));
export const updateMemory = (id, fn) => S.updateText(memoryPath(id), '', fn);

export async function applyMemory(id, { add = [], remove = [] }) {
  let added = [], removed = [];
  await updateMemory(id, md => {
    const r1 = removeItems(md, remove);
    const r2 = addItems(r1.md, add);
    removed = r1.removed; added = r2.added;
    return r2.md;
  });
  return { added, removed };
}

export async function logMemory(id, text) {
  if (!id) return;
  try { await getMentor(id); } catch { return; }
  return applyMemory(id, { add: [logLine(text)] });
}

export async function resetMemory(id) {
  const m = await getMentor(id);
  await saveMemory(id, initialMemory(m, await getProfile()));
}

// ---------------- chat ----------------
const chatPath = id => `mentors/${assertId(id)}/chat.json`;
export const getChat = id => S.readJSON(chatPath(id), []);
export const clearChat = id => S.writeJSON(chatPath(id), []);
export const appendChat = (id, ...msgs) => S.update(chatPath(id), [], list => {
  list.push(...msgs);
  if (list.length > 300) list.splice(0, list.length - 300);
});
export const patchChatMessage = (id, msgId, patch) => S.update(chatPath(id), [], list => {
  const m = list.find(x => x.id === msgId);
  if (m) Object.assign(m, patch);
});

// ---------------- goals ----------------
export const listGoals = () => S.readJSON('goals.json', []);
export const saveGoals = fn => S.update('goals.json', [], fn);
export async function getGoal(id) {
  const g = (await listGoals()).find(x => x.id === id);
  if (!g) throw httpError('الهدف غير موجود', 404);
  return g;
}
export function updateGoal(id, fn) {
  return S.update('goals.json', [], goals => {
    const g = goals.find(x => x.id === id);
    if (!g) throw httpError('الهدف غير موجود', 404);
    fn(g);
    return g;
  });
}

// ---------------- learning paths ----------------
export const listPaths = () => S.readJSON('paths.json', []);
export const addPath = p => S.update('paths.json', [], list => { list.unshift(p); });
export const deletePath = id => S.update('paths.json', [], list => {
  const i = list.findIndex(p => p.id === id);
  if (i >= 0) list.splice(i, 1);
});
export function updatePath(id, fn) {
  return S.update('paths.json', [], list => {
    const p = list.find(x => x.id === id);
    if (!p) throw httpError('المسار غير موجود', 404);
    fn(p);
    return p;
  });
}
export async function findLesson(pathId, lessonId) {
  const p = (await listPaths()).find(x => x.id === pathId);
  if (!p) return null;
  for (const [mi, mod] of p.modules.entries()) {
    const lesson = mod.lessons.find(l => l.id === lessonId);
    if (lesson) return { path: p, module: mod, moduleIndex: mi, lesson };
  }
  return null;
}

// ---------------- council sessions ----------------
export const listSessions = () => S.readJSON('council.json', []);
export async function getSession(id) {
  return (await listSessions()).find(s => s.id === id) || null;
}
export const saveSession = session => S.update('council.json', [], list => {
  const i = list.findIndex(s => s.id === session.id);
  if (i >= 0) list.splice(i, 1);
  list.unshift(session);
  if (list.length > 40) list.length = 40;
});
export const deleteSession = id => S.update('council.json', [], list => {
  const i = list.findIndex(s => s.id === id);
  if (i >= 0) list.splice(i, 1);
});

// ---------------- daily brief cache ----------------
export const getBrief = () => S.readJSON('brief.json', null);
export const saveBrief = b => S.writeJSON('brief.json', b);

// ---------------- export / reset ----------------
export async function exportAll() {
  const mentors = await listMentors();
  const memories = {};
  for (const m of mentors) memories[m.id] = await getMemory(m.id);
  return {
    exportedAt: now(), profile: await getProfile(), mentors, memories,
    goals: await listGoals(), paths: await listPaths(), council: await listSessions(),
  };
}

export async function resetAll() {
  for (const f of ['profile.json', 'goals.json', 'paths.json', 'council.json', 'brief.json']) await S.remove(f);
  await S.remove('mentors');
  await ensureDirector();
}
