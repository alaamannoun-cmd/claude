// FBX -> raw GLB via headless Chromium (Three.js FBXLoader + GLTFExporter). Serves this folder on :8765.
// usage: node convert.mjs Adults/Female_Adult_06 Professions/Business_Male_02 ...
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
const ROOT = new URL('.', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.fbx': 'application/octet-stream', '.tga': 'image/x-tga' };
const server = http.createServer(async (req, res) => {
  const file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }); res.end(data); }
  catch { res.writeHead(404).end(); }
}).listen(8765);
mkdirSync(join(ROOT, 'glb_raw'), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:8765/convert.html');
await page.waitForFunction(() => window.READY);
for (const entry of process.argv.slice(2)) {
  const [dir, name] = entry.split('/');
  try {
    const r = await page.evaluate(([d, n]) => window.convert(d, n), [dir, name]);
    writeFileSync(join(ROOT, 'glb_raw', `${name}.glb`), Buffer.from(r.b64, 'base64'));
    console.log(name, JSON.stringify({ verts: r.info.verts, morphs: r.info.morphs, mats: r.info.mats }));
  } catch (e) { console.log(name, 'FAILED', e.message.slice(0, 200)); }
}
await browser.close();
server.close();
