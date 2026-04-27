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
const reportPath = path.join(reportDir, 'mcp-a11y-report.json')
const desktopScreenshotPath = path.join(screenshotDir, 'mcp-a11y-desktop.png')
const mobileScreenshotPath = path.join(screenshotDir, 'mcp-a11y-mobile.png')
const axePath = require.resolve('axe-core/axe.min.js')
const port = Number(process.env.A11Y_PORT ?? 3110)
const targetUrl = process.env.A11Y_TARGET_URL ?? `http://127.0.0.1:${port}/mcp`

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
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

async function assertSelectedTab(page, expectedLabel) {
  const selected = page.locator('[role="tab"][aria-selected="true"]')
  const text = (await selected.innerText()).trim()
  if (text !== expectedLabel) {
    throw new Error(`expected selected tab "${expectedLabel}", got "${text}"`)
  }
}

async function runKeyboardChecks(page) {
  await page.goto(targetUrl, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: /A control plane your agents can actually use\./ }).waitFor()

  const tabs = page.locator('[role="tab"]')
  const tabCount = await tabs.count()
  if (tabCount !== 4) throw new Error(`expected 4 MCP channel tabs, got ${tabCount}`)

  await assertSelectedTab(page, 'CLI')
  await tabs.nth(0).focus()
  await page.keyboard.press('ArrowDown')
  await assertSelectedTab(page, 'MCP')
  await page.keyboard.press('ArrowRight')
  await assertSelectedTab(page, 'SDK')
  await page.keyboard.press('End')
  await assertSelectedTab(page, 'REST API')
  await page.keyboard.press('Home')
  await assertSelectedTab(page, 'CLI')

  const focusVisible = await tabs.nth(0).evaluate((element) => {
    const style = window.getComputedStyle(element)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    }
  })

  if (focusVisible.outlineStyle === 'none' || focusVisible.outlineWidth === '0px') {
    throw new Error(`focused tab lacks visible outline: ${JSON.stringify(focusVisible)}`)
  }

  return {
    tabCount,
    rovingKeys: ['ArrowDown', 'ArrowRight', 'End', 'Home'],
    focusVisible,
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
    await waitForServer(targetUrl, server)
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })

    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: /A control plane your agents can actually use\./ }).waitFor()
    const desktopOverflow = await assertNoHorizontalOverflow(page, 'desktop')
    const desktopAxe = await runAxe(page)
    await page.screenshot({ path: desktopScreenshotPath })

    await page.setViewportSize({ width: 390, height: 1200 })
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: /A control plane your agents can actually use\./ }).waitFor()
    const mobileOverflow = await assertNoHorizontalOverflow(page, 'mobile')
    const mobileAxe = await runAxe(page)
    await page.screenshot({ path: mobileScreenshotPath })

    const keyboard = await runKeyboardChecks(page)
    const violations = [
      ...summarizeViolations(desktopAxe.violations).map((violation) => ({ viewport: 'desktop', ...violation })),
      ...summarizeViolations(mobileAxe.violations).map((violation) => ({ viewport: 'mobile', ...violation })),
    ]

    const report = {
      generatedAt: new Date().toISOString(),
      targetUrl,
      axe: {
        standard: 'wcag2a/wcag2aa/wcag21a/wcag21aa/wcag22aa plus color-contrast-enhanced',
        desktopViolations: desktopAxe.violations.length,
        mobileViolations: mobileAxe.violations.length,
        violations,
      },
      keyboard,
      overflow: {
        desktop: desktopOverflow,
        mobile: mobileOverflow,
      },
      screenshots: {
        desktop: path.relative(repoRoot, desktopScreenshotPath),
        mobile: path.relative(repoRoot, mobileScreenshotPath),
      },
    }

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)

    if (violations.length > 0) {
      throw new Error(`axe found ${violations.length} violation(s); see ${path.relative(repoRoot, reportPath)}`)
    }

    console.log(`MCP accessibility checks passed: ${path.relative(repoRoot, reportPath)}`)
  } finally {
    if (browser) await browser.close()
    if (server) {
      server.kill('SIGTERM')
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
