// Screenshot harness. Drives the installed Google Chrome (real GPU, no download).
//   node tools/shoot.ts [path] [--t 0,4,10] [--vp 1440x900,412x915] [--r auto,webgl2,webgpu]
//                       [--out shots] [--wait 1500] [--headed] [--q extra=1]
// Saves shots/<name>.png and fails loudly on console errors / page errors.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const path = args[0] && !args[0].startsWith('--') ? args[0] : '/';
const base = opt('base', 'http://127.0.0.1:5173');
const times = opt('t', '').split(',').filter(Boolean);
const viewports = opt('vp', '1440x900').split(',').map((s) => s.split('x').map(Number) as [number, number]);
const renderers = opt('r', 'auto').split(',');
const out = opt('out', 'shots');
const wait = Number(opt('wait', '1500'));
const extra = opt('q', '');
const headed = args.includes('--headed');
const reduced = args.includes('--reduced');

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !headed,
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--force-color-profile=display-p3-d65'],
});
let failures = 0;
for (const [w, h] of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: w < 600 ? 2.625 : 1,
    isMobile: w < 600,
    hasTouch: w < 600,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  for (const r of renderers) {
    for (const t of times.length ? times : ['']) {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      const q = new URLSearchParams(extra);
      if (r !== 'auto') q.set('renderer', r);
      if (t) q.set('t', t);
      const url = `${base}${path}${q.size ? `?${q}` : ''}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForTimeout(wait);
      const info = await page.evaluate(() => (window as unknown as { __jet?: unknown; __spike?: unknown }).__jet ?? (window as unknown as { __spike?: unknown }).__spike ?? null);
      const name = `${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'index'}-${w}x${h}-${r}${t ? `-t${t}` : ''}`;
      await page.screenshot({ path: `${out}/${name}.png` });
      console.log(`${name}  ${JSON.stringify(info)}`);
      for (const e of errors) console.log(`  ${e}`);
      if (errors.some((e) => !e.startsWith('warning'))) failures++;
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
if (failures) {
  console.error(`${failures} page(s) had errors`);
  process.exit(1);
}
