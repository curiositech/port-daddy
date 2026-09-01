import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  FileClock,
  FileSearch,
  LockKeyhole,
  MessagesSquare,
  Radio,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { ParleyTmuxReplay } from '@/components/harness/ParleyTmuxReplay'
import { PortholeEmbed } from '@/components/porthole/PortholeEmbed'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'

type EvidenceState = 'recorded' | 'source-only' | 'join-only' | 'proposed'

type PortholeScene = {
  id: string
  number: string
  station: string
  title: string
  moment: string
  intervention: string
  proof: string
  authority: string
  format: string
  hash: string
  cast: string
  color: string
  icon: LucideIcon
}

const PORTHOLE_SCENES: readonly PortholeScene[] = [
  {
    id: 'quickstart',
    number: '01',
    station: 'Arrival',
    title: 'A fresh machine gets a named, healthy harbor.',
    moment: 'The agent is about to begin work in an empty repository with no Port Daddy process already running.',
    intervention: 'The released binary starts one named daemon profile and makes that exact control plane active.',
    proof: 'Version, PID, home-collapsed paths, and converged health are read back from the real process.',
    authority: 'Release archive · isolated HOME · daemon process',
    format: 'single shell · 100×28',
    hash: '662c843071e09ecc8570881d9852c67ba118da486e8440723fb637bdc9a68c5e',
    cast: '/casts/porthole/quickstart.cast',
    color: '#3f7614',
    icon: Radio,
  },
  {
    id: 'harness-next-turn',
    number: '02',
    station: 'Before the decision',
    title: 'The model sees bounded context, not transport sludge.',
    moment: 'The agent has one unread message and one relevant policy document nearby.',
    intervention: 'The registered turn-start hook admits only the unread count and standing SITREP contract, separated from shell output and agent speech.',
    proof: 'The cast shows the exact bounded context, then reads the durable message and discovers the source document separately.',
    authority: 'Hook scripts · daemon inbox · hybrid idea search',
    format: 'single shell · 100×28',
    hash: 'e18b129c34767d7afd67d03d2d0a04b5d664c68ccfbc0c17ceac66205351804b',
    cast: '/casts/porthole/harness-next-turn.cast',
    color: '#8b4faf',
    icon: Sparkles,
  },
  {
    id: 'collision',
    number: '03',
    station: 'Before the side effect',
    title: 'A contested action stops in unmistakable red.',
    moment: 'Two agents in different worktrees reach for the same non-mergeable migration lock.',
    intervention: 'Port Daddy grants the first live holder and refuses the second while preserving both identities and claims.',
    proof: 'The same lock is requested twice; the second pane receives the real refusal and names the holder.',
    authority: 'tmux PTYs · linked worktrees · daemon lock',
    format: 'tmux · 2 agents · 120×34',
    hash: '37aa832e2ba4b2cecf9f0a5f02aced2fcad38d4ee37925bdbf426f9f185fd36b',
    cast: '/casts/porthole/collision.cast',
    color: '#b42318',
    icon: LockKeyhole,
  },
  {
    id: 'visibility',
    number: '04',
    station: 'Across real time',
    title: 'A quiet interval stays on the clock.',
    moment: 'Two agents leave durable notes, go quiet, and return after a real wait.',
    intervention: 'Porthole compresses only the silent display interval and marks the discontinuity with a broken axis.',
    proof: 'Before and after clocks differ by more than eighty seconds; source duration remains 112 seconds.',
    authority: 'Wall clock · literal timestamps · no staged narration',
    format: 'tmux · 2 agents · jump cut',
    hash: '552c9fc69435bb22d5d4913d5126e08670348246528a03201a49eed02c5bb5e0',
    cast: '/casts/porthole/visibility.cast',
    color: '#a15c00',
    icon: FileClock,
  },
  {
    id: 'ports',
    number: '05',
    station: 'Runtime read-back',
    title: 'Configuration, registration, discovery, and health agree.',
    moment: 'A tiny service is declared but no process is running when capture begins.',
    intervention: 'One pane launches it; another probes HTTP, semantic discovery, health, and teardown.',
    proof: 'Every layer agrees on porthole-service-proof:app:main after the live HTTP probe succeeds.',
    authority: 'Child process · HTTP response · pd up/down lifecycle',
    format: 'tmux · service + probe',
    hash: '771b81d817c78af80967112bb0f8ae15cd7aaee3b16136b2127cf4795f58d241',
    cast: '/casts/porthole/ports.cast',
    color: '#007c91',
    icon: Terminal,
  },
  {
    id: 'parley',
    number: '06',
    station: 'Shared decision',
    title: 'A plan changes under three distinct roles.',
    moment: 'Nora, Milo, and Aya disagree about capture order, inventory safety, and retry safety.',
    intervention: 'Each participant reads the same durable six-turn record through a compact decision projection.',
    proof: 'Proposal, two objections, one revision, two individual agreements, and caught-up receipts remain visible.',
    authority: 'Parley record · participant-bound projections',
    format: 'tmux · 3 receipt panes · 140×40',
    hash: '2a25a0516bd61dfa23022378586176bfe8da088e58610a7f55e5e38dadc8d1c6',
    cast: '/casts/porthole/parley.cast',
    color: '#c35a24',
    icon: MessagesSquare,
  },
  {
    id: 'parley-source',
    number: '07',
    station: 'Protocol audit',
    title: 'The real four-pane source stays available underneath.',
    moment: 'An auditor needs more than the compact decision view.',
    intervention: 'Three live sessions remain distinct while a fourth read-only witness explains committed public moves.',
    proof: 'Every pane has its own prompt, identity, history, receipt frontier, and independently scrollable archive.',
    authority: 'tmux PTYs · three sessions · read-only projection',
    format: 'tmux · 3 sessions + witness · 160×44',
    hash: 'f90e60937b6141d287274ab1f5b863e4f4f63f9e8100cc138f7f79365941b9d0',
    cast: '/casts/porthole/parley-source.cast',
    color: '#0b57c9',
    icon: Eye,
  },
] as const

