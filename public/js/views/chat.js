import { state, mentorById, team, applyProfile, upsert } from '../store.js';
import { api, stream } from '../api.js';
import { md } from '../markdown.js';
import { DIALECTS, STYLES, LESSON_TYPES } from '../catalog.js';
import { av, bondMeter, traitBars, pathWizard, goalModal, emptyState, stageBox, mountStages, setMood, feedSpeech } from '../components.js';
import { esc, icon, toast, sound, confetti, copyText, autoGrow, clock, confirmBox, dueLabel, todayStr } from '../ui.js';

export async function render(root, [id], query) {
  const mentor = mentorById(id);
  if (!mentor) {
    root.innerHTML = `<div class="page">${emptyState('users', 'المدرّب غير موجود', 'يمكن انحذف، أو الرابط غلط.', '<a class="btn primary" href="#/home">الرئيسية</a>')}</div>`;
    return;
  }
  let messages = (await api.get(`/api/mentors/${id}/chat`)).messages;
  let lesson = findLesson(query.get('lesson'));
  let busy = null; // AbortController while streaming
  const dialect = DIALECTS.find(d => d.id === mentor.dialect)?.label;
  const styles = (mentor.styles || []).map(s => STYLES.find(x => x.id === s)).filter(Boolean);

  root.innerHTML = `
  <div class="chat-layout ${lesson ? 'in-lesson' : ''}">
    <aside class="mentor-panel card" id="mpanel">
      <div class="stage" style="--glow:${glow(mentor)}">
        <div class="stage-av" id="stageAv">${stageBox(mentor, { framing: 'bust', mood: 'idle' })}</div>
        <div class="stage-status" id="stageStatus"><i></i> متاح</div>
      </div>
      <h2>${esc(mentor.name)}</h2>
      <p class="muted center">${esc(mentor.title)}</p>
      ${bondMeter(mentor)}
      <div class="panel-sec">
        <h4>التخصص</h4><p>${esc(mentor.specialty)}</p>
        <div class="tags">${dialect ? `<span class="tag">🗣️ ${esc(dialect)}</span>` : ''}${styles.map(s => `<span class="tag">${s.icon} ${s.label}</span>`).join('')}</div>
      </div>
      <div class="panel-sec">${traitBars(mentor.personality, true)}</div>
      <div class="panel-sec" id="memPeek"></div>
      <div class="panel-actions">
        <a class="btn subtle sm" href="#/memory/${mentor.id}">${icon('brain', 15)} ذاكرته</a>
        <a class="btn subtle sm" href="#/forge/${mentor.id}">${icon('edit', 15)} تعديل</a>
        <button class="btn ghost sm" id="clearChat">${icon('trash', 15)} مسح المحادثة</button>
      </div>
    </aside>

    <section class="chat-main card">
      <header class="chat-head">
        <button class="icon-btn only-mobile" id="togglePanel" aria-label="معلومات المدرّب">${av(mentor, 38)}</button>
        <div class="ch-title"><b>${esc(mentor.name)}</b><small class="muted" id="chSub">${esc(mentor.title)}</small></div>
        <div class="ch-actions">
          <button class="btn subtle sm" id="mkPath">${icon('route', 15)} <span>رتّبلي مسار</span></button>
          <a class="btn subtle sm" href="#/council?with=${mentor.id}">${icon('users', 15)} <span>اسأل المجلس</span></a>
        </div>
      </header>
      <div class="lesson-banner" id="lessonBanner"></div>
      <div class="msgs" id="msgs" aria-live="polite"></div>
      <div class="composer-wrap">
        <div class="quick" id="quick"></div>
        <form class="composer" id="composer">
          <textarea name="msg" rows="1" placeholder="اكتب لـ${esc(mentor.name)}…" maxlength="8000"></textarea>
          <button class="btn primary send" id="sendBtn" aria-label="أرسل">${icon('send', 18)}</button>
        </form>
        <p class="hint">Enter للإرسال · Shift+Enter لسطر جديد · ${esc(mentor.name)} يتذكّر المهم تلقائياً ${icon('brain', 12)}</p>
      </div>
    </section>
  </div>`;

  const $ = s => root.querySelector(s);
  mountStages(root);
  const list = $('#msgs');
  const form = $('#composer');
  const ta = form.msg;
  autoGrow(ta, 180);

  // ---------- rendering ----------
  function msgHTML(m) {
    if (m.hidden) return '';
    if (m.role === 'user') {
      return `<div class="msg user" data-id="${m.id}"><div class="bubble">${esc(m.text).replace(/\n/g, '<br>')}</div><time>${clock(m.at)}</time></div>`;
    }
    return `<div class="msg mentor ${m.kind || ''}" data-id="${m.id}">
      ${av(mentor, 36)}
      <div class="msg-body">
        <div class="bubble md">${md(m.text)}</div>
        ${memChips(m.memory)}
        ${m.suggestion && !m.suggestionHandled ? suggestionCard(m) : ''}
        ${colleagueChips(m.text)}
        <div class="msg-tools"><time>${clock(m.at)}</time>
          <button class="tool" data-copy="${m.id}" title="نسخ">${icon('copy', 14)}</button>
          <button class="tool" data-pin="${m.id}" title="احفظ في الذاكرة">${icon('pin', 14)}</button>
        </div>
      </div></div>`;
  }
  const memChips = mem => (mem?.length ? `<div class="mem-chips">${mem.map(x => `<a class="mem-chip" href="#/memory/${mentor.id}">${icon('brain', 13)} تذكّر: ${esc(x.text)}</a>`).join('')}</div>` : '');
  const suggestionCard = m => `<div class="suggest" data-sug="${m.id}"><div>${icon('target', 18)}<span><small>${esc(mentor.name)} يقترح هدفاً جديداً</small><b>${esc(m.suggestion.title)}</b></span></div>
    <div class="row gap"><button class="btn primary sm" data-sug-add="${m.id}">${icon('plus', 14)} أضف الهدف</button><button class="btn ghost sm" data-sug-skip="${m.id}">لاحقاً</button></div></div>`;
  function colleagueChips(text) {
    const hits = state.mentors.filter(c => c.id !== mentor.id && c.name.length > 1 && text.includes(c.name)).slice(0, 2);
    return hits.length ? `<div class="colleague">${hits.map(c => `<a class="chip" href="#/chat/${c.id}">${av(c, 20)} افتح جلسة مع ${esc(c.name)}</a>`).join('')}</div>` : '';
  }

  function paintAll() {
    list.innerHTML = messages.length || busy ? messages.map(msgHTML).join('') : intro();
    scrollDown(true);
  }
  const intro = () => `<div class="chat-intro">${av(mentor, 96, { mood: 'happy' })}<h3>${esc(mentor.name)}</h3><p>${esc(mentor.description || mentor.specialty)}</p></div>`;
  function scrollDown(force) {
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    if (force || near) list.scrollTop = list.scrollHeight;
  }

  function paintLesson() {
    const b = $('#lessonBanner');
    root.querySelector('.chat-layout').classList.toggle('in-lesson', !!lesson);
    if (!lesson) { b.innerHTML = ''; return; }
    const t = LESSON_TYPES[lesson.lesson.type] || LESSON_TYPES.concept;
    b.innerHTML = `<div class="lb-icon">${icon(t.icon, 18)}</div>
      <div class="lb-text"><small>وضع الدرس · ${esc(lesson.path.title)}</small><b>${esc(lesson.lesson.title)}</b></div>
      <button class="btn success sm" id="finishLesson" ${lesson.lesson.done ? 'disabled' : ''}>${icon('check', 15)} ${lesson.lesson.done ? 'منجز' : 'أنهيت الدرس'}</button>
      <button class="icon-btn sm" id="exitLesson" title="خروج من وضع الدرس">${icon('x', 16)}</button>`;
  }

  function paintQuick() {
    const last = messages[messages.length - 1];
    const myPaths = state.paths.filter(p => p.mentorId === mentor.id);
    const myGoal = state.goals.find(g => g.status !== 'done' && g.mentorId === mentor.id);
    const chips = [];
    if (lesson) chips.push(['💡', 'مثال عملي', 'أعطني مثالاً عملياً من الواقع على هذا المحور']);
    if (lesson) chips.push(['➡️', 'المحور التالي', 'فهمت، انتقل للمحور التالي']);
    if (!myPaths.length) chips.push(['🗺️', 'رتّبلي مسار', '__path']);
    chips.push(['🧪', 'اختبرني', 'اختبرني بثلاثة أسئلة قصيرة عن آخر شيء تعلّمته، سؤالاً واحداً في كل مرة، وقيّم إجابتي.']);
    if (myGoal) chips.push(['🎯', 'وين وصلت؟', `راجع معي تقدّمي في هدف «${myGoal.title}» وقل لي الخطوة التالية بالضبط.`]);
    if (last?.role === 'mentor') chips.push(['🪄', 'بسّطها أكثر', 'بسّط آخر شرح أكثر، بتشبيه من الحياة اليومية.']);
    chips.push(['📝', 'لخّص الجلسة', 'لخّص أهم ما تعلّمته في هذه الجلسة في 5 نقاط، ثم أعطني مهمة صغيرة لبكرة.']);
    $('#quick').innerHTML = chips.map(([e, l, p]) => `<button type="button" class="chip" data-prompt="${esc(p)}">${e} ${l}</button>`).join('');
  }

  async function paintMemPeek() {
    try {
      const r = await api.get(`/api/mentors/${mentor.id}/memory`);
      const items = r.sections.flatMap(s => s.items.map(t => ({ s: s.name, t }))).filter(x => x.s !== 'سجل التقدّم').slice(-4);
      $('#memPeek').innerHTML = `<h4>${icon('brain', 14)} يتذكّر عنك</h4>${items.length ? `<ul class="peek">${items.map(x => `<li>${esc(x.t)}</li>`).join('')}</ul>` : '<p class="muted small">لسا بيتعرّف عليك…</p>'}`;
    } catch { /* non-critical */ }
  }

  // ---------- streaming ----------
  function status(mood, text) {
    setMood($('#stageAv'), mood);
    setMood(root.querySelector('#togglePanel'), mood);
    $('#stageStatus').innerHTML = `<i class="${mood}"></i> ${text}`;
    $('#chSub').textContent = mood === 'idle' ? mentor.title : text;
  }

  function setBusy(on) {
    $('#sendBtn').innerHTML = on ? icon('stop', 18) : icon('send', 18);
    $('#sendBtn').classList.toggle('stop', on);
    $('#sendBtn').setAttribute('aria-label', on ? 'إيقاف' : 'أرسل');
  }

  async function run(url, body, { userText } = {}) {
    if (busy) return;
    busy = new AbortController();
    setBusy(true);
    if (!messages.length) list.innerHTML = '';
    if (userText != null && !body.hidden) {
      const temp = { id: 'tmp-u', role: 'user', text: userText, at: new Date().toISOString() };
      list.insertAdjacentHTML('beforeend', msgHTML(temp));
    }
    list.insertAdjacentHTML('beforeend', `<div class="msg mentor live" id="live">${av(mentor, 36, { mood: 'thinking' })}<div class="msg-body"><div class="bubble md"><div class="typing"><i></i><i></i><i></i></div></div></div></div>`);
    scrollDown(true);
    status('thinking', 'يفكّر…');
    const live = $('#live .bubble');
    let text = '';
    let raf = 0;
    const flush = () => { raf = 0; live.innerHTML = md(text) + '<span class="caret"></span>'; scrollDown(); };
    try {
      await stream(url, body, {
        start: d => { if (d.userMessage) { messages.push(d.userMessage); const t = list.querySelector('[data-id="tmp-u"]'); if (t) t.dataset.id = d.userMessage.id; } },
        delta: d => {
          if (!text) { status('talking', 'يكتب…'); setMood($('#live'), 'talking'); }
          text += d.t;
          feedSpeech($('#stageAv'), d.t);
          raf ||= requestAnimationFrame(flush);
        },
        done: d => {
          cancelAnimationFrame(raf);
          messages.push(d.message);
          $('#live')?.remove();
          list.insertAdjacentHTML('beforeend', msgHTML(d.message));
          scrollDown();
          status('happy', 'تمام ✓');
          if (d.profile) applyProfile(d.profile, d.gained);
          paintQuick();
        },
        memory: d => {
          const m = messages.find(x => x.id === d.messageId);
          if (m) { m.memory = d.added; m.suggestion = d.goal || undefined; }
          const el = list.querySelector(`[data-id="${d.messageId}"] .msg-body`);
          if (el && d.added?.length) {
            el.querySelector('.msg-tools').insertAdjacentHTML('beforebegin', memChips(d.added));
            toast(`${icon('brain', 16)} ${esc(mentor.name)} سجّل ${d.added.length === 1 ? 'ملاحظة جديدة' : `${d.added.length} ملاحظات`} في ذاكرته`, { timeout: 2600 });
            sound.chime();
            paintMemPeek();
          }
          if (el && d.goal) el.querySelector('.msg-tools').insertAdjacentHTML('beforebegin', suggestionCard(m));
          scrollDown();
        },
        error: d => { toast(esc(d.message), { type: 'error', timeout: 6000 }); },
      }, busy.signal);
    } catch (e) {
      if (e.name !== 'AbortError') toast(esc(e.message), { type: 'error', timeout: 6000 });
    } finally {
      cancelAnimationFrame(raf);
      const liveEl = $('#live');
      if (liveEl) {
        if (text.trim()) { liveEl.classList.remove('live'); liveEl.removeAttribute('id'); liveEl.querySelector('.bubble').innerHTML = md(text); }
        else liveEl.remove();
      }
      busy = null;
      setBusy(false);
      setTimeout(() => status('idle', 'متاح'), 1400);
      paintQuick();
    }
  }

  const send = (text, extra = {}) => {
    text = text.trim();
    if (!text || busy) return;
    sound.pop();
    const body = { message: text, ...extra };
    if (lesson) body.lesson = { pathId: lesson.path.id, lessonId: lesson.lesson.id };
    run(`/api/mentors/${mentor.id}/chat`, body, { userText: text });
  };

  // ---------- events ----------
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (busy) { busy.abort(); return; }
    const t = ta.value;
    ta.value = '';
    ta.dispatchEvent(new Event('input'));
    send(t);
  });
  let listenTimer = 0;
  ta.addEventListener('input', () => {
    if (busy) return;
    if (ta.value.trim()) { setMood($('#stageAv'), 'listening'); clearTimeout(listenTimer); listenTimer = setTimeout(() => !busy && setMood($('#stageAv'), 'idle'), 2600); }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  $('#quick').addEventListener('click', e => {
    const c = e.target.closest('[data-prompt]');
    if (!c) return;
    if (c.dataset.prompt === '__path') return pathWizard({ mentorId: mentor.id });
    send(c.dataset.prompt);
  });
  $('#mkPath').onclick = () => pathWizard({ mentorId: mentor.id });
  $('#togglePanel').onclick = () => $('#mpanel').classList.toggle('open');
  $('#clearChat').onclick = async () => {
    if (!(await confirmBox(`مسح المحادثة مع ${esc(mentor.name)}؟ <br><small class="muted">ذاكرته عنك ما رح تنمسح.</small>`, { danger: true, okText: 'امسح' }))) return;
    await api.del(`/api/mentors/${mentor.id}/chat`);
    messages = [];
    paintAll();
  };
  list.addEventListener('click', async e => {
    const cp = e.target.closest('[data-copy]');
    if (cp) return copyText(messages.find(m => m.id === cp.dataset.copy)?.text || '');
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const m = messages.find(x => x.id === pin.dataset.pin);
      const firstLine = m.text.replace(/[#*>`|-]/g, '').split('\n').map(s => s.trim()).find(s => s.length > 8) || m.text;
      const r = await api.post(`/api/mentors/${mentor.id}/memory/items`, { section: 'سجل التقدّم', text: `[${todayStr()}] ملاحظة مثبّتة: ${firstLine.slice(0, 180)}` });
      toast(`${icon('pin', 16)} ${r.added.length ? 'انحفظت بالذاكرة' : 'موجودة مسبقاً'}`, { type: 'success' });
      paintMemPeek();
      return;
    }
    const add = e.target.closest('[data-sug-add]');
    if (add) {
      const m = messages.find(x => x.id === add.dataset.sugAdd);
      const d = new Date(); d.setDate(d.getDate() + (m.suggestion.deadline_days || 30));
      goalModal({ title: m.suggestion.title, why: m.suggestion.why, mentorId: mentor.id, deadline: todayStr(d) });
      add.closest('.suggest').remove();
      return;
    }
    const skip = e.target.closest('[data-sug-skip]');
    if (skip) skip.closest('.suggest').remove();
  });
  $('#lessonBanner').addEventListener('click', async e => {
    if (e.target.closest('#exitLesson')) { lesson = null; history.replaceState(null, '', `#/chat/${mentor.id}`); paintLesson(); paintQuick(); return; }
    if (e.target.closest('#finishLesson')) {
      const r = await api.patch(`/api/paths/${lesson.path.id}/lessons/${lesson.lesson.id}`, { done: true });
      upsert('paths', r.path);
      applyProfile(r.profile, r.gained);
      confetti({ count: r.pathDone ? 260 : 140, spread: r.pathDone ? 1.6 : 1 });
      sound.success();
      toast(r.pathDone ? `${icon('trophy', 16)} أنهيت المسار بالكامل! 🎓` : `${icon('check', 16)} أحسنت! الدرس منجز`, { type: 'gold' });
      status('happy', 'فخور فيك!');
      lesson = findLesson(`${lesson.path.id}:${lesson.lesson.id}`);
      paintLesson();
      const nextL = r.path.modules.flatMap(m => m.lessons).find(l => !l.done);
      if (nextL) $('#lessonBanner').insertAdjacentHTML('beforeend', `<a class="btn primary sm" href="#/chat/${mentor.id}?lesson=${r.path.id}:${nextL.id}">${icon('play', 14)} الدرس التالي</a>`);
    }
  });

  // ---------- start ----------
  paintAll();
  paintLesson();
  paintQuick();
  paintMemPeek();
  const last = messages[messages.length - 1];
  const hours = last ? (Date.now() - new Date(last.at)) / 36e5 : Infinity;
  if (lesson && !lesson.lesson.done && !messages.some(m => m.lesson?.lessonId === lesson.lesson.id)) {
    send(`لنبدأ درس «${lesson.lesson.title}».`);
  } else if (!messages.length) {
    run(`/api/mentors/${mentor.id}/checkin`, { first: true });
  } else if (hours > 8) {
    run(`/api/mentors/${mentor.id}/checkin`, { first: false });
  }
  if (query.get('q')) send(query.get('q'));
  else ta.focus();

  return () => busy?.abort();
}

function findLesson(ref) {
  if (!ref) return null;
  const [pathId, lessonId] = ref.split(':');
  const path = state.paths.find(p => p.id === pathId);
  if (!path) return null;
  for (const mod of path.modules) {
    const l = mod.lessons.find(x => x.id === lessonId);
    if (l) return { path, module: mod, lesson: l };
  }
  return null;
}

function glow(m) {
  return { aurora: '#7C5CFF', sunset: '#FF5E6C', ocean: '#2563EB', forest: '#10B981', gold: '#F59E0B', night: '#7C3AED', rose: '#EC4899', mint: '#14B8A6' }[m.avatar?.aura] || '#7C5CFF';
}
