// Interaction check: drag a wake across the words, drop a stone, hover a link,
// and screenshot each moment.  node tools/poke.ts [--r webgl2] [--vp 1440x900]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const [w, h] = opt('vp', '1440x900').split('x').map(Number);
const r = opt('r', 'webgl2');
const out = opt('out', 'shots/poke');
const q = opt('q', '');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-webgpu', '--force-color-profile=display-p3-d65'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://127.0.0.1:5173/?renderer=${r}${q ? `&${q}` : ''}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// a slow wake from right to left through "jet"
await page.mouse.move(w * 0.62, h * 0.42);
for (let i = 0; i <= 40; i++) {
  await page.mouse.move(w * (0.62 - i * 0.012), h * (0.42 + Math.sin(i / 6) * 0.03));
  await page.waitForTimeout(16);
}
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/1-wake.png` });

// a stone dropped near the moon's reflection
await page.mouse.click(w * 0.7, h * 0.32);
await page.waitForTimeout(450);
await page.screenshot({ path: `${out}/2-stone.png` });

// hover a link
const link = page.locator('a[data-pigment="cobalt"]');
await link.hover();
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/3-hover.png` });

// keyboard focus
await page.mouse.move(w * 0.9, h * 0.9);
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/4-focus.png` });

console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();
