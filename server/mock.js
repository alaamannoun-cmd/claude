// Demo mode: realistic canned behaviour so the whole product can be explored without an API key.
import { TEMPLATES } from '../public/js/templates.js';
import { greetingWord, STYLES, ROUNDTABLE_STYLES } from '../public/js/catalog.js';
import { daysLeft } from './prompts.js';
import { today } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const short = (s, n = 80) => (s.length > n ? s.slice(0, n).trim() + '…' : s);
const NOTE = '\n\n> 🧪 *وضع تجريبي: هذا رد توضيحي. أضف مفتاح DeepSeek من الإعدادات لتحصل على إجابات حقيقية ومتخصصة.*';

export async function* streamText(text, signal) {
  const tokens = text.split(/(\s+)/);
  for (let i = 0; i < tokens.length; i += 2) {
    if (signal?.aborted) return;
    await sleep(12 + Math.random() * 22);
    yield tokens.slice(i, i + 2).join('');
  }
}

const dueLine = g => {
  const d = daysLeft(g.deadline);
  return d == null ? '' : d < 0 ? `متأخر ${-d} يوم` : d === 0 ? 'موعده اليوم' : `باقي ${d} يوم`;
};

export function chatReply(ctx, text) {
  const { mentor: m, profile, goals = [], lesson } = ctx;
  const hi = `${greetingWord(m.dialect)} ${profile.name || ''}!`.trim();
  if (lesson) {
    const l = lesson.lesson;
    return `${hi} 📘 خلّينا نبدأ درس **«${l.title}»**.

**هدف الدرس:** ${l.objective}

قبل ما أشرح، سؤال سريع لأعرف من وين نبدأ:
> شو بتعرف حالياً عن «${(l.outline || [])[0] || l.title}»؟

بعدها رح نمشي على المحاور وحدة وحدة:
${(l.outline || []).map((o, i) => `${i + 1}. ${o}`).join('\n')}${NOTE}`;
  }
  const g = goals.find(x => x.status !== 'done' && (x.mentorId === m.id || !x.mentorId));
  const style = STYLES.find(s => s.id === m.styles?.[0])?.label || 'تطبيقي';
  return `${hi}

سؤالك **«${short(text, 90)}»** من صلب تخصصي (${short(m.specialty.split(/[،,(]/)[0], 50)}). هيك رح نشتغل عليه:

### خطة سريعة
1. **نحدّد مستواك** بسؤالين قصيرين.
2. **نبني الفكرة خطوة بخطوة** بأسلوب ${style}.
3. **نطبّق فوراً** بتمرين صغير مرتبط بهدفك.

| المرحلة | الوقت | الناتج |
|---|---|---|
| فهم | 10 د | صورة واضحة للمفهوم |
| تطبيق | 20 د | تمرين محلول |

**خطوتك التالية:** احكيلي شو جرّبت لحد هلّق؟${g ? `\n\n📌 تذكير: هدفك «${g.title}» — ${dueLine(g)}.` : ''}${m.catchphrase ? `\n\n*${m.catchphrase}*` : ''}${NOTE}`;
}

export function checkin(ctx, first) {
  const { mentor: m, profile, goals = [], paths = [] } = ctx;
  const hi = `${greetingWord(m.dialect)} ${profile.name || ''}!`.trim();
  if (first) return `${hi} أنا **${m.name}**، ${m.title}. ${m.description || ''}\n\nرح أكون معك خطوة بخطوة، وأتذكّر كل شي بتحكيلي ياه حتى نبني على تقدّمك.\n\n**سؤال أول:** وين مستواك حالياً في ${short(m.specialty.split(/[،,(]/)[0], 40)}؟`;
  const g = goals.find(x => x.status !== 'done' && x.mentorId === m.id) || goals.find(x => x.status !== 'done');
  const p = paths.find(x => x.mentorId === m.id);
  const next = p?.modules.flatMap(x => x.lessons).find(l => !l.done);
  return `${hi} اشتقنالك 👋\n\n${g ? `📌 هدفك **«${g.title}»** — ${dueLine(g)}.` : ''}${next ? `\n📘 الدرس التالي بمسارك: **«${next.title}»**.` : ''}\n\n**سؤال:** شو أنجزت من آخر مرة حكينا؟`;
}

