#!/usr/bin/env node
/**
 * Snap every indexable route into static HTML with rendered body
 * content, so Googlebot (and every other crawler that doesn't
 * patiently execute JS) sees prose, not an empty `<div id="root">`.
 *
 * Why this exists:
 *   `vite build` produces a single index.html with an empty
 *   `<div id="root"></div>` body. `scripts/inject-route-html.mjs`
 *   then copies that file to `dist/<route>/index.html` per route,
 *   stamping per-route `<head>` metadata. That fixes meta tags but
 *   leaves the body empty. Crawlers that don't execute JS index a
 *   page with no content.
 *
 * Why a Puppeteer-style crawler instead of a SSG framework:
 *   `vite-react-ssg` is the natural choice but its 0.9.x peer deps
 *   still require react-router-dom ^6, and this repo runs v7. Until
 *   upstream adds RR7 support we render via a real browser against
 *   `vite preview` and capture the post-mount HTML. Zero changes to
 *   application code beyond the already-shipped SSR-safety prep
 *   (theme.tsx + Mermaid dynamic import in PR #107).
 *
 * Pipeline:
 *   1. Spawn `vite preview` on a random local port.
 *   2. For every route in `siteMetadataRoutes`, navigate the
 *      Playwright browser, wait for `<main id="main-content">` or
 *      another route-shaped marker, then capture `document.documentElement.outerHTML`.
 *   3. Replace the empty `<div id="root">` in
 *      `dist/<route>/index.html` with the captured `<div id="root">`,
 *      preserving the `<head>` that `inject-route-html.mjs` already
 *      injected (so per-route metadata stays correct).
 *   4. Shut down `vite preview` and the browser.
 *
 * `inject-route-html.mjs` MUST run before this script. The build
 * pipeline chains them: prebuild → vite build → inject-route-html
 * → snap-routes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import {
  canonicalUrlForRoute,
  isIndexableRoute,
  siteMetadataRoutes,
} from '../src/data/siteMetadata.ts'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(scriptDir, '..')
const distDir = resolve(websiteRoot, 'dist')

const CONCURRENCY = Number(process.env.SNAP_CONCURRENCY ?? 4)
const NAV_TIMEOUT_MS = Number(process.env.SNAP_NAV_TIMEOUT_MS ?? 30_000)
const SETTLE_TIMEOUT_MS = Number(process.env.SNAP_SETTLE_TIMEOUT_MS ?? 20_000)
const ROOT_MARKER = '<div id="root"></div>'
// Some deploy environments (notably Cloudflare Pages' default build
// image) don't bundle the Playwright chromium binary. When set, this
// flag converts a browser-launch failure into a warning + exit 0,
// so the deploy still ships — with the un-snapped empty bodies. The
// SEO regression is the cost; the alternative is "deploy fails, no
// site updates at all" which is worse. CI runners that DO have
// chromium should leave this unset so genuine breakage surfaces.
//
// Cloudflare Pages sets CF_PAGES=1 during build. Auto-skip there
// until chromium is installed in the Pages build env (see PR comment).
const SKIP_ON_BROWSER_ERROR =
  process.env.SNAP_SKIP_ON_BROWSER_ERROR === '1' ||
  process.env.CF_PAGES === '1'
// The Suspense fallback (in main.tsx → RouteFallback) renders this
// while lazy chunks load. If we capture before chunks resolve, we
// snap "Loading route..." into the static HTML — useless to crawlers.
const SUSPENSE_FALLBACK_RE = /Loading route\.\.\./i

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

async function waitForServer(url, attempts = 60, intervalMs = 250) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.ok || res.status === 404) return
    } catch {
      // Keep polling until the server binds.
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`vite preview never became reachable at ${url}`)
}

/**
 * Routes we want to snap. Filtered to indexable, deduplicated by
 * canonical URL, sorted for log stability.
 */
function targetRoutes() {
  const seen = new Map()
  for (const route of siteMetadataRoutes) {
    if (!isIndexableRoute(route)) continue
    // Skip dynamic param routes — they cannot be enumerated this way.
    if (route.path.includes(':')) continue
    if (!seen.has(route.path)) seen.set(route.path, route)
  }
  return Array.from(seen.values()).sort((a, b) => a.path.localeCompare(b.path))
}

function routeOutputPath(routePath) {
  if (routePath === '/') return resolve(distDir, 'index.html')
  return resolve(distDir, routePath.replace(/^\/+/, ''), 'index.html')
}

