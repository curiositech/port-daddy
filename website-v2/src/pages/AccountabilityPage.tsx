import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  FileCheck2,
  GitBranch,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Terminal,
  Wallet,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const installCommand = 'brew install curiositech/tap/port-daddy && pd setup'

const blankTerminal = `$ claude -p "refactor the auth module" &
$ codex exec "fix the flaky session tests" &
$ # ...an hour passes.
$ # What did they change? What did it cost?
$ # Which one ran git reset --hard?
$ #
$ # (no output)`

const witnessedRun = [
  {
    icon: ScrollText,
    title: 'The transcript, hash-chained',
    body:
      'Every turn, tool call, and file touch streams into a chain the daemon holds. The agent cannot edit its own history, because the agent never holds the chain.',
  },
  {
    icon: Wallet,
    title: 'The exact cost',
    body:
      'Managed launches are fail-closed on telemetry: no exact token counts, no exact rate, no persisted cost record means no managed launch. The number on the run is the number you paid.',
  },
  {
    icon: ShieldCheck,
    title: 'The compliance level',
    body:
      'C0 Registered through C6 Resumable, proven by daemon-witnessed probes. Self-reported claims advance nothing past C0.',
  },
  {
    icon: ReceiptText,
    title: 'The receipt',
    body:
      'What ran, what it cost, what was confined, which keys were scrubbed, and every denial the gate issued, folded into one durable record per run.',
  },
]

const ladder = [
  { level: 'C0', name: 'Registered', meaning: 'Identity minted by the daemon, never self-picked.', token: '--brand-primary' },
  { level: 'C1', name: 'Transcripted', meaning: 'Events the daemon can hash-chain and verify.', token: '--brand-primary' },
  { level: 'C2', name: 'Governed', meaning: 'Pre-tool gates stand between intent and side effect.', token: '--story-health' },
  { level: 'C3', name: 'Suggestible', meaning: 'The daemon can put verified context in front of the agent.', token: '--story-health' },
  { level: 'C4', name: 'Controllable', meaning: 'Pause, redirect, and kill honor witnessed state.', token: '--story-indigo' },
  { level: 'C5', name: 'Cooperative', meaning: 'Claims and parley with other agents on shared code.', token: '--story-indigo' },
  { level: 'C6', name: 'Resumable', meaning: 'A crashed run is a checkpoint, not a loss.', token: '--story-violet' },
]

const negativeProbes = [
  'forged-level — claim a level you cannot prove, fail the run',
  'forged-heartbeat — fake liveness, fail the run',
  'direct-mcp-bypass — skip the governed channel, fail the run',
  'disabled-hook-after-launch — drop the hook mid-run, fail the run',
  'observed-to-controlled — pose above your ceiling, fail the run',
]

const gateSteps = [
  {
    label: 'Classify',
    title: 'Before it runs, not after',
    body:
      'Every command a governed agent proposes is classified against a policy matrix: git, filesystem, network, shell, github. Classification is by worst case. A path that cannot be resolved is treated as outside the workspace.',
  },
  {
    label: 'Deny',
    title: 'Block-tier means no side effect',
    body:
      'git reset --hard, push --force, clean -fd: denied at the pre-tool hook. The negative-fixture tests run the blocked command against a real scratch repo and prove the repo is byte-identical afterward.',
  },
  {
    label: 'Receipt',
    title: 'A denial you can read later',
    body:
      'Each denial writes a durable receipt and a transcript event, and offers a concrete safe alternative — git stash push instead of a hard reset. A missing hook or a forged compliance level is a deny, never a shrug.',
  },
]

const gateTranscript = `# agent proposes:
git reset --hard origin/main

# pre-tool gate (lib/agent-harbor/governance/tool-gate.ts):
verdict: deny            # before any side effect
category: git            tier: block
receipt:  denial recorded on the run's WorkReceipt
transcript: tool_denied event, visible in the console
safe alternative: git stash push -m "pre-reset checkpoint"`

const dogfoodReceipts = [
  'The git hooks it ships gate the commits in its own repo. pd guard check --staged runs before every Port Daddy commit.',
  'The agents that build Port Daddy run under Port Daddy: sessions, claims, budgets, salvage. A build agent that dies mid-task leaves a session another agent picks up.',
  'The repo holds 7,300+ passing tests, 90+ architecture decision records, and an adversarial reviewer that posts a SHIP / DO-NOT-SHIP verdict on every PR.',
  'No feature ships until it has survived being the daily driver on this codebase. Dogfood is the QA.',
]

