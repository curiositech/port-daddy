/** Book regression against an existing website preview; never starts a Port Daddy runtime. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { auditText } from './interface-text-audit.mjs'

const target = process.env.BOOK_TARGET_URL || 'http://127.0.0.1:3347'
const output = resolve(process.env.BOOK_REPORT_DIR || fileURLToPath(new URL('../../.scratch/book-implementation/browser', import.meta.url)))
const temporary = fileURLToPath(new URL('../../.scratch/book-implementation/tmp', import.meta.url))
await mkdir(temporary, { recursive: true })
process.env.TMPDIR = temporary
const require = createRequire(import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const reports = []
const layouts = [
  { width: 320, height: 740, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1440, height: 1000, touch: false },
  { width: 390, height: 844, touch: true, textScale: 2 },
]
try {
  for (const theme of ['light', 'dark']) for (const layout of layouts) {
    const name = `${layout.width}x${layout.height}-${theme}${layout.textScale ? '-text200' : ''}`
    const context = await browser.newContext({
      viewport: { width: layout.width, height: layout.height },
      colorScheme: theme, hasTouch: layout.touch, reducedMotion: 'reduce',
      ...(layout.width === 390 && !layout.textScale && theme === 'light' ? { recordVideo: { dir: output, size: { width: layout.width, height: layout.height } } } : {}),
    })
    try {
      // Background runtime requests must never touch a local daemon during this audit.
      await context.route('**/*', (route) => {
        const request = new URL(route.request().url())
        return ['localhost', '127.0.0.1'].includes(request.hostname) && request.origin !== new URL(target).origin ? route.abort() : route.continue()
      })
      const page = await context.newPage()
      await page.goto(`${target}/whitepaper?panel=read`, { waitUntil: 'networkidle' })
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, theme)
      if (layout.textScale) await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      const main = page.getByRole('main')
      await main.getByRole('heading', { level: 1 }).waitFor()
      assert.equal(await main.locator('.book-cover').evaluate((image) => image.complete && image.naturalWidth > 0), true, name + ': real cover decoded')
      const pdf = main.getByRole('link', { name: 'Read book (PDF)' })
      assert.equal(await pdf.getAttribute('href'), '/whitepaper/coordination-papers-mega-volume.pdf')
      const primaryBounds = await pdf.boundingBox()
      assert(primaryBounds.height >= 44 && primaryBounds.width >= 44, name + ': PDF touch target')
      if (layout.width === 390 && !layout.textScale) assert(primaryBounds.y + primaryBounds.height <= layout.height, `${name}: primary action must fit first mobile viewport`)
      const chapters = main.locator('#contents a')
      assert.equal(await chapters.count(), 8, name + ': chapter count')
      assert.equal(new Set(await chapters.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).size, 8, name + ': unique chapter destinations')
      assert.equal(await main.getByRole('tablist').count(), 0, name + ': obsolete tabs')
      const nestedScrollers = await main.evaluate((element) => [element, ...element.querySelectorAll('*')].filter((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 2).map((node) => node.className))
      assert.deepEqual(nestedScrollers, [], name + ': nested scrolling regions')
      for (const link of await chapters.all()) {
        await link.scrollIntoViewIfNeeded()
        assert(await link.isVisible(), name + ': chapter reachable')
        const bounds = await link.boundingBox()
        assert(bounds.height >= 44 && bounds.width >= 44, name + ': chapter touch target')
      }
      await pdf.focus()
      await page.keyboard.press('Tab')
      assert.equal(await chapters.first().evaluate((link) => link === document.activeElement), true, name + ': keyboard order from PDF to first chapter')
      assert.equal(await chapters.first().evaluate((link) => getComputedStyle(link).outlineStyle), 'solid', name + ': visible keyboard focus')
      const summary = main.locator('summary')
      await summary.scrollIntoViewIfNeeded()
      const summaryBounds = await summary.boundingBox()
      assert(summaryBounds.height >= 44, name + ': disclosure touch target')
      if (layout.touch) await summary.tap()
      else { await summary.focus(); await page.keyboard.press('Enter') }
      assert.equal(await main.locator('details').evaluate((details) => details.open), true, name + ': disclosure opens')
      assert(await main.getByRole('link', { name: 'Read the adversarial review history' }).isVisible(), name + ': history reachable')
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
      const accessibility = await main.evaluate(async (element) => {
        const results = await window.axe.run(element, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })
        return { violations: results.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target) })), incomplete: results.incomplete.map((check) => ({ id: check.id, targets: check.nodes.map((node) => node.target) })) }
      })
      assert.deepEqual(accessibility.violations, [], name + ': automated book accessibility')
      const contrast = await page.evaluate(auditText)
      assert.equal(contrast.overflow, false, name + ': horizontal overflow')
      assert.deepEqual(contrast.failed, [], name + ': text contrast')
      const naturalScroll = await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return { y: window.scrollY, height: document.documentElement.scrollHeight, viewport: window.innerHeight } })
      assert(naturalScroll.y > 0 && naturalScroll.height > naturalScroll.viewport, name + ': document scroll')
      await summary.click()
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
      if (layout.width === 390 && !layout.textScale || layout.width === 1440) await page.screenshot({ path: `${output}/${name}-viewport.png` })
      reports.push({ name, primaryBounds, nestedScrollers, accessibility, contrast, naturalScroll })
      if (name === '390x844-light') {
        // Exercise the real SPA link rather than merely accepting an href string.
        await chapters.first().click()
        await page.waitForURL('**/whitepaper/single-writer-kernel')
        await page.getByRole('heading', { level: 1 }).waitFor()
        await page.goBack({ waitUntil: 'networkidle' })
      }
    } finally { await context.close() }
  }
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(reports, null, 2))
  await browser.close()
}
console.log(`Book browser regression: ${reports.length} layouts passed. Evidence: ${output}`)
