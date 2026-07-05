import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Mac install contract.
 *
 * The Mac app page is the single install surface (the old Skills+MCP page was
 * merged into it). These tests guard the install instructions against drift:
 * every command shown to a user must be the real, current one, and the page
 * must not imply you can Homebrew-install components that aren't shipped yet.
 *
 * The canonical commands below are quoted from the product's own README
 * (port-daddy/README.md). The runnable end-to-end check that these actually
 * install on a Mac lives in scripts/test-mac-install.sh (gated behind
 * RUN_MAC_INSTALL_TEST=1 so it never runs in normal unit test runs).
 */

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

const installSection = read('./components/landing/MacInstallSection.tsx')
const distributionSection = read('./components/landing/DistributionSection.tsx')
const productData = read('./data/product.ts')
const ctaBanner = read('./components/landing/CTABanner.tsx')
const installCtaSection = read('./components/landing/InstallCTASection.tsx')
const macAppShowcase = read('./components/landing/MacAppShowcase.tsx')
const gettingStartedTutorial = read('./pages/tutorials/GettingStarted.tsx')
const quickstartDocs = read('./pages/docs/QuickStart.tsx')
const mcpData = read('./data/mcp.ts')
const macPage = read('./pages/MacPreviewPage.tsx')
const mainSource = read('./main.tsx')
const siteHeader = read('./components/site/SiteHeader.tsx')

/** The real, current public commands. If the product changes these, this list
 *  must change too — and that is the point: the page can't silently drift. */
const REQUIRED_COMMANDS = [
  'pd setup',
  'pd doctor',
  'pd squid codex --tier strong',
]

describe('mac install contract', () => {
  test('the Mac page renders the install section', () => {
    expect(macPage).toContain('MacInstallSection')
    expect(macPage).toContain('<MacInstallSection />')
  })

  test('top navigation links directly to the install section', () => {
    expect(siteHeader).toContain('label: "Install"')
    expect(siteHeader).toContain('href: "/mac-preview#install"')
  })

  test('every documented install command is present and verbatim', () => {
    for (const command of REQUIRED_COMMANDS) {
      expect(installSection, `missing install command: ${command}`).toContain(command)
    }
  })

  test('pd setup is the one command that installs and connects the project', () => {
    expect(installSection).toContain('adds Squid hooks plus Coordination Guard')
    expect(installSection).toContain('project hooks')
    expect(installSection).toContain('Coordination Guard')
    expect(installSection).toContain('FleetBar')
    expect(installSection).toContain('MCP')
    expect(installSection).toContain('Port Daddy Pilot')
  })

  test('doctor is the repair surface instead of exposing repair chores', () => {
    expect(installSection).toContain('Let doctor fix it')
    expect(installSection).toContain('doctor explains the concern and shows the fix')
    expect(installSection).toContain('What doctor watches')
    expect(installSection).toContain('hooks')
    expect(installSection).toContain('skills')
    expect(installSection).toContain('MCP')
    expect(installSection).not.toContain('pd squid hooks')
    expect(installSection).not.toContain('pd guard install --mode enforce')
    expect(installSection).not.toContain('Refresh the harness')
    expect(installSection).not.toContain('remediation path')
  })

  test('the page names hooks as the enforceable harness layer, not just agent instructions', () => {
    expect(installSection).toContain('pre-turn briefing')
    expect(installSection).toContain('pre-tool safety gate')
    expect(installSection).toContain('post-tool coordination trace')
  })

  test('the page names Squid as the bridge layer for Claude-shaped clients', () => {
    expect(installSection).toContain('Bridge a Claude-shaped client')
    expect(installSection).toContain('Anthropic-compatible bridge')
    expect(installSection).toContain('Codex CLI')
    expect(installSection).toContain('pd squid codex --tier strong')
    expect(installSection).not.toMatch(/claude-sonnet-\d/i)
  })

  test('install commands are individually copyable real commands, not prose fragments', () => {
    expect(installSection).toContain('function CopyableInlineCommand')
    expect(installSection).toContain('navigator.clipboard.writeText(command)')
    expect(installSection).not.toContain('brew or npm install -g port-daddy')
    expect(installSection).not.toContain('pd setup or pd mcp install')
    expect(installSection).not.toContain('pd setup, or signed .zip')
    expect(installSection).not.toContain('npm install -g port-daddy')
    expect(installSection).not.toContain('curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar')
    expect(installSection).not.toContain('shasum -a 256')
    expect(installSection).not.toContain('unzip PortDaddy-FleetBar')
  })

  test('the install explanation ships theme-aware house-style art', () => {
    expect(installSection).toContain('ThemedImage')
    expect(installSection).toContain('/img/generated/install-one-command.webp')
    expect(installSection).toContain('ship-control-room illustration')
  })

  test('it names the agent tools setup configures', () => {
    for (const tool of ['Claude Code', 'Cursor', 'Windsurf', 'Gemini CLI', 'VS Code', 'Continue', 'Cline']) {
      expect(installSection, `setup should mention ${tool}`).toContain(tool)
    }
    expect(installSection).toContain('Codex CLI')
    expect(installSection).toContain('Port Daddy Pilot')
  })

  test('it treats FleetBar as setup-managed app, not manual zip work', () => {
    const publicInstallSources = [
      installSection,
      distributionSection,
      productData,
      ctaBanner,
      installCtaSection,
      macAppShowcase,
      gettingStartedTutorial,
      quickstartDocs,
      mcpData,
    ].join('\n')

    expect(installSection).toContain('The Mac menu-bar app')
    expect(installSection).toContain('installed by setup')
    expect(distributionSection).toContain('FleetBar comes with setup')
    expect(distributionSection).toContain('Run setup once')
    expect(distributionSection).toContain('The happy path is setup, then FleetBar')
    expect(ctaBanner).toContain('brew install curiositech/tap/port-daddy')
    expect(ctaBanner).toContain('pd setup')
    expect(installCtaSection).toContain('Setup connects the app, daemon, MCP server')
    expect(installCtaSection).toContain('Run doctor when something stops lining up')
    expect(macAppShowcase).toContain('pd setup adds FleetBar')
    expect(gettingStartedTutorial).toContain('pd doctor')
    expect(quickstartDocs).toContain('pd setup')
    expect(mcpData).toContain('"command": "pd"')
    expect(installSection).not.toMatch(/checksum|sha256|zip handling/i)
    expect(distributionSection).not.toMatch(/checksum|sha-?256|shasum|unzip|not stapled|Open Anyway|preview|manifest|provenance|Developer ID|signed/i)
    expect(publicInstallSources).not.toContain('npm install -g port-daddy')
    expect(publicInstallSources).not.toContain('shasum -a 256')
    expect(publicInstallSources).not.toContain('unzip PortDaddy-FleetBar')
    expect(publicInstallSources).not.toMatch(/ad-hoc signed FleetBar preview|Developer ID signing and\s+notarization move into the release channel|signed FleetBar|signed app|release artifacts|provenance/i)
    expect(publicInstallSources).not.toMatch(/harness remediation|wire the harness|launchd ownership|diagnose drift|remediation path|wires the harness|guardrails/i)
    expect(productData).not.toContain("id: 'npm'")
  })

  test('the retired /mcp route redirects into the Mac app page', () => {
    expect(mainSource).toContain('path="/mcp"')
    expect(mainSource).toMatch(/path="\/mcp"[\s\S]{0,80}Navigate to="\/mac-preview"/)
  })
})
