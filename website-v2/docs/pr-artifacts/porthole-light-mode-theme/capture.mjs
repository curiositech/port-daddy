/**
 * Captures the landing page's #demos Porthole embed in both themes, proving
 * the light-mode ANSI theme fix (PR: Porthole terminal actually re-themes
 * with the page in light mode). Pattern lifted from
 * website-v2/docs/artifacts/login-state/capture.mjs.
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
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

// Motion proof: start dark, click the real site theme toggle, record the
// #demos terminal actually flipping to light live — stronger evidence than
// two static frames, and directly answers "does it really re-theme".
{
  const videoDir = path.join(OUT, '.video-tmp')
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: 1200, height: 900 } },
  })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('pd-theme', 'dark'), )
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.locator('#demos').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  await page.locator('button[aria-label="Toggle color theme"]').click()
  await page.waitForTimeout(1800)
  await context.close()
  const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'))
  copyFileSync(path.join(videoDir, webm), path.join(OUT, 'demos-section-theme-toggle.webm'))
  rmSync(videoDir, { recursive: true, force: true })
  console.log('captured demos-section-theme-toggle.webm')
}

await browser.close()
console.log('done')
