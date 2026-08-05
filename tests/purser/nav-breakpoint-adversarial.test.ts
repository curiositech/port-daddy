import { test, expect } from '@playwright/test';

test('Nav breakpoint transitions correctly at 1440px boundary', async ({ page }) => {
  await page.setViewportSize({ width: 1439, height: 1080 });
  await page.goto('/');
  await expect(page.locator('header button[aria-label="Open site navigation"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="Primary"]').first()).not.toBeVisible();

  await page.setViewportSize({ width: 1441, height: 1080 });
  await expect(page.locator('header button[aria-label="Open site navigation"]')).not.toBeVisible();
  await expect(page.locator('nav[aria-label="Primary"]').first()).toBeVisible();
});

test('Nav collision assertions at critical widths', async ({ page }) => {
  const widths = [1280, 1440, 1536, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('/');
    const nav = page.locator('nav[aria-label="Primary"]').first();
    const hamburger = page.locator('header button[aria-label="Open site navigation"]').first();
    const navVisible = await nav.isVisible();
    const hamburgerVisible = await hamburger.isVisible();
    
    if (width >= 1440) {
      expect(navVisible).toBe(true);
      expect(hamburgerVisible).toBe(false);
    } else {
      expect(navVisible).toBe(false);
      expect(hamburgerVisible).toBe(true);
    }
  }
});