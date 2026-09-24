<?php
// مجلس — PHP backend (for shared hosting such as Hostinger). Same API as the Node server.
declare(strict_types=1);

$CFG_FILE = __DIR__ . '/config.php';
define('CFG', is_file($CFG_FILE) ? (require $CFG_FILE) : []);
date_default_timezone_set(CFG['TIMEZONE'] ?? 'Asia/Amman');
define('DATA_DIR', rtrim(CFG['DATA_DIR'] ?? '', '/') ?: dirname(__DIR__) . '/data');
mb_internal_encoding('UTF-8');

require __DIR__ . '/lib/util.php';
require __DIR__ . '/lib/store.php';
require __DIR__ . '/lib/memory.php';
require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/llm.php';
require __DIR__ . '/lib/prompts.php';
require __DIR__ . '/lib/mock.php';
require __DIR__ . '/lib/agents.php';

// ---------------------------------------------------------------- request
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
if ($method === 'POST' && !empty($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'])) $method = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE']);
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$pos = strpos($uri, '/api/');
$path = $pos === false ? '/api/' : substr($uri, $pos);
$raw = $method === 'GET' ? '' : (string) file_get_contents('php://input');
if (strlen($raw) > 2000000) { json_out(413, ['error' => 'الطلب كبير جداً']); exit; }
$body = $raw !== '' ? json_decode($raw, true) : [];
if ($raw !== '' && !is_array($body)) { json_out(400, ['error' => 'JSON غير صالح']); exit; }

