'use strict';

// Test a fresh browser context; never use the operator's browser profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const site = path.resolve(process.argv[2] || '.scratch/visual-atlas/site/index.html');
  const temporaryRoot = path.resolve(process.env.ATLAS_TEST_TMP ||
    path.join(os.homedir(), 'coding/tmp/book-atlas-browser-tests'));
  const allowedRoot = path.join(os.homedir(), 'coding/tmp') + path.sep;
  assert(temporaryRoot.startsWith(allowedRoot), 'Browser scratch must be under ~/coding/tmp/');
  fs.mkdirSync(temporaryRoot, { recursive: true });
  assert(fs.realpathSync(temporaryRoot).startsWith(fs.realpathSync(allowedRoot) + path.sep),
    'Browser scratch must resolve under ~/coding/tmp/');
  process.env.TMPDIR = temporaryRoot;
  process.env.TMP = temporaryRoot;
  process.env.TEMP = temporaryRoot;
  assert(fs.statSync(site).isFile(), 'Build the digest-bound atlas site before testing.');

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_EXECUTABLE,
      timeout: 30000,
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(10000);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(site).href);
    await page.waitForSelector('.work');
    assert(await page.locator('.work').count() <= 48, 'Initial rendering must be bounded.');
    assert.equal(await page.locator('.work').evaluateAll(
      nodes => nodes.some(node => node.textContent.includes('Audit only'))
    ), false, 'Audit fragments must be hidden by default.');
    assert.match(await page.locator('.scores').first().textContent(), /Quality \/100/);
    const broken = await page.locator('img').evaluateAll(
      images => images.filter(image => image.complete && !image.naturalWidth).map(image => image.src)
    );
    assert.deepEqual(broken, [], 'Loaded previews must resolve.');

    await page.locator('[data-select]').nth(0).check();
    await page.locator('[data-select]').nth(1).check();
    await page.click('#compare');
    assert(await page.locator('dialog').isVisible());
    assert.equal(await page.locator('.compare-grid article').count(), 2);
    await page.click('#close');
    await page.locator('[data-inspect]').first().click();
    assert(await page.locator('#dialog-body h3').filter({ hasText: 'Purpose' }).count());
    assert.equal(await page.locator('.dimension-table tbody tr').count(), 8);
    await page.locator('[name=aesthetic]').fill('82');
    await page.locator('[name=information]').fill('78');
    await page.locator('[name=notes]').fill('Test decision');
    await page.locator('#decision').evaluate(form => form.requestSubmit());
    assert.match(await page.locator('#decision-status').textContent(), /saved/);
    await page.click('#close');
    await page.reload();
    assert(await page.evaluate(() => Object.values(AtlasReview.getState().overrides)
      .some(override => override.notes === 'Test decision' &&
        override.aesthetic === 82 && override.information === 78)));
    await page.evaluate(() => {
      let rejected = false;
      try {
        AtlasReview.validate({ schemaVersion: 1, pdfSha256: 'wrong', overrides: {}, order: [] });
      } catch {
        rejected = true;
      }
      if (!rejected) throw Error('SHA mismatch accepted');
    });
    await page.locator('#types button').nth(1).click();
    await page.selectOption('#sort', 'manual');
    const before = await page.locator('.work').evaluateAll(nodes => nodes.map(node => node.dataset.id));
    if (before.length > 1) {
      await page.locator('[data-move="1"]').first().click();
      const after = await page.locator('.work').evaluateAll(nodes => nodes.map(node => node.dataset.id));
      assert.equal(after[1], before[0]);
    }
    for (const width of [1280, 1100, 860, 720, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'Overflow at width ' + width);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: previews, comparison, eight review dimensions, score/notes persistence, ' +
      'PDF digest rejection, manual reorder, responsive widths; no page errors.');
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
