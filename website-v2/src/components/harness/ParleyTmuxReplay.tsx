import { Eye, MessagesSquare, ShieldCheck, TerminalSquare } from 'lucide-react'
import { PortholeEmbed } from '@/components/porthole/PortholeEmbed'
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
            <BracketLabel>Live protocol source · four-pane tmux</BracketLabel>
            <PanelTitle as="h2" size="display" className="max-w-[18ch]" id="parley-tmux-title">
              The Parley, as it actually happened.
            </PanelTitle>
            <PanelBody className="max-w-[54rem]">
              Nora, Milo, and Aya occupy different linked worktrees, shells, and Port Daddy sessions.
              The fourth pane is a read-only witness: it follows the durable record and explains what
              each public move changed at the moment it commits.
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
