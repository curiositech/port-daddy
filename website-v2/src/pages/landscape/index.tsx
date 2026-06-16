import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Layers, Network, Workflow, GitBranch } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { CodeBlock } from '@/components/ui/CodeBlock'

type ComparisonRow = {
  tool: string
  isolation: string
  coordination: string
  agents: string
  guarantees: string
  composesWithPd: string
  pdSelf?: boolean
}

const COMPARISON_ROWS: readonly ComparisonRow[] = [
  {
    tool: 'Port Daddy',
    isolation: 'File claims, sessions',
    coordination: 'DB-backed advisory + Merkle audit',
    agents: 'Unbounded (local)',
    guarantees: 'ProVerif + TLA+ + Kani',
    composesWithPd: '— (is the coordination layer)',
    pdSelf: true,
  },
  {
    tool: 'Cursor 2.0',
    isolation: 'Git worktrees per agent',
    coordination: 'Background agents, conflict detection',
    agents: '8',
    guarantees: 'None',
    composesWithPd: 'Yes — PD claims under Cursor worktrees',
  },
  {
    tool: 'Claude Code Task',
    isolation: 'Isolated context per sub-agent',
    coordination: 'Parent/child results summarized',
    agents: 'Unbounded',
    guarantees: 'None',
    composesWithPd: 'Yes — PD coordinates parents AND children',
  },
  {
    tool: 'ccswarm',
    isolation: 'Git worktrees + Claude CLI',
    coordination: 'Template scaffolding, coordinator agent',
    agents: 'Configurable',
    guarantees: 'None',
    composesWithPd: 'Yes — PD sits beside the coordinator',
  },
  {
    tool: 'WinDAGs',
    isolation: 'ProcessExecutor / WorktreeExecutor',
    coordination: 'Wave-based (parallel inside wave, serial across)',
    agents: 'Per wave',
    guarantees: 'DAG validation only',
    composesWithPd: 'Yes — PD claims at task granularity within waves',
  },
]

type LayerSpec = {
  id: string
  label: string
  role: string
  occupants: string
  tone: 'paper' | 'primary' | 'accent'
  icon: typeof Layers
  isPd?: boolean
}

const ARCHITECTURE_LAYERS: readonly LayerSpec[] = [
  {
    id: '04',
    label: 'Integration',
    role: 'Where the work lands.',
    occupants: 'Merge queues. Test suites. CI. Production.',
    tone: 'paper',
    icon: GitBranch,
  },
  {
    id: '03',
    label: 'Coordination',
    role: 'Who can do what, when, and what already happened.',
    occupants: 'Port Daddy. File claims, sessions, locks, notes, salvage, Merkle audit.',
    tone: 'primary',
    icon: Layers,
    isPd: true,
  },
  {
    id: '02',
    label: 'Communication',
    role: 'How agents tell each other things.',
    occupants: 'Pub/sub channels. Inbox messages. Pheromone trails. Session notes.',
    tone: 'accent',
    icon: Network,
  },
  {
    id: '01',
    label: 'Isolation',
    role: 'Where each agent does its work without stomping the others.',
    occupants: 'Git worktrees. Container sandboxes. Docker. Cursor backgrounds. WinDAGs executors.',
    tone: 'paper',
    icon: Workflow,
  },
]

const WALKTHROUGH_BLOCK = `# Agent A — refactor the middleware
$ pd begin "refactor auth middleware" --identity claude:auth-rewrite --lifecycle durable
$ pd session files claim src/auth/middleware.ts
  Claimed 1 file. No conflicts.
$ pd note "Starting with token-refresh race. See line 142."

# Agent B — meanwhile, in another terminal
$ pd begin "extend test coverage" --identity codex:auth-tests --lifecycle durable
$ pd session files claim src/auth/middleware.ts
  CONFLICT: src/auth/middleware.ts claimed by claude:auth-rewrite
  Holder session: session-claude-auth-rewrite-7b3a

# Agent B sees the conflict, claims something it can own
$ pd session files claim src/auth/middleware.test.ts
  Claimed 1 file. No conflicts.

# Agent A's process dies (kernel OOM, rebase timeout, who knows)
$ pd salvage --project myrepo
  1 orphan session for myrepo:
    claude:auth-rewrite — "Starting with token-refresh race. See line 142."
    Last note 4m ago. 1 file claim held.

# Agent B picks up the salvage, inherits the note, releases the claim
$ pd salvage claim session-claude-auth-rewrite-7b3a
  Claimed. 1 file lock released. Session notes attached to your session.`

