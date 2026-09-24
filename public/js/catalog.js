// Shared catalog: used by the browser UI and imported by the Node server for prompts/validation.

export const TRAITS = [
  { id: 'warmth', label: 'الدفء', low: 'رسمي', high: 'دافئ', icon: '❤️' },
  { id: 'strictness', label: 'الحزم', low: 'مرن', high: 'صارم', icon: '🎯' },
  { id: 'humor', label: 'الدعابة', low: 'جاد', high: 'مرح', icon: '😄' },
  { id: 'detail', label: 'التفصيل', low: 'موجز', high: 'مفصّل', icon: '📚' },
  { id: 'socratic', label: 'السقراطية', low: 'يجاوب مباشرة', high: 'يسألك لتكتشف', icon: '🧭' },
];

export const DIALECTS = [
  { id: 'msa', label: 'فصحى مبسّطة', prompt: 'العربية الفصحى المبسّطة والواضحة' },
  { id: 'levantine', label: 'شامي', prompt: 'اللهجة الشامية بشكل طبيعي وعفوي، مع الفصحى للمصطلحات العلمية' },
  { id: 'gulf', label: 'خليجي', prompt: 'اللهجة الخليجية بشكل طبيعي، مع الفصحى للمصطلحات العلمية' },
  { id: 'egyptian', label: 'مصري', prompt: 'اللهجة المصرية بشكل طبيعي، مع الفصحى للمصطلحات العلمية' },
  { id: 'mixed', label: 'عربي + English', prompt: 'عربية مبسّطة مع كتابة المصطلحات التقنية بالإنجليزية' },
  { id: 'english', label: 'English', prompt: 'English only (unless the learner explicitly asks for another language)' },
];

export const STYLES = [
  { id: 'practical', label: 'تطبيقي', icon: '🛠️', prompt: 'تطبيقي: كل مفهوم يتبعه مثال واقعي أو تمرين قصير' },
  { id: 'project', label: 'بالمشاريع', icon: '🏗️', prompt: 'قائم على المشاريع: تربط كل فكرة بمشروع حقيقي يبنيه المتعلّم' },
  { id: 'visual', label: 'بصري', icon: '🎨', prompt: 'بصري: تشبيهات وصور ذهنية ومخططات نصية وجداول' },
  { id: 'story', label: 'قصصي', icon: '📖', prompt: 'قصصي: تشرح عبر قصص ومواقف من الحياة' },
  { id: 'drill', label: 'تدريب مكثّف', icon: '🔁', prompt: 'تدريب مكثّف: تمارين متدرّجة وتكرار حتى الإتقان' },
  { id: 'challenge', label: 'تحدّيات', icon: '🧩', prompt: 'تحدّيات: أسئلة تحدٍّ وألغاز تحفّز التفكير' },
];

export const MEMORY_SECTIONS = [
  'عن المتعلّم',
  'الأهداف والطموحات',
  'المستوى ونقاط القوة',
  'نقاط تحتاج تحسين',
  'التفضيلات وأسلوب التعلّم',
  'سجل التقدّم',
];
export const MEMORY_ICONS = {
  'عن المتعلّم': '👤',
  'الأهداف والطموحات': '🎯',
  'المستوى ونقاط القوة': '💪',
  'نقاط تحتاج تحسين': '🔧',
  'التفضيلات وأسلوب التعلّم': '🎨',
  'سجل التقدّم': '📈',
};

export const LESSON_TYPES = {
  concept: { label: 'مفهوم', icon: 'book' },
  practice: { label: 'تطبيق', icon: 'bolt' },
  project: { label: 'مشروع', icon: 'wand' },
  quiz: { label: 'اختبار', icon: 'target' },
  review: { label: 'مراجعة', icon: 'refresh' },
};

export const ROUNDTABLE_STYLES = [
  { id: 'discussion', label: 'نقاش مفتوح', icon: '💬', prompt: 'نقاش بنّاء يستكشف الموضوع من زوايا التخصصات المختلفة' },
  { id: 'debate', label: 'مناظرة', icon: '⚔️', prompt: 'مناظرة: تبنَّ موقفاً واضحاً من زاوية تخصصك ودافع عنه بالحجج، وفنّد حجج الآخرين باحترام' },
  { id: 'brainstorm', label: 'عصف ذهني', icon: '💡', prompt: 'عصف ذهني: أضف أفكاراً جديدة وجريئة، وطوّر أفكار زملائك بدل انتقادها' },
  { id: 'plan', label: 'تخطيط مشترك', icon: '🗺️', prompt: 'تخطيط مشترك: اقترح جزءاً عملياً من خطة المتعلّم ضمن تخصصك، ووضّح كيف يتكامل مع خطط زملائك' },
];