/**
 * Replace the empty `<div id="root">` in the pre-existing per-route
 * HTML with the rendered version captured from the live browser.
 * The browser's full document <head> is discarded — we keep the
 * head that `inject-route-html.mjs` already wrote, since it carries
 * per-route canonical, OG, JSON-LD, robots, etc.
 */
async function snapOne(browser, baseUrl, route) {
  const outputPath = routeOutputPath(route.path)
  if (!existsSync(outputPath)) {
    return { route: route.path, status: 'skip', reason: 'no per-route HTML to update' }
  }

  const existing = await readFile(outputPath, 'utf8')
  if (!existing.includes(ROOT_MARKER)) {
    return { route: route.path, status: 'skip', reason: 'root marker not found (already snapped?)' }
  }

  const page = await browser.newPage()
  try {
    await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS })
    // Wait until BOTH (a) the Suspense fallback "Loading route..."
    // is no longer in the DOM AND (b) the root has real content
    // beyond a thin wrapper. Without (a) we capture the loading
    // state and ship "Loading route..." as snapped HTML — exactly
    // what the first dry-run produced.
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root')
          if (!root) return false
          const html = root.innerHTML
          if (/Loading route\.\.\./i.test(html)) return false
          // Real content: at least a few hundred chars OR a heading/main element rendered.
          if (root.querySelector('main, h1, article, [data-rendered]')) return true
          return root.innerText.trim().length > 200
        },
        { timeout: SETTLE_TIMEOUT_MS },
      )
    } catch {
      // Tolerate routes that never resolve in time — we'll mark them below.
    }

    const rootInner = await page.evaluate(() => {
      const root = document.getElementById('root')
      return root ? root.innerHTML : ''
    })

    if (!rootInner || rootInner.trim().length === 0) {
      return { route: route.path, status: 'empty', reason: 'root rendered empty' }
    }
    if (SUSPENSE_FALLBACK_RE.test(rootInner)) {
      return { route: route.path, status: 'fallback', reason: 'Suspense fallback still active after settle timeout' }
    }

    // Preserve everything in the existing per-route HTML except the
    // empty root marker. Drop in the rendered children verbatim.
    const swapped = existing.replace(
      ROOT_MARKER,
      `<div id="root">${rootInner}</div>`,
    )

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, swapped)
    return { route: route.path, status: 'ok', bytes: rootInner.length }
  } finally {
    await page.close()
  }
}

