import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { PageContainer, PanelEyebrow, PanelTitle, PanelBody } from '@/components/site/primitives'
import { ScopeLadder } from '@/components/library/ScopeLadder'

/**
 * The homepage's "small idea and big idea at once" beat. Port Daddy is a
 * harbor-master for your agents: it governs a widening scope — your repo, your
 * computer, the network, and soon an agentic economy. This is ADR-0048's stack
 * told as scope, up top, before the feature tour.
 */
export function ScopeLadderSection() {
  return (
    <section className="border-y-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer>
        <div className="grid gap-[var(--space-5)]">
          <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] lg:items-end">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow>One tool, a widening scope</PanelEyebrow>
              <PanelTitle as="h2" size="display" className="max-w-[15ch]">
                A harbor-master for your agents.
              </PanelTitle>
            </div>
            <PanelBody className="max-w-[58ch] text-[length:var(--text-lg)]">
              It starts the moment two agents reach for the same file in one repo,
              and it grows from there — to the whole machine, across the network
              to fleets you don&rsquo;t own, and toward a market for agent labor.
              The small idea and the big idea are the same idea, at four scales.
            </PanelBody>
          </div>

          <ScopeLadder />

          <div>
            <Link
              to="/library"
              className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              See the whole argument — the Harbor Library
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </PageContainer>
    </section>
  )
}
