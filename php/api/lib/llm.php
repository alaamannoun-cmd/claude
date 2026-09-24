<?php
// DeepSeek client (OpenAI-compatible) using cURL. The key never leaves the server.

function llm_config(): array {
    $cfg = get_config();
    $key = ($cfg['apiKey'] ?? '') ?: (CFG['DEEPSEEK_API_KEY'] ?? '');
    return [
        'apiKey' => $key,
        'keySource' => !empty($cfg['apiKey']) ? 'app' : (!empty(CFG['DEEPSEEK_API_KEY']) ? 'env' : null),
        'model' => ($cfg['model'] ?? '') ?: (CFG['DEEPSEEK_MODEL'] ?? 'deepseek-chat'),
        'baseUrl' => rtrim(CFG['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com', '/'),
        'forceMock' => !empty(CFG['MOCK']),
    ];
}

function is_mock(): bool { $c = llm_config(); return $c['forceMock'] || !$c['apiKey']; }

function public_config(): array {
    $c = llm_config();
    return [
        'hasKey' => (bool) $c['apiKey'],
        'keySource' => $c['keySource'],
        'keyHint' => $c['apiKey'] ? substr($c['apiKey'], 0, 3) . '…' . substr($c['apiKey'], -4) : '',
        'model' => $c['model'],
        'mock' => $c['forceMock'] || !$c['apiKey'],
        'forceMock' => $c['forceMock'],
        'protected' => (bool) (CFG['APP_PASSWORD'] ?? ''),
        'backend' => 'php',
    ];
}

function llm_friendly(int $status): string {
    $map = [400 => 'طلب غير صالح لـ DeepSeek.', 401 => 'مفتاح DeepSeek غير صالح — راجع الإعدادات.', 402 => 'رصيد حساب DeepSeek غير كافٍ.',
        422 => 'معاملات الطلب غير صالحة.', 429 => 'تم تجاوز حدّ الطلبات، حاول بعد قليل.', 500 => 'خطأ في خادم DeepSeek، حاول مرة أخرى.',
        503 => 'خدمة DeepSeek مزدحمة حالياً، حاول بعد قليل.'];
    return $map[$status] ?? "خطأ من DeepSeek ($status)";
}

/** Merge consecutive same-role turns and make sure a user turn comes first. */
function tidy_messages(array $messages): array {
    $out = [];
    foreach ($messages as $m) {
        if (empty($m['content'])) continue;
        $n = count($out);
        if ($n && $out[$n - 1]['role'] === $m['role'] && $m['role'] !== 'system') $out[$n - 1]['content'] .= "\n\n" . $m['content'];
        else $out[] = ['role' => $m['role'], 'content' => $m['content']];
    }
    foreach ($out as $i => $m) {
        if ($m['role'] === 'system') continue;
        if ($m['role'] === 'assistant') array_splice($out, $i, 0, [['role' => 'user', 'content' => '(بداية الجلسة)']]);
        break;
    }
    return $out;
}

function parse_json_text(string $text): array {
    $clean = trim(preg_replace('/```(?:json)?/i', '', $text));
    $d = json_decode($clean, true);
    if (is_array($d)) return $d;
    $a = strpos($clean, '{'); $b = strrpos($clean, '}');
    if ($a !== false && $b > $a) { $d = json_decode(substr($clean, $a, $b - $a + 1), true); if (is_array($d)) return $d; }
    fail('تعذّر فهم رد الذكاء الاصطناعي (JSON غير صالح)', 502);
    return [];
}

function llm_curl(array $body, ?callable $onData, int $timeout) {
    $c = llm_config();
    $ch = curl_init($c['baseUrl'] . '/chat/completions');
    $status = 0; $errBody = '';
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Authorization: Bearer ' . $c['apiKey']],
        CURLOPT_POSTFIELDS => json_encode(array_merge(['model' => $c['model']], $body), JSON_UNESCAPED_UNICODE),
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_HEADERFUNCTION => function ($ch, $h) use (&$status) {
            if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $status = (int) $m[1];
            return strlen($h);
        },
    ]);
    if ($onData) {
        curl_setopt($ch, CURLOPT_WRITEFUNCTION, function ($ch, $data) use (&$status, &$errBody, $onData) {
            if ($status >= 400) { $errBody .= $data; return strlen($data); }
            if (connection_aborted()) return 0;
            $onData($data);
            return strlen($data);
        });
        $ok = curl_exec($ch);
        $result = null;
    } else {
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $result = curl_exec($ch);
        $ok = $result !== false;
        if ($status >= 400) $errBody = (string) $result;
    }
    $err = curl_error($ch);
    curl_close($ch);
    if ($status >= 400) {
        error_log("[deepseek] $status $errBody");
        fail(llm_friendly($status), 502);
    }
    if (!$ok && !connection_aborted()) fail('تعذّر الاتصال بـ DeepSeek — ' . ($err ?: 'تحقّق من الإنترنت'), 502);
    return $result;
}

function llm_complete(array $messages, bool $json = false, float $temperature = 0.6, int $maxTokens = 1200) {
    $c = llm_config();
    $body = ['messages' => tidy_messages($messages), 'temperature' => $temperature, 'max_tokens' => $maxTokens, 'stream' => false];
    if ($json && strpos($c['model'], 'reasoner') === false) $body['response_format'] = ['type' => 'json_object'];
    $raw = llm_curl($body, null, 180);
    $data = json_decode((string) $raw, true);
    $text = $data['choices'][0]['message']['content'] ?? '';
    return $json ? parse_json_text($text) : $text;
}

/** Streams completion deltas to $onDelta(string $t); returns the full text. */
function llm_stream(array $messages, callable $onDelta, float $temperature = 0.7, int $maxTokens = 1800): string {
    $buf = ''; $full = '';
    llm_curl(['messages' => tidy_messages($messages), 'temperature' => $temperature, 'max_tokens' => $maxTokens, 'stream' => true],
        function ($data) use (&$buf, &$full, $onDelta) {
            $buf .= $data;
            while (($i = strpos($buf, "\n")) !== false) {
                $line = trim(substr($buf, 0, $i));
                $buf = substr($buf, $i + 1);
                if (strpos($line, 'data:') !== 0) continue;
                $payload = trim(substr($line, 5));
                if ($payload === '[DONE]') return;
                $j = json_decode($payload, true);
                $t = $j['choices'][0]['delta']['content'] ?? '';
                if ($t !== '') { $full .= $t; $onDelta($t); }
            }
        }, 300);
    return $full;
}

function test_connection(): array {
    if (is_mock()) return ['ok' => true, 'mock' => true];
    $t = llm_complete([['role' => 'user', 'content' => 'Reply with exactly: ok']], false, 0, 5);
    return ['ok' => true, 'mock' => false, 'sample' => mb_substr((string) $t, 0, 40)];
}
