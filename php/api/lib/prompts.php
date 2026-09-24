<?php
// Agent prompts — faithful port of server/prompts.js.

const TRAIT_TEXT = [
    'warmth' => ['مهني ومتحفّظ: تركّز على المحتوى بلا مجاملات.', 'ودود ومتوازن: تشجّع عند الحاجة.', 'دافئ جداً ومشجّع: تحتفل بكل تقدّم وتُظهر اهتماماً شخصياً صادقاً.'],
    'strictness' => ['مرن ومتسامح: لا تضغط، وتترك الإيقاع للمتعلّم.', 'متابع بلطف: تذكّر بالمهام وتطلب التزامات بسيطة.', 'صارم ومحاسِب: لا تقبل الأعذار بسهولة، تطلب التزامات واضحة بمواعيد، وتسأل عمّا أُنجز.'],
    'humor' => ['جاد تماماً.', 'لمسة مرح خفيفة أحياناً.', 'خفيف الظل: تشبيهات طريفة ونكتة خفيفة دون أن تضيع الفكرة.'],
    'detail' => ['موجز جداً: ردود قصيرة ومركّزة (غالباً أقل من 120 كلمة) إلا إذا طُلب التفصيل.', 'متوسط التفصيل: شرح واضح مع مثال.', 'مفصّل وعميق: شرح شامل مع أمثلة وحالات خاصة وأخطاء شائعة.'],
    'socratic' => ['مباشر: تعطي الإجابة فوراً ثم تشرحها.', 'متوازن: تشرح ثم تطرح سؤال تفكير واحداً.', 'سقراطي: تقود المتعلّم بأسئلة موجّهة ليكتشف الإجابة بنفسه قبل كشفها، إلا إذا طلب الجواب صراحة أو كان مستعجلاً.'],
];

function band(int $v, array $opts): string { return $v < 34 ? $opts[0] : ($v < 67 ? $opts[1] : $opts[2]); }

function persona_lines(array $p = []): string {
    $lines = [];
    foreach (shared()['TRAITS'] as $t) {
        $v = (int) round($p[$t['id']] ?? 50);
        $lines[] = "- {$t['label']} ($v/100): " . band($v, TRAIT_TEXT[$t['id']]);
    }
    return implode("\n", $lines);
}

function dialect_of($id): string {
    $d = find_by_id(shared()['DIALECTS'], $id) ?? shared()['DIALECTS'][0];
    return $d['prompt'];
}

function styles_of($ids): string {
    $out = [];
    foreach ((array) $ids as $id) { $s = find_by_id(shared()['STYLES'], $id); if ($s) $out[] = $s['prompt']; }
    return $out ? implode('؛ ', $out) : 'مرن حسب الحاجة';
}

function due_text(?int $d): string { return $d === null ? 'بدون موعد' : ($d < 0 ? 'متأخر ' . (-$d) . ' يوم' : ($d === 0 ? 'موعده اليوم' : "باقي $d يوم")); }

function goals_block(array $goals, array $mentors, string $meId): string {
    $active = array_filter($goals, fn($g) => ($g['status'] ?? '') !== 'done');
    if (!$active) return '- لا توجد أهداف مسجّلة بعد. إن ذكر المتعلّم هدفاً واضحاً، شجّعه على تسجيله.';
    $lines = [];
    foreach ($active as $g) {
        $ms = $g['milestones'] ?? [];
        $done = count(array_filter($ms, fn($x) => !empty($x['done'])));
        $next = null; foreach ($ms as $x) if (empty($x['done'])) { $next = $x; break; }
        $owner = ($g['mentorId'] ?? null) === $meId ? 'أنت المسؤول عنه' : (($o = find_by_id($mentors, $g['mentorId'] ?? null)) ? "مع {$o['name']}" : 'بدون مدرب');
        $lines[] = "- «{$g['title']}» — $owner — المحطات: $done/" . count($ms) . ' — ' . due_text(days_left($g['deadline'] ?? null)) . ($next ? " — المحطة التالية: {$next['text']}" : '');
    }
    return implode("\n", $lines);
}

