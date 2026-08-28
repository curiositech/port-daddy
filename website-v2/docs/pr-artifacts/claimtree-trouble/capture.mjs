/** Capture the real Claim Tree trouble visualizer in both themes plus motion. */
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
  const viz = page.getByTestId('claimtree-trouble-viz')
  await viz.scrollIntoViewIfNeeded()
  await viz.waitFor()
  return { page, viz }
}

for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    colorScheme: theme,
    reducedMotion: 'reduce',
  })
  const { viz } = await open(context, theme)
  await viz.screenshot({ path: path.join(out, `ego-graph-${theme}.png`) })
  await context.close()
}

const videoDir = path.join(out, '.video-tmp')
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  colorScheme: 'dark',
  reducedMotion: 'no-preference',
  recordVideo: { dir: videoDir, size: { width: 1440, height: 960 } },
})
const { page } = await open(context, 'dark')

const buttons = {
  verify: page.getByRole('button', { name: /^VERIFY:/i }),
  inspect: page.getByRole('button', { name: /^INSPECT:/i }),
  proceed: page.getByRole('button', { name: /^PROCEED:/i }),
}

await buttons.verify.click()
await page.waitForTimeout(450)
await buttons.inspect.click()
await page.waitForTimeout(450)
await buttons.proceed.click()
await page.waitForTimeout(900)

await context.close()
const video = readdirSync(videoDir).find((file) => file.endsWith('.webm'))
copyFileSync(path.join(videoDir, video), path.join(out, 'ego-graph-focus.webm'))
rmSync(videoDir, { recursive: true, force: true })
await browser.close()
console.log(`Captured Claim Tree trouble visualizer artifacts in ${out}`)
