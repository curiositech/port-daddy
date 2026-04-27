import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const websiteRoot = path.resolve(scriptDir, '..')
const repoRoot = path.resolve(websiteRoot, '..')
const reportDir = path.join(repoRoot, 'docs/reports/website-rehab-a11y')
const screenshotDir = path.join(repoRoot, 'docs/reports/website-rehab-screenshots')
const reportPath = path.join(reportDir, 'public-shell-a11y-report.json')
const axePath = require.resolve('axe-core/axe.min.js')
const port = Number(process.env.A11Y_PORT ?? 3111)
const baseUrl = process.env.A11Y_TARGET_URL ?? `http://127.0.0.1:${port}`

const routes = [
  { id: 'home', path: '/', label: 'home' },
  { id: 'docs', path: '/docs', label: 'docs' },
  { id: 'mcp', path: '/mcp', label: 'mcp' },
  { id: 'blog', path: '/blog', label: 'blog' },
]

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function routeUrl(routePath) {
  return new URL(routePath, baseUrl).toString()
}

async function waitForServer(url, serverProcess) {
  const deadline = Date.now() + 30_000
  let lastError = ''

  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) {
      throw new Error(`dev server exited before readiness with code ${serverProcess.exitCode}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`timed out waiting for ${url}: ${lastError}`)
}

function summarizeViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      failureSummary: node.failureSummary,
    })),
  }))
}

async function runAxe(page) {
  await page.addScriptTag({ path: axePath })
  return page.evaluate(async () => {
    return window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'wcag2aaa'],
      },
      rules: {
        'color-contrast-enhanced': { enabled: true },
      },
    })
  })
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))

  const largest = Math.max(metrics.scrollWidth, metrics.bodyScrollWidth)
  if (largest > metrics.clientWidth + 1) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(metrics)}`)
  }

  return metrics
}

async function assertShellStructure(page, label) {
  const counts = await page.evaluate(() => ({
    headers: document.querySelectorAll('header').length,
    shellHeaders: document.querySelectorAll('header[data-shell="site-header"]').length,
    footers: document.querySelectorAll('footer').length,
    mains: document.querySelectorAll('#main-content').length,
    primaryNavs: document.querySelectorAll('nav[aria-label="Primary"]').length,
    mobileNavs: document.querySelectorAll('nav[aria-label="Mobile primary"]').length,
  }))

  if (counts.shellHeaders !== 1) throw new Error(`${label} expected 1 site shell header, got ${counts.shellHeaders}`)
  if (counts.footers !== 1) throw new Error(`${label} expected 1 footer, got ${counts.footers}`)
  if (counts.mains !== 1) throw new Error(`${label} expected 1 #main-content, got ${counts.mains}`)
  if (counts.primaryNavs !== 1) throw new Error(`${label} expected 1 primary nav, got ${counts.primaryNavs}`)
  if (counts.mobileNavs !== 1) throw new Error(`${label} expected 1 mobile primary nav, got ${counts.mobileNavs}`)

  await page.keyboard.press('Tab')
  const skipLink = await page.evaluate(() => {
    const element = document.activeElement
    const style = element ? window.getComputedStyle(element) : null
    return {
      text: element?.textContent?.trim() ?? '',
      outlineStyle: style?.outlineStyle ?? '',
      outlineWidth: style?.outlineWidth ?? '',
    }
  })

  if (skipLink.text !== 'Skip to main content') {
    throw new Error(`${label} first tab stop should be skip link, got "${skipLink.text}"`)
  }
  if (skipLink.outlineStyle === 'none' || skipLink.outlineWidth === '0px') {
    throw new Error(`${label} skip link lacks visible focus: ${JSON.stringify(skipLink)}`)
  }

  return counts
}

async function settleViewportTriggeredContent(page) {
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight
    const step = Math.max(window.innerHeight * 0.75, 320)

    for (let y = 0; y <= height; y += step) {
      window.scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }

    window.scrollTo(0, 0)
    await new Promise((resolve) => setTimeout(resolve, 240))
  })
}

async function auditRoute(page, route, viewportName, viewport) {
  await page.setViewportSize(viewport)
  await page.goto(routeUrl(route.path), { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('#main-content').waitFor()
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {})

  const label = `${route.label} ${viewportName}`
  const shell = await assertShellStructure(page, label)
  await settleViewportTriggeredContent(page)
  const overflow = await assertNoHorizontalOverflow(page, label)
  const axe = await runAxe(page)
  const screenshotPath = path.join(screenshotDir, `shell-${route.id}-${viewportName}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })

  return {
    route: route.path,
    viewport: viewportName,
    shell,
    overflow,
    axeViolations: axe.violations.length,
    violations: summarizeViolations(axe.violations),
    screenshot: path.relative(repoRoot, screenshotPath),
  }
}

async function main() {
  await mkdir(reportDir, { recursive: true })
  await mkdir(screenshotDir, { recursive: true })

  const ownsServer = !process.env.A11Y_TARGET_URL
  const server = ownsServer
    ? spawn(npmCommand(), ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: websiteRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null

  if (server) {
    server.stdout.on('data', () => {})
    server.stderr.on('data', () => {})
  }

  let browser

  try {
    await waitForServer(routeUrl('/'), server)
    browser = await chromium.launch()
    const page = await browser.newPage()
    const results = []

    for (const route of routes) {
      results.push(await auditRoute(page, route, 'desktop', { width: 1440, height: 1200 }))
      results.push(await auditRoute(page, route, 'mobile', { width: 390, height: 1200 }))
    }

    const violations = results.flatMap((result) =>
      result.violations.map((violation) => ({
        route: result.route,
        viewport: result.viewport,
        ...violation,
      })),
    )

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      axe: {
        standard: 'wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa/wcag2aaa plus color-contrast-enhanced',
        violations: violations.length,
      },
      routes: results,
    }

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    if (violations.length > 0) {
      throw new Error(`public shell axe found ${violations.length} violation(s); see ${path.relative(repoRoot, reportPath)}`)
    }

    console.log(`Public shell accessibility checks passed: ${path.relative(repoRoot, reportPath)}`)
  } finally {
    if (browser) await browser.close()
    if (server) server.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
