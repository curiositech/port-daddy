import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runTest() {
  console.log('[Playwright Test] Launching headless browser...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('[Playwright Test] Navigating to http://localhost:3344...');
  await page.goto('http://localhost:3344', { waitUntil: 'networkidle' });

  // 1. Verify Page Title
  const title = await page.textContent('#main-title');
  console.log(`[Playwright Test] Found Header Title: "${title.trim()}"`);
  if (!title.includes('SwarmTelemetry')) throw new Error('Title does not contain SwarmTelemetry');

  // 2. Verify Stats Cards
  const rVal = await page.textContent('#val-residual');
  const treeVal = await page.textContent('#val-tree');
  const legVal = await page.textContent('#val-legibility');
  console.log(`[Playwright Test] Stats verified: r(t)=${rVal}, r_tree=${treeVal}, L(g)=${legVal}`);

  // 3. Verify SVG Elements
  const chartPaths = await page.$$eval('#chart-svg path', paths => paths.length);
  const chartPoints = await page.$$eval('#chart-svg circle', circles => circles.length);
  const topoLines = await page.$$eval('#topology-svg line', lines => lines.length);
  const topoNodes = await page.$$eval('#topology-svg circle', circles => circles.length);

  console.log(`[Playwright Test] SVG Chart Elements: ${chartPaths} paths, ${chartPoints} epoch points`);
  console.log(`[Playwright Test] SVG Simplicial Elements: ${topoLines} edges, ${topoNodes} agent vertices`);

  if (chartPaths < 2) throw new Error('Chart missing area/line paths');
  if (chartPoints < 5) throw new Error('Chart missing epoch points');
  if (topoNodes < 5) throw new Error('Topology missing 5 agent vertices');

  // 4. Capture Screenshot
  const shotPath = path.join(__dirname, 'screenshot_verification.png');
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`[Playwright Test] Screenshot captured to ${shotPath}`);

  if (consoleErrors.length > 0) {
    throw new Error(`Console errors detected: ${consoleErrors.join('; ')}`);
  }

  await browser.close();
  console.log('[Playwright Test] All E2E assertions passed cleanly with 0 console errors!');
}

runTest().catch(err => {
  console.error('[Playwright Test FAILED]:', err);
  process.exit(1);
});
