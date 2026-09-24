import { state, load, subscribe, team, director, reminders } from './store.js';
import { api } from './api.js';
import { $, esc, icon, pref, setPref, toast } from './ui.js';
import { levelInfo } from './catalog.js';
import { av } from './components.js';
import * as home from './views/home.js';
import * as chat from './views/chat.js';
import * as council from './views/council.js';
import * as paths from './views/paths.js';
import * as goals from './views/goals.js';
import * as memory from './views/memory.js';
import * as forge from './views/forge.js';
import * as settings from './views/settings.js';
import * as onboarding from './views/onboarding.js';

const ROUTES = { home, chat, council, paths, goals, memory, forge, settings };
const NAV = [
  ['home', 'الرئيسية', 'home'],
  ['council', 'المجلس', 'users'],
  ['paths', 'المسارات', 'route'],
  ['goals', 'الأهداف', 'target'],
  ['memory', 'الذاكرة', 'brain'],
  ['forge', 'صانع المدرّبين', 'sparkles'],
  ['settings', 'الإعدادات', 'sliders'],
];
const LABELS = Object.fromEntries(NAV.map(([k, l]) => [k, l]));
LABELS.chat = 'جلسة تدريب';

let cleanup = null;
let current = null;

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, qs] = h.split('?');
  const [name, ...rest] = pathPart.split('/').filter(Boolean);
  return { name: name || 'home', args: rest.map(decodeURIComponent), query: new URLSearchParams(qs || '') };
}

