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

  test('pd setup is the one command that installs and arms the harness', () => {
    expect(installSection).toContain('arms the current project')
    expect(installSection).toContain('project hooks')
    expect(installSection).toContain('Coordination Guard')
    expect(installSection).toContain('FleetBar')
    expect(installSection).toContain('MCP')
    expect(installSection).toContain('Port Daddy Pilot')
  })

  test('doctor is the remediation surface instead of exposing repair chores', () => {
    expect(installSection).toContain('Let doctor fix drift')
    expect(installSection).toContain('doctor explains the concern and offers the remediation path')
    expect(installSection).toContain('What doctor watches')
    expect(installSection).toContain('hooks')
    expect(installSection).toContain('skills')
    expect(installSection).toContain('MCP')
    expect(installSection).not.toContain('pd squid hooks')
    expect(installSection).not.toContain('pd guard install --mode enforce')
    expect(installSection).not.toContain('Refresh the harness')
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

  test('it treats FleetBar as a signed setup-managed app, not manual zip work', () => {
    expect(installSection).toContain('The signed Mac menu-bar app')
    expect(installSection).toContain('installed by setup')
    expect(installSection).not.toMatch(/checksum|sha256|zip handling/i)
  })

  test('the retired /mcp route redirects into the Mac app page', () => {
    expect(mainSource).toContain('path="/mcp"')
    expect(mainSource).toMatch(/path="\/mcp"[\s\S]{0,80}Navigate to="\/mac-preview"/)
  })
})
