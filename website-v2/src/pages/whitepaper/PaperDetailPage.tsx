import { motion } from 'framer-motion'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, Cpu, Download, FileText } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { findWhitePaperBySlug, formatPaperSize, paperPdfUrl, WHITE_PAPERS } from '@/data/whitePapers'

export default function PaperDetailPage() {
  const { paperSlug } = useParams()
  const paper = findWhitePaperBySlug(paperSlug)

  if (!paper) {
    return <Navigate to="/whitepaper" replace />
  }

  const siblingPapers = WHITE_PAPERS.filter((candidate) => candidate.id !== paper.id)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* HEADER ─ paper title + reader file */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.64fr)_minmax(18rem,0.36fr)] lg:items-end">
              <div className="space-y-[var(--space-5)]">
                <Link
                  to="/whitepaper"
                  className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  Both papers
                </Link>
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>{paper.status}</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[16ch]">
                    {paper.title}
                  </PanelTitle>
                  <PanelBody size="default" className="max-w-[60ch] text-[length:var(--text-lg)]">
                    {paper.subtitle}
                  </PanelBody>
                </div>
              </div>

              <aside className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <PanelEyebrow>The PDF</PanelEyebrow>
                <div className="grid gap-[var(--space-2)]">
                  {[
                    ['Date', paper.date],
                    ['Pages', String(paper.pages)],
                    ['Size', formatPaperSize(paper.sizeKb)],
                    ['Format', 'PDF, embedded below'],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-2)] first:border-t-0 first:pt-0"
                    >
                      <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        {label}
                      </span>
                      <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-[var(--space-2)] pt-[var(--space-2)]">
                  <a
                    href={paperPdfUrl(paper)}
                    download
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Download aria-hidden="true" size={14} />
                    Download
                  </a>
                  <a
                    href={paperPdfUrl(paper)}
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <FileText aria-hidden="true" size={14} />
                    Open in tab
                  </a>
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        {/* PRIMER ─ the big idea, in plain prose */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--brand-primary)] py-[var(--space-6)] lg:py-[var(--space-7)] text-[var(--brand-primary-foreground)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <BracketLabel className="border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]">
                  Start here
                </BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[14ch] text-[var(--brand-primary-foreground)]">
                  The big idea, in one paragraph.
                </PanelTitle>
              </div>
              <p className="max-w-[70ch] text-[length:var(--text-lg)] leading-[var(--leading-body)] text-[color:var(--brand-primary-foreground-muted)]">
                {paper.primer}
              </p>
            </div>
          </PageContainer>
        </section>

        {/* GLOSSARY ─ define every term before it appears below */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.30fr)_minmax(0,0.70fr)] lg:items-start">
              <div className="space-y-[var(--space-3)]">
                <BracketLabel>Vocabulary</BracketLabel>
                <PanelTitle as="h2" size="section" className="max-w-[14ch]">
                  Words this paper uses, defined.
                </PanelTitle>
                <PanelBody className="max-w-[40ch]">
                  Skim these once. The rest of the page assumes them, and the PDF leans on them harder.
                </PanelBody>
              </div>
              <dl className="grid gap-[var(--space-3)] sm:grid-cols-2">
                {paper.glossary.map((entry) => (
                  <div
                    key={entry.term}
                    className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]"
                  >
                    <dt className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                      {entry.term}
                    </dt>
                    <dd className="mt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {entry.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </PageContainer>
        </section>

        {/* WHAT YOU GET ─ benefit framing for the reader, color-blocked */}
        <section className="grid border-b-2 border-[var(--border-strong)] lg:grid-cols-2">
          <div className="bg-[var(--text-primary)] p-[var(--space-6)] text-[var(--text-inverse)] lg:border-r-2 lg:border-[var(--border-strong)] lg:p-[var(--space-7)]">
            <BracketLabel className="border-[color:var(--brand-primary-foreground-subtle)] text-[var(--text-inverse)]">
              If you are reading to learn
            </BracketLabel>
            <h3 className="mt-[var(--space-3)] mb-[var(--space-3)] max-w-[20ch] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] tracking-normal text-[var(--text-inverse)]">
              What this gives you.
            </h3>
            <p className="max-w-[60ch] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[color:var(--brand-primary-foreground-muted)]">
              {paper.whatYouGet}
            </p>
          </div>
          <div className="bg-[var(--brand-accent)] p-[var(--space-6)] text-[var(--brand-accent-foreground)] lg:p-[var(--space-7)]">
            <BracketLabel className="border-[color:var(--brand-accent-foreground-subtle)] text-[var(--brand-accent-foreground)]">
              If you are reading to build
            </BracketLabel>
            <h3 className="mt-[var(--space-3)] mb-[var(--space-3)] max-w-[20ch] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] tracking-normal text-[var(--brand-accent-foreground)]">
              How to use this.
            </h3>
            <p className="max-w-[60ch] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[color:var(--brand-accent-foreground-muted)]">
              {paper.forBuilders}
            </p>
          </div>
        </section>

        {/* ARGUMENT MAP + PDF READER */}
        <section className="py-[var(--space-6)] lg:py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(20rem,0.36fr)_minmax(0,0.64fr)] lg:items-start">
              <aside className="order-last grid gap-[var(--space-4)] lg:order-first">
                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                  <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <PanelEyebrow>Argument map</PanelEyebrow>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.sections.length.toString().padStart(2, '0')} steps
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
                  <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <PanelEyebrow>Takeaways</PanelEyebrow>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.takeaways.length.toString().padStart(2, '0')}
                    </span>
                  </div>
                  <div className="grid gap-[var(--space-4)]">
                    {paper.takeaways.map((takeaway, index) => (
                      <div key={takeaway.title} className="grid grid-cols-[2rem,1fr] gap-[var(--space-3)]">
                        <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <div className="space-y-[var(--space-1)]">
                          <h3 className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                            {takeaway.title}
                          </h3>
                          <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                            {takeaway.body}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <Link
                  to="/whitepaper/rounds"
                  className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <PanelEyebrow className="inline-flex items-center gap-[var(--space-2)]">
                    <BookOpen aria-hidden="true" size={12} />
                    Curious how the paper got here?
                  </PanelEyebrow>
                  <span className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                    See the review history
                  </span>
                  <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    Two AI review teams have argued with this draft for months. Each round of edits is on the record.
                  </span>
                </Link>

                {paper.id === 'agent-transactions' ? (
                  <Link
                    to="/whitepaper/how-we-prove-game-theory"
                    className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <PanelEyebrow className="inline-flex items-center gap-[var(--space-2)]">
                      <Cpu aria-hidden="true" size={12} />
                      The game theory, patient walkthrough
                    </PanelEyebrow>
                    <span className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                      How we use — and prove — game theory
                    </span>
                    <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      Correlated equilibrium from Aumann to a hundred-millisecond
                      Z3 check you can run yourself. For readers who took game
                      theory once in college and never saw the computational side.
                    </span>
                  </Link>
                ) : null}

                {siblingPapers.map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={sibling.readerHref}
                    className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] p-[var(--space-4)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <BracketLabel>The other paper</BracketLabel>
                    <span className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)]">
                      {sibling.title}
                    </span>
                    <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-inverse)]">
                      {sibling.subtitle}
                    </span>
                  </Link>
                ))}
              </aside>

              <article className="order-first min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] lg:order-last">
                <header className="flex flex-wrap items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] p-[var(--space-4)]">
                  <div className="space-y-[var(--space-1)]">
                    <PanelEyebrow>Read the paper</PanelEyebrow>
                    <h2 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                      {paper.title}
                    </h2>
                  </div>
                  <a
                    href={paperPdfUrl(paper)}
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <FileText aria-hidden="true" size={14} />
                    Open in tab
                  </a>
                </header>
                <div className="h-[82vh] min-h-[36rem] bg-[var(--surface-sunken)]">
                  <iframe
                    src={`${paperPdfUrl(paper)}#toolbar=1&navpanes=0`}
                    className="h-full w-full"
                    title={`${paper.title} inline PDF`}
                  />
                </div>
              </article>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
