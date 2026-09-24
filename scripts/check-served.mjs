// Loads the game over HTTP (as a static host would serve it) and reports errors
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/fonts\.g|ERR_CERT|net::/.test(m.text()) && errors.push(m.text()));
await page.goto(url + '?noloop');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const state = await page.evaluate(() => {
  const g = window.__game;
  g.start();
  window.__norender = true;
  g.input.keys.add('KeyW');
  for (let i = 0; i < 120; i++) g.frame(1 / 30);
  window.__norender = false;
  g.frame(1 / 30);
  return { title: document.title, icon: !!document.querySelector('link[rel=icon]'), speedKmh: Math.round(g.bike.speed * 3.6), started: g.game.started };
});
console.log(JSON.stringify(state), 'errors:', errors.length ? errors : 'none');
await browser.close();
