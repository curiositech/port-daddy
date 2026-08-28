#!/usr/bin/env node

/**
 * Capture the generated Porthole harness gallery as rendered browser evidence.
 *
 * The gallery is self-contained, but it is deliberately served over HTTP for
 * capture: blob-backed casts and browser video recording should be exercised
 * exactly as a reviewer sees them, not by screenshotting source HTML.
 */
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const artifactsDir = join(repoRoot, 'docs', 'artifacts', 'porthole-harness-proof-v2');
const galleryUrl = process.argv[2] ?? 'http://127.0.0.1:4173/harness-proof-current.html';
const browserExecutable = process.env.PD_PORTHOLE_CHROMIUM || chromium.executablePath();
const viewport = { width: 1440, height: 1040 };

await mkdir(artifactsDir, { recursive: true });

function launch() {
  return chromium.launch({ executablePath: browserExecutable });
}

async function waitForScene(page, id) {
  await page.locator(`#scene-tab-${id}`).click();
  await page.waitForFunction((sceneId) => document.querySelector(`#scene-tab-${sceneId}`)?.getAttribute('aria-selected') === 'true', id);
  await page.locator('.ph-title').waitFor();
  await page.waitForTimeout(350);
}

async function openGallery(page, { reducedMotion }) {
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await page.goto(galleryUrl, { waitUntil: 'networkidle' });
  await page.locator('#scene-tab-quickstart').waitFor();
  await page.locator('.ph-title').waitFor();
  await page.waitForTimeout(350);
}

async function captureStillEvidence() {
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport });
    // The overview is a documentation still, so honor reduced motion and
    // capture the full, readable transcript instead of a blank first frame.
    await openGallery(page, { reducedMotion: true });
    await page.screenshot({ path: join(artifactsDir, 'porthole-proof-gallery.png'), fullPage: true });
    await page.close();

    const collision = await browser.newPage({ viewport });
    await openGallery(collision, { reducedMotion: false });
    await waitForScene(collision, 'collision');
    await collision.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await collision.waitForTimeout(7000);
    await collision.locator('.player-shell').screenshot({ path: join(artifactsDir, 'collision-desktop.png') });
    await collision.close();

    const settled = await browser.newPage({ viewport });
    await openGallery(settled, { reducedMotion: true });
    await waitForScene(settled, 'collision');
    await settled.locator('.ph-term').filter({ hasText: 'REFUSED' }).waitFor();
    await settled.locator('.player-shell').screenshot({ path: join(artifactsDir, 'collision-red-refusal.png') });
    await settled.close();

    const ports = await browser.newPage({ viewport });
    await openGallery(ports, { reducedMotion: true });
    await waitForScene(ports, 'ports');
    await ports.locator('.ph-term').filter({ hasText: 'Configured project:' }).waitFor();
    await ports.locator('.player-shell').screenshot({ path: join(artifactsDir, 'ports-discovery.png') });
    await ports.close();
  } finally {
    await browser.close();
  }
}

async function record(target, run) {
  const videoDir = await mkdtemp(join(homedir(), 'coding', 'tmp', 'porthole-gallery-video-'));
  const browser = await launch();
  try {
    const context = await browser.newContext({
      viewport,
      recordVideo: { dir: videoDir, size: viewport },
    });
    const page = await context.newPage();
    await run(page);
    const video = page.video();
    await context.close();
    if (!video) throw new Error(`Porthole capture produced no video for ${target}`);
    await copyFile(await video.path(), join(artifactsDir, target));
  } finally {
    await browser.close();
    await rm(videoDir, { recursive: true, force: true });
  }
}

await captureStillEvidence();

await record('porthole-proof-gallery.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'harness-next-turn');
  await page.waitForTimeout(900);
  await waitForScene(page, 'collision');
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(6500);
});

await record('collision-playback.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'collision');
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(25000);
});

console.log(`Captured Porthole proof evidence in ${artifactsDir}`);
