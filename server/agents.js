// Agent orchestration: every "brain" of the platform goes through here (real DeepSeek or demo mode).
import * as db from './db.js';
import * as P from './prompts.js';
import * as M from './mock.js';
import { complete, stream, isMock } from './llm.js';
import { uid, today } from './store.js';
import { MEMORY_SECTIONS, LESSON_TYPES } from '../public/js/catalog.js';

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const clamp = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return today(d); };

export async function mentorContext(mentor, extra = {}) {
  const [profile, memory, goals, paths, mentors] = await Promise.all([
    db.getProfile(), db.getMemory(mentor.id), db.listGoals(), db.listPaths(), db.listMentors(),
  ]);
  return { mentor, profile, memory, goals, paths, mentors, ...extra };
}

// ---------- 1:1 mentoring ----------
export async function* mentorReply(ctx, text, signal) {
  if (await isMock()) return yield* M.streamText(M.chatReply(ctx, text), signal);
  yield* stream({ messages: P.chatMessages(ctx, text), temperature: 0.7, maxTokens: 1800, signal });
}

export async function* checkin(ctx, first, signal) {
  if (await isMock()) return yield* M.streamText(M.checkin(ctx, first), signal);
  yield* stream({ messages: P.checkinMessages(ctx, first), temperature: 0.8, maxTokens: 300, signal });
}

export async function updateMemory(ctx, userText, replyText) {
  const out = (await isMock())
    ? M.memory(ctx, userText)
    : await complete({ messages: P.memoryMessages(ctx, userText, replyText), json: true, temperature: 0.2, maxTokens: 500 });
  const add = (Array.isArray(out?.add) ? out.add : [])
    .filter(x => x && typeof x.text === 'string' && x.text.trim())
    .slice(0, 3)
    .map(x => ({ section: MEMORY_SECTIONS.includes(x.section) ? x.section : MEMORY_SECTIONS[0], text: str(x.text, 240) }));
  const remove = (Array.isArray(out?.remove) ? out.remove : []).filter(s => typeof s === 'string').slice(0, 3);
  const res = (add.length || remove.length) ? await db.applyMemory(ctx.mentor.id, { add, remove }) : { added: [], removed: [] };
  let goal = null;
  if (out?.goal?.title) {
    const title = str(out.goal.title, 120);
    const exists = ctx.goals.some(g => g.title.includes(title.slice(0, 14)) || title.includes(g.title.slice(0, 14)));
    if (!exists) goal = { title, why: str(out.goal.why, 240), deadline_days: clamp(out.goal.deadline_days, 3, 365, 30) };
  }
  return { ...res, goal };
}

// ---------- council ----------
export async function route({ director, team, profile, question, prior }) {
  const r = (await isMock())
    ? M.route(team, question)
    : await complete({ messages: P.routeMessages({ director, team, profile, question, prior }), json: true, temperature: 0.2, maxTokens: 700 });
  const ids = new Set(team.map(m => m.id));
  const seen = new Set();
  const assignments = (Array.isArray(r?.assignments) ? r.assignments : [])
    .filter(a => ids.has(a?.mentor_id) && !seen.has(a.mentor_id) && seen.add(a.mentor_id))
    .slice(0, 3)
    .map(a => ({ mentorId: a.mentor_id, task: str(a.task, 300) }));
  const hire = r?.hire?.specialty ? { specialty: str(r.hire.specialty, 120), reason: str(r.hire.reason, 240) } : null;
  return { decision: str(r?.decision, 400) || 'وزّعت سؤالك على المدرّب الأنسب.', assignments, hire };
}

export async function* panelAnswer(ctx, opts, signal) {
  if (await isMock()) return yield* M.streamText(M.panel(ctx, opts), signal);
  yield* stream({ messages: P.panelMessages(ctx, opts), temperature: 0.7, maxTokens: 700, signal });
}

export async function* synthesis(opts, signal) {
  if (await isMock()) return yield* M.streamText(M.synthesis(opts.answers), signal);
  yield* stream({ messages: P.synthesisMessages(opts), temperature: 0.5, maxTokens: 500, signal });
}

export async function* directorAnswer(opts, signal) {
  if (await isMock()) return yield* M.streamText(M.directorAnswer(opts.question, opts.team), signal);
  yield* stream({ messages: P.directorAnswerMessages(opts), temperature: 0.6, maxTokens: 500, signal });
}

export async function* roundtableTurn(ctx, opts, signal) {
  if (await isMock()) return yield* M.streamText(M.turn(ctx, opts), signal);
  yield* stream({ messages: P.turnMessages(ctx, opts), temperature: 0.85, maxTokens: 400, signal });
}

export async function* roundtableSummary(opts, signal) {
  if (await isMock()) return yield* M.streamText(M.roundtableSummary(opts.participants), signal);
  yield* stream({ messages: P.roundtableSummaryMessages(opts), temperature: 0.5, maxTokens: 550, signal });
}

