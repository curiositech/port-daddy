import { Link } from 'react-router-dom'
import { ArrowRight, Cloud, Cpu, KeyRound, Waves } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLink,
  CommandBlock,
  DocsCodeBlock,
  DocsHero,
  DocsNoteCard,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const lanes = [
  {
    icon: KeyRound,
    label: 'ChatGPT Pro lane',
    title: 'Claude-shaped client, Codex-backed work.',
    copy:
      'Run Claude Code against a local Anthropic-compatible endpoint while the actual work goes through the authenticated Codex CLI already on your machine.',
    command: 'pd squid codex --tier strong',
  },
  {
    icon: Cpu,
    label: 'Ollama lane',
    title: 'Local models stay inside the harness.',
    copy:
      'Use Ollama for cheap or offline agents. It gets the same Port Daddy claims, budgets, notes, hook gates, and recovery trail as every paid backend.',
    command: 'pd spawn --backend ollama --model qwen2.5-coder:7b -- "review this diff"',
  },
  {
    icon: Cloud,
    label: 'Cloudflare lane',
    title: 'Cheap remote inference when a seat is wrong.',
    copy:
      'Cloudflare Workers AI is the remote fallback when you do not want to spend a local subscription seat or when the job belongs off-machine.',
    command: 'pd spawn --backend cloudflare --model @cf/zai-org/glm-4.7-flash -- "triage flaky tests"',
  },
] as const

const installSteps = [
  {
    label: 'Setup',
    title: 'Install and arm the harness',
    body: 'Setup starts the daemon, installs FleetBar, wires MCP, refreshes the shared Port Daddy skill, and installs the project hooks that make the agent accountable.',
    command: 'pd setup',
  },
  {
    label: 'Doctor',
    title: 'Repair drift when tools change',
    body: 'Doctor checks the daemon, app, hooks, skills, MCP wiring, and bridge prerequisites. If a user or tool modified the harness, doctor names the problem and offers remediation.',
    command: 'pd doctor',
  },
] as const

function AsciiBridge() {
  return (
    <SurfacePanel className="space-y-[var(--space-4)]" elevation="raised">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <PanelEyebrow>Charm terminal shape</PanelEyebrow>
        <Waves size={20} className="text-[var(--brand-primary)]" />
      </div>
      <pre className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--code-bg)] p-[var(--space-4)] text-[13px] leading-[1.45] text-[var(--code-text)]">
        {`╭─ Giant Squid :: Claude-shaped local bridge ───────────────╮
│ Base URL  http://127.0.0.1:8765                            │
│ Auth      generated per run                                │
│ Tier      strong                                           │
│ Backend   codex exec                                       │
│ Use now   client launched with Anthropic env injected       │
├─────────────────────────────────────────────────────────────┤
│ Hooks     pre-tool veto  post-tool trail  prompt attention  │
│ Skill     port-daddy-agent-skill                            │
│ MCP       sessions  claims  notes  locks  salvage  messages │
╰─────────────────────────────────────────────────────────────╯`}
      </pre>
      <PanelBody size="compact" className="max-w-none">
        The pretty output degrades to plain lines under <code>NO_COLOR</code>, pipes, and non-TTY
        runs. Scripts still get predictable text; humans get the good title card.
      </PanelBody>
    </SurfacePanel>
  )
}

