import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, FileCode2, ShieldCheck } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { ROUNDS, type RoundExchange } from '@/data/whitepaperRounds'
import { RoundsVisualization } from './RoundsVisualization'

const SEVERITY_TONE: Record<RoundExchange['severity'], string> = {
  high: 'text-[var(--brand-primary)]',
  medium: 'text-[var(--text-primary)]',
  low: 'text-[var(--text-muted)]',
  'scope-clarification': 'text-[var(--text-muted)]',
}

const SEVERITY_LABEL: Record<RoundExchange['severity'], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  'scope-clarification': 'Scope',
}

const STATUS_LABEL: Record<RoundExchange['fix_status'], string> = {
  staged: 'Staged',
  partial: 'Partial',
  'landed-in-paper': 'Landed in paper',
  'scope-clarified': 'Scope clarified',
  'scope-narrowed': 'Scope narrowed',
  declined: 'Declined',
}

export default function RoundsPage() {
  const newest = ROUNDS[0]
  const earlierRounds = ROUNDS.slice(1)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* HEADER + welcoming intro */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <Link
              to="/whitepaper"
              className="mb-[var(--space-5)] inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              <ArrowLeft aria-hidden="true" size={14} />
              Back to the papers
            </Link>

            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.62fr)_minmax(0,0.38fr)] lg:items-end">
              <div className="space-y-[var(--space-5)]">
                <PanelEyebrow>How the papers got better</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[14ch]">
                  What we changed our minds about, on the record.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Every month, two AI review teams take turns finding holes in these papers.
                  One team plays attacker — looking for missing proofs, hand-wavy claims, and
                  any place the paper says "obviously" without showing why. The other team plays
                  defender — answering, fixing, or honestly conceding. We keep both teams on
                  separate channels so neither can read the other&apos;s notes. The transcripts
                  are below.
                </PanelBody>
              </div>

              <aside className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <PanelEyebrow>At a glance</PanelEyebrow>
                <div className="grid gap-[var(--space-2)]">
                  {[
                    ['Rounds done', String(ROUNDS.length).padStart(2, '0')],
                    [
                      'Smells answered',
                      String(
                        ROUNDS.reduce((sum, r) => sum + r.exchanges.length, 0),
                      ).padStart(2, '0'),
                    ],
                    [
                      'Latest round sealed',
                      newest?.sealed_at ?? '—',
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-2)] first:border-t-0 first:pt-0"
                    >
                      <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {label}
                      </span>
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* HOW TO READ THIS PAGE — vocabulary panel */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <BracketLabel>How to read this</BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  Words used below.
                </PanelTitle>
              </div>
              <dl className="grid gap-[var(--space-4)] sm:grid-cols-2">
                {[
                  {
                    term: 'Round',
                    body: 'One full cycle: attackers list complaints, defenders respond, the paper is rewritten where the complaint stuck. Each round produces a numbered version (v2.3, v2.4, …).',
                  },
                  {
                    term: 'Smell',
                    body: 'Something in the paper that does not pass the smell test. A claim without proof, a missing assumption, a paragraph that hand-waves. Smells become exchanges.',
                  },
                  {
                    term: 'Severity',
                    body: '"High" means the paper would be wrong if we ignored this. "Medium" means it would be weaker. "Scope" means we are clarifying what the paper is and is not trying to do.',
                  },
                  {
                    term: 'Carried',
                    body: 'A smell we did not fully answer this round, with the reason. Honest carrying is part of the discipline — papers are not finished by pretending the open questions are closed.',
                  },
                ].map((entry) => (
                  <div
                    key={entry.term}
                    className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]"
                  >
                    <dt className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                      {entry.term}
                    </dt>
                    <dd className="mt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {entry.body}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </PageContainer>
        </section>

        {/* VISUALIZATIONS */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] grid gap-[var(--space-3)] lg:max-w-[60ch]">
              <BracketLabel>The whole story, three ways</BracketLabel>
              <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                Coverage, severity, who said what.
              </PanelTitle>
              <PanelBody>
                Three views on the same data: which sections of the paper have been
                stress-tested, how each round divided up between deep flaws and small
                clarifications, and which review personas pushed which arguments.
              </PanelBody>
            </div>
            <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
              <RoundsVisualization />
            </div>
          </PageContainer>
        </section>

        {/* NEWEST ROUND — color-blocked, full detail */}
        {newest ? (
          <section className="border-b-2 border-[var(--border-strong)] bg-[var(--brand-primary)] py-[var(--space-7)] lg:py-[var(--space-8)] text-[var(--brand-primary-foreground)]">
            <PageContainer width="wide">
              <div className="mb-[var(--space-5)] grid gap-[var(--space-3)] lg:max-w-[70ch]">
                <BracketLabel className="border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]">
                  Most recent round
                </BracketLabel>
                <PanelTitle
                  as="h2"
                  size="section"
                  className="max-w-[18ch] text-[var(--brand-primary-foreground)]"
                >
                  {newest.round_from} → {newest.round_to}
                </PanelTitle>
                <p className="text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[color:var(--brand-primary-foreground-muted)]">
                  Sealed {newest.sealed_at}. {newest.exchanges.length} smells answered,
                  {' '}
                  {newest.carried.length} carried into the next round.
                </p>
              </div>
              <RoundDetail round={newest} tone="primary" />
            </PageContainer>
          </section>
        ) : null}

        {/* EARLIER ROUNDS */}
        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-6)] grid gap-[var(--space-3)] lg:max-w-[60ch]">
              <BracketLabel>The earlier rounds</BracketLabel>
              <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                Where each version of the paper came from.
              </PanelTitle>
              <PanelBody>
                Newest at the top of the page; oldest below. The first round (the
                bootstrap) had no prior version to argue with — it converted the
                draft from a one-author monologue into a paper that knew which of
                its own claims it could defend.
              </PanelBody>
            </div>
            <div className="grid gap-[var(--space-6)]">
              {earlierRounds.map((round) => (
                <article
                  key={`${round.round_from}-${round.round_to}`}
                  className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] lg:p-[var(--space-6)]"
                >
                  <header className="mb-[var(--space-4)] flex flex-wrap items-end justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <div className="space-y-[var(--space-1)]">
                      <PanelEyebrow>
                        {round.kind === 'bootstrap' ? 'Bootstrap round' : 'Round'}
                      </PanelEyebrow>
                      <PanelTitle as="h3" size="card">
                        {round.round_from} → {round.round_to}
                      </PanelTitle>
                    </div>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      sealed {round.sealed_at} · lead {round.lead}
                    </span>
                  </header>
                  <RoundDetail round={round} tone="default" />
                </article>
              ))}
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}

