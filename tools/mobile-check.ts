// Load the site as an emulated phone and report what the renderer did.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome' });
for (const opts of [
  { isMobile: false },
  { isMobile: true },
  { isMobile: true, hasTouch: true, deviceScaleFactor: 3.5 },
]) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, ...opts });
  const logs: string[] = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.stack}`));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    cls: document.documentElement.className,
    jet: (window as unknown as { __jet?: unknown }).__jet ?? null,
  }));
  console.log(JSON.stringify(opts), JSON.stringify(state).slice(0, 300));
  for (const l of logs.filter((l) => !l.includes('jet.tf'))) console.log('  ', l);
  await page.close();
}
await browser.close();
