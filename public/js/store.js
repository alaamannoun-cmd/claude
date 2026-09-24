import { api } from './api.js';
import { levelInfo } from './catalog.js';
import { daysLeft, daysWord, toast, confetti, sound, icon, esc } from './ui.js';

const listeners = new Set();
export const state = { profile: null, mentors: [], goals: [], paths: [], council: [], config: {}, ready: false };

export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
export const emit = () => listeners.forEach(fn => fn(state));

export async function load() {
  Object.assign(state, await api.get('/api/state'), { ready: true });
  emit();
}

export const mentorById = id => state.mentors.find(m => m.id === id);
export const director = () => state.mentors.find(m => m.role === 'director');
export const team = () => state.mentors.filter(m => m.role !== 'director');

/** Apply a server profile update, with floating XP and level-up celebration. */
export function applyProfile(profile, gained = 0) {
  if (!profile) return;
  const before = levelInfo(state.profile?.xp || 0).level;
  state.profile = profile;
  emit();
  if (gained) floatXP(gained);
  const after = levelInfo(profile.xp);
  if (after.level > before) {
    setTimeout(() => {
      confetti({ count: 200, spread: 1.4 });
      sound.fanfare();
      toast(`<div class="levelup"><b>${icon('trophy', 18)} ارتقيت للمستوى ${after.level}</b><span>لقبك الجديد: «${esc(after.title)}»</span></div>`, { type: 'gold', timeout: 5200 });
    }, 350);
  }
}

function floatXP(n) {
  const pill = document.getElementById('xpPill');
  if (!pill) return;
  const r = pill.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'xp-float';
  el.textContent = `+${n} XP`;
  el.style.left = `${r.left + r.width / 2}px`;
  el.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(el);
  pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump');
  setTimeout(() => el.remove(), 1400);
}

export function upsert(listName, item) {
  const list = state[listName];
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.unshift(item);
  emit();
}
export function removeFrom(listName, id) {
  state[listName] = state[listName].filter(x => x.id !== id);
  emit();
}

/** Smart reminders computed from goals & paths. */
export function reminders() {
  const out = [];
  for (const g of state.goals.filter(g => g.status !== 'done')) {
    const d = daysLeft(g.deadline);
    const next = g.milestones?.find(m => !m.done);
    if (d != null && d < 0) out.push({ level: 'danger', icon: 'flag', goal: g, text: `تجاوزت موعد «${g.title}» بـ${daysWord(d)}`, href: '#/goals' });
    else if (d != null && d <= 3) out.push({ level: 'warn', icon: 'clock', goal: g, text: d === 0 ? `اليوم آخر موعد لـ«${g.title}»` : `باقي ${daysWord(d)} على «${g.title}»`, href: '#/goals' });
    else if (next?.due && daysLeft(next.due) <= 1) out.push({ level: 'info', icon: 'target', goal: g, text: `محطة قريبة: ${next.text}`, href: '#/goals' });
  }
  for (const p of state.paths) {
    const all = p.modules.flatMap(m => m.lessons);
    const last = all.filter(l => l.doneAt).map(l => l.doneAt).sort().pop() || p.createdAt;
    const next = all.find(l => !l.done);
    if (next && (Date.now() - new Date(last)) / 864e5 >= 2) {
      out.push({ level: 'info', icon: 'book', text: `درسك «${next.title}» بانتظارك`, href: `#/paths/${p.id}` });
    }
  }
  return out;
}