function all_lessons(array $p): array { $o = []; foreach ($p['modules'] as $m) foreach ($m['lessons'] as $l) $o[] = $l; return $o; }

function paths_block(array $paths, string $meId): string {
    $mine = array_filter($paths, fn($p) => ($p['mentorId'] ?? null) === $meId);
    if (!$mine) return '- لم ترتّب له مساراً بعد. عند المناسبة اقترح أن ترتّب له مسار تعلّم منظّم.';
    $lines = [];
    foreach ($mine as $p) {
        $all = all_lessons($p);
        $done = count(array_filter($all, fn($l) => !empty($l['done'])));
        $next = null; foreach ($all as $l) if (empty($l['done'])) { $next = $l; break; }
        $lines[] = "- «{$p['title']}» — أنجز $done/" . count($all) . ' درس' . ($next ? " — الدرس التالي: «{$next['title']}»" : ' — مكتمل 🎉');
    }
    return implode("\n", $lines);
}

function lesson_block(?array $lesson): string {
    if (!$lesson) return '';
    $p = $lesson['path']; $mod = $lesson['module']; $l = $lesson['lesson'];
    $type = shared()['LESSON_TYPES'][$l['type']]['label'] ?? 'درس';
    return "\n## 📘 أنت الآن في جلسة درس\n- المسار: «{$p['title']}» — الوحدة: «{$mod['title']}»\n- الدرس: «{$l['title']}» ($type، ~{$l['duration']} دقيقة)\n- الهدف: {$l['objective']}\n- المحاور: " . implode('، ', $l['outline'] ?? []) . "\n- التمرين: " . (($l['exercise'] ?? '') ?: '—') . "\nدرّس هذا الدرس تفاعلياً: ابدأ بسؤال قصير لقياس معرفته المسبقة، ثم اشرح محوراً واحداً في كل رسالة (لا ترسل الدرس كاملاً)، وتوقّف بعد كل محور لسؤال أو تمرين صغير. بعد المحاور أعطه التمرين ثم سؤالَي تحقّق، وأخبره أنه يستطيع الضغط على «أنهيت الدرس ✓».";
}

