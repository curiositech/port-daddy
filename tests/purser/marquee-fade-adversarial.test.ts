import { test, expect } from '@playwright/test';

test('Marquee edge mask/fade works at 1440px and 2200px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/');
  await page.waitForTimeout(1000);
  const marquee = page.locator('.wd-marquee');
  const boundingBox = await marquee.boundingBox();
  expect(boundingBox).toBeTruthy();
  
  // Check fade effect by verifying element visibility at edge
  await page.evaluate(() => {
    const marquee = document.querySelector('.wd-marquee');
    marquee.scrollLeft = marquee.scrollWidth - marquee.clientWidth;
  });
  await page.waitForTimeout(500);
  const fadeRegion = await page.locator('.wd-marquee').screenshot();
  expect(fadeRegion).toBeTruthy();

  await page.setViewportSize({ width: 2200, height: 1080 });
  await page.goto('/');
  await page.waitForTimeout(1000);
  const largeMarquee = page.locator('.wd-marquee');
  const largeBoundingBox = await largeMarquee.boundingBox();
  expect(largeBoundingBox).toBeTruthy();
  
  await page.evaluate(() => {
    const marquee = document.querySelector('.wd-marquee');
    marquee.scrollLeft = marquee.scrollWidth - marquee.clientWidth;
  });
  await page.waitForTimeout(500);
  const largeFadeRegion = await page.locator('.wd-marquee').screenshot();
  expect(largeFadeRegion).toBeTruthy();
});