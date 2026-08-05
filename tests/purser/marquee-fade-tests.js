const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Test 1440px marquee fade
  await page.waitForTimeout(500);
  const marquee = await page.locator('.wd-marquee').first();
  const box = await marquee.boundingBox();
  
  if (!box) {
    throw new Error('Marquee element not found');
  }
  
  // Check for mask-image style
  const style = await page.evaluate(el => {
    return window.getComputedStyle(el).maskImage;
  }, marquee);
  
  if (!style || !style.includes('linear-gradient')) {
    throw new Error('Marquee fade mask not applied');
  }
  
  // Test 2200px marquee fade
  await page.setViewportSize({ width: 2200, height: 950 });
  await page.waitForTimeout(500);
  const marquee2 = await page.locator('.wd-marquee').first();
  const box2 = await marquee2.boundingBox();
  
  if (!box2) {
    throw new Error('Marquee element not found at 2200px');
  }
  
  const style2 = await page.evaluate(el => {
    return window.getComputedStyle(el).maskImage;
  }, marquee2);
  
  if (!style2 || !style2.includes('linear-gradient')) {
    throw new Error('Marquee fade mask not applied at 2200px');
  }
  
  await context.close();
  await browser.close();
})();