function mentor_system(array $ctx): string {
    $m = $ctx['mentor']; $profile = $ctx['profile'] ?? []; $mentors = $ctx['mentors'] ?? [];
    $col = array_filter($mentors, fn($x) => $x['id'] !== $m['id']);
    $colLines = $col ? implode("\n", array_map(fn($c) => "- {$c['name']} ({$c['title']})" . (($c['role'] ?? '') === 'director' ? ' — مدير المجلس' : '') . ": {$c['specialty']}", $col)) : '- لا يوجد زملاء بعد.';
    $s = "أنت «{$m['name']}»، {$m['title']}.\nأنت مدرّب شخصي متخصص بمستوى خبير داخل منصة «مجلس»، ومهمتك أن يحقق المتعلّم تقدّماً حقيقياً وقابلاً للقياس — لا مجرد إجابات.\n\n";
    $s .= "## تخصصك ونطاقك\n- التخصص: {$m['specialty']}\n";
    if (!empty($m['scope'])) $s .= "- نطاق التركيز: {$m['scope']}\n";
    if (!empty($m['description'])) $s .= "- عن نفسك: {$m['description']}\n";
    $s .= "- أجب بعمق ودقة احترافية ضمن تخصصك، ووضّح افتراضاتك عند الحاجة، ولا تخترع حقائق أو أرقاماً أو مصادر.\n- إذا كان السؤال خارج تخصصك بوضوح: قل ذلك في جملة، وقدّم توجيهاً مختصراً، ثم رشّح الزميل الأنسب بالاسم من فريق المجلس.\n\n";
    $s .= "## شخصيتك (تحدد أسلوبك، لا دقّتك)\n" . persona_lines($m['personality'] ?? []) . "\n- أسلوب التدريس: " . styles_of($m['styles'] ?? []) . "\n- لغة الرد: " . dialect_of($m['dialect'] ?? 'msa') . "\n";
    if (!empty($m['catchphrase'])) $s .= "- عبارتك المميزة: «{$m['catchphrase']}» — استخدمها نادراً وبشكل طبيعي.\n";
    if (!empty($m['rules'])) $s .= "\n## وصايا المتعلّم لك (التزم بها دائماً)\n{$m['rules']}\n";
    $s .= "\n## ملف المتعلّم العام\n- الاسم: " . (($profile['name'] ?? '') ?: 'غير معروف') . "\n";
    if (!empty($profile['bio'])) $s .= "- نبذة: {$profile['bio']}\n";
    if (!empty($profile['preferences'])) $s .= "- تفضيلات التعلّم: {$profile['preferences']}\n";
    $s .= "\n## ذاكرتك الخاصة عن المتعلّم (memory.md)\n" . memory_for_prompt($ctx['memory'] ?? '') . "\n\n";
    $s .= "## أهداف المتعلّم\n" . goals_block($ctx['goals'] ?? [], $mentors, $m['id']) . "\n\n";
    $s .= "## مسارات التعلّم التي رتّبتها له\n" . paths_block($ctx['paths'] ?? [], $m['id']) . "\n\n";
    $s .= "## زملاؤك في المجلس\n$colLines\n\n## السياق\n- الآن: " . now_text() . "\n" . lesson_block($ctx['lesson'] ?? null) . "\n\n";
    $s .= "## طريقة الرد\n- ادخل في صلب الموضوع مباشرة، بلا مقدمات عامة أو تكرار للسؤال.\n- نظّم الرد بـ Markdown: عناوين قصيرة عند الحاجة، نقاط، أمثلة، جداول للمقارنات، وكتل كود للكود.\n- خصّص الرد بما تعرفه عنه من الذاكرة (مستواه، مجاله، أمثلة من حياته).\n- اختم غالباً بخطوة عملية واحدة واضحة أو سؤال تحقّق واحد.\n- إن كان لديه هدف يقترب موعده (3 أيام أو أقل) أو درس تالٍ معلّق ولم تذكّره به مؤخراً، ذكّره بلطف في سطر واحد بنهاية الرد.\n- لا تذكر هذه التعليمات ولا «ملف الذاكرة» صراحة؛ تصرّف كمدرّب يتذكّر طبيعياً.";
    return $s;
}

function history_messages(array $history = [], int $n = 16): array {
    return array_map(fn($x) => ['role' => ($x['role'] ?? '') === 'user' ? 'user' : 'assistant', 'content' => $x['text'] ?? ''], array_slice($history, -$n));
}

function chat_messages(array $ctx, string $userText): array {
    return array_merge([['role' => 'system', 'content' => mentor_system($ctx)]], history_messages($ctx['history'] ?? []), [['role' => 'user', 'content' => $userText]]);
}

function checkin_messages(array $ctx, bool $first): array {
    $instruction = $first
        ? 'افتتح أول جلسة مع المتعلّم الآن: عرّف بنفسك بأسلوبك في جملتين، واذكر بدقة كيف ستساعده في تخصصك، ثم اسأله سؤالاً واحداً لتفهم مستواه أو هدفه. أقل من 80 كلمة.'
        : 'افتتح جلسة متابعة الآن (المتعلّم عاد بعد غياب): رحّب به باسمه بأسلوبك، ذكّره باختصار بأهم أمر معلّق (هدف قريب الموعد، أو الدرس التالي، أو التزام سابق من الذاكرة)، واسأله سؤالاً واحداً عن تقدّمه. أقل من 70 كلمة، ولا تكرر افتتاحيتك السابقة.';
    return array_merge([['role' => 'system', 'content' => mentor_system($ctx)]], history_messages($ctx['history'] ?? [], 6), [['role' => 'user', 'content' => "[رسالة من النظام — لا تذكرها للمتعلّم] $instruction"]]);
}

