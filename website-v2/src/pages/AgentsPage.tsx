import {
  Activity,
  ArrowRight,
  BookOpen,
  Boxes,
  CheckCircle2,
  Clock,
  Code2,
  Compass,
  FileCheck2,
  FileLock2,
  FileText,
  GitBranch,
  Hammer,
  Lightbulb,
  Lock,
  Map,
  Radio,
  Route,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  BracketLabel,
  BracketLink,
  DocsCodeBlock,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'

type Concept = {
  label: string
  title: string
  body: string
  icon: LucideIcon
  tone: 'paper' | 'blue' | 'accent'
}

type ActorRole = {
  name: string
  roleKey: string
  label: string
  body: string
  icon: LucideIcon
}

type FleetAgent = {
  name: string
  roleKey: string
  wakes: string
  work: string
  runtime: string
  icon: LucideIcon
}

type OneOff = {
  title: string
  roleKey?: string
  label: string
  body: string
  command: string
  icon: LucideIcon
}

const CONCEPTS: Concept[] = [
  {
    label: 'Actor',
    title: 'Stable identity',
    body: 'A durable role with an address, inbox, history, and ownership. It can be dormant, recoverable, or attached to a live body.',
    icon: Boxes,
    tone: 'blue',
  },
  {
    label: 'Body lease',
    title: 'Temporary authority',
    body: 'A running agent process gets a lease while its heartbeat is fresh. Stale bodies lose authority without erasing the actor.',
    icon: Lock,
    tone: 'paper',
  },
  {
    label: 'Fleet',
    title: 'Always-on repo team',
    body: 'A pd-fleet.yml declares agents, triggers, schedules, budgets, backoff, and singleton rules for one project.',
    icon: Radio,
    tone: 'accent',
  },
  {
    label: 'Sortie',
    title: 'One tracked mission',
    body: 'A scoped run with a goal, backend, model, budget ceiling, event log, result, and project harbor.',
    icon: Route,
    tone: 'paper',
  },
]

const ACTOR_ROLES: ActorRole[] = [
  {
    name: 'Shipwright',
    roleKey: 'shipwright',
    label: 'Fleet architect',
    body: 'Surveys a repo, proposes an agent fleet, rehearses cost and trigger behavior, and turns setup into a guided control-plane flow.',
    icon: Hammer,
  },
  {
    name: 'Navigator / Cartographer',
    roleKey: 'navigator',
    label: 'Roadmap truth',
    body: 'Keeps roadmap, recovery, current work, and product direction aligned with what actually shipped.',
    icon: Map,
  },
  {
    name: 'Coxswain',
    roleKey: 'coxswain',
    label: 'Claims and locks',
    body: 'Watches file claims, symbol ownership, locks, stale assets, and coordination friction before agents collide.',
    icon: FileLock2,
  },
  {
    name: 'Lookout / Documentarian',
    roleKey: 'lookout',
    label: 'Product truth',
    body: 'Finds drift across docs, OpenAPI, CLI help, skills, website copy, and the live control plane.',
    icon: BookOpen,
  },
  {
    name: 'Quartermaster',
    roleKey: 'quartermaster',
    label: 'Budgets and backends',
    body: 'Owns spend ceilings, model tiers, backend readiness, spawn pressure, and resource policy.',
    icon: Wallet,
  },
  {
    name: 'Signalman / QA',
    roleKey: 'signalman',
    label: 'Evidence and validation',
    body: 'Tracks tests, validation proof, teardown warnings, and whether findings are actionable.',
    icon: FileCheck2,
  },
  {
    name: 'Harbormaster',
    roleKey: 'harbormaster',
    label: 'Runtime truth',
    body: 'Checks promotion readiness, daemon freshness, stable checkout cleanliness, and live provenance.',
    icon: ShieldCheck,
  },
  {
    name: 'Sounder',
    roleKey: 'sounder',
    label: 'Memory and tuples',
    body: 'Maintains tuple-first coordination, graph edges, episodic memory, and semantic joins.',
    icon: Activity,
  },
  {
    name: 'Breaker',
    roleKey: 'breaker',
    label: 'Failure paths',
    body: 'Models cascading failures, retry storms, circuit states, and forensic windows.',
    icon: Zap,
  },
  {
    name: 'Caulker',
    roleKey: 'caulker',
    label: 'Robustness repair',
    body: 'Closes teardown leaks, timeout debt, orphan cleanup, IPC rough edges, and brittle fallbacks.',
    icon: Wrench,
  },
]

const FLEET_AGENTS: FleetAgent[] = [
  {
    name: 'gardener',
    roleKey: 'gardener',
    wakes: 'every 10 min',
    work: 'Reports clean or dirty git status so the rest of the fleet knows the ground truth.',
    runtime: 'custom shell',
    icon: GitBranch,
  },
  {
    name: 'qa',
    roleKey: 'qa',
    wakes: 'git:committed',
    work: 'Reviews the commit and hunts for real bugs, weak tests, missing negative paths, and coverage theater.',
    runtime: 'Ollama',
    icon: CheckCircle2,
  },
  {
    name: 'test-hunter',
    roleKey: 'test-hunter',
    wakes: 'git:committed',
    work: 'Adds meaningful tests for low-coverage paths and proves they fail against no-op code.',
    runtime: 'Codex mini',
    icon: FileCheck2,
  },
  {
    name: 'documentarian',
    roleKey: 'documentarian',
    wakes: 'promotion gate',
    work: 'Syncs README, docs, SDK, OpenAPI, website, and the Port Daddy skill after a candidate is release-ready.',
    runtime: 'Ollama',
    icon: FileText,
  },
  {
    name: 'simplifier',
    roleKey: 'simplifier',
    wakes: 'git:committed',
    work: 'Removes needless complexity without changing behavior, then verifies the patch.',
    runtime: 'Codex mini',
    icon: Code2,
  },
  {
    name: 'cartographer',
    roleKey: 'cartographer',
    wakes: 'every 30 min',
    work: 'Updates roadmap state, harvests dogfood feedback, and marks what is built, blocked, or drifting.',
    runtime: 'Codex mini',
    icon: Compass,
  },
  {
    name: 'spark',
    roleKey: 'spark',
    wakes: 'every 30 min',
    work: 'Proposes one concrete improvement only after deduping against the idea trove.',
    runtime: 'Ollama',
    icon: Sparkles,
  },
  {
    name: 'spider',
    roleKey: 'spider',
    wakes: 'spark:idea + 2h',
    work: 'Finds non-obvious connections between existing features and emits scoped implementation sketches.',
    runtime: 'Ollama',
    icon: Lightbulb,
  },
]

const ONE_OFFS: OneOff[] = [
  {
    title: 'Sortie',
    roleKey: 'sortie',
    label: 'Tracked mission',
    body: 'Best when you have one explicit goal, a budget ceiling, and want status, logs, result, and residual risk tied to one mission id.',
    command: 'pd sortie run "Investigate flaky auth tests" --backend codex --budget 2',
    icon: Route,
  },
  {
    title: 'pd agent',
    label: 'Ad hoc delegation',
    body: 'Best when you want Port Daddy to open a scoped session, launch one worker, and close the loop without adding a recurring fleet member.',
    command: 'pd agent "Review this branch for launch blockers"',
    icon: Terminal,
  },
  {
    title: 'pd spawn',
    label: 'Low-level launch',
    body: 'Best when you need exact backend, model, tools, timeout, identity, or harbor control and want to own the coordination wrapper yourself.',
    command: 'pd spawn --backend codex --model gpt-5.4-mini -- "Inspect src/auth"',
    icon: Code2,
  },
]

const fleetSnippet = `cd ~/my-repo
pd setup
pd fleet init
pd fleet up

# Commit normally. The hook publishes git:committed.
git commit -m "ship a small slice"`

const sortieSnippet = `pd sortie run "Investigate flaky auth tests and patch if safe" \\
  --backend codex \\
  --model gpt-5.4-mini \\
  --budget 2 \\
  --expected "Root cause, patch, and residual risk"`

const actorSnippet = `pd actors
pd actors navigator --inbox --unread
pd actors coxswain --message "Need claim check before editing routes/fleet.ts"
pd actors lookout --message "Website copy changed; check product truth" --wake`

function IconBlock({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex h-[var(--space-7)] w-[var(--space-7)] items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]">
      <Icon className="h-[var(--space-4)] w-[var(--space-4)]" strokeWidth={2.25} />
    </div>
  )
}

