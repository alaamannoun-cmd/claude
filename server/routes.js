import * as db from './db.js';
import * as A from './agents.js';
import { publicConfig, testConnection } from './llm.js';
import { uid, today } from './store.js';
import { parseMemory } from './memory.js';

const routes = [];
const on = (method, pattern, handler) =>
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });
const now = () => new Date().toISOString();
const bad = db.httpError;
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return today(d); };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2_000_000) { reject(bad('الطلب كبير جداً', 413)); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('JSON غير صالح')); }
    });
    req.on('error', reject);
  });
}

/** Server-Sent Events over a POST response. `signal` aborts when the browser disconnects/stops. */
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  return {
    signal: ctrl.signal,
    send(event, data) { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); },
    end() { if (!res.writableEnded) res.end(); },
  };
}

/** Streams a generator as `delta` events; returns the full text. */
async function pipe(s, gen) {
  let text = '';
  for await (const t of gen) {
    text += t;
    s.send('delta', { t });
  }
  return text;
}

export async function handleApi(req, res, url) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    try {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const out = await r.handler({ req, res, params, body, query: url.searchParams });
      if (out !== undefined && !res.headersSent) json(res, 200, out);
    } catch (e) {
      if (!e.status || e.status >= 500) console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.message || 'خطأ غير متوقع' });
      else if (!res.writableEnded) res.end();
    }
    return;
  }
  json(res, 404, { error: 'غير موجود' });
}

// =============== state & config ===============
on('GET', '/api/state', async () => {
  await db.ensureDirector();
  const [profile, mentors, goals, paths, council, config] = await Promise.all([
    db.getProfile(), db.listMentors(), db.listGoals(), db.listPaths(), db.listSessions(), publicConfig(),
  ]);
  return { profile, mentors, goals, paths, council, config };
});

on('POST', '/api/config', async ({ body }) => {
  const patch = {};
  if (body.clearKey) patch.apiKey = null;
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    const key = body.apiKey.trim();
    if (!/^[\w.-]{16,200}$/.test(key)) throw bad('صيغة المفتاح غير صحيحة');
    patch.apiKey = key;
  }
  if (typeof body.model === 'string' && /^[\w.-]{3,60}$/.test(body.model)) patch.model = body.model;
  await db.patchConfig(patch);
  return { config: await publicConfig() };
});

on('POST', '/api/config/test', async () => testConnection());

on('PUT', '/api/profile', async ({ body }) => ({ profile: await db.saveProfile(body) }));

// =============== onboarding ===============
on('POST', '/api/onboarding/propose', async ({ body }) => {
  const spec = {
    name: str(body.name, 40) || 'صديقي',
    goal: str(body.goal, 500),
    level: str(body.level, 40) || 'مبتدئ',
    hours: Math.max(1, Math.min(40, Number(body.hours) || 5)),
  };
  if (!spec.goal) throw bad('اكتب هدفك أولاً');
  return A.proposeTeam(spec);
});

on('POST', '/api/onboarding/complete', async ({ body }) => {
  const profile = await db.saveProfile({ name: body.name, bio: body.bio, preferences: body.preferences, onboarded: true });
  const created = [];
  for (const spec of (Array.isArray(body.mentors) ? body.mentors : []).slice(0, 4)) {
    const { id, role, ...rest } = spec || {};
    created.push(await db.createMentor(rest, profile));
  }
  // the director also learns about the learner
  await db.applyMemory('director', { add: [
    { section: 'عن المتعلّم', text: `الاسم: ${profile.name}` },
    ...(body.goal?.title ? [{ section: 'الأهداف والطموحات', text: body.goal.title }] : []),
    ...(body.level ? [{ section: 'المستوى ونقاط القوة', text: `المستوى المبدئي: ${str(body.level, 40)}` }] : []),
  ] });
  if (body.goal?.title) {
    const days = Math.max(7, Math.min(730, Number(body.goal.days) || 90));
    const goal = {
      id: uid('g'), title: str(body.goal.title, 160), why: str(body.goal.why, 400), deadline: addDays(days),
      mentorId: created[0]?.id || null, reminder: 'daily', milestones: [], status: 'active', createdAt: now(),
    };
    await db.saveGoals(list => { list.push(goal); });
    for (const m of created) await db.applyMemory(m.id, { add: [{ section: 'الأهداف والطموحات', text: goal.title }] });
  }
  return { ok: true, profile: await db.gainXp(25) };
});

// =============== mentors ===============
on('POST', '/api/mentors', async ({ body }) => {
  const { id, role, ...rest } = body;
  const mentor = await db.createMentor(rest);
  const profile = await db.gainXp(20);
  return { mentor, profile, gained: 20 };
});

