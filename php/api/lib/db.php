<?php
// Entities — mirrors server/db.js.

function assert_id($id): string {
    if (!is_string($id) || !preg_match('/^[a-z0-9_-]{1,48}$/i', $id)) fail('معرّف غير صالح');
    return $id;
}

// ---------------- config ----------------
function get_config(): array { $c = read_json('config.json', []); return is_array($c) ? $c : []; }
function patch_config(array $patch): void {
    update_json('config.json', [], function (&$c) use ($patch) {
        if (!is_array($c)) $c = [];
        foreach ($patch as $k => $v) { if ($v === null) unset($c[$k]); else $c[$k] = $v; }
    });
}

// ---------------- profile ----------------
function profile_defaults(): array {
    return ['name' => '', 'bio' => '', 'preferences' => '', 'xp' => 0, 'streak' => 0, 'bestStreak' => 0, 'lastActive' => null,
        'activity' => [], 'stats' => ['lessons' => 0, 'goals' => 0, 'messages' => 0, 'sessions' => 0, 'milestones' => 0, 'paths' => 0],
        'onboarded' => false, 'createdAt' => now_iso()];
}
function with_profile_defaults($p): array {
    $d = profile_defaults();
    $p = is_array($p) ? $p : [];
    $out = array_merge($d, $p);
    $out['stats'] = array_merge($d['stats'], is_array($p['stats'] ?? null) ? $p['stats'] : []);
    $out['activity'] = is_array($p['activity'] ?? null) ? $p['activity'] : [];
    return $out;
}
/** JSON output: keep empty maps as objects. */
function profile_out(array $p): array { $p['activity'] = (object) $p['activity']; $p['stats'] = (object) $p['stats']; return $p; }

function get_profile(): array { return with_profile_defaults(read_json('profile.json', [])); }

function save_profile(array $patch): array {
    return update_json('profile.json', [], function (&$p) use ($patch) {
        $p = with_profile_defaults($p);
        foreach (['name' => 40, 'bio' => 600, 'preferences' => 600] as $k => $max) if (array_key_exists($k, $patch)) $p[$k] = clip($patch[$k], $max);
        if (array_key_exists('onboarded', $patch)) $p['onboarded'] = (bool) $patch['onboarded'];
        return $p;
    });
}

function gain_xp(int $amount, ?string $stat = null): array {
    return update_json('profile.json', [], function (&$p) use ($amount, $stat) {
        $p = with_profile_defaults($p);
        $p['xp'] += $amount;
        if ($stat) $p['stats'][$stat] = ($p['stats'][$stat] ?? 0) + 1;
        $t = today();
        if ($p['lastActive'] !== $t) {
            $yesterday = today(time() - 86400);
            $p['streak'] = $p['lastActive'] === $yesterday ? $p['streak'] + 1 : 1;
            $p['bestStreak'] = max($p['bestStreak'] ?? 0, $p['streak']);
            $p['lastActive'] = $t;
        }
        $p['activity'][$t] = ($p['activity'][$t] ?? 0) + 1;
        ksort($p['activity']);
        while (count($p['activity']) > 90) array_shift($p['activity']);
        return $p;
    });
}

// ---------------- avatar (port of public/js/avatar.js) ----------------
function normalize_avatar($a): array {
    $S = shared();
    $o = ['model' => 'Business_Male_02', 'glasses' => 'none', 'aura' => 'aurora', 'light' => 'studio', 'expression' => 'friendly'];
    if (!is_array($a)) return $o;
    $has = fn($list, $v) => (bool) array_filter($list, fn($x) => $x['id'] === $v);
    if (isset($a['model']) && $has($S['MODELS'], $a['model'])) $o['model'] = $a['model'];
    else $o['model'] = legacy_model($a);
    $g = $a['glasses'] ?? null;
    $g = $g === 'square' ? 'rect' : ($g === 'visor' ? 'none' : $g);
    if ($g && $has($S['GLASSES'], $g)) $o['glasses'] = $g;
    if (isset($a['aura']) && isset($S['AURAS'][$a['aura']])) $o['aura'] = $a['aura'];
    if (isset($a['light']) && $has($S['LIGHTS'], $a['light'])) $o['light'] = $a['light'];
    if (isset($a['expression']) && $has($S['EXPRESSIONS'], $a['expression'])) $o['expression'] = $a['expression'];
    return $o;
}
function legacy_model(array $a): string {
    $hair = (string) ($a['hair'] ?? '');
    $long = (bool) preg_match('/long|bun|ponytail/', $hair);
    if (($a['headwear'] ?? '') === 'hijab') return 'Female_Adult_06';
    if (in_array($a['headwear'] ?? '', ['ghutra', 'shemagh'], true)) return 'Male_Adult_19';
    if (($a['kind'] ?? '') === 'robot') return 'Business_Male_05';
    if (($a['outfit'] ?? '') === 'lab') return $long ? 'Medical_Female_02' : 'Medical_Male_03';
    if (($a['outfit'] ?? '') === 'sport') return $long ? 'Sports_Female_02' : 'Sports_Male_04';
    $female = $long || (!empty($a['blush']) && ($a['facial'] ?? '') === 'none');
    $pool = array_values(array_filter(shared()['MODELS'], fn($m) => $m['g'] === ($female ? 'f' : 'm') && !in_array('traditional', $m['tags'], true)));
    return $pool[crc32(json_encode($a)) % count($pool)]['id'];
}