async function main() {
  if (!existsSync(distDir)) {
    throw new Error(`dist directory not found at ${distDir}. Run \`npm run build\` first.`)
  }

  const routes = targetRoutes()
  console.log(`snap-routes: ${routes.length} routes to capture`)

  const port = await reservePort()
  const baseUrl = `http://127.0.0.1:${port}`

  // Start `vite preview` against the existing dist/. We invoke the
  // vite binary directly (not via `npx`) and start it in its own
  // process group via `detached: true`. The whole group can then be
  // SIGTERMed together later; otherwise `npx` would catch the signal
  // and leave the actual vite child running, hanging the workflow
  // until the runner's hard timeout fires.
  const vitePath = resolve(websiteRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  const preview = spawn(vitePath, ['preview', '--port', String(port), '--strictPort'], {
    cwd: websiteRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: process.platform !== 'win32',
  })
  const previewErr = []
  let intentionalShutdown = false
  preview.stderr.on('data', chunk => previewErr.push(chunk))
  preview.on('exit', (code, signal) => {
    // Signal-killed (we kill it after the run) or intentional shutdown:
    // not a real failure. Code 143 = SIGTERM on Node, treated the same.
    if (intentionalShutdown || signal === 'SIGTERM' || signal === 'SIGINT' || code === 143) return
    if (code !== 0) {
      console.error(`vite preview exited unexpectedly (code=${code}):\n${Buffer.concat(previewErr).toString('utf8')}`)
    }
  })
  // Closure for the kill path below; updates the flag the exit handler reads.
  const markShutdown = () => { intentionalShutdown = true }

  try {
    await waitForServer(`${baseUrl}/`)
    let browser
    try {
      browser = await chromium.launch({ headless: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (SKIP_ON_BROWSER_ERROR) {
        console.warn(
          `snap-routes: chromium failed to launch (${msg}). ` +
          `SNAP_SKIP_ON_BROWSER_ERROR=1 is set — skipping the snap pass. ` +
          `Empty-body HTML will ship until chromium is available.`,
        )
        return
      }
      throw new Error(
        `snap-routes: chromium failed to launch. Either install it ` +
        `(\`npx playwright install chromium\`) or set ` +
        `SNAP_SKIP_ON_BROWSER_ERROR=1 to deploy without snapping. ` +
        `Underlying error: ${msg}`,
      )
    }
    try {
      // Concurrency: a small worker pool. Playwright pages share
      // the browser; new pages are cheap.
      const queue = [...routes]
      const results = []
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const route = queue.shift()
          if (!route) break
          try {
            const r = await snapOne(browser, baseUrl, route)
            results.push(r)
            if (r.status === 'ok') {
              console.log(`  ✓ ${r.route} (${r.bytes} bytes)`)
            } else {
              console.log(`  ⊘ ${r.route} — ${r.status}: ${r.reason ?? ''}`)
            }
          } catch (err) {
            console.error(`  ✗ ${route.path} — ${(err instanceof Error) ? err.message : String(err)}`)
            results.push({ route: route.path, status: 'fail', error: err })
          }
        }
      })
      await Promise.all(workers)

      const ok = results.filter(r => r.status === 'ok').length
      const failed = results.filter(r => r.status === 'fail').length
      // `empty` (root rendered nothing) is treated as a failure: a page
      // that renders no content is a regression, not a skip. `fallback`
      // (Suspense never resolved within timeout) is a skip — the
      // existing per-route HTML is left intact and the build continues.
      const empty = results.filter(r => r.status === 'empty').length
      const fallback = results.filter(r => r.status === 'fallback').length
      const skipped = results.length - ok - failed - empty
      console.log(
        `snap-routes: ${ok} captured, ${fallback} fallback (kept old body), ` +
        `${empty} empty (regression), ${skipped} skipped, ${failed} failed`,
      )
      // Hard-fail on:
      //   - any actual fail (Playwright threw, navigation timeout, etc.)
      //   - any `empty` route (real regression)
      //   - 0 captures with non-zero target route count (mass-regression
      //     where every page silently fell back to "Loading route...")
      if (failed > 0 || empty > 0 || (ok === 0 && results.length > 0)) {
        process.exitCode = 1
      }
    } finally {
      await browser.close()
    }
  } finally {
    markShutdown()
    // Kill the entire process group (negative PID) so vite exits even
    // if it was spawned under a wrapper. Fall back to single-process
    // kill on Windows where process groups don't apply.
    try {
      if (process.platform === 'win32') {
        preview.kill('SIGTERM')
      } else if (preview.pid !== undefined) {
        process.kill(-preview.pid, 'SIGTERM')
      }
    } catch {
      // Already dead. Fine.
    }
    // Wait up to 5s for a clean exit, then SIGKILL the group. Without
    // this hard upper bound, a stuck vite preview (or its grandchild)
    // would hang the workflow until the runner's job timeout fires —
    // exactly the bug this fix targets.
    const exitDeadline = new Promise(resolveExit => preview.once('exit', resolveExit))
    const killDeadline = new Promise(resolveTimeout => setTimeout(resolveTimeout, 5_000))
    const winner = await Promise.race([
      exitDeadline.then(() => 'exit'),
      killDeadline.then(() => 'timeout'),
    ])
    if (winner === 'timeout') {
      try {
        if (process.platform === 'win32') {
          preview.kill('SIGKILL')
        } else if (preview.pid !== undefined) {
          process.kill(-preview.pid, 'SIGKILL')
        }
      } catch {
        // Already dead.
      }
      // Wait briefly for the SIGKILL to land, but don't block forever.
      await Promise.race([
        exitDeadline,
        new Promise(resolveTimeout => setTimeout(resolveTimeout, 2_000)),
      ])
    }
  }
}

main().catch(err => {
  const msg = err instanceof Error ? err.message : String(err)
  if (SKIP_ON_BROWSER_ERROR) {
    console.warn(
      `snap-routes: failed (${msg}). SNAP_SKIP_ON_BROWSER_ERROR=1 (or CF_PAGES=1) — ` +
      `treating as warning. Empty-body HTML will ship until the failure is fixed.`,
    )
    return
  }
  console.error(err)
  // Use exitCode (not process.exit) so the finally blocks in main()
  // get to fire — without this, vite preview leaks as a zombie process
  // and the random reserved port stays held for the rest of the CI run.
  process.exitCode = 1
})