on('PUT', '/api/mentors/:id', async ({ params, body }) => ({ mentor: await db.updateMentor(params.id, body) }));

on('DELETE', '/api/mentors/:id', async ({ params }) => {
  await db.deleteMentor(params.id);
  return { ok: true };
});

// memory (the per-mentor memory.md file)
on('GET', '/api/mentors/:id/memory', async ({ params }) => {
  await db.getMentor(params.id);
  const markdown = await db.getMemory(params.id);
  return { markdown, sections: parseMemory(markdown), updatedAt: await db.memoryUpdatedAt(params.id), file: `data/${db.memoryPath(params.id)}` };
});

on('PUT', '/api/mentors/:id/memory', async ({ params, body }) => {
  await db.getMentor(params.id);
  await db.saveMemory(params.id, String(body.markdown ?? ''));
  const markdown = await db.getMemory(params.id);
  return { markdown, sections: parseMemory(markdown) };
});

on('POST', '/api/mentors/:id/memory/items', async ({ params, body }) => {
  await db.getMentor(params.id);
  const text = str(body.text, 300);
  if (!text) throw bad('النص فارغ');
  const res = await db.applyMemory(params.id, { add: [{ section: str(body.section, 60) || 'عن المتعلّم', text }] });
  const markdown = await db.getMemory(params.id);
  return { ...res, markdown, sections: parseMemory(markdown) };
});

on('DELETE', '/api/mentors/:id/memory/items', async ({ params, body }) => {
  await db.getMentor(params.id);
  await db.applyMemory(params.id, { remove: [str(body.text, 400)] });
  const markdown = await db.getMemory(params.id);
  return { markdown, sections: parseMemory(markdown) };
});

on('POST', '/api/mentors/:id/memory/reset', async ({ params }) => {
  await db.resetMemory(params.id);
  const markdown = await db.getMemory(params.id);
  return { markdown, sections: parseMemory(markdown) };
});

// chat
on('GET', '/api/mentors/:id/chat', async ({ params }) => {
  await db.getMentor(params.id);
  return { messages: await db.getChat(params.id) };
});

on('DELETE', '/api/mentors/:id/chat', async ({ params }) => {
  await db.clearChat(params.id);
  return { ok: true };
});

on('POST', '/api/mentors/:id/chat', async ({ res, params, body }) => {
  const mentor = await db.getMentor(params.id);
  const message = str(body.message, 8000);
  if (!message) throw bad('الرسالة فارغة');
  const lesson = body.lesson ? await db.findLesson(str(body.lesson.pathId, 60), str(body.lesson.lessonId, 60)) : null;
  const history = await db.getChat(mentor.id);
  const lessonRef = lesson ? { pathId: lesson.path.id, lessonId: lesson.lesson.id, title: lesson.lesson.title } : undefined;
  const userMsg = { id: uid('u'), role: 'user', text: message, at: now(), lesson: lessonRef, hidden: !!body.hidden || undefined };
  await db.appendChat(mentor.id, userMsg);
  const ctx = await A.mentorContext(mentor, { history, lesson });

  const s = sse(res);
  s.send('start', { userMessage: userMsg });
  let text = '';
  try {
    for await (const t of A.mentorReply(ctx, message, s.signal)) { text += t; s.send('delta', { t }); }
  } catch (e) {
    if (!s.signal.aborted) s.send('error', { message: e.message });
  }
  if (!text.trim()) return s.end();

  const reply = { id: uid('a'), role: 'mentor', text, at: now(), lesson: lessonRef };
  await db.appendChat(mentor.id, reply);
  const profile = await db.gainXp(5, 'messages');
  await db.bumpBond(mentor.id, 2);
  s.send('done', { message: reply, profile, gained: 5 });

  try {
    const mem = await A.updateMemory(ctx, message, text);
    if (mem.added.length || mem.removed.length || mem.goal) {
      await db.patchChatMessage(mentor.id, reply.id, { memory: mem.added, suggestion: mem.goal || undefined });
      s.send('memory', { messageId: reply.id, ...mem });
    }
  } catch (e) {
    console.warn('[memory] update failed:', e.message);
  }
  s.end();
});

on('POST', '/api/mentors/:id/checkin', async ({ res, params, body }) => {
  const mentor = await db.getMentor(params.id);
  const history = await db.getChat(mentor.id);
  const ctx = await A.mentorContext(mentor, { history });
  const s = sse(res);
  s.send('start', {});
  let text = '';
  try { text = await pipe(s, A.checkin(ctx, !!body.first || !history.length, s.signal)); }
  catch (e) { if (!s.signal.aborted) s.send('error', { message: e.message }); }
  if (text.trim()) {
    const msg = { id: uid('a'), role: 'mentor', text, at: now(), kind: 'checkin' };
    await db.appendChat(mentor.id, msg);
    await db.bumpBond(mentor.id, 1);
    s.send('done', { message: msg });
  }
  s.end();
});

