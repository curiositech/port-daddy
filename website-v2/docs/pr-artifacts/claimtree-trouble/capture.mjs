/** Capture the real Claim Tree trouble ego graph in both themes plus motion. */
import { chromium } from 'playwright'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const browser = await chromium.launch({ executablePath: chromium.executablePath() })
const out = path.resolve(process.argv[2])
const base = 'http://127.0.0.1:5188/docs/concepts/claim-tree'
mkdirSync(out, { recursive: true })

async function open(context, theme) {
  await context.addInitScript((value) => localStorage.setItem('pd-theme', value), theme)
  const page = await context.newPage()
  await page.goto(base, { waitUntil: 'networkidle' })
  const graph = page.locator('figure').filter({ hasText: 'session-you' })
  await graph.scrollIntoViewIfNeeded()
  await graph.waitFor()
  return { page, graph }
}

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, colorScheme: theme })
  const { graph } = await open(context, theme)
  await graph.screenshot({ path: path.join(out, `ego-graph-${theme}.png`) })
  await context.close()
}

const videoDir = path.join(out, '.video-tmp')
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: 1440, height: 960 } },
})
const { page, graph } = await open(context, 'dark')
await page.waitForTimeout(600)
await graph.evaluate((element) => element.animate(
  [{ transform: 'scale(1)' }, { transform: 'scale(1.018)' }, { transform: 'scale(1)' }],
  { duration: 1400, easing: 'ease-in-out' },
))
await page.waitForTimeout(1800)
await context.close()
const video = readdirSync(videoDir).find((file) => file.endsWith('.webm'))
copyFileSync(path.join(videoDir, video), path.join(out, 'ego-graph-focus.webm'))
rmSync(videoDir, { recursive: true, force: true })
await browser.close()
console.log(`Captured Claim Tree ego graph artifacts in ${out}`)
