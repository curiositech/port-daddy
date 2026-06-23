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

/** The real, current install commands. If the product changes these, this list
 *  must change too — and that is the point: the page can't silently drift. */
const REQUIRED_COMMANDS = [
  'brew install curiositech/tap/port-daddy',
  'pd setup',
  'npm install -g port-daddy',
  'pd mcp install',
  'pd doctor',
  'pd status',
  'curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip',
  'shasum -a 256 -c PortDaddy-FleetBar-macOS-arm64.zip.sha256',
  'unzip PortDaddy-FleetBar-macOS-arm64.zip',
]

describe('mac install contract', () => {
  test('the Mac page renders the install section', () => {
    expect(macPage).toContain('MacInstallSection')
    expect(macPage).toContain('<MacInstallSection />')
  })

  test('every documented install command is present and verbatim', () => {
    for (const command of REQUIRED_COMMANDS) {
      expect(installSection, `missing install command: ${command}`).toContain(command)
    }
  })

  test('the brew one-liner sets up the daemon, MCP, skill, and FleetBar together', () => {
    // The headline command must chain brew install with pd setup so a single
    // copy/paste produces a working install, not just a downloaded binary.
    expect(installSection).toContain('brew install curiositech/tap/port-daddy && pd setup')
  })

  test('it names the agent tools pd mcp install configures', () => {
    for (const tool of ['Claude Code', 'Cursor', 'Windsurf', 'VS Code', 'Continue', 'Cline']) {
      expect(installSection, `pd mcp install should mention ${tool}`).toContain(tool)
    }
  })

  test('it does NOT claim unreleased components are Homebrew-installable', () => {
    // The Rust GUI (Shipwright) is not released and the Rust core is not its own
    // formula. The page must be honest about that rather than implying a brew cask.
    expect(installSection).toMatch(/not yet|development|build:core|from source/i)
    expect(installSection).not.toMatch(/brew (install|tap)[^\n]*shipwright/i)
  })

  test('the retired /mcp route redirects into the Mac app page', () => {
    expect(mainSource).toContain('path="/mcp"')
    expect(mainSource).toMatch(/path="\/mcp"[\s\S]{0,80}Navigate to="\/mac-preview"/)
  })
})
