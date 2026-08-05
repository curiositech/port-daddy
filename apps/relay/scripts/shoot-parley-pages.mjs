/**
 * Capture the rendered parley pages in light + dark at 1440 and 390.
 *
 * Motivation: the pages theme themselves purely with `prefers-color-scheme`
 * (there is no toggle — this surface ships no JS), and they carry a mobile
 * breakpoint at 720px. Those are exactly the two axes that can silently break,
 * so the capture matrix is both of them crossed, not a single hero shot.
 *
 * Run after scripts/render-parley-pages.mts. Chromium comes from
 * PLAYWRIGHT_BROWSERS_PATH; this never installs a browser.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const pages = [
  { name: 'list', file: `${OUT}parley-list.html` },
  { name: 'detail', file: `${OUT}parley-detail.html` },
];
const viewports = [
  { label: '1440', width: 1440, height: 1100 },
  { label: '390', width: 390, height: 900 },
];
const schemes = ['light', 'dark'];

const browser = await chromium.launch();
for (const scheme of schemes) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(`file://${p.file}`, { waitUntil: 'load' });
      // Fonts are remote (blocked offline); give layout a beat to settle.
      await page.waitForTimeout(250);
      const path = `${OUT}parley-${p.name}-${scheme}-${vp.label}.png`;
      await page.screenshot({ path, fullPage: true });
      console.log(`shot ${path}`);
    }
    await ctx.close();
  }
}
await browser.close();
