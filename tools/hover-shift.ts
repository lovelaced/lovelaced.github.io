// Regression check: hovering a link must never move the words around it.

import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome' });
for (const [w, h] of [[1440, 900], [412, 915]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: w < 600 });
  await page.goto('http://127.0.0.1:5173/?renderer=webgl2', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const top = () => page.evaluate(() => [document.querySelector('h1')!.getBoundingClientRect().top, document.querySelector('nav')!.getBoundingClientRect().top].map(Math.round));
  const before = await top();
  const after: Record<string, number[]> = {};
  for (const p of ['jet', 'scheele', 'cobalt', 'paris']) {
    if (w < 600) await page.focus(`[data-pigment="${p}"]`);
    else await page.hover(`[data-pigment="${p}"]`);
    await page.waitForTimeout(700);
    after[p] = await top();
  }
  const story = await page.evaluate(() => { const r = document.querySelector('.story')!.getBoundingClientRect(); return [Math.round(r.bottom), innerHeight]; });
  await page.screenshot({ path: `shots/shift-${w}.png` });
  console.log(`${w}x${h} before ${before} after ${JSON.stringify(after)} story-bottom/viewport ${story}`);
  await page.close();
}
await browser.close();