// =============== council ===============
async function councilCast() {
  const [mentors, profile] = await Promise.all([db.listMentors(), db.getProfile()]);
  return { director: mentors.find(m => m.role === 'director'), team: mentors.filter(m => m.role !== 'director'), profile, mentors };
}

function priorOf(session) {
  const out = [];
  const msgs = session?.messages || [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].kind !== 'question') continue;
    const ans = msgs.slice(i + 1).find(m => m.kind === 'synthesis' || (m.kind === 'answer' && m.role === 'director'));
    if (ans) out.push({ q: msgs[i].text.slice(0, 300), a: ans.text.slice(0, 500) });
  }
  return out.slice(-2);
}

on('POST', '/api/council/ask', async ({ res, body }) => {
  const question = str(body.question, 4000);
  if (!question) throw bad('اكتب سؤالك');
  const { director, team, profile } = await councilCast();
  let session = body.sessionId ? await db.getSession(str(body.sessionId, 60)) : null;
  if (!session || session.type !== 'ask') session = { id: uid('c'), type: 'ask', title: question.slice(0, 90), createdAt: now(), messages: [] };
  const prior = priorOf(session);
  const push = msg => (session.messages.push({ id: uid('x'), at: now(), ...msg }), msg);

  const s = sse(res);
  push({ role: 'user', kind: 'question', text: question });
  s.send('session', { id: session.id, title: session.title });
  try {
    s.send('phase', { phase: 'routing' });
    const r = team.length ? await A.route({ director, team, profile, question, prior }) : { decision: '', assignments: [], hire: null };
    if (team.length) {
      push({ role: 'director', mentorId: director.id, kind: 'decision', text: r.decision, assignments: r.assignments, hire: r.hire });
      s.send('route', r);
    }
    const answers = [];
    for (const a of r.assignments) {
      if (s.signal.aborted) break;
      const m = team.find(x => x.id === a.mentorId);
      s.send('speaker', { mentorId: m.id, kind: 'answer', task: a.task });
      const ctx = await A.mentorContext(m);
      const text = await pipe(s, A.panelAnswer(ctx, { question, task: a.task, prev: answers, director, prior }, s.signal));
      answers.push({ name: m.name, mentorId: m.id, text });
      push({ role: 'mentor', mentorId: m.id, kind: 'answer', text, task: a.task });
      s.send('speaker_end', { mentorId: m.id });
      await db.bumpBond(m.id, 2);
    }
    if (!s.signal.aborted) {
      s.send('speaker', { mentorId: director.id, kind: answers.length ? 'synthesis' : 'answer' });
      const text = answers.length
        ? await pipe(s, A.synthesis({ director, profile, question, answers }, s.signal))
        : await pipe(s, A.directorAnswer({ director, profile, question, team, prior }, s.signal));
      push({ role: 'director', mentorId: director.id, kind: answers.length ? 'synthesis' : 'answer', text, hire: answers.length ? undefined : (r.hire || (team.length ? null : { specialty: 'مدرّب يخدم هدفك الأساسي', reason: 'فريقك فارغ حالياً' })) });
      s.send('speaker_end', { mentorId: director.id });
    }
  } catch (e) {
    if (!s.signal.aborted) s.send('error', { message: e.message });
  }
  await db.saveSession(session);
  const profileNow = await db.gainXp(15, 'sessions');
  s.send('done', { session, profile: profileNow, gained: 15 });
  s.end();
});

