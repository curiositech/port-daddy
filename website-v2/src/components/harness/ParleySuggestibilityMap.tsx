import { Eye, EyeOff, MessagesSquare, ShieldCheck, Sparkles } from 'lucide-react'
import parleyEvidence from '@/data/evidence/parley-979f6940.json'
import {
  BracketLabel,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
} from '@/components/site/primitives'

type ParticipantShape = 'square' | 'circle' | 'diamond'

type Participant = {
  id: string
  label: string
  shortLabel: string
  role: string
  shape: ParticipantShape
  color: string
}

type ParleyTurn = {
  sequence: number
  party: string
  performative: 'propose' | 'revise' | 'inform' | 'agree' | 'critique'
  displayAction: string
  summary: string
  content: string
  at: number
}

type ParleyReceipt = {
  party: string
  lastSeenAt: number
  unseenTurns: number
}

type ParleyEvidence = {
  parleyId: string
  sourceEndpoint: string
  sourceResponseSha256: string
  surface: string
  reason: string
  status: 'CONVENED'
  outcome: null
  sourceTurnCount: number
  displayedTurnCount: number
  withheldTurnCount: number
  commonReadThrough: number
  honestyNote: string
  participants: Participant[]
  turns: ParleyTurn[]
  receipts: ParleyReceipt[]
}

const proof = parleyEvidence as ParleyEvidence

const TURN_LANE_CLASS = [
  'lg:col-start-2',
  'lg:col-start-3',
  'lg:col-start-4',
] as const

const ACTION_TONE: Record<ParleyTurn['performative'], string> = {
  propose: 'border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-primary)]',
  revise: 'border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-primary)]',
  inform: 'border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-primary)]',
  agree: 'border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-primary)]',
  critique: 'border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--text-primary)]',
}

const DERIVED_INDEX = [
  { label: 'Proposal', turns: 'T01' },
  { label: 'Suggestions + pressure', turns: 'T02 · T03 · T07' },
  { label: 'Revisions', turns: 'T04 · T06' },
  { label: 'Individual agreements (not settlement)', turns: 'T05 · T08' },
] as const

