import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { BadgeCheck, BookOpen, Compass, Download } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { NestingDiagram } from '@/components/library/NestingDiagram'
import { ReadingDag } from '@/components/library/ReadingDag'
import { SpineChain } from '@/components/library/SpineChain'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import {
  ChapterIndexRow,
  NestedLayerMap,
  ReadingOrderMap,
} from '@/components/site/LibraryMap'
import {
  LIBRARY_SPINE,
  WHITE_PAPERS,
  findWhitePaperByChapter,
  formatPaperSize,
  type WhitePaper,
} from '@/data/whitePapers'

/**
 * The Harbor Library — reader-first information architecture.
 *
 * The page's job is to get you reading a paper, fast, with the reading ORDER
 * and the LAYER structure made glanceable instead of buried in prose:
 *
 *   1. A compact orientation hero — the one-line spine + three persona doors +
 *      one primary CTA (open the reader). Not an essay.
 *   2. The reading-order DAG (ReadingOrderMap) above the fold — the map IS the
 *      navigation; every node opens that chapter in the reader.
 *   3. A first-class in-page reader: the selected chapter's PDF, large and
 *      central, with a persistent chapter rail to jump between chapters. The
 *      PDF is the page; the map and rail are how you move around it.
 *   4. A one-line-per-chapter index hanging off the map (recognition, not the
 *      old wall of dense cards).
 *   5. The nested-layer map (NestedLayerMap) as the second visual.
 *   6. The coordination-failure argument collapsed into a "why read this"
 *      <details>, and the references list into a footer <details>.
 */

/** The reading order, by chapter. Drives the reader rail and the index. */
const READING_ORDER_CHAPTERS = ['II', 'I', 'III', 'IV', 'V', 'VI', 'VII'] as const

/** Persona doors — three chips on the map, not prose cards. */
const PERSONA_DOORS: Array<{ label: string; chapters: string[]; hint: string }> = [
  { label: 'Evaluating fast', chapters: ['I', 'V'], hint: 'The wedge, then the proof it rests on.' },
  { label: 'The theory', chapters: ['IV', 'VI'], hint: 'The market, then its conservation law.' },
  { label: 'The proofs', chapters: ['V', 'VI', 'VII'], hint: 'ProVerif · Kani · TLA⁺.' },
]

/** References — the introduction's footnotes, disclosed in a footer details. */
const REFERENCES: Array<[string, string]> = [
  ['Hobbes', 'Thomas Hobbes, Leviathan (1651) — the “war of all against all” and rational consent to a common authority.'],
  ['Ostrom', 'Elinor Ostrom, Governing the Commons (1990); Nobel, 2009. Shared resources are governed by local institutions with clear rules and records. Cf. Hardin, “The Tragedy of the Commons” (Science, 1968).'],
  ['Scott', 'James C. Scott, Seeing Like a State (1998) — legibility as the instrument of governance, and the danger of flattening away mêtis.'],
  ['Parfit', 'Derek Parfit, Reasons and Persons (1984) — identity as psychological continuity rather than a fixed essence.'],
  ['Reputation', 'Elo (1960s) for chess; Bradley–Terry (1952) for paired comparisons; EigenTrust (Kamvar et al., 2003) for networked reputation. On bounded memory: Liu & Skrzypacz (2014).'],
  ['Mechanism design', 'Hurwicz, Maskin, Myerson — Nobel 2007 — rules whose honest outcome survives self-interested play. Myerson–Satterthwaite (1983): no bilateral-trade mechanism is simultaneously efficient, individually rational, and budget-balanced.'],
  ['Formal verification', 'Symbolic analysis and model checking — ProVerif/Tamarin (TLS 1.3, Signal), TLA⁺ (AWS; Newcombe et al., CACM 2015). Chapters V–VII use ProVerif and the Kani model checker.'],
]

/** A persona chip on the map. Selecting it opens its first chapter + scrolls. */
function PersonaChip({
  door,
  onOpen,
}: {
  door: (typeof PERSONA_DOORS)[number]
  onOpen: (chapter: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(door.chapters[0])}
      className="group grid gap-[var(--space-1)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] text-left transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
    >
      <span className="flex items-center gap-[var(--space-2)] font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] group-hover:text-current">
        {door.label}
        <span className="font-mono text-[length:var(--text-sm)] font-black tracking-normal text-[var(--brand-primary)] group-hover:text-current">
          → {door.chapters.join(' · ')}
        </span>
      </span>
      <span className="font-sans text-[length:var(--text-sm)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)] group-hover:text-current">
        {door.hint}
      </span>
    </button>
  )
}

