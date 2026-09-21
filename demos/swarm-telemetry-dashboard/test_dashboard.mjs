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
    if (msg.type === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('[Playwright Test] Navigating to http://localhost:3344...');
  await page.goto('http://localhost:3344', { waitUntil: 'networkidle' });

  // 1. Verify Header Title & Scrubber
  const title = await page.textContent('h1.brand-title');
  console.log(`[Playwright Test] Found Header Title: "${title.trim()}"`);
  if (!title.includes('SwarmTelemetry')) throw new Error('Title does not contain SwarmTelemetry');

  const scrubberExists = await page.$('#epoch-slider');
  if (!scrubberExists) throw new Error('Time scrubber missing');
  console.log('[Playwright Test] Time scrubber and playback controls verified.');

  // 2. Verify Diagnosis Banner
  const diagTitle = await page.textContent('#diag-title');
  const diagLeg = await page.textContent('#diag-legibility');
  console.log(`[Playwright Test] Narrative Diagnosis: "${diagTitle.trim()}" | Legibility: "${diagLeg.trim()}"`);

  // 3. Verify Horizon 1 SVG Chart (D3.js)
  const h1Paths = await page.$$eval('#chart-svg-container path', paths => paths.length);
  const h1Circles = await page.$$eval('#chart-svg-container circle.epoch-dot', circles => circles.length);
  console.log(`[Playwright Test] Horizon 1 (D3 Invariant): ${h1Paths} paths, ${h1Circles} epoch milestone dots`);
  if (h1Paths < 3) throw new Error('Horizon 1 missing D3 area/line/tree paths');
  if (h1Circles < 5) throw new Error('Horizon 1 missing 5 milestone dots');

  // 4. Verify Horizon 2 SVG Swimlanes (D3.js)
  const tracks = await page.$$eval('#swimlane-svg-container .agent-track', el => el.length);
  const spans = await page.$$eval('#swimlane-svg-container .state-span', el => el.length);
  const causalArcs = await page.$$eval('#swimlane-svg-container .causal-arc', el => el.length);
  console.log(`[Playwright Test] Horizon 2 (D3 Causality): ${tracks} agent tracks, ${spans} activity spans, ${causalArcs} causal arcs`);
  if (tracks < 5) throw new Error('Horizon 2 missing 5 agent tracks');
  if (spans < 5) throw new Error('Horizon 2 missing activity spans');
  if (causalArcs < 4) throw new Error('Horizon 2 missing causal FIPA arcs');

  // 5. Verify Horizon 3A Simplicial Topology (D3.js Force Simulation)
  const topoNodes = await page.$$eval('#topology-svg-container .simplicial-node', el => el.length);
  const topoEdges = await page.$$eval('#topology-svg-container .simplicial-edge', el => el.length);
  const topoFaces = await page.$$eval('#topology-svg-container .simplicial-face', el => el.length);
  console.log(`[Playwright Test] Horizon 3A (D3 Topology): ${topoNodes} nodes, ${topoEdges} edges, ${topoFaces} 2-simplices`);
  if (topoNodes < 5) throw new Error('Topology missing 5 agent nodes');
  if (topoEdges < 7) throw new Error('Topology missing 7 boundary edges');
  if (topoFaces < 3) throw new Error('Topology missing 3 2-simplex faces');

  // 6. Verify Horizon 3B Lease Table & Log
  const leaseRows = await page.$$eval('#leases-tbody tr', el => el.length);
  const logLines = await page.$$eval('#terminal-log .log-line', el => el.length);
  console.log(`[Playwright Test] Horizon 3B (Contracts & Log): ${leaseRows} active leases, ${logLines} log lines`);
  if (leaseRows < 1) throw new Error('Lease table empty');
  if (logLines < 5) throw new Error('Log stream incomplete');

  // 7. Test Scrubber Interaction (Set Epoch to 2.0)
  await page.evaluate(() => {
    setEpoch(2.0);
  });
  await page.waitForTimeout(300);

  // 8. Capture Full-Page High-Density Screenshot
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
