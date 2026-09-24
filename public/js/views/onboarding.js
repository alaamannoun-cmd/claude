// First-run experience: meet the Director → (optional) API key → your goal → the Director proposes a team.
import { api } from '../api.js';
import { randomAvatar, modelInfo } from '../avatar.js';
import { av, stageBox, mountStages, setMood, feedSpeech, stageReady } from '../components.js';
import { DIRECTOR } from '../templates.js';
import { TRAITS } from '../catalog.js';
import { esc, icon, toast, confetti, sound, autoGrow } from '../ui.js';
import { state } from '../store.js';

const EXAMPLES = ['أتعلّم برمجة الويب وأشتغل فريلانس', 'أحسّن الإنجليزي للمقابلات', 'أنزل 8 كيلو خلال 3 شهور', 'أصمّم أنظمة طاقة شمسية', 'أطلق مشروعي الخاص', 'أدخل مجال الذكاء الاصطناعي'];

export async function render(root, onDone) {
  const d = state.mentors.find(m => m.role === 'director') || DIRECTOR;
  const s = { step: 0, name: state.profile?.name || '', goal: '', level: 'مبتدئ', hours: 6, days: 90, proposal: null, off: new Set() };

  const frame = inner => `
    <div class="onb">
      <div class="onb-card">
        <div class="onb-dots">${[0, 1, 2, 3].map(i => `<i class="${i === s.step ? 'on' : i < s.step ? 'done' : ''}"></i>`).join('')}</div>
        ${inner}
      </div>
    </div>`;

  function say(text) {
    return `<div class="onb-director">
      <div class="onb-av">${stageBox(d, { framing: 'portrait', mood: 'talking' })}</div>
      <div class="bubble-say"><b>${esc(d.name)}</b><p id="sayText" data-full="${esc(text)}"></p></div>
    </div>`;
  }

  async function typeOut() {
    const p = root.querySelector('#sayText');
    if (!p) return;
    await stageReady(root.querySelector('.onb-av'));
    if (!p.isConnected) return;
    const full = p.dataset.full;
    let i = 0;
    const tick = () => {
      const next = Math.min(full.length, i + 2);
      feedSpeech(root.querySelector('.onb-av'), full.slice(i, next));
      i = next;
      p.textContent = full.slice(0, i);
      if (i < full.length) setTimeout(tick, 16);
      else setMood(root.querySelector('.onb-av'), 'idle');
    };
    tick();
  }

  const steps = [
    () => frame(`
      ${say(`أهلاً فيك بـ«مجلس»! أنا ${d.name}، مدير مجلسك. هون بتبني فريق مدرّبين خاص فيك: كل مدرّب إله شخصية وشكل بتختاره، وذاكرة بتتذكّرك، وأنا بوزّع الشغل بينهم وبذكّرك بأهدافك. خلّينا نتعرّف — شو اسمك؟`)}
      <form class="onb-form" id="f0">
        <input class="input lg" name="name" required maxlength="40" placeholder="اسمك" value="${esc(s.name)}" autocomplete="given-name">
        <button class="btn primary lg">يلا نبدأ ${icon('chevL', 18)}</button>
      </form>
      <div class="onb-pillars">
        <div>${icon('sparkles', 18)}<b>صمّم مدرّبك</b><small>شخصية، أسلوب، ومظهر</small></div>
        <div>${icon('brain', 18)}<b>ذاكرة لكل مدرّب</b><small>ملف يتطوّر معك</small></div>
        <div>${icon('users', 18)}<b>مجلس ومدير</b><small>مدرّبون يتعاونون</small></div>
        <div>${icon('route', 18)}<b>مسارات وأهداف</b><small>منظّمة ومتابَعة</small></div>
      </div>`),
    () => frame(`
      ${say(`تشرّفنا يا ${s.name}! عشان نشغّل عقل المدرّبين الحقيقي بدنا مفتاح DeepSeek. المفتاح بينحفظ على جهازك بالسيرفر المحلي بس، وما بيوصل للمتصفح. إذا ما عندك هلّق، جرّب الوضع التجريبي وضيفه بعدين.`)}
      <form class="onb-form col" id="f1">
        <div class="input-icon">${icon('key', 18)}<input class="input lg" name="key" type="password" placeholder="sk-…" autocomplete="off" dir="ltr" value=""></div>
        <div class="row gap wrap center">
          <button class="btn primary lg" name="save" value="1">${icon('check', 18)} احفظ وكمّل</button>
          <button type="button" class="btn ghost lg" id="skipKey">${icon('bolt', 18)} جرّب بالوضع التجريبي</button>
        </div>
        ${state.config.hasKey ? `<p class="ok-note">${icon('check', 16)} في مفتاح محفوظ مسبقاً (${esc(state.config.keyHint)}) — تقدر تكمّل مباشرة.</p>` : ''}
      </form>`),
    () => frame(`
      ${say(`ممتاز! هلّق أهم سؤال: شو الشي اللي بدك توصله؟ احكيلي بكلماتك، وأنا برتّبلك الفريق المناسب.`)}
      <form class="onb-form col" id="f2">
        <textarea class="input lg" name="goal" required rows="2" maxlength="500" placeholder="مثال: بدي أتعلّم تصميم أنظمة الطاقة الشمسية وأبني موقع يحسبها">${esc(s.goal)}</textarea>
        <div class="chips wrap">${EXAMPLES.map(e => `<button type="button" class="chip" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <div class="grid-3 tight">
          <div class="field"><span>مستواك</span><div class="chips" id="lvl">${['مبتدئ', 'متوسط', 'متقدّم'].map(l => `<button type="button" class="chip ${l === s.level ? 'on' : ''}" data-v="${l}">${l}</button>`).join('')}</div></div>
          <label class="field"><span>وقتك أسبوعياً: <b id="hv">${s.hours}</b> ساعة</span><input type="range" class="slider" name="hours" min="1" max="30" value="${s.hours}"></label>
          <div class="field"><span>بدك توصل خلال</span><div class="chips" id="days">${[[30, 'شهر'], [90, '3 شهور'], [180, '6 شهور']].map(([v, l]) => `<button type="button" class="chip ${v === s.days ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div></div>
        </div>
        <button class="btn primary lg">${icon('users', 18)} رتّبلي الفريق</button>
      </form>`),
    () => frame(s.proposal ? `
      ${say(s.proposal.message || 'هاد الفريق اللي اخترته إلك:')}
      <div class="proposal">${s.proposal.mentors.map((m, i) => `
        <div class="prop-card ${s.off.has(i) ? 'off' : ''}" data-i="${i}">
          <button class="prop-toggle" data-toggle="${i}" aria-label="تضمين/استبعاد">${icon(s.off.has(i) ? 'plus' : 'check', 16)}</button>
          <div class="prop-av">${av(m, 120)}<button class="icon-btn sm dice" data-dice="${i}" title="غيّر الشكل">${icon('shuffle', 15)}</button></div>
          <h3>${esc(m.name)}</h3><p class="prop-title">${esc(m.title)}</p>
          <p class="prop-desc">${esc(m.description || m.specialty)}</p>
          <div class="mini-traits">${TRAITS.map(t => `<span title="${t.label}">${t.icon}<i><b style="width:${m.personality[t.id]}%"></b></i></span>`).join('')}</div>
          ${m.catchphrase ? `<p class="prop-quote">«${esc(m.catchphrase)}»</p>` : ''}
        </div>`).join('')}</div>
      <div class="row gap wrap center">
        <button class="btn ghost" id="retry">${icon('refresh', 16)} اقترح فريق غيره</button>
        <button class="btn primary lg" id="finish">${icon('sparkles', 18)} ابدأ رحلتي</button>
      </div>
      <p class="muted center small">تقدر تعدّل شخصية وشكل أي مدرّب لاحقاً من «صانع المدرّبين».</p>` : `
      <div class="onb-thinking">
        <div class="onb-av big">${stageBox(d, { framing: 'portrait', mood: 'thinking' })}</div>
        <h2>${esc(d.name)} يجمع فريقك…</h2>
        <p class="muted">يحلّل هدفك «${esc(s.goal.slice(0, 80))}» ويختار التخصصات والشخصيات المناسبة</p>
        <div class="typing"><i></i><i></i><i></i></div>
      </div>`),
  ];

  function paint() {
    root.innerHTML = steps[s.step]();
    mountStages(root);
    typeOut();
    bind();
  }

  async function propose() {
    s.proposal = null; s.off = new Set();
    paint();
    try {
      s.proposal = await api.post('/api/onboarding/propose', { name: s.name, goal: s.goal, level: s.level, hours: s.hours });
      sound.chime();
    } catch (e) {
      toast(esc(e.message), { type: 'error' });
      s.step = 2;
    }
    paint();
  }

  function bind() {
    const f0 = root.querySelector('#f0');
    f0?.addEventListener('submit', e => { e.preventDefault(); s.name = f0.name.value.trim(); s.step = 1; paint(); });
    const f1 = root.querySelector('#f1');
    if (f1) {
      f1.addEventListener('submit', async e => {
        e.preventDefault();
        const key = f1.key.value.trim();
        if (key) {
          try {
            const r = await api.post('/api/config', { apiKey: key });
            state.config = r.config;
            toast(`${icon('check', 16)} انحفظ المفتاح`, { type: 'success' });
          } catch (err) { toast(esc(err.message), { type: 'error' }); return; }
        } else if (!state.config.hasKey) { toast('الصق المفتاح أو اختر الوضع التجريبي'); return; }
        s.step = 2; paint();
      });
      root.querySelector('#skipKey').onclick = () => { s.step = 2; paint(); };
    }
    const f2 = root.querySelector('#f2');
    if (f2) {
      autoGrow(f2.goal, 140);
      f2.addEventListener('click', e => {
        const ex = e.target.closest('[data-ex]');
        if (ex) { f2.goal.value = ex.dataset.ex; f2.goal.dispatchEvent(new Event('input')); }
        const lv = e.target.closest('#lvl .chip');
        if (lv) { s.level = lv.dataset.v; f2.querySelectorAll('#lvl .chip').forEach(x => x.classList.toggle('on', x === lv)); }
        const dy = e.target.closest('#days .chip');
        if (dy) { s.days = +dy.dataset.v; f2.querySelectorAll('#days .chip').forEach(x => x.classList.toggle('on', x === dy)); }
      });
      f2.hours.oninput = () => { s.hours = +f2.hours.value; root.querySelector('#hv').textContent = s.hours; };
      f2.addEventListener('submit', e => { e.preventDefault(); s.goal = f2.goal.value.trim(); s.step = 3; propose(); });
    }
    root.querySelector('.proposal')?.addEventListener('click', e => {
      const t = e.target.closest('[data-toggle]');
      if (t) { const i = +t.dataset.toggle; s.off.has(i) ? s.off.delete(i) : s.off.add(i); sound.pop(); paint(); return; }
      const dice = e.target.closest('[data-dice]');
      if (dice) {
        const m = s.proposal.mentors[+dice.dataset.dice];
        m.avatar = randomAvatar({ g: modelInfo(m.avatar?.model).g });
        dice.closest('.prop-av').querySelector('.av').outerHTML = av(m, 120);
        sound.pop();
      }
    });
    root.querySelector('#retry')?.addEventListener('click', propose);
    root.querySelector('#finish')?.addEventListener('click', async e => {
      const chosen = s.proposal.mentors.filter((_, i) => !s.off.has(i));
      if (!chosen.length) { toast('اختر مدرّباً واحداً على الأقل'); return; }
      e.target.disabled = true;
      try {
        await api.post('/api/onboarding/complete', {
          name: s.name, level: s.level, mentors: chosen,
          goal: { title: s.proposal.goalTitle || s.goal, why: s.goal, days: s.days },
        });
        confetti({ count: 220, spread: 1.5 });
        sound.fanfare();
        onDone();
      } catch (err) { toast(esc(err.message), { type: 'error' }); e.target.disabled = false; }
    });
    root.querySelector('input,textarea')?.focus();
  }

  paint();
}