export default function SquidCodexPage() {
  return (
    <div className="space-y-[var(--space-8)] py-[var(--space-7)] lg:space-y-[var(--space-9)] lg:py-[var(--space-8)]">
      <PageContainer width="wide">
        <DocsHero
          eyebrow="Giant Squid bridge"
          title="Run Claude Code with Codex and your ChatGPT Pro subscription."
          titleClassName="!max-w-[18ch]"
          summary="Port Daddy serves a local Claude-shaped endpoint, launches a Claude-compatible client into it, and sends the actual work through Codex CLI. You keep the Claude Code workflow shape while spending against the ChatGPT Pro login you already use."
          paragraphs={[
            <>
              This is not official Claude auth. It is an honest local compatibility bridge: Anthropic
              Messages in, Codex CLI out, Port Daddy harness around the whole thing.
            </>,
            <>
              The same harness can also wrap Ollama and Cloudflare Workers AI. The point is not one
              model. The point is one contract: hooks, skills, MCP tools, budgets, notes, claims,
              and recoverable work no matter which backend answered.
            </>,
          ]}
          aside={
            <SurfacePanel>
              <div className="space-y-[var(--panel-gap)]">
                <CommandBlock
                  title="Start the bridge"
                  command={'pd squid codex --tier strong'}
                  label="One command"
                  tone="blue"
                />
                <PanelBody size="compact" className="max-w-none">
                  The bridge generates a fresh local token, injects it into the launched client, and
                  refuses remote binds unless you set strong auth explicitly.
                </PanelBody>
              </div>
            </SurfacePanel>
          }
        />
      </PageContainer>

      <PageContainer width="wide">
        <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          <img
            alt="Port Daddy harness topology showing client hooks, MCP tools, agent sessions, backend lanes, and the local bridge boundary."
            src="/img/generated/harness-contract-topology-light.png"
            className="block w-full"
            loading="lazy"
          />
          <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            Claude-compatible clients, Codex CLI, Ollama, and Cloudflare all enter the same harness
            contract. Different engines, one operator record.
          </figcaption>
        </figure>
      </PageContainer>

      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SwissGrid className="items-start gap-y-[var(--space-7)]">
            <SwissGridItem span="narrow">
              <div className="sticky top-28 space-y-[var(--space-4)]">
                <PanelEyebrow>Use it now</PanelEyebrow>
                <PanelTitle as="h2" size="display">
                  The syntactic sugar is the point.
                </PanelTitle>
                <PanelBody>
                  The long form still exists for debugging. The day-to-day command should read like
                  the thing you mean: run Claude-shaped work through Codex.
                </PanelBody>
                <BracketLink to="/harness">See the full harness contract</BracketLink>
              </div>
            </SwissGridItem>
            <SwissGridItem span="wide" className="grid gap-[var(--space-4)]">
              <CommandBlock
                title="Claude Code through Codex"
                command={'pd squid codex --tier strong'}
                label="Sugar"
              />
              <CommandBlock
                title="Mid-tier bridge"
                command={'pd squid codex --tier mid'}
                label="Tier"
              />
              <CommandBlock
                title="Debug the bridge directly"
                command={'pd squid serve --port 8765\ncurl -H "authorization: Bearer $ANTHROPIC_AUTH_TOKEN" http://127.0.0.1:8765/health'}
                label="Serve only"
              />
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <div className="grid gap-[var(--space-5)] lg:grid-cols-3">
            {lanes.map((lane) => {
              const Icon = lane.icon
              return (
                <DocsNoteCard key={lane.label} label={lane.label} title={lane.title} className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center border-2 border-[var(--border-strong)] text-[var(--brand-primary)]">
                    <Icon size={22} />
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {lane.copy}
                  </PanelBody>
                  <DocsCodeBlock code={lane.command} label={lane.label} variant="compact" />
                </DocsNoteCard>
              )
            })}
          </div>
        </PageContainer>
      </section>

      <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
        <PageContainer width="wide">
          <SwissGrid className="items-start gap-y-[var(--space-7)]">
            <SwissGridItem span="narrow">
              <div className="sticky top-28 space-y-[var(--space-4)]">
                <PanelEyebrow>Install the harness</PanelEyebrow>
                <PanelTitle as="h2" size="display">
                  Setup, then doctor.
                </PanelTitle>
                <PanelBody>
                  A bridge without the harness is just translation. Setup gives the client
                  guardrails and callable Port Daddy tools. Doctor tells you when that contract
                  has drifted and how to fix it.
                </PanelBody>
              </div>
            </SwissGridItem>
            <SwissGridItem span="wide" className="grid gap-[var(--space-4)]">
              {installSteps.map((step) => (
                <DocsNoteCard key={step.label} label={step.label} title={step.title}>
                  <PanelBody size="compact" className="max-w-none">
                    {step.body}
                  </PanelBody>
                  <DocsCodeBlock code={step.command} label={step.label} variant="compact" />
                </DocsNoteCard>
              ))}
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      <PageContainer width="wide">
        <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <AsciiBridge />
          <SurfacePanel tone="blue" className="grid content-between gap-[var(--space-5)]">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow tone="primary">Boundary truth</PanelEyebrow>
              <PanelTitle as="h2" size="display" tone="primary">
                Compatibility, not impersonation.
              </PanelTitle>
              <PanelBody tone="primary" className="max-w-none">
                The page says the quiet part plainly: ChatGPT Pro powers Codex CLI. Squid makes a
                local Claude-shaped surface. Port Daddy records the run. It does not turn ChatGPT
                Pro into official Claude Code authentication.
              </PanelBody>
            </div>
            <Link
              to="/cli-backend"
              className="group inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)] no-underline"
            >
              Compare subscription backends
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </SurfacePanel>
        </div>
      </PageContainer>

      <Footer />
    </div>
  )
}