const honestLimits = [
  'macOS is the primary target. The daemon and sandbox run on Linux; the native console does not yet.',
  'The exact-cost launch gate passes for the Claude SDK backend today. Other backends run as observed, not managed, until they reach telemetry parity.',
  'The sandbox defends the cooperative case: runaway spend, leaked keys, accidental destruction. A deliberately malicious same-UID process needs the separate-UID broker, which is designed (ADR-0087) and not shipped.',
]

/**
 * The witnessed-run receipt, drawn — not a screenshot of `pd-console` (this
 * page ships no fabricated UI captures; swap this for a real capture once the
 * run-detail pane is photographed, per the same honesty rule the old "Art
 * slot" placeholder documented), but a real abstract figure built from this
 * page's own data: the hash-chained transcript, a cost sparkline, the actual
 * C0–C6 `ladder` array rendered as ascending steps, and a sealed receipt
 * stamp. Themed entirely through `var(--token)` so it tracks light/dark.
 */
function RunReceiptFigure() {
  const uid = React.useId()
  const titleId = `${uid}-receipt-title`
  const descId = `${uid}-receipt-desc`
  const chainX = [26, 66, 106, 146, 186, 226]
  const sparkline = [10, 18, 14, 24, 17, 28, 21, 32]
  const stepBase = 246
  const stepW = 30
  const stepGap = 4

  return (
    <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
      <div className="p-[var(--space-4)]">
        <svg
          viewBox="0 0 320 380"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block w-full max-w-[20rem]"
        >
          <title id={titleId}>A witnessed run, sealed into one receipt</title>
          <desc id={descId}>
            A hash-chained transcript of six linked events, a rising cost
            sparkline, the seven-rung C0 through C6 compliance ladder drawn as
            ascending steps, and a stamped seal marking the receipt.
          </desc>

          <text x="16" y="22" fill="var(--text-muted)" style={{ font: '800 11px var(--font-sans)', letterSpacing: '0.08em' }}>
            TRANSCRIPT — HASH-CHAINED
          </text>
          <g>
            {chainX.slice(0, -1).map((x, i) => (
              <line
                key={`link-${x}`}
                x1={x}
                y1={42}
                x2={chainX[i + 1]}
                y2={42}
                stroke="var(--border-strong)"
                strokeWidth={2}
              />
            ))}
            {chainX.map((x) => (
              <circle key={x} cx={x} cy={42} r={7} fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth={1.5} />
            ))}
          </g>

          <text x="16" y="82" fill="var(--text-muted)" style={{ font: '800 11px var(--font-sans)', letterSpacing: '0.08em' }}>
            EXACT COST, PER TURN
          </text>
          <g transform="translate(16, 92)">
            {sparkline.map((h, i) => (
              <rect
                key={i}
                x={i * 16}
                y={36 - h}
                width={11}
                height={h}
                fill="var(--story-health)"
                fillOpacity={0.75}
              />
            ))}
          </g>

          <text x="16" y="160" fill="var(--text-muted)" style={{ font: '800 11px var(--font-sans)', letterSpacing: '0.08em' }}>
            COMPLIANCE, C0–C6
          </text>
          <g>
            {ladder.map((rung, i) => {
              const h = 12 + i * 7
              const x = 16 + i * (stepW + stepGap)
              return (
                <g key={rung.level}>
                  <rect
                    x={x}
                    y={stepBase - h}
                    width={stepW}
                    height={h}
                    fill={`var(${rung.token})`}
                    fillOpacity={0.85}
                    stroke="var(--border-strong)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={x + stepW / 2}
                    y={stepBase + 16}
                    textAnchor="middle"
                    fill="var(--text-muted)"
                    style={{ font: '700 10px var(--font-mono)' }}
                  >
                    {rung.level}
                  </text>
                </g>
              )
            })}
          </g>

          <g transform="translate(38, 336)">
            <circle r={22} fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth={2} />
            <path
              d="M -9 0 L -2 7 L 11 -9"
              fill="none"
              stroke="var(--brand-primary-foreground)"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
          <text x="72" y="331" fill="var(--text-primary)" style={{ font: '900 14px var(--font-sans)' }}>
            One receipt
          </text>
          <text x="72" y="349" fill="var(--text-muted)" style={{ font: '700 11px var(--font-mono)', letterSpacing: '0.04em' }}>
            per run, sealed
          </text>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Transcript, cost, compliance level, receipt — the four things every
        witnessed run seals into one record, drawn from the same ladder pd-console reads.
      </figcaption>
    </figure>
  )
}