type HarnessContext = {
  phase: string
  title: string
  naturalCopy: string
  state: EvidenceState
  sceneId?: string
  contract: string
}

const HARNESS_CONTEXTS: readonly HarnessContext[] = [
  {
    phase: 'Control-plane arrival',
    title: 'Named daemon and readiness',
    naturalCopy: 'This is the daemon and runtime you are about to trust. Its identity and health agree.',
    state: 'recorded',
    sceneId: 'quickstart',
    contract: 'Named daemon and readiness read-back',
  },
  {
    phase: 'Provider SessionStart',
    title: 'Pilot identity and salvage nudge',
    naturalCopy: 'Coordinate before editing. Interrupted runs exist nearby; review them before starting duplicate work.',
    state: 'source-only',
    contract: 'Claude Pilot policy and bounded salvage count',
  },
  {
    phase: 'Before a turn',
    title: 'Bounded suggestion',
    naturalCopy: 'One unread message and one relevant policy may change your next decision.',
    state: 'recorded',
    sceneId: 'harness-next-turn',
    contract: 'Current Squid next-turn envelope',
  },
  {
    phase: 'Before a scarce resource',
    title: 'Lock authority and collision',
    naturalCopy: 'Another worker holds this non-mergeable resource. The second lock request was refused.',
    state: 'recorded',
    sceneId: 'collision',
    contract: 'Claims, lock holder, and refusal',
  },
  {
    phase: 'Before a direct edit',
    title: 'Provider edit refusal',
    naturalCopy: 'This file is held by another agent. The edit did not run; coordinate or wait.',
    state: 'source-only',
    contract: 'PreToolUse path extraction and foreign-owner decision',
  },
  {
    phase: 'After an ordinary tool',
    title: 'No automatic trace injection',
    naturalCopy: 'Nothing is injected here. Claims and explicit notes remain the cumulative coordination trail.',
    state: 'source-only',
    contract: 'Retired PostToolUse; no per-tool process fan-out',
  },
  {
    phase: 'At turn close',
    title: 'SITREP closeout gate',
    naturalCopy: 'This turn is missing its compact handoff. Add the SITREP, then finish.',
    state: 'source-only',
    contract: 'Stop / Gemini AfterAgent closeout contract',
  },
  {
    phase: 'Across a wait',
    title: 'Literal elapsed time',
    naturalCopy: 'Nothing happened here for eighty seconds. The replay is shorter; the evidence clock is not.',
    state: 'recorded',
    sceneId: 'visibility',
    contract: 'Timestamp discontinuity and broken axis',
  },
  {
    phase: 'Service lifecycle',
    title: 'Process and discovery',
    naturalCopy: 'The process is alive, the endpoint answers, and the semantic name resolves to the same service.',
    state: 'recorded',
    sceneId: 'ports',
    contract: 'Launch, HTTP, discovery, health, teardown',
  },
  {
    phase: 'When plans converge',
    title: 'Parley recommendation',
    naturalCopy: 'Your plan is close enough to two other roles that the disagreement needs a shared decision.',
    state: 'recorded',
    sceneId: 'parley',
    contract: 'Manual three-session Parley evidence',
  },
  {
    phase: 'During review',
    title: 'Public rationale',
    naturalCopy: 'Here is the proposal, the blocking objection, the revision, and who has actually caught up.',
    state: 'recorded',
    sceneId: 'parley-source',
    contract: 'Public turns and participant read receipts',
  },
  {
    phase: 'Output pressure',
    title: 'Referenced, not stuffed into context',
    naturalCopy: 'The omitted output remains available through a bounded reference; it was not silently loaded.',
    state: 'join-only',
    contract: 'BufferedOutputRef',
  },
  {
    phase: 'Before compaction',
    title: 'Checkpoint direction',
    naturalCopy: 'Checkpoint the cited plan before compacting. A hook firing does not prove a packet exists.',
    state: 'source-only',
    contract: 'Claude PreCompact lifecycle boundary',
  },
  {
    phase: 'Continuity issuance',
    title: 'Packet ready or withheld',
    naturalCopy: 'These obligations, risks, decisions, and evidence heads survive, or the missing witness stays visible.',
    state: 'join-only',
    contract: 'ContextEnvelope + CompactionPacket',
  },
  {
    phase: 'Completion',
    title: 'Reviewer-facing receipt',
    naturalCopy: 'This intent, scope, test, rollback, spend, and evidence set is what the work actually proved.',
    state: 'join-only',
    contract: 'WorkReceipt',
  },
  {
    phase: 'Before persistence',
    title: 'Privacy disposition',
    naturalCopy: 'Sensitive cells were dropped or redacted before any durable write, and the declared perimeter scans clean.',
    state: 'proposed',
    contract: 'Screen-aware pre-write privacy gateway',
  },
  {
    phase: 'After failure',
    title: 'Controlled successor branch',
    naturalCopy: 'Start one isolated successor from the last verified checkpoint and compare its receipt to the original.',
    state: 'proposed',
    contract: 'T5 checkpoint and branch authority receipt',
  },
] as const

