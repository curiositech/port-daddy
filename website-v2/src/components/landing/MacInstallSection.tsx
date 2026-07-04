import { Link } from 'react-router-dom'
import { Check, Copy, Cpu, PlugZap, ShieldCheck, Terminal, Wrench } from 'lucide-react'
import {
  CopyableCommandBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { ProductLogoLockup, type ProductLogoKey } from '@/components/site/ProductLogos'
import { ThemedImage } from '@/components/site/ThemedImage'
import { MCP_TOOL_TOTAL } from '@/data/mcp'
import { useState, type ReactNode } from 'react'

/**
 * MacInstallSection is the single public install story: run setup, let doctor
 * repair problems, and use Squid only when you intentionally want a compatibility
 * bridge. FleetBar is installed by setup, so this page does not ask humans to
 * perform manual app-install work.
 */

type InstallLane = {
  icon: typeof Cpu
  badge: string
  title: string
  body: ReactNode
  command: string
}

const SETUP_COMMAND = 'pd setup'
const DOCTOR_COMMAND = 'pd doctor'
const SQUID_BRIDGE_COMMAND = 'pd squid codex --tier strong'
const MCP_AGENT_LOGOS: ProductLogoKey[] = ['claude', 'codex', 'cursor', 'windsurf']

const INSTALL_LANES: InstallLane[] = [
  {
    icon: Cpu,
    badge: 'Default',
    title: 'Install and connect everything',
    body: (
      <>
        Starts the local daemon, installs the <Mono>pd</Mono> CLI, connects MCP, refreshes the Port Daddy Pilot skill,
        installs FleetBar, and adds Squid hooks plus Coordination Guard to the current project.
      </>
    ),
    command: SETUP_COMMAND,
  },
  {
    icon: Wrench,
    badge: 'Repair',
    title: 'Let doctor fix it',
    body: (
      <>
        Checks whether hooks, skills, MCP wiring, FleetBar, and the daemon still match the project. When something is
        missing or user-edited, doctor explains the concern and shows the fix.
      </>
    ),
    command: DOCTOR_COMMAND,
  },
  {
    icon: PlugZap,
    badge: 'Optional',
    title: 'Bridge a Claude-shaped client',
    body: (
      <>
        Starts a local Anthropic-compatible bridge, launches the default Claude-shaped client, and routes the work
        through Codex CLI at the requested capability tier. This is a compatibility layer, not Claude auth.
      </>
    ),
    command: SQUID_BRIDGE_COMMAND,
  },
]

const INCLUDED = [
  { name: 'Daemon', detail: 'Local coordination kernel for sessions, ports, claims, notes, tubes, and salvage.' },
  { name: 'CLI', detail: 'The operator and agent command surface, including the MCP stdio server.' },
  { name: 'MCP', detail: `${MCP_TOOL_TOTAL}+ tools for Claude Code, Codex CLI, Gemini CLI, Cursor, Windsurf, VS Code, Continue, and Cline.` },
  { name: 'Pilot', detail: 'Shared Port Daddy agent skill and Pilot definitions that teach agents the contract.' },
  { name: 'FleetBar', detail: 'The Mac menu-bar app, installed by setup as part of the default path.' },
  { name: 'Hooks', detail: 'Local pre-turn briefing, pre-tool safety gate, and post-tool coordination trace.' },
] as const

export function MacInstallSection() {
  return (
    <section
      id="install"
      aria-labelledby="install-heading"
      className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <div className="max-w-[54rem] space-y-[var(--space-4)]">
          <PanelEyebrow>Install — runtime, hooks, Squid, MCP, and the app</PanelEyebrow>
          <PanelTitle as="h2" id="install-heading" size="display" className="max-w-[19ch]">
            One setup command. One health command.
          </PanelTitle>
          <PanelBody className="max-w-[48rem] text-[length:var(--text-lg)]">
            Run <Mono>pd setup</Mono> once. It installs the local runtime, FleetBar, MCP, skills, hooks, and project checks
            for the current project. Run <Mono>pd doctor</Mono> when any of those pieces stop lining up. Squid is
            optional, for people who intentionally want Claude-shaped traffic backed by another runner.
          </PanelBody>
        </div>

        <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-stretch">
          <SurfacePanel className="flex flex-col justify-between gap-[var(--space-4)]">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow>Default path</PanelEyebrow>
              <PanelTitle as="h3" size="card" className="max-w-[19ch]">
                Bring the project online.
              </PanelTitle>
              <PanelBody size="compact" className="max-w-none">
                Setup starts the daemon, CLI, MCP, Pilot, FleetBar, and project hooks. It names
                what it installs and keeps the privacy boundary local: hooks do not log or retain user transcripts.
              </PanelBody>
            </div>
            <CopyableCommandBlock label="Install this project" command={SETUP_COMMAND} />
          </SurfacePanel>

          <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            <ThemedImage
              src="/img/generated/install-one-command.webp"
              alt="A Port Daddy ship-control-room illustration: sailors pull one setup lever, the daemon and app modules light up, and cables route them into agent stations."
              className="aspect-[16/9] w-full object-cover"
              loading="eager"
            />
            <figcaption className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--type-meta-size)] font-semibold leading-snug text-[var(--text-secondary)]">
              Setup brings the runtime aboard and connects the project. Doctor checks it when tools, hooks, or skills stop lining up.
            </figcaption>
          </figure>
        </div>

        <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-3">
          {INSTALL_LANES.map((lane) => (
            <SurfacePanel key={lane.title} className="flex flex-col gap-[var(--space-3)]">
              <div className="flex items-start justify-between gap-[var(--space-3)]">
                <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] text-[var(--brand-primary)]">
                  <lane.icon size={18} aria-hidden="true" />
                </span>
                <PanelEyebrow className="text-right text-[var(--brand-primary)]">{lane.badge}</PanelEyebrow>
              </div>
              <PanelTitle as="h3" size="card" className="normal-case">
                {lane.title}
              </PanelTitle>
              <PanelBody size="compact" className="max-w-none">
                {lane.body}
              </PanelBody>
              <div className="mt-auto">
                <CopyableInlineCommand command={lane.command} />
              </div>
            </SurfacePanel>
          ))}
        </div>

        <div className="mt-[var(--space-6)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.84fr)]">
          <SurfacePanel className="space-y-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <ShieldCheck size={18} className="text-[var(--brand-primary)]" aria-hidden="true" />
              <PanelEyebrow className="text-[var(--brand-primary)]">Included in setup</PanelEyebrow>
            </div>
            <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <div key={item.name} className="bg-[var(--surface-base)] p-[var(--space-3)]">
                  <PanelTitle as="h4" size="nav" className="max-w-none">
                    {item.name}
                  </PanelTitle>
                  <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                    {item.detail}
                  </PanelBody>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {MCP_AGENT_LOGOS.map((product) => (
                <ProductLogoLockup key={product} product={product} size="compact" />
              ))}
            </div>
          </SurfacePanel>

          <SurfacePanel className="space-y-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <Terminal size={18} className="text-[var(--brand-primary)]" aria-hidden="true" />
              <PanelEyebrow className="text-[var(--brand-primary)]">What doctor watches</PanelEyebrow>
            </div>
            <PanelTitle as="h3" size="card">
              Misconfiguration should announce itself.
            </PanelTitle>
            <PanelBody size="compact" className="max-w-none">
              If an agent disables hooks, edits the shared skill, loses MCP tools, or cannot reach FleetBar or the daemon,
              doctor tells the operator which part of the setup stopped matching the project and how Port Daddy
              can repair it.
            </PanelBody>
            <CopyableCommandBlock label="Check and repair drift" command={DOCTOR_COMMAND} />
            <PanelBody size="compact" className="max-w-none">
              Need the API shape? The full tool reference lives in{' '}
              <Link to="/docs/mcp" className="font-semibold text-[var(--brand-primary)] underline">
                the MCP docs
              </Link>
              .
            </PanelBody>
          </SurfacePanel>
        </div>

        <p className="mt-[var(--space-5)] max-w-[62ch] text-[length:var(--type-panel-body-compact-size)] leading-relaxed text-[var(--text-muted)]">
          Privacy boundary: local hooks are named plainly when installed. They do not log or retain user transcripts.
          Any future transcript sync, such as phone control of the daemon, belongs behind explicit product consent,
          encryption, and a privacy agreement.
        </p>
      </PageContainer>
    </section>
  )
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[var(--brand-primary)]">{children}</code>
}

function CopyableInlineCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copyCommand}
      className="group flex min-h-[2.75rem] w-full items-center justify-between gap-[var(--space-2)] border border-[var(--border-default)] bg-[var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] text-left font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--brand-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
      aria-label={`Copy command: ${command}`}
      title={copied ? 'Copied' : `Copy ${command}`}
    >
      <code className="min-w-0 break-words">{command}</code>
      <span className="inline-flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center border border-current bg-[var(--surface-base)]">
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </span>
    </button>
  )
}