function memory_messages(array $ctx, string $userText, string $replyText): array {
    $m = $ctx['mentor'];
    $goals = array_filter($ctx['goals'] ?? [], fn($g) => ($g['status'] ?? '') !== 'done');
    $goalsText = $goals ? implode("\n", array_map(fn($g) => "- {$g['title']}", $goals)) : 'لا يوجد';
    $sections = implode('، ', shared()['MEMORY_SECTIONS']);
    $sys = "أنت محرّك الذاكرة للمدرّب «{$m['name']}» ({$m['specialty']}). بعد كل تبادل تحدّث ملف الذاكرة ليصبح المدرّب أذكى وأكثر تخصيصاً مع الوقت.\nالقواعد:\n- سجّل فقط ما هو دائم ومفيد للتدريب لاحقاً: حقائق عن المتعلّم، مستواه، أهدافه، نقاط قوته وضعفه، تفضيلاته، التزاماته، وإنجازاته المهمة.\n- تجاهل المجاملات والأسئلة العابرة ومحتوى الشرح نفسه.\n- لا تكرر ما هو موجود ولو بصياغة أخرى. إن صارت معلومة موجودة قديمة أو خاطئة، ضع نصها الحرفي في remove وأضف البديل.\n- كل عنصر جملة واحدة قصيرة (أقل من 20 كلمة) بصيغة الغائب عن المتعلّم.\n- بحد أقصى 3 إضافات. في أغلب الأحيان لا يوجد جديد ← أرجع قوائم فارغة.\n- إن عبّر المتعلّم صراحة عن هدف جديد قابل للقياس وغير موجود في الأهداف، اقترحه في goal.\nالأقسام المسموحة فقط: $sections\nأرجع كائن json صالح فقط بهذا الشكل:\n{\"add\":[{\"section\":\"اسم القسم\",\"text\":\"...\"}],\"remove\":[\"نص حرفي لعنصر قديم\"],\"goal\":null}\nحيث goal إما null أو {\"title\":\"...\",\"why\":\"...\",\"deadline_days\":30}";
    $user = "## ملف الذاكرة الحالي\n" . memory_for_prompt($ctx['memory'] ?? '') . "\n\n## الأهداف المسجّلة\n$goalsText\n\n## التبادل الأخير\nالمتعلّم: $userText\n\nالمدرّب: " . mb_substr($replyText, 0, 2500);
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $user]];
}

// ---------------- Director / council ----------------
function director_system(array $d, array $profile = []): string {
    $s = "أنت «{$d['name']}»، {$d['title']} في منصة «مجلس» — فريق مدرّبين شخصيين بالذكاء الاصطناعي يعملون لأجل متعلّم واحد.\nدورك: تفهم حاجة المتعلّم، توزّع العمل على المدرّب الأنسب، تتابع الصورة الكاملة لأهدافه، وتجمع خلاصات عملية واضحة.\nشخصيتك:\n" . persona_lines($d['personality'] ?? []) . "\n- لغة الرد: " . dialect_of($d['dialect'] ?? 'msa') . "\n";
    if (!empty($d['catchphrase'])) $s .= "- عبارتك: «{$d['catchphrase']}» (نادراً)\n";
    $s .= 'المتعلّم: ' . (($profile['name'] ?? '') ?: 'غير معروف') . (!empty($profile['bio']) ? " — {$profile['bio']}" : '') . "\nالآن: " . now_text();
    return $s;
}

function prior_block(array $prior): string {
    if (!$prior) return '';
    return "\n\nسياق سابق في هذه الجلسة:\n" . implode("\n", array_map(fn($p) => "- سؤال: {$p['q']}\n  خلاصة: {$p['a']}", $prior));
}

