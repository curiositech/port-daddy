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
const mainHarnessUrl = process.argv[3];
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

    const threePartyParley = await browser.newPage({ viewport });
    await openGallery(threePartyParley, { reducedMotion: true });
    await threePartyParley.locator('#parley-three-party').waitFor();
    await threePartyParley.locator('#parley-three-party').screenshot({
      path: join(artifactsDir, 'parley-three-party.png'),
    });
    await threePartyParley.close();

    const mobileThreePartyParley = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openGallery(mobileThreePartyParley, { reducedMotion: true });
    await mobileThreePartyParley.locator('#parley-three-party').waitFor();
    await mobileThreePartyParley.locator('#parley-three-party').screenshot({
      path: join(artifactsDir, 'parley-three-party-mobile.png'),
    });
    await mobileThreePartyParley.close();

    const liveParley = await browser.newPage({ viewport });
    await openGallery(liveParley, { reducedMotion: false });
    await waitForScene(liveParley, 'parley-source');
    await liveParley.locator('.ph-speed-chip', { hasText: '2×' }).click();
    // Capture before tmux exits its alternate screen so all four panes remain
    // visible, but after the witness has observed every durable turn.
    await liveParley.locator('.ph-term').filter({ hasText: 'CAUGHT UP · 6 durable turns' }).waitFor();
    await liveParley.locator('.player-shell').screenshot({
      path: join(artifactsDir, 'parley-live-tmux.png'),
    });
    await liveParley.close();

    const paneScrollback = await browser.newPage({ viewport });
    await openGallery(paneScrollback, { reducedMotion: true });
    await waitForScene(paneScrollback, 'parley-source');
    await paneScrollback.locator('#parley-pane-inspector').waitFor();
    await paneScrollback.locator('#pane-history-nora').evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight / 2);
    });
    await paneScrollback.locator('#parley-pane-inspector').screenshot({
      path: join(artifactsDir, 'parley-pane-scrollback.png'),
    });
    await paneScrollback.close();

    const mobileLiveParley = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openGallery(mobileLiveParley, { reducedMotion: false });
    await waitForScene(mobileLiveParley, 'parley-source');
    await mobileLiveParley.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await mobileLiveParley.locator('.ph-term').filter({ hasText: 'CAUGHT UP · 6 durable turns' }).waitFor();
    await mobileLiveParley.locator('.player-shell').screenshot({
      path: join(artifactsDir, 'parley-live-tmux-mobile.png'),
    });
    await mobileLiveParley.close();

    const mobilePaneScrollback = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await openGallery(mobilePaneScrollback, { reducedMotion: true });
    await waitForScene(mobilePaneScrollback, 'parley-source');
    await mobilePaneScrollback.locator('#parley-pane-inspector').waitFor();
    await mobilePaneScrollback.locator('#pane-history-nora').evaluate((element) => {
      element.scrollTop = Math.floor(element.scrollHeight / 2);
    });
    await mobilePaneScrollback.locator('#parley-pane-inspector').screenshot({
      path: join(artifactsDir, 'parley-pane-scrollback-mobile.png'),
    });
    await mobilePaneScrollback.close();

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

    const harnessContext = await browser.newPage({ viewport });
    await openGallery(harnessContext, { reducedMotion: true });
    await waitForScene(harnessContext, 'harness-next-turn');
    await harnessContext.locator('.ph-term').filter({ hasText: 'PORT DADDY HARNESS' }).waitFor();
    await harnessContext.locator('.player-shell').screenshot({
      path: join(artifactsDir, 'harness-context.png'),
    });
    await harnessContext.close();

    const brokenWatch = await browser.newPage({ viewport });
    await openGallery(brokenWatch, { reducedMotion: false });
    await waitForScene(brokenWatch, 'visibility');
    await brokenWatch.locator('.ph-cut-marker').click();
    await brokenWatch.locator('.ph-cut-notice').waitFor();
    await brokenWatch.locator('.player-shell').screenshot({
      path: join(artifactsDir, 'visibility-broken-axis.png'),
    });
    await brokenWatch.close();

    const portsConfiguration = await browser.newPage({ viewport });
    await openGallery(portsConfiguration, { reducedMotion: true });
    await waitForScene(portsConfiguration, 'ports');
    const configurationTerminal = portsConfiguration.locator('.ph-term');
    await configurationTerminal.evaluate((element) => { element.scrollTop = 0; });
    await portsConfiguration.getByText('Configured project: porthole-service-proof', { exact: false }).waitFor();
    await portsConfiguration.locator('.player-shell').screenshot({
      path: join(artifactsDir, 'ports-configuration-registration.png'),
    });
    await portsConfiguration.close();

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

