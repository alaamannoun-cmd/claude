<?php
// Small helpers shared by the PHP backend (Hostinger / any PHP 8+ host).

class HttpError extends Exception {
    public int $status;
    public function __construct(string $message, int $status = 400) {
        parent::__construct($message);
        $this->status = $status;
    }
}

function fail(string $msg, int $status = 400): void { throw new HttpError($msg, $status); }

function clip($v, int $max = 400): string {
    return mb_substr(trim((string)($v ?? '')), 0, $max);
}

function now_iso(): string {
    return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
}

function today(?int $ts = null): string { return date('Y-m-d', $ts ?? time()); }

function add_days(int $n): string { return date('Y-m-d', strtotime("+$n days")); }

function days_left(?string $date): ?int {
    if (!$date) return null;
    $a = new DateTime(today() . ' 00:00:00');
    $b = DateTime::createFromFormat('Y-m-d H:i:s', $date . ' 00:00:00');
    if (!$b) return null;
    return (int) round(($b->getTimestamp() - $a->getTimestamp()) / 86400);
}

function uid(string $prefix = ''): string {
    return $prefix . base_convert((string) (int) floor(microtime(true) * 1000), 10, 36) . bin2hex(random_bytes(3));
}

function clamp_int($v, int $lo, int $hi, int $def): int {
    if (!is_numeric($v)) return $def;
    return max($lo, min($hi, (int) round((float) $v)));
}

function short_text(string $s, int $n = 80): string {
    return mb_strlen($s) > $n ? trim(mb_substr($s, 0, $n)) . '…' : $s;
}

/** Arabic long date like the Node version's toLocaleString('ar', …). */
function now_text(): string {
    $days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    $months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return $days[(int) date('w')] . '، ' . date('j') . ' ' . $months[(int) date('n') - 1] . ' ' . date('Y') . ' ' . date('H:i');
}

function shared(): array {
    static $s = null;
    if ($s === null) $s = json_decode(file_get_contents(__DIR__ . '/../shared.json'), true);
    return $s;
}

function find_by_id(array $list, $id, string $key = 'id'): ?array {
    foreach ($list as $x) if (($x[$key] ?? null) === $id) return $x;
    return null;
}

function json_out(int $status, $data): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Recursively drop null values (mirrors JS "undefined" keys being omitted). */
function strip_nulls(array $a): array {
    foreach ($a as $k => $v) {
        if ($v === null) unset($a[$k]);
    }
    return $a;
}
