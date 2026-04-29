import { motion } from 'framer-motion'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, FileText } from 'lucide-react'
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
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.64fr)_minmax(20rem,0.36fr)] lg:items-end">
              <div className="space-y-[var(--space-5)]">
                <Link
                  to="/whitepaper"
                  className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:text-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  All papers
                </Link>
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>{paper.status}</PanelEyebrow>
                  <PanelTitle as="h1" size="hero" className="max-w-[13ch]">
                    {paper.title}
                  </PanelTitle>
                  <PanelBody size="default" className="max-w-[52rem] text-[length:var(--text-lg)]">
                    {paper.subtitle}
                  </PanelBody>
                </div>
              </div>

              <aside className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <PanelEyebrow>Reader file</PanelEyebrow>
                <div className="grid gap-[var(--space-2)]">
                  {[
                    ['Date', paper.date],
                    ['Pages', String(paper.pages)],
                    ['Size', formatPaperSize(paper.sizeKb)],
                    ['Format', 'Inline PDF'],
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
                    Raw PDF
                  </a>
                </div>
              </aside>
            </div>
          </PageContainer>
        </section>

        <section className="py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(20rem,0.36fr)_minmax(0,0.64fr)] lg:items-start">
              <aside className="order-last grid gap-[var(--space-4)] lg:order-first">
                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>What this paper is saying</PanelEyebrow>
                    <PanelTitle as="h2" size="card" className="max-w-[18ch]">
                      {paper.explainerTitle}
                    </PanelTitle>
                    <PanelBody>{paper.explainerLead}</PanelBody>
                  </div>
                </section>

                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                  <div className="grid gap-[var(--space-4)]">
                    <PanelEyebrow>Why this paper matters</PanelEyebrow>
                    <PanelBody>{paper.whyValuable}</PanelBody>
                  </div>
                </section>

                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <div className="grid gap-[var(--space-4)]">
                    <PanelEyebrow>Future value</PanelEyebrow>
                    <PanelBody>{paper.futureValue}</PanelBody>
                  </div>
                </section>

                <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-5)]">
                  <div className="mb-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <PanelEyebrow>Takeaways</PanelEyebrow>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                      {paper.order}/02
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

                {siblingPapers.map((sibling) => (
                  <Link
                    key={sibling.id}
                    to={sibling.readerHref}
                    className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] p-[var(--space-4)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <BracketLabel>Next paper</BracketLabel>
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
                    <PanelEyebrow>Inline PDF reader</PanelEyebrow>
                    <h2 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] tracking-[var(--tracking-display-nav)] text-[var(--text-primary)]">
                      {paper.title}
                    </h2>
                  </div>
                  <a
                    href={paperPdfUrl(paper)}
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <FileText aria-hidden="true" size={14} />
                    Open PDF
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