on('POST', '/api/council/roundtable', async ({ res, body }) => {
  const { director, team, profile } = await councilCast();
  let session = body.sessionId ? await db.getSession(str(body.sessionId, 60)) : null;
  if (!session || session.type !== 'roundtable') {
    const topic = str(body.topic, 600);
    if (!topic) throw bad('اكتب موضوع الجلسة');
    const ids = (Array.isArray(body.mentorIds) ? body.mentorIds : []).filter(id => team.some(m => m.id === id)).slice(0, 4);
    if (ids.length < 2) throw bad('اختر مدرّبَين على الأقل');
    session = { id: uid('r'), type: 'roundtable', title: topic.slice(0, 90), topic, style: str(body.style, 20) || 'discussion', mentorIds: ids, createdAt: now(), messages: [] };
  }
  const participants = session.mentorIds.map(id => team.find(m => m.id === id)).filter(Boolean);
  if (participants.length < 2) throw bad('بعض المدرّبين المشاركين لم يعودوا موجودين');
  const rounds = body.interjection ? 1 : Math.max(1, Math.min(3, Number(body.rounds) || 2));
  const push = msg => session.messages.push({ id: uid('x'), at: now(), ...msg });
  const transcript = () => session.messages.filter(m => m.kind === 'turn' || m.kind === 'interjection').slice(-14)
    .map(m => (m.role === 'user' ? { role: 'user', text: m.text } : { name: team.find(t => t.id === m.mentorId)?.name || 'مدرّب', text: m.text }));

  const s = sse(res);
  s.send('session', { id: session.id, title: session.title });
  if (body.interjection) push({ role: 'user', kind: 'interjection', text: str(body.interjection, 2000) });
  try {
    for (let r = 0; r < rounds && !s.signal.aborted; r++) {
      for (const m of participants) {
        if (s.signal.aborted) break;
        const turnNo = session.messages.filter(x => x.kind === 'turn' && x.mentorId === m.id).length + 1;
        s.send('speaker', { mentorId: m.id, kind: 'turn' });
        const ctx = await A.mentorContext(m);
        const text = await pipe(s, A.roundtableTurn(ctx, { topic: session.topic, style: session.style, participants, transcript: transcript(), turnNo }, s.signal));
        push({ role: 'mentor', mentorId: m.id, kind: 'turn', text });
        s.send('speaker_end', { mentorId: m.id });
        await db.bumpBond(m.id, 1);
      }
    }
    if (!s.signal.aborted) {
      s.send('speaker', { mentorId: director.id, kind: 'summary' });
      const text = await pipe(s, A.roundtableSummary({ director, profile, topic: session.topic, style: session.style, transcript: transcript(), participants }, s.signal));
      push({ role: 'director', mentorId: director.id, kind: 'summary', text });
      s.send('speaker_end', { mentorId: director.id });
    }
  } catch (e) {
    if (!s.signal.aborted) s.send('error', { message: e.message });
  }
  await db.saveSession(session);
  const profileNow = await db.gainXp(20, 'sessions');
  s.send('done', { session, profile: profileNow, gained: 20 });
  s.end();
});

on('DELETE', '/api/council/:id', async ({ params }) => {
  await db.deleteSession(params.id);
  return { ok: true };
});

// =============== learning paths ===============
on('POST', '/api/paths/generate', async ({ body }) => {
  const mentor = await db.getMentor(str(body.mentorId, 60));
  const spec = {
    topic: str(body.topic, 300),
    level: str(body.level, 40) || 'مبتدئ',
    hoursPerWeek: Math.max(1, Math.min(40, Number(body.hoursPerWeek) || 5)),
    weeks: Math.max(1, Math.min(52, Number(body.weeks) || 6)),
    notes: str(body.notes, 600),
    goalId: body.goalId ? str(body.goalId, 60) : null,
  };
  if (!spec.topic) throw bad('اكتب موضوع المسار');
  const ctx = await A.mentorContext(mentor);
  const path = await A.generatePath(ctx, spec);
  await db.addPath(path);
  await db.logMemory(mentor.id, `رتّب له مسار «${path.title}» (${spec.weeks} أسابيع، ${spec.hoursPerWeek} س/أسبوع)`);
  const profile = await db.gainXp(20, 'paths');
  return { path, profile, gained: 20 };
});

on('PATCH', '/api/paths/:id/lessons/:lid', async ({ params, body }) => {
  let justDone = false, found = null;
  const path = await db.updatePath(params.id, p => {
    for (const mod of p.modules) for (const l of mod.lessons) {
      if (l.id !== params.lid) continue;
      if (body.done && !l.done) justDone = true;
      l.done = !!body.done;
      l.doneAt = l.done ? now() : null;
      found = l;
    }
  });
  if (!found) throw bad('الدرس غير موجود', 404);
  let profile, gained = 0, pathDone = false;
  if (justDone) {
    gained = 50;
    pathDone = path.modules.every(m => m.lessons.every(l => l.done));
    if (pathDone) gained += 150;
    profile = await db.gainXp(gained, 'lessons');
    if (path.mentorId) {
      await db.bumpBond(path.mentorId, 10).catch(() => {});
      await db.logMemory(path.mentorId, pathDone ? `أنهى مسار «${path.title}» بالكامل 🎓` : `أنهى درس «${found.title}» من مسار «${path.title}»`);
    }
  }
  return { path, profile, gained, pathDone };
});

on('DELETE', '/api/paths/:id', async ({ params }) => {
  await db.deletePath(params.id);
  return { ok: true };
});

