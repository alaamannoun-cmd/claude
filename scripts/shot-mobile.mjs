// Phone-sized screenshots with touch emulation
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`file://${resolve('dist/sakura-michi.html')}?q=low&noloop`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => window.__game.frame(1 / 30));
await page.screenshot({ path: 'shots/m-title.png', timeout: 300000 });
await page.evaluate(() => {
  const g = window.__game;
  g.start();
  g.place(120, 5);
  g.input.touch.throttle = 1;
  window.__norender = true;
  for (let i = 0; i < 40; i++) g.frame(1 / 30);
  window.__norender = false;
  g.frame(1 / 30);
});
await page.screenshot({ path: 'shots/m-ride.png', timeout: 300000 });
await browser.close();
