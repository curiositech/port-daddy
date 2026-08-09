/**
 * Render + capture the relay trust page (/trust — doctrine D8's
 * crypto/policy/unbuilt table; src/trust-page.ts), the D9 client half that
 * ships in the same PR as the blind-sessions substrate.
 *
 * Screenshots are only evidence if they come from the SAME renderer the Worker
 * serves, so this imports {@link renderTrustPage} directly rather than
 * hand-writing HTML. The page commits to a single dark theme
 * (`color-scheme: dark`), so one capture is the honest matrix — no light twin
 * to break.
 *
 * Run with: npx vite-node scripts/shoot-trust-page.mts [outDir]
 *   outDir defaults to ../.artifacts; pass an absolute dir to capture elsewhere.
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH; this never installs a browser.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { renderTrustPage } from '../src/trust-page.js';

const outDir = process.argv[2] ?? new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(outDir, { recursive: true });

const htmlPath = join(outDir, 'trust.html');
writeFileSync(htmlPath, renderTrustPage('v0-test'));

const viewports = [
  { label: '1440', width: 1440, height: 1200 },
  { label: '390', width: 390, height: 1400 },
];

const browser = await chromium.launch();
for (const vp of viewports) {
  const ctx = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  const path = join(outDir, `trust-dark-${vp.label}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`shot ${path}`);
  await ctx.close();
}
await browser.close();
