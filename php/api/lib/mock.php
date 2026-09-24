<?php
// Demo mode (no API key) — port of server/mock.js.

const MOCK_NOTE = "\n\n> 🧪 *وضع تجريبي: هذا رد توضيحي. أضف مفتاح DeepSeek من الإعدادات لتحصل على إجابات حقيقية ومتخصصة.*";

function mock_stream(string $text, callable $onDelta): string {
    $tokens = preg_split('/(\s+)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE);
    for ($i = 0; $i < count($tokens); $i += 2) {
        if (connection_aborted()) break;
        usleep(random_int(12000, 34000));
        $onDelta($tokens[$i] . ($tokens[$i + 1] ?? ''));
    }
    return $text;
}

function greeting_word(string $dialect): string { return shared()['GREETINGS'][$dialect] ?? 'أهلاً'; }
function first_part(string $s, int $n): string { return short_text(trim(preg_split('/[،,(]/u', $s)[0]), $n); }
function due_line(array $g): string { $d = days_left($g['deadline'] ?? null); return $d === null ? '' : ($d < 0 ? 'متأخر ' . (-$d) . ' يوم' : ($d === 0 ? 'موعده اليوم' : "باقي $d يوم")); }

function mock_chat_reply(array $ctx, string $text): string {
    $m = $ctx['mentor'];
    $hi = trim(greeting_word($m['dialect'] ?? '') . ' ' . ($ctx['profile']['name'] ?? '') . '!');
    if (!empty($ctx['lesson'])) {
        $l = $ctx['lesson']['lesson'];
        $outline = $l['outline'] ?? [];
        $list = implode("\n", array_map(fn($o, $i) => ($i + 1) . ". $o", $outline, array_keys($outline)));
        return "$hi 📘 خلّينا نبدأ درس **«{$l['title']}»**.\n\n**هدف الدرس:** {$l['objective']}\n\nقبل ما أشرح، سؤال سريع لأعرف من وين نبدأ:\n> شو بتعرف حالياً عن «" . ($outline[0] ?? $l['title']) . "»؟\n\nبعدها رح نمشي على المحاور وحدة وحدة:\n$list" . MOCK_NOTE;
    }
    $g = null;
    foreach ($ctx['goals'] ?? [] as $x) if (($x['status'] ?? '') !== 'done' && (($x['mentorId'] ?? null) === $m['id'] || empty($x['mentorId']))) { $g = $x; break; }
    $style = find_by_id(shared()['STYLES'], $m['styles'][0] ?? '')['label'] ?? 'تطبيقي';
    $s = "$hi\n\nسؤالك **«" . short_text($text, 90) . "»** من صلب تخصصي (" . first_part($m['specialty'], 50) . "). هيك رح نشتغل عليه:\n\n### خطة سريعة\n1. **نحدّد مستواك** بسؤالين قصيرين.\n2. **نبني الفكرة خطوة بخطوة** بأسلوب $style.\n3. **نطبّق فوراً** بتمرين صغير مرتبط بهدفك.\n\n| المرحلة | الوقت | الناتج |\n|---|---|---|\n| فهم | 10 د | صورة واضحة للمفهوم |\n| تطبيق | 20 د | تمرين محلول |\n\n**خطوتك التالية:** احكيلي شو جرّبت لحد هلّق؟";
    if ($g) $s .= "\n\n📌 تذكير: هدفك «{$g['title']}» — " . due_line($g) . '.';
    if (!empty($m['catchphrase'])) $s .= "\n\n*{$m['catchphrase']}*";
    return $s . MOCK_NOTE;
}

function mock_checkin(array $ctx, bool $first): string {
    $m = $ctx['mentor'];
    $hi = trim(greeting_word($m['dialect'] ?? '') . ' ' . ($ctx['profile']['name'] ?? '') . '!');
    if ($first) return "$hi أنا **{$m['name']}**، {$m['title']}. " . ($m['description'] ?? '') . "\n\nرح أكون معك خطوة بخطوة، وأتذكّر كل شي بتحكيلي ياه حتى نبني على تقدّمك.\n\n**سؤال أول:** وين مستواك حالياً في " . first_part($m['specialty'], 40) . '؟';
    $g = null;
    foreach ($ctx['goals'] ?? [] as $x) if (($x['status'] ?? '') !== 'done' && ($x['mentorId'] ?? null) === $m['id']) { $g = $x; break; }
    if (!$g) foreach ($ctx['goals'] ?? [] as $x) if (($x['status'] ?? '') !== 'done') { $g = $x; break; }
    $next = null;
    foreach ($ctx['paths'] ?? [] as $p) if (($p['mentorId'] ?? null) === $m['id']) { foreach (all_lessons($p) as $l) if (empty($l['done'])) { $next = $l; break 2; } }
    return "$hi اشتقنالك 👋\n\n" . ($g ? "📌 هدفك **«{$g['title']}»** — " . due_line($g) . '.' : '') . ($next ? "\n📘 الدرس التالي بمسارك: **«{$next['title']}»**." : '') . "\n\n**سؤال:** شو أنجزت من آخر مرة حكينا؟";
}

function mock_memory(array $ctx, string $text): array {
    $add = []; $goal = null;
    if (preg_match('/(?:اسمي|my name is)\s+([^\s،,.]+)/iu', $text, $m)) $add[] = ['section' => 'عن المتعلّم', 'text' => "يحب أن يُنادى باسم {$m[1]}"];
    if (preg_match('/(?:بدي|أريد|اريد|هدفي|حابب|i want to|my goal is)\s+(.{6,80}?)(?:[.،,!؟?]|$)/iu', $text, $w)) {
        $want = trim($w[1]);
        $add[] = ['section' => 'الأهداف والطموحات', 'text' => "يرغب في $want"];
        $exists = false;
        foreach ($ctx['goals'] ?? [] as $g) if (mb_strpos($g['title'], mb_substr($want, 0, 12)) !== false) $exists = true;
        if (!$exists) $goal = ['title' => $want, 'why' => 'ذكرته في المحادثة', 'deadline_days' => 30];
    }
    if (preg_match('/(?:ما بفهم|صعب|مش فاهم|confus|difficult|hard)/iu', $text)) $add[] = ['section' => 'نقاط تحتاج تحسين', 'text' => 'يجد صعوبة في: ' . short_text($text, 60)];
    if (!$add && random_int(1, 100) <= 35) $add[] = ['section' => 'سجل التقدّم', 'text' => '[' . today() . '] ناقش: ' . short_text($text, 60)];
    return ['add' => $add, 'remove' => [], 'goal' => $goal];
}

function mock_route(array $team, string $question): array {
    preg_match_all('/[\p{L}\p{N}]{3,}/u', mb_strtolower($question), $mm);
    $words = $mm[0];
    $scored = array_map(function ($m) use ($words) {
        $hay = mb_strtolower("{$m['title']} {$m['specialty']} " . ($m['scope'] ?? ''));
        $score = count(array_filter($words, fn($w) => mb_strpos($hay, $w) !== false || mb_strpos($hay, mb_substr($w, 0, 4)) !== false));
        return ['m' => $m, 'score' => $score];
    }, $team);
    usort($scored, fn($a, $b) => $b['score'] <=> $a['score']);
    $chosen = array_column(array_slice(array_values(array_filter($scored, fn($s) => $s['score'] > 0)), 0, 2), 'm');
    if (!$chosen) $chosen = array_slice($team, 0, min(2, count($team)));
    $names = array_column($chosen, 'name');
    return [
        'decision' => count($chosen) > 1 ? 'سؤالك إله أكثر من زاوية، فوزّعته على ' . implode(' و', $names) . ' — كل واحد من تخصصه.' : "هاد السؤال من صلب تخصص {$names[0]}، فخلّيته يتولّاه.",
        'assignments' => array_map(fn($m) => ['mentor_id' => $m['id'], 'task' => 'أجب من زاوية ' . first_part($m['specialty'], 40)], $chosen),
        'hire' => null,
    ];
}

function mock_panel(array $ctx, string $question, string $task, array $prev): string {
    $m = $ctx['mentor'];
    $ref = $prev ? 'بكمّل على كلام ' . end($prev)['name'] . ' — ' : '';
    return "{$ref}من زاويتي كـ{$m['title']}: $task.\n\n- **النقطة الأهم:** ابدأ من الأساس المرتبط بسؤالك «" . short_text($question, 50) . "».\n- **تمرين سريع:** خصّص 20 دقيقة اليوم لتطبيق فكرة واحدة.\n- **انتبه:** لا تحاول تتعلّم كل شي مرة وحدة." . (!empty($m['catchphrase']) ? "\n\n*{$m['catchphrase']}*" : '');
}

function mock_synthesis(array $answers): string {
    $steps = implode("\n", array_map(fn($a, $i) => ($i + 1) . ". طبّق توصية اليوم الأولى ({$a['name']})", $answers, array_keys($answers)));
    return "**الخلاصة:** المدرّبون متفقون إن البداية الصحيحة هي أساس قوي مع تطبيق يومي صغير.\n**خطة العمل:**\n$steps\n" . (count($answers) + 1) . ". راجع تقدّمك بعد أسبوع (سَنَد)\n**سؤال للمتابعة:** أي خطوة رح تبدأ فيها اليوم؟" . MOCK_NOTE;
}

function mock_director_answer(string $question, array $team): string {
    return 'سؤال مهم! «' . short_text($question, 60) . '» — ' . ($team ? 'ما لقيت حدا من الفريق متخصص فيه تماماً.' : 'لسا ما عندك مدرّبين بالفريق.') . "\n\nنصيحتي السريعة: قسّم الموضوع لخطوات صغيرة وابدأ بأول خطوة اليوم.\n\n💡 **اقتراح:** صمّم مدرّباً متخصصاً لهذا المجال من «صانع المدربين»." . MOCK_NOTE;
}

function mock_turn(array $ctx, string $style, array $transcript, int $turnNo): string {
    $m = $ctx['mentor'];
    $last = null;
    foreach (array_reverse($transcript) as $t) if (!empty($t['name']) && $t['name'] !== $m['name']) { $last = $t; break; }
    $lead = $last ? "{$last['name']}، " : '';
    $sp = first_part($m['specialty'], 40);
    $bodies = [
        'discussion' => "فكرة حلوة، وبضيف عليها من تخصصي: $sp بيلعب دور أساسي هون، لأنه بيعطي المتعلّم أساس عملي بيقدر يبني عليه.",
        'debate' => $turnNo % 2 ? 'أنا بشوف الموضوع من زاوية مختلفة تماماً: الأولوية لازم تكون للتطبيق قبل النظرية، والدليل إن المتعلّم بيحفظ أكثر لما يجرّب بإيده.' : 'بحترم رأيك، بس ما بتفق كلياً — بدون أساس نظري التطبيق رح يكون عشوائي.',
        'brainstorm' => 'شو رأيكم لو عملنا تحدّي أسبوعي صغير مرتبط بـ' . first_part($m['specialty'], 30) . '؟ بيخلّي التعلّم ممتع وبيعطي نتيجة ملموسة.',
        'plan' => 'من جهتي: أسبوعين أساسيات، وبعدها مشروع صغير. بيتكامل مع خطتكم لأنه بيعطي التطبيق اللي بتحكوا عنه.',
    ];
    return $lead . ($bodies[$style] ?? $bodies['discussion']) . (!empty($m['catchphrase']) && $turnNo === 1 ? " {$m['catchphrase']}" : '');
}

function mock_rt_summary(array $participants): string {
    $steps = implode("\n", array_map(fn($p, $i) => ($i + 1) . ". نفّذ اقتراح {$p['name']} هذا الأسبوع ({$p['name']})", $participants, array_keys($participants)));
    return "**أبرز الأفكار:**\n- البداية بأساس واضح\n- التطبيق اليومي الصغير\n- تحدٍّ أسبوعي يحافظ على الحماس\n**اتفقوا على:** أهمية الاستمرارية. **اختلفوا حول:** النظرية أولاً أم التطبيق.\n**توصيتي لك:**\n$steps" . MOCK_NOTE;
}

function mock_path(array $spec): array {
    $t = $spec['topic'];
    $L = fn($title, $type, $d, $obj, $outline, $ex) => ['title' => $title, 'type' => $type, 'duration_min' => $d, 'objective' => $obj, 'outline' => $outline, 'exercise' => $ex, 'resources' => ['التوثيق الرسمي للموضوع', 'كتاب مرجعي تمهيدي معروف في المجال']];
    return [
        'title' => 'رحلتك في ' . short_text($t, 40),
        'summary' => "مسار عملي متدرّج مصمّم لمستوى «{$spec['level']}» بمعدّل {$spec['hoursPerWeek']} ساعات أسبوعياً. (مسار تجريبي — مع مفتاح DeepSeek رح يكون مخصّص بالكامل.)",
        'level' => $spec['level'],
        'modules' => [
            ['title' => 'الأساسيات والصورة الكبيرة', 'goal' => 'فهم المفاهيم الجوهرية والمصطلحات', 'lessons' => [
                $L('ما هو ' . short_text($t, 30) . '؟ الخريطة الكاملة', 'concept', 30, 'يشرح المتعلّم الفكرة العامة بكلماته', ['التعريف', 'لماذا يهم', 'المكوّنات الرئيسية'], 'اكتب ملخصاً من 5 أسطر بكلماتك'),
                $L('المفاهيم الجوهرية', 'concept', 45, 'يميّز بين المفاهيم الأساسية', ['المفهوم الأول', 'المفهوم الثاني', 'العلاقة بينهما'], 'ارسم خريطة ذهنية للمفاهيم'),
                $L('تطبيق أول بسيط', 'practice', 40, 'ينفّذ أول تطبيق عملي', ['تجهيز الأدوات', 'خطوة بخطوة', 'أخطاء شائعة'], 'نفّذ المثال وعدّل عليه'),
                $L('اختبار الوحدة الأولى', 'quiz', 20, 'يتحقق من فهم الأساسيات', ['أسئلة سريعة', 'مراجعة الأخطاء'], 'أجب عن 5 أسئلة'),
            ]],
            ['title' => 'التطبيق العملي', 'goal' => 'تحويل الفهم إلى مهارة', 'lessons' => [
                $L('أدوات وتقنيات العمل', 'concept', 40, 'يستخدم الأدوات الأساسية بثقة', ['الأدوات', 'متى تستخدم كل أداة', 'مثال'], 'قارن بين أداتين في جدول'),
                $L('تمارين متدرّجة', 'practice', 60, 'يحل تمارين من السهل إلى المتوسط', ['تمرين سهل', 'تمرين متوسط', 'تمرين تحدٍّ'], 'حل 3 تمارين'),
                $L('مشروع مصغّر', 'project', 90, 'يبني مشروعاً صغيراً كاملاً', ['التخطيط', 'التنفيذ', 'العرض'], 'سلّم المشروع للمدرّب للمراجعة'),
            ]],
            ['title' => 'التعمّق والإتقان', 'goal' => 'الوصول لمستوى الاستقلالية', 'lessons' => [
                $L('حالات متقدمة وأخطاء شائعة', 'concept', 45, 'يتجنب الأخطاء الشائعة', ['حالات خاصة', 'تشخيص المشاكل', 'أفضل الممارسات'], 'حلّل حالة فيها خطأ واقترح الحل'),
                $L('مراجعة شاملة', 'review', 30, 'يربط كل ما تعلّمه', ['خريطة المسار', 'نقاط القوة', 'ما يحتاج تعزيز'], 'اكتب ما تعلّمته في صفحة واحدة'),
                $L('المشروع النهائي', 'project', 120, 'يطبّق كل المهارات في مشروع حقيقي', ['الفكرة', 'التنفيذ', 'التقييم الذاتي'], 'أنجز المشروع النهائي واعرضه'),
            ]],
        ],
    ];
}

function mock_goal_plan(array $goal): array {
    $d = max(7, days_left($goal['deadline'] ?? null) ?? 30);
    return [
        'title' => $goal['title'],
        'milestones' => [
            ['text' => 'تحديد نقطة البداية وقياس المستوى الحالي', 'due_in_days' => (int) round($d * 0.2)],
            ['text' => 'إنجاز الأساسيات بخطة يومية قصيرة', 'due_in_days' => (int) round($d * 0.45)],
            ['text' => 'تطبيق عملي أول ومراجعة مع المدرّب', 'due_in_days' => (int) round($d * 0.7)],
            ['text' => 'الوصول للنتيجة النهائية وتوثيقها', 'due_in_days' => $d],
        ],
        'first_step' => 'خصّص 15 دقيقة اليوم لكتابة أين أنت الآن وما الذي يمنعك.',
        'motivation' => 'البداية الصغيرة اليوم أهم من الخطة المثالية بكرة.',
    ];
}

function mock_brief(array $profile, array $director, array $goals, array $paths, array $mentors): array {
    $focus = [];
    $urgent = array_values(array_filter($goals, fn($g) => ($g['status'] ?? '') !== 'done' && !empty($g['deadline'])));
    usort($urgent, fn($a, $b) => strcmp($a['deadline'], $b['deadline']));
    if ($urgent) $focus[] = ['text' => 'ركّز على «' . short_text($urgent[0]['title'], 40) . '» — ' . due_line($urgent[0]), 'mentor_id' => $urgent[0]['mentorId'] ?? null, 'action' => 'goal'];
    foreach ($paths as $p) { foreach (all_lessons($p) as $l) if (empty($l['done'])) { $focus[] = ['text' => 'كمّل درس «' . short_text($l['title'], 40) . '»', 'mentor_id' => $p['mentorId'], 'action' => 'lesson']; break 2; } }
    $team = array_values(array_filter($mentors, fn($m) => ($m['role'] ?? '') !== 'director'));
    usort($team, fn($a, $b) => strcmp((string) ($a['lastInteraction'] ?? ''), (string) ($b['lastInteraction'] ?? '')));
    if ($team && count($focus) < 3) $focus[] = ['text' => "{$team[0]['name']} بانتظارك لجلسة متابعة", 'mentor_id' => $team[0]['id'], 'action' => 'chat'];
    if (!$focus) $focus[] = ['text' => 'صمّم أول مدرّب بفريقك', 'mentor_id' => null, 'action' => 'chat'];
    return [
        'greeting' => ($goals || $paths) ? 'رتّبتلك أولويات اليوم حسب الأهمية:' : 'خلّينا نبني أول خطوة بخطتك اليوم:',
        'focus' => $focus,
        'nudge' => ($profile['streak'] ?? 0) > 1 ? "🔥 سلسلتك {$profile['streak']} أيام — لا تكسرها اليوم!" : (($director['catchphrase'] ?? '') ?: 'ابدأ بخطوة صغيرة.'),
    ];
}

function mock_team(array $spec): array {
    $map = [
        'coding' => '/برمج|كود|ويب|web|code|program|javascript|react|تطبيق|موقع|مطور|developer/iu',
        'english' => '/انجليز|إنجليز|english|ielts|toefl|لغة/iu',
        'fitness' => '/وزن|لياقة|رياض|جيم|gym|عضل|تمارين|رشاقة|كيلو|صحة/iu',
        'energy' => '/طاقة|شمس|solar|pv|كهرب|انفرتر|ألواح|الواح/iu',
        'career' => '/مشروع|بزنس|business|مال|وظيف|career|ريادة|تسويق|راتب|شركة/iu',
        'data' => '/بيانات|data|ذكاء|\bai\b|machine|python|بايثون|تعلم آلي/iu',
        'math' => '/رياضيات|math|فيزياء|تفاضل|جبر|توجيهي|امتحان/iu',
        'habits' => '/عادات|وقت|تركيز|انتاجي|إنتاجي|تسويف|روتين|productiv/iu',
    ];
    $keys = [];
    foreach ($map as $k => $re) if (preg_match($re, $spec['goal'])) $keys[] = $k;
    $keys = array_slice($keys, 0, 3);
    foreach (['habits', 'career'] as $fill) if (count($keys) < 2 && !in_array($fill, $keys, true)) $keys[] = $fill;
    $mentors = [];
    foreach ($keys as $k) {
        $t = find_by_id(shared()['TEMPLATES'], $k, 'key');
        unset($t['key'], $t['emoji']);
        $t['template'] = $k;
        $mentors[] = $t;
    }
    return [
        'message' => "أهلاً {$spec['name']}! بناءً على هدفك «" . short_text($spec['goal'], 60) . '» جمعتلك فريق متكامل: ' . implode('، ', array_column($mentors, 'name')) . '. كل واحد بتخصصه، وأنا بنسّق بينهم.',
        'goal_title' => short_text($spec['goal'], 90),
        'mentors' => $mentors,
    ];
}
