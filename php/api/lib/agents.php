<?php
// Agent orchestration — port of server/agents.js. Streaming functions take an $emit(string) callback.

function mentor_context(array $mentor, array $extra = []): array {
    return array_merge(['mentor' => $mentor, 'profile' => get_profile(), 'memory' => get_memory($mentor['id']), 'goals' => list_goals(),
        'paths' => list_paths(), 'mentors' => list_mentors()], $extra);
}

function agent_reply(array $ctx, string $text, callable $emit): string {
    if (is_mock()) return mock_stream(mock_chat_reply($ctx, $text), $emit);
    return llm_stream(chat_messages($ctx, $text), $emit, 0.7, 1800);
}

function agent_checkin(array $ctx, bool $first, callable $emit): string {
    if (is_mock()) return mock_stream(mock_checkin($ctx, $first), $emit);
    return llm_stream(checkin_messages($ctx, $first), $emit, 0.8, 300);
}

function agent_update_memory(array $ctx, string $userText, string $replyText): array {
    $out = is_mock() ? mock_memory($ctx, $userText) : llm_complete(memory_messages($ctx, $userText, $replyText), true, 0.2, 500);
    $sections = shared()['MEMORY_SECTIONS'];
    $add = [];
    foreach (array_slice(array_values(array_filter(is_array($out['add'] ?? null) ? $out['add'] : [], fn($x) => is_array($x) && is_string($x['text'] ?? null) && trim($x['text']) !== '')), 0, 3) as $x) {
        $add[] = ['section' => in_array($x['section'] ?? '', $sections, true) ? $x['section'] : $sections[0], 'text' => clip($x['text'], 240)];
    }
    $remove = array_slice(array_values(array_filter(is_array($out['remove'] ?? null) ? $out['remove'] : [], 'is_string')), 0, 3);
    $res = ($add || $remove) ? apply_memory($ctx['mentor']['id'], $add, $remove) : ['added' => [], 'removed' => []];
    $goal = null;
    if (!empty($out['goal']['title'])) {
        $title = clip($out['goal']['title'], 120);
        $exists = false;
        foreach ($ctx['goals'] as $g) if (mb_strpos($g['title'], mb_substr($title, 0, 14)) !== false || mb_strpos($title, mb_substr($g['title'], 0, 14)) !== false) $exists = true;
        if (!$exists) $goal = ['title' => $title, 'why' => clip($out['goal']['why'] ?? '', 240), 'deadline_days' => clamp_int($out['goal']['deadline_days'] ?? 30, 3, 365, 30)];
    }
    return $res + ['goal' => $goal];
}

function agent_route(array $director, array $team, array $profile, string $question, array $prior): array {
    $r = is_mock() ? mock_route($team, $question) : llm_complete(route_messages($director, $team, $profile, $question, $prior), true, 0.2, 700);
    $ids = array_column($team, 'id');
    $seen = []; $assign = [];
    foreach (is_array($r['assignments'] ?? null) ? $r['assignments'] : [] as $a) {
        $id = $a['mentor_id'] ?? null;
        if (!in_array($id, $ids, true) || isset($seen[$id])) continue;
        $seen[$id] = true;
        $assign[] = ['mentorId' => $id, 'task' => clip($a['task'] ?? '', 300)];
        if (count($assign) >= 3) break;
    }
    $hire = !empty($r['hire']['specialty']) ? ['specialty' => clip($r['hire']['specialty'], 120), 'reason' => clip($r['hire']['reason'] ?? '', 240)] : null;
    return ['decision' => clip($r['decision'] ?? '', 400) ?: 'وزّعت سؤالك على المدرّب الأنسب.', 'assignments' => $assign, 'hire' => $hire];
}

function agent_panel(array $ctx, string $question, string $task, array $prev, array $director, array $prior, callable $emit): string {
    if (is_mock()) return mock_stream(mock_panel($ctx, $question, $task, $prev), $emit);
    return llm_stream(panel_messages($ctx, $question, $task, $prev, $director, $prior), $emit, 0.7, 700);
}