// ---------- structured generators ----------
export async function generatePath(ctx, spec) {
  const raw = (await isMock())
    ? (await new Promise(r => setTimeout(r, 2200)), M.path(spec))
    : await complete({ messages: P.pathMessages(ctx, spec), json: true, temperature: 0.5, maxTokens: 6000 });
  const modules = (Array.isArray(raw?.modules) ? raw.modules : []).slice(0, 8).map(mod => ({
    id: uid('md'),
    title: str(mod?.title, 120) || 'وحدة',
    goal: str(mod?.goal, 240),
    lessons: (Array.isArray(mod?.lessons) ? mod.lessons : []).slice(0, 8).map(l => ({
      id: uid('ls'),
      title: str(l?.title, 140) || 'درس',
      objective: str(l?.objective, 300),
      type: l?.type in LESSON_TYPES ? l.type : 'concept',
      duration: clamp(l?.duration_min ?? l?.duration, 5, 300, 30),
      outline: (Array.isArray(l?.outline) ? l.outline : []).map(o => str(o, 160)).filter(Boolean).slice(0, 7),
      exercise: str(l?.exercise, 500),
      resources: (Array.isArray(l?.resources) ? l.resources : []).map(o => str(o, 200)).filter(Boolean).slice(0, 5),
      done: false,
      doneAt: null,
    })).filter(l => l.title),
  })).filter(m => m.lessons.length);
  if (!modules.length) throw Object.assign(new Error('لم يتمكن المدرّب من بناء المسار، حاول مرة أخرى.'), { status: 502 });
  return {
    id: uid('p'),
    mentorId: ctx.mentor.id,
    goalId: spec.goalId || null,
    topic: spec.topic,
    title: str(raw.title, 140) || spec.topic,
    summary: str(raw.summary, 600),
    level: str(raw.level || spec.level, 60),
    hoursPerWeek: spec.hoursPerWeek,
    weeks: spec.weeks,
    createdAt: new Date().toISOString(),
    modules,
  };
}

export async function planGoal(ctx, goal) {
  const raw = (await isMock())
    ? (await new Promise(r => setTimeout(r, 1200)), M.goalPlan(goal))
    : await complete({ messages: P.goalPlanMessages(ctx, goal), json: true, temperature: 0.4, maxTokens: 900 });
  const milestones = (Array.isArray(raw?.milestones) ? raw.milestones : []).slice(0, 8).map(ms => ({
    id: uid('ms'),
    text: str(ms?.text, 200),
    due: addDays(clamp(ms?.due_in_days, 0, 730, 7)),
    done: false,
  })).filter(ms => ms.text);
  return { title: str(raw?.title, 160), milestones, firstStep: str(raw?.first_step, 300), motivation: str(raw?.motivation, 240) };
}

export async function dailyBrief() {
  const [profile, mentors, goals, paths] = await Promise.all([db.getProfile(), db.listMentors(), db.listGoals(), db.listPaths()]);
  const director = mentors.find(m => m.role === 'director');
  const input = { profile, director, goals, paths, mentors };
  let raw;
  if (await isMock()) raw = M.brief(input);
  else {
    const data = [
      `- الاسم: ${profile.name}، سلسلة الأيام المتتالية: ${profile.streak}، النقاط: ${profile.xp}`,
      `- الأهداف: ${goals.filter(g => g.status !== 'done').map(g => `«${g.title}» (${g.deadline ? `باقي ${P.daysLeft(g.deadline)} يوم` : 'بدون موعد'}، مدرّب: ${g.mentorId})`).join('؛ ') || 'لا يوجد'}`,
      `- المسارات: ${paths.map(p => { const all = p.modules.flatMap(m => m.lessons); const next = all.find(l => !l.done); return `«${p.title}» ${all.filter(l => l.done).length}/${all.length}${next ? ` التالي «${next.title}»` : ''} (مدرّب: ${p.mentorId})`; }).join('؛ ') || 'لا يوجد'}`,
      `- المدرّبون: ${mentors.filter(m => m.role !== 'director').map(m => `${m.id}=${m.name} (${m.title}) آخر تفاعل: ${m.lastInteraction ? m.lastInteraction.slice(0, 10) : 'أبداً'}`).join('؛ ') || 'لا يوجد'}`,
    ].join('\n');
    try {
      raw = await complete({ messages: P.briefMessages(director, profile, data), json: true, temperature: 0.7, maxTokens: 500 });
    } catch (e) {
      console.warn('[brief] falling back to computed brief:', e.message);
      raw = M.brief(input);
    }
  }
  const ids = new Set(mentors.map(m => m.id));
  return {
    date: today(),
    greeting: str(raw?.greeting, 120),
    focus: (Array.isArray(raw?.focus) ? raw.focus : []).slice(0, 3).map(f => ({
      text: str(f?.text, 200),
      mentorId: ids.has(f?.mentor_id) ? f.mentor_id : null,
      action: ['chat', 'lesson', 'goal'].includes(f?.action) ? f.action : 'chat',
    })).filter(f => f.text),
    nudge: str(raw?.nudge, 200),
  };
}

export async function proposeTeam(spec) {
  const mentors = await db.listMentors();
  const director = mentors.find(m => m.role === 'director');
  const raw = (await isMock())
    ? (await new Promise(r => setTimeout(r, 1800)), M.team(spec))
    : await complete({ messages: P.teamMessages(director, spec), json: true, temperature: 0.8, maxTokens: 2500 });
  const list = (Array.isArray(raw?.mentors) ? raw.mentors : []).slice(0, 3).map(m => db.sanitizeMentor({ ...m, id: 'draft' }));
  if (!list.length) throw Object.assign(new Error('لم يتمكن المدير من اقتراح فريق، حاول مرة أخرى.'), { status: 502 });
  return { message: str(raw?.message, 600), goalTitle: str(raw?.goal_title, 160) || str(spec.goal, 160), mentors: list };
}
