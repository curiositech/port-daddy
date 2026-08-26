/**
 * Captures the alt-screen/TUI line-pitch fix: opens the Porthole prototype
 * (demos/porthole/porthole.html, a self-contained file with the btop and
 * lazygit casts inlined — no server needed), switches to each TUI tab, and
 * screenshots the terminal chrome once it has settled into its box-drawing
 * frame. Run once against the pre-fix worktree for `*-before.png` and once
 * against the fixed worktree for `*-after.png`; both pairs in this
 * directory were captured this way, same viewport, same seek point.
 */
import { chromium } from 'playwright'
import { mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const FILE = 'file://' + path.resolve('demos/porthole/porthole.html')
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.goto(FILE, { waitUntil: 'load' })
await page.waitForTimeout(500)

for (const name of ['btop', 'lazygit']) {
  await page.evaluate((n) => {
    const btn = document.querySelector(`#tabs button[data-name="${n}"]`)
    if (btn) btn.click()
  }, name)
  await page.waitForTimeout(1500)
  await page.locator('.win').first().screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log('captured', name)
}

// Motion proof: record the fixed player actually drawing btop's box-drawing
// borders in real time — stronger evidence than static before/after frames.
{
  const videoDir = path.join(OUT, '.video-tmp')
  const context = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1200, height: 900 } },
  })
  const recPage = await context.newPage()
  await recPage.goto(FILE, { waitUntil: 'load' })
  await recPage.waitForTimeout(500)
  await recPage.evaluate(() => {
    const btn = document.querySelector('#tabs button[data-name="btop"]')
    if (btn) btn.click()
  })
  await recPage.waitForTimeout(3500)
  await context.close()
  const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'))
  copyFileSync(path.join(videoDir, webm), path.join(OUT, 'btop-live-render.webm'))
  rmSync(videoDir, { recursive: true, force: true })
  console.log('captured btop-live-render.webm')
}

await browser.close()
