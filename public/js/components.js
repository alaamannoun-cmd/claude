// Shared UI components (avatars, meters, goal editor, path wizard) used across views.
import { avatarSVG } from './avatar.js';
import { TRAITS, bondInfo } from './catalog.js';
import { state, team, mentorById, applyProfile, upsert } from './store.js';
import { api } from './api.js';
import { esc, icon, openModal, toast, todayStr, sound, confetti } from './ui.js';

export function av(m, size = 40, { mood = 'idle', round = false, cls = '' } = {}) {
  const still = size < 56 ? 'still' : '';
  return `<span class="av ${round ? 'round' : ''} ${cls}" style="--s:${size}px" data-mentor="${esc(m?.id || '')}">${avatarSVG(m?.avatar, { mood, cls: still, label: m?.name })}</span>`;
}

export function bondMeter(m) {
  const b = bondInfo(m.bond || 0);
  return `<div class="bond" title="مستوى الصلة مع ${esc(m.name)}"><span>${icon('heart', 12)} ${b.title}</span><i><b style="width:${Math.round(b.pct * 100)}%"></b></i></div>`;
}

export function traitBars(p = {}, compact = false) {
  return `<div class="traits ${compact ? 'compact' : ''}">${TRAITS.map(t => `
    <div class="trait"><span>${t.icon} ${t.label}</span><i><b style="width:${p[t.id] ?? 50}%"></b></i></div>`).join('')}</div>`;
}

export function mentorOptions(selected, { includeDirector = false, emptyLabel = '' } = {}) {
  const list = includeDirector ? state.mentors : team();
  return `${emptyLabel ? `<option value="">${emptyLabel}</option>` : ''}${list.map(m => `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)} — ${esc(m.title)}</option>`).join('')}`;
}

export function mentorPicker(name, selected, list = team()) {
  return `<div class="mentor-pick" data-pick="${name}">${list.map(m => `
    <button type="button" class="mp ${m.id === selected ? 'on' : ''}" data-id="${m.id}">${av(m, 34)}<span>${esc(m.name)}</span></button>`).join('')}</div>`;
}
export function bindPicker(root, name, onChange, multi = false) {
  const box = root.querySelector(`[data-pick="${name}"]`);
  box?.addEventListener('click', e => {
    const b = e.target.closest('.mp');
    if (!b) return;
    if (multi) b.classList.toggle('on');
    else { box.querySelectorAll('.mp').forEach(x => x.classList.toggle('on', x === b)); }
    sound.pop();
    onChange?.(multi ? [...box.querySelectorAll('.mp.on')].map(x => x.dataset.id) : b.dataset.id);
  });
}

