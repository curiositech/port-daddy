import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'
import { cn } from '@/lib/utils'

/**
 * AgentAnatomy — the canonical "what IS a pd-tube/fleet agent?" dissection.
 *
 * PlaygroundExplainer answers the concepts (channel / trigger / daemon /
 * FleetBar). HowItsWired answers them per demo. This component answers them
 * once, concretely, on a single REAL agent: it shows the Gardener exactly as it
 * is declared in Port Daddy's own pd-fleet.yml and labels every line — so the
 * reader can point at the name, the trigger the daemon dispatches on, the model
 * backend and its fallbacks, the singleton guard, and — the question the demos
 * always provoke — the literal prompt block the model runs with.
 *
 * Ground truth: /Users/erichowens/coding/port-daddy/pd-fleet.yml, the `gardener`
 * agent (verbatim, prompt included). Nothing here is invented; this is a real
 * shipping fleet agent.
 *
 * House style: cream/cobalt, indigo-black ink, flat 2px borders, zero radius,
 * >=14px text. The line<->note mapping is exposed to assistive tech via
 * aria-describedby so it is not a purely visual association.
 */

interface YamlLine {
  /** The raw line text (already indented). */
  text: string
  /** Annotation number, if this line is called out in the legend. */
  ref?: number
  /** Visual role — comments and the prompt body are dimmed so structure pops. */
  kind?: 'comment' | 'prompt' | 'key'
}

/** The Gardener, verbatim from pd-fleet.yml. The prompt is real and unedited. */
const LINES: YamlLine[] = [
  { text: 'fleet:', kind: 'key' },
  { text: '  name: port-daddy' },
  { text: '  harbor: "{project}:fleet"' },
  { text: '  agents:' },
  { text: '    gardener:', ref: 1, kind: 'key' },
  { text: '      trigger: git:committed', ref: 2 },
  { text: '      cooldown_ms: 1800000', ref: 3 },
  { text: '      dedupe_window_ms: 1800000', ref: 3 },
  { text: '      backend: cli:claude-code', ref: 4 },
  { text: '      fallbacks:', ref: 5 },
  { text: '        - backend: cli:codex' },
  { text: '        - backend: cloudflare' },
  { text: "          model: '@cf/qwen/qwen3-30b-a3b-fp8'" },
  { text: '      singleton: true', ref: 6 },
  { text: '      prompt: |', ref: 7, kind: 'key' },
  { text: '        You are Gardener. After every commit, audit the', kind: 'prompt' },
  { text: "        worktree's cleanliness. The bar is: would Erich,", kind: 'prompt' },
  { text: '        opening this repo cold, find anything that looks', kind: 'prompt' },
  { text: '        abandoned, suspicious, or accidentally committed?', kind: 'prompt' },
  { text: '', kind: 'prompt' },
  { text: '        Check:', kind: 'prompt' },
  { text: '        - Untracked files older than 7 days that should', kind: 'prompt' },
  { text: '          be gitignored (build artifacts, .DS_Store, ...)', kind: 'prompt' },
  { text: '        - Files committed by accident (binaries, .env*)', kind: 'prompt' },
  { text: '        - Stashes older than 30 days', kind: 'prompt' },
  { text: '        - Branches merged into main but not deleted', kind: 'prompt' },
  { text: '', kind: 'prompt' },
  { text: '        If clean: report CLEAN and close any open', kind: 'prompt' },
  { text: '        `gardener` issue with reason "resolved as of <sha>".', kind: 'prompt' },
  { text: '      identity: "{project}:fleet:gardener"', ref: 8 },
  { text: '      telos: "Keep the worktree\'s cleanliness visible."', ref: 9 },
]

interface Annotation {
  ref: number
  field: string
  what: ReactNode
  /** Where this lives / who acts on it — the "no magic" anchor. */
  where: string
}