const KILLER_DEMO_CONTRACT = [
  {
    title: 'Exact screen and source time',
    state: 'recorded' as const,
    body: 'Selectable terminal text, terminal geometry, semantic color, real tmux perspectives, and marked jump cuts are live in the recordings above.',
  },
  {
    title: 'Command and runtime outcome',
    state: 'recorded' as const,
    body: 'The service and collision witnesses show the real command, refusal or exit, semantic identity, HTTP result, and teardown read-back.',
  },
  {
    title: 'Decision context and omitted output',
    state: 'join-only' as const,
    body: 'ContextEnvelope, CompactionPacket, and BufferedOutputRef get a Porthole view only after their owning branches merge and the exact join is re-recorded.',
  },
  {
    title: 'Normalized work receipt',
    state: 'join-only' as const,
    body: 'A cast is not a WorkReceipt. Porthole will attach to the canonical receipt instead of inventing a second authority.',
  },
  {
    title: 'No-secret-on-disk proof',
    state: 'proposed' as const,
    body: 'The privacy claim requires classification and redaction before the first durable write, followed by an exhaustive scan of the declared storage perimeter.',
  },
  {
    title: 'Branch from a verified checkpoint',
    state: 'proposed' as const,
    body: 'Playback seeking is not time travel. A controlled successor needs a distinct identity, bounded repair delta, isolated runtime, and branch receipt.',
  },
] as const

const STATE_COPY: Record<EvidenceState, string> = {
  recorded: 'Recorded now',
  'source-only': 'Source · needs capture',
  'join-only': 'Integration join',
  proposed: 'Proposed',
}

function EvidenceBadge({ state }: { state: EvidenceState }) {
  const className =
    state === 'recorded'
      ? 'border-[var(--status-success)] bg-[var(--status-success)] text-white'
      : state === 'source-only'
        ? 'border-[var(--status-warning)] bg-[var(--surface-base)] text-[var(--status-warning)]'
      : state === 'join-only'
        ? 'border-[var(--brand-primary)] bg-[var(--surface-base)] text-[var(--brand-primary)]'
        : 'border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]'

  return (
    <span className={`inline-flex min-h-7 items-center border-2 px-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${className}`}>
      {STATE_COPY[state]}
    </span>
  )
}

