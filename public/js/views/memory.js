import { state, mentorById } from '../store.js';
import { api } from '../api.js';
import { MEMORY_SECTIONS, MEMORY_ICONS } from '../catalog.js';
import { av } from '../components.js';
import { esc, icon, toast, confirmBox, download, timeAgo, sound } from '../ui.js';

export async function render(root, [id]) {
  let mentor = mentorById(id) || state.mentors.find(m => m.role !== 'director') || state.mentors[0];
  let data = null;
  let raw = false;

  async function load() {
    data = await api.get(`/api/mentors/${mentor.id}/memory`);
    paint();
  }

  function paint() {
    const total = data.sections.reduce((s, x) => s + x.items.length, 0);
    const sections = [...new Set([...MEMORY_SECTIONS, ...data.sections.map(s => s.name)])];
    root.innerHTML = `
    <div class="page memory">
      <div class="page-head">
        <div><h1>${icon('brain', 26)} الذاكرة</h1><p class="muted">لكل مدرّب ملف ذاكرة خاص فيه. بيقراه قبل كل رد، وبيحدّثه لحاله بعد المحادثات — وإنت صاحب الكلمة الأخيرة: عدّل، احذف، أو صدّر.</p></div>
      </div>
      <div class="mem-tabs">${state.mentors.map(m => `<a href="#/memory/${m.id}" class="mem-tab ${m.id === mentor.id ? 'on' : ''}">${av(m, 30)}<span>${esc(m.name)}</span></a>`).join('')}</div>

      <section class="mem-head card">
        <div class="mh-av">${av(mentor, 76, { mood: 'thinking' })}</div>
        <div class="mh-info">
          <h2>دفتر ذاكرة ${esc(mentor.name)}</h2>
          <div class="file-chip" dir="ltr">${icon('file', 14)} ${esc(data.file)}</div>
          <small class="muted">${total} ملاحظة · آخر تحديث ${timeAgo(data.updatedAt)}</small>
        </div>
        <div class="mh-actions">
          <button class="btn ${raw ? 'primary' : 'subtle'} sm" id="rawBtn">${icon('code', 15)} ${raw ? 'عرض البطاقات' : 'تحرير الملف الخام'}</button>
          <button class="btn subtle sm" id="exportBtn">${icon('download', 15)} تصدير .md</button>
          <button class="btn ghost sm danger" id="resetBtn">${icon('trash', 15)} تصفير</button>
        </div>
      </section>

      <div class="how card">
        <span>${icon('eye', 16)} <b>كيف تعمل؟</b></span>
        <span>① تحكي مع ${esc(mentor.name)}</span><span>② محرّك الذاكرة يستخرج المعلومات الدائمة المهمة</span><span>③ تنكتب هون فوراً</span><span>④ ${esc(mentor.name)} يقرأها قبل كل رد</span>
      </div>

      ${raw ? `<div class="raw card"><textarea id="rawText" spellcheck="false" dir="auto">${esc(data.markdown)}</textarea>
        <div class="row end gap"><button class="btn ghost" id="cancelRaw">إلغاء</button><button class="btn primary" id="saveRaw">${icon('check', 16)} حفظ الملف</button></div></div>`
      : `<div class="mem-sections">${sections.map(name => {
        const sec = data.sections.find(s => s.name === name) || { items: [] };
        return `<section class="mem-sec card" data-sec="${esc(name)}">
          <h3><span class="ms-ic">${MEMORY_ICONS[name] || '🗂️'}</span>${esc(name)}<small>${sec.items.length}</small></h3>
          <ul>${sec.items.map(it => `<li><span>${esc(it)}</span><button class="icon-btn xs" data-rm="${esc(it)}" aria-label="حذف">${icon('x', 13)}</button></li>`).join('') || '<li class="muted empty-li">فاضي — رح يتعبّى مع الوقت</li>'}</ul>
          <form class="mem-add" data-add="${esc(name)}"><input class="input sm" placeholder="أضف ملاحظة…" maxlength="300"><button class="icon-btn sm" aria-label="أضف">${icon('plus', 15)}</button></form>
        </section>`;
      }).join('')}</div>`}
    </div>`;
  }

  root.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('#rawBtn')) { raw = !raw; paint(); return; }
    if (t.closest('#cancelRaw')) { raw = false; paint(); return; }
    if (t.closest('#saveRaw')) {
      data = { ...data, ...(await api.put(`/api/mentors/${mentor.id}/memory`, { markdown: root.querySelector('#rawText').value })) };
      raw = false;
      toast(`${icon('check', 16)} انحفظ ملف الذاكرة — ${esc(mentor.name)} رح يعتمده من الرد الجاي`, { type: 'success' });
      paint();
      return;
    }
    if (t.closest('#exportBtn')) return download(`memory-${mentor.name}.md`, data.markdown);
    if (t.closest('#resetBtn')) {
      if (!(await confirmBox(`تصفير ذاكرة ${esc(mentor.name)}؟ رح ينسى كل شي تعلّمه عنك.`, { danger: true, okText: 'صفّر' }))) return;
      data = { ...data, ...(await api.post(`/api/mentors/${mentor.id}/memory/reset`)) };
      paint();
      return;
    }
    const rm = t.closest('[data-rm]');
    if (rm) {
      rm.closest('li').classList.add('removing');
      data = { ...data, ...(await api.del(`/api/mentors/${mentor.id}/memory/items`, { text: rm.dataset.rm })) };
      setTimeout(paint, 180);
    }
  });

  root.addEventListener('submit', async e => {
    const f = e.target.closest('[data-add]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const r = await api.post(`/api/mentors/${mentor.id}/memory/items`, { section: f.dataset.add, text });
    data = { ...data, ...r };
    if (!r.added.length) toast('هاي الملاحظة موجودة أصلاً');
    else sound.pop();
    paint();
    root.querySelector(`[data-add="${CSS.escape(f.dataset.add)}"] input`)?.focus();
  });

  await load();
}
