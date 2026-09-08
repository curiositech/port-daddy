/**
 * Captures the signed-out header state (light + dark, several widths) and a
 * short scroll webm for website-v2/docs/artifacts/login-state/.
 *
 * The relay probe (https://relay.portdaddy.dev/auth/status) is route-aborted so
 * the run is deterministic offline AND doubles as proof of the graceful-degrade
 * path: relay unreachable => the header renders the plain "Sign in" chip.
 */
import { chromium } from 'playwright'
import { mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:4173'
const OUT = process.argv[2]
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXECUTABLE })

async function preparePage(context, theme, mockSignedIn = false) {
  if (mockSignedIn) {
    await context.route('**/auth/status', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': 'http://localhost:4173', 'Access-Control-Allow-Credentials': 'true' },
        body: JSON.stringify({ code: 'OK', login: 'mariner', avatarUrl: null }),
      }),
    )
  } else {
    await context.route('**/auth/status', (route) => route.abort())
  }
  const page = await context.newPage()
  await page.addInitScript((t) => localStorage.setItem('pd-theme', t), theme)
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.waitForSelector(`[data-account-chip="${mockSignedIn ? 'signed-in' : 'signed-out'}"]`)
  return page
}

// Collision check: the account chip must never overlap the search box or nav.
async function assertNoOverlap(page, label) {
  const boxes = []
  for (const sel of [
    'nav[aria-label="Primary"]',
    'header [data-account-chip]',
    'header [data-search-trigger]',
    'header a[aria-label="Open GitHub repository"]',
    'header button[aria-label="Toggle color theme"]',
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
  console.log(`${label}: no collisions (${boxes.length} header controls checked)`)
}

const WIDTHS = [1680, 1280, 900]
for (const theme of ['light', 'dark']) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 950 },
      colorScheme: theme,
    })
    const page = await preparePage(context, theme)
    await assertNoOverlap(page, `${theme}@${width}`)
    const header = page.locator('header[data-shell="site-header"]')
    const suffix = width === 1680 ? '' : `-${width}`
    await header.screenshot({ path: path.join(OUT, `header-signed-out-${theme}${suffix}.png`) })
    if (width === 1680) {
      await page.screenshot({ path: path.join(OUT, `home-header-${theme}.png`) })
    }
    await context.close()
  }
}

// Signed-in layout sanity (mocked probe; avatar-less fallback icon + login).
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 950 }, colorScheme: 'dark' })
  const page = await preparePage(context, 'dark', true)
  await assertNoOverlap(page, 'signed-in dark@1680')
  await page
    .locator('header[data-shell="site-header"]')
    .screenshot({ path: path.join(OUT, 'header-signed-in-mocked-dark.png') })
  await context.close()
}

// Short scroll recording (webm) — header stays pinned with the signed-out chip.
const videoDir = path.join(OUT, '.video-tmp')
const context = await browser.newContext({
  viewport: { width: 1680, height: 950 },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: 1680, height: 950 } },
})
const page = await preparePage(context, 'dark')
await page.waitForTimeout(700)
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel(0, 420)
  await page.waitForTimeout(240)
}
await page.waitForTimeout(700)
await context.close()
const webm = readdirSync(videoDir).find((f) => f.endsWith('.webm'))
copyFileSync(path.join(videoDir, webm), path.join(OUT, 'home-scroll-signed-out.webm'))
rmSync(videoDir, { recursive: true, force: true })

await browser.close()
console.log('captured artifacts into', OUT)
