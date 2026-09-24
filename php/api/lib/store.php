<?php
// File storage: same layout as the Node version (data/*.json, data/mentors/<id>/memory.md …).

function data_path(string $rel): string { return DATA_DIR . '/' . $rel; }

function ensure_dir(string $dir): void {
    if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
        fail('تعذّر إنشاء مجلد البيانات — تأكد من صلاحيات الكتابة', 500);
    }
}

function protect_data_dir(): void {
    ensure_dir(DATA_DIR);
    $ht = DATA_DIR . '/.htaccess';
    if (!is_file($ht)) @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    $idx = DATA_DIR . '/index.html';
    if (!is_file($idx)) @file_put_contents($idx, '');
}

function read_text(string $rel, string $fallback = ''): string {
    $f = data_path($rel);
    if (!is_file($f)) return $fallback;
    $t = @file_get_contents($f);
    return $t === false ? $fallback : $t;
}

function read_json(string $rel, $fallback) {
    $f = data_path($rel);
    if (!is_file($f)) return $fallback;
    $t = @file_get_contents($f);
    if ($t === false) return $fallback;
    $d = json_decode($t, true);
    return ($d === null && trim($t) !== 'null') ? $fallback : $d;
}

function write_raw(string $rel, string $text): void {
    $file = data_path($rel);
    ensure_dir(dirname($file));
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, $text) === false) fail('تعذّر حفظ البيانات — تأكد من صلاحيات الكتابة', 500);
    if (!@rename($tmp, $file)) { @unlink($tmp); fail('تعذّر حفظ البيانات', 500); }
}

function encode_json($data): string {
    return json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function with_lock(string $rel, callable $fn) {
    $dir = DATA_DIR . '/.locks';
    ensure_dir($dir);
    $h = fopen($dir . '/' . md5($rel) . '.lock', 'c');
    if ($h) flock($h, LOCK_EX);
    try { return $fn(); }
    finally { if ($h) { flock($h, LOCK_UN); fclose($h); } }
}

function write_json(string $rel, $data): void { with_lock($rel, fn() => write_raw($rel, encode_json($data))); }
function write_text(string $rel, string $text): void { with_lock($rel, fn() => write_raw($rel, $text)); }

/** Read-modify-write. $mutator receives the data by reference; its return value (if not null) is returned. */
function update_json(string $rel, $fallback, callable $mutator) {
    return with_lock($rel, function () use ($rel, $fallback, $mutator) {
        $data = read_json($rel, $fallback);
        $out = $mutator($data);
        write_raw($rel, encode_json($data));
        return $out ?? $data;
    });
}

function update_text(string $rel, string $fallback, callable $mutator): string {
    return with_lock($rel, function () use ($rel, $fallback, $mutator) {
        $next = $mutator(read_text($rel, $fallback));
        write_raw($rel, $next);
        return $next;
    });
}

function list_dirs(string $rel): array {
    $d = data_path($rel);
    if (!is_dir($d)) return [];
    $out = [];
    foreach (scandir($d) as $n) if ($n[0] !== '.' && is_dir("$d/$n")) $out[] = $n;
    return $out;
}

function file_mtime(string $rel): ?string {
    $f = data_path($rel);
    return is_file($f) ? gmdate('Y-m-d\TH:i:s.000\Z', filemtime($f)) : null;
}

function remove_path(string $rel): void {
    $p = data_path($rel);
    if (is_file($p)) { @unlink($p); return; }
    if (!is_dir($p)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($p, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    @rmdir($p);
}