function layerToneClasses(tone: LayerSpec['tone']): {
  surface: string
  border: string
  title: string
  body: string
  badge: string
  rule: string
} {
  switch (tone) {
    case 'primary':
      return {
        surface: 'bg-[var(--brand-primary)]',
        border: 'border-[var(--border-strong)]',
        title: 'text-[var(--brand-primary-foreground)]',
        body: 'text-[color:var(--brand-primary-foreground-muted)]',
        badge: 'text-[var(--brand-primary-foreground)] border-[color:var(--brand-primary-foreground-subtle)]',
        rule: 'bg-[color:var(--brand-primary-foreground-subtle)]',
      }
    case 'accent':
      return {
        surface: 'bg-[var(--brand-accent)]',
        border: 'border-[var(--border-strong)]',
        title: 'text-[var(--brand-accent-foreground)]',
        body: 'text-[color:var(--brand-accent-foreground-muted)]',
        badge: 'text-[var(--brand-accent-foreground)] border-[color:var(--brand-accent-foreground-muted)]',
        rule: 'bg-[color:var(--brand-accent-foreground-muted)]',
      }
    default:
      return {
        surface: 'bg-[var(--surface-raised)]',
        border: 'border-[var(--border-strong)]',
        title: 'text-[var(--text-primary)]',
        body: 'text-[var(--text-secondary)]',
        badge: 'text-[var(--text-primary)] border-[var(--border-default)]',
        rule: 'bg-[var(--border-default)]',
      }
  }
}

