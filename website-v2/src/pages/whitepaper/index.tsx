import { Slab } from '@/components/swiss'
import {
  chapterRecordFor,
  COLLECTED_VOLUME,
  TABLE_OF_CONTENTS,
  TEXTBOOK,
  WHITE_PAPERS,
} from '@/data/whitePapers'

/**
 * /whitepaper — the Book, on one screen.
 *
 * What this page is now, and why it stopped being what it was:
 *
 * It had five sub-menus — Contents, The Spine, The Proofs, Limits, Read it —
 * and four of them were the same eight chapters listed a second time under a
 * different heading, with the fifth repeating the download button that has
 * always sat in the masthead. A reader who wanted to know what is in the book
 * had to pick which of five tabs was the table of contents. So the tabs are
 * gone and the outline gets the whole panel: four parts, eight chapters, and
 * under each chapter the concrete thing it leaves you holding.
 *
 * Two things this page does not do. It does not tell you what order to read
 * in beyond the numbers, and it does not label any chapter as proving another
 * one: that apparatus was a filing system the reader never asked for. And it
 * does not use cards — the Book is one PDF, chapters are entries in an
 * outline, and a grid of tiles would imply eight documents that do not exist.
 */

/** One chapter: its plate, then number, title, question, why, and what it settles. */
function ChapterEntry({ paperId, slug }: { paperId: string; slug: string }) {
  const paper = WHITE_PAPERS.find((candidate) => candidate.id === paperId)
  const record = chapterRecordFor(paperId)
  if (!paper || !record) return null

  return (
    <div className="deck-chapter grid gap-x-5 py-4 sm:grid-cols-[3.25rem_minmax(0,1fr)]">
      {/* The numeral is a block of the part's ink, not a coloured digit: at
          this size a tinted number beside a heading disappears, and the block
          is what makes the four parts visible while you scroll one list. */}
      <div
        className="mb-2 flex h-[2.6rem] w-[2.6rem] items-center justify-center sm:mb-0"
        style={{ background: `var(--part-${slug})`, color: `var(--part-${slug}-on)` }}
      >
        <span className="font-mono text-[19px] font-bold leading-none tracking-[-0.02em]">
          {String(paper.chapter).padStart(2, '0')}
        </span>
      </div>
      <div>
        {/* The chapter's own plate, the same file the Book prints at its
            opener (plates/swiss/chapter-<prefix>.jpg). It is cropped to a
            band rather than shown whole: the plates are 2:1, eight of them at
            full height would be most of the panel, and the left third is
            where each one puts its subject. */}
        <img
          src={`/whitepaper/plates/swiss/chapter-${record.prefix}.jpg`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="mb-3 block h-[86px] w-full max-w-[46rem] object-cover object-left"
        />
        <h3 className="text-[19px] font-bold leading-[1.15] tracking-[-0.015em] text-[var(--text-primary)]">
          {paper.title}
        </h3>
        <p className="mt-1 text-[15px] font-semibold italic text-[var(--text-secondary)]">
          {record.question}
        </p>
        <p className="mt-2 max-w-[72ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
          {record.teaser}
        </p>
        {record.result ? (
          /* The result, set against a rule in the part's ink rather than in a
             tinted box. This is the line that answers "so what did they
             actually find", and it is the reason the tabs could go: the page
             now shows the findings instead of listing the chapters twice. */
          <p
            className="mt-2.5 max-w-[72ch] border-l-[3px] pl-3.5 text-[14.5px] leading-[1.6] text-[var(--text-primary)]"
            style={{ borderColor: `var(--part-${slug})` }}
          >
            {record.result}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default function WhitepaperPage() {
  return (
    <main id="main-content">
      <div className="flex flex-col overflow-hidden bg-[var(--surface-base)] lg:h-[100dvh]">
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)]">
          {/* The masthead. The cover IS the title -- it carries the title,
              the subtitle and the author in type already, so setting them
              again beside it was the same words twice. What is left is the
              cover, the one sentence the Book argues, and the thing to do.
              The edition eyebrow and the chapters/parts/pages counters went
              with the duplicate title: a count of parts is not a reason to
              read anything, and the outline on the right shows both. */}
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto border-b-2 border-[var(--border-strong)] px-6 py-6 lg:border-b-0 lg:border-r-2 lg:px-8 lg:py-8">
            <div className="slug-hoist" aria-hidden="true">
              <span className="route">/whitepaper</span>
              <i className="fl fl-whiskey" />
              <i className="fl fl-papa" />
            </div>

            {/* Page 1 of the committed PDF, rendered by
                scripts/render-book-cover.mjs. One image in both themes on
                purpose: a cover is an object, and inverting it for dark mode
                would show a book that does not exist. */}
            <img
              className="block h-auto w-full border-2 border-[var(--border-strong)]"
              src="/whitepaper/book-cover.jpg"
              width={770}
              height={1100}
              alt={`${TEXTBOOK.edition.title}: ${TEXTBOOK.edition.subtitle}. The title set in grotesk over a container terminal in halftone, cut into a blue and red modular grid.`}
              loading="eager"
              decoding="async"
            />

            <p className="deck-voice max-w-[42ch] text-[15.5px] leading-[1.6] text-[var(--text-secondary)]">
              {TEXTBOOK.edition.claim}
            </p>

            <a
              href={COLLECTED_VOLUME.downloadUrl}
              className="inline-block bg-[var(--brand-primary)] px-5 py-3 font-mono text-[13px] font-bold tracking-[0.04em] text-[var(--brand-primary-foreground)] no-underline"
            >
              Read the Book — {COLLECTED_VOLUME.pages}pp PDF, free
            </a>
          </div>

          {/* The outline. No head block: it carried a headline counting the
              parts and a paragraph explaining what a chapter is, and the
              outline underneath says both by existing. Only this scrolls. */}
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-9 lg:py-7">
              <div className="space-y-8">
                {TABLE_OF_CONTENTS.map((part) => (
                  <section key={part.id}>
                    {/* The part opener, as the Book sets it: a slab of the
                        part's ink carrying an oversized numeral and the title
                        in paper, with the part's own plate beside it at the
                        same height and no gap between them. The plate is the
                        same file the Book prints (plates/swiss/part-N.jpg) and
                        it is already in the part's ink, so the two halves read
                        as one band rather than an image next to a heading.
                        Below 900px the plate goes: at that width it would be a
                        70px letterbox, which is showing nothing. */}
                    <div className="grid items-stretch md:grid-cols-2">
                      <Slab slug={part.slug} className="grid grid-cols-[auto_1fr] items-end gap-x-5 px-5 py-4">
                        <span className="font-mono text-[clamp(40px,4.6vw,60px)] font-bold leading-[0.74] tracking-[-0.05em]">
                          {part.numeral}
                        </span>
                        <h2 className="pb-[0.18em] text-[clamp(20px,2.6vw,30px)] font-bold leading-[1.02] tracking-[-0.025em]">
                          {part.title}
                        </h2>
                      </Slab>
                      <img
                        src={`/whitepaper/plates/swiss/part-${part.numeral}.jpg`}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        className="hidden h-full max-h-[136px] w-full object-cover md:block"
                      />
                    </div>
                    <p className="mt-3 max-w-[76ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
                      {part.blurb}
                    </p>
                    <div className="mt-2">
                      {part.chapters.map((chapterId) => (
                        <ChapterEntry key={chapterId} paperId={chapterId} slug={part.slug} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
