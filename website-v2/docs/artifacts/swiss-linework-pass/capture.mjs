/**
 * Visual proof for the ch. 20 fractional-linework (Swiss modern) design pass.
 *
 * Captures home, the docs overview, and the fleet feature page in light +
 * dark at desktop (1440) and mobile (390) widths, full-page. Reuses the
 * pairwise header-collision assertion from docs/artifacts/login-state/ so a
 * regression in the recently-fixed header (search overlap, duplicate octocat,
 * chip collisions) fails the run instead of shipping silently.
 *
 * The relay probe (/auth/status) is route-aborted so runs are deterministic
 * offline and exercise the signed-out graceful-degrade path.
 *
 * Run:  node capture.mjs <outDir>   (vite preview must be serving :4173)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

// Let Playwright resolve its own installed browser. Pinning a revision path
// here breaks every contributor whose Playwright installed a different build.
// Override only when the browser genuinely lives somewhere else:
//   CAPTURE_CHROMIUM=/opt/pw-browsers/chromium/chrome node capture.mjs out/
const EXECUTABLE = process.env.CAPTURE_CHROMIUM || undefined
const BASE = 'http://localhost:4173'
const OUT = process.argv[2] ?? '.'
mkdirSync(OUT, { recursive: true })

const ROUTES = [
  { slug: 'home', path: '/' },
  { slug: 'docs', path: '/docs' },
  { slug: 'fleet-feature', path: '/docs/features/fleet' },
]
const VIEWPORTS = [
  { label: '1440', width: 1440, height: 950 },
  { label: '390', width: 390, height: 844 },
]

// Collision check: header controls must never overlap one another.
async function assertNoHeaderOverlap(page, label) {
  const boxes = []
  for (const sel of [
    'nav[aria-label="Primary"]',
    'header [data-account-chip]',
    'header [data-search-trigger]',
    'header a[aria-label="Open GitHub repository"]',
    'header button[aria-label="Toggle color theme"]',
    'header button[aria-label="Open site navigation"]',
    'header button[aria-label="Search documentation"]',
  ]) {
    const loc = page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    const box = await loc.boundingBox()
    if (box && box.width > 0) boxes.push({ sel, ...box })
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
      if (overlapX > 1 && overlapY > 1) {
        throw new Error(`${label}: OVERLAP between ${a.sel} and ${b.sel} (${overlapX.toFixed(0)}px)`)
      }
    }
  }
  console.log(`${label}: header clean (${boxes.length} controls checked)`)
}

// No horizontal page overflow (clipped/colliding layout tell on mobile).
async function assertNoHorizontalOverflow(page, label) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  if (scrollW > clientW + 1) {
    throw new Error(`${label}: horizontal overflow (${scrollW} > ${clientW})`)
  }
}

const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {})

for (const theme of ['light', 'dark']) {
  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        colorScheme: theme,
      })
      await context.route('**/auth/status', (r) => r.abort())
      const page = await context.newPage()
      await page.addInitScript((t) => localStorage.setItem('pd-theme', t), theme)
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900) // settle fonts/motion
      const label = `${route.slug} ${theme}@${vp.label}`
      await assertNoHeaderOverlap(page, label)
      await assertNoHorizontalOverflow(page, label)
      await page.screenshot({
        path: path.join(OUT, `${route.slug}-${theme}-${vp.label}.png`),
        fullPage: true,
      })
      await context.close()
    }
  }
}

await browser.close()
console.log('captured artifacts into', OUT)
