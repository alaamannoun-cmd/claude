// DeepSeek client (OpenAI-compatible Chat Completions API).
// The key lives only on the server (data/config.json or .env) and never reaches the browser.
import { getConfig } from './db.js';

export async function llmConfig() {
  const cfg = await getConfig();
  return {
    apiKey: cfg.apiKey || process.env.DEEPSEEK_API_KEY || '',
    keySource: cfg.apiKey ? 'app' : process.env.DEEPSEEK_API_KEY ? 'env' : null,
    model: cfg.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    forceMock: process.env.MOCK === '1',
  };
}

export async function isMock() {
  const c = await llmConfig();
  return c.forceMock || !c.apiKey;
}

export async function publicConfig() {
  const c = await llmConfig();
  return {
    hasKey: !!c.apiKey,
    keySource: c.keySource,
    keyHint: c.apiKey ? `${c.apiKey.slice(0, 3)}…${c.apiKey.slice(-4)}` : '',
    model: c.model,
    mock: c.forceMock || !c.apiKey,
    forceMock: c.forceMock,
    protected: !!process.env.APP_PASSWORD,
    backend: 'node',
  };
}

const FRIENDLY = {
  400: 'طلب غير صالح لـ DeepSeek.',
  401: 'مفتاح DeepSeek غير صالح — راجع الإعدادات.',
  402: 'رصيد حساب DeepSeek غير كافٍ.',
  422: 'معاملات الطلب غير صالحة.',
  429: 'تم تجاوز حدّ الطلبات، حاول بعد قليل.',
  500: 'خطأ في خادم DeepSeek، حاول مرة أخرى.',
  503: 'خدمة DeepSeek مزدحمة حالياً، حاول بعد قليل.',
};

async function call(body, signal) {
  const c = await llmConfig();
  let res;
  try {
    res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, ...body }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw Object.assign(new Error('تعذّر الاتصال بـ DeepSeek — تحقّق من الإنترنت.'), { status: 502, cause: e });
  }
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || JSON.stringify(j); } catch { /* ignore */ }
    console.warn(`[deepseek] ${res.status} ${detail}`);
    throw Object.assign(new Error(FRIENDLY[res.status] || `خطأ من DeepSeek (${res.status})`), { status: 502, detail });
  }
  return res;
}

/** DeepSeek (like most chat APIs) prefers alternating roles and a user turn first. */
export function tidyMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m?.content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role !== 'system') last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  const firstNonSystem = out.findIndex(m => m.role !== 'system');
  if (firstNonSystem >= 0 && out[firstNonSystem].role === 'assistant') out.splice(firstNonSystem, 0, { role: 'user', content: '(بداية الجلسة)' });
  return out;
}

export function parseJSON(text) {
  const clean = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(clean.slice(a, b + 1)); } catch { /* fall through */ }
  }
  throw Object.assign(new Error('تعذّر فهم رد الذكاء الاصطناعي (JSON غير صالح)'), { status: 502 });
}

export async function complete({ messages, json = false, temperature = 0.6, maxTokens = 1200, signal }) {
  const c = await llmConfig();
  const body = { messages: tidyMessages(messages), temperature, max_tokens: maxTokens, stream: false };
  if (json && !c.model.includes('reasoner')) body.response_format = { type: 'json_object' };
  const res = await call(body, signal ?? AbortSignal.timeout(180_000));
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  return json ? parseJSON(text) : text;
}

export async function* stream({ messages, temperature = 0.7, maxTokens = 1800, signal }) {
  const res = await call({ messages: tidyMessages(messages), temperature, max_tokens: maxTokens, stream: true }, signal);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const t = JSON.parse(payload)?.choices?.[0]?.delta?.content;
          if (t) yield t;
        } catch { /* keep-alive or partial line */ }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

export async function testConnection() {
  if (await isMock()) return { ok: true, mock: true };
  const text = await complete({ messages: [{ role: 'user', content: 'Reply with exactly: ok' }], maxTokens: 5, temperature: 0 });
  return { ok: true, mock: false, sample: String(text).slice(0, 40) };
}
