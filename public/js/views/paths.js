import { state, mentorById, applyProfile, upsert, removeFrom } from '../store.js';
import { api } from '../api.js';
import { LESSON_TYPES } from '../catalog.js';
import { av, pathWizard, emptyState } from '../components.js';
import { esc, icon, ring, openDrawer, toast, confetti, sound, confirmBox, timeAgo } from '../ui.js';

export async function render(root, [id], query) {
  if (id) return detail(root, id, query);
  const list = state.paths;
  root.innerHTML = `
  <div class="page paths">
    <div class="page-head">
      <div><h1>${icon('route', 26)} مسارات التعلّم</h1><p class="muted">مناهج شخصية يرتّبها مدرّبوك حسب مستواك ووقتك — درس بعد درس، بخريطة واضحة.</p></div>
      <button class="btn primary" id="newPath">${icon('wand', 18)} مسار جديد</button>
    </div>
    ${list.length ? `<div class="path-grid">${list.map(card).join('')}
      <button class="path-card add" id="newPath2">${icon('plus', 30)}<b>مسار جديد</b><small>اختر مدرّب وموضوع</small></button></div>`
      : emptyState('route', 'ما في مسارات بعد', 'اطلب من أي مدرّب يرتّبلك منهج كامل: وحدات، دروس، تمارين، ومصادر — على مقاس وقتك.', `<button class="btn primary" id="newPath3">${icon('wand', 18)} رتّبلي أول مسار</button>`)}
  </div>`;
  root.querySelectorAll('#newPath,#newPath2,#newPath3').forEach(b => b.addEventListener('click', () => pathWizard({})));
}

function stats(p) {
  const all = p.modules.flatMap(m => m.lessons);
  const done = all.filter(l => l.done).length;
  return { all, done, pct: all.length ? done / all.length : 0, minutes: all.reduce((s, l) => s + (l.duration || 0), 0) };
}

function card(p) {
  const m = mentorById(p.mentorId);
  const s = stats(p);
  const next = s.all.find(l => !l.done);
  return `<a class="path-card" href="#/paths/${p.id}">
    <div class="pc-top">${m ? av(m, 44) : ''}<div><small class="muted">${esc(m?.name || 'مدرّب محذوف')}</small><h3>${esc(p.title)}</h3></div>${ring(s.pct, { size: 52, stroke: 6, label: `${Math.round(s.pct * 100)}%` })}</div>
    <p class="muted">${esc(p.summary)}</p>
    <div class="pc-meta"><span>${icon('book', 14)} ${s.all.length} درس</span><span>${icon('clock', 14)} ${Math.round(s.minutes / 60)} ساعة</span><span>${icon('calendar', 14)} ${p.weeks} أسابيع</span></div>
    ${next ? `<div class="pc-next">${icon('play', 13)} التالي: ${esc(next.title)}</div>` : `<div class="pc-next done">${icon('trophy', 14)} مكتمل!</div>`}
  </a>`;
}

