import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, AlertTriangle, FileCode2, GitBranch } from 'lucide-react'
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
  medium: 'text-[var(--text-strong)]',
  low: 'text-[var(--text-muted)]',
  'scope-clarification': 'text-[var(--text-muted)]',
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
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="bg-[var(--surface-base)] text-[var(--text-strong)]"
    >
      <PageContainer>
        <div className="mb-10 flex items-center gap-3 text-sm">
          <Link
            to="/whitepaper"
            className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-strong)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to whitepapers
          </Link>
        </div>

        <BracketLabel>Adversarial Rounds</BracketLabel>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
          What changed, and why we're sure
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-[var(--text-muted)]">
          The Bonded Commons and Anchor Protocol whitepapers are reviewed in
          monthly versioned rounds by a red-team fleet and a white-hat fleet,
          kept in strict information isolation by an envelope-encryption layer
          we proved correct in ProVerif. Each round produces an artifact you
          can audit. Most recent first.
        </p>

        <div className="mt-12 mb-16">
          <RoundsVisualization />
        </div>

        <h2 className="mt-12 mb-2 text-2xl font-semibold">Round-by-round detail</h2>

        <div className="mt-6 space-y-12">
          {ROUNDS.map((round) => (
            <section
              key={`${round.round_from}-${round.round_to}`}
              className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-8 shadow-[var(--shadow-card)]"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <PanelEyebrow>
                    {round.kind === 'bootstrap' ? 'Bootstrap round' : 'Round'}
                  </PanelEyebrow>
                  <PanelTitle>
                    {round.round_from} → {round.round_to}
                  </PanelTitle>
                </div>
                <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                  <GitBranch className="h-4 w-4" />
                  <span>sealed {round.sealed_at}</span>
                  <span>•</span>
                  <span>lead: {round.lead}</span>
                </div>
              </div>

              <PanelBody className="mt-6 grid gap-6 md:grid-cols-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    Exchanges
                  </div>
                  <div className="mt-1 text-3xl font-semibold">
                    {round.exchanges.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    Carried
                  </div>
                  <div className="mt-1 text-3xl font-semibold">
                    {round.carried.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-[var(--text-muted)]">
                    Paper changes
                  </div>
                  <div className="mt-1 text-3xl font-semibold">
                    {(round.paper_changes_v21 ?? round.paper_changes ?? []).length}
                  </div>
                </div>
              </PanelBody>

              <div className="mt-8">
                <h3 className="mb-4 inline-flex items-center gap-2 text-base font-semibold">
                  <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" />
                  Smells answered this round
                </h3>
                <ul className="space-y-3">
                  {round.exchanges.map((ex) => (
                    <li
                      key={ex.id}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">
                        <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5">
                          {ex.class}
                        </span>
                        <span>{ex.section}</span>
                        <span className={`font-semibold ${SEVERITY_TONE[ex.severity]}`}>
                          {ex.severity}
                        </span>
                        <span className="ml-auto rounded bg-[var(--surface-raised)] px-2 py-0.5">
                          {STATUS_LABEL[ex.fix_status]}
                        </span>
                      </div>
                      <div className="mt-2 font-medium">{ex.title}</div>
                      <div className="mt-1 text-sm text-[var(--text-muted)]">
                        smell: {ex.smell_from} → fix: {ex.fix_from}
                      </div>
                      {ex.artifact && (
                        <div className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                          <FileCode2 className="h-3 w-3" /> {ex.artifact}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {round.carried.length > 0 && (
                <div className="mt-8">
                  <h3 className="mb-4 inline-flex items-center gap-2 text-base font-semibold">
                    <AlertTriangle className="h-4 w-4 text-[var(--text-muted)]" />
                    Carried to next round
                  </h3>
                  <ul className="space-y-3">
                    {round.carried.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wider text-[var(--text-muted)]">
                          <span className="rounded bg-[var(--surface-raised)] px-2 py-0.5">
                            {c.class}
                          </span>
                        </div>
                        <div className="mt-2 font-medium">{c.title}</div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">
                          {c.reason}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(round.paper_changes_v21 ?? round.paper_changes ?? []).length > 0 && (
                <div className="mt-8">
                  <h3 className="mb-4 inline-flex items-center gap-2 text-base font-semibold">
                    <FileCode2 className="h-4 w-4 text-[var(--brand-primary)]" />
                    What this round actually changed in the paper
                  </h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-[var(--text-muted)]">
                    {(round.paper_changes_v21 ?? round.paper_changes ?? []).map(
                      (ch, i) => (
                        <li key={i}>{ch}</li>
                      ),
                    )}
                  </ul>
                </div>
              )}

              {round.infrastructure_added_v21 && round.infrastructure_added_v21.length > 0 && (
                <div className="mt-8">
                  <h3 className="mb-4 inline-flex items-center gap-2 text-base font-semibold">
                    <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" />
                    Infrastructure landed alongside this round
                  </h3>
                  <ul className="list-inside list-disc space-y-1 text-sm text-[var(--text-muted)]">
                    {round.infrastructure_added_v21.map((inf, i) => (
                      <li key={i}>{inf}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          ))}
        </div>
      </PageContainer>

      <Footer />
    </motion.div>
  )
}