function agent_synthesis(array $director, array $profile, string $question, array $answers, callable $emit): string {
    if (is_mock()) return mock_stream(mock_synthesis($answers), $emit);
    return llm_stream(synthesis_messages($director, $profile, $question, $answers), $emit, 0.5, 500);
}

function agent_director_answer(array $director, array $profile, string $question, array $team, array $prior, callable $emit): string {
    if (is_mock()) return mock_stream(mock_director_answer($question, $team), $emit);
    return llm_stream(director_answer_messages($director, $profile, $question, $team, $prior), $emit, 0.6, 500);
}

function agent_turn(array $ctx, string $topic, string $style, array $participants, array $transcript, int $turnNo, callable $emit): string {
    if (is_mock()) return mock_stream(mock_turn($ctx, $style, $transcript, $turnNo), $emit);
    return llm_stream(turn_messages($ctx, $topic, $style, $participants, $transcript, $turnNo), $emit, 0.85, 400);
}

function agent_rt_summary(array $director, array $profile, string $topic, string $style, array $transcript, array $participants, callable $emit): string {
    if (is_mock()) return mock_stream(mock_rt_summary($participants), $emit);
    return llm_stream(rt_summary_messages($director, $profile, $topic, $style, $transcript), $emit, 0.5, 550);
}

function agent_generate_path(array $ctx, array $spec): array {
    if (is_mock()) { usleep(1500000); $raw = mock_path($spec); }
    else $raw = llm_complete(path_messages($ctx, $spec), true, 0.5, 6000);
    $types = shared()['LESSON_TYPES'];
    $modules = [];
    foreach (array_slice(is_array($raw['modules'] ?? null) ? $raw['modules'] : [], 0, 8) as $mod) {
        $lessons = [];
        foreach (array_slice(is_array($mod['lessons'] ?? null) ? $mod['lessons'] : [], 0, 8) as $l) {
            $title = clip($l['title'] ?? '', 140) ?: 'درس';
            $lessons[] = [
                'id' => uid('ls'), 'title' => $title, 'objective' => clip($l['objective'] ?? '', 300),
                'type' => isset($types[$l['type'] ?? '']) ? $l['type'] : 'concept',
                'duration' => clamp_int($l['duration_min'] ?? ($l['duration'] ?? 30), 5, 300, 30),
                'outline' => array_values(array_slice(array_filter(array_map(fn($o) => clip($o, 160), is_array($l['outline'] ?? null) ? $l['outline'] : [])), 0, 7)),
                'exercise' => clip($l['exercise'] ?? '', 500),
                'resources' => array_values(array_slice(array_filter(array_map(fn($o) => clip($o, 200), is_array($l['resources'] ?? null) ? $l['resources'] : [])), 0, 5)),
                'done' => false, 'doneAt' => null,
            ];
        }
        if ($lessons) $modules[] = ['id' => uid('md'), 'title' => clip($mod['title'] ?? '', 120) ?: 'وحدة', 'goal' => clip($mod['goal'] ?? '', 240), 'lessons' => $lessons];
    }
    if (!$modules) fail('لم يتمكن المدرّب من بناء المسار، حاول مرة أخرى.', 502);
    return [
        'id' => uid('p'), 'mentorId' => $ctx['mentor']['id'], 'goalId' => $spec['goalId'] ?: null, 'topic' => $spec['topic'],
        'title' => clip($raw['title'] ?? '', 140) ?: $spec['topic'], 'summary' => clip($raw['summary'] ?? '', 600),
        'level' => clip(($raw['level'] ?? '') ?: $spec['level'], 60), 'hoursPerWeek' => $spec['hoursPerWeek'], 'weeks' => $spec['weeks'],
        'createdAt' => now_iso(), 'modules' => $modules,
    ];
}

function agent_plan_goal(array $ctx, array $goal): array {
    if (is_mock()) { usleep(900000); $raw = mock_goal_plan($goal); }
    else $raw = llm_complete(goal_plan_messages($ctx, $goal), true, 0.4, 900);
    $ms = [];
    foreach (array_slice(is_array($raw['milestones'] ?? null) ? $raw['milestones'] : [], 0, 8) as $m) {
        $t = clip($m['text'] ?? '', 200);
        if ($t !== '') $ms[] = ['id' => uid('ms'), 'text' => $t, 'due' => add_days(clamp_int($m['due_in_days'] ?? 7, 0, 730, 7)), 'done' => false];
    }
    return ['title' => clip($raw['title'] ?? '', 160), 'milestones' => $ms, 'firstStep' => clip($raw['first_step'] ?? '', 300), 'motivation' => clip($raw['motivation'] ?? '', 240)];
}

