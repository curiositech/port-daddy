import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Compass, FileText, FlaskConical } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { NestingDiagram } from '@/components/library/NestingDiagram'
import { ReadingDag } from '@/components/library/ReadingDag'
import { SpineChain } from '@/components/library/SpineChain'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import {
  COLLECTED_VOLUME,
  EXPLAIN_PAPERS,
  LIBRARY_CHANGELOG,
  LIBRARY_SPINE,
  PROVE_PAPERS,
  READING_PATHS,
  findWhitePaperByChapter,
  type WhitePaper,
} from '@/data/whitePapers'
import { harborEvolutionFigure } from '@/data/manifestoContent'
import { ThemedImage } from '@/components/site/ThemedImage'
import { RESEARCH_PAPERS, RESEARCH_PAPER_TOTAL_PAGES } from '@/data/researchPapers'

/**
 * The cross-reference relationships, in the order they read on a chapter card.
 * Each maps a `crossRefs` key to its human label, the direction arrow, and the
 * verb that makes the sentence read as one book.
 */
const CROSS_REF_KINDS = [
  { key: 'assumes', label: 'Assumes', Icon: ArrowDownRight },
  { key: 'underwrites', label: 'Underwrites', Icon: ArrowUpRight },
  { key: 'provedBy', label: 'Proved by', Icon: BadgeCheck },
  { key: 'proves', label: 'Proves', Icon: BadgeCheck },
] as const

function chapterTitle(chapter: string): string {
  return findWhitePaperByChapter(chapter)?.title ?? chapter
}