export const LEVELS = [
  { xp: 0, title: 'مستكشف' },
  { xp: 100, title: 'متعلّم' },
  { xp: 250, title: 'مثابر' },
  { xp: 500, title: 'مجتهد' },
  { xp: 900, title: 'متمكّن' },
  { xp: 1400, title: 'متقدّم' },
  { xp: 2100, title: 'خبير' },
  { xp: 3000, title: 'حكيم' },
  { xp: 4200, title: 'أستاذ' },
  { xp: 6000, title: 'أسطورة' },
];

export function levelInfo(xp = 0) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { level: i + 1, title: cur.title, xp, floor: cur.xp, next: next?.xp ?? null, pct: next ? (xp - cur.xp) / (next.xp - cur.xp) : 1 };
}

export const BOND = [
  { pts: 0, title: 'تعارف' },
  { pts: 30, title: 'ثقة' },
  { pts: 100, title: 'شراكة' },
  { pts: 250, title: 'رفقة' },
  { pts: 500, title: 'توأم فكري' },
];

export function bondInfo(pts = 0) {
  let i = 0;
  while (i + 1 < BOND.length && pts >= BOND[i + 1].pts) i++;
  const next = BOND[i + 1];
  return { level: i + 1, title: BOND[i].title, pct: next ? (pts - BOND[i].pts) / (next.pts - BOND[i].pts) : 1 };
}

// ---------- Avatar options ----------
export const AURAS = {
  aurora: ['#7C5CFF', '#22D3EE'],
  sunset: ['#FF7A59', '#FF3D77'],
  ocean: ['#2563EB', '#06B6D4'],
  forest: ['#047857', '#84CC16'],
  gold: ['#D97706', '#FDE68A'],
  night: ['#1E1B4B', '#7C3AED'],
  rose: ['#DB2777', '#FDA4AF'],
  mint: ['#0D9488', '#6EE7B7'],
};

export const AVATAR = {
  kinds: ['human', 'robot'],
  skins: ['#FDE3CF', '#F5CBA7', '#E8B48A', '#D19A6A', '#B07A4F', '#8A5A3B', '#5E3B26'],
  robotSkins: ['#E2E8F0', '#CBD5E1', '#94A3B8', '#FDE68A', '#C4B5FD', '#A7F3D0', '#FBCFE8'],
  hairs: ['short', 'side', 'curly', 'wavy', 'long', 'bun', 'ponytail', 'afro', 'buzz', 'bald'],
  hairColors: ['#1F1B24', '#3B2A20', '#6B4226', '#A0522D', '#D6A55C', '#E8D3A2', '#9CA3AF', '#C2410C', '#7C3AED', '#0EA5E9'],
  eyes: ['round', 'smile', 'sharp', 'sleepy'],
  brows: ['soft', 'bold', 'arched'],
  mouths: ['smile', 'grin', 'calm', 'smirk'],
  facials: ['none', 'stubble', 'beard', 'mustache', 'goatee'],
  glasses: ['none', 'round', 'square', 'visor'],
  headwears: ['none', 'hijab', 'ghutra', 'shemagh', 'cap', 'beanie', 'gradcap'],
  headwearColors: ['#7C5CFF', '#F472B6', '#0EA5E9', '#10B981', '#F59E0B', '#EF4444', '#1E293B', '#F8FAFC', '#A78BFA', '#FB7185'],
  accessories: ['none', 'headphones', 'headset', 'earring'],
  outfits: ['tee', 'hoodie', 'suit', 'lab', 'sport', 'thobe'],
  outfitColors: ['#6D5DFC', '#22D3EE', '#F472B6', '#10B981', '#F59E0B', '#EF4444', '#1E293B', '#F8FAFC', '#0F766E', '#9333EA'],
};

export const AVATAR_LABELS = {
  kind: { human: 'إنسان', robot: 'روبوت' },
  hair: { short: 'قصير', side: 'جانبي', curly: 'كيرلي', wavy: 'مموّج', long: 'طويل', bun: 'كعكة', ponytail: 'ذيل حصان', afro: 'أفرو', buzz: 'حلاقة قصيرة', bald: 'أصلع' },
  eyes: { round: 'دائرية', smile: 'مبتسمة', sharp: 'حادّة', sleepy: 'ناعسة' },
  brows: { soft: 'ناعمة', bold: 'عريضة', arched: 'مقوّسة' },
  mouth: { smile: 'ابتسامة', grin: 'ضحكة', calm: 'هادئ', smirk: 'واثق' },
  facial: { none: 'بدون', stubble: 'خفيفة', beard: 'لحية', mustache: 'شارب', goatee: 'سكسوكة' },
  glasses: { none: 'بدون', round: 'دائرية', square: 'مربّعة', visor: 'مستقبلية' },
  headwear: { none: 'بدون', hijab: 'حجاب', ghutra: 'غترة', shemagh: 'شماغ', cap: 'كاب', beanie: 'قبعة صوف', gradcap: 'قبعة تخرّج' },
  accessory: { none: 'بدون', headphones: 'سماعات', headset: 'سماعة ومايك', earring: 'أقراط' },
  outfit: { tee: 'تيشيرت', hoodie: 'هودي', suit: 'بدلة', lab: 'روب مختبر', sport: 'رياضي', thobe: 'ثوب' },
  aura: { aurora: 'شفق', sunset: 'غروب', ocean: 'محيط', forest: 'غابة', gold: 'ذهبي', night: 'ليل', rose: 'وردي', mint: 'نعناع' },
};

