import { ArrowRight, GitFork, Radio, Reply } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

/**
 * Standalone feature page for `pd tube` at /pd-tube. Covers what the
 * command is, the event -> agent reply loop, a "wilder things" GIF showcase
 * (UI-summons-agent, agent-to-agent review duet, one-message program
 * bootstrap — scenarios live in demos/tube-*), the eight Rube Goldberg
 * cascade machines (docs/tube-router-rube-goldberg.md; scenarios in
 * demos/rube-goldberg/*), and the multi-subscriber fan-out shipped in
 * v3.16.2 (distinct `--as` identities each receive every message). Links
 * out to the CLI docs, the tutorial, and the post.
 */
export function PdTubePage() {
  return (
    <div className="min-h-screen bg-[var(--surface-base)] selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]">
      <main id="main-content">
        {/* Hero */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-center">
              <SwissGridItem span="wide">
                <div className="space-y-[var(--space-5)]">
                  <BracketLabel>pd tube</BracketLabel>
                  <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                    The event bus your local agent was missing.
                  </PanelTitle>
                  <PanelBody className="max-w-[46rem] text-[length:var(--text-lg)]">
                    <code>pd tube</code> turns any local UI, hook, test runner, or webhook into an
                    event the agent already running in your project can answer — in a single shell
                    call. No SDK, no MCP server, no websocket dance. As of v3.16.2 the same channel
                    fans out to many listeners at once: distinct <code>--as</code> identities each
                    receive every message.
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-3)]">
                    <Button asChild variant="primary" size="lg">
                      <Link to="/docs/cli/tube">
                        Read the CLI reference
                        <ArrowRight size={16} />
                      </Link>
                    </Button>
                    <Button asChild variant="secondary" size="lg">
                      <Link to="/tutorials/pd-tube">Walk the tutorial</Link>
                    </Button>
                  </div>
                </div>
              </SwissGridItem>

              <SwissGridItem span="narrow">
                <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                  <PanelEyebrow>The whole protocol</PanelEyebrow>
                  <CodeBlock language="bash" filename="agent terminal" copyable>
                    {`# 1. Agent listens
$ pd tube ui:clicks

# 2. A button POSTs JSON to /msg/ui:clicks
#    -> the agent wakes with the event

# 3. Agent does the work, then replies
$ pd tube ui:clicks --reply "Deployed to staging."`}
                  </CodeBlock>
                </SurfacePanel>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* The event -> agent loop */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="The loop"
              title="A publisher speaks. The agent answers. Both in one call."
              description="Any process that can POST JSON to /msg/<channel> can summon the agent. The agent runs pd tube in a loop: each invocation blocks for the next event, prints a prose block telling the model exactly how to respond, and returns — which is what lets the model take its turn and post a reply."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-3">
              <FeatureCard
                icon={Radio}
                title="Block, then return"
                body="Default mode blocks until the next event, prints the prose crank-handle block, and exits. The agent's bash tool yields so the model can take the next turn."
              />
              <FeatureCard
                icon={Reply}
                title="Inline --reply"
                body={
                  <>
                    <code>pd tube ch --reply &quot;done&quot;</code> auto-correlates to the most recent
                    foreign event, posts the reply, and keeps listening. One command, both jobs.
                  </>
                }
              />
              <FeatureCard
                icon={GitFork}
                title="Fan-out to many"
                body="Distinct --as identities each receive every message on the channel. One broadcast reaches the whole room, not one listener at random."
              />
            </div>
          </PageContainer>
        </section>

        {/* Wilder things — three demo GIFs */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Wilder things"
              title="The bus doesn't care what's on either end."
              description="A channel is a name and a POST — which means the publisher can be a menu-bar button, another agent, or you typing one sentence into a shell. The subscriber on the other side is an agent with a working directory, a shell, and opinions. Here is what that combination actually does."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-7)] space-y-[var(--space-8)]">
              <DemoShowcase
                title="A button that summons your agent"
                lede={
                  <>
                    A menu-bar app — anything local that can manage an HTTP POST — fires one JSON
                    blob at <code>ui:fixit</code> when you click <em>Fix failing test</em>. The
                    agent parked on <code>pd tube ui:fixit</code> wakes holding the event, finds
                    the off-by-one, patches it, and its <code>--reply</code> comes back as the
                    toast. The app never linked an SDK; the whole integration is a URL.
                  </>
                }
                src="/demos/pd-tube/tube-ui-summon.gif"
                alt="Animated terminal recording: a menu-bar app POSTs a JSON event to a tube channel, the listening agent wakes, fixes a failing test, and replies — the reply arrives back in the UI as a toast"
                caption={
                  <>
                    Click → POST → patch → toast. The UI speaks HTTP, the agent speaks shell, and{' '}
                    <code>pd tube</code> is the only thing between them.
                  </>
                }
              />
              <DemoShowcase
                title="Two agents, arguing productively"
                lede={
                  <>
                    A builder agent and a reviewer agent hold a real conversation on{' '}
                    <code>agents:review</code>: handoff, pushback, revision, approval.{' '}
                    <code>--reply</code> auto-correlates each turn to the most recent foreign
                    event, so neither side juggles message ids — and no human relays turns between
                    two terminal windows.
                  </>
                }
                src="/demos/pd-tube/tube-agent-duet.gif"
                alt="Animated terminal recording: a builder agent and a reviewer agent exchange correlated replies over one tube channel — a change request, a fix, and an approval, with no human relaying messages"
                caption={
                  <>
                    The reviewer pushes back, the builder patches and re-pings, the reviewer
                    approves — four turns of genuine code review with zero human relay.
                  </>
                }
              />
              <DemoShowcase
                title="One sentence boots a program"
                lede={
                  <>
                    Send <em>&ldquo;spin up the new admin panel&rdquo;</em> and walk away. The
                    listening agent scaffolds the app, claims a deterministic port from the daemon
                    (<code>pd claim admin:web:dev</code> — same identity, same port, every time),
                    starts the dev server, and posts the URL back on the channel that asked. The
                    interface to an entire bootstrap is one message.
                  </>
                }
                src="/demos/pd-tube/tube-bootstrap.gif"
                alt="Animated terminal recording: one tube message asks for a new app; the agent scaffolds it, claims a port from the Port Daddy daemon, starts the dev server, and replies with the running URL"
                caption={
                  <>
                    Scaffold, install, <code>pd claim</code>, dev server, URL — a whole program
                    initialized from a single channel round-trip.
                  </>
                }
              />
            </div>
          </PageContainer>
        </section>

        {/* Rube Goldberg machines — eight cascade demos */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Rube Goldberg machines"
              title="Cascade the tubes and the machines build themselves."
              description="Once channels chain into channels — and every hop carries a loop-guarded delegation chain — you can tier cheap local models under expensive cloud ones and let whole workflows run unattended. Eight machines, each with the exact moment a loop guard keeps it from running away. That refusal is the reason you can trust any of this overnight."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-7)] space-y-[var(--space-8)]">
              {RUBE_MACHINES.map((m) => (
                <RubeMachineCard key={m.slug} machine={m} />
              ))}
            </div>
            <PanelBody className="mt-[var(--space-6)] max-w-none text-[var(--text-muted)]">
              Every machine above is a runnable scenario in{' '}
              <code>demos/rube-goldberg/</code>; the full pattern catalog — chains, payoffs, and
              guard moments — lives in <code>docs/tube-router-rube-goldberg.md</code>.
            </PanelBody>
          </PageContainer>
        </section>

        {/* Multi-subscriber fan-out */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SwissGrid className="items-start gap-y-[var(--space-7)]">
              <SwissGridItem span="narrow">
                <div className="space-y-[var(--space-5)]">
                  <BracketLabel>New in v3.16.2</BracketLabel>
                  <SectionIntro
                    eyebrow="Multi-subscriber"
                    title="One channel. Many listeners. Every message."
                    description="Earlier builds shared a single resume cursor per channel, so two --tail listeners raced for each message and only one won it. The cursor is now namespaced per listener identity, so every distinct --as subscriber keeps its own place in the stream and receives every message."
                    titleAs="h2"
                    titleSize="display"
                  />
                  <PanelBody className="text-[var(--text-muted)]">
                    Nothing changes for the publisher. The same plain <code>POST</code> now reaches
                    a standup bot, a notifier, and a logger simultaneously — all on the same
                    channel, each on its own identity.
                  </PanelBody>
                </div>
              </SwissGridItem>

              <SwissGridItem span="wide" className="space-y-[var(--space-6)]">
                <SurfacePanel className="overflow-hidden">
                  <PanelEyebrow className="mb-[var(--space-2)]">Three listeners, one broadcast</PanelEyebrow>
                  <PanelTitle as="h3" className="mb-[var(--space-4)]">
                    Each <code>--as</code> identity gets its own copy
                  </PanelTitle>
                  <CodeBlock language="bash" filename="four terminals" copyable>
                    {`# Terminal 1 — first subscriber
$ pd tube standup:demo --tail --as you

# Terminal 2 — second subscriber
$ pd tube standup:demo --tail --as claude-code

# Terminal 3 — third subscriber
$ pd tube standup:demo --tail --as gardener-bot

# Terminal 4 — broadcaster sends once
$ pd tube standup:demo --send "Standup in 5. Post blockers."
SUCCESS: tube: posted id=87 to standup:demo

# id=87 now prints in ALL THREE listener terminals — fan-out, not one-of-N.`}
                  </CodeBlock>
                </SurfacePanel>

                <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <img
                    src="/demos/pd-tube/pd-tube-multiplex.gif"
                    alt="Animated terminal recording: a broadcaster sends one message to a channel and three pd tube subscribers, each on a distinct --as identity, all receive the same message"
                    className="block w-full"
                    loading="lazy"
                  />
                  <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
                    One broadcaster, three subscribers on distinct <code>--as</code> identities. The
                    single message fans out to all three terminals — the behavior shipped in v3.16.2.
                  </figcaption>
                </figure>
              </SwissGridItem>
            </SwissGrid>
          </PageContainer>
        </section>

        {/* Get started / links */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Get started"
              title="Copy a command and point it at a channel."
              description="The substrate is the SQLite-backed channel system Port Daddy already ships. Pick a channel name, run pd tube, and wire any publisher you like."
              titleAs="h2"
              titleSize="display"
            />
            <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-2">
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow>Listen</PanelEyebrow>
                <CodeBlock language="bash" filename="listen" copyable>
                  {`pd tube ui:clicks --tail --as you`}
                </CodeBlock>
              </SurfacePanel>
              <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
                <PanelEyebrow>Send</PanelEyebrow>
                <CodeBlock language="bash" filename="send" copyable>
                  {`pd tube ui:clicks --send "shipping it"`}
                </CodeBlock>
              </SurfacePanel>
            </div>

            <div className="mt-[var(--space-6)] flex flex-wrap gap-[var(--space-3)]">
              <Link
                to="/docs/cli/tube"
                className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
              >
                CLI reference <ArrowRight size={16} />
              </Link>
              <Link
                to="/tutorials/pd-tube"
                className="inline-flex items-center gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
              >
                Tutorial <ArrowRight size={16} />
              </Link>
              <Link
                to="/blog/pd-tube-event-reply-loop"
                className="inline-flex items-center gap-2 border-2 border-transparent px-4 py-2 text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border-strong)] decoration-2 underline-offset-4 hover:text-[var(--text-primary)]"
              >
                Read the post
              </Link>
            </div>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}

interface RubeMachine {
  slug: string
  number: string
  title: string
  chain: string
  lede: ReactNode
  guard: string
  alt: string
}

const RUBE_MACHINES: RubeMachine[] = [
  {
    slug: 'test-whittler',
    number: '№1',
    title: 'The test whittler',
    chain: 'failing:tests → ollama triage → codex fix → ollama verify → pr:ready',
    lede: (
      <>
        CI red never pages a human. A local model splits flaky from real for free, codex writes
        the minimal fix for the one confirmed regression, and a verification pass re-runs the
        suite before the PR opens.
      </>
    ),
    guard:
      'When codex can’t reproduce a failure and tries to re-delegate triage upward, the depth cap fires and escalates to a human instead of looping.',
    alt: 'Animated terminal recording: CI posts failing tests to a channel, a local model triages flaky from real, codex patches the regression, and the depth cap refuses an upward re-delegation',
  },
  {
    slug: 'adversarial-reviewer',
    number: '№2',
    title: 'The adversarial reviewer',
    chain: 'pr:diff → 3 × ollama lenses (parallel) → claude synthesis → pr:comment',
    lede: (
      <>
        Three cheap local reviewers read the same diff through correctness, security, and perf
        lenses — in parallel, in seconds. The cloud synthesizer fires once, after all three
        resolve, and surfaces their disagreements as explicit conflicts instead of averaging
        them into mush.
      </>
    ),
    guard:
      'The fan-out budget stops the synthesizer from hiring reviewer #4 when it disputes a finding — it must resolve disagreements with what it has.',
    alt: 'Animated terminal recording: three local model reviewers fan out over one PR diff in parallel lenses, a cloud model synthesizes their verdicts, and the fan-out budget refuses a fourth reviewer',
  },
  {
    slug: 'crash-archaeologist',
    number: '№3',
    title: 'The crash archaeologist',
    chain: 'crash:log → ollama suspects → codex repro → ollama confirm → claude fix → pr:patch',
    lede: (
      <>
        A production 500 becomes a tested PR with no human reading a stack trace. The expensive
        model is only paid after the crash is <em>confirmed reproducible</em> — phantom bugs
        never reach it.
      </>
    ),
    guard:
      'Ping-pong detection breaks the codex⇄ollama bounce on the third pass over the same crash signature and escalates with the full chain attached.',
    alt: 'Animated terminal recording: a crash log flows through suspect-naming, repro-writing, and confirmation stages before a cloud model writes the fix; ping-pong detection refuses a third bounce',
  },
  {
    slug: 'doc-rot-hunter',
    number: '№4',
    title: 'The doc rot hunter',
    chain: 'docs:scan → ollama claims → fan-out verify per claim → gemini corrections → pr:docs',
    lede: (
      <>
        Nightly, every &ldquo;function X returns Y&rdquo; claim in the docs gets its own grep of
        the actual source. The rewrite model only ever sees the stale claims, never the whole
        corpus — which is what makes a nightly run affordable.
      </>
    ),
    guard:
      'The fan-out budget (50 per run) stops one doc page from spawning four hundred per-sentence agents; overflow queues for tomorrow night.',
    alt: 'Animated terminal recording: a nightly docs scan extracts 118 verifiable claims, fans out fifty source checks, queues the overflow, and sends only the three stale claims to a rewrite model',
  },
  {
    slug: 'security-bounty-hunter',
    number: '№5',
    title: 'The security bounty hunter',
    chain: 'security:scan → ollama lenses per module → dedup + triage → claude writeup → pr:security',
    lede: (
      <>
        A full-codebase audit that costs roughly nothing until a finding is real: injection,
        auth, and crypto lenses sweep every module locally, triage locally, and the first cloud
        token is spent writing the writeup for a <em>confirmed</em> finding. The PR opens as a
        draft — a human signs every security change.
      </>
    ),
    guard:
      'Pointed at a monorepo, the fan-out budget fires hard (40 per invocation) instead of spawning eight hundred agents; overflow continues next run.',
    alt: 'Animated terminal recording: security lenses fan out across modules, findings dedupe down to one confirmed issue, and a cloud model writes the advisory as a draft PR',
  },
  {
    slug: 'living-changelog',
    number: '№6',
    title: 'The living changelog',
    chain: 'git:push → ollama summary → gemini enrich → ollama copy edit → CHANGELOG.md',
    lede: (
      <>
        Every push becomes an honest changelog entry: a local model turns the diff into plain
        English, gemini adds the &ldquo;why this matters&rdquo; context commit messages never
        carry, and a final local pass hunts down the &ldquo;refactor internals&rdquo; cop-outs.
      </>
    ),
    guard:
      'Ping-pong detection gives the copy editor exactly one re-enrichment pass — after that it accepts the output or flags a human, no infinite style war.',
    alt: 'Animated terminal recording: a git push flows through summary, enrichment, and copy-edit stages into a changelog entry; the router refuses a second re-enrichment loop',
  },
  {
    slug: 'oncall-whisperer',
    number: '№7',
    title: 'The on-call whisperer',
    chain: 'alert:fire → ollama classify → codex runbook patch → ollama sanity → oncall:gate',
    lede: (
      <>
        The 3am page arrives pre-chewed: classified, runbook excerpt attached, patch drafted,
        sanity verdict written. The on-call engineer wakes to a yes/no question instead of an
        investigation — and the machine never self-merges, by construction.
      </>
    ),
    guard:
      'Upward delegation is blocked outright: codex hitting ambiguity must emit a “?” verdict to the human gate, never spawn a fresh classifier.',
    alt: 'Animated terminal recording: a PagerDuty alert is classified, a remediation patch drafted from the runbook, everything stops at a human approval gate, and an upward re-classification is refused',
  },
  {
    slug: 'debt-snake',
    number: '№8',
    title: 'The debt snake',
    chain: 'debt:scan → ollama inventory → codex/claude fan-out in worktrees → verify → one PR',
    lede: (
      <>
        The technical debt that lives forever because it&rsquo;s too small to prioritize gets
        eaten on a weekly cron. Small TODOs go to codex, nuanced ones to claude, each in its own
        worktree; every tree re-runs the suite before it counts, and the survivors squash into
        one reviewable PR.
      </>
    ),
    guard:
      'The worktree budget (20 concurrent) keeps a ten-year codebase from spawning an agent per TODO; the depth cap stops a fixed TODO from being fixed twice.',
    alt: 'Animated terminal recording: a weekly debt scan sizes 137 TODO markers, fans fixes out across isolated worktrees, reverts the two that broke tests, and squashes the rest into a single PR',
  },
]

/** One Rube Goldberg machine: numbered title, chain, GIF, and its guard moment. */
function RubeMachineCard({ machine }: { machine: RubeMachine }) {
  return (
    <div className="space-y-[var(--space-4)]">
      <div className="max-w-[52rem] space-y-[var(--space-3)]">
        <div className="flex items-baseline gap-[var(--space-3)]">
          <span className="font-display text-[length:var(--type-panel-title-display-size)] font-black text-[var(--brand-primary)]">
            {machine.number}
          </span>
          <PanelTitle as="h3" size="display">
            {machine.title}
          </PanelTitle>
        </div>
        <p className="font-mono text-sm text-[var(--text-muted)]">{machine.chain}</p>
        <PanelBody>{machine.lede}</PanelBody>
      </div>
      <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <img
          src={`/demos/rube-goldberg/${machine.slug}.gif`}
          alt={machine.alt}
          className="block w-full"
          loading="lazy"
        />
        <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-primary)]">The guard moment: </span>
          {machine.guard}
        </figcaption>
      </figure>
    </div>
  )
}

