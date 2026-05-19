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

  // Start `vite preview` against the existing dist/. The server
  // exits when we kill it after the run.
  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: websiteRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
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
    const browser = await chromium.launch({ headless: true })
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
      const skipped = results.length - ok - failed
      console.log(`snap-routes: ${ok} captured, ${skipped} skipped, ${failed} failed`)
      if (failed > 0) process.exitCode = 1
    } finally {
      await browser.close()
    }
  } finally {
    markShutdown()
    preview.kill('SIGTERM')
    await new Promise(resolveExit => preview.once('exit', resolveExit))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
