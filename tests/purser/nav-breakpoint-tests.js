const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Test 1280px (hamburger mode)
  await page.setViewportSize({ width: 1280, height: 950 });
  await page.waitForTimeout(500);
  const hamburger = await page.locator('header button[aria-label="Open site navigation"]').first();
  const inlineNav = await page.locator('nav[aria-label="Primary"]').first();
  
  if (!(await hamburger.isVisible()) || (await inlineNav.isVisible())) {
    throw new Error('Hamburger not visible or inline nav visible at 1280px');
  }
  
  // Test 1440px (inline mode)
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.waitForTimeout(500);
  if (!(await inlineNav.isVisible()) || (await hamburger.isVisible())) {
    throw new Error('Inline nav not visible or hamburger visible at 1440px');
  }
  
  // Test 1536px (inline mode)
  await page.setViewportSize({ width: 1536, height: 950 });
  await page.waitForTimeout(500);
  if (!(await inlineNav.isVisible()) || (await hamburger.isVisible())) {
    throw new Error('Inline nav not visible or hamburger visible at 1536px');
  }
  
  // Test 1920px (inline mode)
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.waitForTimeout(500);
  if (!(await inlineNav.isVisible()) || (await hamburger.isVisible())) {
    throw new Error('Inline nav not visible or hamburger visible at 1920px');
  }
  
  // Check for header overlaps
  const controls = [
    'nav[aria-label="Primary"]',
    'header [data-account-chip]',
    'header [data-search-trigger]',
    'header a[aria-label="Open GitHub repository"]',
    'header button[aria-label="Toggle color theme"]',
    'header button[aria-label="Open site navigation"]',
    'header button[aria-label="Search documentation"]'
  ];
  
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const box1 = await page.locator(controls[i]).first().boundingBox();
      const box2 = await page.locator(controls[j]).first().boundingBox();
      if (box1 && box2) {
        const overlapX = Math.min(box1.x + box1.width, box2.x + box2.width) - Math.max(box1.x, box2.x);
        const overlapY = Math.min(box1.y + box1.height, box2.y + box2.height) - Math.max(box1.y, box2.y);
        if (overlapX > 1 && overlapY > 1) {
          throw new Error(`Header overlap detected between ${controls[i]} and ${controls[j]}`);
        }
      }
    }
  }
  
  await context.close();
  await browser.close();
})();