// ---------------- mentors ----------------
function sanitize_mentor(array $m): array {
    $S = shared();
    $personality = [];
    foreach ($S['TRAITS'] as $t) $personality[$t['id']] = clamp_int($m['personality'][$t['id']] ?? 50, 0, 100, 50);
    $styleIds = array_column($S['STYLES'], 'id');
    $styles = array_values(array_slice(array_filter(is_array($m['styles'] ?? null) ? $m['styles'] : [], fn($s) => in_array($s, $styleIds, true)), 0, 3));
    $dialects = array_column($S['DIALECTS'], 'id');
    $out = [
        'id' => $m['id'] ?? null,
        'role' => ($m['role'] ?? '') === 'director' ? 'director' : 'mentor',
        'name' => clip($m['name'] ?? '', 40) ?: 'مدرب',
        'title' => clip($m['title'] ?? '', 80) ?: 'مدرب شخصي',
        'specialty' => clip($m['specialty'] ?? '', 300) ?: 'تدريب عام',
        'scope' => clip($m['scope'] ?? '', 400),
        'description' => clip($m['description'] ?? '', 500),
        'personality' => $personality,
        'styles' => $styles,
        'dialect' => in_array($m['dialect'] ?? '', $dialects, true) ? $m['dialect'] : 'msa',
        'catchphrase' => clip($m['catchphrase'] ?? '', 140),
        'rules' => clip($m['rules'] ?? '', 1500),
        'avatar' => normalize_avatar($m['avatar'] ?? null),
        'bond' => (int) ($m['bond'] ?? 0),
        'createdAt' => $m['createdAt'] ?? now_iso(),
        'updatedAt' => now_iso(),
        'lastInteraction' => $m['lastInteraction'] ?? null,
    ];
    if (!empty($m['template'])) $out['template'] = clip($m['template'], 30);
    return $out;
}

function list_mentors(): array {
    $all = [];
    foreach (list_dirs('mentors') as $id) {
        if (!preg_match('/^[a-z0-9_-]{1,48}$/i', $id)) continue;
        $m = read_json("mentors/$id/mentor.json", null);
        if (is_array($m)) $all[] = $m;
    }
    usort($all, function ($a, $b) {
        $d = (($b['role'] ?? '') === 'director') <=> (($a['role'] ?? '') === 'director');
        return $d ?: strcmp((string) ($a['createdAt'] ?? ''), (string) ($b['createdAt'] ?? ''));
    });
    return $all;
}

function get_mentor($id): array {
    assert_id($id);
    $m = read_json("mentors/$id/mentor.json", null);
    if (!is_array($m)) fail('المدرب غير موجود', 404);
    return $m;
}

function create_mentor(array $data, ?array $profile = null): array {
    $id = ($data['role'] ?? '') === 'director' ? 'director' : uid('m');
    $m = sanitize_mentor(array_merge($data, ['id' => $id, 'bond' => 0, 'createdAt' => now_iso()]));
    write_json("mentors/$id/mentor.json", $m);
    write_text("mentors/$id/memory.md", initial_memory($m, $profile ?? get_profile()));
    return $m;
}

function ensure_director(): void {
    if (!is_array(read_json('mentors/director/mentor.json', null))) create_mentor(shared()['DIRECTOR']);
}

function update_mentor($id, array $patch): array {
    assert_id($id);
    return update_json("mentors/$id/mentor.json", null, function (&$m) use ($patch) {
        if (!is_array($m)) fail('المدرب غير موجود', 404);
        $m = sanitize_mentor(array_merge($m, $patch, ['id' => $m['id'], 'role' => $m['role'], 'bond' => $m['bond'] ?? 0, 'createdAt' => $m['createdAt'], 'lastInteraction' => $m['lastInteraction'] ?? null]));
        return $m;
    });
}

function bump_bond($id, int $n = 1): void {
    assert_id($id);
    if (!is_file(data_path("mentors/$id/mentor.json"))) return;
    update_json("mentors/$id/mentor.json", null, function (&$m) use ($n) {
        if (!is_array($m)) return null;
        $m['bond'] = ($m['bond'] ?? 0) + $n;
        $m['lastInteraction'] = now_iso();
    });
}

