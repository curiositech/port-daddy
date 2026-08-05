import { test, expect } from '@playwright/test';

test('Horizontal layout overflow checks', async ({ page }) => {
  const widths = [1280, 1440, 1536, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  }
});

test('Search box overflow prevention at 1536px', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1080 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  const searchBox = await page.locator('header [data-search-trigger]').first();
  const boundingBox = await searchBox.boundingBox();
  expect(boundingBox).toBeTruthy();
  
  // Check that search box doesn't overflow into nav
  const nav = await page.locator('nav[aria-label="Primary"]').first();
  const navBox = await nav.boundingBox();
  expect(boundingBox.x + boundingBox.width).toBeLessThan(navBox.x);
});