/** The chapter rail inside the reader — a persistent strip to jump chapters. */
function ReaderRail({
  active,
  onOpen,
}: {
  active: string
  onOpen: (chapter: string) => void
}) {
  return (
    <nav aria-label="Jump to a chapter" className="grid gap-[var(--space-2)]">
      {READING_ORDER_CHAPTERS.map((chapter) => {
        const paper = findWhitePaperByChapter(chapter)
        if (!paper) return null
        const isActive = chapter === active
        const isProof = paper.group === 'prove'
        return (
          <button
            key={chapter}
            type="button"
            onClick={() => onOpen(chapter)}
            aria-current={isActive ? 'true' : undefined}
            className={[
              'group grid grid-cols-[auto_1fr] items-center gap-[var(--space-3)] border-2 px-[var(--space-3)] py-[var(--space-2)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]',
              isActive
                ? 'border-[var(--border-strong)] bg-[var(--text-primary)] text-[var(--text-inverse)]'
                : 'border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-primary)] hover:border-[var(--border-strong)]',
            ].join(' ')}
          >
            <span
              className={[
                'inline-grid h-[1.75rem] min-w-[1.75rem] place-items-center border-2 px-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] font-black leading-none',
                isProof
                  ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                  : 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
              ].join(' ')}
            >
              {chapter}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-[length:var(--text-base)] font-black leading-[var(--leading-nav)]">
                {paper.title}
              </span>
              <span
                className={[
                  'block truncate font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
                  isActive ? 'text-[color:var(--brand-primary-foreground-muted)]' : 'text-[var(--text-muted)]',
                ].join(' ')}
              >
                {paper.layer}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

/** The first-class reader: the chapter's PDF, large and central, + the rail. */
function InPageReader({
  paper,
  reref,
  onOpen,
}: {
  paper: WhitePaper
  onOpen: (chapter: string) => void
  reref: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={reref}
      className="grid scroll-mt-[var(--space-6)] gap-[var(--space-5)] lg:grid-cols-[minmax(17rem,0.3fr)_minmax(0,0.7fr)] lg:items-start"
    >
      {/* The persistent chapter rail. */}
      <aside className="order-last grid gap-[var(--space-4)] lg:order-first">
        <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
          <div className="mb-[var(--space-3)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
            <PanelEyebrow>The library</PanelEyebrow>
            <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
              07 chapters
            </span>
          </div>
          <ReaderRail active={paper.chapter} onOpen={onOpen} />
        </div>
      </aside>

      {/* The PDF — the dominant surface. */}
      <article className="order-first min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] lg:order-last">
        <header className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
          <div className="flex min-w-0 items-center gap-[var(--space-3)]">
            <span
              aria-hidden="true"
              className={[
                'inline-grid h-[2.5rem] min-w-[2.5rem] place-items-center border-2 border-[var(--border-strong)] font-mono text-[length:var(--text-xl)] font-black leading-none',
                paper.group === 'prove'
                  ? 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                  : 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
              ].join(' ')}
            >
              {paper.chapter}
            </span>
            <div className="min-w-0 space-y-[var(--space-1)]">
              <PanelEyebrow>
                {paper.group === 'prove' ? 'Proof chapter' : 'Explaining chapter'} · {paper.layer}
              </PanelEyebrow>
              <h2 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                {paper.title}
              </h2>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Link
              to={paper.readerHref}
              className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              <BookOpen aria-hidden="true" size={14} />
              Reader page
            </Link>
            <a
              href={paper.pdfPath}
              download
              className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              <Download aria-hidden="true" size={14} />
              {paper.pages} pp · {formatPaperSize(paper.sizeKb)}
            </a>
          </div>
        </header>
        <div className="h-[78vh] min-h-[34rem] bg-[var(--surface-sunken)]">
          {/* key forces the iframe to reload its src when the chapter changes. */}
          <iframe
            key={paper.id}
            src={`${paper.pdfPath}#toolbar=1&navpanes=0`}
            className="h-full w-full"
            title={`${paper.title} — inline PDF reader`}
          />
        </div>
      </article>
    </div>
  )
}

export default function LibraryPage() {
  const [activeChapter, setActiveChapter] = React.useState<string>('II')
  const readerRef = React.useRef<HTMLDivElement | null>(null)
  const activePaper = findWhitePaperByChapter(activeChapter) ?? WHITE_PAPERS[0]
  const totalPages = WHITE_PAPERS.reduce((sum, paper) => sum + paper.pages, 0)

  // Open a chapter in the reader and bring the reader into view. The scroll is
  // best-effort — if the ref isn't mounted yet, setting state is enough.
  const openChapter = React.useCallback((chapter: string) => {
    setActiveChapter(chapter)
    window.requestAnimationFrame(() => {
      readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Orientation hero: spine + persona doors + one CTA (not an essay) ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)]">
              <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.58fr)_minmax(0,0.42fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The Harbor Library — seven chapters, one map</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                    Read the harbor, then the economy it was for.
                  </PanelTitle>
                </div>
                <blockquote className="border-l-4 border-[var(--brand-primary)] pl-[var(--space-4)]">
                  <p className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                    {LIBRARY_SPINE}
                  </p>
                </blockquote>
              </div>

              {/* Persona doors as chips on the map. */}
              <div className="grid gap-[var(--space-3)] sm:grid-cols-3">
                {PERSONA_DOORS.map((door) => (
                  <PersonaChip key={door.label} door={door} onOpen={openChapter} />
                ))}
              </div>

              {/* One primary CTA + a stat strip. */}
              <div className="flex flex-wrap items-center gap-[var(--space-4)] border-t-2 border-[var(--border-strong)] pt-[var(--space-4)]">
                <button
                  type="button"
                  onClick={() => openChapter('II')}
                  className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <Compass aria-hidden="true" size={15} />
                  Open the reader
                </button>
                <div className="flex flex-wrap items-center gap-x-[var(--space-5)] gap-y-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  <span>04 explain · 03 prove</span>
                  <span>{totalPages} pages, free PDFs</span>
                  <span>ProVerif · Kani · TLA⁺</span>
                </div>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── The reading-order DAG — the map above the fold ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>The reading order</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                  Where to start, and what holds it up.
                </PanelTitle>
                <PanelBody className="max-w-[40ch] text-[length:var(--type-panel-body-compact-size)]">
                  Follow the cobalt spine left to right — the four chapters that explain the system, machine up
                  to market. The dashed lines are the three proofs, each landing on the seam it discharges.
                  Click any chapter to open it below.
                </PanelBody>
              </div>
              <ReadingOrderMap onSelect={openChapter} />
            </div>
          </PageContainer>
        </section>

        {/* ── The first-class reader ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="mb-[var(--space-5)] flex flex-wrap items-end justify-between gap-[var(--space-3)]">
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>Now reading</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                  The chapter, open and central.
                </PanelTitle>
              </div>
              <PanelBody className="max-w-[40ch] text-[length:var(--type-panel-body-compact-size)]">
                The PDF is the page. Use the rail or the map above to move between chapters — the reader stays
                put.
              </PanelBody>
            </div>
            <InPageReader paper={activePaper} onOpen={openChapter} reref={readerRef} />
          </PageContainer>
        </section>

        {/* ── One-line-per-chapter index, hanging off the map ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Every chapter, one line</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  The whole index, at a glance.
                </PanelTitle>
                <PanelBody className="max-w-[40ch] text-[length:var(--type-panel-body-compact-size)]">
                  Chapter, title, layer, and how mature its claims are — built, partial, specified, proposed, or
                  the verifier it was mechanized in. Open it in the reader or grab the PDF.
                </PanelBody>
              </div>
              <div className="grid gap-[var(--space-3)]">
                {READING_ORDER_CHAPTERS.map((chapter) => {
                  const paper = findWhitePaperByChapter(chapter)
                  if (!paper) return null
                  return (
                    <ChapterIndexRow
                      key={paper.id}
                      paper={paper}
                      onOpen={openChapter}
                      active={chapter === activeChapter}
                    />
                  )
                })}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Nested-layer map — the second visual ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>The stack, nested</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                  Each layer reads truth from the one inside it.
                </PanelTitle>
                <PanelBody className="max-w-[40ch] text-[length:var(--type-panel-body-compact-size)]">
                  The kernel decides what is true at the centre. Legibility wraps it, the identity bridge wraps
                  that, and the market sits outermost — none of it stands without the layer within.
                </PanelBody>
              </div>
              <NestedLayerMap onSelect={openChapter} />
            </div>
          </PageContainer>
        </section>

        {/* ── ADR-0048 figures — the architecture, drawn (PR #312) ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow>The architecture, drawn</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                Four layers, seven chapters, one bond ledger.
              </PanelTitle>
              <PanelBody className="max-w-[52ch] text-[length:var(--type-panel-body-size)]">
                The same shape from four angles — the nested layers (L0&ndash;L3), the spine that threads the
                seven chapters, the reading order as a dependency graph, and Chapter IV&rsquo;s three-sided market
                settling into one conserving bond ledger.
              </PanelBody>
            </div>
            <div className="mt-[var(--space-5)] grid gap-[var(--space-6)]">
              <NestingDiagram />
              <SpineChain />
              <ReadingDag />
              <ThreeSidedMarket />
            </div>
          </PageContainer>
        </section>

        {/* ── Why read this — the argument, collapsed ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Why read this</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                  Ten agents made you less sure, not more.
                </PanelTitle>
                <PanelBody className="max-w-[52ch] text-[length:var(--type-panel-body-size)]">
                  Two agents edit the same file and the second erases the first; one &ldquo;fixes&rdquo; the
                  tests by deleting them. That is a{' '}
                  <em className="not-italic font-black text-[var(--text-primary)]">coordination</em> failure —
                  it lives between agents, where no one keeps the record. These chapters build the institution
                  that does.
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-4)]">
                <details className="group border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <summary className="flex cursor-pointer items-center justify-between gap-[var(--space-3)] p-[var(--space-4)] font-sans text-[length:var(--type-panel-body-compact-size)] font-black text-[var(--text-primary)] marker:content-none [&::-webkit-details-marker]:hidden">
                    The full argument, in one paragraph
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] transition-transform group-open:rotate-90">
                      ▸
                    </span>
                  </summary>
                  <div className="border-t-2 border-[var(--border-default)] p-[var(--space-4)]">
                    <PanelBody className="max-w-[60ch] text-[length:var(--type-panel-body-size)]">
                      You can hand a goal to a program and walk away. One coding agent is useful; ten, on a real
                      codebase, make you less sure. That is not a bug in any one agent — it is a coordination
                      failure in the space between them. The cure is a single-writer kernel that decides what is
                      true (II), legibility so an operator can see the swarm as one picture (I), continuity that
                      turns a spawn into a person with a track record (III), and — once reputation is real — a
                      market between operators (IV). The load-bearing seams are then discharged with
                      machine-checked mathematics: the Anchor Protocol (V), the Bonded Commons (VI), and the
                      Federated Harbor (VII). The harbor runs today; the economy is the thing it was always for.
                    </PanelBody>
                  </div>
                </details>

                <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] p-[var(--space-5)]">
                  <PanelEyebrow className="mb-[var(--space-3)]">Open the harbor — you need none of the theory</PanelEyebrow>
                  <pre className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] font-mono text-[length:var(--text-base)] leading-[var(--leading-code)] text-[var(--text-primary)]">
                    <code>brew install curiositech/tap/port-daddy &amp;&amp; pd setup</code>
                  </pre>
                  <PanelBody className="mt-[var(--space-3)] max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    One command, and two agents that used to collide take turns instead.
                  </PanelBody>
                </div>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── References — the introduction's footnotes, disclosed ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-6)]">
          <PageContainer width="wide">
            <details className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-[var(--space-3)] font-sans text-[length:var(--type-panel-body-compact-size)] font-black text-[var(--text-primary)] marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-[var(--space-2)]">
                  <BadgeCheck aria-hidden="true" size={16} className="text-[var(--brand-primary)]" />
                  References &amp; intellectual lineage
                </span>
                <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] transition-transform group-open:rotate-90">
                  ▸
                </span>
              </summary>
              <ol className="mt-[var(--space-4)] grid gap-[var(--space-3)] lg:grid-cols-2">
                {REFERENCES.map(([term, body]) => (
                  <li
                    key={term}
                    className="grid grid-cols-[auto_1fr] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]"
                  >
                    <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {term}
                    </span>
                    <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {body}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
