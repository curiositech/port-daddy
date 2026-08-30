import { useRef } from 'react'
import { ArrowDownToLine, Eye, MessagesSquare, ShieldCheck, TerminalSquare } from 'lucide-react'
import { PortholeEmbed } from '@/components/porthole/PortholeEmbed'
import paneArchiveData from '@/data/evidence/parley-source-panes.json'
import {
  BracketLabel,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

const PARTICIPANTS = [
  {
    name: 'Nora',
    mark: '◆',
    role: 'Proposal author',
    color: '#87d75f',
    explanation: 'Owns checkout flow. Opens the plan, then revises it after both objections land.',
  },
  {
    name: 'Milo',
    mark: '◇',
    role: 'Adversarial reviewer',
    color: '#5fd7ff',
    explanation: 'Asks what happens when payment succeeds but inventory refuses the order.',
  },
  {
    name: 'Aya',
    mark: '●',
    role: 'Delivery safety owner',
    color: '#ff8700',
    explanation: 'Requires one idempotency key across reservation, authorization, and capture.',
  },
] as const

type PaneArchive = {
  schema: 'porthole.tmux-pane-archive.v1'
  sourceCast: string
  sourceCastSha256: string
  recordingStartedAt: string
  capturedAt: string
  outerTerminal: { cols: number; rows: number }
  capture: string
  capturedFromAvailableHistoryStart: boolean
  panes: Array<{
    id: string
    name: string
    mark: string
    role: string
    color: string
    title: string
    prompt: string
    geometry: { cols: number; rows: number }
    historySize: number
    historyLimit: number
    historyLimitReached: boolean
    digestSha256: string
    lines: string[]
  }>
}

const PANE_ARCHIVE = paneArchiveData as PaneArchive

function paneLineTone(line: string): string {
  if (/\b(?:REFUSED|ERROR|failed|denied|unhealthy)\b/i.test(line)) return 'text-[var(--status-error)] font-bold'
  if (/PORT DADDY WITNESS|\bWITNESS\b|CAUGHT UP/.test(line)) return 'text-[var(--brand-primary)] font-semibold'
  if (/^(?:NORA◆|MILO◇|AYA●)\s+❯/.test(line)) return 'text-[var(--ph-command)] font-semibold'
  if (/\b(?:session|agent)-[a-z0-9-]+\b/i.test(line)) return 'text-[var(--session)]'
  return 'text-[var(--ph-text)]'
}

function PaneScrollback({ pane }: { pane: PaneArchive['panes'][number] }) {
  const scrollRef = useRef<HTMLPreElement>(null)

  return (
    <article
      className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]"
      style={{ borderTopColor: pane.color, borderTopWidth: '0.45rem' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
        <div>
          <strong className="font-sans text-[length:var(--type-panel-title-nav-size)]">
            <span aria-hidden="true" style={{ color: pane.color }}>{pane.mark}</span>{' '}
            {pane.name}
          </strong>
          <span className="mt-1 block font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--text-muted)]">
            {pane.role}
          </span>
        </div>
        <button
          type="button"
          aria-controls={`pane-history-${pane.id}`}
          aria-label={`Jump ${pane.name} tmux pane scrollback to latest`}
          className="inline-flex min-h-11 items-center gap-1 border border-[var(--border-strong)] px-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--brand-primary)] hover:bg-[var(--interactive-hover)] focus-visible:outline-4 focus-visible:outline-[var(--focus-ring)]"
          onClick={() => {
            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          }}
        >
          <ArrowDownToLine size={14} /> latest
        </button>
      </div>
      <pre
        id={`pane-history-${pane.id}`}
        ref={scrollRef}
        role="region"
        tabIndex={0}
        aria-label={`${pane.name} tmux pane scrollback, ${pane.lines.length} lines`}
        className="h-[19rem] min-h-0 max-w-none overflow-auto whitespace-pre-wrap break-words p-[var(--space-3)] font-mono text-[length:var(--type-code-size)] leading-[1.45] [scrollbar-color:var(--brand-primary)_var(--surface-sunken)] focus-visible:outline-4 focus-visible:outline-[var(--focus-ring)]"
      >
        {pane.lines.map((line, index) => (
          <span className={`block min-h-[1.45em] ${paneLineTone(line)}`} key={`${pane.id}-${index}`}>
            {line || '\u00a0'}
          </span>
        ))}
      </pre>
      <div className="flex flex-wrap justify-between gap-[var(--space-2)] border-t border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
        <span>{pane.lines.length} captured lines</span>
        <span>{pane.historyLimitReached ? 'tmux history limit reached' : 'available history below limit'}</span>
      </div>
    </article>
  )
}

/**
 * Show the protocol-source Parley as a real tmux recording, with a visual key
 * for each participant and the read-only witness pane. The witness explains
 * only committed public turns; it never claims access to private reasoning.
 */
export function ParleyTmuxReplay() {
  return (
    <section aria-labelledby="parley-tmux-title" id="parley-tmux-replay">
      <SurfacePanel elevation="raised" padding="default" className="grid min-w-0 gap-[var(--space-6)] overflow-hidden">
        <div className="grid min-w-0 items-end gap-[var(--space-5)] lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-[var(--space-3)]">
            <BracketLabel>Protocol drill-down · real four-pane tmux</BracketLabel>
            <PanelTitle as="h2" size="display" className="max-w-[18ch]" id="parley-tmux-title">
              See the shared moment. Then inspect every pane.
            </PanelTitle>
            <PanelBody className="max-w-[54rem]">
              Nora, Milo, and Aya occupy different linked worktrees, shells, and Port Daddy sessions.
              The fourth pane is a read-only witness: it follows the durable record and explains what
              each public move changed at the moment it commits. This is the audit view under the
              floorboards, not the Parley experience agents should have to operate by hand.
            </PanelBody>
          </div>
          <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] p-[var(--space-3)]">
            <div className="flex items-start gap-[var(--space-2)]">
              <ShieldCheck size={19} className="mt-0.5 shrink-0 text-[var(--brand-primary)]" />
              <div>
                <PanelEyebrow>Honesty boundary</PanelEyebrow>
                <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">
                  These are public explanations and protocol receipts, not private chain of thought.
                  The fixture proves three distinct sessions executing a real multiparty protocol; it
                  does not claim three independently sampled model minds.
                </PanelBody>
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-w-0 gap-[var(--space-4)] xl:grid-cols-[minmax(0,1.75fr)_minmax(18rem,0.65fr)]">
          <div className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] p-1">
            <PortholeEmbed
              src="/casts/porthole/parley-source.cast"
              label="Replay a real four-pane tmux Parley with Nora, Milo, Aya, and a read-only Port Daddy witness"
              className="min-w-0"
            />
          </div>

          <aside className="grid content-start gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)]" aria-label="Who is speaking in the tmux Parley">
            <div className="bg-[var(--surface-raised)] p-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <MessagesSquare size={18} className="text-[var(--brand-primary)]" />
                <PanelEyebrow>Color commentary</PanelEyebrow>
              </div>
              <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                Follow the same name, shape, and color from pane title to durable turn.
              </PanelBody>
            </div>
            {PARTICIPANTS.map((participant) => (
              <article key={participant.name} className="bg-[var(--surface-raised)] p-[var(--space-3)]" style={{ borderLeft: `0.45rem solid ${participant.color}` }}>
                <div className="flex items-center justify-between gap-[var(--space-2)]">
                  <strong className="font-sans text-[length:var(--type-panel-title-nav-size)]">
                    <span aria-hidden="true" style={{ color: participant.color }}>{participant.mark}</span>{' '}
                    {participant.name}
                  </strong>
                  <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase text-[var(--text-muted)]">
                    {participant.role}
                  </span>
                </div>
                <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                  {participant.explanation}
                </PanelBody>
              </article>
            ))}
            <article className="border-l-[0.45rem] border-l-[var(--brand-primary)] bg-[var(--surface-sunken)] p-[var(--space-3)]">
              <div className="flex items-center gap-[var(--space-2)]">
                <Eye size={18} className="text-[var(--brand-primary)]" />
                <strong className="font-sans text-[length:var(--type-panel-title-nav-size)]">Port Daddy witness</strong>
              </div>
              <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                Polls the Parley without a viewer identity, so it cannot mark a turn read. It labels
                proposal, risk, constraint, revision, and individual agreement as they become durable.
              </PanelBody>
            </article>
          </aside>
        </div>

        <div className="grid min-w-0 gap-[var(--space-4)]" data-testid="parley-pane-archive">
          <div className="grid gap-[var(--space-3)] border-l-[0.45rem] border-l-[var(--brand-primary)] bg-[var(--surface-raised)] p-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <PanelEyebrow>Independent scrollback · recorder authority</PanelEyebrow>
              <PanelTitle as="h3" size="card" className="mt-[var(--space-2)] max-w-[28ch]">
                Four panes. Four real histories. Scroll each one.
              </PanelTitle>
              <PanelBody size="compact" className="mt-[var(--space-2)] max-w-[58rem]">
                A tmux video is one outer terminal surface, so its erased inner history cannot be
                reconstructed honestly in the browser. Before teardown, the same recorder now runs
                <code> tmux capture-pane </code> against each real pane and binds the archive to the
                source cast hash. Wheel, trackpad, Page Up, and Page Down stay inside the focused pane.
                Every pane reports its own history limit and whether that limit was reached.
              </PanelBody>
            </div>
            <div className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)] lg:text-right">
              <div>{PANE_ARCHIVE.capture}</div>
              <div>sha256 {PANE_ARCHIVE.sourceCastSha256.slice(0, 12)}</div>
            </div>
          </div>
          <div className="grid min-w-0 gap-[var(--space-3)] lg:grid-cols-2">
            {PANE_ARCHIVE.panes.map((pane) => <PaneScrollback key={pane.id} pane={pane} />)}
          </div>
        </div>

        <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3">
          <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
            <TerminalSquare size={18} className="text-[var(--brand-primary)]" />
            <strong className="mt-[var(--space-2)] block font-sans text-[length:var(--type-panel-title-nav-size)]">Three real shells</strong>
            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">Different prompts, worktrees, and session anchors.</PanelBody>
          </div>
          <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
            <MessagesSquare size={18} className="text-[var(--brand-primary)]" />
            <strong className="mt-[var(--space-2)] block font-sans text-[length:var(--type-panel-title-nav-size)]">Six durable turns</strong>
            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">Proposal, two objections, revision, and two closures.</PanelBody>
          </div>
          <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
            <Eye size={18} className="text-[var(--brand-primary)]" />
            <strong className="mt-[var(--space-2)] block font-sans text-[length:var(--type-panel-title-nav-size)]">One read-only witness</strong>
            <PanelBody size="compact" className="mt-[var(--space-1)] max-w-none">Commentary follows commits without changing receipts.</PanelBody>
          </div>
        </div>
      </SurfacePanel>
    </section>
  )
}
