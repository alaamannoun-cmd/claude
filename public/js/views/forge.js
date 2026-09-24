// Mentor Forge: design identity, personality, teaching style, look — with a live preview.
import { state, mentorById, applyProfile, upsert, removeFrom } from '../store.js';
import { api } from '../api.js';
import { avatarSVG, randomAvatar, normalizeAvatar, setMood } from '../avatar.js';
import { TEMPLATES, DIRECTOR } from '../templates.js';
import { TRAITS, DIALECTS, STYLES, AVATAR, AURAS, AVATAR_LABELS, samplePhrase } from '../catalog.js';
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
  let lookTab = 'face';
  let mood = 'idle';

  root.innerHTML = `
  <div class="page forge">
    <div class="page-head">
      <div><h1>${icon('sparkles', 26)} ${editing ? `تعديل ${esc(editing.name)}` : 'صانع المدرّبين'}</h1><p class="muted">${editing ? 'عدّل أي تفصيلة — التغييرات بتنعكس من الرد الجاي.' : 'صمّم مدرّباً على مقاسك: تخصص دقيق، شخصية، أسلوب تدريس، وشكل يعبّر عنه.'}</p></div>
    </div>
    ${editing ? '' : `<div class="tpl-strip" id="tpls"><span class="muted small">ابدأ من قالب:</span>${TEMPLATES.map(t => `<button class="tpl" data-tpl="${t.key}">${avatarSVG(t.avatar, { cls: 'still' })}<span><b>${t.emoji} ${esc(t.name)}</b><small>${esc(t.title)}</small></span></button>`).join('')}</div>`}
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
        <div class="pv-av" id="pvAv">${avatarSVG(m.avatar, { mood })}</div>
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
    $('#pvAv').innerHTML = avatarSVG(m.avatar, { mood: flash ? 'happy' : mood });
    $('#preview .pv-stage').style.setProperty('--a1', AURAS[m.avatar.aura][0]);
    $('#preview .pv-stage').style.setProperty('--a2', AURAS[m.avatar.aura][1]);
    if (flash) setTimeout(() => setMood($('#pvAv'), mood), 700);
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
      const LOOK_TABS = [['face', 'الوجه'], ['hair', 'الشعر والرأس'], ['style', 'الملابس والإكسسوار'], ['aura', 'الهالة']];
      const opts = (key, list, labels) => `<div class="opt-grid">${list.map(v => `<button type="button" class="opt ${a[key] === v ? 'on' : ''}" data-av="${key}" data-v="${v}">${labels?.[v] || v}</button>`).join('')}</div>`;
      const swatches = (key, list) => `<div class="swatches">${list.map(c => `<button type="button" class="sw ${a[key] === c ? 'on' : ''}" data-av="${key}" data-v="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('')}</div>`;
      let inner = '';
      if (lookTab === 'face') inner = `
        <h4>النوع</h4>${opts('kind', AVATAR.kinds, AVATAR_LABELS.kind)}
        <h4>${a.kind === 'robot' ? 'لون الهيكل' : 'لون البشرة'}</h4>${swatches('skin', a.kind === 'robot' ? AVATAR.robotSkins : AVATAR.skins)}
        ${a.kind === 'human' ? `<h4>العيون</h4>${opts('eyes', AVATAR.eyes, AVATAR_LABELS.eyes)}<h4>الحواجب</h4>${opts('brows', AVATAR.brows, AVATAR_LABELS.brows)}` : ''}
        <h4>الفم</h4>${opts('mouth', AVATAR.mouths, AVATAR_LABELS.mouth)}
        ${a.kind === 'human' ? `<h4>اللحية</h4>${opts('facial', AVATAR.facials, AVATAR_LABELS.facial)}<label class="check"><input type="checkbox" data-blush ${a.blush ? 'checked' : ''}> خدود وردية</label>` : ''}`;
      else if (lookTab === 'hair') inner = `
        ${a.kind === 'human' ? `<h4>تسريحة الشعر</h4>${opts('hair', AVATAR.hairs, AVATAR_LABELS.hair)}<h4>لون الشعر</h4>${swatches('hairColor', AVATAR.hairColors)}` : ''}
        <h4>غطاء الرأس</h4>${opts('headwear', a.kind === 'robot' ? ['none', 'cap', 'beanie', 'gradcap'] : AVATAR.headwears, AVATAR_LABELS.headwear)}
        ${['hijab', 'cap', 'beanie'].includes(a.headwear) ? `<h4>لون غطاء الرأس</h4>${swatches('headwearColor', AVATAR.headwearColors)}` : ''}`;
      else if (lookTab === 'style') inner = `
        <h4>الملابس</h4>${opts('outfit', AVATAR.outfits, AVATAR_LABELS.outfit)}
        <h4>لون الملابس</h4>${swatches('outfitColor', AVATAR.outfitColors)}
        <h4>النظارات</h4>${opts('glasses', a.kind === 'robot' ? ['none', 'visor'] : AVATAR.glasses, AVATAR_LABELS.glasses)}
        <h4>إكسسوار</h4>${opts('accessory', a.kind === 'robot' ? ['none', 'headphones', 'headset'] : AVATAR.accessories, AVATAR_LABELS.accessory)}`;
      else inner = `<h4>هالة الخلفية</h4><div class="aura-grid">${Object.entries(AURAS).map(([k, [c1, c2]]) => `<button type="button" class="aura ${a.aura === k ? 'on' : ''}" data-av="aura" data-v="${k}" style="--c1:${c1};--c2:${c2}"><span></span>${AVATAR_LABELS.aura[k]}</button>`).join('')}</div>`;
      body.innerHTML = `<div class="look-tabs">${LOOK_TABS.map(([k, l]) => `<button type="button" data-look="${k}" class="${k === lookTab ? 'on' : ''}">${l}</button>`).join('')}
        <button type="button" class="btn subtle sm" id="dice2">${icon('shuffle', 15)} عشوائي</button></div><div class="look-body">${inner}</div>`;
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
    if (e.target.matches('[data-blush]')) { m.avatar.blush = e.target.checked; refreshAvatar(); }
  });
  root.addEventListener('click', e => {
    const t = e.target;
    const tb = t.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; root.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === tb)); paintTab(); return; }
    const lk = t.closest('[data-look]');
    if (lk) { lookTab = lk.dataset.look; paintTab(); return; }
    const avb = t.closest('[data-av]');
    if (avb) {
      m.avatar[avb.dataset.av] = avb.dataset.v;
      if (avb.dataset.av === 'kind') m.avatar.skin = (avb.dataset.v === 'robot' ? AVATAR.robotSkins : AVATAR.skins)[2];
      if (avb.dataset.av === 'headwear' && avb.dataset.v === 'ghutra') m.avatar.headwearColor = '#F8FAFC';
      m.avatar = normalizeAvatar(m.avatar);
      sound.pop(); paintTab(); refreshAvatar();
      return;
    }
    if (t.closest('#dice') || t.closest('#dice2')) { m.avatar = randomAvatar(); sound.pop(); refreshAvatar(); if (tab === 'look') paintTab(); return; }
    const md = t.closest('[data-mood]');
    if (md) { mood = md.dataset.mood; root.querySelectorAll('.moods button').forEach(x => x.classList.toggle('on', x === md)); setMood($('#pvAv'), mood); return; }
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
      sound.chime(); paintPreview(); paintTab();
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
  paintTab();
}

export { DIRECTOR };
