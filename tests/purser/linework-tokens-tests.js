const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  await page.goto('http://localhost:4173');
  
  // Test linework tokens
  const tokens = ['lw-1', 'lw-1.5', 'lw-2', 'lw-3'];
  
  for (const token of tokens) {
    const selector = `.${token}`;
    const element = await page.locator(selector).first();
    
    if (!(await element.isVisible())) {
      throw new Error(`Token ${token} not applied`);
    }
    
    const style = await page.evaluate(el => {
      return window.getComputedStyle(el).strokeWidth;
    }, element);
    
    if (!style || !style.includes(token.replace('lw-', ''))) {
      throw new Error(`Token ${token} not correctly applied`);
    }
  }
  
  // Test for horizontal overflow
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  
  if (scrollW > clientW + 1) {
    throw new Error('Horizontal overflow detected');
  }
  
  await context.close();
  await browser.close();
})();