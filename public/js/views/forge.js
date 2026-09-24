// Mentor Forge: design identity, personality, teaching style, look — with a live preview.
import { state, mentorById, applyProfile, upsert, removeFrom } from '../store.js';
import { api } from '../api.js';
import { randomAvatar, normalizeAvatar, modelInfo } from '../avatar.js';
import { thumbUrl, preload } from '../avatar3d.js';
import { stageBox, mountStages, setMood, feedSpeech, retarget } from '../components.js';
import { TEMPLATES, DIRECTOR } from '../templates.js';
import { TRAITS, DIALECTS, STYLES, AURAS, AVATAR_LABELS, MODELS, MODEL_TAGS, GLASSES, LIGHTS, EXPRESSIONS, samplePhrase } from '../catalog.js';
import { esc, icon, toast, confetti, sound, confirmBox } from '../ui.js';

const TABS = [['identity', 'الهوية والتخصص', 'target'], ['persona', 'الشخصية والأسلوب', 'heart'], ['look', 'المظهر', 'sparkles'], ['rules', 'الوصايا', 'notebook']];

export async function render(root, [id], query) {
  const editing = id ? mentorById(id) : null;
  if (id && !editing) { location.hash = '#/forge'; return; }
  const blank = () => ({
    name: '', title: '', specialty: query.get('specialty') || '', scope: '', description: '',
    personality: { warmth: 65, strictness: 50, humor: 40, detail: 50, socratic: 50 },
    styles: ['practical'], dialect: 'levantine', catchphrase: '', rules: '', avatar: randomAvatar(),
  });
  let m = editing ? structuredClone(editing) : blank();
  m.avatar = normalizeAvatar(m.avatar);
  let tab = 'identity';
  let gFilter = 'all', tagFilter = 'all';
  let mood = 'idle';

  root.innerHTML = `
  <div class="page forge">
    <div class="page-head">
      <div><h1>${icon('sparkles', 26)} ${editing ? `تعديل ${esc(editing.name)}` : 'صانع المدرّبين'}</h1><p class="muted">${editing ? 'عدّل أي تفصيلة — التغييرات بتنعكس من الرد الجاي.' : 'صمّم مدرّباً على مقاسك: تخصص دقيق، شخصية، أسلوب تدريس، وشكل يعبّر عنه.'}</p></div>
    </div>
    ${editing ? '' : `<div class="tpl-strip" id="tpls"><span class="muted small">ابدأ من قالب:</span>${TEMPLATES.map(t => `<button class="tpl" data-tpl="${t.key}"><span class="tpl-av" style="--a1:${AURAS[t.avatar.aura][0]};--a2:${AURAS[t.avatar.aura][1]}"><img src="${thumbUrl(t.avatar.model)}" alt="" loading="lazy"></span><span><b>${t.emoji} ${esc(t.name)}</b><small>${esc(t.title)}</small></span></button>`).join('')}</div>`}
    <div class="forge-layout">
      <aside class="forge-preview card" id="preview"></aside>
      <section class="forge-editor card">
        <div class="tabs" id="tabs">${TABS.map(([k, l, ic]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${icon(ic, 16)} ${l}</button>`).join('')}</div>
        <div class="tab-body" id="tabBody"></div>
        <div class="forge-foot">
          ${editing && editing.role !== 'director' ? `<button class="btn ghost danger" id="delBtn">${icon('trash', 16)} حذف المدرّب</button>` : '<span></span>'}
          <div class="row gap"><a class="btn ghost" href="${editing ? `#/chat/${editing.id}` : '#/home'}">إلغاء</a>
          <button class="btn primary lg" id="saveBtn">${icon(editing ? 'check' : 'sparkles', 18)} ${editing ? 'حفظ التعديلات' : 'وظّف المدرّب'}</button></div>
        </div>
      </section>
    </div>
  </div>`;

  const $ = s => root.querySelector(s);

  // ---------- preview ----------
  function paintPreview() {
    $('#preview').innerHTML = `
      <div class="pv-stage" style="--a1:${AURAS[m.avatar.aura][0]};--a2:${AURAS[m.avatar.aura][1]}">
        <div class="pv-av" id="pvAv">${stageBox(m, { framing: 'bust', mood })}</div>
        <div class="moods">${[['idle', '🙂 عادي'], ['talking', '🗣️ يتكلم'], ['thinking', '🤔 يفكّر'], ['happy', '🎉 سعيد']].map(([k, l]) => `<button data-mood="${k}" class="${k === mood ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="icon-btn dice" id="dice" title="شكل عشوائي">${icon('shuffle', 18)}</button>
      </div>
      <h2 id="pvName">${esc(m.name || 'اسم المدرّب')}</h2>
      <p class="muted center" id="pvTitle">${esc(m.title || 'اللقب')}</p>
      <div class="speech" id="pvSpeech"><small>هيك رح يحكي معك:</small><p>${esc(samplePhrase(m))}</p></div>
      <div class="pv-traits" id="pvTraits">${TRAITS.map(t => `<div class="trait"><span>${t.icon} ${t.label}</span><i><b style="width:${m.personality[t.id]}%"></b></i></div>`).join('')}</div>`;
  }
  const refreshText = () => {
    $('#pvName').textContent = m.name || 'اسم المدرّب';
    $('#pvTitle').textContent = m.title || 'اللقب';
    $('#pvSpeech p').textContent = samplePhrase(m);
    $('#pvTraits').innerHTML = TRAITS.map(t => `<div class="trait"><span>${t.icon} ${t.label}</span><i><b style="width:${m.personality[t.id]}%"></b></i></div>`).join('');
  };
  const refreshAvatar = (flash = true) => {
    retarget($('#pvAv'), m);
    $('#preview .pv-stage').style.setProperty('--a1', AURAS[m.avatar.aura][0]);
    $('#preview .pv-stage').style.setProperty('--a2', AURAS[m.avatar.aura][1]);
    if (flash) { setMood($('#pvAv'), 'happy'); setTimeout(() => setMood($('#pvAv'), mood), 1200); }
  };

  // ---------- editor tabs ----------
  const field = (key, label, { ph = '', max = 200, area = false, rows = 3, hint = '' } = {}) => `
    <label class="field"><span>${label}${hint ? ` <small>${hint}</small>` : ''}</span>${area
      ? `<textarea class="input" data-bind="${key}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(m[key] || '')}</textarea>`
      : `<input class="input" data-bind="${key}" maxlength="${max}" placeholder="${esc(ph)}" value="${esc(m[key] || '')}">`}</label>`;

  function paintTab() {
    const body = $('#tabBody');
    if (tab === 'identity') {
      body.innerHTML = `
        <div class="grid-2 tight">${field('name', 'الاسم', { ph: 'مثال: د. نور', max: 40 })}${field('title', 'اللقب', { ph: 'مثال: خبيرة طاقة متجددة', max: 80 })}</div>
        ${field('specialty', 'التخصص الدقيق', { ph: 'كلما كان أدق، كانت إجاباته أعمق. مثال: تصميم أنظمة PV المرتبطة بالشبكة للمنازل', max: 300, area: true, rows: 2, hint: '(أهم حقل)' })}
        ${field('scope', 'نطاق العمل', { ph: 'شو بيغطي بالضبط؟ مثال: حسابات الأحمال، اختيار الانفرتر، معايير IEC', max: 400, area: true, rows: 2 })}
        ${field('description', 'نبذة عنه (خلفيته وقصته)', { ph: 'مثال: مهندسة بخبرة 15 سنة، صممت أكثر من 300 نظام', max: 500, area: true, rows: 2 })}
        ${field('catchphrase', 'عبارته المميزة', { ph: 'مثال: افهم الفيزياء، تفهم النظام.', max: 140 })}`;
    } else if (tab === 'persona') {
      body.innerHTML = `
        <div class="sliders">${TRAITS.map(t => `
          <div class="trait-slider"><div class="ts-head"><b>${t.icon} ${t.label}</b><output id="o-${t.id}">${m.personality[t.id]}</output></div>
          <input type="range" class="slider" min="0" max="100" step="5" value="${m.personality[t.id]}" data-trait="${t.id}">
          <div class="ts-ends"><span>${t.low}</span><span>${t.high}</span></div></div>`).join('')}</div>
        <div class="field"><span>أسلوب التدريس <small>(حتى 3)</small></span><div class="chips wrap" id="styles">${STYLES.map(s => `<button type="button" class="chip ${m.styles.includes(s.id) ? 'on' : ''}" data-style="${s.id}" title="${esc(s.prompt)}">${s.icon} ${s.label}</button>`).join('')}</div></div>
        <div class="field"><span>لغة ولهجة الحديث</span><div class="chips wrap" id="dialects">${DIALECTS.map(d => `<button type="button" class="chip ${m.dialect === d.id ? 'on' : ''}" data-dialect="${d.id}">${d.label}</button>`).join('')}</div></div>`;
    } else if (tab === 'look') {
      const a = m.avatar;
      const list = MODELS.filter(x => (gFilter === 'all' || x.g === gFilter) && (tagFilter === 'all' || x.tags.includes(tagFilter)));
      const chips = (key, items) => `<div class="chips wrap">${items.map(it => `<button type="button" class="chip ${a[key] === it.id ? 'on' : ''}" data-av="${key}" data-v="${it.id}">${it.label}</button>`).join('')}</div>`;
      body.innerHTML = `
        <div class="look-bar">
          <div class="seg sm" id="gSeg">${[['all', 'الكل'], ['m', 'رجال'], ['f', 'نساء']].map(([k, l]) => `<button type="button" data-g="${k}" class="${k === gFilter ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="chips" id="tagChips"><button type="button" class="chip ${tagFilter === 'all' ? 'on' : ''}" data-tag="all">كل الأنماط</button>${Object.entries(MODEL_TAGS).map(([k, l]) => `<button type="button" class="chip ${tagFilter === k ? 'on' : ''}" data-tag="${k}">${l}</button>`).join('')}</div>
          <button type="button" class="btn subtle sm" id="dice2">${icon('shuffle', 15)} عشوائي</button>
        </div>
        <div class="model-grid">${list.map(x => `
          <button type="button" class="model-card ${a.model === x.id ? 'on' : ''}" data-model="${x.id}" style="--a1:${AURAS[a.aura][0]};--a2:${AURAS[a.aura][1]}">
            <span class="mc-img"><img src="${thumbUrl(x.id)}" alt="" loading="lazy"></span><b>${esc(x.label)}</b>
          </button>`).join('') || '<p class="muted">ما في شخصيات بهالفلتر.</p>'}</div>
        <div class="look-grid">
          <div><h4>النظارات</h4>${modelInfo(a.model).glasses ? '<p class="muted small">هالشخصية لابسة نظارة أصلاً 👓</p>' : chips('glasses', GLASSES)}</div>
          <div><h4>التعبير الافتراضي</h4>${chips('expression', EXPRESSIONS)}</div>
          <div><h4>الإضاءة</h4>${chips('light', LIGHTS)}</div>
          <div><h4>هالة الخلفية</h4><div class="aura-row">${Object.entries(AURAS).map(([k, [c1, c2]]) => `<button type="button" class="aura-dot ${a.aura === k ? 'on' : ''}" data-av="aura" data-v="${k}" style="--c1:${c1};--c2:${c2}" title="${AVATAR_LABELS.aura[k]}"></button>`).join('')}</div></div>
        </div>
        <p class="muted small credit">${icon('sparkles', 13)} شخصيات ثلاثية الأبعاد حقيقية مع تعابير وجه (ARKit) — مبنية على مكتبة Microsoft Rocketbox المفتوحة.</p>`;
    } else {
      body.innerHTML = `
        <p class="muted">«الوصايا» تعليمات دائمة يلتزم فيها المدرّب بكل رد — استخدمها لتخصيص تجربتك بدقة.</p>
        ${field('rules', 'وصاياك للمدرّب', { ph: 'مثال:\n- اعطيني دايماً مثال من مجال الطاقة\n- لا تعطيني الحل قبل ما أحاول مرتين\n- ذكّرني كل جمعة بمراجعة الأسبوع', max: 1500, area: true, rows: 8 })}
        <div class="rule-ideas">${['أعطني دائماً مثالاً عملياً من الواقع', 'لا تعطني الحل قبل أن أحاول', 'اختم كل جلسة بمهمة صغيرة لبكرة', 'صحّح أخطائي اللغوية بلطف', 'استخدم جداول للمقارنات'].map(r => `<button type="button" class="chip" data-rule="${esc(r)}">+ ${esc(r)}</button>`).join('')}</div>`;
    }
  }

  // ---------- events ----------
  root.addEventListener('input', e => {
    const b = e.target.closest('[data-bind]');
    if (b) { m[b.dataset.bind] = b.value; refreshText(); return; }
    const t = e.target.closest('[data-trait]');
    if (t) { m.personality[t.dataset.trait] = +t.value; root.querySelector(`#o-${t.dataset.trait}`).textContent = t.value; refreshText(); }
  });
  root.addEventListener('change', e => {
  });
  root.addEventListener('click', e => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; root.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === tb)); paintTab(); return; }
    const gb = t.closest('[data-g]');
    if (gb) { gFilter = gb.dataset.g; paintTab(); return; }
    const tg = t.closest('[data-tag]');
    if (tg) { tagFilter = tg.dataset.tag; paintTab(); return; }
    const mc = t.closest('[data-model]');
    if (mc) {
      m.avatar = normalizeAvatar({ ...m.avatar, model: mc.dataset.model });
      root.querySelectorAll('.model-card').forEach(x => x.classList.toggle('on', x === mc));
      sound.pop(); refreshAvatar(); paintTab();
      return;
    }
    const avb = t.closest('[data-av]');
    if (avb) {
      m.avatar = normalizeAvatar({ ...m.avatar, [avb.dataset.av]: avb.dataset.v });
      sound.pop(); paintTab(); refreshAvatar(avb.dataset.av !== 'light' && avb.dataset.av !== 'aura');
      return;
    }
    if (t.closest('#dice') || t.closest('#dice2')) { m.avatar = randomAvatar(gFilter === 'all' ? {} : { g: gFilter }); sound.pop(); refreshAvatar(); if (tab === 'look') paintTab(); return; }
    const md = t.closest('[data-mood]');
    if (md) {
      mood = md.dataset.mood;
      root.querySelectorAll('.moods button').forEach(x => x.classList.toggle('on', x === md));
      setMood($('#pvAv'), mood);
      if (mood === 'talking') {
        const phrase = samplePhrase(m);
        feedSpeech($('#pvAv'), phrase);
        setTimeout(() => { if (mood !== 'talking') return; mood = 'idle'; setMood($('#pvAv'), 'happy'); setTimeout(() => setMood($('#pvAv'), mood), 1200); root.querySelectorAll('.moods button').forEach(x => x.classList.toggle('on', x.dataset.mood === 'idle')); }, Math.min(9000, 900 + phrase.length * 60));
      }
      return;
    }
    const st = t.closest('[data-style]');
    if (st) {
      const s = st.dataset.style;
      m.styles = m.styles.includes(s) ? m.styles.filter(x => x !== s) : [...m.styles, s].slice(-3);
      root.querySelectorAll('[data-style]').forEach(x => x.classList.toggle('on', m.styles.includes(x.dataset.style)));
      return;
    }
    const dl = t.closest('[data-dialect]');
    if (dl) { m.dialect = dl.dataset.dialect; root.querySelectorAll('[data-dialect]').forEach(x => x.classList.toggle('on', x === dl)); refreshText(); return; }
    const rule = t.closest('[data-rule]');
    if (rule) { m.rules = `${(m.rules || '').trim()}\n- ${rule.dataset.rule}`.trim(); paintTab(); return; }
    const tpl = t.closest('[data-tpl]');
    if (tpl) {
      const { key, emoji, ...rest } = structuredClone(TEMPLATES.find(x => x.key === tpl.dataset.tpl));
      m = { ...blank(), ...rest, template: key, avatar: normalizeAvatar(rest.avatar) };
      root.querySelectorAll('.tpl').forEach(x => x.classList.toggle('on', x === tpl));
      sound.chime(); refreshAvatar(); refreshText(); paintTab();
    }
  });

  $('#saveBtn').onclick = async e => {
    if (!m.name.trim() || !m.specialty.trim()) {
      tab = 'identity'; root.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === tab)); paintTab();
      toast('الاسم والتخصص مطلوبين', { type: 'error' });
      return;
    }
    e.currentTarget.disabled = true;
    try {
      if (editing) {
        const r = await api.put(`/api/mentors/${editing.id}`, m);
        upsert('mentors', r.mentor);
        toast(`${icon('check', 16)} انحفظت التعديلات`, { type: 'success' });
        location.hash = `#/chat/${editing.id}`;
      } else {
        const r = await api.post('/api/mentors', m);
        state.mentors.push(r.mentor);
        applyProfile(r.profile, r.gained);
        confetti({ count: 180, spread: 1.3 });
        sound.fanfare();
        toast(`${icon('sparkles', 16)} انضم ${esc(r.mentor.name)} لفريقك!`, { type: 'gold' });
        location.hash = `#/chat/${r.mentor.id}`;
      }
    } catch (err) {
      toast(esc(err.message), { type: 'error' });
      e.currentTarget.disabled = false;
    }
  };
  $('#delBtn')?.addEventListener('click', async () => {
    if (!(await confirmBox(`حذف ${esc(editing.name)} من الفريق؟ رح تنحذف ذاكرته ومحادثاته.`, { danger: true, okText: 'احذف' }))) return;
    await api.del(`/api/mentors/${editing.id}`);
    removeFrom('mentors', editing.id);
    state.goals.forEach(g => { if (g.mentorId === editing.id) g.mentorId = null; });
    location.hash = '#/home';
  });

  paintPreview();
  mountStages(root);
  paintTab();
  MODELS.slice(0, 6).forEach(x => preload(x.id));
}

export { DIRECTOR };
