import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './server/env.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));
if (!process.env.DATA_DIR) process.env.DATA_DIR = path.join(ROOT, 'data');

// imported after .env is loaded so modules see the final environment
const { handleApi } = await import('./server/routes.js');
const { ensureDirector } = await import('./server/db.js');
const { publicConfig } = await import('./server/llm.js');

const PUBLIC = path.join(ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    // 3D models, portraits and vendored libraries are immutable: let the browser cache them
    const cache = /^\/(avatars|vendor)\//.test(rel) ? 'public, max-age=604800' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    if (path.extname(rel)) { res.writeHead(404).end('Not found'); return; }
    const html = await fs.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(html);
  }
}

// Optional password gate for public hosting (set APP_PASSWORD in .env): cookie session via /api/login.
const PASSWORD = process.env.APP_PASSWORD || '';
const TOKEN = PASSWORD ? crypto.createHmac('sha256', PASSWORD).update('majlis-session-v1').digest('hex') : '';
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map(c => c.split('=')).find(([k]) => k === name)?.[1] || '';
const authed = req => !PASSWORD || safeEqual(cookieOf(req, 'majlis_auth'), TOKEN);
function authCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `majlis_auth=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
async function handleAuth(req, res, url) {
  const send = (status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/logout') return send(200, { ok: true }, { 'Set-Cookie': authCookie(req, '', 0) }), true;
  if (url.pathname === '/api/login' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) { raw += c; if (raw.length > 10000) break; }
    let password = '';
    try { password = JSON.parse(raw || '{}').password || ''; } catch { /* ignore */ }
    if (!PASSWORD || !safeEqual(password, PASSWORD)) {
      await new Promise(r => setTimeout(r, 800));
      return send(401, { error: 'كلمة المرور غير صحيحة', auth: true }), true;
    }
    return send(200, { ok: true }, { 'Set-Cookie': authCookie(req, TOKEN, 30 * 86400) }), true;
  }
  if (!authed(req)) return send(401, { error: 'تسجيل الدخول مطلوب', auth: true }), true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) { if (!(await handleAuth(req, res, url))) await handleApi(req, res, url); }
    else await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500).end('Server error');
  }
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
await ensureDirector();
server.listen(PORT, HOST, async () => {
  const cfg = await publicConfig();
  console.log(`\n  ✦ مجلس — Majlis AI Mentors`);
  console.log(`  → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(cfg.mock
    ? '  ⚠ وضع تجريبي: لا يوجد مفتاح DeepSeek (أضفه من الإعدادات أو ملف .env)\n'
    : `  ✓ DeepSeek متصل (${cfg.model})\n`);
  if (!PASSWORD && HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('  ⚠ السيرفر مفتوح على الشبكة بدون كلمة مرور — أضف APP_PASSWORD في .env\n');
});
