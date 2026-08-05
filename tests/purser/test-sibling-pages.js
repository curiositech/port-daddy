const { chromium } = require('playwright');

const SIBLING_PAGES = [
  '/docs/features/dns',
  '/docs/features/arbiter',
  '/docs/features/avatars',
  '/docs/features/relay-pki',
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  
  for (const pagePath of SIBLING_PAGES) {
    const page = await context.newPage();
    await page.goto(`http://localhost:4173${pagePath}`);
    
    // Test 1: Check CSS classes exist
    const stripeCard = await page.locator('.lw-stripe-card').first().isVisible();
    const midline = await page.locator('.lw-midline').first().isVisible();
    const sectHead = await page.locator('.lw-sect-head').first().isVisible();
    
    expect(stripeCard).toBe(true);
    expect(midline).toBe(true);
    expect(sectHead).toBe(true);
    
    // Test 2: Check role aliases are used
    const roleElements = await page.locator('[style*="--error"]').count();
    expect(roleElements).toBeGreaterThan(0);
    
    await page.close();
  }
  
  await context.close();
  await browser.close();
})();