function delete_mentor($id): void {
    if (assert_id($id) === 'director') fail('لا يمكن حذف مدير المجلس');
    remove_path("mentors/$id");
    update_json('goals.json', [], function (&$goals) use ($id) { foreach ($goals as &$g) if (($g['mentorId'] ?? null) === $id) $g['mentorId'] = null; });
}

// ---------------- memory ----------------
function memory_path($id): string { return 'mentors/' . assert_id($id) . '/memory.md'; }
function get_memory($id): string { return read_text(memory_path($id), ''); }
function save_memory($id, string $md): void { write_text(memory_path($id), mb_substr($md, 0, 60000)); }

function apply_memory($id, array $add = [], array $remove = []): array {
    $added = []; $removed = [];
    update_text(memory_path($id), '', function ($md) use ($add, $remove, &$added, &$removed) {
        $r1 = mem_remove_items($md, $remove);
        $r2 = mem_add_items($r1['md'], $add);
        $removed = $r1['removed']; $added = $r2['added'];
        return $r2['md'];
    });
    return ['added' => $added, 'removed' => $removed];
}

function log_memory($id, string $text): void {
    if (!$id || !is_file(data_path('mentors/' . assert_id($id) . '/mentor.json'))) return;
    apply_memory($id, [log_line($text)]);
}

function reset_memory($id): void { $m = get_mentor($id); save_memory($id, initial_memory($m, get_profile())); }

// ---------------- chat ----------------
function chat_path($id): string { return 'mentors/' . assert_id($id) . '/chat.json'; }
function get_chat($id): array { $c = read_json(chat_path($id), []); return is_array($c) ? $c : []; }
function clear_chat($id): void { write_json(chat_path($id), []); }
function append_chat($id, array ...$msgs): void {
    update_json(chat_path($id), [], function (&$list) use ($msgs) {
        foreach ($msgs as $m) $list[] = strip_nulls($m);
        if (count($list) > 300) $list = array_slice($list, -300);
    });
}
function patch_chat_message($id, string $msgId, array $patch): void {
    update_json(chat_path($id), [], function (&$list) use ($msgId, $patch) {
        foreach ($list as &$m) if (($m['id'] ?? '') === $msgId) { $m = strip_nulls(array_merge($m, $patch)); break; }
    });
}

// ---------------- goals ----------------
function list_goals(): array { $g = read_json('goals.json', []); return is_array($g) ? $g : []; }
function get_goal($id): array { $g = find_by_id(list_goals(), $id); if (!$g) fail('الهدف غير موجود', 404); return $g; }
function update_goal($id, callable $fn): array {
    return update_json('goals.json', [], function (&$goals) use ($id, $fn) {
        foreach ($goals as &$g) if ($g['id'] === $id) { $fn($g); return $g; }
        fail('الهدف غير موجود', 404);
    });
}

// ---------------- paths ----------------
function list_paths(): array { $p = read_json('paths.json', []); return is_array($p) ? $p : []; }
function update_path($id, callable $fn): array {
    return update_json('paths.json', [], function (&$list) use ($id, $fn) {
        foreach ($list as &$p) if ($p['id'] === $id) { $fn($p); return $p; }
        fail('المسار غير موجود', 404);
    });
}
function find_lesson($pathId, $lessonId): ?array {
    foreach (list_paths() as $p) {
        if ($p['id'] !== $pathId) continue;
        foreach ($p['modules'] as $mi => $mod) foreach ($mod['lessons'] as $l) {
            if ($l['id'] === $lessonId) return ['path' => $p, 'module' => $mod, 'moduleIndex' => $mi, 'lesson' => $l];
        }
    }
    return null;
}

// ---------------- council sessions ----------------
function list_sessions(): array { $s = read_json('council.json', []); return is_array($s) ? $s : []; }
function get_session($id): ?array { return find_by_id(list_sessions(), $id); }
function save_session(array $session): void {
    update_json('council.json', [], function (&$list) use ($session) {
        $list = array_values(array_filter($list, fn($s) => $s['id'] !== $session['id']));
        array_unshift($list, $session);
        $list = array_slice($list, 0, 40);
    });
}

// ---------------- export / reset ----------------
function export_all(): array {
    $mentors = list_mentors();
    $memories = [];
    foreach ($mentors as $m) $memories[$m['id']] = get_memory($m['id']);
    return ['exportedAt' => now_iso(), 'profile' => profile_out(get_profile()), 'mentors' => $mentors, 'memories' => $memories,
        'goals' => list_goals(), 'paths' => list_paths(), 'council' => list_sessions()];
}

function reset_all(): void {
    foreach (['profile.json', 'goals.json', 'paths.json', 'council.json', 'brief.json'] as $f) remove_path($f);
    remove_path('mentors');
    ensure_director();
}
