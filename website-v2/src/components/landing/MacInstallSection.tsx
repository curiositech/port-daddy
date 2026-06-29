import { Link } from 'react-router-dom'
import { Boxes, Cpu, PlugZap, Sparkles, Terminal, Wrench } from 'lucide-react'
import {
  CopyableCommandBlock,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { ProductLogoLockup, type ProductLogoKey } from '@/components/site/ProductLogos'
import { MCP_TOOL_TOTAL } from '@/data/mcp'
import type { ReactNode } from 'react'

/**
 * MacInstallSection — the single install story for Port Daddy on a Mac, folded
 * onto the Mac-app page (this replaces the retired standalone "Skills + MCP"
 * page). One `brew install … && pd setup` brings the daemon, the CLI, the MCP
 * server, the Port Daddy skill, the Pilot agent definitions, and FleetBar;
 * `pd mcp install` wires the harness into whichever agent you run.
 *
 * Every command here is quoted verbatim from the product's own README
 * (/Users/erichowens/coding/port-daddy/README.md) and is covered by the Mac
 * install contract test, so the page cannot drift from what actually installs.
 * Components that are NOT yet on Homebrew (the Rust core build, the Shipwright
 * GUI) are stated honestly rather than implied.
 */

interface Piece {
  icon: typeof Cpu
  name: string
  what: ReactNode
  how: string
}

const BREW_ONE_LINER = 'brew install curiositech/tap/port-daddy && pd setup'
const MCP_AGENT_LOGOS: ProductLogoKey[] = ['claude', 'codex', 'cursor', 'windsurf']

const PIECES: Piece[] = [
  {
    icon: Cpu,
    name: 'The daemon',
    what: 'The local coordination kernel — claims, sessions, ports, pub/sub. Runs from a signed binary, not a source server.',
    how: 'pd setup installs it',
  },
  {
    icon: Terminal,
    name: 'The CLI (pd)',
    what: 'Everything you type: pd claim, pd session, pd tube, pd salvage. Also carries the MCP stdio server in-process.',
    how: 'brew or npm install -g port-daddy',
  },
  {
    icon: PlugZap,
    name: 'The MCP server',
    what: (
      <>
        {MCP_TOOL_TOTAL}+ tools your agent calls directly. <Mono>pd mcp install</Mono> configures Claude Code,
        Claude Desktop, Codex CLI, Cursor, Windsurf, Gemini CLI, VS Code, Continue, and Cline.
        <span className="mt-[var(--space-2)] flex flex-wrap gap-2">
          {MCP_AGENT_LOGOS.map((product) => (
            <ProductLogoLockup key={product} product={product} size="compact" />
          ))}
        </span>
      </>
    ),
    how: 'pd mcp install',
  },
  {
    icon: Sparkles,
    name: 'The Pilot persona',
    what: 'The SKILL.md, references, and Port Daddy Pilot definitions that teach local agents how to coordinate before they edit.',
    how: 'pd setup or pd mcp install',
  },
  {
    icon: Boxes,
    name: 'FleetBar (the Mac app)',
    what: 'The menu-bar window above. Installed by pd setup, or download the signed build directly and verify its checksum.',
    how: 'pd setup, or signed .zip',
  },
]

export function MacInstallSection() {
  return (
    <section
      id="install"
      aria-labelledby="install-heading"
      className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <div className="max-w-[52rem] space-y-[var(--space-4)]">
          <PanelEyebrow>Install — skills, MCP, and the app</PanelEyebrow>
          <PanelTitle as="h2" size="display" className="max-w-[20ch]">
            Everything from one <span className="text-[var(--brand-primary)]">brew install</span>.
          </PanelTitle>
          <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
            One command sets up the daemon, the <Mono>pd</Mono> CLI, the MCP server, the Port Daddy skill, the Pilot
            agent definitions, and the FleetBar menu-bar app. Then one more wires the harness into whatever agent you
            run. No accounts, no cloud — it all runs on your machine.
          </PanelBody>
        </div>

        {/* The one-liner. */}
        <div className="mt-[var(--space-6)] max-w-[52rem]">
          <CopyableCommandBlock label="Install everything (macOS)" command={BREW_ONE_LINER} />
        </div>

        {/* What that one line brings. */}
        <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-2 lg:grid-cols-3">
          {PIECES.map((piece) => (
            <SurfacePanel key={piece.name} className="flex flex-col gap-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-3)]">
                <span className="inline-flex h-[32px] w-[32px] shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] text-[var(--brand-primary)]">
                  <piece.icon size={18} aria-hidden="true" />
                </span>
                <PanelTitle as="h3" size="card" className="normal-case">
                  {piece.name}
                </PanelTitle>
              </div>
              <PanelBody size="compact" className="max-w-none">
                {piece.what}
              </PanelBody>
              <code className="mt-auto block border border-[var(--border-default)] bg-[var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)]">
                {piece.how}
              </code>
            </SurfacePanel>
          ))}
        </div>

        {/* Wire it into your agent + verify. */}
        <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-2">
          <div className="space-y-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <PlugZap size={18} className="text-[var(--brand-primary)]" aria-hidden="true" />
              <PanelEyebrow className="text-[var(--brand-primary)]">Wire the MCP into your agent</PanelEyebrow>
            </div>
            <CopyableCommandBlock label="Configure every agent tool" command="pd mcp install" />
            <PanelBody size="compact" className="max-w-[60ch]">
              Detects your local agent tools, configures the MCP server, installs the shared skill, and writes the
              Port Daddy Pilot persona for Claude Code, Codex CLI, Gemini CLI, and generic AGENTS.md-aware tools. The
              <span className="mt-[var(--space-2)] flex flex-wrap gap-2">
                {MCP_AGENT_LOGOS.map((product) => (
                  <ProductLogoLockup key={product} product={product} size="compact" />
                ))}
              </span>
              The full <Mono>{MCP_TOOL_TOTAL}</Mono>-tool reference lives in{' '}
              <Link to="/docs/mcp" className="font-semibold text-[var(--brand-primary)] underline">
                the MCP docs
              </Link>
              .
            </PanelBody>
          </div>
          <div className="space-y-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <Wrench size={18} className="text-[var(--brand-primary)]" aria-hidden="true" />
              <PanelEyebrow className="text-[var(--brand-primary)]">Verify it&rsquo;s healthy</PanelEyebrow>
            </div>
            <DocsCodeBlock
              language="cli"
              label="Verify"
              code={'pd doctor   # check the environment\npd status   # the daemon, authoritatively'}
            />
            <PanelBody size="compact" className="max-w-[60ch]">
              Prefer npm? <Mono>npm install -g port-daddy</Mono>. Want the signed app on its own? Download and
              checksum-verify it below.
            </PanelBody>
          </div>
        </div>

        {/* The signed direct download (verbatim from README). */}
        <div className="mt-[var(--space-6)] max-w-[52rem] space-y-[var(--space-3)]">
          <PanelEyebrow>Or: the signed FleetBar build, on its own</PanelEyebrow>
          <DocsCodeBlock
            language="cli"
            label="Signed Mac app + checksum"
            code={[
              'curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip',
              'curl -LO https://portdaddy.dev/downloads/PortDaddy-FleetBar-macOS-arm64.zip.sha256',
              'shasum -a 256 -c PortDaddy-FleetBar-macOS-arm64.zip.sha256',
              'unzip PortDaddy-FleetBar-macOS-arm64.zip',
            ].join('\n')}
          />
        </div>

        {/* Honest scope note — what is NOT a brew formula yet. */}
        <p className="mt-[var(--space-5)] max-w-[60ch] text-[length:var(--type-panel-body-compact-size)] leading-relaxed text-[var(--text-muted)]">
          Honest scope: the Rust core can be built from source (<Mono>npm run build:core</Mono>) but is not yet its
          own Homebrew formula, and the Shipwright desktop GUI is still in development, not released. Everything
          above ships today.
        </p>
      </PageContainer>
    </section>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[var(--brand-primary)]">{children}</code>
}
