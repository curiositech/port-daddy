import * as React from 'react'
import { motion } from 'framer-motion'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowRight, BookOpen, Cpu, Download, FileText, Layers } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { TableOfContents } from '@/components/library/TableOfContents'
import {
  chapterRoleLabel,
  findWhitePaperById,
  LIBRARY_CHANGELOG,
  paperPdfUrl,
  WHITE_PAPERS,
} from '@/data/whitePapers'

function normalizePaperId(paperId: string | null): string {
  if (!paperId) {
    return WHITE_PAPERS[0].id
  }

  return findWhitePaperById(paperId)?.id ?? WHITE_PAPERS[0].id
}

export default function WhitepaperPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedPaperId = normalizePaperId(searchParams.get('paper'))
  const [activePaper, setActivePaper] = React.useState<string>(selectedPaperId)
  const [isLoading, setIsLoading] = React.useState(true)

  const paper = findWhitePaperById(activePaper) ?? WHITE_PAPERS[0]
  const totalPages = WHITE_PAPERS.reduce((sum, candidate) => sum + candidate.pages, 0)

  React.useEffect(() => {
    if (activePaper !== selectedPaperId) {
      setActivePaper(selectedPaperId)
      setIsLoading(true)
    }
  }, [activePaper, selectedPaperId])

  const selectPaper = React.useCallback((paperId: string) => {
    setActivePaper(paperId)
    setIsLoading(true)

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('paper', paperId)
    setSearchParams(nextSearchParams)
  }, [searchParams, setSearchParams])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.88fr)_minmax(22rem,0.42fr)] lg:items-start">
              <div className="space-y-[var(--space-6)]">
                <PanelEyebrow>Seven chapters, one book, in the order the argument needs</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                  The Harbor Library: how a swarm of agents becomes a market you can trust.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Seven chapters of one book, numbered in the order the argument
                  needs: each stands on the ones before it, and each{' '}
                  <strong className="font-black text-[var(--text-primary)]">proving</strong>{' '}
                  chapter follows the chapter whose promises it keeps. Four parts
                  carry the climb: the machine that decides what is real, the
                  operator who has to see it, the person a spawn becomes, and the
                  market that rents trust between strangers. Each chapter names
                  what it assumes, what it underwrites, and which chapter{' '}
                  <strong className="font-black text-[var(--text-primary)]">proves</strong>{' '}
                  it, so the seven read as one book,
                  not a pile. New here?{' '}
                  <Link to="/library" className="font-black text-[var(--brand-primary)] underline underline-offset-4 hover:no-underline">
                    Start with the guided Library
                  </Link>
                  .
                </PanelBody>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: String(WHITE_PAPERS.length).padStart(2, '0'), label: 'chapters, in order' },
                    { value: String(totalPages).padStart(2, '0'), label: 'pages, total' },
                    { value: 'Free', label: 'PDFs, no signup' },
                  ].map((stat) => (
                    <div key={stat.label} className="space-y-[var(--space-1)]">
                      <div className="font-mono text-[length:var(--text-xl)] font-black leading-none text-[var(--text-primary)]">
                        {stat.value}
                      </div>
                      <div className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="max-w-[60ch] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  by <strong className="font-black text-[var(--text-primary)]">Erich Owens</strong> (Curiositech LLC).
                  Each paper opens with a short, plain-language primer.
                  If you have never thought about cryptographic identity
                  or shared-resource governance before, no problem — the
                  primers assume you have not, and the page that wraps
                  the PDF defines every technical term as it shows up.
                  Bring whatever you bring.
                </p>

                <div className="grid max-w-[60ch] gap-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-3">
                  <Link
                    to="/whitepaper/rounds"
                    className="group inline-flex items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <BookOpen aria-hidden="true" size={18} className="mt-[var(--space-1)] shrink-0 text-[var(--brand-primary)]" />
                    <span className="space-y-[var(--space-1)] min-w-0">
                      <span className="block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                        Read the review history →
                      </span>
                      <span className="block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        Both papers spent five months getting argued with by two
                        AI review teams — one playing attacker, one playing defender,
                        neither allowed to read the other&apos;s notes. Every objection
                        that landed, every fix, every still-open gap is on the record.
                      </span>
                    </span>
                  </Link>
                  <Link
                    to="/landscape"
                    className="group inline-flex items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Layers aria-hidden="true" size={18} className="mt-[var(--space-1)] shrink-0 text-[var(--brand-primary)]" />
                    <span className="space-y-[var(--space-1)] min-w-0">
                      <span className="block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                        Where Port Daddy fits — multi-agent landscape →
                      </span>
                      <span className="block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        Cursor 2.0, Claude Code Task, ccswarm, Jury-rig — and where the
                        coordination layer underneath all of them goes. With a
                        sixty-second walkthrough of two agents on one repo.
                      </span>
                    </span>
                  </Link>
                  <Link
                    to="/whitepaper/how-we-prove-game-theory"
                    className="group inline-flex items-start gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Cpu aria-hidden="true" size={18} className="mt-[var(--space-1)] shrink-0 text-[var(--brand-primary)]" />
                    <span className="space-y-[var(--space-1)] min-w-0">
                      <span className="block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                        How we use — and prove — game theory →
                      </span>
                      <span className="block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                        For the reader who took political game theory once
                        in college and never saw the computational side. Aumann,
                        Schelling, TLA+, Z3, and a hundred-millisecond proof
                        you can run yourself.
                      </span>
                    </span>
                  </Link>
                </div>
              </div>

              <aside className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <figure className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                  <picture>
                    <source srcSet="/img/generated/control-plane-og.webp" type="image/webp" />
                    <img
                      src="/img/generated/control-plane-og.jpg"
                      alt="Generated Swiss-modern control-plane diagram with agent nodes, lock checkpoints, and a recovery ledger path"
                      className="block aspect-[16/9] w-full object-cover"
                    />
                  </picture>
                </figure>
                <div className="border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
                  <PanelEyebrow>Available papers</PanelEyebrow>
                </div>
                <div className="grid">
                  {WHITE_PAPERS.map((candidate) => {
                    const selected = candidate.id === paper.id
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        aria-pressed={selected}
                        aria-controls="active-whitepaper-panel"
                        onClick={() => {
                          selectPaper(candidate.id)
                        }}
                        className={[
                          'group grid grid-cols-[2.75rem,1fr] gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] last:border-b-0',
                          selected
                            ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                            : 'bg-[var(--surface-base)] text-[var(--text-primary)] hover:bg-[var(--surface-strong)]',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'font-mono text-[length:var(--text-xl)] font-black leading-none',
                            selected ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--brand-primary)]',
                          ].join(' ')}
                        >
                          {candidate.chapter}
                        </span>
                        <span className="min-w-0 space-y-[var(--space-2)]">
                          <span
                            className={[
                              'block font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]',
                              selected ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]',
                            ].join(' ')}
                          >
                            {candidate.title}
                          </span>
                          <span
                            className={[
                              'block text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]',
                              selected ? 'text-[color:var(--brand-primary-foreground-muted)]' : 'text-[var(--text-secondary)]',
                            ].join(' ')}
                          >
                            {candidate.subtitle}
                          </span>
                          <span
                            className={[
                              'block font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                              selected ? 'text-[color:var(--brand-primary-foreground-subtle)]' : 'text-[var(--text-muted)]',
                            ].join(' ')}
                          >
                            {chapterRoleLabel(candidate)} / {candidate.layer} / {candidate.pages} pages
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.66fr)_minmax(20rem,0.34fr)]">
              <article id="active-whitepaper-panel" className="min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                <header className="grid gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-5)] lg:grid-cols-[1fr_auto] lg:items-end">
                  <div className="space-y-[var(--space-3)]">
                    <BracketLabel>{paper.status}</BracketLabel>
                    <div className="space-y-[var(--space-2)]">
                      <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                        {paper.title}
                      </PanelTitle>
                      <PanelBody className="max-w-[48rem]">{paper.thesis}</PanelBody>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-[var(--space-2)]">
                    <Link
                      to={paper.readerHref}
                      className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                    >
                      Read guide
                      <ArrowRight aria-hidden="true" size={14} />
                    </Link>
                    <a
                      href={paperPdfUrl(paper)}
                      className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                      download
                    >
                      <Download aria-hidden="true" size={14} />
                      Download
                    </a>
                    <a
                      href={paperPdfUrl(paper)}
                      className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                    >
                      <FileText aria-hidden="true" size={14} />
                      Open PDF
                    </a>
                  </div>
                </header>

                <div className="relative aspect-[1/1.34] min-h-[34rem] bg-[var(--surface-sunken)]">
                  {isLoading ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--surface-sunken)]">
                      <div className="grid gap-[var(--space-3)] text-center">
                        <div
                          className="mx-auto h-[var(--space-7)] w-[var(--space-7)] animate-spin border-2 border-[var(--border-default)] border-t-[color:var(--brand-primary)]"
                          aria-hidden="true"
                        />
                        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                          Loading paper
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <iframe
                    key={paper.id}
                    src={`${paperPdfUrl(paper)}#toolbar=1&navpanes=0`}
                    className="h-full w-full"
                    onLoad={() => setIsLoading(false)}
                    title={`${paper.title} PDF`}
                  />
                </div>
              </article>

              <aside className="grid content-start gap-[var(--space-4)]">
                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                  <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                    <PanelEyebrow>Argument map</PanelEyebrow>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.order}/{WHITE_PAPERS.length.toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="grid gap-[var(--space-4)]">
                    {paper.sections.map((section, index) => (
                      <div key={`${paper.id}-${section.title}`} className="grid grid-cols-[2rem,1fr] gap-[var(--space-3)]">
                        <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="space-y-[var(--space-1)]">
                          <h3 className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                            {section.title}
                          </h3>
                          <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                            {section.content}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <PanelEyebrow className="mb-[var(--space-4)]">Verification signals</PanelEyebrow>
                  <div className="grid gap-[var(--space-3)]">
                    {paper.highlights.map((highlight) => (
                      <div
                        key={highlight.label}
                        className="flex items-center gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0"
                      >
                        <highlight.icon aria-hidden="true" className="h-[var(--space-4)] w-[var(--space-4)] shrink-0 text-[var(--brand-primary)]" />
                        <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                          {highlight.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>
            </div>
          </PageContainer>
        </section>

        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
              <div className="space-y-[var(--space-4)]">
                <PanelEyebrow>Table of contents</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  Read it in order. The order is the argument.
                </PanelTitle>
                <PanelBody className="max-w-[44ch]">
                  Each chapter stands on the ones before it, and each proving
                  chapter follows the chapter whose promises it keeps, so the
                  table of contents is the only reading order you need. Pick a
                  chapter here to open it above. The{' '}
                  <Link to="/library" className="font-black text-[var(--brand-primary)] underline underline-offset-4 hover:no-underline">
                    Library guide
                  </Link>{' '}
                  lays out every cross-reference.
                </PanelBody>
              </div>

              <TableOfContents onSelect={selectPaper} />
            </div>
          </PageContainer>
        </section>

        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
              <div className="space-y-[var(--space-4)]">
                <PanelEyebrow>Library changelog</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  What changed, and when.
                </PanelTitle>
                <PanelBody className="max-w-[44ch]">
                  These papers are living documents: they get argued with, proven
                  against, and revised in the open. One entry per release wave,
                  newest first. For the per-objection history of the adversarial
                  reviews, see{' '}
                  <Link to="/whitepaper/rounds" className="font-black text-[var(--brand-primary)] underline underline-offset-4 hover:no-underline">
                    the review rounds
                  </Link>
                  .
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-3)]">
                {LIBRARY_CHANGELOG.map((entry) => (
                  <article
                    key={`${entry.date}-${entry.title}`}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                        {entry.date}
                      </span>
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {entry.chapters.map((id) => findWhitePaperById(id)?.chapter ?? id).join(' · ')}
                      </span>
                    </div>
                    <h3 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
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
      </main>

      <Footer />
    </motion.div>
  )
}
