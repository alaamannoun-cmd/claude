import { state, team, director, reminders, mentorById } from '../store.js';
import { api } from '../api.js';
import { levelInfo } from '../catalog.js';
import { av, bondMeter, pathWizard, goalModal, stageBox, mountStages, setMood, feedSpeech } from '../components.js';
import { esc, icon, timeGreeting, dueLabel, ring, timeAgo, todayStr, fmtDate } from '../ui.js';

export async function render(root) {
  const p = state.profile;
  const d = director();
  const tm = team();
  const lv = levelInfo(p.xp);
  const rem = reminders();
  const activeGoals = state.goals.filter(g => g.status !== 'done');
  const nextLessons = state.paths.map(path => {
    const all = path.modules.flatMap(m => m.lessons);
    const next = all.find(l => !l.done);
    return next ? { path, lesson: next, done: all.filter(l => l.done).length, total: all.length } : null;
  }).filter(Boolean).slice(0, 3);

  root.innerHTML = `
  <div class="page home">
    <section class="hero card">
      <div class="hero-glow"></div>
      <a class="hero-av" href="#/chat/${d.id}" title="تحدّث مع ${esc(d.name)}">${stageBox(d, { framing: 'portrait', mood: 'thinking' })}</a>
      <div class="hero-body">
        <div class="eyebrow">${icon('crown', 14)} ${esc(d.name)} · ${esc(d.title)}</div>
        <h1 class="hero-title">${timeGreeting()} يا ${esc(p.name)} <span class="wave">👋</span></h1>
        <div class="brief" id="brief"><div class="skel w80"></div><div class="skel w60"></div><div class="skel w70"></div></div>
      </div>
    </section>

    <form class="askbar" id="askbar">
      <span class="ask-ic">${icon('sparkles', 20)}</span>
      <input name="q" placeholder="اسأل المجلس أي شيء… و${esc(d.name)} يوزّع السؤال على المدرّب المناسب" autocomplete="off">
      <kbd>Ctrl K</kbd>
      <button class="btn primary" aria-label="أرسل">${icon('send', 18)}</button>
    </form>

    ${rem.length ? `<section class="reminders">${rem.slice(0, 3).map(r => `<a class="rem-card ${r.level}" href="${r.href}">${icon(r.icon, 18)}<span>${esc(r.text)}</span>${icon('chevL', 16)}</a>`).join('')}</section>` : ''}

    <section class="stats">
      <div class="stat card">
        <div class="stat-ring">${ring(lv.pct, { size: 64, stroke: 7, label: lv.level })}</div>
        <div><small>المستوى</small><b>${lv.title}</b><span class="muted">${lv.next ? `${lv.next - p.xp} XP للمستوى التالي` : 'أعلى مستوى!'}</span></div>
      </div>
      <div class="stat card ${p.streak >= 3 ? 'hot' : ''}">
        <div class="stat-ic flame">${icon('flame', 28)}</div>
        <div><small>سلسلة الأيام</small><b>${p.streak || 0} ${p.streak === 1 ? 'يوم' : 'أيام'}</b><span class="muted">أفضل سلسلة: ${p.bestStreak || 0}</span></div>
      </div>
      <div class="stat card">
        <div class="stat-ic book">${icon('book', 26)}</div>
        <div><small>دروس منجزة</small><b>${p.stats?.lessons || 0}</b><span class="muted">${state.paths.length} مسار</span></div>
      </div>
      <div class="stat card">
        <div class="stat-ic trophy">${icon('trophy', 26)}</div>
        <div><small>أهداف</small><b>${p.stats?.goals || 0} محقّق</b><span class="muted">${activeGoals.length} قيد العمل</span></div>
      </div>
    </section>

    <section class="home-grid">
      <div class="card team-card">
        <div class="card-head"><h2>${icon('users', 20)} فريقك</h2><a class="btn subtle sm" href="#/forge">${icon('plus', 16)} مدرّب جديد</a></div>
        <div class="team-grid">
          ${tm.map(m => `
            <article class="mentor-card" style="--aura:${auraColor(m)}">
              <a href="#/chat/${m.id}" class="mc-av">${av(m, 84)}</a>
              <div class="mc-body">
                <h3><a href="#/chat/${m.id}">${esc(m.name)}</a></h3>
                <p class="muted">${esc(m.title)}</p>
                ${bondMeter(m)}
                <small class="muted">${m.lastInteraction ? `آخر جلسة ${timeAgo(m.lastInteraction)}` : 'لم تبدأ بعد'}</small>
              </div>
              <div class="mc-actions">
                <a class="btn primary sm" href="#/chat/${m.id}">${icon('message', 15)} جلسة</a>
                <a class="icon-btn sm" href="#/memory/${m.id}" title="ذاكرته">${icon('brain', 16)}</a>
              </div>
            </article>`).join('')}
          <a class="mentor-card add" href="#/forge"><span>${icon('sparkles', 28)}</span><b>صمّم مدرّباً جديداً</b><small>شخصية، شكل، وتخصص</small></a>
        </div>
      </div>

      <div class="side-col">
        <div class="card">
          <div class="card-head"><h2>${icon('route', 20)} الدرس التالي</h2><a class="link" href="#/paths">كل المسارات</a></div>
          ${nextLessons.length ? nextLessons.map(n => {
            const m = mentorById(n.path.mentorId);
            return `<a class="next-lesson" href="#/paths/${n.path.id}?lesson=${n.lesson.id}">
              ${m ? av(m, 42) : ''}
              <div><b>${esc(n.lesson.title)}</b><small class="muted">${esc(n.path.title)} · ${n.done}/${n.total}</small>
              <i class="bar"><b style="width:${(n.done / n.total) * 100}%"></b></i></div>
              <span class="play">${icon('play', 14)}</span></a>`;
          }).join('') : `<div class="mini-empty"><p>ما في مسارات بعد. خلّي مدرّبك يرتّبلك منهج منظّم.</p><button class="btn subtle sm" id="newPath">${icon('wand', 16)} رتّبلي مسار</button></div>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('target', 20)} أهدافك</h2><a class="link" href="#/goals">الكل</a></div>
          ${activeGoals.length ? activeGoals.slice(0, 4).map(g => {
            const total = g.milestones?.length || 0, done = g.milestones?.filter(x => x.done).length || 0;
            const due = dueLabel(g.deadline);
            const m = mentorById(g.mentorId);
            return `<a class="goal-mini" href="#/goals">${ring(total ? done / total : 0, { size: 40, stroke: 5 })}
              <div><b>${esc(g.title)}</b><small class="muted">${m ? esc(m.name) + ' · ' : ''}${total ? `${done}/${total} محطات` : 'بدون محطات بعد'}</small></div>
              <span class="due ${due.cls}">${due.text}</span></a>`;
          }).join('') : `<div class="mini-empty"><p>الهدف الواضح نص الطريق.</p><button class="btn subtle sm" id="newGoal">${icon('plus', 16)} هدف جديد</button></div>`}
        </div>

        <div class="card">
          <div class="card-head"><h2>${icon('calendar', 20)} نشاطك</h2><small class="muted">آخر 5 أسابيع</small></div>
          ${heatmap(p.activity || {})}
        </div>
      </div>
    </section>
  </div>`;

  mountStages(root);
  const ask = root.querySelector('#askbar');
  ask.addEventListener('submit', e => {
    e.preventDefault();
    const q = ask.q.value.trim();
    if (q) location.hash = `#/council?q=${encodeURIComponent(q)}`;
  });
  const onKey = e => { if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); ask.q.focus(); } };
  document.addEventListener('keydown', onKey);
  root.querySelector('#newPath')?.addEventListener('click', () => pathWizard({ topic: activeGoals[0]?.title || '' }));
  root.querySelector('#newGoal')?.addEventListener('click', () => goalModal({}, { onSaved: () => { location.hash = '#/goals'; } }));

  loadBrief(root, d);
  return () => document.removeEventListener('keydown', onKey);
}

