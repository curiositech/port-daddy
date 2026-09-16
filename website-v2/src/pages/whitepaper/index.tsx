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
 */

/**
 * The four part inks, as tokens rather than hexes.
 *
 * These were the Book's light-mode values pasted in literally, which had two
 * costs. The palette guard forbids colour literals in a component for a
 * reason -- a hex here cannot follow the token when the story palette moves --
 * and, more visibly, a literal does not know what theme it is in. Every one of
 * these already exists as a theme-aware pair: cobalt and teal are the brand
 * tokens the story palette reuses for L0 truth and L2 legibility, violet and
 * gold are its own. The dark block redefines all four, so the slabs now darken
 * with the page instead of printing light-mode ink on a dark ground.
 *
 * `on` matters most. It was fixed at cream, which is only correct while the
 * block stays dark; pairing each block with its own foreground token is what
 * lets the Swiss slab treatment carry paper-coloured type in either theme.
 */
const PART_INK: Record<string, { block: string; on: string; rule: string }> = {
  pdcobalt: {
    block: 'var(--brand-primary)',
    on: 'var(--brand-primary-foreground)',
    rule: 'var(--brand-primary)',
  },
  pdteal: {
    block: 'var(--brand-accent)',
    on: 'var(--brand-accent-foreground)',
    rule: 'var(--brand-accent)',
  },
  pdviolet: {
    block: 'var(--story-violet)',
    on: 'var(--story-violet-foreground)',
    rule: 'var(--story-violet)',
  },
  pdgold: {
    block: 'var(--story-gold)',
    on: 'var(--story-gold-foreground)',
    rule: 'var(--story-gold)',
  },
}

/**
 * Which part's ink a chapter belongs to, keyed by chapter id.
 *
 * The Contents panel already draws the parts, so it has the ink to hand; every
 * other panel lists chapters out of part order (the spine runs 1–8 straight
 * through, the proofs panel picks three) and used to fall back to a neutral
 * hairline, which threw away the one piece of information the reader had
 * already learned on the first panel. Deriving it here rather than hard-coding
 * a second table means a chapter that moves between parts moves its colour too.
 */
const CHAPTER_INK = new Map(
  TABLE_OF_CONTENTS.flatMap((part) =>
    part.chapters.map(
      (chapterId) => [chapterId, PART_INK[part.color] ?? PART_INK.pdcobalt] as const,
    ),
  ),
)

function inkFor(chapterId: string) {
  return CHAPTER_INK.get(chapterId) ?? PART_INK.pdcobalt
}

/**
 * A chapter number as a filled square of its part's ink, paper-coloured type.
 *
 * This is the Swiss edition's own device and the reason the rest of this page
 * needs almost no rules: a solid block reads as a mark at any size, so a
 * column of them is navigable at a glance, and the colour carries the part
 * without a legend. Square, flat, no border — the colour edge IS the edge.
 */