async function detail(root, id, query) {
  let p = state.paths.find(x => x.id === id);
  if (!p) { root.innerHTML = `<div class="page">${emptyState('route', 'المسار غير موجود', '', '<a class="btn primary" href="#/paths">كل المسارات</a>')}</div>`; return; }
  const m = mentorById(p.mentorId);

  function paint() {
    const s = stats(p);
    const nextId = s.all.find(l => !l.done)?.id;
    let idx = 0;
    root.innerHTML = `
    <div class="page path-detail">
      <a class="back" href="#/paths">${icon('chevR', 16)} المسارات</a>
      <section class="path-hero card">
        <div class="ph-main">
          ${m ? `<a href="#/chat/${m.id}" class="ph-av">${av(m, 88, { mood: s.pct === 1 ? 'happy' : 'idle' })}</a>` : ''}
          <div>
            <small class="muted">مسار من ${esc(m?.name || 'مدرّب محذوف')} · ${timeAgo(p.createdAt)}</small>
            <h1>${esc(p.title)}</h1>
            <p>${esc(p.summary)}</p>
            <div class="tags"><span class="tag">${icon('bolt', 13)} ${esc(p.level)}</span><span class="tag">${icon('calendar', 13)} ${p.weeks} أسابيع</span><span class="tag">${icon('clock', 13)} ${p.hoursPerWeek} س/أسبوع</span><span class="tag">${icon('book', 13)} ${s.all.length} درس</span></div>
          </div>
        </div>
        <div class="ph-side">
          ${ring(s.pct, { size: 108, stroke: 10, label: `${Math.round(s.pct * 100)}%` })}
          <small class="muted">${s.done} من ${s.all.length} دروس</small>
          ${nextId ? `<button class="btn primary" data-open="${nextId}">${icon('play', 16)} تابع التعلّم</button>` : `<span class="badge gold">${icon('trophy', 14)} مكتمل</span>`}
          <button class="link small danger" id="delPath">${icon('trash', 13)} حذف المسار</button>
        </div>
      </section>

      <section class="journey" id="journey">
        <svg class="road" id="road" aria-hidden="true"></svg>
        <div class="journey-start">${icon('flag', 16)} نقطة الانطلاق</div>
        ${p.modules.map((mod, mi) => `
          <div class="module">
            <div class="module-banner"><span class="mnum">${mi + 1}</span><div><b>${esc(mod.title)}</b>${mod.goal ? `<small>${esc(mod.goal)}</small>` : ''}</div></div>
            ${mod.lessons.map(l => {
              const t = LESSON_TYPES[l.type] || LESSON_TYPES.concept;
              const st = l.done ? 'done' : l.id === nextId ? 'next' : 'todo';
              const x = Math.round(Math.sin(idx++ * 0.95) * 34);
              return `<div class="node-row" style="--x:${x}%"><button class="node ${st}" data-open="${l.id}">
                <span class="node-dot">${icon(l.done ? 'check' : t.icon, 20)}</span>
                <span class="node-card"><b>${esc(l.title)}</b><small>${t.label} · ${l.duration} د${st === 'next' ? ' · <em>التالي</em>' : ''}</small></span>
              </button></div>`;
            }).join('')}
          </div>`).join('')}
        <div class="journey-end ${s.pct === 1 ? 'done' : ''}">${icon('trophy', 22)}<b>${s.pct === 1 ? 'أنجزت المسار!' : 'خط النهاية'}</b></div>
      </section>
    </div>`;
    requestAnimationFrame(drawRoad);
  }

  function drawRoad() {
    const j = root.querySelector('#journey');
    const svg = root.querySelector('#road');
    if (!j || !svg) return;
    const jr = j.getBoundingClientRect();
    const pts = [...j.querySelectorAll('.node-dot')].map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left - jr.left + r.width / 2, y: r.top - jr.top + r.height / 2, done: el.closest('.node').classList.contains('done') };
    });
    svg.setAttribute('viewBox', `0 0 ${jr.width} ${jr.height}`);
    svg.setAttribute('width', jr.width);
    svg.setAttribute('height', jr.height);
    if (pts.length < 2) { svg.innerHTML = ''; return; }
    const path = arr => arr.map((pt, i) => {
      if (!i) return `M${pt.x},${pt.y}`;
      const pr = arr[i - 1], my = (pr.y + pt.y) / 2;
      return `C${pr.x},${my} ${pt.x},${my} ${pt.x},${pt.y}`;
    }).join(' ');
    let lastDone = -1;
    pts.forEach((pt, i) => { if (pt.done) lastDone = i; });
    const progress = pts.slice(0, Math.min(pts.length, lastDone + 2));
    svg.innerHTML = `<defs><linearGradient id="roadGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      <path d="${path(pts)}" class="road-base"/>
      <path d="${path(pts)}" class="road-dash"/>
      ${lastDone >= 0 ? `<path d="${path(progress)}" class="road-done"/>` : ''}`;
  }

  function openLesson(lid) {
    const mod = p.modules.find(x => x.lessons.some(l => l.id === lid));
    const l = mod.lessons.find(x => x.id === lid);
    const t = LESSON_TYPES[l.type] || LESSON_TYPES.concept;
    const dr = openDrawer({
      title: `${icon(t.icon, 18)} ${esc(l.title)}`,
      body: `<div class="lesson-detail">
        <div class="tags"><span class="tag">${t.label}</span><span class="tag">${icon('clock', 13)} ${l.duration} دقيقة</span><span class="tag">${esc(mod.title)}</span>${l.done ? `<span class="tag ok">${icon('check', 13)} منجز</span>` : ''}</div>
        <h4>${icon('target', 15)} هدف الدرس</h4><p>${esc(l.objective || '—')}</p>
        ${l.outline?.length ? `<h4>${icon('book', 15)} المحاور</h4><ol class="outline">${l.outline.map(o => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}
        ${l.exercise ? `<h4>${icon('bolt', 15)} التمرين</h4><div class="exercise">${esc(l.exercise)}</div>` : ''}
        ${l.resources?.length ? `<h4>${icon('notebook', 15)} مصادر مقترحة</h4><ul class="resources">${l.resources.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        <div class="lesson-cta">
          ${m ? `<a class="btn primary lg" href="#/chat/${m.id}?lesson=${p.id}:${l.id}">${av(m, 26)} ابدأ الدرس مع ${esc(m.name)}</a>` : ''}
          <button class="btn ${l.done ? 'ghost' : 'success'}" id="toggleDone">${icon(l.done ? 'refresh' : 'check', 16)} ${l.done ? 'إرجاع لغير منجز' : 'علّمه كمنجز'}</button>
        </div>
      </div>`,
    });
    dr.el.querySelector('a.btn')?.addEventListener('click', () => dr.close());
    dr.el.querySelector('#toggleDone').onclick = async () => {
      const r = await api.patch(`/api/paths/${p.id}/lessons/${l.id}`, { done: !l.done });
      p = r.path;
      upsert('paths', p);
      applyProfile(r.profile, r.gained);
      if (r.gained) {
        confetti({ count: r.pathDone ? 280 : 120, spread: r.pathDone ? 1.6 : 1 });
        sound.success();
        toast(r.pathDone ? `${icon('trophy', 16)} أنهيت المسار بالكامل! 🎓` : `${icon('check', 16)} درس منجز — ${esc(m?.name || '')} سجّلها بذاكرته`, { type: 'gold' });
      }
      dr.close();
      paint();
    };
  }

  root.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]');
    if (o) return openLesson(o.dataset.open);
    if (e.target.closest('#delPath')) {
      if (!(await confirmBox(`حذف مسار «${esc(p.title)}»؟`, { danger: true, okText: 'احذف' }))) return;
      await api.del(`/api/paths/${p.id}`);
      removeFrom('paths', p.id);
      location.hash = '#/paths';
    }
  });
  const onResize = () => drawRoad();
  addEventListener('resize', onResize);
  paint();
  if (query.get('lesson')) setTimeout(() => openLesson(query.get('lesson')), 250);
  return () => removeEventListener('resize', onResize);
}