function RoundDetail({
  round,
  tone,
}: {
  round: (typeof ROUNDS)[number]
  tone: 'primary' | 'default'
}) {
  const isPrimary = tone === 'primary'
  const subtleText = isPrimary
    ? 'text-[color:var(--brand-primary-foreground-muted)]'
    : 'text-[var(--text-secondary)]'
  const mutedText = isPrimary
    ? 'text-[color:var(--brand-primary-foreground-subtle)]'
    : 'text-[var(--text-muted)]'
  const cardSurface = isPrimary
    ? 'border-[color:var(--brand-primary-foreground-subtle)] bg-[color:color-mix(in_oklab,var(--brand-primary)_85%,white)] text-[var(--brand-primary-foreground)]'
    : 'border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]'
  const tagSurface = isPrimary
    ? 'bg-[color:color-mix(in_oklab,var(--brand-primary)_70%,white)] text-[var(--brand-primary-foreground)]'
    : 'bg-[var(--surface-base)] text-[var(--text-primary)]'
  const headingColor = isPrimary
    ? 'text-[var(--brand-primary-foreground)]'
    : 'text-[var(--text-primary)]'
  const bulletColor = isPrimary ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]'

  const paperChanges = round.paper_changes_v21 ?? round.paper_changes ?? []

  return (
    <div className="grid gap-[var(--space-6)]">
      {/* Stats row */}
      <div className="grid grid-cols-1 gap-0 border-2 border-[var(--border-strong)] sm:grid-cols-3">
        {[
          ['Smells answered', round.exchanges.length],
          ['Carried forward', round.carried.length],
          ['Edits to the paper', paperChanges.length],
        ].map(([label, value], i) => (
          <div
            key={String(label)}
            className={[
              'p-[var(--space-4)]',
              i > 0 ? 'border-t-2 sm:border-l-2 sm:border-t-0' : '',
              isPrimary
                ? 'border-[color:var(--brand-primary-foreground-subtle)] bg-[color:color-mix(in_oklab,var(--brand-primary)_92%,white)]'
                : 'border-[var(--border-strong)] bg-[var(--surface-base)]',
            ].join(' ')}
          >
            <div className={`font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${mutedText}`}>
              {String(label)}
            </div>
            <div className={`mt-[var(--space-1)] font-mono text-[length:var(--text-xl)] font-black leading-none ${headingColor}`}>
              {String(value).padStart(2, '0')}
            </div>
          </div>
        ))}
      </div>

      {/* Smells answered */}
      {round.exchanges.length > 0 ? (
        <div className="space-y-[var(--space-3)]">
          <h4 className={`inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${headingColor}`}>
            <ShieldCheck aria-hidden="true" size={14} className={bulletColor} />
            Smells answered this round
          </h4>
          <ul className="grid gap-[var(--space-3)]">
            {round.exchanges.map((ex) => (
              <li
                key={ex.id}
                className={`border-2 p-[var(--space-4)] ${cardSurface}`}
              >
                <div className="flex flex-wrap items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                  <span className={`px-[var(--space-2)] py-[var(--space-1)] ${tagSurface}`}>{ex.class}</span>
                  <span className={mutedText}>{ex.section}</span>
                  <span className={isPrimary ? 'text-[var(--brand-primary-foreground)]' : SEVERITY_TONE[ex.severity]}>
                    {SEVERITY_LABEL[ex.severity]}
                  </span>
                  <span className={`ml-auto px-[var(--space-2)] py-[var(--space-1)] ${tagSurface}`}>
                    {STATUS_LABEL[ex.fix_status]}
                  </span>
                </div>
                <div className={`mt-[var(--space-2)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] ${headingColor}`}>
                  {ex.title}
                </div>
                <div className={`mt-[var(--space-1)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] ${subtleText}`}>
                  raised by {ex.smell_from} · answered by {ex.fix_from}
                </div>
                {ex.artifact ? (
                  <div className={`mt-[var(--space-2)] inline-flex items-center gap-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] ${mutedText}`}>
                    <FileCode2 aria-hidden="true" size={12} />
                    {ex.artifact}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Carried */}
      {round.carried.length > 0 ? (
        <div className="space-y-[var(--space-3)]">
          <h4 className={`inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${headingColor}`}>
            <AlertTriangle aria-hidden="true" size={14} className={bulletColor} />
            Carried to next round
          </h4>
          <ul className="grid gap-[var(--space-3)]">
            {round.carried.map((c) => (
              <li
                key={c.id}
                className={`border-2 p-[var(--space-4)] ${cardSurface}`}
              >
                <div className="flex flex-wrap items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                  <span className={`px-[var(--space-2)] py-[var(--space-1)] ${tagSurface}`}>{c.class}</span>
                </div>
                <div className={`mt-[var(--space-2)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] ${headingColor}`}>
                  {c.title}
                </div>
                <div className={`mt-[var(--space-1)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] ${subtleText}`}>
                  {c.reason}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Paper changes */}
      {paperChanges.length > 0 ? (
        <div className="space-y-[var(--space-3)]">
          <h4 className={`inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${headingColor}`}>
            <FileCode2 aria-hidden="true" size={14} className={bulletColor} />
            What this round actually changed in the paper
          </h4>
          <ul className={`list-disc space-y-[var(--space-1)] pl-[var(--space-5)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] ${subtleText}`}>
            {paperChanges.map((ch, i) => (
              <li key={i}>{ch}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {round.infrastructure_added_v21 && round.infrastructure_added_v21.length > 0 ? (
        <div className="space-y-[var(--space-3)]">
          <h4 className={`inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] ${headingColor}`}>
            <ShieldCheck aria-hidden="true" size={14} className={bulletColor} />
            Code that landed alongside this round
          </h4>
          <ul className={`list-disc space-y-[var(--space-1)] pl-[var(--space-5)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] ${subtleText}`}>
            {round.infrastructure_added_v21.map((inf, i) => (
              <li key={i}>{inf}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