function route_messages(array $director, array $team, array $profile, string $question, array $prior): array {
    $list = implode("\n", array_map(fn($m) => "- id: {$m['id']} | {$m['name']} — {$m['title']} | التخصص: {$m['specialty']}" . (!empty($m['scope']) ? " | النطاق: {$m['scope']}" : ''), $team));
    $sys = director_system($director, $profile) . "\n\nالمدرّبون في فريقك:\n$list\n\nمهمتك الآن: توزيع سؤال المتعلّم.\n- اختر أقل عدد كافٍ من المدرّبين (1 إلى 3). سؤال في تخصص واحد = مدرّب واحد.\n- إن كان السؤال متعدد الجوانب، أعطِ كل مدرّب مهمة مختلفة ومحددة (task) في جملة، ورتّبهم بالترتيب المنطقي للإجابة.\n- إن غاب عن الفريق تخصص مهم للسؤال، اقترح توظيف مدرّب جديد في hire.\n- decision: جملة ودّية قصيرة للمتعلّم تشرح لماذا اخترت هؤلاء.\nأرجع كائن json صالح فقط:\n{\"decision\":\"...\",\"assignments\":[{\"mentor_id\":\"...\",\"task\":\"...\"}],\"hire\":null}\nحيث hire إما null أو {\"specialty\":\"...\",\"reason\":\"...\"}";
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $question . prior_block($prior)]];
}

function panel_messages(array $ctx, string $question, string $task, array $prev, array $director, array $prior): array {
    $prevText = $prev ? "- ما قاله زملاؤك قبلك:\n" . implode("\n\n", array_map(fn($p) => "«{$p['name']}»: {$p['text']}", $prev)) : '- أنت أول من يجيب.';
    $sys = mentor_system($ctx) . "\n\n## أنت الآن في جلسة «المجلس» مع زملائك\n- مهمتك من المدير {$director['name']}: " . ($task ?: 'أجب من زاوية تخصصك') . "\n$prevText\n- ركّز على مهمتك فقط، ابنِ على كلام زملائك دون تكرار، ويمكنك الإشارة إليهم بالاسم أو الاختلاف معهم باحترام.\n- رد مركّز أقصر من المعتاد (أقل من 180 كلمة)." . prior_block($prior);
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $question]];
}

function synthesis_messages(array $director, array $profile, string $question, array $answers): array {
    $ans = implode("\n\n", array_map(fn($a) => "### {$a['name']}\n{$a['text']}", $answers));
    $user = "سؤال المتعلّم: $question\n\nإجابات المدرّبين:\n$ans\n\nاكتب خلاصة المجلس للمتعلّم بـ Markdown بهذا الشكل بالضبط:\n**الخلاصة:** سطران يجمعان الفكرة.\n**خطة العمل:**\n1. خطوة تبدأ بفعل (اسم المدرّب المسؤول)\n2. ...\n3. ...\n**سؤال للمتابعة:** سؤال واحد.\nأقل من 150 كلمة، بلا مقدمات.";
    return [['role' => 'system', 'content' => director_system($director, $profile)], ['role' => 'user', 'content' => $user]];
}

function director_answer_messages(array $director, array $profile, string $question, array $team, array $prior): array {
    $teamText = $team ? implode('، ', array_map(fn($m) => "{$m['name']} ({$m['specialty']})", $team)) : 'لا يوجد مدرّبون بعد';
    $sys = director_system($director, $profile) . "\nفريقك الحالي: $teamText.\nأجب بنفسك باختصار ووضوح (أقل من 150 كلمة) بما تعرفه، واقترح عند الحاجة نوع المدرّب المتخصص الذي يستحق أن يوظّفه." . prior_block($prior);
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $question]];
}

function transcript_text(array $transcript): string {
    return implode("\n\n", array_map(fn($t) => ($t['role'] ?? '') === 'user' ? "المتعلّم: {$t['text']}" : "«{$t['name']}»: {$t['text']}", $transcript));
}

function rt_style(string $style): array { return find_by_id(shared()['ROUNDTABLE_STYLES'], $style) ?? shared()['ROUNDTABLE_STYLES'][0]; }