export function memory(ctx, text) {
  const add = [];
  let goal = null;
  const name = text.match(/(?:اسمي|my name is)\s+([^\s،,.]+)/i);
  if (name) add.push({ section: 'عن المتعلّم', text: `يحب أن يُنادى باسم ${name[1]}` });
  const want = text.match(/(?:بدي|أريد|اريد|هدفي|حابب|i want to|my goal is)\s+(.{6,80}?)(?:[.،,!؟?]|$)/i);
  if (want) {
    add.push({ section: 'الأهداف والطموحات', text: `يرغب في ${want[1].trim()}` });
    if (!ctx.goals?.some(g => g.title.includes(want[1].trim().slice(0, 12)))) goal = { title: want[1].trim(), why: 'ذكرته في المحادثة', deadline_days: 30 };
  }
  if (/(?:ما بفهم|صعب|مش فاهم|confus|difficult|hard)/i.test(text)) add.push({ section: 'نقاط تحتاج تحسين', text: `يجد صعوبة في: ${short(text, 60)}` });
  if (!add.length && Math.random() < 0.35) add.push({ section: 'سجل التقدّم', text: `[${today()}] ناقش: ${short(text, 60)}` });
  return { add, remove: [], goal };
}

const words = s => (s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
export function route(team, question) {
  const q = words(question);
  const scored = team.map(m => {
    const hay = `${m.title} ${m.specialty} ${m.scope}`.toLowerCase();
    return { m, score: q.filter(w => hay.includes(w) || hay.includes(w.slice(0, 4))).length };
  }).sort((a, b) => b.score - a.score);
  let chosen = scored.filter(s => s.score > 0).slice(0, 2).map(s => s.m);
  if (!chosen.length) chosen = team.slice(0, Math.min(2, team.length));
  return {
    decision: chosen.length > 1
      ? `سؤالك إله أكثر من زاوية، فوزّعته على ${chosen.map(m => m.name).join(' و')} — كل واحد من تخصصه.`
      : `هاد السؤال من صلب تخصص ${chosen[0]?.name}، فخلّيته يتولّاه.`,
    assignments: chosen.map(m => ({ mentor_id: m.id, task: `أجب من زاوية ${short(m.specialty.split(/[،,(]/)[0], 40)}` })),
    hire: null,
  };
}

export function panel(ctx, { question, task, prev }) {
  const m = ctx.mentor;
  const ref = prev.length ? `بكمّل على كلام ${prev[prev.length - 1].name} — ` : '';
  return `${ref}من زاويتي كـ${m.title}: ${task}.\n\n- **النقطة الأهم:** ابدأ من الأساس المرتبط بسؤالك «${short(question, 50)}».\n- **تمرين سريع:** خصّص 20 دقيقة اليوم لتطبيق فكرة واحدة.\n- **انتبه:** لا تحاول تتعلّم كل شي مرة وحدة.${m.catchphrase ? `\n\n*${m.catchphrase}*` : ''}`;
}

export function synthesis(answers) {
  return `**الخلاصة:** المدرّبون متفقون إن البداية الصحيحة هي أساس قوي مع تطبيق يومي صغير.\n**خطة العمل:**\n${answers.map((a, i) => `${i + 1}. طبّق توصية اليوم الأولى (${a.name})`).join('\n')}\n${answers.length + 1}. راجع تقدّمك بعد أسبوع (سَنَد)\n**سؤال للمتابعة:** أي خطوة رح تبدأ فيها اليوم؟${NOTE}`;
}

export function directorAnswer(question, team) {
  return `سؤال مهم! «${short(question, 60)}» — ${team.length ? 'ما لقيت حدا من الفريق متخصص فيه تماماً.' : 'لسا ما عندك مدرّبين بالفريق.'}\n\nنصيحتي السريعة: قسّم الموضوع لخطوات صغيرة وابدأ بأول خطوة اليوم.\n\n💡 **اقتراح:** صمّم مدرّباً متخصصاً لهذا المجال من «صانع المدربين».${NOTE}`;
}

export function turn(ctx, { style, transcript, turnNo }) {
  const m = ctx.mentor;
  const last = [...transcript].reverse().find(t => t.name && t.name !== m.name);
  const lead = last ? `${last.name}، ` : '';
  const st = ROUNDTABLE_STYLES.find(s => s.id === style)?.id || 'discussion';
  const body = {
    discussion: `فكرة حلوة، وبضيف عليها من تخصصي: ${short(m.specialty.split(/[،,(]/)[0], 40)} بيلعب دور أساسي هون، لأنه بيعطي المتعلّم أساس عملي بيقدر يبني عليه.`,
    debate: turnNo % 2 ? `أنا بشوف الموضوع من زاوية مختلفة تماماً: الأولوية لازم تكون للتطبيق قبل النظرية، والدليل إن المتعلّم بيحفظ أكثر لما يجرّب بإيده.` : `بحترم رأيك، بس ما بتفق كلياً — بدون أساس نظري التطبيق رح يكون عشوائي.`,
    brainstorm: `شو رأيكم لو عملنا تحدّي أسبوعي صغير مرتبط بـ${short(m.specialty.split(/[،,(]/)[0], 30)}؟ بيخلّي التعلّم ممتع وبيعطي نتيجة ملموسة.`,
    plan: `من جهتي: أسبوعين أساسيات، وبعدها مشروع صغير. بيتكامل مع خطتكم لأنه بيعطي التطبيق اللي بتحكوا عنه.`,
  }[st];
  return `${lead}${body}${m.catchphrase && turnNo === 1 ? ` ${m.catchphrase}` : ''}`;
}

export function roundtableSummary(participants) {
  return `**أبرز الأفكار:**\n- البداية بأساس واضح\n- التطبيق اليومي الصغير\n- تحدٍّ أسبوعي يحافظ على الحماس\n**اتفقوا على:** أهمية الاستمرارية. **اختلفوا حول:** النظرية أولاً أم التطبيق.\n**توصيتي لك:**\n${participants.map((p, i) => `${i + 1}. نفّذ اقتراح ${p.name} هذا الأسبوع (${p.name})`).join('\n')}${NOTE}`;
}

export function path(spec) {
  const t = spec.topic;
  const L = (title, type, duration_min, objective, outline, exercise) => ({ title, type, duration_min, objective, outline, exercise, resources: ['التوثيق الرسمي للموضوع', 'كتاب مرجعي تمهيدي معروف في المجال'] });
  return {
    title: `رحلتك في ${short(t, 40)}`,
    summary: `مسار عملي متدرّج مصمّم لمستوى «${spec.level}» بمعدّل ${spec.hoursPerWeek} ساعات أسبوعياً. (مسار تجريبي — مع مفتاح DeepSeek رح يكون مخصّص بالكامل.)`,
    level: spec.level,
    modules: [
      { title: 'الأساسيات والصورة الكبيرة', goal: 'فهم المفاهيم الجوهرية والمصطلحات', lessons: [
        L(`ما هو ${short(t, 30)}؟ الخريطة الكاملة`, 'concept', 30, 'يشرح المتعلّم الفكرة العامة بكلماته', ['التعريف', 'لماذا يهم', 'المكوّنات الرئيسية'], 'اكتب ملخصاً من 5 أسطر بكلماتك'),
        L('المفاهيم الجوهرية', 'concept', 45, 'يميّز بين المفاهيم الأساسية', ['المفهوم الأول', 'المفهوم الثاني', 'العلاقة بينهما'], 'ارسم خريطة ذهنية للمفاهيم'),
        L('تطبيق أول بسيط', 'practice', 40, 'ينفّذ أول تطبيق عملي', ['تجهيز الأدوات', 'خطوة بخطوة', 'أخطاء شائعة'], 'نفّذ المثال وعدّل عليه'),
        L('اختبار الوحدة الأولى', 'quiz', 20, 'يتحقق من فهم الأساسيات', ['أسئلة سريعة', 'مراجعة الأخطاء'], 'أجب عن 5 أسئلة'),
      ] },
      { title: 'التطبيق العملي', goal: 'تحويل الفهم إلى مهارة', lessons: [
        L('أدوات وتقنيات العمل', 'concept', 40, 'يستخدم الأدوات الأساسية بثقة', ['الأدوات', 'متى تستخدم كل أداة', 'مثال'], 'قارن بين أداتين في جدول'),
        L('تمارين متدرّجة', 'practice', 60, 'يحل تمارين من السهل إلى المتوسط', ['تمرين سهل', 'تمرين متوسط', 'تمرين تحدٍّ'], 'حل 3 تمارين'),
        L('مشروع مصغّر', 'project', 90, 'يبني مشروعاً صغيراً كاملاً', ['التخطيط', 'التنفيذ', 'العرض'], 'سلّم المشروع للمدرّب للمراجعة'),
      ] },
      { title: 'التعمّق والإتقان', goal: 'الوصول لمستوى الاستقلالية', lessons: [
        L('حالات متقدمة وأخطاء شائعة', 'concept', 45, 'يتجنب الأخطاء الشائعة', ['حالات خاصة', 'تشخيص المشاكل', 'أفضل الممارسات'], 'حلّل حالة فيها خطأ واقترح الحل'),
        L('مراجعة شاملة', 'review', 30, 'يربط كل ما تعلّمه', ['خريطة المسار', 'نقاط القوة', 'ما يحتاج تعزيز'], 'اكتب ما تعلّمته في صفحة واحدة'),
        L('المشروع النهائي', 'project', 120, 'يطبّق كل المهارات في مشروع حقيقي', ['الفكرة', 'التنفيذ', 'التقييم الذاتي'], 'أنجز المشروع النهائي واعرضه'),
      ] },
    ],
  };
}

export function goalPlan(goal) {
  const d = Math.max(7, daysLeft(goal.deadline) ?? 30);
  const steps = [0.2, 0.45, 0.7, 1];
  return {
    title: goal.title,
    milestones: [
      { text: 'تحديد نقطة البداية وقياس المستوى الحالي', due_in_days: Math.round(d * steps[0]) },
      { text: 'إنجاز الأساسيات بخطة يومية قصيرة', due_in_days: Math.round(d * steps[1]) },
      { text: 'تطبيق عملي أول ومراجعة مع المدرّب', due_in_days: Math.round(d * steps[2]) },
      { text: 'الوصول للنتيجة النهائية وتوثيقها', due_in_days: Math.round(d * steps[3]) },
    ],
    first_step: 'خصّص 15 دقيقة اليوم لكتابة أين أنت الآن وما الذي يمنعك.',
    motivation: 'البداية الصغيرة اليوم أهم من الخطة المثالية بكرة.',
  };
}

export function brief({ profile, director, goals, paths, mentors }) {
  const focus = [];
  const urgent = goals.filter(g => g.status !== 'done' && g.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
  if (urgent) focus.push({ text: `ركّز على «${short(urgent.title, 40)}» — ${dueLine(urgent)}`, mentor_id: urgent.mentorId, action: 'goal' });
  for (const p of paths) {
    const next = p.modules.flatMap(x => x.lessons).find(l => !l.done);
    if (next) { focus.push({ text: `كمّل درس «${short(next.title, 40)}»`, mentor_id: p.mentorId, action: 'lesson' }); break; }
  }
  const team = mentors.filter(m => m.role !== 'director').sort((a, b) => String(a.lastInteraction || '').localeCompare(String(b.lastInteraction || '')));
  if (team[0] && focus.length < 3) focus.push({ text: `${team[0].name} بانتظارك لجلسة متابعة`, mentor_id: team[0].id, action: 'chat' });
  if (!focus.length) focus.push({ text: 'صمّم أول مدرّب بفريقك', mentor_id: null, action: 'chat' });
  return {
    greeting: goals.length || paths.length ? 'رتّبتلك أولويات اليوم حسب الأهمية:' : 'خلّينا نبني أول خطوة بخطتك اليوم:',
    focus,
    nudge: profile.streak > 1 ? `🔥 سلسلتك ${profile.streak} أيام — لا تكسرها اليوم!` : (director.catchphrase || 'ابدأ بخطوة صغيرة.'),
  };
}

const TEAM_MAP = [
  ['coding', /برمج|كود|ويب|web|code|program|javascript|react|تطبيق|موقع|مطور|developer/i],
  ['english', /انجليز|إنجليز|english|ielts|toefl|لغة/i],
  ['fitness', /وزن|لياقة|رياض|جيم|gym|عضل|تمارين|رشاقة|كيلو|صحة/i],
  ['energy', /طاقة|شمس|solar|pv|كهرب|انفرتر|ألواح|الواح/i],
  ['career', /مشروع|بزنس|business|مال|وظيف|career|ريادة|تسويق|راتب|شركة/i],
  ['data', /بيانات|data|ذكاء|\bai\b|machine|python|بايثون|تعلم آلي/i],
  ['math', /رياضيات|math|فيزياء|تفاضل|جبر|توجيهي|امتحان/i],
  ['habits', /عادات|وقت|تركيز|انتاجي|إنتاجي|تسويف|روتين|productiv/i],
];

export function team(spec) {
  const keys = TEAM_MAP.filter(([, re]) => re.test(spec.goal)).map(([k]) => k).slice(0, 3);
  for (const fill of ['habits', 'career']) if (keys.length < 2 && !keys.includes(fill)) keys.push(fill);
  const mentors = keys.map(k => {
    const { key, emoji, ...t } = TEMPLATES.find(x => x.key === k);
    return { ...t, template: key };
  });
  return {
    message: `أهلاً ${spec.name}! بناءً على هدفك «${short(spec.goal, 60)}» جمعتلك فريق متكامل: ${mentors.map(m => m.name).join('، ')}. كل واحد بتخصصه، وأنا بنسّق بينهم.`,
    goal_title: short(spec.goal, 90),
    mentors,
  };
}