async function route() {
  if (!state.profile?.onboarded) return startOnboarding();
  $('#app').hidden = false;
  const { name, args, query } = parseHash();
  const key = ROUTES[name] ? name : 'home';
  try { cleanup?.(); } catch { /* ignore */ }
  cleanup = null;
  current = key;
  closeMenu();
  const view = $('#view');
  const root = document.createElement('div');
  root.className = `view-root v-${key}`;
  view.replaceChildren(root);
  document.body.dataset.view = key;
  renderChrome();
  try {
    cleanup = (await ROUTES[key].render(root, args, query)) || null;
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="page"><div class="empty">${icon('x', 34)}<h3>صار خطأ</h3><p>${esc(e.message)}</p></div></div>`;
  }
  $('#main').scrollTop = 0;
}

function renderChrome() {
  if (!state.profile) return;
  const p = state.profile;
  const lv = levelInfo(p.xp);
  const key = current || 'home';
  $('#nav').innerHTML = NAV.map(([k, l, ic]) => `<a href="#/${k}" class="${k === key || (key === 'chat' && k === 'home' && false) ? 'on' : ''}">${icon(ic, 19)}<span>${l}</span></a>`).join('');
  $('#bottomNav').innerHTML = [...NAV.slice(0, 4), ['more', 'المزيد', 'menu']].map(([k, l, ic]) =>
    k === 'more' ? `<button id="moreBtn">${icon(ic, 21)}<span>${l}</span></button>` : `<a href="#/${k}" class="${k === key ? 'on' : ''}">${icon(ic, 21)}<span>${l}</span></a>`).join('');
  $('#moreBtn').onclick = openMenu;
  const { args } = parseHash();
  $('#sideTeam').innerHTML = state.mentors.map(m => `
    <a href="#/chat/${m.id}" class="side-mentor ${key === 'chat' && args[0] === m.id ? 'on' : ''}">
      ${av(m, 30)}<span><b>${esc(m.name)}</b><small>${esc(m.title)}</small></span>${m.role === 'director' ? `<i class="crown">${icon('crown', 12)}</i>` : ''}
    </a>`).join('');
  $('#sideAdd').innerHTML = icon('plus', 16);
  $('#meCard').innerHTML = `
    <div class="me-ring">${levelRing(lv)}<b>${esc((p.name || '؟').slice(0, 1))}</b></div>
    <div class="me-info"><b>${esc(p.name)}</b><small>المستوى ${lv.level} · ${lv.title}</small>
      <i class="xpbar"><b style="width:${Math.round(lv.pct * 100)}%"></b></i></div>`;
  $('#crumb').innerHTML = `<b>${LABELS[key] || ''}</b>`;
  $('#streakPill').innerHTML = `${icon('flame', 16)}<b>${p.streak || 0}</b>`;
  $('#streakPill').classList.toggle('hot', (p.streak || 0) >= 3);
  $('#xpPill').innerHTML = `${icon('star', 15)}<b>${p.xp}</b><small>XP</small>`;
  const rem = reminders();
  $('#bellBtn').innerHTML = `${icon('bell', 19)}${rem.length ? `<i class="dot">${rem.length}</i>` : ''}`;
  $('#bellPop').innerHTML = `<h4>${icon('bell', 15)} تذكيرات ${esc(director()?.name || '')}</h4>${rem.length
    ? rem.map(r => `<a href="${r.href}" class="rem ${r.level}">${icon(r.icon, 16)}<span>${esc(r.text)}</span></a>`).join('')
    : '<p class="muted">كل شي تمام، ما في تذكيرات حالياً ✨</p>'}`;
  const mp = $('#modePill');
  mp.hidden = !state.config.mock;
  mp.innerHTML = `${icon('bolt', 14)} وضع تجريبي`;
  mp.onclick = () => (location.hash = '#/settings');
  $('#themeBtn').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 19);
}

function levelRing(lv) {
  const r = 20, c = 2 * Math.PI * r;
  return `<svg width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="${r}" fill="none" class="ring-bg" stroke-width="3.5"/><circle cx="23" cy="23" r="${r}" fill="none" stroke="url(#meGrad)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - lv.pct)}" transform="rotate(-90 23 23)"/><defs><linearGradient id="meGrad"><stop offset="0" stop-color="#FFB547"/><stop offset="1" stop-color="#FF7A45"/></linearGradient></defs></svg>`;
}

const openMenu = () => document.body.classList.add('menu-open');
const closeMenu = () => document.body.classList.remove('menu-open');

async function startOnboarding() {
  $('#app').hidden = true;
  await onboarding.render($('#onboarding'), async () => {
    $('#onboarding').innerHTML = '';
    await load();
    location.hash = '#/home';
    route();
  });
}

// ---------- reminders → browser notifications (while the app is open) ----------
function notifyReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !pref('notify', false)) return;
  const sent = pref('notified', {});
  const day = new Date().toDateString();
  for (const r of reminders()) {
    const k = `${day}:${r.text}`;
    if (sent[k]) continue;
    sent[k] = 1;
    try { new Notification(`📌 ${director()?.name || 'مجلس'}`, { body: r.text, icon: '/favicon.svg', tag: k }); } catch { /* unsupported */ }
  }
  setPref('notified', Object.fromEntries(Object.entries(sent).filter(([k]) => k.startsWith(day))));
}

function setupChrome() {
  $('#menuBtn').innerHTML = icon('menu', 20);
  $('#menuBtn').onclick = openMenu;
  $('#scrim').onclick = closeMenu;
  $('#themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('majlis.theme', next); } catch { /* ignore */ }
    renderChrome();
  };
  $('#bellBtn').onclick = e => { e.stopPropagation(); $('#bellPop').hidden = !$('#bellPop').hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.bell-wrap')) $('#bellPop').hidden = true; });
  // copy buttons inside rendered markdown
  document.addEventListener('click', e => {
    const b = e.target.closest('.copy-code');
    if (b) navigator.clipboard?.writeText(b.closest('.code').querySelector('code').innerText).then(() => { b.textContent = 'تم ✓'; setTimeout(() => (b.textContent = 'نسخ'), 1400); });
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); location.hash = '#/council?focus=1'; }
  });
}

function showLogin() {
  $('#onboarding').innerHTML = `
    <div class="onb"><div class="onb-card login-card">
      <img src="/favicon.svg" alt="" width="64" height="64">
      <h2>مجلس</h2>
      <p class="muted">هذه المساحة محمية بكلمة مرور.</p>
      <form id="loginForm" class="onb-form col">
        <div class="input-icon">${icon('lock', 18)}<input class="input lg" type="password" name="pw" placeholder="كلمة المرور" autocomplete="current-password" required autofocus></div>
        <button class="btn primary lg">${icon('key', 18)} دخول</button>
      </form>
    </div></div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.target.querySelector('button');
    b.disabled = true;
    try {
      await api.post('/api/login', { password: e.target.pw.value });
      location.reload();
    } catch (err) {
      toast(esc(err.message), { type: 'error' });
      b.disabled = false;
      e.target.pw.select();
    }
  });
}

async function boot() {
  setupChrome();
  try {
    await load();
  } catch (e) {
    if (e.auth) { $('#splash').remove(); return showLogin(); }
    $('#splash').innerHTML = `<div class="empty">${icon('x', 34)}<h3>تعذّر الاتصال بالخادم</h3><p>${esc(e.message)} — تأكد أن الخادم يعمل ثم أعد تحميل الصفحة.</p></div>`;
    return;
  }
  $('#splash').classList.add('hide');
  setTimeout(() => $('#splash').remove(), 500);
  subscribe(() => renderChrome());
  window.addEventListener('hashchange', route);
  await route();
  notifyReminders();
  setInterval(notifyReminders, 30 * 60 * 1000);
  if (state.config.mock && !sessionStorage.getItem('majlis.mockNote')) {
    try { sessionStorage.setItem('majlis.mockNote', '1'); } catch { /* ignore */ }
    toast(`${icon('bolt', 16)} أنت بالوضع التجريبي — أضف مفتاح DeepSeek من <a href="#/settings">الإعدادات</a> لتفعيل الذكاء الحقيقي`, { timeout: 6000 });
  }
}

boot();
