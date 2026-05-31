/**
 * Gestalt audit probe: measure spacing levels, similarity violations,
 * figure-ground hierarchy on the landing page. Outputs concrete file
 * pointers + numeric findings, not opinions.
 */
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:4173/'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const findings = await page.evaluate(() => {
  const sections = Array.from(document.querySelectorAll('main > section'))
  const results = { sections: [], spacings: [], buttons: [], headings: [] }

  // Section spacing inventory
  for (let i = 0; i < sections.length; i += 1) {
    const s = sections[i]
    const cs = getComputedStyle(s)
    const rect = s.getBoundingClientRect()
    results.sections.push({
      index: i,
      id: s.id || s.getAttribute('aria-labelledby') || `section-${i}`,
      paddingTop: cs.paddingTop,
      paddingBottom: cs.paddingBottom,
      borderTop: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      height: Math.round(rect.height),
    })
  }

  // Collect all distinct spacing values used by direct children of main
  const all = document.querySelectorAll('main *')
  const spacingSet = new Set()
  all.forEach((el) => {
    const cs = getComputedStyle(el)
    ;['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap', 'rowGap'].forEach((prop) => {
      const v = cs[prop]
      if (v && v !== '0px' && v !== 'normal') spacingSet.add(`${prop}:${v}`)
    })
  })
  // Just the numeric values, dedup
  const numericSpaces = new Set()
  spacingSet.forEach((s) => {
    const m = s.match(/(\d+(?:\.\d+)?)px/)
    if (m) numericSpaces.add(parseFloat(m[1]))
  })
  results.spacings = Array.from(numericSpaces).sort((a, b) => a - b)

  // Inventory all buttons + links that look like CTAs
  const interactive = document.querySelectorAll(
    'main a[class*="bg-"], main button, main a.inline-flex'
  )
  const seen = new Map()
  interactive.forEach((el) => {
    const cs = getComputedStyle(el)
    const sig = `${cs.backgroundColor}|${cs.borderColor}|${cs.borderWidth}|${cs.color}|${cs.fontWeight}|${cs.fontFamily.split(',')[0]}`
    if (!seen.has(sig)) seen.set(sig, { count: 0, text: el.textContent?.trim().slice(0, 40) ?? '' })
    seen.get(sig).count += 1
  })
  results.buttons = Array.from(seen.entries()).map(([sig, info]) => ({ sig, ...info }))

  // Heading hierarchy
  const headings = document.querySelectorAll('main h1, main h2, main h3, main h4')
  results.headings = Array.from(headings).map((h) => ({
    tag: h.tagName,
    text: h.textContent?.trim().slice(0, 80) ?? '',
    fontSize: getComputedStyle(h).fontSize,
  }))

  return results
})

console.log(JSON.stringify(findings, null, 2))
await browser.close()
