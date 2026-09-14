import { Eyebrow, Slab } from '@/components/swiss'
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
          {/* The masthead never moves: title, claim, the three numbers, the
              one thing to do, and the cover. */}
          <div className="flex min-h-0 flex-col gap-6 overflow-y-auto border-b-2 border-[var(--border-strong)] px-6 py-6 lg:border-b-0 lg:border-r-2 lg:px-8 lg:py-8">
            <div className="slug-hoist" aria-hidden="true">
              <span className="route">/whitepaper</span>
              <i className="fl fl-whiskey" />
              <i className="fl fl-papa" />
            </div>

            <div>
              <Eyebrow>The Harbor Library · {TEXTBOOK.edition.version}</Eyebrow>
              <h1 className="mt-2 max-w-[17ch] text-[clamp(30px,3.2vw,44px)] font-bold leading-[1.04] tracking-[-0.035em] text-[var(--text-primary)]">
                {TEXTBOOK.edition.title}
              </h1>
              <p className="deck-voice mt-3 max-w-[44ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
                {TEXTBOOK.edition.claim}
              </p>
            </div>

            <div className="flex flex-wrap gap-x-7 gap-y-3">
              {[
                { n: String(TEXTBOOK.chapters.length).padStart(2, '0'), l: 'chapters' },
                { n: String(TEXTBOOK.parts.length).padStart(2, '0'), l: 'parts' },
                { n: String(COLLECTED_VOLUME.pages), l: 'pages, free' },
              ].map((stat) => (
                <div key={stat.l} className="border-t-2 border-[var(--border-strong)] pt-2">
                  <div className="font-mono text-[26px] font-bold leading-none text-[var(--text-primary)]">
                    {stat.n}
                  </div>
                  <div className="mt-1 text-[12.5px] text-[var(--text-muted)]">{stat.l}</div>
                </div>
              ))}
            </div>

            <a
              href={COLLECTED_VOLUME.downloadUrl}
              className="inline-block bg-[var(--brand-primary)] px-5 py-3 font-mono text-[13px] font-bold tracking-[0.04em] text-[var(--brand-primary-foreground)] no-underline"
            >
              Read the Book (PDF)
            </a>

            {/* The cover is page 1 of the committed PDF, rendered by
                scripts/render-book-cover.mjs. It is one image in both themes
                on purpose: a cover is a physical object, and inverting it for
                dark mode would be showing a book that does not exist. */}
            <figure className="mt-auto border-2 border-[var(--border-strong)]">
              <img
                className="block h-auto w-full"
                src="/whitepaper/plates/book-cover.jpg"
                width={770}
                height={1100}
                alt="The cover: the title set in grotesk over a container terminal in halftone, cut into a blue and red modular grid."
                loading="lazy"
                decoding="async"
              />
            </figure>
          </div>

          {/* The outline. One head, then everything, and only this scrolls. */}
          <div className="flex min-h-0 flex-col">
            <div
              className="on-block shrink-0 px-6 py-5 lg:px-9 lg:py-6"
              style={{ background: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}
            >
              <h2 className="max-w-[24ch] text-[clamp(22px,2.4vw,34px)] font-bold leading-[1.08] tracking-[-0.02em]">
                Four parts, eight chapters, one question each.
              </h2>
              <p className="deck-voice mt-2 max-w-[64ch] text-[15px] leading-[1.5] opacity-90">
                Every chapter opens on a question and closes on something you can check —
                a theorem, a model a machine will run for you, or a number you can
                recompute. The check is the line under each chapter.
              </p>
            </div>

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
                      <Slab slug={part.slug} className="grid grid-cols-[auto_1fr] items-end gap-x-5 px-5 py-5">
                        <span className="font-mono text-[clamp(52px,8vw,96px)] font-bold leading-[0.74] tracking-[-0.05em]">
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
                        className="hidden h-full w-full object-cover md:block"
                      />
                    </div>
                    <p className="mt-3 max-w-[76ch] text-[14.5px] leading-[1.6] text-[var(--text-muted)]">
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