function ParticipantGlyph({ participant }: { participant: Participant }) {
  const shapeClass =
    participant.shape === 'circle'
      ? 'rounded-full'
      : participant.shape === 'diamond'
        ? 'rotate-45'
        : ''

  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 w-4 shrink-0 border-2 border-current ${shapeClass}`}
      style={{ backgroundColor: participant.color, color: participant.color }}
    />
  )
}

function participantFor(id: string): Participant | undefined {
  return proof.participants.find((candidate) => candidate.id === id)
}

/**
 * Render one frozen, receipt-bounded three-party Parley as an evidence board.
 * The design intent is to make suggestibility legible as attributed influence:
 * every proposal, correction, revision, and agreement stays attached to the
 * person who supplied it, while unread turns remain outside the projection.
 *
 * @returns An accessible chronological swimlane and its honest read frontier.
 */
export function ParleySuggestibilityMap() {
  const turns = [...proof.turns].sort((a, b) => a.sequence - b.sequence)
  const unknownParty = [...turns.map((turn) => turn.party), ...proof.receipts.map((receipt) => receipt.party)]
    .find((party) => !participantFor(party))

  if (unknownParty) {
    return (
      <section aria-labelledby="parley-suggestibility-title" id="parley-suggestibility">
        <SurfacePanel elevation="raised" padding="default">
          <div
            role="alert"
            className="border-2 border-[var(--status-error)] bg-[color-mix(in_srgb,var(--status-error)_10%,var(--surface-raised))] p-[var(--space-4)] text-[var(--status-error)]"
          >
            <PanelEyebrow>Evidence refused</PanelEyebrow>
            <PanelTitle as="h2" size="card" className="mt-[var(--space-2)]" id="parley-suggestibility-title">
              This Parley record names an unknown participant.
            </PanelTitle>
            <PanelBody size="compact" className="mt-[var(--space-2)] max-w-[52rem] text-inherit">
              The projection stopped before rendering turns or receipts. Repair and re-verify the
              participant record for <code>{unknownParty}</code>; Porthole will not invent an identity.
            </PanelBody>
          </div>
        </SurfacePanel>
      </section>
    )
  }

  return (
    <section aria-labelledby="parley-suggestibility-title" id="parley-suggestibility">
      <SurfacePanel elevation="raised" padding="default" className="grid min-w-0 gap-[var(--space-6)] overflow-hidden [&>*]:min-w-0">
        <div className="grid min-w-0 items-end gap-[var(--space-5)] lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-[var(--space-3)]">
            <BracketLabel>Three-member Parley · durable evidence</BracketLabel>
            <PanelTitle as="h2" size="display" className="max-w-[19ch]" id="parley-suggestibility-title">
              Suggestible does not mean obedient.
            </PanelTitle>
            <PanelBody className="max-w-[52rem]">
              Good suggestibility is bounded influence. One agent proposes a plan;
              the others can amend it, challenge its proof, and record exactly what
              changed. Nobody disappears into a group answer, and agreement is not
              promoted into a settlement that the receipt does not show.
            </PanelBody>
          </div>

          <div className="grid grid-cols-1 gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] min-[360px]:grid-cols-2">
            <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
              <PanelEyebrow>State</PanelEyebrow>
              <strong className="mt-[var(--space-1)] block font-mono text-[length:var(--type-panel-title-nav-size)] text-[var(--status-warning)]">
                {proof.status}
              </strong>
              <span className="mt-1 block font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">still open</span>
            </div>
            <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
              <PanelEyebrow>Settlement</PanelEyebrow>
              <strong className="mt-[var(--space-1)] block font-mono text-[length:var(--type-panel-title-nav-size)] text-[var(--status-error)]">
                none
              </strong>
              <span className="mt-1 block font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">recorded</span>
            </div>
            <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
              <PanelEyebrow>Parties</PanelEyebrow>
              <strong className="mt-[var(--space-1)] block font-mono text-[length:var(--type-panel-title-nav-size)]">
                {proof.participants.length}
              </strong>
            </div>
            <div className="bg-[var(--surface-sunken)] p-[var(--space-3)]">
              <PanelEyebrow>Turns</PanelEyebrow>
              <strong className="mt-[var(--space-1)] block font-mono text-[length:var(--type-panel-title-nav-size)]">
                {proof.displayedTurnCount} shared
              </strong>
              <span className="mt-1 block font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">{proof.withheldTurnCount} withheld</span>
            </div>
          </div>
        </div>

        <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2 lg:grid-cols-4" aria-label="How this Parley changed the proposal">
          {DERIVED_INDEX.map((item, index) => (
            <div key={item.label} className="bg-[var(--surface-raised)] p-[var(--space-3)]">
              <span className="font-mono text-[length:var(--type-meta-size)] font-black text-[var(--brand-primary)]">
                0{index + 1}
              </span>
              <strong className="mt-[var(--space-2)] block font-sans text-[length:var(--type-panel-title-nav-size)]">
                {item.label}
              </strong>
              <span className="mt-[var(--space-1)] block font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                {item.turns}
              </span>
            </div>
          ))}
        </div>

        <div className="space-y-[var(--space-3)]">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <MessagesSquare size={18} className="text-[var(--brand-primary)]" />
              <PanelEyebrow>Read top to bottom · empty lanes are listening</PanelEyebrow>
            </div>
            <PanelBody size="compact" className="max-w-[34rem]">
              Border color, shape, and name identify the speaker. On wide screens, lane adds a fourth cue.
            </PanelBody>
          </div>

          <div className="hidden gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] lg:grid lg:grid-cols-[3rem_repeat(3,minmax(0,1fr))]">
            <div className="bg-[var(--surface-sunken)]" aria-hidden="true" />
            {proof.participants.map((participant) => (
              <div
                key={participant.id}
                className="min-w-0 bg-[var(--surface-sunken)] p-[var(--space-3)]"
                style={{ borderTop: `0.4rem solid ${participant.color}` }}
              >
                <div className="flex items-center gap-[var(--space-2)]">
                  <ParticipantGlyph participant={participant} />
                  <strong className="font-sans text-[length:var(--type-panel-title-nav-size)]">
                    {participant.label}
                  </strong>
                </div>
                <span className="mt-[var(--space-1)] block text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                  {participant.role}
                </span>
              </div>
            ))}
          </div>

          <ol className="grid gap-[var(--space-2)]" aria-label="Chronological shared-read Parley turns">
            {turns.map((turn) => {
              const participant = participantFor(turn.party)!
              const participantIndex = proof.participants.findIndex((candidate) => candidate.id === participant.id)
              return (
                <li
                  key={turn.sequence}
                  className="grid w-full max-w-none gap-[var(--space-2)] lg:grid-cols-[3rem_repeat(3,minmax(0,1fr))]"
                  style={{ maxWidth: 'none' }}
                >
                  <span className="hidden self-start pt-[var(--space-3)] font-mono text-[length:var(--type-meta-size)] font-black text-[var(--text-muted)] lg:block">
                    T{String(turn.sequence).padStart(2, '0')}
                  </span>
                  <article
                    className={`min-w-0 border-2 border-[var(--border-strong)] border-l-[0.45rem] bg-[var(--surface-raised)] p-[var(--space-3)] ${TURN_LANE_CLASS[participantIndex]}`}
                    style={{ borderLeftColor: participant.color }}
                  >
                    <div className="flex flex-col items-start gap-[var(--space-2)] min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                      <div className="flex w-full min-w-0 items-center gap-[var(--space-2)] min-[360px]:w-auto">
                        <ParticipantGlyph participant={participant} />
                        <strong className="min-w-0 break-words font-sans text-[length:var(--type-panel-title-nav-size)] min-[360px]:truncate">
                          <span className="lg:hidden">T{String(turn.sequence).padStart(2, '0')} · </span>
                          {participant.shortLabel}
                        </strong>
                      </div>
                      <span className={`w-full max-w-full whitespace-normal px-[var(--space-2)] py-1 text-left font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] min-[360px]:w-auto ${ACTION_TONE[turn.performative]}`}>
                        {turn.displayAction}
                      </span>
                    </div>
                    <p className="mt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] font-semibold leading-[var(--leading-body-compact)] text-[var(--text-primary)]">
                      {turn.summary}
                    </p>
                    <details className="mt-[var(--space-3)] border-t border-[var(--border-default)] pt-[var(--space-2)]">
                      <summary className="cursor-pointer font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                        Inspect exact source turn
                      </summary>
                      <p className="mt-[var(--space-2)] whitespace-pre-wrap break-words font-mono text-[length:var(--type-meta-size)] leading-[1.6] text-[var(--text-secondary)]">
                        {turn.content}
                      </p>
                      <div className="mt-[var(--space-2)] grid gap-1 font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                        <span>raw act: {turn.performative}</span>
                        <span>party: {participant.id}</span>
                        <time dateTime={new Date(turn.at).toISOString()}>{new Date(turn.at).toISOString()}</time>
                      </div>
                    </details>
                  </article>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <div className="border-2 border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_10%,var(--surface-raised))] p-[var(--space-4)]">
            <div className="flex items-center gap-[var(--space-2)]">
              <EyeOff size={18} className="text-[var(--status-warning)]" />
              <PanelEyebrow>Privacy and read-frontier boundary</PanelEyebrow>
            </div>
            <PanelTitle as="h3" size="card" className="mt-[var(--space-2)] max-w-[24ch]">
              Two later turns are deliberately not on this page.
            </PanelTitle>
            <PanelBody size="compact" className="mt-[var(--space-2)] max-w-[50rem]">
              {proof.honestyNote} The board is durable Parley evidence, not a staged
              terminal performance and not the still-unmerged Sugar experience.
            </PanelBody>
          </div>

          <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)]">
            {proof.receipts.map((receipt) => {
              const participant = participantFor(receipt.party)!
              const caughtUp = receipt.unseenTurns === 0
              return (
                <div key={receipt.party} className="flex flex-col items-start gap-[var(--space-2)] bg-[var(--surface-sunken)] p-[var(--space-3)] min-[360px]:flex-row min-[360px]:items-center min-[360px]:justify-between">
                  <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-panel-body-compact-size)] font-black">
                    <ParticipantGlyph participant={participant} />
                    {participant.shortLabel}
                  </span>
                  <span className={`inline-flex items-center gap-1 font-mono text-[length:var(--type-meta-size)] font-black uppercase ${caughtUp ? 'text-[var(--status-success)]' : 'text-[var(--status-warning)]'}`}>
                    {caughtUp ? <Eye size={14} /> : <EyeOff size={14} />}
                    {caughtUp ? 'caught up' : `${receipt.unseenTurns} unseen`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-start justify-between gap-[var(--space-3)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
          <div className="flex min-w-0 max-w-[48rem] items-start gap-[var(--space-2)]">
            <ShieldCheck size={18} className="mt-1 shrink-0 text-[var(--brand-primary)]" />
            <PanelBody size="compact" className="min-w-0 max-w-none break-words">
              Source:{' '}
              <code style={{ display: 'inline', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                {proof.sourceEndpoint}
              </code>
              . Frozen response hash{' '}
              <code style={{ display: 'inline', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                {proof.sourceResponseSha256}
              </code>
              . The page never calls the live daemon.
            </PanelBody>
          </div>
          <span className="inline-flex items-center gap-[var(--space-2)] font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
            <Sparkles size={15} /> influence with provenance
          </span>
        </div>
      </SurfacePanel>
    </section>
  )
}
