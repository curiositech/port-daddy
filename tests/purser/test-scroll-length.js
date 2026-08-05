const { chromium } = require('playwright');
const { join } = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Get original scroll height
  const originalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  
  // Simulate scroll and check reduction
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(1000);
  const newHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  
  // 38% reduction check
  const reduction = (originalHeight - newHeight) / originalHeight;
  expect(reduction).toBeGreaterThanOrEqual(0.38);
  
  await context.close();
  await browser.close();
})();