export function AgentsPage() {
  return (
    <main className="min-h-screen bg-[var(--surface-base)] pt-24 text-[var(--text-primary)]">
      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <SwissGrid className="items-center gap-y-[var(--space-7)]">
            <SwissGridItem span="narrow" className="space-y-[var(--space-6)]">
              <BracketLabel>Agents</BracketLabel>
              <div className="space-y-[var(--space-4)]">
                <PanelTitle as="h1" size="hero" className="max-w-[11ch]">
                  Virtual actors for real repo work.
                </PanelTitle>
                <PanelBody className="max-w-[38rem]">
                  Port Daddy no longer treats an agent as a disposable chat run. It separates the
                  durable role from the live process, then lets you run recurring fleets or scoped
                  sorties against your own repositories.
                </PanelBody>
              </div>
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <BracketLink to="/tutorials/fleet">
                  <span className="inline-flex items-center gap-[var(--space-2)]">
                    Create a fleet
                    <ArrowRight className="h-[var(--space-3)] w-[var(--space-3)]" strokeWidth={2.25} />
                  </span>
                </BracketLink>
                <BracketLink to="/docs/cli/fleet" tone="accent">
                  <span className="inline-flex items-center gap-[var(--space-2)]">
                    Fleet CLI
                    <Terminal className="h-[var(--space-3)] w-[var(--space-3)]" strokeWidth={2.25} />
                  </span>
                </BracketLink>
              </div>
            </SwissGridItem>

            <SwissGridItem span="wide">
              <figure className="m-0 overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <picture>
                  <source srcSet="/img/generated/virtual-actor-fleet.webp" type="image/webp" />
                  <img
                    src="/img/generated/virtual-actor-fleet.jpg"
                    alt="Abstract system map of durable actor identities, temporary live body leases, fleet triggers, and sortie paths"
                    className="aspect-[16/9] w-full object-cover"
                    loading="eager"
                  />
                </picture>
              </figure>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <div className="mb-[var(--space-6)] max-w-[48rem] space-y-[var(--space-3)]">
            <BracketLabel>Twenty-second model</BracketLabel>
            <PanelTitle as="h2" size="display">
              Four words explain the system.
            </PanelTitle>
          </div>
          <div className="grid gap-[var(--panel-gap)] md:grid-cols-2 xl:grid-cols-4">
            {CONCEPTS.map((concept) => {
              const panelTone = concept.tone === 'blue' ? 'primary' : concept.tone === 'accent' ? 'accent' : 'default'
              const Icon = concept.icon
              return (
                <SurfacePanel key={concept.label} tone={concept.tone} className="space-y-[var(--panel-gap)]">
                  <div className="flex items-center justify-between gap-[var(--panel-gap)]">
                    <BracketLabel tone={panelTone} surface={concept.tone}>
                      {concept.label}
                    </BracketLabel>
                    <Icon className="h-[var(--space-5)] w-[var(--space-5)]" strokeWidth={2.25} />
                  </div>
                  <PanelTitle as="h3" size="nav" tone={panelTone}>
                    {concept.title}
                  </PanelTitle>
                  <PanelBody
                    size="compact"
                    tone={concept.tone === 'blue' ? 'primary' : concept.tone === 'accent' ? 'accent' : 'default'}
                    className="max-w-none"
                  >
                    {concept.body}
                  </PanelBody>
                </SurfacePanel>
              )
            })}
          </div>
        </PageContainer>
      </section>

      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <SwissGrid className="gap-y-[var(--space-6)]">
            <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
              <BracketLabel>Platform actors</BracketLabel>
              <PanelTitle as="h2" size="display">
                Always-on actors are the control plane.
              </PanelTitle>
              <PanelBody>
                These are not starter templates. They are named responsibility areas with inboxes
                and history, so a project can keep coordination, spend, runtime truth, and docs
                drift addressable across sessions.
              </PanelBody>
            </SwissGridItem>
            <SwissGridItem span="body">
              <div className="grid gap-[var(--panel-gap)] md:grid-cols-2">
                {ACTOR_ROLES.map((role) => (
                  <SurfacePanel key={role.name} elevation="quiet" className="space-y-[var(--panel-gap)]">
                    <div className="flex items-start gap-[var(--panel-gap)]">
                      <IconBlock icon={role.icon} />
                      <div className="min-w-0 space-y-[var(--space-1)]">
                        <PanelEyebrow>{role.label}</PanelEyebrow>
                        <PanelTitle as="h3" size="nav">
                          <RoleTerm role={role.roleKey}>{role.name}</RoleTerm>
                        </PanelTitle>
                      </div>
                    </div>
                    <PanelBody size="compact" className="max-w-none">
                      {role.body}
                    </PanelBody>
                  </SurfacePanel>
                ))}
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <div className="mb-[var(--space-6)] max-w-[52rem] space-y-[var(--space-3)]">
            <BracketLabel>Common fleet templates</BracketLabel>
            <PanelTitle as="h2" size="display">
              These are reusable repo agents.
            </PanelTitle>
            <PanelBody>
              These live in pd-fleet.yml. Install the ones that match the repo's needs, tune the
              prompts, and let triggers or schedules wake them.
            </PanelBody>
          </div>
          <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            {FLEET_AGENTS.map((agent, index) => {
              const Icon = agent.icon
              return (
                <div
                  key={agent.name}
                  className={[
                    'grid gap-[var(--panel-gap)] p-[var(--panel-padding)] md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,0.9fr)] md:items-start',
                    index < FLEET_AGENTS.length - 1 ? 'border-b-2 border-[var(--border-strong)]' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-[var(--space-3)]">
                    <IconBlock icon={Icon} />
                    <PanelTitle as="h3" size="nav">
                      <RoleTerm role={agent.roleKey}>{agent.name}</RoleTerm>
                    </PanelTitle>
                  </div>
                  <div>
                    <PanelEyebrow>Wakes</PanelEyebrow>
                    <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                      {agent.wakes}
                    </PanelBody>
                  </div>
                  <div>
                    <PanelEyebrow>Work</PanelEyebrow>
                    <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                      {agent.work}
                    </PanelBody>
                  </div>
                  <div>
                    <PanelEyebrow>Runtime</PanelEyebrow>
                    <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                      {agent.runtime}
                    </PanelBody>
                  </div>
                </div>
              )
            })}
          </div>
        </PageContainer>
      </section>

      <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <SwissGrid className="gap-y-[var(--space-6)]">
            <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
              <BracketLabel>One-offs</BracketLabel>
              <PanelTitle as="h2" size="display">
                Missions are separate from always-on work.
              </PanelTitle>
              <PanelBody>
                Use these when the task has a finish line. They should not become hidden
                background automation unless you promote the pattern into a fleet template.
              </PanelBody>
            </SwissGridItem>
            <SwissGridItem span="body">
              <div className="grid gap-[var(--panel-gap)] lg:grid-cols-3">
                {ONE_OFFS.map((item) => (
                  <SurfacePanel key={item.title} className="space-y-[var(--panel-gap)]">
                    <div className="flex items-start gap-[var(--panel-gap)]">
                      <IconBlock icon={item.icon} />
                      <div className="min-w-0 space-y-[var(--space-1)]">
                        <PanelEyebrow>{item.label}</PanelEyebrow>
                        <PanelTitle as="h3" size="nav">
                          {item.roleKey ? <RoleTerm role={item.roleKey}>{item.title}</RoleTerm> : item.title}
                        </PanelTitle>
                      </div>
                    </div>
                    <PanelBody size="compact" className="max-w-none">
                      {item.body}
                    </PanelBody>
                    <div className="block min-w-0 whitespace-pre-wrap break-words border border-[var(--border-default)] bg-[color:var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[11px] font-semibold leading-relaxed text-[var(--brand-primary)] [overflow-wrap:anywhere]">
                      {item.command}
                    </div>
                  </SurfacePanel>
                ))}
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>

      <section className="py-[var(--space-8)] lg:py-[var(--space-9)]">
        <PageContainer width="wide">
          <SwissGrid className="gap-y-[var(--space-6)]">
            <SwissGridItem span="rail" className="space-y-[var(--space-4)]">
              <BracketLabel>Use it</BracketLabel>
              <PanelTitle as="h2" size="display">
                Start recurring work or launch one mission.
              </PanelTitle>
              <PanelBody>
                Fleets are for work that should keep happening. Sorties are for a specific scoped
                goal. Actors give those runs durable addresses and inboxes.
              </PanelBody>
            </SwissGridItem>
            <SwissGridItem span="body">
              <div className="grid gap-[var(--panel-gap)] lg:grid-cols-3">
                <SurfacePanel className="space-y-[var(--panel-gap)]">
                  <div className="flex items-center gap-[var(--panel-gap)]">
                    <IconBlock icon={Clock} />
                    <PanelTitle as="h3" size="nav">
                      Create a repo fleet
                    </PanelTitle>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    Add the starter YAML and hook, then let scheduled and triggered agents run.
                  </PanelBody>
                  <DocsCodeBlock code={fleetSnippet} language="cli" label="Fleet setup" />
                </SurfacePanel>

                <SurfacePanel className="space-y-[var(--panel-gap)]">
                  <div className="flex items-center gap-[var(--panel-gap)]">
                    <IconBlock icon={Terminal} />
                    <PanelTitle as="h3" size="nav">
                      Run a sortie
                    </PanelTitle>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    Give one mission a budget, runtime, result expectation, and durable event log.
                  </PanelBody>
                  <DocsCodeBlock code={sortieSnippet} language="cli" label="Sortie" />
                </SurfacePanel>

                <SurfacePanel className="space-y-[var(--panel-gap)]">
                  <div className="flex items-center gap-[var(--panel-gap)]">
                    <IconBlock icon={ArrowRight} />
                    <PanelTitle as="h3" size="nav">
                      Address actors
                    </PanelTitle>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    Send work to stable roles instead of guessing which live process is present.
                  </PanelBody>
                  <DocsCodeBlock code={actorSnippet} language="cli" label="Actor inboxes" />
                </SurfacePanel>
              </div>
            </SwissGridItem>
          </SwissGrid>
        </PageContainer>
      </section>
    </main>
  )
}