export function AccountabilityPage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-5)]">
                  <PanelEyebrow>The operator console for coding agents</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[15ch]">
                    See what your agents actually did.
                  </PanelTitle>
                  <PanelBody className="max-w-[44rem] text-[length:var(--text-lg)]">
                    You launched three coding agents an hour ago. Right now they
                    are three blank terminals. Port Daddy is the local daemon and
                    native console that turns each run into a witnessed
                    transcript, an exact cost, a compliance level, and a receipt
                    — with destructive git blocked before it fires.
                  </PanelBody>
                  <DocsCodeBlock code={installCommand} language="cli" label="Install" />
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <Link to="/mac-preview">
                        Install Port Daddy
                        <Terminal size={16} aria-hidden="true" />
                      </Link>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <a href="#git-guard">
                        Watch the git guard say no
                        <GitBranch size={16} aria-hidden="true" />
                      </a>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-4)]">
                  <PanelEyebrow>Run detail</PanelEyebrow>
                  <RunReceiptFigure />
                  <div className="grid grid-cols-2 border-2 border-[var(--border-strong)] md:grid-cols-4">
                    {['Transcript', 'Cost', 'Compliance', 'Receipt'].map((label, index) => (
                      <div
                        key={label}
                        className={`p-[var(--space-3)] ${
                          index < 3 ? 'border-b-2 border-[var(--border-strong)] md:border-b-0 md:border-r-2' : ''
                        }`}
                      >
                        <PanelEyebrow>{label}</PanelEyebrow>
                      </div>
                    ))}
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Before</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    A blank terminal is not a record.
                  </PanelTitle>
                  <PanelBody>
                    Scrollback is not a transcript. It is unverified, unstructured,
                    and gone when the window closes. When an agent summarizes its
                    own work, you are trusting the party being audited.
                  </PanelBody>
                  <DocsCodeBlock code={blankTerminal} language="text" label="Today" />
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>After</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    A witnessed run answers all four questions.
                  </PanelTitle>
                  <div className="grid gap-[var(--grid-gap)] md:grid-cols-2">
                    {witnessedRun.map(({ icon: Icon, title, body }) => (
                      <SurfacePanel key={title} elevation="quiet" className="space-y-[var(--space-4)]">
                        <Icon className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary)]" aria-hidden="true" />
                        <div className="space-y-[var(--space-2)]">
                          <PanelTitle as="h3" size="nav">
                            {title}
                          </PanelTitle>
                          <PanelBody size="compact" className="max-w-none">
                            {body}
                          </PanelBody>
                        </div>
                      </SurfacePanel>
                    ))}
                  </div>
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] space-y-[var(--section-intro-gap)]">
              <BracketLabel>The ladder</BracketLabel>
              <PanelTitle as="h2" size="display" className="max-w-[16ch]">
                Compliance is witnessed, never self-attested.
              </PanelTitle>
              <PanelBody className="max-w-[52rem]">
                Seven levels, C0 through C6. Each one is proven by a
                daemon-witnessed probe, and each one is falsifiable: a forged
                claim at any level fails the run loudly instead of shipping a
                badge. Run <code className="font-mono">pd work probe</code> to
                watch an adapter earn — or lose — its level.
              </PanelBody>
            </div>

            <div className="grid gap-[var(--grid-gap)] sm:grid-cols-2 lg:grid-cols-4">
              {ladder.map(({ level, name, meaning, token }) => (
                <div
                  key={level}
                  className="border-2 border-[var(--border-strong)] p-[var(--space-4)]"
                  style={{ borderTopWidth: '6px', borderTopColor: `var(${token})` }}
                >
                  <div
                    className="font-display text-[length:var(--type-panel-title-card-size)] font-black"
                    style={{ color: `var(${token})` }}
                  >
                    {level}
                  </div>
                  <PanelTitle as="h3" size="nav" className="mt-[var(--space-1)]">
                    {name}
                  </PanelTitle>
                  <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                    {meaning}
                  </PanelBody>
                </div>
              ))}
              <SurfacePanel tone="blue" className="space-y-[var(--space-3)]">
                <XCircle className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--brand-primary-foreground)]" aria-hidden="true" />
                <PanelTitle as="h3" size="nav" tone="primary">
                  Five required negative probes
                </PanelTitle>
                {negativeProbes.map((probe) => (
                  <PanelBody key={probe} size="compact" tone="primary" className="max-w-none font-mono">
                    {probe}
                  </PanelBody>
                ))}
              </SurfacePanel>
            </div>
          </PageContainer>
        </section>

        <section id="git-guard" className="scroll-mt-[calc(var(--space-10)+var(--space-6))] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Git guard</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[12ch]">
                    The reset that never happened.
                  </PanelTitle>
                  <PanelBody>
                    The first time two agents share a repo, one of them will run{' '}
                    <code className="font-mono">git reset --hard</code> while the
                    other has uncommitted work in the tree. Port Daddy classifies
                    the command at the pre-tool hook and denies it before the
                    side effect, not in a post-mortem.
                  </PanelBody>
                  <DocsCodeBlock code={gateTranscript} language="text" label="Denial, annotated" />
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="grid gap-[var(--grid-gap)] lg:grid-cols-3">
                  {gateSteps.map((step) => (
                    <SurfacePanel key={step.label} elevation="quiet" className="space-y-[var(--space-4)]">
                      <BracketLabel>{step.label}</BracketLabel>
                      <div className="space-y-[var(--space-2)]">
                        <PanelTitle as="h3" size="nav">
                          {step.title}
                        </PanelTitle>
                        <PanelBody size="compact" className="max-w-none">
                          {step.body}
                        </PanelBody>
                      </div>
                    </SurfacePanel>
                  ))}
                </div>

                <SurfacePanel className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>Also on the commit path</PanelEyebrow>
                    <PanelTitle as="h3" size="card">
                      Coordination Guard for the humans and agents you already have.
                    </PanelTitle>
                    <PanelBody className="max-w-none">
                      <code className="font-mono">pd guard install</code> writes
                      pre-commit hooks that require an active session and matching
                      file claims for staged files. See the{' '}
                      <Link to="/docs/cli/guard" className="underline">
                        pd guard reference
                      </Link>
                      .
                    </PanelBody>
                  </div>
                  <DocsCodeBlock
                    code={`pd guard install --mode warn
pd guard check --staged`}
                    language="cli"
                    label="Coordination Guard"
                  />
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--section-intro-gap)]">
                  <BracketLabel>Founding discipline</BracketLabel>
                  <PanelTitle as="h2" size="display" className="max-w-[13ch]">
                    Port Daddy is built by Port Daddy.
                  </PanelTitle>
                  <PanelBody>
                    The product was built to survive building itself. Every wave
                    of features had to hold up while agents used it to build the
                    next wave — under its own git hooks, on its own sessions,
                    inside its own budgets.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="body">
                <div className="grid gap-[var(--grid-gap)] md:grid-cols-2">
                  {dogfoodReceipts.map((item) => (
                    <SurfacePanel key={item} elevation="quiet" className="space-y-[var(--space-3)]">
                      <FileCheck2 className="h-[var(--space-5)] w-[var(--space-5)] text-[var(--story-health)]" aria-hidden="true" />
                      <PanelBody size="compact" className="max-w-none">
                        {item}
                      </PanelBody>
                    </SurfacePanel>
                  ))}
                </div>

                <SurfacePanel elevation="quiet" className="mt-[var(--space-6)] space-y-[var(--space-4)]">
                  <div className="flex items-center gap-[var(--space-3)]">
                    <XCircle className="h-[var(--space-6)] w-[var(--space-6)] text-[var(--status-error)]" aria-hidden="true" />
                    <PanelTitle as="h3" size="card">
                      What it does not do yet
                    </PanelTitle>
                  </div>
                  <div className="space-y-[var(--space-3)]">
                    {honestLimits.map((item) => (
                      <PanelBody key={item} size="compact" className="max-w-none">
                        {item}
                      </PanelBody>
                    ))}
                  </div>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-4)]">
                  <PanelEyebrow>One install</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    The next run you launch can be a witnessed one.
                  </PanelTitle>
                  <PanelBody>
                    One command installs the daemon and runs setup. Setup starts
                    the daemon under supervision, configures MCP for your
                    editors, and adds FleetBar, the Mac menu-bar app. The{' '}
                    <Link to="/docs/quickstart" className="underline">
                      quickstart
                    </Link>{' '}
                    has you coordinated in ten minutes.
                  </PanelBody>
                  <DocsCodeBlock code={installCommand} language="cli" label="Install" />
                </div>
              </SwissGridItem>
              <SwissGridItem span="narrow">
                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  {[
                    [ScrollText, 'Witnessed transcripts'],
                    [Wallet, 'Exact cost'],
                    [ShieldCheck, 'Compliance C0–C6'],
                    [GitBranch, 'Git guard'],
                  ].map(([Icon, label]) => {
                    const IconComponent = Icon as typeof ScrollText
                    return (
                      <div key={label as string} className="border-2 border-[var(--border-strong)] p-[var(--space-4)]">
                        <IconComponent className="h-[var(--space-5)] w-[var(--space-5)] text-[var(--brand-primary)]" aria-hidden="true" />
                        <PanelEyebrow className="mt-[var(--space-3)]">{label as string}</PanelEyebrow>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
                  <Button asChild variant="primary" size="lg">
                    <Link to="/mac-preview">
                      Get the Mac app
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <Link to="/docs/quickstart">
                      Quickstart
                      <CheckCircle2 size={16} aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}