function agent_daily_brief(): array {
    $profile = get_profile(); $mentors = list_mentors(); $goals = list_goals(); $paths = list_paths();
    $director = find_by_id($mentors, 'director');
    $raw = null;
    if (is_mock()) $raw = mock_brief($profile, $director, $goals, $paths, $mentors);
    else {
        $g = implode('؛ ', array_map(fn($g) => "«{$g['title']}» (" . (!empty($g['deadline']) ? 'باقي ' . days_left($g['deadline']) . ' يوم' : 'بدون موعد') . '، مدرّب: ' . ($g['mentorId'] ?? '') . ')', array_filter($goals, fn($g) => ($g['status'] ?? '') !== 'done'))) ?: 'لا يوجد';
        $p = implode('؛ ', array_map(function ($p) { $all = all_lessons($p); $done = count(array_filter($all, fn($l) => !empty($l['done']))); $next = null; foreach ($all as $l) if (empty($l['done'])) { $next = $l; break; } return "«{$p['title']}» $done/" . count($all) . ($next ? " التالي «{$next['title']}»" : '') . " (مدرّب: {$p['mentorId']})"; }, $paths)) ?: 'لا يوجد';
        $m = implode('؛ ', array_map(fn($m) => "{$m['id']}={$m['name']} ({$m['title']}) آخر تفاعل: " . (!empty($m['lastInteraction']) ? substr($m['lastInteraction'], 0, 10) : 'أبداً'), array_filter($mentors, fn($m) => ($m['role'] ?? '') !== 'director'))) ?: 'لا يوجد';
        $data = "- الاسم: {$profile['name']}، سلسلة الأيام المتتالية: {$profile['streak']}، النقاط: {$profile['xp']}\n- الأهداف: $g\n- المسارات: $p\n- المدرّبون: $m";
        try { $raw = llm_complete(brief_messages($director, $profile, $data), true, 0.7, 500); }
        catch (Throwable $e) { error_log('[brief] ' . $e->getMessage()); $raw = mock_brief($profile, $director, $goals, $paths, $mentors); }
    }
    $ids = array_column($mentors, 'id');
    $focus = [];
    foreach (array_slice(is_array($raw['focus'] ?? null) ? $raw['focus'] : [], 0, 3) as $f) {
        $t = clip($f['text'] ?? '', 200);
        if ($t === '') continue;
        $focus[] = ['text' => $t, 'mentorId' => in_array($f['mentor_id'] ?? null, $ids, true) ? $f['mentor_id'] : null, 'action' => in_array($f['action'] ?? '', ['chat', 'lesson', 'goal'], true) ? $f['action'] : 'chat'];
    }
    return ['date' => today(), 'greeting' => clip($raw['greeting'] ?? '', 120), 'focus' => $focus, 'nudge' => clip($raw['nudge'] ?? '', 200)];
}

function agent_propose_team(array $spec): array {
    $mentors = list_mentors();
    $director = find_by_id($mentors, 'director');
    if (is_mock()) { usleep(1200000); $raw = mock_team($spec); }
    else $raw = llm_complete(team_messages($director, $spec), true, 0.8, 2500);
    $list = [];
    foreach (array_slice(is_array($raw['mentors'] ?? null) ? $raw['mentors'] : [], 0, 3) as $m) if (is_array($m)) $list[] = sanitize_mentor(array_merge($m, ['id' => 'draft']));
    if (!$list) fail('لم يتمكن المدير من اقتراح فريق، حاول مرة أخرى.', 502);
    return ['message' => clip($raw['message'] ?? '', 600), 'goalTitle' => clip($raw['goal_title'] ?? '', 160) ?: clip($spec['goal'], 160), 'mentors' => $list];
}
