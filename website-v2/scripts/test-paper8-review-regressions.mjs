import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(website, '..');
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
probe.close();
await once(probe, 'close');

const server = spawn(process.execPath, [path.join(repo, 'demos/swarm-telemetry-dashboard/server.js')], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(base);
      if (response.ok) break;
    } catch { /* server is starting */ }
    if (attempt === 49) throw new Error('Dashboard server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(base);
  const marker = '<img src=x onerror="window.__telemetryXss=true">';
  const response = await fetch(`${base}/api/push_action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      log: { type: marker, time: marker, text: marker },
      lease: { agent: marker, role: marker, symbol: marker, mode: marker, epoch: marker },
      epoch: { epoch: marker, r: 2, treeR: 1, L: 0.5 },
    }),
  });
  assert.equal(response.status, 200);
  await page.waitForFunction(value => document.querySelector('#log-stream')?.textContent.includes(value), marker);
  assert.equal(await page.locator('#log-stream img, #leases-tbody img, #chart-svg img').count(), 0);
  assert.equal(await page.evaluate(() => window.__telemetryXss), undefined);
  assert.equal(await page.locator('#leases-tbody').textContent().then(text => text.includes(marker)), true);
  assert.equal(await page.locator('#chart-svg circle').count(), 5, 'invalid epoch must not enter chart');

  await page.goto(pathToFileURL(path.join(website, 'public/research/sheaf-visualizer/index.html')).href);
  const undersized = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(el => el.children.length === 0 && el.textContent.trim() && getComputedStyle(el).display !== 'none')
    .map(el => ({ text: el.textContent.trim().slice(0, 35), size: parseFloat(getComputedStyle(el).fontSize) }))
    .filter(item => item.size < 14));
  assert.deepEqual(undersized, [], 'explanatory text must be at least 14px');
  console.log('Paper 8 telemetry injection and text size regressions passed');
} finally {
  await browser?.close();
  server.kill();
}
