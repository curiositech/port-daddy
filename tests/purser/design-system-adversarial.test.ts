import { test, expect } from '@playwright/test';

const SIBLING_PAGES = [
  '/docs/features/dns',
  '/docs/features/harbors',
  '/docs/features/ports',
  '/docs/features/avatars',
  '/docs/features/arbiter',
  '/docs/features/tuples',
  '/docs/features/pheromone',
  '/docs/features/remote',
  '/docs/features/relay-pki',
];

test('Design system tokens applied consistently across sibling pages', async ({ page }) => {
  for (const path of SIBLING_PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    
    // Check for fractional linework tokens
    const lineworkToken = await page.locator(':hover').first().getAttribute('style');
    expect(lineworkToken).toContain('--lw-');
    
    // Check for section head styling
    const sectionHeads = await page.locator('.lw-sect-head').all();
    expect(sectionHeads.length).toBeGreaterThan(0);
    
    // Check for color-mix wells
    const colorMixWells = await page.locator('.color-mix').all();
    expect(colorMixWells.length).toBeGreaterThan(0);
  }
});

test('Special case handling for pages with unique elements', async ({ page }) => {
  // Test Arbiter page badges
  await page.goto('/docs/features/arbiter');
  await page.waitForLoadState('networkidle');
  const badges = await page.locator('.badge').all();
  expect(badges.length).toBeGreaterThan(0);
  
  // Test Avatars page Next-box
  await page.goto('/docs/features/avatars');
  await page.waitForLoadState('networkidle');
  const nextBox = await page.locator('div[role="region"]').first();
  expect(await nextBox.isVisible()).toBe(true);
  
  // Test RelayPki card grid
  await page.goto('/docs/features/relay-pki');
  await page.waitForLoadState('networkidle');
  const cardGrid = await page.locator('.card-grid').first();
  expect(await cardGrid.isVisible()).toBe(true);
});