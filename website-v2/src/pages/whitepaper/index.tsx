import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { DeckShell, type DeckSignal } from '@/components/library/DeckShell'
import {
  chapterRecordFor,
  chapterRoleLabel,
  COLLECTED_VOLUME,
  LIBRARY_CHANGELOG,
  LIBRARY_SPINE,
  TABLE_OF_CONTENTS,
  TEXTBOOK,
  WHITE_PAPERS,
} from '@/data/whitePapers'

/**
 * /whitepaper — the Book, on one screen.
 *
 * What this replaced: a column tall enough that the table of contents sat
 * below three screenfuls of hero, and the reader who arrived wanting to
 * know what the eight chapters ARE had to scroll past the argument, the
 * architecture and the reading paths to find out. All of that content is
 * still here. It stopped being a queue and became five panels.
 *
 * One rule this page keeps that the old one broke: the Book is ONE
 * document. Chapters are entries in an outline — part, then chapter, then
 * the question it answers, then why you would want it — and never cards
 * linking off to eight separate PDFs, because there are not eight PDFs.
 *
 * 2026-10-19: the panels lost their paint. Part openers were solid slabs
 * carrying a 108px numeral, chapter numbers were filled squares, the seam
 * statement was a rust flood, and most labels sat at 11–13px. Now a part is
 * a rule and a numbered heading in its own hue, a chapter number is a word
 * in that hue, the seam is a bordered note, and nothing on the page is set
 * below 14px except the eyebrow (12px, bold, tracked, upper case — the one
 * size the vision rule permits there). The masthead shows the Book's own
 * cover, rasterised from the committed PDF, instead of an illustration of a
 * book.
 */

/**
 * The four part inks, as tokens rather than hexes.
 *
 * The palette guard forbids colour literals in a component for a reason: a
 * hex here cannot follow the token when the story palette moves, and a
 * literal does not know what theme it is in. Every one of these exists as a
 * theme-aware pair: cobalt and teal are the brand tokens the story palette
 * reuses for L0 truth and L2 legibility, violet and gold are its own.
 */
const PART_INK: Record<string, string> = {
  pdcobalt: 'var(--brand-primary)',
  pdteal: 'var(--brand-accent)',
  pdviolet: 'var(--story-violet)',
  pdgold: 'var(--story-gold)',
}

/**
 * Which part's ink a chapter belongs to, keyed by chapter id. Every panel
 * lists chapters out of part order (the spine runs 1–8 straight through, the
 * proofs panel picks three), so the hue the reader learned on the Contents
 * panel has to travel with the chapter. Deriving it here rather than
 * hard-coding a second table means a chapter that moves between parts moves
 * its colour too.
 */
const CHAPTER_INK = new Map(
  TABLE_OF_CONTENTS.flatMap((part) =>
    part.chapters.map((chapterId) => [chapterId, PART_INK[part.color] ?? PART_INK.pdcobalt] as const),
  ),
)

function inkFor(chapterId: string) {
  return CHAPTER_INK.get(chapterId) ?? PART_INK.pdcobalt
}

/** A chapter number in its part's hue: a mark the eye can run down a column of, with no box around it. */
function NumberMark({ n, ink, size = 'md' }: { n: number; ink: string; size?: 'md' | 'lg' }) {
  return (
    <span
      className={
        size === 'lg'
          ? 'w-12 shrink-0 font-mono text-[26px] font-bold leading-none tabular-nums tracking-[-0.03em]'
          : 'w-8 shrink-0 font-mono text-[15px] font-bold leading-none tabular-nums'
      }
      style={{ color: ink }}
      aria-hidden="true"
    >
      {String(n).padStart(2, '0')}
    </span>
  )
}

function Eyebrow({ children, ink }: { children: React.ReactNode; ink?: string }) {
  return (
    <div
      className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]"
      style={ink ? { color: ink } : undefined}
    >
      {children}
    </div>
  )
}

