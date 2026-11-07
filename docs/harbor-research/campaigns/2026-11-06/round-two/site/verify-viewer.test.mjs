import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(import.meta.dirname, '../../../../../..');
const actualRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim();
const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim();
if (actualRoot !== root || !branch || ['main', 'master'].includes(branch) || !gitDir.includes('/worktrees/')) throw new Error('Linked feature worktree required for browser evidence writes');
const site = resolve(root, 'website-v2/public/research/war-room');
const proof = resolve(root, 'docs/harbor-research/campaigns/2026-11-06/round-two/site');
const origin = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(origin || '')) throw new Error('Explicit loopback viewer URL required');
await mkdir(proof, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const checks = [];
function check(name, passed, detail) { checks.push({ name, passed, detail }); if (!passed) throw new Error(name + ': ' + JSON.stringify(detail)); }
try {
 await page.goto(origin, { waitUntil: 'networkidle' });
 check('evidence loads', await page.locator('#evidence').isVisible(), 'Rendered JSON evidence');
 check('atomic section loads', await page.locator('#atomic-admission').isVisible(), 'Round two visible');
 check('formal receipt values rendered', (await page.locator('#atomic-model-summary').textContent()).includes('602 distinct states'), 'Finite model count');
 check('prior sources preserved', await page.locator('#source-list a').count() === 21, '21 immutable evidence links');
 await page.keyboard.press('Tab');
 check('skip link first keyboard target', await page.evaluate(() => document.activeElement.classList.contains('skip')), 'First tab');
 await page.keyboard.press('Enter');
 check('skip targets current result', new URL(page.url()).hash === '#atomic-admission', 'Current section anchor');
 await page.locator('#atomic-coverage-classes').locator('..').locator('summary').click();
 check('coverage disclosure keyboard-accessible HTML', await page.locator('#atomic-coverage-classes').isVisible(), 'Native details and summary');
 await page.locator('#atomic-coverage-classes').locator('..').locator('summary').click();
 for (const variant of [
  { name: 'desktop-light', width: 1280, height: 900, dark: false, scale: 1 },
  { name: 'desktop-dark', width: 1280, height: 900, dark: true, scale: 1 },
  { name: 'phone-light', width: 390, height: 844, dark: false, scale: 1 },
  { name: 'phone-dark', width: 390, height: 844, dark: true, scale: 1 },
  { name: 'phone-enlarged', width: 320, height: 800, dark: false, scale: 2 }
 ]) {
  await page.setViewportSize({ width: variant.width, height: variant.height });
  const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if ((currentTheme === 'dark') !== variant.dark) await page.locator('#theme').click();
  await page.evaluate(scale => { document.documentElement.style.fontSize = (scale * 100) + '%'; }, variant.scale);
  await page.locator('#atomic-admission').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  check(variant.name + ' has no horizontal overflow', dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport, dimensions);
  check(variant.name + ' retains readable body size', await page.locator('#atomic-purpose').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) >= 16, 'At least 16 CSS pixels');
  await page.screenshot({ path: resolve(proof, variant.name + '.png') });
 }
 await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
 await page.setViewportSize({ width: 1280, height: 900 });
 await page.locator('[data-team=red]').click();
 check('existing team filter works', await page.locator('.finding-columns .red').count() === 3 && await page.locator('.finding-columns .white').count() === 0, '3 attacks displayed');
 await page.locator('#document').selectOption('scout');
 check('existing advice filter works', (await page.locator('#ledger-count').textContent()).includes('of 999 preserved source units'), '999 total preserved');
 check('no browser script errors', errors.length === 0, errors);
 const files = [];
 for (const name of ['index.html', 'styles.css', 'viewer.js', 'campaign-data.json']) {
  const body = await readFile(resolve(site, name)); files.push({ file: name, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length });
 }
 const receipt = { schema: 'harbor-round-two-browser-qa/v1', status: 'passed', browser: await browser.version(), scope: 'Isolated headless Chromium against the local static viewer, not deployed production evidence. Screenshots retain the checked interface snapshot; final adjudication may subsequently update data.', checks, files };
 await writeFile(resolve(site, 'round-two-viewer-qa.json'), JSON.stringify(receipt, null, 2) + '\n');
 console.log(JSON.stringify({ status: receipt.status, checks: checks.length, file: relative(root, resolve(site, 'round-two-viewer-qa.json')) }));
} finally { await browser.close(); }