function PlainLayer({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <article className="grid gap-[var(--space-3)] bg-[var(--surface-raised)] p-[var(--space-4)]">
      <Icon size={22} className="text-[var(--brand-primary)]" />
      <PanelTitle as="h3" size="nav" className="max-w-[20ch]">{title}</PanelTitle>
      <PanelBody size="compact" className="max-w-none">{children}</PanelBody>
    </article>
  )
}

export default function HarnessPage() {
  const [activeSceneId, setActiveSceneId] = useState('collision')
  const activeScene = PORTHOLE_SCENES.find((scene) => scene.id === activeSceneId) ?? PORTHOLE_SCENES[0]
  const ActiveSceneIcon = activeScene.icon

  return (
    <div className="min-h-screen bg-[var(--surface-base)] text-[var(--text-primary)]">
      <main>
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-end">
              <div className="space-y-[var(--space-5)]">
                <BracketLabel>Porthole · evidence from real agent runs</BracketLabel>
                <h1 className="max-w-[13ch] text-balance font-sans text-[clamp(3.4rem,8vw,7.5rem)] font-black leading-[0.88] tracking-[-0.06em]">
                  See what the agent saw before it acted.
                </h1>
                <PanelBody className="max-w-[54rem] text-[length:var(--type-panel-body-large-size)]">
                  A harness is the safety, context, and continuity layer around an agent. Port Daddy
                  supplies the durable team state. Porthole records the terminal evidence so a person
                  can inspect what changed, what was refused, and why.
                </PanelBody>
                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <Button asChild size="lg">
                    <a href="#proof-workbench">Watch the proof <ArrowRight size={16} /></a>
                  </Button>
                  <Button asChild variant="secondary" size="lg">
                    <a href="#harness-contexts">See every context moment</a>
                  </Button>
                </div>
              </div>

              <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3 lg:grid-cols-1">
                <PlainLayer icon={Users} title="The agent does the work.">
                  It reads the task, chooses commands, edits files, and explains its result.
                </PlainLayer>
                <PlainLayer icon={ShieldCheck} title="Port Daddy governs the work.">
                  It remembers identity, sessions, claims, locks, messages, Parleys, budgets, and receipts.
                </PlainLayer>
                <PlainLayer icon={Eye} title="Porthole makes the evidence inspectable.">
                  It replays the real terminal bytes as selectable text. It does not invent a decision or upgrade a recording into a receipt.
                </PlainLayer>
              </div>
            </div>
          </PageContainer>
        </section>

        <section id="proof-workbench" className="scroll-mt-20 border-b-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Seven real witnesses · not one stitched story"
              title="Choose the moment you want to verify."
              description="Every scene below is a fresh Porthole cast with a source digest and a bounded claim. Changing scenes destroys the old player and restarts the selected witness from time zero."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[18ch]"
              bodyClassName="max-w-[58rem]"
            />

            <div className="mt-[var(--space-7)] grid min-w-0 gap-[var(--space-4)] xl:grid-cols-[20rem_minmax(0,1fr)]">
              <nav className="grid content-start gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)]" aria-label="Porthole evidence scenes">
                {PORTHOLE_SCENES.map((scene) => {
                  const SceneIcon = scene.icon
                  const selected = scene.id === activeScene.id
                  return (
                    <button
                      key={scene.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setActiveSceneId(scene.id)}
                      className={`grid min-h-[5.5rem] grid-cols-[2.25rem_minmax(0,1fr)] gap-[var(--space-3)] border-l-[0.45rem] p-[var(--space-3)] text-left transition-colors focus-visible:outline-4 focus-visible:outline-[var(--focus-ring)] ${selected ? 'bg-[var(--surface-base)]' : 'bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)]'}`}
                      style={{ borderLeftColor: scene.color }}
                    >
                      <span className="grid h-9 w-9 place-items-center border border-[var(--border-strong)] bg-[var(--surface-base)]" style={{ color: scene.color }}>
                        <SceneIcon size={17} />
                      </span>
                      <span>
                        <span className="block font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--text-muted)]">
                          {scene.number} · {scene.station}
                        </span>
                        <strong className="mt-1 block font-sans text-[length:var(--type-panel-body-compact-size)] leading-[1.2]">
                          {scene.title}
                        </strong>
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="min-w-0 space-y-[var(--space-4)]">
                <SurfacePanel elevation="raised" padding="compact" className="min-w-0 space-y-[var(--space-4)] overflow-hidden">
                  <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div>
                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)]" style={{ color: activeScene.color }}>
                          <ActiveSceneIcon size={19} />
                        </span>
                        <EvidenceBadge state="recorded" />
                        <PanelEyebrow>{activeScene.format}</PanelEyebrow>
                      </div>
                      <PanelTitle as="h3" size="display" className="mt-[var(--space-3)] max-w-[18ch]">
                        {activeScene.title}
                      </PanelTitle>
                    </div>
                    <div className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)] lg:text-right">
                      <div>{activeScene.station}</div>
                      <div>sha256 {activeScene.hash.slice(0, 12)}</div>
                    </div>
                  </div>

                  <PortholeEmbed key={activeScene.id} src={activeScene.cast} label={`Replay ${activeScene.title}`} eager />

                  <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] md:grid-cols-3">
                    <article className="bg-[var(--surface-raised)] p-[var(--space-3)]">
                      <PanelEyebrow>What was happening</PanelEyebrow>
                      <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">{activeScene.moment}</PanelBody>
                    </article>
                    <article className="bg-[var(--surface-raised)] p-[var(--space-3)]">
                      <PanelEyebrow>What Port Daddy did</PanelEyebrow>
                      <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">{activeScene.intervention}</PanelBody>
                    </article>
                    <article className="bg-[var(--surface-raised)] p-[var(--space-3)]">
                      <PanelEyebrow>What proves it</PanelEyebrow>
                      <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">{activeScene.proof}</PanelBody>
                    </article>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-l-[0.45rem] border-l-[var(--brand-primary)] bg-[var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)]">
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--brand-primary)]">Authority</span>
                    <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-secondary)]">{activeScene.authority}</span>
                  </div>
                </SurfacePanel>
              </div>
            </div>
          </PageContainer>
        </section>

        <section id="harness-contexts" className="scroll-mt-20 border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="The context atlas"
              title="A harness can meet the agent at seventeen different moments."
              description="The useful unit is not a tentacle name. It is the smallest timely fact that changes a decision without taking the decision away from the agent. Recorded moments link back to evidence; future contracts stay visibly unplayed."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[22ch]"
              bodyClassName="max-w-[58rem]"
            />

            <div className="mt-[var(--space-7)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] md:grid-cols-2 xl:grid-cols-3">
              {HARNESS_CONTEXTS.map((context, index) => {
                const scene = context.sceneId ? PORTHOLE_SCENES.find((candidate) => candidate.id === context.sceneId) : undefined
                const body = (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)]">
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black text-[var(--text-muted)]">{String(index + 1).padStart(2, '0')}</span>
                      <EvidenceBadge state={context.state} />
                    </div>
                    <PanelEyebrow className="mt-[var(--space-4)]">{context.phase}</PanelEyebrow>
                    <PanelTitle as="h3" size="card" className="mt-[var(--space-2)] max-w-[20ch]">{context.title}</PanelTitle>
                    <blockquote className="mt-[var(--space-3)] border-l-[0.35rem] border-l-[var(--brand-accent)] pl-[var(--space-3)] font-sans text-[length:var(--type-panel-body-compact-size)] font-bold leading-[1.35] text-[var(--text-primary)]">
                      “{context.naturalCopy}”
                    </blockquote>
                    <div className="mt-[var(--space-4)] flex items-end justify-between gap-[var(--space-3)]">
                      <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">{context.contract}</span>
                      {scene ? <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--brand-primary)]">open proof ↗</span> : null}
                    </div>
                  </>
                )

                return scene ? (
                  <a
                    href="#proof-workbench"
                    key={`${context.phase}-${context.title}`}
                    className="block min-h-[18rem] bg-[var(--surface-raised)] p-[var(--space-4)] hover:bg-[var(--interactive-hover)] focus-visible:outline-4 focus-visible:outline-[var(--focus-ring)]"
                    onClick={() => setActiveSceneId(scene.id)}
                    style={{ boxShadow: `inset 0 0.45rem 0 ${scene.color}` }}
                  >
                    {body}
                  </a>
                ) : (
                  <article key={`${context.phase}-${context.title}`} className="min-h-[18rem] bg-[var(--surface-sunken)] p-[var(--space-4)]">
                    {body}
                  </article>
                )
              })}
            </div>
          </PageContainer>
        </section>

        <section id="parley-proof" className="scroll-mt-20 border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="Parley · primary view and audit source"
              title="Agents should see a conversation. Auditors can open the protocol."
              description="The primary recording removes raw performatives and shows one proposal changing under two independent objections. The tmux drill-down keeps every distinct shell, session, prompt, public turn, and read receipt available underneath."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[24ch]"
              bodyClassName="max-w-[60rem]"
            />

            <div id="parley-primary-proof" className="mt-[var(--space-7)] scroll-mt-20">
              <SurfacePanel elevation="raised" padding="compact" className="grid min-w-0 gap-[var(--space-5)] lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.5fr)]">
                <div className="min-w-0">
                  <PortholeEmbed src="/casts/porthole/parley.cast" label="Replay the compact three-party Parley decision view" />
                </div>
                <div className="grid content-center gap-[var(--space-3)]">
                  <EvidenceBadge state="recorded" />
                  <PanelTitle as="h3" size="card" className="max-w-[20ch]">One plan, two objections, one revision.</PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    Nora proposes capture-first. Milo exposes the inventory failure. Aya adds retry safety. Nora revises the order, then each reviewer closes only their own objection. CONVENED is visible; global settlement is not fabricated.
                  </PanelBody>
                </div>
              </SurfacePanel>
            </div>

            <div className="mt-[var(--space-6)]">
              <ParleyTmuxReplay />
            </div>
          </PageContainer>
        </section>

        <section className="border-b-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SectionIntro
              eyebrow="The killer-demo contract"
              title="Click the failed decision. Follow only evidence that exists."
              description="The complete Porthole promise reaches from the exact pre-decision screen to context, omissions, receipt, privacy proof, and a controlled successor. This table is intentionally uneven: green has a recording, blue waits for an integration join, and gray is engineering direction."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[23ch]"
              bodyClassName="max-w-[60rem]"
            />

            <div className="mt-[var(--space-7)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] md:grid-cols-2 xl:grid-cols-3">
              {KILLER_DEMO_CONTRACT.map((item) => (
                <article key={item.title} className="bg-[var(--surface-raised)] p-[var(--space-4)]">
                  <EvidenceBadge state={item.state} />
                  <PanelTitle as="h3" size="card" className="mt-[var(--space-3)] max-w-[20ch]">{item.title}</PanelTitle>
                  <PanelBody size="compact" className="mt-[var(--space-3)] max-w-none">{item.body}</PanelBody>
                </article>
              ))}
            </div>

            <SurfacePanel elevation="quiet" padding="default" className="mt-[var(--space-6)] grid gap-[var(--space-4)] lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
              <FileSearch size={30} className="text-[var(--brand-primary)]" />
              <div>
                <PanelTitle as="h3" size="card">What Porthole is becoming</PanelTitle>
                <PanelBody className="mt-[var(--space-2)] max-w-[64rem]">
                  A privacy-safe evidence, continuity, and debugging layer for autonomous work: searchable terminal and process observations correlated to Port Daddy identity, context, authority, and receipts. The terminal player is the lens. The durable evidence graph is the product.
                </PanelBody>
              </div>
            </SurfacePanel>
          </PageContainer>
        </section>

        <section className="py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide">
            <SurfacePanel tone="blue" elevation="raised" padding="default" className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)] lg:items-end">
              <div>
                <PanelEyebrow>Run a harnessed agent</PanelEyebrow>
                <PanelTitle as="h2" size="display" tone="primary" className="mt-[var(--space-3)] max-w-[18ch]">
                  Install the control plane. Arm this project. Inspect the next turn.
                </PanelTitle>
                <PanelBody tone="primary" className="mt-[var(--space-3)] max-w-[48rem]">
                  The operator should not need daemon incantations. FleetBar is the control surface; these three commands are the agent-side quick path and the exact source of the current harness-context witness.
                </PanelBody>
                <div className="mt-[var(--space-4)] flex flex-wrap gap-[var(--space-3)]">
                  <Button asChild variant="secondary" size="lg">
                    <Link to="/docs/quickstart">Read the quickstart <ArrowRight size={16} /></Link>
                  </Button>
                  <Button asChild variant="ghost" size="lg">
                    <Link to="/security"><CheckCircle2 size={16} /> Inspect the safety boundary</Link>
                  </Button>
                </div>
              </div>
              <CodeBlock language="bash" filename="agent-side quick path">
                {`brew install curiositech/tap/port-daddy
pd setup
pd squid on && pd squid tap`}
              </CodeBlock>
            </SurfacePanel>
          </PageContainer>
        </section>
      </main>
      <Footer />
    </div>
  )
}