// ---------- Live personality preview (Forge) ----------
const PHRASES = {
  msa: {
    warm: ['لنبدأ مباشرة.', 'أهلاً بك.', 'أهلاً وسهلاً! سعيد جداً بوجودك 🌟'],
    strict: ['خذ وقتك، لا ضغط.', 'سنتابع تقدّمك خطوة بخطوة.', 'لكن اتفاقنا واضح: مهمة كل يوم، بلا أعذار.'],
    detail: ['', '', 'وبعدها سنغوص في التفاصيل مع أمثلة وحالات خاصة.'],
    humor: '(ولا تقلق، الأخطاء هنا مجانية 😄)',
    socratic: ['إليك الجواب مباشرة.', 'سأشرح لك، ثم أسألك سؤالاً واحداً.', 'قبل أن أشرح: برأيك، ما أول خطوة؟'],
  },
  levantine: {
    warm: ['خلينا نبلّش عطول.', 'أهلين فيك.', 'يا هلا فيك! مبسوط كتير إنك هون 🌟'],
    strict: ['على راحتك، ما في ضغط.', 'رح نتابع تقدّمك خطوة خطوة.', 'بس اتفاقنا واضح: مهمة كل يوم، وما في أعذار.'],
    detail: ['', '', 'وبعدين رح نغوص بالتفاصيل مع أمثلة.'],
    humor: '(وما تخاف، الغلطات هون ببلاش 😄)',
    socratic: ['هاد الجواب عطول.', 'رح اشرحلك وبعدين بسألك سؤال واحد.', 'قبل ما اشرح: شو برأيك أول خطوة؟'],
  },
  gulf: {
    warm: ['خلنا نبدأ على طول.', 'هلا فيك.', 'هلا والله! مستانس إنك معنا 🌟'],
    strict: ['على راحتك، ما في ضغط.', 'بنتابع تقدّمك خطوة بخطوة.', 'بس اتفاقنا واضح: مهمة كل يوم، وبدون أعذار.'],
    detail: ['', '', 'وبعدين بندخل في التفاصيل مع أمثلة.'],
    humor: '(ولا تشيل هم، الأخطاء هني ببلاش 😄)',
    socratic: ['هذا الجواب على طول.', 'بشرح لك وبعدين أسألك سؤال واحد.', 'قبل لا أشرح: شرايك وش أول خطوة؟'],
  },
  egyptian: {
    warm: ['يلا نبدأ على طول.', 'أهلاً بيك.', 'أهلاً أهلاً! مبسوط جداً إنك هنا 🌟'],
    strict: ['براحتك، مفيش ضغط.', 'هنتابع تقدمك خطوة خطوة.', 'بس اتفاقنا واضح: مهمة كل يوم، ومفيش أعذار.'],
    detail: ['', '', 'وبعدين هندخل في التفاصيل بأمثلة.'],
    humor: '(ومتقلقش، الغلطات هنا ببلاش 😄)',
    socratic: ['ده الجواب على طول.', 'هشرحلك وبعدين أسألك سؤال واحد.', 'قبل ما أشرح: تفتكر إيه أول خطوة؟'],
  },
  english: {
    warm: ["Let's get straight to it.", 'Hi, welcome.', "Hey there! So glad you're here 🌟"],
    strict: ['Take your time, no pressure.', "We'll track your progress step by step.", 'But our deal is clear: one task a day, no excuses.'],
    detail: ['', '', "Then we'll dive deep with examples and edge cases."],
    humor: "(Don't worry, mistakes are free here 😄)",
    socratic: ["Here's the answer, straight up.", "I'll explain, then ask you one question.", 'Before I explain: what do you think the first step is?'],
  },
};
PHRASES.mixed = PHRASES.levantine;

export function samplePhrase(m) {
  const P = PHRASES[m.dialect] || PHRASES.msa;
  const p = m.personality || {};
  const b = v => (v < 34 ? 0 : v < 67 ? 1 : 2);
  return [
    P.warm[b(p.warmth ?? 50)],
    P.strict[b(p.strictness ?? 50)],
    P.detail[b(p.detail ?? 50)],
    (p.humor ?? 0) >= 60 ? P.humor : '',
    P.socratic[b(p.socratic ?? 50)],
    m.catchphrase ? `«${m.catchphrase}»` : '',
  ].filter(Boolean).join(' ');
}

export function greetingWord(dialect) {
  return { levantine: 'يا هلا', gulf: 'هلا والله', egyptian: 'أهلاً يا صاحبي', english: 'Hey', mixed: 'أهلين' }[dialect] || 'أهلاً';
}