const ANNOTATIONS: Annotation[] = [
  {
    ref: 1,
    field: 'gardener:',
    what: 'The agent’s name. This is its identity in the fleet — what FleetBar lists it as and what shows up in its session notes and issues.',
    where: 'You name it. A key under fleet.agents.',
  },
  {
    ref: 2,
    field: 'trigger:',
    what: (
      <>
        The event that wakes it. The daemon watches for this and dispatches the agent when it fires.
        Here, every git commit. Other triggers: <Mono>pull_request:opened</Mono>, a cron{' '}
        <Mono>schedule</Mono>, or a channel name (a <Mono>pd tube</Mono> mailbox).
      </>
    ),
    where: 'The local daemon watches it.',
  },
  {
    ref: 3,
    field: 'cooldown_ms / dedupe_window_ms',
    what: 'Debounce. Run at most once per 30 minutes and collapse duplicate triggers in that window, so a burst of commits does not spawn a swarm.',
    where: 'The daemon enforces it before dispatch.',
  },
  {
    ref: 4,
    field: 'backend:',
    what: (
      <>
        Which model/runner actually executes the agent. <Mono>cli:claude-code</Mono> shells out to your
        local Claude Code — zero marginal cost on a Max plan.
      </>
    ),
    where: 'The daemon spawns it.',
  },
  {
    ref: 5,
    field: 'fallbacks:',
    what: 'Ordered backups. If the primary backend is unhealthy or over budget, the daemon walks this list and uses the first healthy one — Codex, then a cheap Cloudflare model.',
    where: 'The daemon picks the first healthy backend.',
  },
  {
    ref: 6,
    field: 'singleton: true',
    what: 'At most one Gardener runs at a time. A second trigger while one is in flight is dropped, not stacked — no pile-ups.',
    where: 'The daemon guards it.',
  },
  {
    ref: 7,
    field: 'prompt: |',
    what: (
      <>
        <strong>This is the agent prompt.</strong> The literal instructions the model runs with — a
        multi-line string <em>you write</em>, sitting in plain sight in the file. Not generated, not
        hidden, not in the cloud. This is the answer to &ldquo;where the hell is the agent prompt?&rdquo;
      </>
    ),
    where: 'Handed verbatim to the model.',
  },
  {
    ref: 8,
    field: 'identity:',
    what: 'Its coordination identity — the handle it uses to open sessions, leave notes, and claim files so other agents see what it is touching.',
    where: 'Used by the daemon’s session ledger.',
  },
  {
    ref: 9,
    field: 'telos:',
    what: 'Its one-line purpose — why this agent exists. A north star for the operator and a label in the fleet view.',
    where: 'Shown to you in FleetBar.',
  },
]

