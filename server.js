import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
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
};

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    if (path.extname(rel)) { res.writeHead(404).end('Not found'); return; }
    const html = await fs.readFile(path.join(PUBLIC, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(html);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
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
});
