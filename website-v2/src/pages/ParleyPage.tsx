import * as React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Flag, Users } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { ThemedImage } from '@/components/site/ThemedImage'
import { useTheme } from '@/lib/theme-context'
import { ParleyFlow } from '@/components/viz/ParleyFlow'
import {
  parleyNodes,
  parleyHue,
  type ParleyRole,
  type ParleyNodeDatum,
} from '@/data/parleyData'

// ── small media-query hook: interactive graph on md+, card stack below ───────
function useIsWide(query = '(min-width: 768px)') {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true
  const [wide, setWide] = React.useState(get)
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const on = () => setWide(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [query])
  return wide
}

// The four parley acts, grouped so proximity + captions carry the narrative
// even for a reader who never touches the graph.
interface ParleyAct {
  numeral: string
  label: string
  caption: string
  roles: ParleyRole[]
}

const ACTS: ParleyAct[] = [
  {
    numeral: 'I',
    label: 'The opening',
    caption:
      'One agent brings a position: Slack federates into the accounts, harbors, and relay that already exist — no new tenancy invented. It ships locally today and goes multi-tenant on the very same crypto the email path is already waiting on.',
    roles: ['opening'],
  },
  {
    numeral: 'II',
    label: 'The two peers',
    caption:
      'Two agents already at work answer back. One owns the ADR numbering — and it’s mid-renumber, closing twelve collisions the opening never checked for. The other owns the continuation contract — and it just added a third mode the opening’s plan didn’t know existed.',
    roles: ['peer1', 'peer2'],
  },
  {
    numeral: 'III',
    label: 'The concessions',
    caption:
      'The load-bearing move of a parley: concede where the other holds the boundary. The number goes provisional, deferred to the collision guard. The plan adopts the third continuation mode. No fight — the peers were simply right, and being corrected is cheaper than being wrong in production.',
    roles: ['concession1', 'concession2'],
  },
  {
    numeral: 'IV',
    label: 'The outcome',
    caption:
      'Two artifacts update. Zero contested points. The disagreement never needed a lock or a merge queue — it needed a flag of truce and two agents willing to be corrected.',
    roles: ['outcome'],
  },
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
      {children}
    </span>
  )
}

// ── mobile-safe vertical card (mirrors the cut-paper graph node) ─────────────
function StackCard({ datum, theme }: { datum: ParleyNodeDatum; theme: 'light' | 'dark' }) {
  const hue = parleyHue(datum, theme)
  const Icon = datum.icon
  const isPeer = datum.id === 'peer1' || datum.id === 'peer2'
  const iconOnTab = theme === 'dark' ? '#101216' : '#fbf7ef'

  return (
    <div
      className="relative w-full"
      style={{
        background: isPeer ? 'var(--surface-sunken)' : 'var(--surface-raised)',
        border: '2px solid var(--border-strong)',
        boxShadow: `inset 4px 0 0 ${hue}`,
        padding: 'var(--space-6) var(--space-5) var(--space-5)',
      }}
    >
      <div
        className="absolute -top-[2px] left-[-2px] flex items-center gap-[var(--space-1)]"
        style={{ background: hue, color: iconOnTab, padding: '5px 9px' }}
        aria-hidden="true"
      >
        <Icon size={15} strokeWidth={2.4} />
        {isPeer && <Users size={13} strokeWidth={2.4} />}
      </div>
      <div
        className="font-mono font-bold uppercase"
        style={{ fontSize: '0.75rem', letterSpacing: '0.1em', color: 'var(--text-secondary)' }}
      >
        {datum.roleLabel}
      </div>
      <h3
        className="font-display"
        style={{
          marginTop: 'var(--space-1)',
          fontSize: '1.125rem',
          fontWeight: 800,
          lineHeight: 1.2,
          color: 'var(--text-primary)',
        }}
      >
        {datum.title}
      </h3>
      <p
        style={{
          marginTop: 'var(--space-2)',
          fontSize: '0.9375rem',
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
        }}
      >
        {datum.position}
      </p>
      <div
        className="mt-[var(--space-3)] inline-flex items-center gap-[var(--space-2)] font-mono font-bold uppercase"
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.08em',
          color: 'var(--text-primary)',
          border: `1px solid ${hue}`,
          padding: '3px 9px',
        }}
      >
        <span aria-hidden="true" style={{ width: 8, height: 8, background: hue, display: 'inline-block' }} />
        {datum.verdict}
      </div>
    </div>
  )
}

