// Headless screenshots of the built game for visual checks.
// usage: node scripts/shot.mjs <out-prefix> '<json list of steps>' [query]
// step: { name, js, frames, sim, dt, keys:[...], shot:true }
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const out = process.argv[2] || 'shots/shot';
const steps = JSON.parse(process.argv[3] || '[]');
const query = process.argv[4] || 'q=high&noloop';
const width = Number(process.env.W || 960);
const height = Number(process.env.H || 540);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const file = resolve('dist/sakura-michi.html');
const t0 = Date.now();
await page.goto(`file://${file}?${query}`);
await page.waitForFunction(() => window.__ready === true || document.getElementById('load-text')?.textContent.startsWith('تعذّر'), null, { timeout: 240000 });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
let i = 0;
for (const v of steps) {
  const res = await page.evaluate(async (v) => {
    const g = window.__game;
    if (!g) return 'no game';
    if (v.keys) {
      g.input.keys.clear();
      for (const k of v.keys) g.input.keys.add(k);
    }
    let r = null;
    if (v.js) r = await eval(v.js);
    if (v.sim) {
      window.__norender = true;
      for (let k = 0; k < v.sim; k++) g.frame(v.dt || 1 / 30);
      window.__norender = false;
    }
    for (let k = 0; k < (v.frames ?? 1); k++) g.frame(v.dt || 1 / 30);
    return r;
  }, v);
  if (res !== null && res !== undefined) console.log(v.name || i, '->', JSON.stringify(res));
  if (v.shot !== false) {
    const name = `${out}-${v.name || i}.png`;
    await page.screenshot({ path: name, timeout: 300000 });
    console.log('saved', name);
  }
  i++;
}
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
