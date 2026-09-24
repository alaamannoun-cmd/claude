// PUT/PATCH/DELETE travel as POST + X-HTTP-Method-Override (some shared hosts block those verbs).
async function req(method, url, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (!['GET', 'POST'].includes(method)) headers['X-HTTP-Method-Override'] = method;
  const res = await fetch(url, {
    method: method === 'GET' ? 'GET' : 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, auth: !!data.auth });
  return data;
}

export const api = {
  get: url => req('GET', url),
  post: (url, body = {}) => req('POST', url, body),
  put: (url, body = {}) => req('PUT', url, body),
  patch: (url, body = {}) => req('PATCH', url, body),
  del: (url, body) => req('DELETE', url, body),
};

/**
 * POST + Server-Sent Events reader.
 * handlers: { [eventName]: (data) => void }
 */
export async function stream(url, body, handlers, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw Object.assign(new Error(d.error || `HTTP ${res.status}`), { status: res.status, auth: !!d.auth });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message', data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed;
      try { parsed = JSON.parse(data); } catch { parsed = data; }
      handlers[event]?.(parsed);
    }
  }
}