// =============== goals ===============
function goalFields(body) {
  const out = {};
  if ('title' in body) out.title = str(body.title, 160);
  if ('why' in body) out.why = str(body.why, 400);
  if ('deadline' in body) out.deadline = DATE.test(body.deadline || '') ? body.deadline : null;
  if ('mentorId' in body) out.mentorId = body.mentorId ? str(body.mentorId, 60) : null;
  if ('reminder' in body) out.reminder = ['daily', 'weekly', 'none'].includes(body.reminder) ? body.reminder : 'daily';
  if (Array.isArray(body.milestones)) {
    out.milestones = body.milestones.slice(0, 12).map(ms => ({
      id: ms.id || uid('ms'), text: str(ms.text, 200), due: DATE.test(ms.due || '') ? ms.due : null, done: !!ms.done,
    })).filter(ms => ms.text);
  }
  return out;
}

on('POST', '/api/goals', async ({ body }) => {
  const fields = goalFields(body);
  if (!fields.title) throw bad('اكتب عنوان الهدف');
  const goal = { id: uid('g'), milestones: [], reminder: 'daily', status: 'active', createdAt: now(), ...fields };
  await db.saveGoals(list => { list.push(goal); });
  if (goal.mentorId) await db.applyMemory(goal.mentorId, { add: [{ section: 'الأهداف والطموحات', text: goal.title }] }).catch(() => {});
  const profile = await db.gainXp(10);
  return { goal, profile, gained: 10 };
});

on('PUT', '/api/goals/:id', async ({ params, body }) => ({ goal: await db.updateGoal(params.id, g => Object.assign(g, goalFields(body))) }));

on('PATCH', '/api/goals/:id/milestones/:mid', async ({ params, body }) => {
  let justDone = false, ms = null;
  const goal = await db.updateGoal(params.id, g => {
    ms = g.milestones.find(m => m.id === params.mid);
    if (!ms) return;
    if (body.done && !ms.done) justDone = true;
    ms.done = !!body.done;
  });
  if (!ms) throw bad('المحطة غير موجودة', 404);
  let profile, gained = 0;
  if (justDone) {
    gained = 25;
    profile = await db.gainXp(25, 'milestones');
    if (goal.mentorId) await db.logMemory(goal.mentorId, `أنجز محطة «${ms.text}» من هدف «${goal.title}»`);
  }
  return { goal, profile, gained };
});

on('POST', '/api/goals/:id/plan', async ({ params }) => {
  const goal = await db.getGoal(params.id);
  const mentors = await db.listMentors();
  const mentor = mentors.find(m => m.id === goal.mentorId) || mentors.find(m => m.role === 'director');
  const plan = await A.planGoal(await A.mentorContext(mentor), goal);
  const updated = await db.updateGoal(goal.id, g => {
    if (plan.milestones.length) g.milestones = plan.milestones;
    if (plan.title) g.smartTitle = plan.title;
    g.firstStep = plan.firstStep;
    g.motivation = plan.motivation;
    g.plannedBy = mentor.id;
  });
  return { goal: updated };
});

on('POST', '/api/goals/:id/complete', async ({ params }) => {
  let already = false;
  const goal = await db.updateGoal(params.id, g => {
    already = g.status === 'done';
    g.status = 'done';
    g.doneAt = g.doneAt || now();
  });
  if (already) return { goal };
  const profile = await db.gainXp(150, 'goals');
  if (goal.mentorId) await db.logMemory(goal.mentorId, `حقّق الهدف «${goal.title}» 🏆`);
  await db.logMemory('director', `حقّق الهدف «${goal.title}» 🏆`);
  return { goal, profile, gained: 150 };
});

on('POST', '/api/goals/:id/reopen', async ({ params }) => ({ goal: await db.updateGoal(params.id, g => { g.status = 'active'; g.doneAt = null; }) }));

on('DELETE', '/api/goals/:id', async ({ params }) => {
  await db.saveGoals(list => { const i = list.findIndex(g => g.id === params.id); if (i >= 0) list.splice(i, 1); });
  return { ok: true };
});

// =============== brief, export, reset ===============
on('POST', '/api/brief', async ({ body }) => {
  const cached = await db.getBrief();
  if (!body.force && cached?.date === today()) return cached;
  const brief = await A.dailyBrief();
  await db.saveBrief(brief);
  return brief;
});

on('GET', '/api/export', async () => db.exportAll());

on('POST', '/api/reset', async ({ body }) => {
  if (body.confirm !== 'RESET') throw bad('تأكيد غير صحيح');
  await db.resetAll();
  return { ok: true };
});

