const { chromium } = require('playwright');
const { join } = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Test 1: 1440px should show marquee fade
  const marquee = page.locator('.wd-marquee');
  const mask = await marquee.getAttribute('style');
  expect(mask).toContain('mask-image');
  
  // Test 2: 2200px should show fade at edge
  await page.setViewportSize({ width: 2200, height: 950 });
  const largeMarquee = page.locator('.wd-marquee');
  const largeMask = await largeMarquee.getAttribute('style');
  expect(largeMask).toContain('mask-image');
  
  // Test 3: 390px (mobile) should not show fade (no marquee)
  await page.setViewportSize({ width: 390, height: 950 });
  const mobileMarquee = page.locator('.wd-marquee');
  const mobileMask = await mobileMarquee.getAttribute('style');
  expect(mobileMask).not.toContain('mask-image');
  
  await context.close();
  await browser.close();
})();