import { state, team, director, mentorById, applyProfile, upsert, removeFrom } from '../store.js';
import { stream, api } from '../api.js';
import { md, extractSteps } from '../markdown.js';
import { setMood } from '../avatar.js';
import { ROUNDTABLE_STYLES } from '../catalog.js';
import { av, goalModal, mentorPicker, bindPicker, emptyState } from '../components.js';
import { esc, icon, toast, sound, openDrawer, timeAgo, autoGrow, confirmBox } from '../ui.js';

export async function render(root, args, query) {
  const d = director();
  const tm = team();
  let mode = query.get('mode') === 'roundtable' ? 'roundtable' : 'ask';
  let session = null;
  let busy = null;
  let rt = { style: 'discussion', ids: tm.slice(0, 3).map(m => m.id), rounds: 2 };
  if (query.get('with')) rt.ids = [...new Set([query.get('with'), ...rt.ids])].slice(0, 4);

  root.innerHTML = `
  <div class="page council">
    <div class="page-head">
      <div><h1>${icon('users', 26)} المجلس</h1><p class="muted">اسأل سؤالاً واحداً، و${esc(d.name)} يوزّعه على المختصين ثم يجمع لك الخلاصة — أو افتح جلسة نقاش بين مدرّبيك.</p></div>
      <div class="row gap">
        <div class="seg" id="modeSeg">
          <button data-mode="ask" class="${mode === 'ask' ? 'on' : ''}">${icon('sparkles', 16)} اسأل المجلس</button>
          <button data-mode="roundtable" class="${mode === 'roundtable' ? 'on' : ''}">${icon('message', 16)} جلسة نقاش</button>
        </div>
        <button class="icon-btn" id="historyBtn" title="الجلسات السابقة">${icon('history', 19)}</button>
      </div>
    </div>

    <div class="council-grid">
      <div class="table-card card">
        <div class="round-table" id="table">
          <svg class="links" viewBox="0 0 100 100" preserveAspectRatio="none" id="links"></svg>
          <div class="table-surface"><div class="table-core"><img src="/favicon.svg" alt=""><span id="tableStatus">المجلس بانتظار سؤالك</span></div></div>
          <div id="seats"></div>
        </div>
      </div>

      <div class="tx-card card">
        <div class="tx" id="tx"></div>
        <div class="tx-foot" id="txFoot"></div>
      </div>
    </div>
  </div>`;

  const $ = s => root.querySelector(s);

  // ---------- round table ----------
  const seatList = [d, ...tm].slice(0, 9);
  function seatPos(i, n) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: 50 + Math.cos(a) * 40, y: 50 + Math.sin(a) * 38 };
  }
  function paintTable() {
    const n = seatList.length;
    $('#seats').innerHTML = seatList.map((m, i) => {
      const p = seatPos(i, n);
      return `<button class="seat ${m.role === 'director' ? 'director' : ''}" data-seat="${m.id}" style="left:${p.x}%;top:${p.y}%" title="${esc(m.name)} — ${esc(m.title)}">
        ${av(m, 76, { round: true })}<span class="seat-name">${m.role === 'director' ? icon('crown', 11) : ''}${esc(m.name)}</span></button>`;
    }).join('');
    const c = seatPos(0, n);
    $('#links').innerHTML = seatList.slice(1).map((m, i) => {
      const p = seatPos(i + 1, n);
      return `<line data-link="${m.id}" x1="${c.x}" y1="${c.y}" x2="${p.x}" y2="${p.y}" vector-effect="non-scaling-stroke"/>`;
    }).join('');
  }
  function light({ assigned = [], speaking = null, dim = false } = {}) {
    root.querySelectorAll('.seat').forEach(s => {
      const id = s.dataset.seat;
      s.classList.toggle('assigned', assigned.includes(id));
      s.classList.toggle('speaking', id === speaking);
      s.classList.toggle('dim', dim && id !== speaking && !assigned.includes(id) && id !== d.id);
      setMood(s, id === speaking ? 'talking' : 'idle');
    });
    root.querySelectorAll('[data-link]').forEach(l => l.classList.toggle('on', assigned.includes(l.dataset.link)));
  }
  function tableStatus(t) { $('#tableStatus').textContent = t; }
  $('#seats').addEventListener('click', e => {
    const s = e.target.closest('.seat');
    if (!s || busy) return;
    if (mode === 'roundtable' && s.dataset.seat !== d.id) {
      const id = s.dataset.seat;
      rt.ids = rt.ids.includes(id) ? rt.ids.filter(x => x !== id) : [...rt.ids, id].slice(-4);
      paintFoot();
      light({ assigned: rt.ids });
    } else location.hash = `#/chat/${s.dataset.seat}`;
  });

  // ---------- transcript ----------
  function itemHTML(m) {
    const who = mentorById(m.mentorId);
    if (m.role === 'user') {
      return `<div class="tx-user ${m.kind}"><span class="tx-label">${m.kind === 'interjection' ? 'تدخّلت' : 'سؤالك'}</span><p>${esc(m.text)}</p></div>`;
    }
    if (m.kind === 'decision') {
      return `<div class="tx-decision">${who ? av(who, 30, { round: true }) : ''}<div><small>${icon('crown', 12)} قرار ${esc(who?.name || 'المدير')}</small><p>${esc(m.text)}</p>
        ${m.assignments?.length ? `<div class="assign">${m.assignments.map(a => { const x = mentorById(a.mentorId); return x ? `<span class="as">${av(x, 22, { round: true })}<b>${esc(x.name)}</b><em>${esc(a.task)}</em></span>` : ''; }).join('')}</div>` : ''}
        ${m.hire ? hireCard(m.hire) : ''}</div></div>`;
    }
    const special = m.kind === 'synthesis' || m.kind === 'summary';
    return `<div class="tx-msg ${special ? 'synth' : ''}" data-mid="${m.id || ''}">
      <div class="tx-who">${who ? av(who, 38, { round: true }) : ''}<div><b>${esc(who?.name || 'مدرّب')}</b><small>${special ? (m.kind === 'summary' ? 'ختام الجلسة' : 'خلاصة المجلس') : esc(who?.title || '')}</small></div></div>
      ${m.task ? `<div class="tx-task">${icon('target', 12)} ${esc(m.task)}</div>` : ''}
      <div class="md">${md(m.text)}</div>
      ${special ? `<div class="row gap wrap tx-actions"><button class="btn subtle sm" data-togoal="${m.id}">${icon('target', 14)} حوّل الخطة لهدف</button></div>` : ''}
      ${m.hire ? hireCard(m.hire) : ''}
    </div>`;
  }
  const hireCard = h => `<div class="hire">${icon('sparkles', 18)}<div><b>اقتراح: وظّف مدرّباً في «${esc(h.specialty)}»</b><small>${esc(h.reason || '')}</small></div><a class="btn primary sm" href="#/forge?specialty=${encodeURIComponent(h.specialty)}">صمّمه</a></div>`;

  function paintTx() {
    const tx = $('#tx');
    if (!session?.messages?.length) {
      tx.innerHTML = mode === 'ask'
        ? `<div class="tx-empty">${av(d, 88, { mood: 'happy', round: true })}<h3>اسأل المجلس</h3><p>سؤال متعدد الجوانب؟ ممتاز. ${esc(d.name)} رح يقسّمه على المدرّبين المختصين، وكل واحد يبني على كلام اللي قبله.</p>
          <div class="chips wrap center">${examples().map(e => `<button class="chip" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div></div>`
        : `<div class="tx-empty">${icon('message', 40)}<h3>جلسة نقاش</h3><p>اختر موضوعاً ومدرّبَين أو أكثر (اضغط على مقاعدهم)، وشوفهم يتناقشوا بشخصياتهم. تقدر تتدخّل بأي وقت.</p></div>`;
      return;
    }
    tx.innerHTML = session.messages.map(itemHTML).join('');
    tx.scrollTop = tx.scrollHeight;
  }
  function examples() {
    const a = tm.slice(0, 2).map(m => m.specialty.split(/[،,(]/)[0].trim());
    const g = state.goals.find(x => x.status !== 'done');
    return [
      g ? `كيف أحقق هدفي «${g.title.slice(0, 40)}» بأسرع طريقة واقعية؟` : 'من وين أبدأ اليوم؟',
      a.length > 1 ? `كيف أربط ${a[0]} مع ${a[1]} بمشروع واحد؟` : 'شو أهم عادة لازم أبنيها هالشهر؟',
      'عندي ساعة واحدة باليوم، كيف أوزّعها؟',
    ];
  }

  // ---------- footer (composer) ----------
  function paintFoot() {
    const f = $('#txFoot');
    if (mode === 'ask') {
      f.innerHTML = `<form class="composer" id="askForm"><textarea name="q" rows="1" placeholder="${session ? 'سؤال متابعة للمجلس…' : 'اكتب سؤالك للمجلس…'}" maxlength="4000"></textarea>
        <button class="btn primary send" aria-label="أرسل">${icon(busy ? 'stop' : 'send', 18)}</button></form>
        ${session ? `<button class="link small" id="newSession">${icon('plus', 13)} جلسة جديدة</button>` : ''}`;
      const form = f.querySelector('#askForm');
      autoGrow(form.q, 150);
      form.q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('submit', e => { e.preventDefault(); if (busy) return busy.abort(); const q = form.q.value.trim(); if (q) ask(q); });
      f.querySelector('#newSession')?.addEventListener('click', () => { session = null; paintTx(); paintFoot(); light(); tableStatus('المجلس بانتظار سؤالك'); });
      if (query.get('focus')) form.q.focus();
      return;
    }
    if (session && session.type === 'roundtable') {
      f.innerHTML = `<form class="composer" id="interForm"><textarea name="q" rows="1" placeholder="تدخّل بسؤال أو رأي، وبيكمّلوا النقاش على أساسه…" maxlength="2000"></textarea>
        <button class="btn primary send" aria-label="تدخّل">${icon(busy ? 'stop' : 'send', 18)}</button></form>
        <div class="row gap"><button class="link small" id="moreRound">${icon('refresh', 13)} جولة إضافية</button><button class="link small" id="newSession">${icon('plus', 13)} جلسة جديدة</button></div>`;
      const form = f.querySelector('#interForm');
      autoGrow(form.q, 150);
      form.q.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
      form.addEventListener('submit', e => { e.preventDefault(); if (busy) return busy.abort(); const q = form.q.value.trim(); if (q) roundtable({ interjection: q }); });
      f.querySelector('#moreRound').onclick = () => roundtable({ interjection: 'كمّلوا النقاش بجولة إضافية وعمّقوا أهم نقطة خلافية.' });
      f.querySelector('#newSession').onclick = () => { session = null; paintTx(); paintFoot(); light({ assigned: rt.ids }); };
      return;
    }
    const chosen = rt.ids.map(mentorById).filter(Boolean);
    const prevTopic = f.querySelector('#rtForm [name=topic]')?.value || rt.topic || '';
    f.innerHTML = `<form class="rt-setup" id="rtForm">
      <input class="input" name="topic" required maxlength="600" value="${esc(prevTopic)}" placeholder="موضوع الجلسة… مثال: هل أبدأ بالنظرية أم بالتطبيق؟">
      <div class="chips wrap" id="rtStyle">${ROUNDTABLE_STYLES.map(s => `<button type="button" class="chip ${s.id === rt.style ? 'on' : ''}" data-v="${s.id}">${s.icon} ${s.label}</button>`).join('')}</div>
      <div class="rt-row"><span class="muted small">المشاركون (${chosen.length}/4):</span>${tm.length ? mentorPicker('rtm', null, tm) : '<span class="muted">صمّم مدرّبين أولاً</span>'}</div>
      <div class="rt-row"><span class="muted small">الجولات:</span><div class="chips" id="rtRounds">${[1, 2, 3].map(n => `<button type="button" class="chip ${n === rt.rounds ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}</div>
      <button class="btn primary" ${chosen.length < 2 ? 'disabled' : ''}>${icon('play', 16)} ابدأ الجلسة</button></div>
    </form>`;
    f.querySelectorAll('[data-pick="rtm"] .mp').forEach(b => b.classList.toggle('on', rt.ids.includes(b.dataset.id)));
    bindPicker(f, 'rtm', ids => { rt.ids = ids.slice(0, 4); light({ assigned: rt.ids }); paintFoot(); }, true);
    f.querySelector('#rtStyle').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; rt.style = c.dataset.v; f.querySelectorAll('#rtStyle .chip').forEach(x => x.classList.toggle('on', x === c)); });
    f.querySelector('#rtRounds').addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; rt.rounds = +c.dataset.v; f.querySelectorAll('#rtRounds .chip').forEach(x => x.classList.toggle('on', x === c)); });
    f.querySelector('#rtForm [name=topic]').addEventListener('input', e => { rt.topic = e.target.value; });
    f.querySelector('#rtForm').addEventListener('submit', e => { e.preventDefault(); roundtable({ topic: e.target.topic.value.trim() }); });
  }

  // ---------- streaming runner ----------
  async function runStream(url, body, { onRoute } = {}) {
    busy = new AbortController();
    paintFoot();
    const tx = $('#tx');
    if (!session) { session = { id: null, type: mode, messages: [] }; }
    let speaker = null, box = null, text = '', raf = 0, assigned = [];
    const flush = () => { raf = 0; if (box) box.innerHTML = md(text) + '<span class="caret"></span>'; tx.scrollTop = tx.scrollHeight; };
    try {
      await stream(url, body, {
        session: s => { session.id = s.id; },
        phase: () => { tableStatus(`${d.name} يحلّل السؤال…`); setMood(root.querySelector(`[data-seat="${d.id}"]`), 'thinking'); },
        route: r => {
          assigned = r.assignments.map(a => a.mentorId);
          onRoute?.(r);
          light({ assigned, dim: true });
          sound.chime();
          tableStatus(assigned.length ? `وزّع السؤال على ${assigned.length} ${assigned.length === 1 ? 'مدرّب' : 'مدرّبين'}` : 'المدير يجيب بنفسه');
          tx.insertAdjacentHTML('beforeend', itemHTML({ role: 'director', mentorId: d.id, kind: 'decision', text: r.decision, assignments: r.assignments, hire: r.hire }));
          tx.scrollTop = tx.scrollHeight;
        },
        speaker: s => {
          speaker = s; text = '';
          const who = mentorById(s.mentorId);
          light({ assigned: mode === 'roundtable' ? rt.ids : assigned, speaking: s.mentorId, dim: true });
          tableStatus(`${who?.name || ''} ${s.kind === 'synthesis' || s.kind === 'summary' ? 'يكتب الخلاصة…' : 'يتحدث…'}`);
          const special = s.kind === 'synthesis' || s.kind === 'summary';
          tx.insertAdjacentHTML('beforeend', `<div class="tx-msg live ${special ? 'synth' : ''}"><div class="tx-who">${who ? av(who, 38, { round: true, mood: 'talking' }) : ''}<div><b>${esc(who?.name || '')}</b><small>${special ? 'خلاصة المجلس' : esc(who?.title || '')}</small></div></div>${s.task ? `<div class="tx-task">${icon('target', 12)} ${esc(s.task)}</div>` : ''}<div class="md"><div class="typing"><i></i><i></i><i></i></div></div></div>`);
          box = tx.lastElementChild.querySelector('.md');
          tx.scrollTop = tx.scrollHeight;
        },
        delta: x => { text += x.t; raf ||= requestAnimationFrame(flush); },
        speaker_end: () => {
          cancelAnimationFrame(raf); raf = 0;
          if (box) { box.innerHTML = md(text); box.closest('.tx-msg').classList.remove('live'); setMood(box.closest('.tx-msg'), 'idle'); }
          box = null;
        },
        done: r => {
          session = r.session;
          upsert('council', r.session);
          applyProfile(r.profile, r.gained);
          sound.success();
        },
        error: e => toast(esc(e.message), { type: 'error', timeout: 6000 }),
      }, busy.signal);
    } catch (e) {
      if (e.name !== 'AbortError') toast(esc(e.message), { type: 'error', timeout: 6000 });
    } finally {
      cancelAnimationFrame(raf);
      busy = null;
      light(mode === 'roundtable' ? { assigned: rt.ids } : {});
      tableStatus('انتهت الجولة — تقدر تسأل سؤال متابعة');
      if (session?.messages?.length) paintTx();
      paintFoot();
    }
  }

  function ask(q) {
    if (!tm.length) { toast('المجلس فاضي — صمّم مدرّباً أولاً', { type: 'error' }); }
    $('#tx').querySelector('.tx-empty')?.remove();
    $('#tx').insertAdjacentHTML('beforeend', itemHTML({ role: 'user', kind: 'question', text: q }));
    runStream('/api/council/ask', { question: q, sessionId: session?.type === 'ask' ? session.id : undefined });
  }

  function roundtable({ topic, interjection }) {
    if (!session && rt.ids.length < 2) { toast('اختر مدرّبَين على الأقل'); return; }
    $('#tx').querySelector('.tx-empty')?.remove();
    if (!session) {
      session = { id: null, type: 'roundtable', messages: [] };
      $('#tx').insertAdjacentHTML('beforeend', `<div class="tx-user question"><span class="tx-label">${ROUNDTABLE_STYLES.find(s => s.id === rt.style)?.icon} موضوع الجلسة</span><p>${esc(topic)}</p></div>`);
      return runStream('/api/council/roundtable', { topic, style: rt.style, mentorIds: rt.ids, rounds: rt.rounds });
    }
    $('#tx').insertAdjacentHTML('beforeend', itemHTML({ role: 'user', kind: 'interjection', text: interjection }));
    runStream('/api/council/roundtable', { sessionId: session.id, interjection });
  }

  // ---------- misc events ----------
  $('#modeSeg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b || busy || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    session = null;
    root.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
    paintTx(); paintFoot();
    light(mode === 'roundtable' ? { assigned: rt.ids } : {});
    tableStatus(mode === 'roundtable' ? 'اختر المشاركين من المقاعد' : 'المجلس بانتظار سؤالك');
  });
  $('#tx').addEventListener('click', e => {
    const ex = e.target.closest('[data-ex]');
    if (ex) return ask(ex.dataset.ex);
    const tg = e.target.closest('[data-togoal]');
    if (tg) {
      const m = session.messages.find(x => x.id === tg.dataset.togoal);
      const q = session.messages.find(x => x.kind === 'question')?.text || session.topic || '';
      const steps = extractSteps(m.text);
      goalModal({ title: q.slice(0, 120), why: 'خطة من المجلس', mentorId: session.messages.find(x => x.kind === 'answer' || x.kind === 'turn')?.mentorId, milestones: steps.map(t => ({ text: t.slice(0, 200) })) });
    }
  });
  $('#historyBtn').onclick = () => {
    const list = state.council;
    const dr = openDrawer({
      title: `${icon('history', 18)} الجلسات السابقة`,
      body: list.length ? `<div class="hist">${list.map(s => `<div class="hist-item"><button data-open="${s.id}"><span class="tag">${s.type === 'roundtable' ? '💬 نقاش' : '✨ سؤال'}</span><b>${esc(s.title)}</b><small class="muted">${timeAgo(s.createdAt)} · ${s.messages.length} رسالة</small></button><button class="icon-btn sm" data-del="${s.id}" aria-label="حذف">${icon('trash', 15)}</button></div>`).join('')}</div>`
        : emptyState('history', 'ما في جلسات بعد', 'أول سؤال للمجلس رح ينحفظ هون.'),
    });
    dr.el.addEventListener('click', async e => {
      const o = e.target.closest('[data-open]');
      if (o) {
        session = structuredClone(state.council.find(s => s.id === o.dataset.open));
        mode = session.type === 'roundtable' ? 'roundtable' : 'ask';
        if (mode === 'roundtable') rt.ids = session.mentorIds || rt.ids;
        root.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
        paintTx(); paintFoot(); light(mode === 'roundtable' ? { assigned: rt.ids } : {});
        dr.close();
      }
      const del = e.target.closest('[data-del]');
      if (del && await confirmBox('حذف هذه الجلسة؟', { danger: true, okText: 'احذف' })) {
        await api.del(`/api/council/${del.dataset.del}`);
        removeFrom('council', del.dataset.del);
        del.closest('.hist-item').remove();
      }
    });
  };

  paintTable();
  paintTx();
  paintFoot();
  light(mode === 'roundtable' ? { assigned: rt.ids } : {});
  if (query.get('q')) ask(query.get('q'));
  return () => busy?.abort();
}