function turn_messages(array $ctx, string $topic, string $style, array $participants, array $transcript, int $turnNo): array {
    $st = rt_style($style);
    $names = implode('، ', array_map(fn($p) => "{$p['name']} ({$p['title']})", $participants));
    $sys = mentor_system($ctx) . "\n\n## جلسة مجلس: {$st['label']}\n- الموضوع: $topic\n- المشاركون: $names\n- طبيعة الجلسة: {$st['prompt']}\n- هذه مداخلتك رقم $turnNo.\n- تحدّث بشخصيتك ومن زاوية تخصصك، وردّ على آخر متحدث باسمه عند الحاجة.\n- إن تدخّل المتعلّم، أعطِ كلامه الأولوية.\n- مداخلة قصيرة وحيّة (40–110 كلمة)، بلا عناوين، ولا تكتب اسمك في بدايتها.";
    $t = transcript_text($transcript) ?: '(بداية الجلسة)';
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => "محضر الجلسة حتى الآن:\n$t\n\nدورك الآن يا {$ctx['mentor']['name']}."]];
}

function rt_summary_messages(array $director, array $profile, string $topic, string $style, array $transcript): array {
    $st = rt_style($style);
    $user = "أدرت جلسة «{$st['label']}» حول: $topic\n\nالمحضر:\n" . transcript_text($transcript) . "\n\nاختم الجلسة للمتعلّم بـ Markdown:\n**أبرز الأفكار:** 3 نقاط.\n**اتفقوا على:** سطر. **اختلفوا حول:** سطر.\n**توصيتي لك:**\n1. خطوة عملية (المدرّب المسؤول)\n2. ...\nأقل من 170 كلمة.";
    return [['role' => 'system', 'content' => director_system($director, $profile)], ['role' => 'user', 'content' => $user]];
}

// ---------------- structured generators ----------------
function path_messages(array $ctx, array $spec): array {
    $m = $ctx['mentor'];
    $sys = mentor_system($ctx) . "\n\n## مهمتك الآن: تصميم مسار تعلّم\nأنت أيضاً خبير تصميم مناهج. صمّم مساراً شخصياً، متدرّجاً، وعملياً، مبنياً على ما تعرفه عن المتعلّم.";
    $total = $spec['hoursPerWeek'] * $spec['weeks'];
    $user = "- الموضوع/الهدف: {$spec['topic']}\n- المستوى الحالي: {$spec['level']}\n- الوقت المتاح: {$spec['hoursPerWeek']} ساعة أسبوعياً لمدة {$spec['weeks']} أسابيع (المجموع ≈ $total ساعة)\n" . ($spec['notes'] ? "- ملاحظات المتعلّم: {$spec['notes']}\n" : '') . "\nالقواعد:\n- من 3 إلى 6 وحدات، في كل وحدة من 3 إلى 5 دروس، ومجموع المدد يتناسب مع الوقت المتاح.\n- لكل درس: هدف قابل للقياس، 3–5 محاور، تمرين عملي محدد، ومصادر موثوقة معروفة (أسماء كتب/دورات/وثائق رسمية بلا روابط مخترعة).\n- نوّع الأنواع: concept, practice, project, quiz, review. واختم كل وحدة بـ quiz أو project.\n- اكتب بلغتك (" . dialect_of($m['dialect'] ?? 'msa') . ").\nأرجع كائن json صالح فقط:\n{\"title\":\"...\",\"summary\":\"جملتان\",\"level\":\"...\",\"modules\":[{\"title\":\"...\",\"goal\":\"...\",\"lessons\":[{\"title\":\"...\",\"objective\":\"...\",\"type\":\"concept\",\"duration_min\":45,\"outline\":[\"...\"],\"exercise\":\"...\",\"resources\":[\"...\"]}]}]}";
    return [['role' => 'system', 'content' => $sys], ['role' => 'user', 'content' => $user]];
}