/** A titled demo GIF with a one-paragraph lede above and a caption below. */
function DemoShowcase({
  title,
  lede,
  src,
  alt,
  caption,
}: {
  title: string
  lede: ReactNode
  src: string
  alt: string
  caption: ReactNode
}) {
  return (
    <div className="space-y-[var(--space-4)]">
      <div className="max-w-[52rem] space-y-[var(--space-3)]">
        <PanelTitle as="h3" size="display">
          {title}
        </PanelTitle>
        <PanelBody>{lede}</PanelBody>
      </div>
      <figure className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <img src={src} alt={alt} className="block w-full" loading="lazy" />
        <figcaption className="border-t-2 border-[var(--border-strong)] px-[var(--space-4)] py-[var(--space-3)] text-sm text-[var(--text-muted)]">
          {caption}
        </figcaption>
      </figure>
    </div>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Radio
  title: string
  body: ReactNode
}) {
  return (
    <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]">
      <div className="mb-[var(--space-2)] flex items-center gap-2 text-[var(--brand-primary)]">
        <Icon size={18} />
        <span className="text-[length:var(--type-meta-size)] uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Behavior
        </span>
      </div>
      <PanelTitle as="h3" className="mb-[var(--space-2)] text-base">
        {title}
      </PanelTitle>
      <PanelBody className="text-sm">{body}</PanelBody>
    </div>
  )
}