export default function LandscapePage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* Hero */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.62fr)_minmax(0,0.38fr)] lg:items-start">
              <div className="space-y-[var(--space-5)]">
                <BracketLabel>Where Port Daddy fits</BracketLabel>
                <PanelTitle as="h1" size="hero" className="max-w-[18ch]">
                  Port Daddy is not a rival. It is the layer underneath.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Cursor 2.0, Claude Code Task, ccswarm, and WinDAGs all
                  solve <em>isolation</em>: how to keep eight agents from
                  scribbling over each other's working trees. Port Daddy
                  solves the next problem over — <em>coordination</em>: who
                  is doing what, what already happened, and what to do when
                  an agent's process dies mid-refactor. The two problems
                  compose. Pick whichever isolation primitive you like; PD
                  sits beneath it.
                </PanelBody>
                <p className="max-w-[60ch] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  This page is three things in one screen each: a side-by-side
                  comparison table, a four-layer architecture diagram showing
                  where the coordination layer goes, and a sixty-second
                  walkthrough of two agents touching the same repo at the
                  same time.
                </p>
              </div>

              <aside className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                <div className="space-y-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-4)]">
                  <PanelEyebrow>Honest framing</PanelEyebrow>
                  <p className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                    None of these are competitors.
                  </p>
                  <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    Port Daddy is the coordination layer underneath
                    whichever isolation primitive you already use. We mean
                    that literally — the comparison table below has a
                    "composes with PD?" column, and the answer is "yes" for
                    every row except our own.
                  </p>
                </div>
                <ol className="mt-[var(--space-4)] grid gap-[var(--space-3)]">
                  {['Comparison table', 'Four-layer architecture', 'Two agents, one repo'].map((label, index) => (
                    <li key={label} className="grid grid-cols-[2.5rem,1fr] gap-[var(--space-3)]">
                      <span className="font-mono text-[length:var(--text-lg)] font-black leading-none text-[var(--brand-primary)]">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <a
                        href={`#section-${index + 1}`}
                        className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ol>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* Section 1: Comparison Table */}
        <section
          id="section-1"
          className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
              <div className="space-y-[var(--space-4)]">
                <BracketLabel>01 / Comparison</BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[15ch]">
                  Five tools, five different jobs, one shared coordination layer.
                </PanelTitle>
                <PanelBody className="max-w-[44ch]">
                  Each row is a real multi-agent system in active use. The
                  point of the table is not to declare a winner — it is to
                  show which column each project plays in and where Port
                  Daddy fits underneath.
                </PanelBody>
              </div>

              <div className="min-w-0">
                <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <table
                    data-testid="landscape-comparison"
                    className="w-full min-w-[58rem] border-collapse text-left font-sans"
                  >
                    <caption className="sr-only">
                      Multi-agent tools compared by isolation primitive, coordination primitive,
                      maximum supported agents, formal guarantees, and whether each composes with
                      Port Daddy.
                    </caption>
                    <thead>
                      <tr className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)]">
                        {[
                          'Tool',
                          'Isolation',
                          'Coordination',
                          'Max agents',
                          'Formal guarantees',
                          'Composes with PD?',
                        ].map((heading) => (
                          <th
                            key={heading}
                            scope="col"
                            className="px-[var(--space-4)] py-[var(--space-3)] text-left font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]"
                          >
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARISON_ROWS.map((row) => (
                        <tr
                          key={row.tool}
                          className={[
                            'border-b-2 border-[var(--border-default)] last:border-b-0',
                            row.pdSelf
                              ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                              : 'bg-[var(--surface-base)] text-[var(--text-primary)]',
                          ].join(' ')}
                        >
                          <th
                            scope="row"
                            className={[
                              'px-[var(--space-4)] py-[var(--space-3)] align-top font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]',
                              row.pdSelf
                                ? 'text-[var(--brand-primary-foreground)]'
                                : 'text-[var(--text-primary)]',
                            ].join(' ')}
                          >
                            {row.tool}
                          </th>
                          {[row.isolation, row.coordination, row.agents, row.guarantees, row.composesWithPd].map(
                            (cell, cellIndex) => (
                              <td
                                key={`${row.tool}-${cellIndex}`}
                                className={[
                                  'px-[var(--space-4)] py-[var(--space-3)] align-top text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]',
                                  row.pdSelf
                                    ? 'text-[color:var(--brand-primary-foreground-muted)]'
                                    : 'text-[var(--text-secondary)]',
                                ].join(' ')}
                              >
                                {cell}
                              </td>
                            ),
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-strong)]">
                        <td
                          colSpan={6}
                          className="px-[var(--space-4)] py-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]"
                        >
                          <strong className="font-black text-[var(--text-primary)]">
                            None of these are competitors.
                          </strong>{' '}
                          Port Daddy is the coordination layer underneath whichever
                          isolation primitive you already use. The other rows
                          solve "how do agents not stomp each other's working trees."
                          PD solves "who is doing what, what already happened, and
                          what to do when one of them dies."
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-[var(--space-3)] text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Table scrolls horizontally on narrow screens.
                </p>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* Section 2: Four-Layer Architecture Diagram */}
        <section
          id="section-2"
          className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
              <div className="space-y-[var(--space-4)]">
                <BracketLabel>02 / Architecture</BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[15ch]">
                  Four layers. Coordination sits between isolation and integration.
                </PanelTitle>
                <PanelBody className="max-w-[44ch]">
                  This is the mental model the multi-agent-coordination
                  skill uses internally. Every working agent system has
                  these four layers, even if the names differ. Where they
                  blur together is where the bugs live.
                </PanelBody>
                <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  Read it bottom-up if you are building a system: pick
                  isolation first, then communication, then add Port Daddy
                  for coordination, then connect to integration. Read it
                  top-down if you are debugging one: most "agents fighting
                  each other" symptoms are missing layer-3 (coordination).
                </p>
              </div>

              <figure
                aria-label="Four-layer architecture diagram: isolation at the base, then communication, then coordination (Port Daddy), then integration at the top."
                className="space-y-[var(--space-2)]"
              >
                {ARCHITECTURE_LAYERS.map((layer) => {
                  const t = layerToneClasses(layer.tone)
                  const Icon = layer.icon
                  return (
                    <div
                      key={layer.id}
                      data-testid={`landscape-layer-${layer.label.toLowerCase()}`}
                      className={[
                        'grid grid-cols-[3.5rem_1fr_auto] items-stretch border-2',
                        t.border,
                        t.surface,
                      ].join(' ')}
                    >
                      <div
                        className={[
                          'flex items-center justify-center border-r-2',
                          t.border,
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'font-mono text-[length:var(--text-xl)] font-black leading-none',
                            t.title,
                          ].join(' ')}
                        >
                          {layer.id}
                        </span>
                      </div>
                      <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
                        <div className="flex items-center gap-[var(--space-2)]">
                          <span
                            className={[
                              'inline-flex border-2 px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                              t.badge,
                            ].join(' ')}
                          >
                            Layer {layer.id}
                          </span>
                          <span
                            className={[
                              'font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]',
                              t.title,
                            ].join(' ')}
                          >
                            {layer.label}
                          </span>
                          {layer.isPd ? (
                            <span
                              className={[
                                'inline-flex border-2 px-[var(--space-2)] py-[2px] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                                t.badge,
                              ].join(' ')}
                            >
                              Port Daddy lives here
                            </span>
                          ) : null}
                        </div>
                        <p
                          className={[
                            'font-sans text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)]',
                            t.title,
                          ].join(' ')}
                        >
                          <strong>{layer.role}</strong>{' '}
                          <span className={t.body}>{layer.occupants}</span>
                        </p>
                      </div>
                      <div
                        className={[
                          'flex items-center justify-center border-l-2 px-[var(--space-3)]',
                          t.border,
                        ].join(' ')}
                        aria-hidden="true"
                      >
                        <Icon size={28} className={t.title} strokeWidth={2} />
                      </div>
                    </div>
                  )
                })}
                <figcaption className="mt-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  Isolation keeps agents from overwriting each other.
                  Communication lets them tell each other what they are
                  doing. <strong className="text-[var(--text-primary)]">Coordination</strong> is the registry of who owns
                  what and a record of what already happened — that is the
                  layer Port Daddy lives at. Integration is where the work
                  actually lands: a merge queue, a test suite, production.
                </figcaption>
              </figure>
            </div>
          </PageContainer>
        </section>

        {/* Section 3: Two-Agent Walkthrough */}
        <section
          id="section-3"
          className="py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)]">
              <div className="space-y-[var(--space-4)]">
                <BracketLabel>03 / Sixty seconds</BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[15ch]">
                  Two agents on the same repo, narrated.
                </PanelTitle>
                <PanelBody className="max-w-[44ch]">
                  This is the canonical thing Port Daddy is built for:
                  two agents touching the same working tree, with one of
                  them dying before it finishes. Read it as a transcript.
                </PanelBody>
                <ul className="grid gap-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  <li>
                    <strong className="text-[var(--text-primary)]">Claims are advisory.</strong>{' '}
                    They warn the second agent without hard-locking the file.
                    Agent B is free to override — but it has to know it is
                    overriding.
                  </li>
                  <li>
                    <strong className="text-[var(--text-primary)]">Salvage is durable.</strong>{' '}
                    When Agent A's process dies, its session, notes, and
                    claims survive on the daemon. Any future agent can pick
                    up where it left off.
                  </li>
                  <li>
                    <strong className="text-[var(--text-primary)]">Identities are semantic.</strong>{' '}
                    <code className="bg-[var(--code-bg)] px-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] text-[var(--code-text)]">claude:auth-rewrite</code>{' '}
                    and{' '}
                    <code className="bg-[var(--code-bg)] px-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] text-[var(--code-text)]">codex:auth-tests</code>{' '}
                    name jobs, not processes. A new process for the same
                    job inherits the identity's history.
                  </li>
                </ul>
              </div>

              <div className="min-w-0 space-y-[var(--space-4)]">
                <div data-testid="landscape-walkthrough" className="min-w-0">
                  <CodeBlock language="bash" filename="two-agents.sh" copyable showHeaderLabel={false}>
                    {WALKTHROUGH_BLOCK}
                  </CodeBlock>
                </div>

                <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                  <Link
                    to="/tutorials/getting-started"
                    className="group inline-flex items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] p-[var(--space-4)] text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <ArrowRight aria-hidden="true" size={18} className="mt-[var(--space-1)] shrink-0" />
                    <span className="min-w-0 space-y-[var(--space-1)]">
                      <span className="block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                        Try it now →
                      </span>
                      <span className="block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[color:var(--brand-primary-foreground-muted)]">
                        Install Port Daddy, then run the transcript above against your own repo.
                      </span>
                    </span>
                  </Link>

                  <Link
                    to="/whitepaper"
                    className="group inline-flex items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <ArrowRight aria-hidden="true" size={18} className="mt-[var(--space-1)] shrink-0 text-[var(--brand-primary)]" />
                    <span className="min-w-0 space-y-[var(--space-1)]">
                      <span className="block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                        Read the papers →
                      </span>
                      <span className="block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        The two-paper argument that the coordination layer is provable, not
                        decorative.
                      </span>
                    </span>
                  </Link>
                </div>
              </div>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
