/**
 * Captures the landing page's #demos Porthole embed in both themes, proving
 * the light-mode ANSI theme fix (PR: Porthole terminal actually re-themes
 * with the page in light mode). Pattern lifted from
 * docs/artifacts/login-state/capture.mjs.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:4173'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXECUTABLE })

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    colorScheme: theme,
  })
  const page = await context.newPage()
  await page.addInitScript((t) => localStorage.setItem('pd-theme', t), theme)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const section = page.locator('#demos')
  await section.scrollIntoViewIfNeeded()
  // Let the cast start playing so the shot shows real terminal content, not
  // a blank just-mounted embed.
  await page.waitForTimeout(1800)
  await section.screenshot({ path: path.join(OUT, `demos-section-${theme}.png`) })
  console.log(`captured demos-section-${theme}.png`)
  await context.close()
}

await browser.close()
console.log('done')
