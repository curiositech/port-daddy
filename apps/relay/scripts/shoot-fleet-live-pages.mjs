/**
 * Capture the production-rendered Cloud Fleet pages and live-state animation.
 *
 * The matrix crosses light/dark and desktop/mobile. The GIF advances the same
 * receipt from queued to running to success, proving the state hierarchy and
 * bounded-refresh surface without adding client JavaScript to production.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ARTIFACTS = new URL('../.artifacts/', import.meta.url).pathname;
const OUT = new URL('../docs/artifacts/cloud-fleet-live/', import.meta.url).pathname;
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [
  { input: 'fleet-account.html', output: 'account-runs-light-1440.png', scheme: 'light', width: 1440, height: 1000 },
  { input: 'fleet-account.html', output: 'account-runs-dark-390.png', scheme: 'dark', width: 390, height: 900 },
  { input: 'fleet-receipt-running.html', output: 'receipt-running-dark-1440.png', scheme: 'dark', width: 1440, height: 1000 },
  { input: 'fleet-receipt-retrying.html', output: 'receipt-provider-retry-dark-1440.png', scheme: 'dark', width: 1440, height: 1000 },
  { input: 'fleet-receipt-provider-neutral.html', output: 'receipt-provider-outage-neutral-dark-1440.png', scheme: 'dark', width: 1440, height: 1000 },
  { input: 'fleet-receipt-queued.html', output: 'receipt-queued-light-390.png', scheme: 'light', width: 390, height: 900 },
];

for (const shot of shots) {
  const context = await browser.newContext({
    colorScheme: shot.scheme,
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(`${ARTIFACTS}${shot.input}`).href, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}${shot.output}`, fullPage: true });
  await context.close();
  console.log(`shot ${OUT}${shot.output}`);
}

const liveInputs = [
  'fleet-receipt-queued.html',
  'fleet-receipt-retrying.html',
  'fleet-receipt-running.html',
  'fleet-receipt-success.html',
];
const liveContext = await browser.newContext({
  colorScheme: 'dark',
  viewport: { width: 1280, height: 820 },
  deviceScaleFactor: 1,
});
const livePage = await liveContext.newPage();
for (let i = 0; i < liveInputs.length; i += 1) {
  await livePage.goto(pathToFileURL(`${ARTIFACTS}${liveInputs[i]}`).href, { waitUntil: 'load' });
  await livePage.waitForTimeout(250);
  await livePage.screenshot({
    path: `${ARTIFACTS}fleet-live-frame-${String(i + 1).padStart(2, '0')}.png`,
    fullPage: false,
  });
}
await liveContext.close();
await browser.close();

execFileSync('/opt/homebrew/bin/ffmpeg', [
  '-y',
  '-framerate', '0.65',
  '-i', `${ARTIFACTS}fleet-live-frame-%02d.png`,
  '-vf', 'fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
  '-loop', '0',
  `${OUT}live-progress.gif`,
], { stdio: 'inherit' });

console.log(`animated ${OUT}live-progress.gif`);