function NumberBlock({
  n,
  ink,
  size = 'md',
}: {
  n: number
  ink: { block: string; on: string }
  size?: 'md' | 'lg'
}) {
  return (
    <span
      className={
        size === 'lg'
          ? 'grid h-14 w-14 shrink-0 place-items-center font-mono text-[26px] font-bold leading-none tabular-nums tracking-[-0.04em]'
          : 'grid h-8 w-8 shrink-0 place-items-center font-mono text-[15px] font-bold leading-none tabular-nums tracking-[-0.03em]'
      }
      style={{ background: ink.block, color: ink.on }}
      aria-hidden="true"
    >
      {String(n).padStart(2, '0')}
    </span>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
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
    <div className="deck-chapter py-3" style={{ ['--deck-ch' as string]: rule }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-bold" style={{ color: rule }}>
          {String(paper.chapter).padStart(2, '0')}
        </span>
        <h3 className="text-[17px] font-bold leading-tight tracking-[-0.012em] text-[var(--text-primary)]">
          {paper.title}
        </h3>
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {chapterRoleLabel(paper)}
        </span>
      </div>
      <p className="mt-1 text-[14px] font-semibold italic text-[var(--text-secondary)]">
        {record.question}
      </p>
      <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
        {record.teaser}
      </p>
    </div>
  )
}

function ContentsPanel() {
  return (
    <div className="space-y-7">
      {TABLE_OF_CONTENTS.map((part) => {
        const ink = PART_INK[part.color] ?? PART_INK.pdcobalt
        return (
          <section key={part.id}>
            {/*
              The part band, in the Swiss edition's own idiom rather than a
              chip beside a heading. The book sets a part opener as a slab of
              the part's ink carrying an oversized numeral and the title in
              paper; this is that at web scale. The numeral is the size it is
              because it is the thing you navigate by on a flip-through, and
              it sits on the same baseline as the title so the two read as one
              mark rather than a number next to some words.

              No radius, no border, no shadow: the colour edge IS the edge.
            */}
            <div
              className="on-block grid grid-cols-[auto_1fr] items-end gap-x-5 px-5 py-5"
              style={{ background: ink.block, color: ink.on }}
            >
              {/*
                The numeral is set at display size, not label size. On the
                book's part page it is the largest thing on the sheet and it
                is what you navigate by on a flip-through; at 60px it was a
                caption sitting next to a heading, and a Roman numeral is
                narrow enough that it read smaller still. Tabular figures are
                off on purpose — I, II, III and IV are letters here, and
                forcing them onto a digit advance opens gaps inside III.
              */}
              <span className="font-mono text-[clamp(56px,9.5vw,108px)] font-bold leading-[0.74] tracking-[-0.05em]">
                {part.numeral}
              </span>
              <h2 className="pb-[0.18em] text-[clamp(20px,2.7vw,30px)] font-bold leading-[1.02] tracking-[-0.025em]">
                {part.title}
              </h2>
            </div>
            <p className="mt-3 max-w-[76ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
              {part.blurb}
            </p>
            <div className="mt-2">
              {part.chapters.map((chapterId) => (
                <ChapterEntry key={chapterId} paperId={chapterId} rule={ink.rule} />
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
    <div className="space-y-6">
      <blockquote className="deck-voice max-w-[54ch] text-[clamp(19px,2vw,26px)] leading-[1.42] text-[var(--text-primary)]">
        {LIBRARY_SPINE}
      </blockquote>
      {/* Eight chapters on one hard grid: a solid numeral block in the part's
          ink, then the title, then the claim. The blocks are what make the
          four parts visible in a list that runs straight through 1 to 8. */}
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {TEXTBOOK.chapters.map((chapter) => (
          <div key={chapter.id} className="grid grid-cols-[auto_1fr] items-start gap-x-3">
            <NumberBlock n={chapter.number} ink={inkFor(chapter.id)} />
            <div>
              <div className="text-[14.5px] font-bold leading-[1.2] tracking-[-0.012em] text-[var(--text-primary)]">
                {chapter.title}
              </div>
              <p className="mt-1 max-w-[52ch] text-[14px] leading-[1.55] text-[var(--text-secondary)]">
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
    <div className="space-y-5">
      <p className="max-w-[74ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        A proving chapter is not an appendix — it is the chapter where the prose stops
        and a checker starts, and it always follows the chapter whose promises it keeps.
        Three of the eight do this, and each one names the tool that holds it.
      </p>
      {/* Three rows, not three cards. A proving chapter is a chapter — the
          same outline entry the Contents panel draws, picked out of it — and
          boxing it would say it is a separate thing you could take away on its
          own, which is the one claim this whole page exists to deny. The
          numeral block does the separating; nothing here has an outline. */}
      <div>
        {proving.map((paper) => {
          const record = chapterRecordFor(paper.id)
          const ink = inkFor(paper.id)
          return (
            <div
              key={paper.id}
              className="grid grid-cols-[auto_1fr] items-start gap-x-4 border-t-2 border-[var(--border-strong)] py-4 first:border-t-0 first:pt-0"
            >
              <NumberBlock n={paper.chapter} ink={ink} size="lg" />
              <div>
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="text-[17px] font-bold leading-tight tracking-[-0.015em] text-[var(--text-primary)]">
                    {paper.title}
                  </h3>
                  <span
                    className="font-mono text-[11px] font-bold uppercase tracking-[0.1em]"
                    style={{ color: ink.rule }}
                  >
                    {chapterRoleLabel(paper)}
                  </span>
                </div>
                <p className="mt-1.5 max-w-[74ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                  {record?.oneLine}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      <p className="max-w-[74ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
        Every mechanised claim in the Book is listed with the artifact that checks it and
        the job that runs it, in the appendix and on the proofs page — including the ones
        where the model is bounded, or the property is named but not yet machine-checked.
      </p>
    </div>
  )
}

function LimitsPanel() {
  return (
    <div className="space-y-5">
      <p className="max-w-[74ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
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
      {/* The seam itself, as a slab rather than a tinted box with a bar down
          one side. This is the most important sentence on the panel and it is
          set the way the Book sets a part opener: solid ink, paper type, no
          border, because a colour block is a statement and a tint is a hint. */}
      <div
        className="px-5 py-4"
        style={{ background: 'var(--story-rust)', color: 'var(--story-rust-foreground)' }}
      >
        <p className="max-w-[70ch] text-[15px] font-medium leading-[1.55]">
          The harbor runs today. The market does not — it is specified and, in places,
          proved, which is a different thing from deployed, and the Book says which is
          which on every page rather than in a disclaimer at the end.
        </p>
      </div>
      <div>
        <Eyebrow>What changed, and when</Eyebrow>
        {/* Date in its own column rather than stacked above the title: the
            dates are the same shape and the same width, so a column of them
            is a scale the eye can run down, which is the whole reason to set
            a changelog on a grid instead of as four stacked blocks. */}
        <div className="mt-2">
          {LIBRARY_CHANGELOG.slice(0, 4).map((entry) => (
            <div
              key={entry.dateIso}
              className="grid gap-x-5 border-t border-[var(--hair-strong)] py-2.5 sm:grid-cols-[7.5rem_1fr]"
            >
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)] sm:pt-[3px]">
                {entry.date}
              </div>
              <div>
                <div className="text-[14.5px] font-semibold leading-tight text-[var(--text-primary)]">
                  {entry.title}
                </div>
                <p className="mt-1 max-w-[74ch] text-[13.5px] leading-[1.55] text-[var(--text-muted)]">
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
  // one edition today, so this is usually a single card — the grid takes its
  // column count from the list rather than assuming three, which is what left
  // a lone third-width card when the other two editions stopped being built.
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
    <div className="space-y-5">
      <p className="max-w-[74ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        It is one PDF. Read it front to back if you have the time, or use the front
        matter's express lanes, which name the four or five sections that carry the
        argument for whoever you happen to be — the operator, the security reviewer, the
        economist, the person who just wants the thing to stop losing their work.
      </p>
      {/* One edition gets a slab the width of the reading measure, not a
          card-sized tile stranded in a panel with nothing beside it. The
          single download IS the panel; making it small to keep the shape it
          had when there were three of them is what left the dead space. */}
      <div className={`grid gap-4 ${downloads.length > 1 ? 'md:grid-cols-3' : 'md:max-w-[42rem]'}`}>
        {downloads.map((edition) => {
          const href = edition.href
          return (
            <a
              key={edition.id}
              href={href}
              /* A filled block, not an outlined tile. The one thing to do on
                 this panel is take the PDF, and a Swiss page says that by
                 giving it the colour and the weight rather than by drawing a
                 rectangle around a link. Hover deepens the block; it does not
                 add chrome that was not there at rest. */
              className="group block px-5 py-4 no-underline transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
              style={{
                background: 'var(--brand-primary)',
                color: 'var(--brand-primary-foreground)',
              }}
            >
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] opacity-80">
                {edition.pages > 0 ? `${edition.pages} pp · PDF` : 'building'}
              </div>
              <div className="mt-1.5 text-[17px] font-bold leading-[1.15] tracking-[-0.015em]">
                {edition.title}
              </div>
            </a>
          )
        })}
      </div>
      <p className="max-w-[74ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
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
        art={{
          light: '/img/generated/library/book-light.webp',
          dark: '/img/generated/library/book-dark.webp',
          alt: 'A cut-paper diorama: one closed book on a reading stand, its spine banded in the four part colours, eight ribbon markers fanned from its pages.',
        }}
        activeId={activeId}
        onSelect={select}
        signals={signals}
        masthead={
          <div className="space-y-5">
            <div>
              <Eyebrow>The Harbor Library · {TEXTBOOK.edition.version}</Eyebrow>
              <h1 className="mt-2 max-w-[17ch] text-[clamp(30px,3.4vw,46px)] font-bold leading-[1.04] tracking-[-0.035em] text-[var(--text-primary)]">
                {TEXTBOOK.edition.title}
              </h1>
              <p className="deck-voice mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
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
          </div>
        }
      />
    </main>
  )
}
