import { state, mentorById, applyProfile, upsert, removeFrom, reminders } from '../store.js';
import { api } from '../api.js';
import { av, goalModal, pathWizard, emptyState } from '../components.js';
import { esc, icon, ring, dueLabel, fmtDate, toast, confetti, sound, confirmBox } from '../ui.js';

export async function render(root) {
  function paint() {
    const active = state.goals.filter(g => g.status !== 'done').sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
    const done = state.goals.filter(g => g.status === 'done');
    const rem = reminders().filter(r => r.goal);
    root.innerHTML = `
    <div class="page goals">
      <div class="page-head">
        <div><h1>${icon('target', 26)} الأهداف</h1><p class="muted">كل هدف له مدرّب مسؤول يتابعك ويذكّرك فيه بالمحادثات — ويرتّبلك محطاته بخطة SMART.</p></div>
        <button class="btn primary" id="newGoal">${icon('plus', 18)} هدف جديد</button>
      </div>
      ${rem.length ? `<div class="reminders">${rem.map(r => `<div class="rem-card ${r.level}">${icon(r.icon, 18)}<span>${esc(r.text)}</span></div>`).join('')}</div>` : ''}
      ${active.length ? `<div class="goal-grid">${active.map(goalCard).join('')}</div>`
        : emptyState('target', 'ما في أهداف نشطة', 'الهدف الواضح مع موعد ومدرّب يتابعك = نص الإنجاز.', `<button class="btn primary" id="newGoal2">${icon('plus', 18)} أضف هدفك الأول</button>`)}
      ${done.length ? `<details class="done-goals"><summary>${icon('trophy', 18)} أهداف محقّقة (${done.length})</summary><div class="goal-grid">${done.map(goalCard).join('')}</div></details>` : ''}
    </div>`;
  }

  function goalCard(g) {
    const m = mentorById(g.mentorId);
    const total = g.milestones?.length || 0, doneN = g.milestones?.filter(x => x.done).length || 0;
    const pct = g.status === 'done' ? 1 : total ? doneN / total : 0;
    const due = dueLabel(g.deadline);
    return `<article class="goal-card card ${g.status === 'done' ? 'is-done' : ''}" data-goal="${g.id}">
      <div class="gc-top">
        ${ring(pct, { size: 64, stroke: 7, label: `${Math.round(pct * 100)}%` })}
        <div class="gc-title"><h3>${esc(g.title)}</h3>${g.smartTitle && g.smartTitle !== g.title ? `<small class="smart">SMART: ${esc(g.smartTitle)}</small>` : ''}${g.why ? `<p class="muted">${esc(g.why)}</p>` : ''}</div>
        <div class="gc-menu"><button class="icon-btn sm" data-edit="${g.id}" title="تعديل">${icon('edit', 15)}</button><button class="icon-btn sm" data-del="${g.id}" title="حذف">${icon('trash', 15)}</button></div>
      </div>
      <div class="gc-meta">
        <span class="due ${g.status === 'done' ? 'ok' : due.cls}">${icon(g.status === 'done' ? 'trophy' : 'calendar', 13)} ${g.status === 'done' ? 'تحقّق!' : `${due.text}${g.deadline ? ` · ${fmtDate(g.deadline)}` : ''}`}</span>
        ${m ? `<a class="gc-mentor" href="#/chat/${m.id}">${av(m, 22)} ${esc(m.name)}</a>` : ''}
        ${g.reminder && g.reminder !== 'none' ? `<span class="tag">${icon('bell', 12)} ${g.reminder === 'daily' ? 'تذكير يومي' : 'تذكير أسبوعي'}</span>` : ''}
      </div>
      ${total ? `<ul class="milestones">${g.milestones.map(ms => `<li class="${ms.done ? 'done' : ''}"><label><input type="checkbox" data-ms="${g.id}:${ms.id}" ${ms.done ? 'checked' : ''} ${g.status === 'done' ? 'disabled' : ''}><span class="cb">${icon('check', 13)}</span><span>${esc(ms.text)}</span>${ms.due ? `<small>${fmtDate(ms.due)}</small>` : ''}</label></li>`).join('')}</ul>`
        : g.status !== 'done' ? `<div class="no-ms">${icon('wand', 18)}<span>خلّي ${esc(m?.name || 'المدرّب')} يقسّم الهدف لمحطات واضحة</span><button class="btn subtle sm" data-plan="${g.id}">رتّب الخطة</button></div>` : ''}
      ${g.firstStep && g.status !== 'done' ? `<div class="first-step">${icon('bolt', 15)}<div><small>خطوة اليوم (15 دقيقة)</small><p>${esc(g.firstStep)}</p></div></div>` : ''}
      ${g.motivation && g.status !== 'done' ? `<p class="motivation">«${esc(g.motivation)}» <small>— ${esc(mentorById(g.plannedBy)?.name || m?.name || '')}</small></p>` : ''}
      <div class="gc-actions">
        ${g.status === 'done'
          ? `<button class="btn ghost sm" data-reopen="${g.id}">${icon('refresh', 14)} إعادة فتح</button>`
          : `${m ? `<a class="btn subtle sm" href="#/chat/${m.id}?q=${encodeURIComponent(`راجع معي تقدّمي في هدف «${g.title}» وقل لي الخطوة التالية بالضبط.`)}">${icon('message', 14)} راجعه مع ${esc(m.name)}</a>` : ''}
             <button class="btn subtle sm" data-path="${g.id}">${icon('route', 14)} مسار له</button>
             ${total ? `<button class="btn ghost sm" data-plan="${g.id}">${icon('wand', 14)} أعد التخطيط</button>` : ''}
             <button class="btn success sm" data-complete="${g.id}">${icon('trophy', 14)} تحقّق!</button>`}
      </div>
    </article>`;
  }

  root.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('#newGoal,#newGoal2')) return goalModal({}, { onSaved: paint });
    const edit = t.closest('[data-edit]');
    if (edit) return goalModal(state.goals.find(g => g.id === edit.dataset.edit), { onSaved: paint });
    const del = t.closest('[data-del]');
    if (del) {
      if (!(await confirmBox('حذف هذا الهدف؟', { danger: true, okText: 'احذف' }))) return;
      await api.del(`/api/goals/${del.dataset.del}`);
      removeFrom('goals', del.dataset.del);
      return paint();
    }
    const plan = t.closest('[data-plan]');
    if (plan) {
      const card = plan.closest('.goal-card');
      card.classList.add('loading');
      plan.disabled = true;
      plan.innerHTML = `<span class="typing sm"><i></i><i></i><i></i></span>`;
      try {
        const r = await api.post(`/api/goals/${plan.dataset.plan}/plan`);
        upsert('goals', r.goal);
        sound.chime();
        toast(`${icon('wand', 16)} انرتّبت خطة الهدف`, { type: 'success' });
      } catch (err) { toast(esc(err.message), { type: 'error' }); }
      return paint();
    }
    const comp = t.closest('[data-complete]');
    if (comp) {
      const r = await api.post(`/api/goals/${comp.dataset.complete}/complete`);
      upsert('goals', r.goal);
      applyProfile(r.profile, r.gained);
      confetti({ count: 300, spread: 1.8 });
      sound.fanfare();
      toast(`${icon('trophy', 18)} مبروك! حقّقت «${esc(r.goal.title)}» 🏆`, { type: 'gold', timeout: 5000 });
      return paint();
    }
    const re = t.closest('[data-reopen]');
    if (re) { const r = await api.post(`/api/goals/${re.dataset.reopen}/reopen`); upsert('goals', r.goal); return paint(); }
    const pth = t.closest('[data-path]');
    if (pth) { const g = state.goals.find(x => x.id === pth.dataset.path); return pathWizard({ mentorId: g.mentorId, topic: g.title, goalId: g.id }); }
  });

  root.addEventListener('change', async e => {
    const cb = e.target.closest('[data-ms]');
    if (!cb) return;
    const [gid, mid] = cb.dataset.ms.split(':');
    try {
      const r = await api.patch(`/api/goals/${gid}/milestones/${mid}`, { done: cb.checked });
      upsert('goals', r.goal);
      applyProfile(r.profile, r.gained);
      if (r.gained) { sound.success(); confetti({ count: 50 }); }
      const g = r.goal;
      if (g.milestones.length && g.milestones.every(m => m.done)) toast(`${icon('trophy', 16)} خلصت كل المحطات! اضغط «تحقّق» للاحتفال`, { type: 'gold' });
    } catch (err) { toast(esc(err.message), { type: 'error' }); cb.checked = !cb.checked; }
    paint();
  });

  paint();
}