function auraColor(m) {
  return { aurora: '#7C5CFF', sunset: '#FF5E6C', ocean: '#2563EB', forest: '#10B981', gold: '#F59E0B', night: '#7C3AED', rose: '#EC4899', mint: '#14B8A6' }[m.avatar?.aura] || '#7C5CFF';
}

async function loadBrief(root, d) {
  const box = root.querySelector('#brief');
  try {
    const b = await api.post('/api/brief', {});
    if (!box.isConnected) return;
    const hero = root.querySelector('.hero-av');
    setMood(hero, 'talking');
    const spoken = [b.greeting, ...b.focus.map(f => f.text), b.nudge].filter(Boolean).join('. ');
    feedSpeech(hero, spoken);
    box.innerHTML = `
      <p class="brief-greet">${esc(b.greeting)}</p>
      <ol class="focus">${b.focus.map((f, i) => {
        const m = mentorById(f.mentorId);
        const href = f.action === 'goal' ? '#/goals' : f.action === 'lesson' ? lessonHref(f.mentorId) : m ? `#/chat/${m.id}` : '#/forge';
        return `<li style="--i:${i}"><a href="${href}"><span class="n">${i + 1}</span>${m ? av(m, 26) : ''}<span>${esc(f.text)}</span>${icon('chevL', 14)}</a></li>`;
      }).join('')}</ol>
      ${b.nudge ? `<p class="nudge">${icon('bolt', 15)} ${esc(b.nudge)}</p>` : ''}
      <button class="link small" id="refreshBrief">${icon('refresh', 13)} حدّث الموجز</button>`;
    setTimeout(() => { setMood(hero, 'happy'); setTimeout(() => setMood(hero, 'idle'), 1400); }, Math.min(7000, 1200 + spoken.length * 55));
    box.querySelector('#refreshBrief').onclick = async () => {
      box.innerHTML = '<div class="skel w80"></div><div class="skel w60"></div>';
      setMood(root.querySelector('.hero-av'), 'thinking');
      await api.post('/api/brief', { force: true });
      loadBrief(root, d);
    };
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

function lessonHref(mentorId) {
  const p = state.paths.find(x => x.mentorId === mentorId && x.modules.some(m => m.lessons.some(l => !l.done))) || state.paths[0];
  if (!p) return '#/paths';
  const l = p.modules.flatMap(m => m.lessons).find(x => !x.done);
  return `#/paths/${p.id}${l ? `?lesson=${l.id}` : ''}`;
}

function heatmap(activity) {
  const days = [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - 34);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = todayStr(d);
    days.push({ k, n: activity[k] || 0 });
  }
  const max = Math.max(1, ...days.map(d => d.n));
  return `<div class="heatmap">${days.map(d => `<i title="${fmtDate(d.k)}: ${d.n} نشاط" style="--v:${d.n ? 0.25 + (d.n / max) * 0.75 : 0}" class="${d.k === todayStr() ? 'today' : ''}"></i>`).join('')}</div>`;
}