// ---------------- Goal editor ----------------
export function goalModal(goal = {}, { onSaved } = {}) {
  const isNew = !goal.id;
  const deadline = goal.deadline || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return todayStr(d); })();
  const ms = goal.milestones || [];
  const m = openModal({
    title: isNew ? `${icon('target', 18)} هدف جديد` : `${icon('edit', 18)} تعديل الهدف`,
    wide: true,
    body: `<form class="form" id="goalForm">
      <label class="field"><span>ما الهدف؟</span><input class="input" name="title" required maxlength="160" value="${esc(goal.title || '')}" placeholder="مثال: أبني موقعي الشخصي وأنشره"></label>
      <label class="field"><span>ليش مهم إلك؟ <small>(الدافع يخلّي المدرّب يحفّزك صح)</small></span><textarea class="input" name="why" rows="2" maxlength="400" placeholder="مثال: بدي أشتغل فريلانس">${esc(goal.why || '')}</textarea></label>
      <div class="grid-2 tight">
        <label class="field"><span>الموعد النهائي</span><input class="input" type="date" name="deadline" value="${deadline}" min="${todayStr()}"></label>
        <label class="field"><span>التذكير</span><select class="input" name="reminder">
          ${[['daily', 'يومي'], ['weekly', 'أسبوعي'], ['none', 'بدون']].map(([v, l]) => `<option value="${v}" ${goal.reminder === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
      </div>
      <div class="field"><span>المدرّب المسؤول</span>${team().length ? mentorPicker('gm', goal.mentorId || team()[0]?.id) : '<p class="muted">ما عندك مدرّبين بعد.</p>'}</div>
      <div class="field"><span>المحطات <small>(اختياري — أو خلّي المدرّب يرتّبها)</small></span>
        <div class="ms-edit" id="msEdit">${ms.map(x => msRow(x)).join('')}</div>
        <button type="button" class="btn subtle sm" id="addMs">${icon('plus', 16)} محطة</button>
      </div>
      <div class="row end gap">
        <button type="button" class="btn ghost" data-close>إلغاء</button>
        ${isNew ? `<button type="submit" class="btn subtle" name="plan" value="1">${icon('wand', 16)} احفظ ورتّبها مع المدرّب</button>` : ''}
        <button type="submit" class="btn primary">${icon('check', 16)} حفظ</button>
      </div>
    </form>`,
  });
  let mentorId = goal.mentorId || team()[0]?.id || null;
  bindPicker(m.el, 'gm', id => { mentorId = id; });
  const list = m.el.querySelector('#msEdit');
  m.el.querySelector('#addMs').onclick = () => { list.insertAdjacentHTML('beforeend', msRow({})); list.lastElementChild.querySelector('input').focus(); };
  list.addEventListener('click', e => { if (e.target.closest('[data-rm]')) e.target.closest('.ms-row').remove(); });
  m.el.querySelector('#goalForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const withPlan = e.submitter?.name === 'plan';
    const payload = {
      title: f.get('title'), why: f.get('why'), deadline: f.get('deadline'), reminder: f.get('reminder'), mentorId,
      milestones: [...list.querySelectorAll('.ms-row')].map(r => ({ id: r.dataset.id || undefined, text: r.querySelector('input').value, done: r.dataset.done === '1' })),
    };
    const btns = e.target.querySelectorAll('button[type=submit]');
    btns.forEach(b => (b.disabled = true));
    try {
      let saved;
      if (isNew) {
        const r = await api.post('/api/goals', payload);
        saved = r.goal;
        applyProfile(r.profile, r.gained);
        if (withPlan) {
          toast(`${icon('wand', 16)} المدرّب يرتّب خطة هدفك…`);
          saved = (await api.post(`/api/goals/${saved.id}/plan`)).goal;
        }
        sound.success();
        confetti({ count: 60 });
      } else {
        saved = (await api.put(`/api/goals/${goal.id}`, payload)).goal;
      }
      upsert('goals', saved);
      m.close();
      toast(`${icon('target', 16)} ${isNew ? 'انضاف الهدف — المدرّب رح يذكّرك فيه' : 'تم حفظ التعديلات'}`, { type: 'success' });
      onSaved?.(saved);
    } catch (err) {
      toast(esc(err.message), { type: 'error' });
      btns.forEach(b => (b.disabled = false));
    }
  });
  return m;
}
const msRow = ms => `<div class="ms-row" data-id="${esc(ms.id || '')}" data-done="${ms.done ? 1 : 0}"><input class="input" value="${esc(ms.text || '')}" placeholder="محطة قابلة للقياس"><button type="button" class="icon-btn sm" data-rm aria-label="حذف">${icon('x', 16)}</button></div>`;

// ---------------- Learning path wizard ----------------
const GEN_STEPS = ['يقرأ ذاكرته عنك…', 'يحدّد مستواك ونقطة البداية…', 'يقسّم المنهج إلى وحدات…', 'يصمّم الدروس والتمارين…', 'يرتّب المصادر ويراجع الخطة…'];

export function pathWizard({ mentorId, topic = '', goalId = '' } = {}) {
  const list = team();
  if (!list.length) { toast('صمّم مدرّباً أولاً من «صانع المدربين»', { type: 'error' }); location.hash = '#/forge'; return; }
  let chosen = mentorId && mentorById(mentorId) ? mentorId : list[0].id;
  let level = 'مبتدئ';
  const m = openModal({
    title: `${icon('route', 18)} رتّبلي مسار تعلّم`,
    wide: true,
    body: `<form class="form" id="pathForm">
      <div class="field"><span>مين يرتّب المسار؟</span>${mentorPicker('pm', chosen, list)}</div>
      <label class="field"><span>شو بدك تتعلّم؟</span><input class="input" name="topic" required maxlength="300" value="${esc(topic)}" placeholder="مثال: تصميم نظام طاقة شمسية On-grid لبيت"></label>
      <div class="field"><span>مستواك الحالي</span><div class="chips" id="lvl">${['مبتدئ', 'متوسط', 'متقدّم'].map(l => `<button type="button" class="chip ${l === level ? 'on' : ''}" data-v="${l}">${l}</button>`).join('')}</div></div>
      <div class="grid-2 tight">
        <label class="field"><span>ساعات أسبوعياً: <b id="hv">5</b></span><input type="range" class="slider" name="hours" min="1" max="20" value="5"></label>
        <label class="field"><span>المدة: <b id="wv">6</b> أسابيع</span><input type="range" class="slider" name="weeks" min="2" max="16" value="6"></label>
      </div>
      <div class="grid-2 tight">
        <label class="field"><span>ربطه بهدف <small>(اختياري)</small></span><select class="input" name="goalId"><option value="">بدون</option>${state.goals.filter(g => g.status !== 'done').map(g => `<option value="${g.id}" ${g.id === goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>
        <label class="field"><span>ملاحظات للمدرّب <small>(اختياري)</small></span><input class="input" name="notes" maxlength="600" placeholder="مثلاً: بفضّل الفيديوهات، وعندي لابتوب ضعيف"></label>
      </div>
      <div class="row end gap"><button type="button" class="btn ghost" data-close>إلغاء</button><button type="submit" class="btn primary lg">${icon('wand', 18)} ابنِ المسار</button></div>
    </form>
    <div class="gen" id="gen" hidden></div>`,
  });
  const el = m.el;
  bindPicker(el, 'pm', id => { chosen = id; });
  el.querySelector('#lvl').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    level = b.dataset.v;
    el.querySelectorAll('#lvl .chip').forEach(x => x.classList.toggle('on', x === b));
  });
  const f = el.querySelector('#pathForm');
  f.hours.oninput = () => (el.querySelector('#hv').textContent = f.hours.value);
  f.weeks.oninput = () => (el.querySelector('#wv').textContent = f.weeks.value);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const mentor = mentorById(chosen);
    const gen = el.querySelector('#gen');
    f.hidden = true; gen.hidden = false;
    gen.innerHTML = `<div class="gen-stage">${av(mentor, 120, { mood: 'thinking' })}<h3>${esc(mentor.name)} يرتّب منهجك</h3><ol class="gen-steps">${GEN_STEPS.map(s => `<li>${s}</li>`).join('')}</ol></div>`;
    const items = gen.querySelectorAll('.gen-steps li');
    let k = 0;
    items[0].classList.add('now');
    const timer = setInterval(() => {
      if (k < items.length - 1) { items[k].classList.replace('now', 'done'); items[++k].classList.add('now'); }
    }, 1800);
    try {
      const r = await api.post('/api/paths/generate', {
        mentorId: chosen, topic: f.topic.value, level, hoursPerWeek: +f.hours.value, weeks: +f.weeks.value, goalId: f.goalId.value, notes: f.notes.value,
      });
      clearInterval(timer);
      upsert('paths', r.path);
      applyProfile(r.profile, r.gained);
      sound.success();
      confetti({ count: 90 });
      m.close();
      location.hash = `#/paths/${r.path.id}`;
    } catch (err) {
      clearInterval(timer);
      toast(esc(err.message), { type: 'error' });
      f.hidden = false; gen.hidden = true;
    }
  });
}

export function emptyState(ic, title, text, action = '') {
  return `<div class="empty">${icon(ic, 34)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}