function ParleyStack({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className="flex flex-col">
      {ACTS.map((act, ai) => (
        <div key={act.numeral} className="flex flex-col">
          <div className="flex items-center gap-[var(--space-3)] pb-[var(--space-3)] pt-[var(--space-5)]">
            <span className="font-mono text-[length:var(--text-lg)] font-black text-[var(--text-primary)]">
              {act.numeral}
            </span>
            <span className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {act.label}
            </span>
          </div>
          {act.roles.map((role, ri) => {
            const datum = parleyNodes.find((n) => n.id === role)!
            const last = ai === ACTS.length - 1 && ri === act.roles.length - 1
            return (
              <div key={role} className="flex flex-col items-stretch">
                <StackCard datum={datum} theme={theme} />
                {!last && (
                  <div className="mx-auto h-[var(--space-6)] w-[2px] bg-[var(--border-strong)]" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function ParleyPage() {
  const { theme } = useTheme()
  const mode: 'light' | 'dark' = theme === 'dark' ? 'dark' : 'light'
  const isWide = useIsWide()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex min-h-screen flex-col bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <header className="relative overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <div className="mx-auto w-full max-w-[1180px] px-[var(--space-5)] pb-[var(--space-8)] pt-[var(--space-8)] lg:px-[var(--space-6)]">
          <Eyebrow>
            <Flag size={14} className="text-[var(--brand-accent)]" aria-hidden="true" />
            Parley · a real one
          </Eyebrow>

          <motion.h1
            className="mt-[var(--space-5)] max-w-[16ch] font-display text-[length:var(--fs-hero,clamp(2.75rem,5.6vw,4.875rem))] font-black leading-[0.96] tracking-[-0.03em] text-[var(--text-primary)]"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Two ships that could fire — run up a flag instead.
          </motion.h1>

          <figure className="mt-[var(--space-7)] themed-img border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <ThemedImage
              src="/img/generated/parley/parley-hero-light.png"
              alt="Cut-paper diorama: a cobalt-hulled paper ship and a teal-hulled paper ship meet prow-to-prow at a small paper harbor, exchanging paper signal flags and thin curling ribbons between their masts. A single folded accord card sits on a cream paper table on the quay between them, framed by two stone jetties."
              className="block w-full"
              loading="eager"
            />
          </figure>

          <div className="mt-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-2">
            <p className="text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
              Two agents can wreck each other’s work in the time it takes to blink. One overwrites the file the
              other was holding; one force-pushes over a branch; one ships an ADR numbered 0119 while, three
              sessions over, a second agent is quietly renumbering the whole corpus to close a collision the first
              never saw. On 2026-06-03 a fleet like this deleted 403 files by working the same checkout at once. The
              usual fixes are locks and merge queues — plumbing that says <em>wait your turn</em> — and they hold,
              right up until the disagreement isn’t about <em>when</em> but about <em>what’s true</em>.
            </p>
            <p className="text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
              A parley is the other thing. It borrows its name from the sea: two ships that could fire on each other
              instead run up a flag, draw alongside, and talk — under a rule everyone agreed to before the first
              word. Here the rule is a <strong className="text-[var(--text-primary)]">formation break</strong>. Agents
              run in waves; between two waves, when the whole formation has reported in and before the next launches,
              there is exactly one moment where the plan can meet reality without anyone caught mid-swing. That moment
              is the parley — not an interruption but a <em>scheduled operation</em>. (Klein called it
              recognition-primed decision-making; the military just called it a formation break.)
            </p>
          </div>
          <p className="mt-[var(--space-5)] max-w-[80ch] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
            What follows is a real one. Not a demo — the actual reconciliation of a design (ADR-0119, the Slack
            bridge) against two peers who each owned a boundary the design had wandered into. Nobody got steamrolled.
            Two things got conceded — cleanly, because the other agent was right — and two artifacts changed.
            <strong className="text-[var(--text-primary)]"> Watch it run.</strong>
          </p>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-[1180px] flex-1 px-[var(--space-5)] py-[var(--space-8)] lg:px-[var(--space-6)]">
        {/* ── THE GRAPH (figure) ─────────────────────────────────────────── */}
        <section aria-labelledby="graph-heading" className="flex flex-col">
          <Eyebrow>The parley, drawn</Eyebrow>
          <h2
            id="graph-heading"
            className="mt-[var(--space-3)] font-display text-[length:var(--fs-h2,clamp(1.75rem,3vw,2.5rem))] font-black leading-[1.05] tracking-[-0.02em] text-[var(--text-primary)]"
          >
            ADR-0119, reconciled in six moves
          </h2>
          <p className="mt-[var(--space-2)] max-w-[70ch] text-[length:var(--text-base)] leading-relaxed text-[var(--text-muted)]">
            Read top to bottom: one opening, two peers who each hold a boundary, two clean concessions, one
            reconciled outcome. {isWide ? 'Hover any move to trace its thread down to the outcome; drag to pan, use the controls to zoom or fit.' : 'Scroll the stack — every move, in order, with the same content as the desktop graph.'}
          </p>

          <div className="mt-[var(--space-6)]">
            {isWide ? (
              <div
                className="relative h-[min(78vh,760px)] w-full overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]"
                style={{ boxShadow: 'inset 0 0 0 1px var(--hair, rgba(18,18,18,0.14))' }}
              >
                <ParleyFlow />
              </div>
            ) : (
              <ParleyStack theme={mode} />
            )}
          </div>
        </section>

        {/* ── ACT CAPTIONS / PROSE NARRATIVE ─────────────────────────────── */}
        <section aria-labelledby="acts-heading" className="mt-[var(--space-9)]">
          <Eyebrow>The four acts</Eyebrow>
          <h2
            id="acts-heading"
            className="mt-[var(--space-3)] font-display text-[length:var(--fs-h2,clamp(1.75rem,3vw,2.5rem))] font-black leading-[1.05] tracking-[-0.02em] text-[var(--text-primary)]"
          >
            The same story, in prose
          </h2>

          <div className="mt-[var(--space-6)] grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] md:grid-cols-2">
            {ACTS.map((act) => {
              const hue = parleyHue(parleyNodes.find((n) => n.id === act.roles[0])!, mode)
              return (
                <article
                  key={act.numeral}
                  className="flex flex-col gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-6)]"
                  style={{ boxShadow: `inset 4px 0 0 ${hue}` }}
                >
                  <div className="flex items-baseline gap-[var(--space-3)]">
                    <span className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--text-primary)]">
                      {act.numeral}
                    </span>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      Act {act.numeral} · {act.label}
                    </span>
                  </div>
                  <p className="text-[length:var(--text-base)] leading-relaxed text-[var(--text-secondary)]">
                    {act.caption}
                  </p>
                </article>
              )
            })}
          </div>
        </section>

        {/* ── CLOSING HONEST NOTE ────────────────────────────────────────── */}
        <section aria-labelledby="honest-heading" className="mt-[var(--space-9)]">
          <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-7)]">
            <Eyebrow>What’s still unsettled</Eyebrow>
            <h2
              id="honest-heading"
              className="mt-[var(--space-3)] max-w-[24ch] font-display text-[length:var(--text-2xl)] font-black leading-[1.1] text-[var(--text-primary)]"
            >
              Said plainly, so nobody mistakes it for done
            </h2>
            <p className="mt-[var(--space-4)] max-w-[76ch] text-[length:var(--text-lg)] leading-relaxed text-[var(--text-secondary)]">
              The managed multi-tenant tier is blocked on crypto that doesn’t exist yet, and this ADR’s number
              isn’t real until the guard says so. A parley doesn’t pretend those are done. It just makes sure the two
              agents agree on exactly where they stand — which, it turns out, is most of what coordination ever was.
            </p>

            <div className="mt-[var(--space-6)] flex flex-wrap items-center gap-[var(--space-4)]">
              <Link
                to="/docs/decisions"
                className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--text-base)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--surface-base)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                Read ADR-0119
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link
                to="/manifesto"
                className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--text-base)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                Why coordination is the whole game
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}

export default ParleyPage