function CrossRefRow({
  label,
  Icon,
  edges,
}: {
  label: string
  Icon: typeof ArrowRight
  edges: Array<{ chapter: string; why: string }>
}) {
  return (
    <div className="grid grid-cols-[auto,1fr] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0">
      <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
        <Icon aria-hidden="true" size={14} className="text-[var(--brand-primary)]" />
        {label}
      </span>
      <ul className="grid gap-[var(--space-2)]">
        {edges.map((edge) => (
          <li key={`${label}-${edge.chapter}`} className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            <Link
              to={`/whitepaper/${findWhitePaperByChapter(edge.chapter)?.slug ?? ''}`}
              className="font-black text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
            >
              {edge.chapter} · {chapterTitle(edge.chapter)}
            </Link>{' '}
            — {edge.why}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChapterCard({ paper }: { paper: WhitePaper }) {
  const refRows = CROSS_REF_KINDS.map((kind) => {
    const edges = paper.crossRefs[kind.key]
    if (!edges || edges.length === 0) return null
    return <CrossRefRow key={kind.key} label={kind.label} Icon={kind.Icon} edges={edges} />
  }).filter(Boolean)

  return (
    <article
      id={`chapter-${paper.chapter}`}
      className="grid min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]"
    >
      <header className="grid grid-cols-[auto,1fr] items-start gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-5)]">
        <span
          aria-hidden="true"
          className="grid h-[3.5rem] w-[3.5rem] place-items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--brand-primary-foreground)]"
        >
          {paper.chapter}
        </span>
        <div className="min-w-0 space-y-[var(--space-2)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <BracketLabel>{paper.group === 'prove' ? 'Proves' : 'Explains'}</BracketLabel>
            <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {paper.layer}
            </span>
          </div>
          <PanelTitle as="h3" size="card" className="max-w-[20ch]">
            {paper.title}
          </PanelTitle>
        </div>
      </header>

      <div className="grid gap-[var(--space-4)] p-[var(--space-5)]">
        <PanelBody className="max-w-none text-[length:var(--type-panel-body-size)]">{paper.claim}</PanelBody>

        <div className="flex flex-wrap items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
          <BadgeCheck aria-hidden="true" size={14} className="text-[var(--brand-primary)]" />
          {paper.maturity}
        </div>

        {refRows.length > 0 ? (
          <div className="grid gap-[var(--space-3)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-4)]">
            {refRows}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-[var(--space-2)] pt-[var(--space-1)]">
          <Link
            to={paper.readerHref}
            className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
          >
            Read the chapter
            <ArrowRight aria-hidden="true" size={14} />
          </Link>
          <a
            href={paper.pdfPath}
            className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
          >
            <FileText aria-hidden="true" size={14} />
            PDF · {paper.pages} pp
          </a>
        </div>
      </div>
    </article>
  )
}

function GroupHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: React.ReactNode
}) {
  return (
    <div className="space-y-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-5)]">
      <PanelEyebrow>{eyebrow}</PanelEyebrow>
      <PanelTitle as="h2" size="section" className="max-w-[18ch]">
        {title}
      </PanelTitle>
      <PanelBody className="max-w-[64ch] text-[length:var(--text-lg)]">{description}</PanelBody>
    </div>
  )
}

export default function LibraryPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Hero: the harbor, the seven plates, the spine ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.92fr)_minmax(20rem,0.5fr)] lg:items-start">
              <div className="space-y-[var(--space-5)]">
                <PanelEyebrow>The Harbor Library — read it as one book</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[15ch]">
                  Seven chapters. Four explain the system. Three prove it.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[62ch] text-[length:var(--text-lg)]">
                  You can now hand a goal to a program and walk away. One coding
                  agent is useful; ten, on a real codebase, make you less sure,
                  not more — two edit the same file and the second erases the
                  first; one &ldquo;fixes&rdquo; the tests by deleting them. That
                  is not a bug in any one agent. It is a{' '}
                  <em className="not-italic font-black text-[var(--text-primary)]">coordination</em>{' '}
                  failure, and it lives in the space between agents, where no one
                  keeps the record. These seven chapters build the institution
                  that does — and then follow it all the way to its surprising
                  conclusion: an economy.
                </PanelBody>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: '04', label: 'chapters explain' },
                    { value: '03', label: 'chapters prove' },
                    { value: String(COLLECTED_VOLUME.pages), label: 'pages, collected PDF' },
                  ].map((stat) => (
                    <div key={stat.label} className="space-y-[var(--space-1)]">
                      <div className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--text-primary)]">
                        {stat.value}
                      </div>
                      <div className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                <a
                  href={COLLECTED_VOLUME.pdfPath}
                  download
                  className="group grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] p-[var(--space-5)] text-[var(--brand-primary-foreground)] shadow-[var(--shadow-brutal)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:grid-cols-[auto_1fr_auto] sm:items-center"
                >
                  <span className="grid h-12 w-12 place-items-center border-2 border-current">
                    <FileText aria-hidden="true" size={24} />
                  </span>
                  <span className="grid gap-[var(--space-1)]">
                    <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                      Download the collected volume
                    </span>
                    <span className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)]">
                      {COLLECTED_VOLUME.title}
                    </span>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">
                      {COLLECTED_VOLUME.pages} pages · {COLLECTED_VOLUME.references} collated references · PDF
                    </span>
                  </span>
                  <ArrowDownRight
                    aria-hidden="true"
                    size={24}
                    className="transition-transform group-hover:translate-x-1 group-hover:translate-y-1"
                  />
                </a>

                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <a
                    href="#the-climb"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Compass aria-hidden="true" size={15} />
                    Climb the stack
                  </a>
                  <Link
                    to="/whitepaper"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    Read the PDFs
                    <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                </div>
              </div>

              <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-brutal)]">
                <ThemedImage
                  src="/img/manifesto/seven-papers.webp"
                  alt="A drafting wall pinned with seven blueprint plates: a back row of three stamped with wax seals labelled “three prove,” and a front row of four tugboat schematics labelled “four explain,” with a small robot studying them."
                  className="block aspect-[16/9] w-full object-cover"
                  loading="eager"
                />
                <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  Four plates explain the harbor; three, wax-sealed, prove it. The
                  same wall, drawn once — and the argument this page walks you
                  through.
                </figcaption>
              </figure>
            </div>
          </PageContainer>
        </section>

        {/* ── A second, distinct collection: seven research papers, named ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--story-indigo)] py-[var(--space-7)] text-[var(--story-indigo-foreground)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-3)] sm:grid-cols-[auto,1fr] sm:items-start">
                <span className="grid h-14 w-14 place-items-center border-2 border-current">
                  <FlaskConical aria-hidden="true" size={28} />
                </span>
                <div className="space-y-[var(--space-2)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                    Not the seven chapters above — a second, separate collection
                  </span>
                  <h2 className="max-w-[40ch] font-display text-[length:var(--text-3xl)] font-black leading-[var(--leading-display-tight)] !text-[var(--story-indigo-foreground)]">
                    Seven new research papers. Each one proves a theorem the chapters only argue in prose.
                  </h2>
                  <p className="max-w-[68ch] text-[length:var(--text-lg)] leading-[var(--leading-body)]">
                    Closed-form bit floors, an NP-completeness frontier, a sheaf-cohomology
                    detector with a certified lower bound — {RESEARCH_PAPERS.length} arXiv-style
                    papers, {RESEARCH_PAPER_TOTAL_PAGES} pages total, adversarially reviewed,
                    discharging results R1 through R17.
                  </p>
                </div>
              </div>

              <div className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
                {RESEARCH_PAPERS.map((paper) => (
                  <Link
                    key={paper.id}
                    to={`/library/research#paper-${paper.number}`}
                    className="group grid gap-[var(--space-2)] border-2 border-current bg-[var(--story-indigo)] p-[var(--space-4)] transition-colors hover:bg-[var(--story-indigo-foreground)] hover:text-[var(--story-indigo)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <span className="flex items-center gap-[var(--space-2)]">
                      <span className="grid h-7 w-7 shrink-0 place-items-center border-2 border-current font-mono text-[length:var(--text-sm)] font-black leading-none">
                        {paper.number}
                      </span>
                      <span className="font-display text-[length:var(--text-base)] font-black leading-[var(--leading-nav)]">
                        {paper.title}
                      </span>
                    </span>
                    <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]">
                      {paper.claim}
                    </span>
                  </Link>
                ))}
              </div>

              <Link
                to="/library/research"
                className="group inline-flex w-fit items-center gap-[var(--space-2)] border-2 border-current bg-[var(--story-indigo-foreground)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--story-indigo)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                Read the full research library
                <ArrowRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </PageContainer>
        </section>

        {/* ── The spine sentence ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] lg:items-start">
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>The spine</PanelEyebrow>
                <PanelBody className="max-w-[34ch] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  One sentence holds the whole library together. Pull out any link
                  and the chain above it falls — which is why the harbor comes
                  before the economy, and why memory, not cryptography, is the
                  foundation of the whole thing.
                </PanelBody>
              </div>
              <blockquote className="border-l-4 border-[var(--brand-primary)] pl-[var(--space-5)]">
                <p className="font-display text-[length:var(--text-2xl)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]">
                  {LIBRARY_SPINE}
                </p>
              </blockquote>
            </div>
          </PageContainer>
        </section>

        {/* ── The climb: explain (I–IV) then prove (V–VII) ── */}
        <section id="the-climb" className="scroll-mt-[var(--space-8)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-7)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The L0 → L3 climb</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    From the machine, up to the market.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  The library climbs a four-layer stack — from the kernel that
                  decides what is true, through the legibility an operator pays
                  for and the bridge that turns a spawn into a person, up to the
                  market between operators — and then proves the load-bearing
                  parts with machine-checked mathematics. Each card names what it{' '}
                  <strong className="font-black text-[var(--text-primary)]">assumes</strong>{' '}
                  from below, what it{' '}
                  <strong className="font-black text-[var(--text-primary)]">underwrites</strong>{' '}
                  above, and which chapter{' '}
                  <strong className="font-black text-[var(--text-primary)]">proves</strong>{' '}
                  it.
                </PanelBody>
              </div>

              {/* The arc the stack climbs, drawn once: one process → one machine
                  → many machines. The three stages are re-stated in words so the
                  figure does not have to be decoded from the numerals alone. */}
              <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-brutal)]">
                <ThemedImage
                  src={harborEvolutionFigure.src}
                  alt={harborEvolutionFigure.alt}
                  className="block w-full border-b-2 border-[var(--border-strong)] object-cover"
                  loading="lazy"
                />
                <div className="grid gap-px border-b-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3">
                  {harborEvolutionFigure.stages.map((stage) => (
                    <div key={stage.numeral} className="space-y-[var(--space-2)] bg-[var(--surface-base)] p-[var(--space-4)]">
                      <div className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--brand-primary)]">
                        {stage.numeral}
                      </div>
                      <PanelBody className="max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                        {stage.label}
                      </PanelBody>
                    </div>
                  ))}
                </div>
                <figcaption className="p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {harborEvolutionFigure.caption}
                </figcaption>
              </figure>

              {/* The four that explain */}
              <div className="space-y-[var(--space-5)]">
                <GroupHeading
                  eyebrow="Chapters I–IV"
                  title="The four that explain"
                  description="Self-contained and pedagogic, climbing one ladder. Read them in order to be convinced; stop after the first and you still have a useful mental model."
                />
                <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                  {EXPLAIN_PAPERS.map((paper) => (
                    <ChapterCard key={paper.id} paper={paper} />
                  ))}
                </div>
              </div>

              {/* The three that prove */}
              <div className="space-y-[var(--space-5)]">
                <GroupHeading
                  eyebrow="Chapters V–VII"
                  title="The three that prove"
                  description="Not appendices — chapters, where the prose stops and the proof-checkers start. Each discharges a promise the explaining chapters make, mechanized in ProVerif, Kani, and TLA⁺."
                />
                <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                  {PROVE_PAPERS.map((paper) => (
                    <ChapterCard key={paper.id} paper={paper} />
                  ))}
                </div>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── ADR-0048 figures — the architecture, drawn ── */}
        <section
          id="the-architecture-drawn"
          className="scroll-mt-[var(--space-8)] border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow>The architecture, drawn</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                Four layers, seven chapters, one bond ledger.
              </PanelTitle>
              <PanelBody className="max-w-[52ch] text-[length:var(--type-panel-body-size)]">
                The same shape from four angles &mdash; the nested layers
                (L0&ndash;L3), the spine that threads the seven chapters, the
                reading order as a dependency graph, and Chapter IV&rsquo;s
                three-sided market settling onto one conserving bond ledger.
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

        {/* ── Reading paths ── */}
        <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.34fr)_minmax(0,0.66fr)]">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>How to read it</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  Different doors into the same book.
                </PanelTitle>
                <PanelBody className="max-w-[44ch] text-[length:var(--text-lg)]">
                  This is the map. You can enter any chapter from here, and every
                  chapter tells you which others it leans on. Pick the door that
                  matches who you are talking to.
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-4)]">
                {READING_PATHS.map((path) => (
                  <div
                    key={path.label}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]"
                  >
                    <p className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                      {path.label}
                    </p>
                    <p className="text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                      {path.body}
                    </p>
                    <div className="flex flex-wrap gap-[var(--space-2)] pt-[var(--space-1)]">
                      {path.chapters.map((chapter) => {
                        const target = findWhitePaperByChapter(chapter)
                        if (!target) return null
                        return (
                          <Link
                            key={chapter}
                            to={`#chapter-${chapter}`}
                            className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                          >
                            {chapter} · {target.title}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Honest-status note + install ── */}
        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Working software vs. finished argument</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                  Honest about the seam between them.
                </PanelTitle>
                <PanelBody className="max-w-[58ch] text-[length:var(--text-lg)]">
                  Each chapter labels its claims by maturity — built, partial,
                  specified, proposed — so you always know whether you are reading
                  about something that runs today or something we have only proven
                  should. The harbor runs now. The economy is the thing it was
                  always for.
                </PanelBody>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] p-[var(--space-5)] shadow-[var(--shadow-brutal)]">
                <PanelEyebrow className="mb-[var(--space-3)]">Open the harbor</PanelEyebrow>
                <pre className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] font-mono text-[length:var(--text-base)] leading-[var(--leading-code)] text-[var(--text-primary)]">
                  <code>brew install curiositech/tap/port-daddy &amp;&amp; pd setup</code>
                </pre>
                <PanelBody className="mt-[var(--space-3)] max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  You need none of the theory for the first benefit. One command,
                  and two agents that used to collide take turns instead.
                </PanelBody>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Library changelog: dated release waves, newest first ── */}
        <section
          id="library-changelog"
          className="scroll-mt-[var(--space-8)] border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.34fr)_minmax(0,0.66fr)]">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Library changelog</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  What changed, and when.
                </PanelTitle>
                <PanelBody className="max-w-[44ch] text-[length:var(--text-lg)]">
                  These chapters are living documents: they get argued with, proven
                  against, and revised in the open. One entry per release wave,
                  newest first. For the per-objection history of the adversarial
                  reviews, see{' '}
                  <Link
                    to="/whitepaper/rounds"
                    className="font-black text-[var(--brand-primary)] underline underline-offset-4 hover:no-underline"
                  >
                    the review rounds
                  </Link>
                  .
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-4)]">
                {LIBRARY_CHANGELOG.map((entry) => (
                  <article
                    key={`${entry.date}-${entry.title}`}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                      <time
                        dateTime={entry.dateIso}
                        className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]"
                      >
                        {entry.date}
                      </time>
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {entry.chapters.join(' · ')}
                      </span>
                    </div>
                    <h3 className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                      {entry.title}
                    </h3>
                    <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {entry.summary}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── References (the introduction's footnotes) ── */}
        <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <PanelEyebrow className="mb-[var(--space-4)]">References &amp; intellectual lineage</PanelEyebrow>
            <ol className="grid gap-[var(--space-3)] lg:grid-cols-2">
              {[
                ['Hobbes', 'Thomas Hobbes, Leviathan (1651) — the “war of all against all” and rational consent to a common authority.'],
                ['Ostrom', 'Elinor Ostrom, Governing the Commons (1990); Nobel, 2009. Shared resources are governed by local institutions with clear rules and records. Cf. Hardin, “The Tragedy of the Commons” (Science, 1968).'],
                ['Scott', 'James C. Scott, Seeing Like a State (1998) — legibility as the instrument of governance, and the danger of flattening away mêtis.'],
                ['Parfit', 'Derek Parfit, Reasons and Persons (1984) — identity as psychological continuity rather than a fixed essence.'],
                ['Reputation', 'Elo (1960s) for chess; Bradley–Terry (1952) for paired comparisons; EigenTrust (Kamvar et al., 2003) for networked reputation. On bounded memory: Liu & Skrzypacz (2014).'],
                ['Mechanism design', 'Hurwicz, Maskin, Myerson — Nobel 2007 — rules whose honest outcome survives self-interested play. Myerson–Satterthwaite (1983): no bilateral-trade mechanism is simultaneously efficient, individually rational, and budget-balanced.'],
                ['Formal verification', 'Symbolic analysis and model checking — ProVerif/Tamarin (TLS 1.3, Signal), TLA⁺ (AWS; Newcombe et al., CACM 2015). Chapters V–VII use ProVerif and the Kani model checker.'],
              ].map(([term, body]) => (
                <li key={term} className="grid grid-cols-[auto,1fr] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    {term}
                  </span>
                  <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    {body}
                  </span>
                </li>
              ))}
            </ol>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
