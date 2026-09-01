#!/usr/bin/env node

/**
 * Replays the checked-in Squid recovery cast through Port Daddy's real
 * Porthole browser player and records the motion proof as WebM.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evidenceDir, '../../..');
const galleryPath = join(repoRoot, 'docs/artifacts/porthole-harness-proof-v2/harness-proof-current.html');
const castPath = join(evidenceDir, 'squid-hook-recovery.cast');
const targetPath = join(evidenceDir, 'squid-hook-recovery.webm');
const [gallerySource, cast] = await Promise.all([
  readFile(galleryPath, 'utf8'),
  readFile(castPath, 'utf8'),
]);

const match = gallerySource.match(/(<script[^>]*id="gallery-data"[^>]*>)([\s\S]*?)(<\/script>)/);
if (!match) throw new Error('generated Porthole gallery data was not found');
const gallery = JSON.parse(match[2]);
const scene = gallery.scenes.find((candidate) => candidate.id === 'harness-next-turn');
if (!scene) throw new Error('harness-next-turn scene was not found');
Object.assign(scene, {
  label: 'Squid hook recovery',
  station: 'Giant Squid · bounded recovery',
  locus: 'Focused FleetBar decoder and renderer test',
  seed: 'One active recovery probe, then an expired marker that is recovery-ready.',
  intervention: 'Run the exact one-worker Swift snapshot test and hash both rendered states.',
  proof: 'The real test passes, writes both PNGs, and the terminal prints their SHA-256 hashes.',
  authority: 'Real test bytes over a sanitized deterministic fixture; not a live production-hook claim.',
  format: 'Porthole asciicast v3 · 100×28',
  hash: createHash('sha256').update(cast).digest('hex'),
});
gallery.casts[scene.id] = cast;
const pageHtml = gallerySource.replace(
  match[0],
  `${match[1]}${JSON.stringify(gallery).replaceAll('<', '\\u003c')}${match[3]}`,
);

const server = createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/squid-hook-recovery-porthole.html') {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(pageHtml);
});
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Porthole proof server did not bind a TCP port');

const videoDir = await mkdtemp(join(homedir(), 'coding', 'tmp', 'squid-porthole-video-'));
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.PD_PORTHOLE_CHROMIUM || chromium.executablePath(),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 1040 } },
  });
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`http://127.0.0.1:${address.port}/squid-hook-recovery-porthole.html`, {
    waitUntil: 'networkidle',
  });
  await page.locator('#scene-tab-harness-next-turn').click();
  await page.locator('.ph-title').waitFor();
  await page.addStyleTag({ content: `
    body { overflow: hidden !important; }
    .page { width: min(100% - 32px, 1400px) !important; padding: 16px 0 !important; }
    .page > * { display: none !important; }
    .page > .brief { display: grid !important; margin-bottom: 14px !important; }
    .page > .player-shell { display: block !important; }
    .legend { display: none !important; }
    .ph-term { max-height: 610px !important; }
  ` });
  await page.locator('.ph-speed-chip', { hasText: '2×' }).click();
  await page.waitForTimeout(10_500);
  const video = page.video();
  await context.close();
  if (!video) throw new Error('Porthole capture produced no video');
  await copyFile(await video.path(), targetPath);
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(videoDir, { recursive: true, force: true });
}

console.log(targetPath);
