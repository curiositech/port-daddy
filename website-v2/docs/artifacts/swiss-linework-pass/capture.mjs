/**
 * Visual proof for the ch. 20 fractional-linework (Swiss modern) design pass,
 * plus three defect fixes layered on top:
 *   1. header nav breakpoint moved from 2xl (1536) to 1440 — proven
 *      collision-free at 1280/1440/1536/1920 (header-only crops below;
 *      1280 must show the hamburger, the other three must show inline nav)
 *   2. hero marquee edge mask/fade (home-hero-marquee below)
 *   3. Swiss-modern grammar propagated from FleetFeature to its siblings
 *      (a representative sample of the touched docs/features pages below)
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
const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:4173'
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

// ── defect 1: header breakpoint proof widths (header element only, no full
// page) — 1280 must show the hamburger, the rest must show inline nav ──
// 1440 is IN this list even though the full-page pass also shoots it: 1440 is
// the breakpoint itself, so it is the width most likely to regress, and the
// full-page pass only checks collisions — it never checks which nav rendered.
const HEADER_PROOF_WIDTHS = [1280, 1440, 1536, 1920]

/** The breakpoint the header switches at; the assertion below derives from it. */
const NAV_BREAKPOINT = 1440

// ── defect 3: sibling feature pages that got the grammar propagated.
// A representative sample: three "plain" pages (card-grid + CLI-callout
// shape) and the pages with page-specific quirks (badges, unique Next-box
// markup) that the mechanical pass had to special-case. ──
const SIBLING_ROUTES = [
  { slug: 'dns-feature', path: '/docs/features/dns' },
  { slug: 'harbors-feature', path: '/docs/features/harbors' },
  { slug: 'ports-feature', path: '/docs/features/ports' },
  { slug: 'avatars-feature', path: '/docs/features/avatars' },
  { slug: 'arbiter-feature', path: '/docs/features/arbiter' },
  { slug: 'tuples-feature', path: '/docs/features/tuples' },
  { slug: 'pheromone-feature', path: '/docs/features/pheromone' },
  { slug: 'remote-feature', path: '/docs/features/remote' },
  { slug: 'relay-pki-feature', path: '/docs/features/relay-pki' },
]

/**
 * Breakpoint check: assert WHICH nav rendered, not merely that nothing
 * collided.
 *
 * Why this exists as a separate assertion: `assertNoHeaderOverlap` cannot
 * catch a breakpoint regression, because the hamburger does not overlap
 * anything either. If the switch slipped back to 1536, every width below it
 * would render the hamburger, collide with nothing, and produce a full set of
 * "passing" artifacts — the exact failure this capture is supposed to prevent.
 * The file header claimed this was proven; until now only the collision half
 * was. Caught by Copilot on #4923.
 *
 * Below the breakpoint: hamburger visible, inline nav absent from layout.
 * At or above it: inline nav visible, hamburger gone. Both directions are
 * asserted so a switch that fires early fails just as loudly as one that
 * fires late.
 */
async function assertNavMode(page, width, label) {
  const inlineNav = page.locator('nav[aria-label="Primary"]').first()
  const hamburger = page.locator('header button[aria-label="Open site navigation"]').first()
  const inlineVisible = (await inlineNav.count()) > 0 && (await inlineNav.isVisible())
  const hamburgerVisible = (await hamburger.count()) > 0 && (await hamburger.isVisible())

  const wantInline = width >= NAV_BREAKPOINT
  if (wantInline && !inlineVisible) {
    throw new Error(`${label}: at ${width}px (>= ${NAV_BREAKPOINT}) the inline nav must render, but it is hidden`)
  }
  if (wantInline && hamburgerVisible) {
    throw new Error(`${label}: at ${width}px (>= ${NAV_BREAKPOINT}) the hamburger must be gone, but it is visible`)
  }
  if (!wantInline && !hamburgerVisible) {
    throw new Error(`${label}: at ${width}px (< ${NAV_BREAKPOINT}) the hamburger must render, but it is hidden`)
  }
  if (!wantInline && inlineVisible) {
    throw new Error(`${label}: at ${width}px (< ${NAV_BREAKPOINT}) the inline nav must be hidden, but it is visible`)
  }
  console.log(`${label}: nav mode correct (${wantInline ? 'inline nav' : 'hamburger'})`)
}

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

// ── defect 1 proof: header-only crops at the mandated widths. 1280 must show
// the hamburger (below the new 1440 breakpoint); 1536/1920 must show inline
// nav. 1440 itself is already proven full-page above. ──
for (const theme of ['light', 'dark']) {
  for (const width of HEADER_PROOF_WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 140 },
      colorScheme: theme,
    })
    await context.route('**/auth/status', (r) => r.abort())
    const page = await context.newPage()
    await page.addInitScript((t) => localStorage.setItem('pd-theme', t), theme)
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const label = `header-proof ${theme}@${width}`
    await assertNavMode(page, width, label)
    await assertNoHeaderOverlap(page, label)
    await assertNoHorizontalOverflow(page, label)
    await page.locator('header[data-shell="site-header"]').screenshot({
      path: path.join(OUT, `header-${theme}-${width}.png`),
    })
    await context.close()
  }
}

// ── defect 2 proof: hero marquee, viewport-only (not full-page) so the
// third-card edge treatment at the right of the visible frame is legible. ──
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    colorScheme: theme,
  })
  await context.route('**/auth/status', (r) => r.abort())
  const page = await context.newPage()
  await page.addInitScript((t) => localStorage.setItem('pd-theme', t), theme)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, `home-hero-marquee-${theme}-1440.png`) })
  await context.close()
}

// ── defect 3 proof: sibling feature pages that got the grammar propagated.
// Desktop (1440) for all sample pages; mobile (390) and dark for a smaller
// spot-check subset (a plain page + a page with badges). ──
for (const route of SIBLING_ROUTES) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
    colorScheme: 'light',
  })
  await context.route('**/auth/status', (r) => r.abort())
  const page = await context.newPage()
  await page.addInitScript((t) => localStorage.setItem('pd-theme', t), 'light')
  await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  const label = `${route.slug} light@1440`
  await assertNoHeaderOverlap(page, label)
  await assertNoHorizontalOverflow(page, label)
  await page.screenshot({
    path: path.join(OUT, `${route.slug}-light-1440.png`),
    fullPage: true,
  })
  await context.close()
}

const SPOT_CHECK_ROUTES = [
  { slug: 'dns-feature', path: '/docs/features/dns' },
  { slug: 'arbiter-feature', path: '/docs/features/arbiter' },
]
for (const route of SPOT_CHECK_ROUTES) {
  for (const spec of [
    { theme: 'light', width: 390, height: 844, label: '390' },
    { theme: 'dark', width: 1440, height: 950, label: 'dark-1440' },
  ]) {
    const context = await browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      colorScheme: spec.theme,
    })
    await context.route('**/auth/status', (r) => r.abort())
    const page = await context.newPage()
    await page.addInitScript((t) => localStorage.setItem('pd-theme', t), spec.theme)
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const label = `${route.slug} ${spec.theme}@${spec.label}`
    await assertNoHeaderOverlap(page, label)
    await assertNoHorizontalOverflow(page, label)
    await page.screenshot({
      path: path.join(OUT, `${route.slug}-${spec.label}.png`),
      fullPage: true,
    })
    await context.close()
  }
}

await browser.close()
console.log('captured artifacts into', OUT)
