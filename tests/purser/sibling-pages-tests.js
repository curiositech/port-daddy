const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  
  const pages = [
    '/docs/features/dns',
    '/docs/features/harbors',
    '/docs/features/ports',
    '/docs/features/avatars',
    '/docs/features/arbiter',
    '/docs/features/tuples',
    '/docs/features/pheromone',
    '/docs/features/remote',
    '/docs/features/relay-pki'
  ];
  
  for (const path of pages) {
    await page.goto(`http://localhost:4173${path}`);
    await page.waitForTimeout(500);
    
    // Check for specific elements
    const title = await page.locator('h1').first().textContent();
    if (!title || !title.includes('Feature')) {
      throw new Error(`Page ${path} missing feature title`);
    }
    
    // Check for badges on specific pages
    if (path.includes('arbiter') || path.includes('tuples') || path.includes('pheromone')) {
      const badges = await page.locator('.badge').all();
      if (badges.length === 0) {
        throw new Error(`Page ${path} missing badges`);
      }
    }
    
    // Check for unique components
    if (path.includes('avatars')) {
      const nextBox = await page.locator('.next-box').first();
      if (!(await nextBox.isVisible())) {
        throw new Error(`Page ${path} missing Next box`);
      }
    }
    
    if (path.includes('relay-pki')) {
      const grid = await page.locator('.card-grid').first();
      if (!(await grid.isVisible())) {
        throw new Error(`Page ${path} missing card grid`);
      }
    }
  }
  
  await context.close();
  await browser.close();
})();