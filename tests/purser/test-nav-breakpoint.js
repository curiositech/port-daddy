const { chromium } = require('playwright');
const { join } = require('path');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Test 1: 1439px (below breakpoint) should show hamburger
  await page.setViewportSize({ width: 1439, height: 950 });
  const hamburger = page.locator('header button[aria-label="Open site navigation"]').first();
  const inlineNav = page.locator('nav[aria-label="Primary"]').first();
  await expect(await hamburger.isVisible()).toBe(true);
  await expect(await inlineNav.isVisible()).toBe(false);
  
  // Test 2: 1441px (above breakpoint) should show inline nav
  await page.setViewportSize({ width: 1441, height: 950 });
  await expect(await inlineNav.isVisible()).toBe(true);
  await expect(await hamburger.isVisible()).toBe(false);
  
  // Test 3: 1536px (previous breakpoint) should show inline nav
  await page.setViewportSize({ width: 1536, height: 950 });
  await expect(await inlineNav.isVisible()).toBe(true);
  
  // Test 4: 1280px (mobile) should show hamburger
  await page.setViewportSize({ width: 1280, height: 950 });
  await expect(await hamburger.isVisible()).toBe(true);
  
  await context.close();
  await browser.close();
})();