// ---------------------------------------------------------------- auth (optional APP_PASSWORD)
function auth_token(): string { return hash_hmac('sha256', 'majlis-session-v1', (string) (CFG['APP_PASSWORD'] ?? '')); }
function is_https(): bool { return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'); }
function authed(): bool {
    if (empty(CFG['APP_PASSWORD'])) return true;
    return hash_equals(auth_token(), (string) ($_COOKIE['majlis_auth'] ?? ''));
}

try {
    if ($path === '/api/login' && $method === 'POST') {
        $given = (string) ($body['password'] ?? '');
        if (empty(CFG['APP_PASSWORD']) || !hash_equals((string) CFG['APP_PASSWORD'], $given)) {
            usleep(800000);
            json_out(401, ['error' => 'كلمة المرور غير صحيحة', 'auth' => true]);
            exit;
        }
        setcookie('majlis_auth', auth_token(), ['expires' => time() + 30 * 86400, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_https()]);
        json_out(200, ['ok' => true]);
        exit;
    }
    if ($path === '/api/logout') {
        setcookie('majlis_auth', '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => is_https()]);
        json_out(200, ['ok' => true]);
        exit;
    }
    if (!authed()) { json_out(401, ['error' => 'تسجيل الدخول مطلوب', 'auth' => true]); exit; }
    protect_data_dir();
    route_request($method, $path, $body);
} catch (HttpError $e) {
    if (!headers_sent()) json_out($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('[majlis] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    if (!headers_sent()) json_out(500, ['error' => 'خطأ غير متوقع في الخادم']);
}

// ---------------------------------------------------------------- SSE
function sse_start(): void {
    @ini_set('zlib.output_compression', '0');
    @ini_set('output_buffering', '0');
    @ini_set('implicit_flush', '1');
    @set_time_limit(600);
    ignore_user_abort(true);
    while (ob_get_level() > 0) @ob_end_flush();
    header('Content-Type: text/event-stream; charset=utf-8');
    header('Cache-Control: no-cache, no-transform');
    header('X-Accel-Buffering: no');
    header('X-LiteSpeed-Cache-Control: no-cache');
    echo ':' . str_repeat(' ', 2048) . "\n\n"; // defeat proxy buffering
    flush();
}
function sse(string $event, $data): void {
    if (connection_aborted()) return;
    echo "event: $event\ndata: " . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
    flush();
}
function sse_delta(): callable { return function (string $t) { sse('delta', ['t' => $t]); }; }

// ---------------------------------------------------------------- routes
function route_request(string $method, string $path, array $body): void {
    $routes = [
        ['GET', '#^/api/state$#', 'h_state'],
        ['POST', '#^/api/config$#', 'h_config'],
        ['POST', '#^/api/config/test$#', fn() => test_connection()],
        ['PUT', '#^/api/profile$#', fn($p, $b) => ['profile' => profile_out(save_profile($b))]],
        ['POST', '#^/api/onboarding/propose$#', 'h_propose'],
        ['POST', '#^/api/onboarding/complete$#', 'h_onboard_complete'],
        ['POST', '#^/api/mentors$#', 'h_mentor_create'],
        ['PUT', '#^/api/mentors/(?<id>[^/]+)$#', fn($p, $b) => ['mentor' => update_mentor($p['id'], $b)]],
        ['DELETE', '#^/api/mentors/(?<id>[^/]+)$#', function ($p) { delete_mentor($p['id']); return ['ok' => true]; }],
        ['GET', '#^/api/mentors/(?<id>[^/]+)/memory$#', 'h_memory_get'],
        ['PUT', '#^/api/mentors/(?<id>[^/]+)/memory$#', function ($p, $b) { get_mentor($p['id']); save_memory($p['id'], (string) ($b['markdown'] ?? '')); return mem_payload($p['id']); }],
        ['POST', '#^/api/mentors/(?<id>[^/]+)/memory/items$#', 'h_memory_add'],
        ['DELETE', '#^/api/mentors/(?<id>[^/]+)/memory/items$#', function ($p, $b) { get_mentor($p['id']); apply_memory($p['id'], [], [clip($b['text'] ?? '', 400)]); return mem_payload($p['id']); }],
        ['POST', '#^/api/mentors/(?<id>[^/]+)/memory/reset$#', function ($p) { reset_memory($p['id']); return mem_payload($p['id']); }],
        ['GET', '#^/api/mentors/(?<id>[^/]+)/chat$#', function ($p) { get_mentor($p['id']); return ['messages' => get_chat($p['id'])]; }],
        ['DELETE', '#^/api/mentors/(?<id>[^/]+)/chat$#', function ($p) { clear_chat($p['id']); return ['ok' => true]; }],
        ['POST', '#^/api/mentors/(?<id>[^/]+)/chat$#', 'h_chat'],
        ['POST', '#^/api/mentors/(?<id>[^/]+)/checkin$#', 'h_checkin'],
        ['POST', '#^/api/council/ask$#', 'h_council_ask'],
        ['POST', '#^/api/council/roundtable$#', 'h_roundtable'],
        ['DELETE', '#^/api/council/(?<id>[^/]+)$#', function ($p) { update_json('council.json', [], function (&$l) use ($p) { $l = array_values(array_filter($l, fn($s) => $s['id'] !== $p['id'])); }); return ['ok' => true]; }],
        ['POST', '#^/api/paths/generate$#', 'h_path_generate'],
        ['PATCH', '#^/api/paths/(?<id>[^/]+)/lessons/(?<lid>[^/]+)$#', 'h_lesson'],
        ['DELETE', '#^/api/paths/(?<id>[^/]+)$#', function ($p) { update_json('paths.json', [], function (&$l) use ($p) { $l = array_values(array_filter($l, fn($x) => $x['id'] !== $p['id'])); }); return ['ok' => true]; }],
        ['POST', '#^/api/goals$#', 'h_goal_create'],
        ['PUT', '#^/api/goals/(?<id>[^/]+)$#', fn($p, $b) => ['goal' => update_goal($p['id'], function (&$g) use ($b) { $g = array_merge($g, goal_fields($b)); })]],
        ['PATCH', '#^/api/goals/(?<id>[^/]+)/milestones/(?<mid>[^/]+)$#', 'h_milestone'],
        ['POST', '#^/api/goals/(?<id>[^/]+)/plan$#', 'h_goal_plan'],
        ['POST', '#^/api/goals/(?<id>[^/]+)/complete$#', 'h_goal_complete'],
        ['POST', '#^/api/goals/(?<id>[^/]+)/reopen$#', fn($p) => ['goal' => update_goal($p['id'], function (&$g) { $g['status'] = 'active'; $g['doneAt'] = null; })]],
        ['DELETE', '#^/api/goals/(?<id>[^/]+)$#', function ($p) { update_json('goals.json', [], function (&$l) use ($p) { $l = array_values(array_filter($l, fn($g) => $g['id'] !== $p['id'])); }); return ['ok' => true]; }],
        ['POST', '#^/api/brief$#', 'h_brief'],
        ['GET', '#^/api/export$#', fn() => export_all()],
        ['POST', '#^/api/reset$#', function ($p, $b) { if (($b['confirm'] ?? '') !== 'RESET') fail('تأكيد غير صحيح'); reset_all(); return ['ok' => true]; }],
    ];
    foreach ($routes as [$m, $re, $h]) {
        if ($m !== $method || !preg_match($re, $path, $mm)) continue;
        $params = array_map('rawurldecode', array_filter($mm, 'is_string', ARRAY_FILTER_USE_KEY));
        $out = $h($params, $body);
        if ($out !== null && !headers_sent()) json_out(200, $out);
        return;
    }
    json_out(404, ['error' => 'غير موجود']);
}

// ---------------------------------------------------------------- handlers
function h_state(): array {
    ensure_director();
    return ['profile' => profile_out(get_profile()), 'mentors' => list_mentors(), 'goals' => list_goals(), 'paths' => list_paths(), 'council' => list_sessions(), 'config' => public_config()];
}

function h_config($p, array $b): array {
    $patch = [];
    if (!empty($b['clearKey'])) $patch['apiKey'] = null;
    elseif (is_string($b['apiKey'] ?? null) && trim($b['apiKey']) !== '') {
        $key = trim($b['apiKey']);
        if (!preg_match('/^[\w.-]{16,200}$/', $key)) fail('صيغة المفتاح غير صحيحة');
        $patch['apiKey'] = $key;
    }
    if (is_string($b['model'] ?? null) && preg_match('/^[\w.-]{3,60}$/', $b['model'])) $patch['model'] = $b['model'];
    patch_config($patch);
    return ['config' => public_config()];
}

function h_propose($p, array $b): array {
    $spec = ['name' => clip($b['name'] ?? '', 40) ?: 'صديقي', 'goal' => clip($b['goal'] ?? '', 500), 'level' => clip($b['level'] ?? '', 40) ?: 'مبتدئ', 'hours' => clamp_int($b['hours'] ?? 5, 1, 40, 5)];
    if ($spec['goal'] === '') fail('اكتب هدفك أولاً');
    return agent_propose_team($spec);
}

function h_onboard_complete($p, array $b): array {
    $profile = save_profile(['name' => $b['name'] ?? '', 'bio' => $b['bio'] ?? '', 'preferences' => $b['preferences'] ?? '', 'onboarded' => true]);
    $created = [];
    foreach (array_slice(is_array($b['mentors'] ?? null) ? $b['mentors'] : [], 0, 4) as $spec) {
        if (!is_array($spec)) continue;
        unset($spec['id'], $spec['role']);
        $created[] = create_mentor($spec, $profile);
    }
    $add = [['section' => 'عن المتعلّم', 'text' => "الاسم: {$profile['name']}"]];
    if (!empty($b['goal']['title'])) $add[] = ['section' => 'الأهداف والطموحات', 'text' => clip($b['goal']['title'], 160)];
    if (!empty($b['level'])) $add[] = ['section' => 'المستوى ونقاط القوة', 'text' => 'المستوى المبدئي: ' . clip($b['level'], 40)];
    apply_memory('director', $add);
    if (!empty($b['goal']['title'])) {
        $goal = ['id' => uid('g'), 'title' => clip($b['goal']['title'], 160), 'why' => clip($b['goal']['why'] ?? '', 400), 'deadline' => add_days(clamp_int($b['goal']['days'] ?? 90, 7, 730, 90)),
            'mentorId' => $created[0]['id'] ?? null, 'reminder' => 'daily', 'milestones' => [], 'status' => 'active', 'createdAt' => now_iso()];
        update_json('goals.json', [], function (&$l) use ($goal) { $l[] = $goal; });
        foreach ($created as $m) apply_memory($m['id'], [['section' => 'الأهداف والطموحات', 'text' => $goal['title']]]);
    }
    return ['ok' => true, 'profile' => profile_out(gain_xp(25))];
}

function h_mentor_create($p, array $b): array {
    unset($b['id'], $b['role']);
    $mentor = create_mentor($b);
    return ['mentor' => $mentor, 'profile' => profile_out(gain_xp(20)), 'gained' => 20];
}

function mem_payload(string $id): array { $md = get_memory($id); return ['markdown' => $md, 'sections' => parse_memory($md)]; }

function h_memory_get(array $p): array {
    get_mentor($p['id']);
    return mem_payload($p['id']) + ['updatedAt' => file_mtime(memory_path($p['id'])), 'file' => 'data/' . memory_path($p['id'])];
}

function h_memory_add(array $p, array $b): array {
    get_mentor($p['id']);
    $text = clip($b['text'] ?? '', 300);
    if ($text === '') fail('النص فارغ');
    $res = apply_memory($p['id'], [['section' => clip($b['section'] ?? '', 60) ?: 'عن المتعلّم', 'text' => $text]]);
    return $res + mem_payload($p['id']);
}

function h_chat(array $p, array $b): void {
    $mentor = get_mentor($p['id']);
    $message = clip($b['message'] ?? '', 8000);
    if ($message === '') fail('الرسالة فارغة');
    $lesson = !empty($b['lesson']) ? find_lesson(clip($b['lesson']['pathId'] ?? '', 60), clip($b['lesson']['lessonId'] ?? '', 60)) : null;
    $history = get_chat($mentor['id']);
    $lessonRef = $lesson ? ['pathId' => $lesson['path']['id'], 'lessonId' => $lesson['lesson']['id'], 'title' => $lesson['lesson']['title']] : null;
    $userMsg = strip_nulls(['id' => uid('u'), 'role' => 'user', 'text' => $message, 'at' => now_iso(), 'lesson' => $lessonRef, 'hidden' => !empty($b['hidden']) ? true : null]);
    append_chat($mentor['id'], $userMsg);
    $ctx = mentor_context($mentor, ['history' => $history, 'lesson' => $lesson]);

    sse_start();
    sse('start', ['userMessage' => $userMsg]);
    $text = '';
    try { $text = agent_reply($ctx, $message, function ($t) use (&$text) { $text .= $t; sse('delta', ['t' => $t]); }); }
    catch (Throwable $e) { sse('error', ['message' => $e->getMessage()]); }
    if (trim($text) === '') return;
    $reply = strip_nulls(['id' => uid('a'), 'role' => 'mentor', 'text' => $text, 'at' => now_iso(), 'lesson' => $lessonRef]);
    append_chat($mentor['id'], $reply);
    $profile = gain_xp(5, 'messages');
    bump_bond($mentor['id'], 2);
    sse('done', ['message' => $reply, 'profile' => profile_out($profile), 'gained' => 5]);
    try {
        $mem = agent_update_memory($ctx, $message, $text);
        if ($mem['added'] || $mem['removed'] || $mem['goal']) {
            patch_chat_message($mentor['id'], $reply['id'], ['memory' => $mem['added'], 'suggestion' => $mem['goal']]);
            sse('memory', ['messageId' => $reply['id']] + $mem);
        }
    } catch (Throwable $e) { error_log('[memory] ' . $e->getMessage()); }
}

function h_checkin(array $p, array $b): void {
    $mentor = get_mentor($p['id']);
    $history = get_chat($mentor['id']);
    $ctx = mentor_context($mentor, ['history' => $history]);
    sse_start();
    sse('start', new stdClass());
    $text = '';
    try { $text = agent_checkin($ctx, !empty($b['first']) || !$history, sse_delta()); }
    catch (Throwable $e) { sse('error', ['message' => $e->getMessage()]); }
    if (trim($text) !== '') {
        $msg = ['id' => uid('a'), 'role' => 'mentor', 'text' => $text, 'at' => now_iso(), 'kind' => 'checkin'];
        append_chat($mentor['id'], $msg);
        bump_bond($mentor['id'], 1);
        sse('done', ['message' => $msg]);
    }
}

function council_cast(): array {
    $mentors = list_mentors();
    return [find_by_id($mentors, 'director'), array_values(array_filter($mentors, fn($m) => ($m['role'] ?? '') !== 'director')), get_profile()];
}

function prior_of(?array $session): array {
    $out = [];
    $msgs = $session['messages'] ?? [];
    foreach ($msgs as $i => $m) {
        if (($m['kind'] ?? '') !== 'question') continue;
        foreach (array_slice($msgs, $i + 1) as $a) {
            if (($a['kind'] ?? '') === 'synthesis' || (($a['kind'] ?? '') === 'answer' && ($a['role'] ?? '') === 'director')) {
                $out[] = ['q' => mb_substr($m['text'], 0, 300), 'a' => mb_substr($a['text'], 0, 500)];
                break;
            }
        }
    }
    return array_slice($out, -2);
}

function h_council_ask(array $p, array $b): void {
    $question = clip($b['question'] ?? '', 4000);
    if ($question === '') fail('اكتب سؤالك');
    [$director, $team, $profile] = council_cast();
    $session = !empty($b['sessionId']) ? get_session(clip($b['sessionId'], 60)) : null;
    if (!$session || ($session['type'] ?? '') !== 'ask') $session = ['id' => uid('c'), 'type' => 'ask', 'title' => mb_substr($question, 0, 90), 'createdAt' => now_iso(), 'messages' => []];
    $prior = prior_of($session);
    $push = function (array $msg) use (&$session) { $session['messages'][] = strip_nulls(array_merge(['id' => uid('x'), 'at' => now_iso()], $msg)); };

    sse_start();
    $push(['role' => 'user', 'kind' => 'question', 'text' => $question]);
    sse('session', ['id' => $session['id'], 'title' => $session['title']]);
    try {
        sse('phase', ['phase' => 'routing']);
        $r = $team ? agent_route($director, $team, $profile, $question, $prior) : ['decision' => '', 'assignments' => [], 'hire' => null];
        if ($team) {
            $push(['role' => 'director', 'mentorId' => $director['id'], 'kind' => 'decision', 'text' => $r['decision'], 'assignments' => $r['assignments'], 'hire' => $r['hire']]);
            sse('route', $r);
        }
        $answers = [];
        foreach ($r['assignments'] as $a) {
            if (connection_aborted()) break;
            $m = find_by_id($team, $a['mentorId']);
            sse('speaker', ['mentorId' => $m['id'], 'kind' => 'answer', 'task' => $a['task']]);
            $text = agent_panel(mentor_context($m), $question, $a['task'], $answers, $director, $prior, sse_delta());
            $answers[] = ['name' => $m['name'], 'mentorId' => $m['id'], 'text' => $text];
            $push(['role' => 'mentor', 'mentorId' => $m['id'], 'kind' => 'answer', 'text' => $text, 'task' => $a['task']]);
            sse('speaker_end', ['mentorId' => $m['id']]);
            bump_bond($m['id'], 2);
        }
        if (!connection_aborted()) {
            $kind = $answers ? 'synthesis' : 'answer';
            sse('speaker', ['mentorId' => $director['id'], 'kind' => $kind]);
            $text = $answers ? agent_synthesis($director, $profile, $question, $answers, sse_delta()) : agent_director_answer($director, $profile, $question, $team, $prior, sse_delta());
            $hire = $answers ? null : ($r['hire'] ?: ($team ? null : ['specialty' => 'مدرّب يخدم هدفك الأساسي', 'reason' => 'فريقك فارغ حالياً']));
            $push(['role' => 'director', 'mentorId' => $director['id'], 'kind' => $kind, 'text' => $text, 'hire' => $hire]);
            sse('speaker_end', ['mentorId' => $director['id']]);
        }
    } catch (Throwable $e) { sse('error', ['message' => $e->getMessage()]); }
    save_session($session);
    sse('done', ['session' => $session, 'profile' => profile_out(gain_xp(15, 'sessions')), 'gained' => 15]);
}

function h_roundtable(array $p, array $b): void {
    [$director, $team, $profile] = council_cast();
    $session = !empty($b['sessionId']) ? get_session(clip($b['sessionId'], 60)) : null;
    if (!$session || ($session['type'] ?? '') !== 'roundtable') {
        $topic = clip($b['topic'] ?? '', 600);
        if ($topic === '') fail('اكتب موضوع الجلسة');
        $teamIds = array_column($team, 'id');
        $ids = array_values(array_slice(array_filter(is_array($b['mentorIds'] ?? null) ? $b['mentorIds'] : [], fn($id) => in_array($id, $teamIds, true)), 0, 4));
        if (count($ids) < 2) fail('اختر مدرّبَين على الأقل');
        $session = ['id' => uid('r'), 'type' => 'roundtable', 'title' => mb_substr($topic, 0, 90), 'topic' => $topic, 'style' => clip($b['style'] ?? '', 20) ?: 'discussion', 'mentorIds' => $ids, 'createdAt' => now_iso(), 'messages' => []];
    }
    $participants = array_values(array_filter(array_map(fn($id) => find_by_id($team, $id), $session['mentorIds'])));
    if (count($participants) < 2) fail('بعض المدرّبين المشاركين لم يعودوا موجودين');
    $rounds = !empty($b['interjection']) ? 1 : clamp_int($b['rounds'] ?? 2, 1, 3, 2);
    $push = function (array $msg) use (&$session) { $session['messages'][] = array_merge(['id' => uid('x'), 'at' => now_iso()], $msg); };
    $transcript = function () use (&$session, $team) {
        $turns = array_values(array_filter($session['messages'], fn($m) => in_array($m['kind'] ?? '', ['turn', 'interjection'], true)));
        return array_map(fn($m) => ($m['role'] ?? '') === 'user' ? ['role' => 'user', 'text' => $m['text']] : ['name' => find_by_id($team, $m['mentorId'] ?? '')['name'] ?? 'مدرّب', 'text' => $m['text']], array_slice($turns, -14));
    };

    sse_start();
    sse('session', ['id' => $session['id'], 'title' => $session['title']]);
    if (!empty($b['interjection'])) $push(['role' => 'user', 'kind' => 'interjection', 'text' => clip($b['interjection'], 2000)]);
    try {
        for ($r = 0; $r < $rounds && !connection_aborted(); $r++) {
            foreach ($participants as $m) {
                if (connection_aborted()) break;
                $turnNo = count(array_filter($session['messages'], fn($x) => ($x['kind'] ?? '') === 'turn' && ($x['mentorId'] ?? '') === $m['id'])) + 1;
                sse('speaker', ['mentorId' => $m['id'], 'kind' => 'turn']);
                $text = agent_turn(mentor_context($m), $session['topic'], $session['style'], $participants, $transcript(), $turnNo, sse_delta());
                $push(['role' => 'mentor', 'mentorId' => $m['id'], 'kind' => 'turn', 'text' => $text]);
                sse('speaker_end', ['mentorId' => $m['id']]);
                bump_bond($m['id'], 1);
            }
        }
        if (!connection_aborted()) {
            sse('speaker', ['mentorId' => $director['id'], 'kind' => 'summary']);
            $text = agent_rt_summary($director, $profile, $session['topic'], $session['style'], $transcript(), $participants, sse_delta());
            $push(['role' => 'director', 'mentorId' => $director['id'], 'kind' => 'summary', 'text' => $text]);
            sse('speaker_end', ['mentorId' => $director['id']]);
        }
    } catch (Throwable $e) { sse('error', ['message' => $e->getMessage()]); }
    save_session($session);
    sse('done', ['session' => $session, 'profile' => profile_out(gain_xp(20, 'sessions')), 'gained' => 20]);
}

function h_path_generate($p, array $b): array {
    @set_time_limit(300);
    $mentor = get_mentor(clip($b['mentorId'] ?? '', 60));
    $spec = ['topic' => clip($b['topic'] ?? '', 300), 'level' => clip($b['level'] ?? '', 40) ?: 'مبتدئ', 'hoursPerWeek' => clamp_int($b['hoursPerWeek'] ?? 5, 1, 40, 5),
        'weeks' => clamp_int($b['weeks'] ?? 6, 1, 52, 6), 'notes' => clip($b['notes'] ?? '', 600), 'goalId' => !empty($b['goalId']) ? clip($b['goalId'], 60) : null];
    if ($spec['topic'] === '') fail('اكتب موضوع المسار');
    $path = agent_generate_path(mentor_context($mentor), $spec);
    update_json('paths.json', [], function (&$l) use ($path) { array_unshift($l, $path); });
    log_memory($mentor['id'], "رتّب له مسار «{$path['title']}» ({$spec['weeks']} أسابيع، {$spec['hoursPerWeek']} س/أسبوع)");
    return ['path' => $path, 'profile' => profile_out(gain_xp(20, 'paths')), 'gained' => 20];
}

function h_lesson(array $p, array $b): array {
    $justDone = false; $found = null;
    $path = update_path($p['id'], function (&$pp) use ($p, $b, &$justDone, &$found) {
        foreach ($pp['modules'] as &$mod) foreach ($mod['lessons'] as &$l) {
            if ($l['id'] !== $p['lid']) continue;
            if (!empty($b['done']) && empty($l['done'])) $justDone = true;
            $l['done'] = !empty($b['done']);
            $l['doneAt'] = $l['done'] ? now_iso() : null;
            $found = $l;
        }
    });
    if (!$found) fail('الدرس غير موجود', 404);
    $out = ['path' => $path, 'gained' => 0, 'pathDone' => false];
    if ($justDone) {
        $all = all_lessons($path);
        $pathDone = count(array_filter($all, fn($l) => empty($l['done']))) === 0;
        $gained = 50 + ($pathDone ? 150 : 0);
        $out['profile'] = profile_out(gain_xp($gained, 'lessons'));
        $out['gained'] = $gained; $out['pathDone'] = $pathDone;
        if (!empty($path['mentorId'])) {
            bump_bond($path['mentorId'], 10);
            log_memory($path['mentorId'], $pathDone ? "أنهى مسار «{$path['title']}» بالكامل 🎓" : "أنهى درس «{$found['title']}» من مسار «{$path['title']}»");
        }
    }
    return $out;
}

function goal_fields(array $b): array {
    $out = [];
    $date = fn($v) => is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null;
    if (array_key_exists('title', $b)) $out['title'] = clip($b['title'], 160);
    if (array_key_exists('why', $b)) $out['why'] = clip($b['why'], 400);
    if (array_key_exists('deadline', $b)) $out['deadline'] = $date($b['deadline']);
    if (array_key_exists('mentorId', $b)) $out['mentorId'] = !empty($b['mentorId']) ? clip($b['mentorId'], 60) : null;
    if (array_key_exists('reminder', $b)) $out['reminder'] = in_array($b['reminder'], ['daily', 'weekly', 'none'], true) ? $b['reminder'] : 'daily';
    if (is_array($b['milestones'] ?? null)) {
        $ms = [];
        foreach (array_slice($b['milestones'], 0, 12) as $m) {
            $t = clip($m['text'] ?? '', 200);
            if ($t !== '') $ms[] = ['id' => ($m['id'] ?? '') ?: uid('ms'), 'text' => $t, 'due' => $date($m['due'] ?? null), 'done' => !empty($m['done'])];
        }
        $out['milestones'] = $ms;
    }
    return $out;
}

function h_goal_create($p, array $b): array {
    $fields = goal_fields($b);
    if (($fields['title'] ?? '') === '') fail('اكتب عنوان الهدف');
    $goal = array_merge(['id' => uid('g'), 'milestones' => [], 'reminder' => 'daily', 'status' => 'active', 'createdAt' => now_iso()], $fields);
    update_json('goals.json', [], function (&$l) use ($goal) { $l[] = $goal; });
    if (!empty($goal['mentorId'])) { try { apply_memory($goal['mentorId'], [['section' => 'الأهداف والطموحات', 'text' => $goal['title']]]); } catch (Throwable $e) {} }
    return ['goal' => $goal, 'profile' => profile_out(gain_xp(10)), 'gained' => 10];
}

function h_milestone(array $p, array $b): array {
    $justDone = false; $ms = null;
    $goal = update_goal($p['id'], function (&$g) use ($p, $b, &$justDone, &$ms) {
        foreach ($g['milestones'] as &$m) {
            if ($m['id'] !== $p['mid']) continue;
            if (!empty($b['done']) && empty($m['done'])) $justDone = true;
            $m['done'] = !empty($b['done']);
            $ms = $m;
        }
    });
    if (!$ms) fail('المحطة غير موجودة', 404);
    $out = ['goal' => $goal, 'gained' => 0];
    if ($justDone) {
        $out['gained'] = 25;
        $out['profile'] = profile_out(gain_xp(25, 'milestones'));
        if (!empty($goal['mentorId'])) log_memory($goal['mentorId'], "أنجز محطة «{$ms['text']}» من هدف «{$goal['title']}»");
    }
    return $out;
}

function h_goal_plan(array $p): array {
    @set_time_limit(180);
    $goal = get_goal($p['id']);
    $mentors = list_mentors();
    $mentor = find_by_id($mentors, $goal['mentorId'] ?? null) ?? find_by_id($mentors, 'director');
    $plan = agent_plan_goal(mentor_context($mentor), $goal);
    $updated = update_goal($goal['id'], function (&$g) use ($plan, $mentor) {
        if ($plan['milestones']) $g['milestones'] = $plan['milestones'];
        if ($plan['title'] !== '') $g['smartTitle'] = $plan['title'];
        $g['firstStep'] = $plan['firstStep'];
        $g['motivation'] = $plan['motivation'];
        $g['plannedBy'] = $mentor['id'];
    });
    return ['goal' => $updated];
}

function h_goal_complete(array $p): array {
    $already = false;
    $goal = update_goal($p['id'], function (&$g) use (&$already) {
        $already = ($g['status'] ?? '') === 'done';
        $g['status'] = 'done';
        $g['doneAt'] = ($g['doneAt'] ?? null) ?: now_iso();
    });
    if ($already) return ['goal' => $goal];
    $profile = gain_xp(150, 'goals');
    if (!empty($goal['mentorId'])) log_memory($goal['mentorId'], "حقّق الهدف «{$goal['title']}» 🏆");
    log_memory('director', "حقّق الهدف «{$goal['title']}» 🏆");
    return ['goal' => $goal, 'profile' => profile_out($profile), 'gained' => 150];
}

function h_brief($p, array $b): array {
    $cached = read_json('brief.json', null);
    if (empty($b['force']) && is_array($cached) && ($cached['date'] ?? '') === today()) return $cached;
    $brief = agent_daily_brief();
    write_json('brief.json', $brief);
    return $brief;
}