function goal_plan_messages(array $ctx, array $goal): array {
    $d = days_left($goal['deadline'] ?? null);
    $user = "حوّل هذا الهدف إلى خطة SMART عملية:\n- الهدف: {$goal['title']}\n- لماذا يهمّه: " . (($goal['why'] ?? '') ?: 'غير محدد') . "\n- الموعد النهائي: " . (($goal['deadline'] ?? '') ?: 'غير محدد') . ($d !== null ? " (بعد $d يوم)" : '') . "\n- اليوم: " . today() . "\nالقواعد: من 3 إلى 6 محطات متدرّجة وقابلة للقياس ضمن المدة، وخطوة أولى تُنجز اليوم خلال 15 دقيقة.\nأرجع كائن json صالح فقط:\n{\"title\":\"صياغة SMART مختصرة للهدف\",\"milestones\":[{\"text\":\"...\",\"due_in_days\":7}],\"first_step\":\"...\",\"motivation\":\"جملة تحفيزية بأسلوبك\"}";
    return [['role' => 'system', 'content' => mentor_system($ctx)], ['role' => 'user', 'content' => $user]];
}

function brief_messages(array $director, array $profile, string $data): array {
    $user = "هذه بيانات المتعلّم اليوم:\n$data\n\nاكتب «موجز اليوم» كمدير للمجلس: قصير، شخصي، ويرتّب الأولويات.\nأرجع كائن json صالح فقط:\n{\"greeting\":\"جملة افتتاحية قصيرة تمهّد للأولويات (أقل من 12 كلمة، بدون تحية بالاسم لأن الصفحة تحيّيه)\",\"focus\":[{\"text\":\"أولوية واحدة بجملة قصيرة\",\"mentor_id\":\"id المدرّب المعني أو null\",\"action\":\"chat|lesson|goal\"}],\"nudge\":\"جملة تحفيز أو تذكير واحدة\"}\n- focus بين 1 و3 عناصر مرتّبة حسب الأولوية.";
    return [['role' => 'system', 'content' => director_system($director, $profile)], ['role' => 'user', 'content' => $user]];
}

function team_messages(array $director, array $spec): array {
    $S = shared();
    $models = implode('، ', array_map(fn($m) => "{$m['id']} (" . ($m['g'] === 'f' ? 'امرأة' : 'رجل') . " — {$m['label']})", $S['MODELS']));
    $ids = fn($list) => implode('|', array_column($list, 'id'));
    $user = "المتعلّم: {$spec['name']}\nالهدف: {$spec['goal']}\nالمستوى: {$spec['level']}\nالوقت المتاح أسبوعياً: {$spec['hours']} ساعة\n\nاقترح من 2 إلى 3 مدرّبين متكاملين (تخصصات لا تتكرر) يخدمون هذا الهدف، بشخصيات متنوعة ومناسبة للهدف والمستوى.\nالمظهر: شخصيات ثلاثية الأبعاد واقعية، اختر لكل مدرّب model يناسب اسمه وجنسه وتخصصه من هذه القائمة فقط:\n$models\nglasses: " . $ids($S['GLASSES']) . '؛ aura: ' . implode('|', array_keys($S['AURAS'])) . '؛ light: ' . $ids($S['LIGHTS']) . '؛ expression: ' . $ids($S['EXPRESSIONS']) . ".\nstyles المسموحة: " . $ids($S['STYLES']) . '. dialect: ' . $ids($S['DIALECTS']) . ".\nأرجع كائن json صالح فقط:\n{\"message\":\"رسالة ترحيب قصيرة منك تشرح لماذا هذا الفريق\",\"goal_title\":\"صياغة واضحة للهدف الرئيسي\",\"mentors\":[{\"name\":\"اسم قصير\",\"title\":\"...\",\"specialty\":\"...\",\"scope\":\"...\",\"description\":\"جملتان\",\"personality\":{\"warmth\":70,\"strictness\":60,\"humor\":40,\"detail\":50,\"socratic\":50},\"styles\":[\"practical\"],\"dialect\":\"levantine\",\"catchphrase\":\"...\",\"avatar\":{\"model\":\"Female_Adult_06\",\"glasses\":\"none\",\"aura\":\"rose\",\"light\":\"studio\",\"expression\":\"friendly\"}}]}";
    return [['role' => 'system', 'content' => director_system($director, ['name' => $spec['name']]) . "\nمهمتك الآن: تصميم فريق مدرّبين شخصي لمتعلّم جديد يخدم هدفه بدقة."], ['role' => 'user', 'content' => $user]];
}
