<?php
// memory.md helpers — identical behaviour to server/memory.js (line-based edits keep manual changes).

const LOG_SECTION = 'سجل التقدّم';

function mem_norm(string $s): string {
    $s = preg_replace('/^\s*[-*]\s+/u', '', $s);
    return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $s)));
}

function initial_memory(array $mentor, array $profile = []): string {
    $out = ["# ذاكرة {$mentor['name']}", '', "> هذا الملف هو ما يتذكّره {$mentor['name']} عنك. يقرأه قبل كل رد، ويحدّثه تلقائياً بعد المحادثات. عدّل أو احذف ما تشاء.", ''];
    $sections = shared()['MEMORY_SECTIONS'];
    foreach ($sections as $s) {
        $out[] = "## $s";
        if ($s === $sections[0]) {
            if (!empty($profile['name'])) $out[] = "- الاسم: {$profile['name']}";
            if (!empty($profile['bio'])) $out[] = "- نبذة: {$profile['bio']}";
        }
        if ($s === 'التفضيلات وأسلوب التعلّم' && !empty($profile['preferences'])) $out[] = "- {$profile['preferences']}";
        if ($s === LOG_SECTION) $out[] = '- [' . today() . "] بداية العمل مع {$mentor['name']}";
        $out[] = '';
    }
    return implode("\n", $out);
}

function parse_memory(string $md): array {
    $sections = [];
    $cur = -1;
    foreach (preg_split('/\r?\n/', $md) as $raw) {
        $line = trim($raw);
        if (preg_match('/^##\s+(.+)$/u', $line, $m)) { $sections[] = ['name' => trim($m[1]), 'items' => []]; $cur = count($sections) - 1; continue; }
        if ($cur < 0 || $line === '' || $line[0] === '#' || $line[0] === '>') continue;
        $sections[$cur]['items'][] = preg_replace('/^[-*]\s+/u', '', $line);
    }
    return $sections;
}

function mem_add_items(string $md, array $items): array {
    $lines = preg_split('/\r?\n/', $md);
    $existing = [];
    foreach ($lines as $l) { $n = mem_norm($l); if ($n !== '') $existing[$n] = true; }
    $added = [];
    foreach ($items as $it) {
        $section = $it['section'] ?? '';
        $clean = trim(preg_replace('/\s+/u', ' ', (string) ($it['text'] ?? '')));
        if ($clean === '' || isset($existing[mem_norm($clean)])) continue;
        $existing[mem_norm($clean)] = true;
        $h = -1;
        foreach ($lines as $i => $l) if (trim($l) === "## $section") { $h = $i; break; }
        if ($h === -1) {
            if (count($lines) && trim(end($lines)) !== '') $lines[] = '';
            array_push($lines, "## $section", "- $clean", '');
        } else {
            $end = $h + 1;
            while ($end < count($lines) && !preg_match('/^##\s/u', trim($lines[$end]))) $end++;
            $at = $end;
            while ($at > $h + 1 && trim($lines[$at - 1]) === '') $at--;
            array_splice($lines, $at, 0, ["- $clean"]);
        }
        $added[] = ['section' => $section, 'text' => $clean];
    }
    return ['md' => implode("\n", $lines), 'added' => $added];
}

function mem_remove_items(string $md, array $texts): array {
    $targets = [];
    foreach ($texts as $t) { $n = mem_norm((string) $t); if ($n !== '') $targets[$n] = true; }
    if (!$targets) return ['md' => $md, 'removed' => []];
    $removed = []; $kept = [];
    foreach (preg_split('/\r?\n/', $md) as $l) {
        $t = trim($l);
        if (preg_match('/^[-*]\s+/u', $t) && isset($targets[mem_norm($t)])) { $removed[] = preg_replace('/^[-*]\s+/u', '', $t); continue; }
        $kept[] = $l;
    }
    return ['md' => implode("\n", $kept), 'removed' => $removed];
}

function log_line(string $text): array { return ['section' => LOG_SECTION, 'text' => '[' . today() . "] $text"]; }

function memory_for_prompt(string $md): string {
    $parts = [];
    foreach (parse_memory($md) as $s) {
        $items = $s['items'];
        if ($s['name'] === LOG_SECTION && count($items) > 12) $items = array_slice($items, -12);
        if (!$items) continue;
        $parts[] = "### {$s['name']}\n" . implode("\n", array_map(fn($i) => "- $i", $items));
    }
    $text = implode("\n\n", $parts);
    if (mb_strlen($text) > 7000) $text = mb_substr($text, 0, 7000) . "\n…";
    return $text !== '' ? $text : '(لا توجد ملاحظات بعد — هذه بداية علاقتكما)';
}
