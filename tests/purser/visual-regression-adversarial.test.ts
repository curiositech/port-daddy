import { test, expect } from '@playwright/test';

test('Visual regression checks for critical components', async ({ page }) => {
  const testCases = [
    { path: '/', label: 'home' },
    { path: '/docs', label: 'docs' },
    { path: '/docs/features/fleet', label: 'fleet-feature' },
  ];

  for (const { path, label } of testCases) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    
    // Check header controls
    const headerControls = await page.locator('nav[aria-label="Primary"], header [data-account-chip], header [data-search-trigger], header a[aria-label="Open GitHub repository"], header button[aria-label="Toggle color theme"], header button[aria-label="Open site navigation"]').all();
    expect(headerControls.length).toBeGreaterThan(0);
    
    // Check for horizontal overflow
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    
    // Take screenshot for visual verification
    await page.screenshot({ path: `visual-regression-${label}.png`, fullPage: true });
  }
});