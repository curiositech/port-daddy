import { Link } from 'react-router-dom'
import { ArrowRight, FileText, FlaskConical } from 'lucide-react'
import { PageContainer } from '@/components/site/primitives'
import { RESEARCH_PAPER_TOTAL_PAGES } from '@/data/researchPapers'
import { COLLECTED_VOLUME } from '@/data/whitePapers'

/**
 * A thin, page-width strip — below the sticky nav, above the hero — that
 * exists for one reason: `/library` and `/library/research` are two
 * distinct seven-part collections that both used to get called "seven
 * papers" (see the 2026-08-26 `/library` naming-collision fix). Same
 * problem shows up a level up, on the home page, where neither collection
 * had ever been named at all. These two labels are the fix: "the Book"
 * (seven chapters, one argument, in dependency order) and the "standalone
 * papers" (the same results in submission form) — never "papers" for both,
 * and never "the Proofs" for the research papers, since three of the Book's
 * own chapters are the ones that prove.
 *
 * Intentionally NOT a <section>: this is chrome-weight signage, not page
 * content, so it carries no PanelEyebrow/PanelTitle and stays out of the
 * heading outline. Kept to one compact row (two on narrow screens) — see
 * App.tsx's IA-order note on why the home page resists adding scroll.
 */
export function LibraryBanner() {
  return (
    <div className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <PageContainer width="wide">
        <div className="grid gap-x-[var(--space-5)] gap-y-[var(--space-2)] py-[var(--space-3)] sm:grid-cols-2 sm:items-center sm:py-[var(--space-2)]">
          <Link
            to="/library"
            className="group flex items-center gap-[var(--space-3)] border-r-0 sm:border-r-2 sm:border-[var(--border-default)] sm:pr-[var(--space-5)]"
          >
            <FileText
              aria-hidden="true"
              size={18}
              className="shrink-0 text-[var(--brand-primary)]"
            />
            <span className="min-w-0 font-sans text-[length:var(--type-meta-size)] leading-tight text-[var(--text-secondary)]">
              <span className="font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] group-hover:text-[var(--brand-primary)]">
                The Book
              </span>{' '}
              — 7 chapters, {COLLECTED_VOLUME.pages}pp, the whole argument in order
            </span>
            <ArrowRight
              aria-hidden="true"
              size={14}
              className="ml-auto hidden shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--brand-primary)] sm:block"
            />
          </Link>

          <Link to="/library/research" className="group flex items-center gap-[var(--space-3)]">
            <FlaskConical
              aria-hidden="true"
              size={18}
              className="shrink-0 text-[var(--story-indigo)]"
            />
            <span className="min-w-0 font-sans text-[length:var(--type-meta-size)] leading-tight text-[var(--text-secondary)]">
              <span className="font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] group-hover:text-[var(--story-indigo)]">
                Standalone papers
              </span>{' '}
              — 7 submission-form papers, {RESEARCH_PAPER_TOTAL_PAGES}pp, the same results in conference form
            </span>
            <ArrowRight
              aria-hidden="true"
              size={14}
              className="ml-auto hidden shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--story-indigo)] sm:block"
            />
          </Link>
        </div>
      </PageContainer>
    </div>
  )
}
