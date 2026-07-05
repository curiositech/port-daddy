#!/usr/bin/env node
/**
 * Repro test for the Scout region-capture flow.
 *
 * It uses Playwright's bundled Chromium because Google Chrome no longer accepts
 * the command-line side-load flags needed for automated extension tests.
 *
 * Run:
 *   node apps/pd-scout-extension/tests/scout-region-repro.mjs
 *
 * Optional:
 *   PD_SCOUT_HEADLESS=1 node apps/pd-scout-extension/tests/scout-region-repro.mjs
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const repoRoot = resolve(new URL('../../../', import.meta.url).pathname);
const sourceExtensionDir = join(repoRoot, 'apps/pd-scout-extension');
const artifactsDir = join(sourceExtensionDir, 'docs/artifacts/chrome-visual-task-intake');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function prepareExtensionDir(profileDir) {
  const extensionDir = join(profileDir, 'extension');
  cpSync(sourceExtensionDir, extensionDir, { recursive: true });

  // The product manifest stays narrow: activeTab + localhost. This repro drives
  // the background worker directly because Playwright cannot click Chrome's
  // toolbar action, so the temp manifest gets explicit page capture authority.
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), '<all_urls>']));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return extensionDir;
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

async function startFixtureApp() {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Scout Fixture App</title>
          <style>
            body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #f7f7f4; color: #18191c; }
            main { padding: 64px; }
            .shell { border: 2px solid #18191c; background: white; min-height: 560px; display: grid; grid-template-columns: 220px 1fr; }
            nav { border-right: 2px solid #18191c; padding: 24px; }
            nav div { height: 16px; margin-bottom: 16px; background: #d6d9de; }
            section { padding: 36px; }
            #broken-card { border: 2px solid #2f7df6; padding: 28px; width: 520px; background: #eef5ff; }
            h1 { margin: 0 0 18px; font-size: 36px; line-height: 1.05; }
            p { width: 42ch; line-height: 1.5; }
            button { margin-top: 18px; padding: 12px 16px; background: #2f7df6; color: white; border: 0; font-weight: 800; }
          </style>
        </head>
        <body>
          <main>
            <div class="shell">
              <nav aria-label="Fixture navigation"><div></div><div></div><div></div><div></div></nav>
              <section id="broken-card" data-testid="broken-card">
                <h1>Checkout panel</h1>
                <p data-testid="copy">This region is intentionally used for Scout rectangle and DOM capture.</p>
                <button aria-label="Save work" data-testid="save-work">Save work</button>
              </section>
            </div>
          </main>
        </body>
      </html>`);
  });
  const url = await listen(server);
  return { server, url };
}

async function startMockDaemon() {
  const visualTasks = [];
  const blobs = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/projects') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        count: 1,
        projects: [{
          id: 'port-daddy',
          displayName: 'port-daddy',
          root: repoRoot,
          type: 'node',
          serviceCount: 1,
          sources: ['test'],
          exists: true,
          configuredAgentCount: 0,
          configuredWatcherCount: 0,
        }],
      }));
      return;
    }

    if (req.method === 'POST' && req.url === '/blob') {
      const body = await readBody(req);
      const id = createHash('sha256').update(body).digest('hex');
      const contentType = req.headers['content-type'] || 'application/octet-stream';
      blobs.set(id, { body, contentType });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, blob: { id, size: body.length, contentType } }));
      return;
    }

    if (req.method === 'POST' && req.url === '/visual-tasks') {
      const body = JSON.parse((await readBody(req)).toString('utf8'));
      visualTasks.push(body);
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        task: body,
        issue: {
          id: 'visual-task-preview',
          kind: 'port-daddy-work-item',
          title: body.title,
          status: 'opened',
          workItemSlug: 'scout-preview-region-repro',
        },
        screenshot: body.image?.blobId ? { url: body.image.blobUrl } : undefined,
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'not found' }));
  });
  const url = await listen(server);
  return { server, url, visualTasks, blobs };
}

async function extensionIdFor(context) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return new URL(worker.url()).host;
}

async function waitForComposer(context, extensionId) {
  const existing = context.pages().find((page) => page.url().startsWith(`chrome-extension://${extensionId}/popup.html?capture=region`));
  if (existing) return existing;
  return context.waitForEvent('page', {
    predicate: (page) => page.url().startsWith(`chrome-extension://${extensionId}/popup.html?capture=region`),
    timeout: 10_000,
  });
}

async function screenshotPanel(page, filename) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const panelBox = await page.locator('.panel').boundingBox();
  await page.screenshot({
    path: join(artifactsDir, filename),
    clip: panelBox
      ? {
          x: Math.floor(panelBox.x),
          y: Math.floor(panelBox.y),
          width: Math.ceil(panelBox.width),
          height: Math.ceil(panelBox.height),
        }
      : undefined,
    fullPage: !panelBox,
  });
}

async function main() {
  const app = await startFixtureApp();
  const daemon = await startMockDaemon();
  const profileDir = mkdtempSync(join(tmpdir(), 'pd-scout-repro-'));
  const headless = process.env.PD_SCOUT_HEADLESS === '1';
  let context;

  try {
    const extensionDir = prepareExtensionDir(profileDir);
    context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1280, height: 820 },
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });
    const extensionId = await extensionIdFor(context);
    const page = await context.newPage();
    await page.goto(app.url);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.fill('#daemonUrl', daemon.url);
    await popup.dispatchEvent('#daemonUrl', 'change');
    await popup.waitForFunction(
      (root) => Array.from(document.querySelectorAll('#projectChoice option')).some((option) => option.value === root),
      repoRoot,
    );
    await popup.selectOption('#projectChoice', repoRoot);
    await popup.evaluate(() => new Promise((resolveSet) => {
      chrome.storage.local.set({
        pdScoutDaemonUrl: document.querySelector('#daemonUrl').value,
        pdScoutProjectDir: document.querySelector('#projectChoice').value,
        pdScoutAssignee: 'review-queue',
        pdScoutStartAgent: false,
      }, resolveSet);
    }));

    await page.bringToFront();
    await popup.evaluate(() => new Promise((resolveMessage) => {
      chrome.runtime.sendMessage({ type: 'pd-scout-start-selection' }, resolveMessage);
    }));

    await page.mouse.move(320, 210);
    await page.mouse.down();
    await page.mouse.move(865, 520);
    await page.mouse.up();
    await page.waitForFunction(() => Boolean(document.querySelector('#pd-scout-capture-confirmation-host')));

    const composer = await waitForComposer(context, extensionId);
    await composer.waitForLoadState('domcontentloaded');
    await composer.waitForSelector('#capturePreviewImage[src^="data:image/png"]', { timeout: 10_000 });
    await composer.waitForFunction(() => !document.querySelector('#captureRegionBox').hidden);
    await composer.waitForFunction(() => document.querySelectorAll('#domSummary li').length > 0);
    await screenshotPanel(composer, 'scout-region-repro-composer-captured.png');
    await composer.fill('#brief', 'Scout preview repro: selected a broken checkout panel rectangle.');
    await composer.click('#submitIssue');
    await composer.waitForFunction(() => document.querySelector('#message')?.textContent?.includes('Opened'));

    assert(daemon.visualTasks.length === 1, 'expected one visual task submission');
    const task = daemon.visualTasks[0];
    assert(task.image?.blobUrl?.startsWith('/blob/'), 'expected blob-backed screenshot evidence');
    assert(!task.image?.dataUrl, 'visual task JSON must not include inline dataUrl');
    assert(task.region?.width > 100 && task.region?.height > 100, 'expected selected region dimensions');
    assert(task.domContext?.elementsInRegion?.length > 0, 'expected DOM decomposition in visual task');
    assert(task.projectDir === repoRoot, 'expected projectDir from daemon project picker');

    await screenshotPanel(composer, 'scout-region-repro-composer.png');
    console.log('Scout region repro passed');
  } finally {
    await context?.close();
    await close(app.server);
    await close(daemon.server);
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
