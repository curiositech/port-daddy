import { Link } from 'react-router-dom'
import { PageContainer } from '@/components/site/primitives'
import { RESEARCH_PAPER_TOTAL_PAGES } from '@/data/researchPapers'
import { COLLECTED_VOLUME, TEXTBOOK } from '@/data/whitePapers'

/**
 * A thin strip below the nav naming the two collections.
 *
 * It exists because `/whitepaper` and `/research` are different things that
 * both used to get called "seven papers": one is the Book, one argument in
 * eight chapters; the other is the same results written up separately for
 * referees. Naming them is the whole job.
 *
 * It is signage, not content: no <section>, no heading, nothing in the
 * outline. Two things had gone wrong with it. It was showing the watercolour
 * jacket, which the Book stopped having when the Swiss edition became the
 * central one — the cover here is now page 1 of the committed PDF, rendered
 * by scripts/render-book-cover.mjs, so it cannot advertise a jacket that no
 * longer exists. And it had grown to roughly 170px of a screen the home page
 * cannot spare: the cover is a thumbnail now, the row is one line, and the
 * strip is about the height of the nav above it.
 */
export function LibraryBanner() {
  return (
    <div className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <PageContainer width="wide">
        <div className="flex items-center gap-4 py-2">
          <img
            src="/whitepaper/plates/book-cover.jpg"
            width={770}
            height={1100}
            loading="lazy"
            decoding="async"
            alt="The cover of The Harbor, the Person, and the Economy: a container terminal in halftone under a blue and red modular grid."
            className="block h-[52px] w-auto shrink-0 border border-[var(--border-strong)]"
          />
          <div className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:grid-cols-2 sm:items-center">
            {/* A square of the collection's own ink instead of an outlined
                icon: the mark that tells the two apart is colour, and a flat
                square is the site's own device for that. */}
            <Link to="/whitepaper" className="group flex min-w-0 items-baseline gap-3 no-underline">
              <span
                aria-hidden="true"
                className="mt-[2px] h-[9px] w-[9px] shrink-0 self-center"
                style={{ background: 'var(--brand-primary)' }}
              />
              <span className="min-w-0 font-sans text-[length:var(--type-meta-size)] leading-snug text-[var(--text-secondary)]">
                <span className="font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] group-hover:text-[var(--brand-primary)]">
                  The Book
                </span>{' '}
                — one argument, {TEXTBOOK.chapters.length} chapters, {COLLECTED_VOLUME.pages}pp
              </span>
            </Link>

            <Link to="/research" className="group flex min-w-0 items-baseline gap-3 no-underline">
              <span
                aria-hidden="true"
                className="mt-[2px] h-[9px] w-[9px] shrink-0 self-center"
                style={{ background: 'var(--story-indigo)' }}
              />
              <span className="min-w-0 font-sans text-[length:var(--type-meta-size)] leading-snug text-[var(--text-secondary)]">
                <span className="font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] group-hover:text-[var(--story-indigo)]">
                  The papers
                </span>{' '}
                — the same results written for referees, 7 of them, {RESEARCH_PAPER_TOTAL_PAGES}pp
              </span>
            </Link>
          </div>
        </div>
      </PageContainer>
    </div>
  )
}
