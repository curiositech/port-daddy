/** Opt-in rendered regression; uses an existing website preview, never a daemon. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { auditText } from './interface-text-audit.mjs'
const require = createRequire(import.meta.url), url = process.env.THEME_TARGET_URL || 'http://127.0.0.1:3244'
const output = process.env.THEME_REPORT_DIR || '.theme-normalization/interactions'
await mkdir(output, { recursive: true }); process.env.TMPDIR = new URL('../.theme-normalization/', import.meta.url).pathname
const browser = await chromium.launch({ headless: true }), reports = []
async function context(options = {}) {
  const ctx = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', ...options })
  await ctx.route('**/*', r => { const u = new URL(r.request().url()), target = new URL(url); return ['localhost', '127.0.0.1'].includes(u.hostname) && u.origin !== target.origin ? r.abort() : r.continue() })
  return ctx
}
async function state(page, theme, name) {
  await page.waitForFunction(t => document.documentElement.dataset.theme === t, theme)
  await page.waitForTimeout(250)
  const text = await page.evaluate(auditText)
  reports.push({ name, theme, ...text })
  assert.equal(text.overflow, false, name + ': horizontal overflow')
  assert.equal(text.failed.length, 0, name + ': text contrast')
}
try {
  for (const width of [1440, 390, 720, 320]) {
    const c = await context({ viewport: { width, height: 1000 }, recordVideo: width === 1440 || width === 390 ? { dir: output, size: { width, height: 1000 } } : undefined })
    try {
      const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready)
      if (width === 720) await p.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      await state(p, 'light', `${width}:System light`)
      const trigger = p.getByRole('button', { name: 'Appearance: System' }); await trigger.focus(); await p.keyboard.press('Enter')
      await p.getByRole('radio', { name: 'Dark', exact: true }).check(); await state(p, 'dark', `${width}:selected Dark`)
      const axe = await import('node:fs/promises').then(fs => fs.readFile(require.resolve('axe-core/axe.min.js'), 'utf8')); await p.addScriptTag({ content: axe })
      const result = await p.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast-enhanced': { enabled: true } } }); return { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, html: n.html })) })), incomplete: r.incomplete.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) } })
      reports.push({ name: `${width}:appearance popup`, ...result }); assert.equal(result.violations.length, 0, `${width}:appearance axe`)
      await p.getByRole('radio', { name: 'Light', exact: true }).hover(); await state(p, 'dark', `${width}:hover Light`)
      await p.getByRole('radio', { name: 'Light', exact: true }).focus(); await state(p, 'dark', `${width}:focus Light`)
      await p.screenshot({ path: `${output}/appearance-${width}-dark.png` }); await p.keyboard.press('Escape'); await p.reload({ waitUntil: 'networkidle' }); await state(p, 'dark', `${width}:reload Dark`)
      await p.emulateMedia({ colorScheme: 'light' }); await state(p, 'dark', `${width}:explicit ignores OS`)
      await p.getByRole('button', { name: 'Appearance: Dark' }).click(); await p.getByRole('radio', { name: 'System', exact: true }).check(); await state(p, 'light', `${width}:System selected`); await p.keyboard.press('Escape')
      await p.emulateMedia({ colorScheme: 'dark' }); await state(p, 'dark', `${width}:live OS dark`)
      const other = await c.newPage(); await other.goto(url, { waitUntil: 'networkidle' }); await other.evaluate(() => localStorage.setItem('pd-theme', 'light')); await state(p, 'light', `${width}:cross-tab explicit`); await other.evaluate(() => localStorage.clear()); await state(p, 'dark', `${width}:cross-tab clear`); await other.close()
      for (const theme of ['dark', 'light']) { await p.emulateMedia({ colorScheme: theme }); await p.evaluate(() => window.scrollTo(0, 800)); await p.waitForTimeout(700); await p.screenshot({ path: `${output}/home-${width}-${theme}.png` }); await p.evaluate(() => window.scrollTo(0, 0)) }
    } finally { await c.close() }
  }
  const c = await context({ colorScheme: 'dark' }); try { await c.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('denied') }; Storage.prototype.setItem = () => { throw new Error('denied') }; document.addEventListener('DOMContentLoaded', () => { window.prepaintTheme = document.documentElement.dataset.theme }) }); const p = await c.newPage(); await p.goto(url, { waitUntil: 'networkidle' }); assert.equal(await p.evaluate(() => window.prepaintTheme), 'dark'); await state(p, 'dark', 'blocked storage prepaint'); await p.getByRole('button', { name: 'Appearance: System' }).click(); await p.getByRole('radio', { name: 'Light', exact: true }).check(); await state(p, 'light', 'blocked storage selection') } finally { await c.close() }
} finally { await writeFile(output + '/report.json', JSON.stringify(reports, null, 2)); await browser.close() }
console.log(`Rendered theme regression: ${reports.length} checks passed; report ${output}/report.json`)