async function captureMainHarnessStill() {
  if (!mainHarnessUrl) return;

  async function waitForMainHarnessParley(page) {
    const primary = page.locator('#parley-primary-proof');
    await primary.waitFor();
    await primary.scrollIntoViewIfNeeded();
    // PortholeEmbed is intersection-gated on the main site. Waiting for the
    // section alone can capture the lazy placeholder before the cast mounts.
    await primary.locator('.ph-title').waitFor();
    await primary.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await primary.locator('.ph-term').filter({ hasText: 'DECISION PATH (6)' }).waitFor();
    await page.waitForTimeout(350);
    return primary;
  }

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(mainHarnessUrl, { waitUntil: 'domcontentloaded' });
    const section = await waitForMainHarnessParley(page);
    await page.addStyleTag({
      content: 'header.sticky,.fixed.bottom-4.right-4{display:none!important}',
    });
    await section.screenshot({
      path: join(artifactsDir, 'harness-page-parley.png'),
    });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.emulateMedia({ reducedMotion: 'no-preference' });
    await mobile.goto(mainHarnessUrl, { waitUntil: 'domcontentloaded' });
    const mobileSection = await waitForMainHarnessParley(mobile);
    await mobile.addStyleTag({
      content: 'header.sticky,.fixed.bottom-4.right-4{display:none!important}',
    });
    await mobileSection.screenshot({
      path: join(artifactsDir, 'harness-page-parley-mobile.png'),
    });
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
await captureMainHarnessStill();

await record('porthole-proof-gallery.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'harness-next-turn');
  await page.waitForTimeout(900);
  await waitForScene(page, 'collision');
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(6500);
  await waitForScene(page, 'parley');
  await page.waitForTimeout(1600);
  await waitForScene(page, 'parley-source');
  await page.waitForTimeout(2400);
  await page.locator('#parley-three-party').scrollIntoViewIfNeeded();
  await page.waitForTimeout(2400);
});

await record('collision-playback.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'collision');
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(25000);
});

await record('parley-live-tmux.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'parley-source');
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(18000);
});

await record('parley-pane-scrollback.webm', async (page) => {
  await openGallery(page, { reducedMotion: false });
  await waitForScene(page, 'parley-source');
  const inspector = page.locator('#parley-pane-inspector');
  await inspector.scrollIntoViewIfNeeded();
  const nora = page.locator('#pane-history-nora');
  const milo = page.locator('#pane-history-milo');
  await nora.hover();
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Jump Nora tmux pane scrollback to latest' }).click();
  await page.waitForTimeout(900);
  await milo.hover();
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(1200);
});

if (mainHarnessUrl) {
  await record('harness-page-parley.webm', async (page) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(mainHarnessUrl, { waitUntil: 'domcontentloaded' });
    const workbench = page.locator('#proof-workbench');
    await workbench.waitFor();
    await workbench.scrollIntoViewIfNeeded();
    await workbench.locator('.ph-title').waitFor();
    await workbench.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await page.waitForTimeout(4200);

    await page.getByRole('button', { name: /06 · shared decision/i }).click();
    await workbench.locator('.ph-title', { hasText: 'A plan changes under three distinct roles.' }).waitFor();
    await workbench.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await page.waitForTimeout(4200);

    const primary = page.locator('#parley-primary-proof');
    await primary.scrollIntoViewIfNeeded();
    await primary.locator('.ph-title').waitFor();
    await primary.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await primary.locator('.ph-term').filter({ hasText: 'DECISION PATH (6)' }).waitFor();
    await page.waitForTimeout(1800);

    const drillDown = page.locator('#parley-tmux-replay');
    await drillDown.scrollIntoViewIfNeeded();
    await drillDown.locator('.ph-title').waitFor();
    await drillDown.locator('.ph-speed-chip', { hasText: '2×' }).click();
    await drillDown.locator('.ph-term').filter({ hasText: 'CAUGHT UP · 6 durable turns' }).waitFor();
    await page.waitForTimeout(1200);

    const nora = page.locator('#pane-history-nora');
    await nora.scrollIntoViewIfNeeded();
    await nora.hover();
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Jump Nora tmux pane scrollback to latest' }).click();
    await page.waitForTimeout(900);
  });
}

console.log(`Captured Porthole proof evidence in ${artifactsDir}`);