/** One chapter, as an outline entry. Number, title, role, question, teaser. */
function ChapterEntry({ paperId, rule }: { paperId: string; rule: string }) {
  const paper = WHITE_PAPERS.find((candidate) => candidate.id === paperId)
  const record = chapterRecordFor(paperId)
  if (!paper || !record) return null

  return (
    <div className="deck-chapter py-4" style={{ ['--deck-ch' as string]: rule }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[14px] font-bold tabular-nums" style={{ color: rule }}>
          {String(paper.chapter).padStart(2, '0')}
        </span>
        <h3 className="text-[18px] font-bold leading-tight tracking-[-0.012em] text-[var(--text-primary)]">
          {paper.title}
        </h3>
        <span className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {chapterRoleLabel(paper)}
        </span>
      </div>
      <p className="mt-1.5 text-[15px] font-semibold italic leading-[1.5] text-[var(--text-secondary)]">
        {record.question}
      </p>
      <p className="mt-1.5 max-w-[70ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
        {record.teaser}
      </p>
    </div>
  )
}

function ContentsPanel() {
  return (
    <div className="space-y-8">
      {TABLE_OF_CONTENTS.map((part) => {
        const ink = PART_INK[part.color] ?? PART_INK.pdcobalt
        return (
          <section key={part.id}>
            {/* A part opener is a rule, its numeral and its title in the
                part's hue — the same device the chapter numbers use, one size
                up, so the four hues read as four parts without a legend and
                without a block of paint. */}
            <div className="border-t-2 border-[var(--border-strong)] pt-3">
              <Eyebrow ink={ink}>Part {part.numeral}</Eyebrow>
              <h2 className="mt-1 text-[clamp(22px,2.2vw,28px)] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--text-primary)]">
                {part.title}
              </h2>
            </div>
            <p className="mt-3 max-w-[70ch] text-[15px] leading-[1.6] text-[var(--text-muted)]">
              {part.blurb}
            </p>
            <div className="mt-2">
              {part.chapters.map((chapterId) => (
                <ChapterEntry key={chapterId} paperId={chapterId} rule={ink} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function SpinePanel() {
  return (
    <div className="space-y-7">
      <blockquote className="deck-voice max-w-[54ch] text-[clamp(20px,2vw,26px)] leading-[1.42] text-[var(--text-primary)]">
        {LIBRARY_SPINE}
      </blockquote>
      {/* Eight chapters on one hard grid: the numeral in the part's hue, then
          the title, then the claim. The hue is what keeps the four parts
          visible in a list that runs straight through 1 to 8. */}
      <div className="grid gap-x-8 gap-y-5 border-t-2 border-[var(--border-strong)] pt-5 sm:grid-cols-2">
        {TEXTBOOK.chapters.map((chapter) => (
          <div key={chapter.id} className="grid grid-cols-[auto_1fr] items-baseline gap-x-3">
            <NumberMark n={chapter.number} ink={inkFor(chapter.id)} />
            <div>
              <div className="text-[16px] font-bold leading-[1.25] tracking-[-0.012em] text-[var(--text-primary)]">
                {chapter.title}
              </div>
              <p className="mt-1 max-w-[52ch] text-[15px] leading-[1.55] text-[var(--text-secondary)]">
                {chapter.oneLine}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProofsPanel() {
  const proving = WHITE_PAPERS.filter((paper) => paper.role === 'proves')
  return (
    <div className="space-y-6">
      <p className="max-w-[70ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
        A proving chapter is not an appendix — it is the chapter where the prose stops
        and a checker starts, and it always follows the chapter whose promises it keeps.
        Three of the eight do this, and each one names the tool that holds it.
      </p>
      {/* Three rows, not three cards. A proving chapter is a chapter — the
          same outline entry the Contents panel draws, picked out of it — and
          boxing it would say it is a separate thing you could take away on its
          own, which is the one claim this whole page exists to deny. */}
      <div>
        {proving.map((paper) => {
          const record = chapterRecordFor(paper.id)
          const ink = inkFor(paper.id)
          return (
            <div
              key={paper.id}
              className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 border-t-2 border-[var(--border-strong)] py-5 first:border-t-0 first:pt-0"
            >
              <NumberMark n={paper.chapter} ink={ink} size="lg" />
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="text-[18px] font-bold leading-tight tracking-[-0.015em] text-[var(--text-primary)]">
                    {paper.title}
                  </h3>
                  <span className="font-mono text-[12px] font-bold uppercase tracking-[0.1em]" style={{ color: ink }}>
                    {chapterRoleLabel(paper)}
                  </span>
                </div>
                <p className="mt-1.5 max-w-[70ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
                  {record?.oneLine}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <p className="max-w-[70ch] text-[15px] leading-[1.6] text-[var(--text-muted)]">
        Every mechanised claim in the Book is listed with the artifact that checks it and
        the job that runs it, in the appendix and on the proofs page — including the ones
        where the model is bounded, or the property is named but not yet machine-checked.
      </p>
    </div>
  )
}

function LimitsPanel() {
  return (
    <div className="space-y-6">
      <p className="max-w-[70ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
        Every important statement in the Book is labelled by kind, so you always know what
        you are reading: a <strong className="text-[var(--text-primary)]">theorem</strong> that
        follows from a formal model with stated assumptions, a{' '}
        <strong className="text-[var(--text-primary)]">design invariant</strong> intended to
        hold and backed by implementation and tests, a{' '}
        <strong className="text-[var(--text-primary)]">model-checked property</strong> proved
        for a bounded model, or an{' '}
        <strong className="text-[var(--text-primary)]">empirical hypothesis</strong> that
        still needs measuring. Each chapter ends with its own Limitations and Boundaries.
      </p>
      {/* The seam itself: the most important sentence on the panel, set apart
          by a rule in the panel's hue rather than a block of it. */}
      <div
        className="border-l-4 bg-[var(--surface-raised)] py-4 pl-5 pr-5"
        style={{ borderColor: 'var(--story-rust)' }}
      >
        <p className="max-w-[66ch] text-[16px] font-medium leading-[1.55] text-[var(--text-primary)]">
          The harbor runs today. The market does not — it is specified and, in places,
          proved, which is a different thing from deployed, and the Book says which is
          which on every page rather than in a disclaimer at the end.
        </p>
      </div>
      <div>
        <Eyebrow>What changed, and when</Eyebrow>
        {/* Date in its own column rather than stacked above the title: the
            dates are the same shape and the same width, so a column of them
            is a scale the eye can run down. */}
        <div className="mt-2">
          {LIBRARY_CHANGELOG.slice(0, 4).map((entry) => (
            <div
              key={entry.dateIso}
              className="grid gap-x-5 border-t border-[var(--hair-strong)] py-3 sm:grid-cols-[8.5rem_1fr]"
            >
              <div className="font-mono text-[14px] font-bold leading-[1.5] text-[var(--text-muted)]">
                {entry.date}
              </div>
              <div>
                <div className="text-[16px] font-semibold leading-[1.3] text-[var(--text-primary)]">
                  {entry.title}
                </div>
                <p className="mt-1 max-w-[70ch] text-[15px] leading-[1.55] text-[var(--text-muted)]">
                  {entry.summary}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ReadPanel() {
  // The bound volume plus any alternate typographic editions published beside
  // it. The volume has a downloadUrl; an edition only has its pdfPath, and the
  // union of the two shapes is why this is not one field. The Book publishes
  // one edition today, so this is usually a single entry.
  const downloads = [
    { id: COLLECTED_VOLUME.id, title: COLLECTED_VOLUME.title, pages: COLLECTED_VOLUME.pages, href: COLLECTED_VOLUME.downloadUrl },
    ...(COLLECTED_VOLUME.editions ?? []).map((edition) => ({
      id: edition.id,
      title: edition.title,
      pages: edition.pages,
      href: edition.pdfPath,
    })),
  ]

  return (
    <div className="space-y-6">
      <p className="max-w-[70ch] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
        It is one PDF. Read it front to back if you have the time, or use the front
        matter's express lanes, which name the four or five sections that carry the
        argument for whoever you happen to be — the operator, the security reviewer, the
        economist, the person who just wants the thing to stop losing their work.
      </p>
      {/* The one thing to do on this panel is take the PDF, so the download is
          the one filled element on the page. */}
      <div className={`grid gap-4 ${downloads.length > 1 ? 'md:grid-cols-3' : 'md:max-w-[36rem]'}`}>
        {downloads.map((edition) => (
          <a
            key={edition.id}
            href={edition.href}
            className="group block px-5 py-4 no-underline transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
            style={{ background: 'var(--brand-primary)', color: 'var(--brand-primary-foreground)' }}
          >
            <div className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] opacity-90">
              {edition.pages > 0 ? `${edition.pages} pages · PDF` : 'building'}
            </div>
            <div className="mt-1.5 text-[18px] font-bold leading-[1.2] tracking-[-0.015em]">
              {edition.title}
            </div>
          </a>
        ))}
      </div>
      <p className="max-w-[70ch] text-[15px] leading-[1.6] text-[var(--text-muted)]">
        One set of sources, set in the Swiss character: colour blocking, grotesk display,
        flat marks. Two other typographies of the same eight chapters and the same generated
        bibliography live in the repository and build from the same sources; nothing in the
        argument changes between them.
      </p>
    </div>
  )
}

export default function WhitepaperPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const signals: DeckSignal[] = React.useMemo(
    () => [
      {
        id: 'contents',
        label: 'Contents',
        flag: 'fl-papa',
        meaning: 'Papa — about to proceed to sea',
        color: 'var(--brand-primary)',
        onColor: 'var(--brand-primary-foreground)',
        headline: 'Four parts, eight chapters, one question each.',
        standfirst:
          'Each chapter stands on the ones before it, and every proving chapter follows the chapter whose promises it keeps — so the numbers are the argument, not a filing order.',
        render: () => <ContentsPanel />,
      },
      {
        id: 'spine',
        label: 'The spine',
        flag: 'fl-kilo',
        meaning: 'Kilo — I wish to communicate with you',
        color: 'var(--brand-accent)',
        onColor: 'var(--brand-accent-foreground)',
        headline: 'One sentence, threaded through eight chapters.',
        standfirst:
          'If you read nothing else, read this: it is the whole book compressed to the point where you can decide whether you disagree with it.',
        render: () => <SpinePanel />,
      },
      {
        id: 'proofs',
        label: 'The proofs',
        flag: 'fl-charlie',
        meaning: 'Charlie — affirmative',
        color: 'var(--story-indigo)',
        onColor: 'var(--story-indigo-foreground)',
        headline: 'Where the prose stops and a checker starts.',
        standfirst:
          'Three chapters exist to keep another chapter honest, and each one names the tool that holds it — ProVerif, TLA⁺, Kani, Z3.',
        render: () => <ProofsPanel />,
      },
      {
        id: 'limits',
        label: 'Limits',
        flag: 'fl-uniform',
        meaning: 'Uniform — you are running into danger',
        color: 'var(--story-rust)',
        onColor: 'var(--story-rust-foreground)',
        headline: 'What is built, what is modelled, what is proposed.',
        standfirst:
          'The seam between working software and a finished argument is the most interesting thing on this page, so it is not buried at the back.',
        render: () => <LimitsPanel />,
      },
      {
        id: 'read',
        label: 'Read it',
        flag: 'fl-hotel',
        meaning: 'Hotel — I have a pilot on board',
        color: 'var(--story-gold)',
        onColor: 'var(--story-gold-foreground)',
        headline: 'One PDF, free.',
        standfirst:
          'No form, no email, no chapter paywalled behind a newsletter — the whole book, eight chapters in four parts.',
        render: () => <ReadPanel />,
      },
    ],
    [],
  )

  const requested = searchParams.get('panel')
  const activeId = signals.some((signal) => signal.id === requested) ? (requested as string) : 'contents'

  const select = React.useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams)
      next.set('panel', id)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return (
    <main id="main-content">
      <DeckShell
        routeLabel="/whitepaper"
        hoist={['fl-whiskey', 'fl-papa']}
        activeId={activeId}
        onSelect={select}
        signals={signals}
        masthead={
          <div className="flex flex-col gap-5">
            {/* The cover and the Book's three figures share one row: the
                object on the left, its numbers stepped down its right-hand
                side, so the column carries no empty air beside the picture.
                On a wide screen the row leads, the way a bookseller's listing
                does (object, then title); on a phone the masthead is a short
                scrolling band above the rail, so the title and the download
                come first and the row follows. */}
            <div className="order-2 flex items-stretch gap-5 lg:order-1">
              <figure className="w-[9.5rem] shrink-0 lg:w-[10rem]">
                <img
                  className="block h-auto w-full border-2 border-[var(--border-strong)]"
                  src="/whitepaper/plates/cover-swiss.jpg"
                  width={1000}
                  height={1429}
                  alt={`Cover of ${TEXTBOOK.edition.title}, ${TEXTBOOK.edition.version}`}
                  loading="eager"
                  decoding="async"
                />
                <figcaption className="mt-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                  Page one of the PDF
                </figcaption>
              </figure>
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-3">
                {[
                  { n: String(TEXTBOOK.chapters.length).padStart(2, '0'), l: 'chapters' },
                  { n: String(TEXTBOOK.parts.length).padStart(2, '0'), l: 'parts' },
                  { n: String(COLLECTED_VOLUME.pages), l: 'pages, free' },
                ].map((stat) => (
                  <div key={stat.l} className="border-t-2 border-[var(--border-strong)] pt-2">
                    <div className="font-mono text-[26px] font-bold leading-none text-[var(--text-primary)]">
                      {stat.n}
                    </div>
                    <div className="mt-1 text-[14px] text-[var(--text-muted)]">{stat.l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <Eyebrow>The book Port Daddy is built on · {TEXTBOOK.edition.version}</Eyebrow>
              <h1 className="mt-2 max-w-[17ch] text-[clamp(28px,3vw,40px)] font-bold leading-[1.06] tracking-[-0.03em] text-[var(--text-primary)]">
                {TEXTBOOK.edition.title}
              </h1>
              <p className="deck-voice mt-3 max-w-[44ch] text-[16px] leading-[1.55] text-[var(--text-secondary)]">
                {TEXTBOOK.edition.claim}
              </p>
            </div>

            <a
              href={COLLECTED_VOLUME.downloadUrl}
              className="order-3 inline-block self-start bg-[var(--brand-primary)] px-5 py-3 font-mono text-[14px] font-bold tracking-[0.04em] text-[var(--brand-primary-foreground)] no-underline"
            >
              Read the Book (PDF)
            </a>
          </div>
        }
      />
    </main>
  )
}
