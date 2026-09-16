/**
 * Capture the rendered MERCY report card in light + dark at 1440 and 390
 * (grand-plan DAG node x7-mercy-hooks — the per-feature hooks panel).
 *
 * Same matrix and rationale as shoot-parley-pages.mjs: the page themes itself
 * purely with `prefers-color-scheme` and breaks at 720px, so both axes are
 * captured. Run after scripts/render-mercy-page.mts. Chromium comes from
 * PLAYWRIGHT_BROWSERS_PATH; this never installs a browser.
 */

import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const OUT = new URL('../.artifacts/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const pages = [{ name: 'mercy-report', file: `${OUT}mercy-report.html` }];
const viewports = [
  { label: '1440', width: 1440, height: 1400 },
  { label: '390', width: 390, height: 1200 },
];
const schemes = ['light', 'dark'];

const browser = await chromium.launch();
for (const scheme of schemes) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: vp.width, height: vp.height },
    });
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(`file://${p.file}`);
      await page.screenshot({ path: `${OUT}${p.name}-${scheme}-${vp.label}.png`, fullPage: true });
      console.log(`shot ${p.name}-${scheme}-${vp.label}.png`);
    }
    await ctx.close();
  }
}

const videoTmp = `${OUT}video-tmp`;
rmSync(videoTmp, { recursive: true, force: true });
mkdirSync(videoTmp, { recursive: true });
const videoCtx = await browser.newContext({
  colorScheme: 'light',
  viewport: { width: 390, height: 844 },
  recordVideo: {
    dir: videoTmp,
    size: { width: 390, height: 844 },
  },
});
const videoPage = await videoCtx.newPage();
await videoPage.goto(`file://${pages[0].file}`);
for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
  await videoPage.evaluate((scrollRatio) => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll * scrollRatio, behavior: 'smooth' });
  }, ratio);
  await videoPage.waitForTimeout(450);
}
const video = videoPage.video();
await videoCtx.close();
await video?.saveAs(`${OUT}mercy-report-light-390-scroll.webm`);
rmSync(videoTmp, { recursive: true, force: true });
console.log('shot mercy-report-light-390-scroll.webm');

await browser.close();