export function AgentAnatomy() {
  const [activeRef, setActiveRef] = useState<number | null>(null)
  const baseId = useId().replace(/:/g, '')
  const noteId = (ref: number) => `${baseId}-note-${ref}`

  return (
    <SurfacePanel className="space-y-[var(--space-6)]">
      <div className="max-w-[52rem] space-y-[var(--space-3)]">
        <PanelEyebrow>Anatomy of a fleet agent</PanelEyebrow>
        <PanelTitle as="h2" size="display" className="max-w-[22ch]">
          One real agent, every line labeled.
        </PanelTitle>
        <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
          This is the <strong>Gardener</strong> — a real agent from Port Daddy&rsquo;s own{' '}
          <Mono>pd-fleet.yml</Mono>, shown verbatim, prompt and all. An agent is not a black box: it is
          a name, a trigger the daemon watches, a model backend, and a prompt you write. Hover or tap a
          numbered line to see what it does.
        </PanelBody>
      </div>

      <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The real YAML, with numbered call-outs. */}
        <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
          <div className="flex items-center justify-between border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="font-mono text-[length:var(--type-meta-size)] font-semibold text-[var(--text-secondary)]">
              pd-fleet.yml
            </span>
            <span className="font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              real, unedited
            </span>
          </div>
          <pre className="m-0 overflow-x-auto p-[var(--space-3)] font-mono text-[14px] leading-[1.7]">
            {LINES.map((line, i) => {
              const active = line.ref != null && line.ref === activeRef
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-[var(--space-2)] px-[var(--space-1)]',
                    line.ref != null && 'cursor-help',
                    active && 'bg-[color-mix(in_srgb,var(--brand-primary)_16%,transparent)]',
                  )}
                  onMouseEnter={() => line.ref != null && setActiveRef(line.ref)}
                  onMouseLeave={() => line.ref != null && setActiveRef(null)}
                >
                  <code
                    className={cn(
                      'whitespace-pre',
                      line.kind === 'comment' && 'text-[var(--text-muted)]',
                      line.kind === 'prompt' && 'text-[var(--text-secondary)]',
                      (line.kind === 'key' || !line.kind) && 'text-[var(--text-primary)]',
                    )}
                    aria-describedby={line.ref != null ? noteId(line.ref) : undefined}
                  >
                    {line.text || ' '}
                  </code>
                  {line.ref != null && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border px-[4px] text-[11px] font-bold leading-none',
                        active
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                          : 'border-[var(--border-default)] text-[var(--text-secondary)]',
                      )}
                    >
                      {line.ref}
                    </span>
                  )}
                </div>
              )
            })}
          </pre>
        </div>

        {/* The legend — each field, what it does, and who acts on it. */}
        <ol className="m-0 list-none space-y-[var(--space-2)] p-0">
          {ANNOTATIONS.map((note) => {
            const active = note.ref === activeRef
            return (
              <li
                key={note.ref}
                id={noteId(note.ref)}
                onMouseEnter={() => setActiveRef(note.ref)}
                onMouseLeave={() => setActiveRef(null)}
                className={cn(
                  'border-2 p-[var(--space-3)] transition-colors',
                  active
                    ? 'border-[var(--brand-primary)] bg-[var(--surface-raised)]'
                    : 'border-[var(--border-default)] bg-[var(--surface-base)]',
                )}
              >
                <div className="flex items-center gap-[var(--space-2)]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full border px-[5px] text-[12px] font-bold leading-none',
                      active
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                        : 'border-[var(--border-strong)] text-[var(--text-primary)]',
                    )}
                  >
                    {note.ref}
                  </span>
                  <Mono className="font-semibold">{note.field}</Mono>
                </div>
                <p className="mt-[var(--space-2)] font-sans text-[14px] leading-[1.55] text-[var(--text-secondary)]">
                  {note.what}
                </p>
                <p className="mt-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  {note.where}
                </p>
              </li>
            )
          })}
        </ol>
      </div>

      <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-2)]">
        <PanelEyebrow>The short version</PanelEyebrow>
        <PanelBody size="compact" className="max-w-[72ch]">
          An agent is nine lines of YAML: a <Mono>name</Mono>, a <Mono>trigger</Mono> the daemon
          watches, a <Mono>backend</Mono> (plus <Mono>fallbacks</Mono>) that runs it, a{' '}
          <Mono>singleton</Mono> guard, and a <Mono>prompt</Mono> you write. Drop it in{' '}
          <Mono>pd-fleet.yml</Mono>, run <Mono>pd fleet up</Mono>, and the local daemon owns the rest.
        </PanelBody>
        <div className="flex flex-wrap items-center gap-[var(--space-3)] pt-[var(--space-1)]">
          <AnatomyDocLink to="/docs/features/fleet">Read: Fleet</AnatomyDocLink>
          <AnatomyDocLink to="/tutorials/fleet">Tutorial: declare a fleet</AnatomyDocLink>
        </div>
      </SurfacePanel>
    </SurfacePanel>
  )
}

function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <code className={cn('font-mono text-[var(--brand-primary)]', className)}>{children}</code>
  )
}

function AnatomyDocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-[var(--space-1)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]"
    >
      {children}
    </Link>
  )
}
