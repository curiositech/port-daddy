import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { PageContainer } from '@/components/site/primitives'
import {
  RESEARCH_PAPERS_FOLDED,
  RESEARCH_PAPERS_RELATED,
  RESEARCH_PAPER_TOTAL_PAGES,
} from '@/data/researchPapers'
import { COLLECTED_VOLUME, TEXTBOOK } from '@/data/whitePapers'

/**
 * The strip below the sticky nav and above the hero: the Book, then the
 * standalone papers. Two collections that both used to get called "seven
 * papers" (see the 2026-08-26 `/library` naming-collision fix), so each is
 * named here and nowhere is either called "papers" alone.
 *
 * 2026-10-19: the copy sells the Book to the site's visitor. The strip used to
 * open with an edition number and the Book's thesis, which told a stranger
 * neither what the Book is to this product nor why to open it, and called the
 * papers "the same results in submission form" before any result had been
 * mentioned. Now the eyebrow locates the Book (the one the product is built on),
 * the standfirst names the mechanisms and where the volume came from, and the
 * papers column says when to choose it instead.
 *
 * 2026-10-19: the cover is the Book's own page one. Until then this strip
 * showed a watercolor jacket from the maritime edition at thumbnail size, and
 * /whitepaper showed a cut-paper diorama — two pictures of a book, neither of
 * them the book. `plates/cover-swiss.jpg` is rasterised from the committed
 * PDF by scripts/whitepaper-plates/render_cover_plate.py, whose --check fails
 * when the Book has moved and the cover has not. Every number on the strip is
 * read from the data the PDF is checked against (whitePapers.ts,
 * researchPapers.ts); none is typed here.
 *
 * Intentionally NOT a <section>: signage, not page content, so it carries no
 * PanelEyebrow/PanelTitle and stays out of the heading outline.
 */
export function LibraryBanner() {
  const chapters = TEXTBOOK.chapters.length
  const parts = TEXTBOOK.parts.length
  const folded = RESEARCH_PAPERS_FOLDED.length
  const related = RESEARCH_PAPERS_RELATED.length

  return (
    <div className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
      <PageContainer width="wide">
        {/* Phone: a media object — cover beside the eyebrow and title, then
            the claim, figures and actions run the full width under both, so
            nothing wraps down a 200px column. From lg the three columns sit
            side by side: cover, the Book, the papers. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-[var(--space-5)] gap-y-[var(--space-4)] py-[var(--space-5)] lg:grid-cols-[auto_minmax(0,1.45fr)_minmax(0,1fr)] lg:items-center lg:gap-x-[var(--space-6)]">
          <Link to="/whitepaper" className="block shrink-0" aria-label="The Book: contents">
            <img
              src="/whitepaper/plates/cover-swiss.jpg"
              width={1000}
              height={1429}
              loading="eager"
              decoding="async"
              alt={`Cover of ${TEXTBOOK.edition.title}, ${TEXTBOOK.edition.version}`}
              className="block h-auto w-[108px] border-2 border-[var(--border-strong)] sm:w-[148px] lg:w-[172px]"
            />
          </Link>

          <div className="contents lg:block lg:min-w-0">
            <div className="min-w-0 self-center">
              <div className="font-mono text-[14px] font-bold uppercase tracking-[0.12em] text-[var(--text-meta)]">
                The book Port Daddy is built on
              </div>
              <h2 className="mt-[var(--space-2)] max-w-[24ch] text-[clamp(21px,2.1vw,29px)] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--text-primary)]">
                {TEXTBOOK.edition.title}
              </h2>
            </div>
            <div className="col-span-2 min-w-0 lg:col-span-1">
              {/* The sell, in the product's own terms. A visitor arrives from the
                  harness, the tubes or a search result; the Book's title tells them
                  nothing about why a control plane for coding agents ships a
                  textbook. Each mechanism named here is a chapter (1, 2, 3, 5 and
                  6 to 7); "built, modelled, or proposed" is the Book's own
                  labelling of every claim, and the whitepapers are literally what
                  this volume was collated from. */}
              <p className="max-w-[72ch] text-[16px] leading-[1.5] text-[var(--text-secondary)] lg:mt-[var(--space-2)]">
                Port Daddy is built on an argument about how software can act for you without slipping
                your hold: one writer at a time, authority that only narrows as it is handed down, a
                sealed place to run, and a record that gives a spawn a reputation to lose. The
                whitepapers grew into this textbook; every claim in it says whether it is built,
                modelled, or proposed.
              </p>
              <p className="mt-[var(--space-2)] font-mono text-[14px] leading-[1.5] text-[var(--text-meta)]">
                {chapters} chapters in {parts} parts · {COLLECTED_VOLUME.pages} pages · {TEXTBOOK.edition.version} · free PDF
              </p>
              <div className="mt-[var(--space-4)] flex flex-wrap items-center gap-x-[var(--space-5)] gap-y-[var(--space-2)]">
                <a
                  href={COLLECTED_VOLUME.downloadUrl}
                  className="inline-block whitespace-nowrap bg-[var(--brand-primary)] px-[var(--space-4)] py-[var(--space-2)] font-mono text-[14px] font-bold tracking-[0.04em] text-[var(--brand-primary-foreground)] no-underline"
                >
                  Read the Book (PDF)
                </a>
                <Link
                  to="/whitepaper"
                  className="group inline-flex items-center gap-[var(--space-2)] whitespace-nowrap font-mono text-[14px] font-bold uppercase tracking-[0.08em] text-[var(--text-primary)] no-underline hover:text-[var(--text-brand-primary)]"
                >
                  Contents
                  <ArrowRight
                    aria-hidden="true"
                    size={16}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </Link>
              </div>
            </div>
          </div>

          <div className="col-span-2 min-w-0 border-t-2 border-[var(--border-default)] pt-[var(--space-4)] lg:col-span-1 lg:border-l-2 lg:border-t-0 lg:pl-[var(--space-6)] lg:pt-0">
            <div className="font-mono text-[14px] font-bold uppercase tracking-[0.12em] text-[var(--text-meta)]">
              The papers behind it
            </div>
            <p className="mt-[var(--space-2)] max-w-[44ch] text-[16px] leading-[1.5] text-[var(--text-secondary)]">
              {folded} papers carry the Book's results in a form written to be checked
              {related > 0 ? `, and ${related} more ${related === 1 ? 'is' : 'are'} related work` : ''}:{' '}
              {RESEARCH_PAPER_TOTAL_PAGES} pages in all, each stating its assumptions, naming the tool
              that checks it, and saying where it stops. Start here if you want the proofs without the
              teaching.
            </p>
            <Link
              to="/research"
              className="group mt-[var(--space-3)] inline-flex items-center gap-[var(--space-2)] font-mono text-[14px] font-bold uppercase tracking-[0.08em] text-[var(--text-primary)] no-underline hover:text-[var(--text-story-indigo)]"
            >
              Read the papers
              <ArrowRight
                aria-hidden="true"
                size={16}
                className="transition-transform group-hover:translate-x-1"
              />
            </Link>
          </div>
        </div>
      </PageContainer>
    </div>
  )
}
