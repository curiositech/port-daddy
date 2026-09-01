import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, SearchCheck, Sigma } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { SevenProofsFigure } from '@/components/library/SevenProofsFigure'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import {
  RESEARCH_PAPERS,
  RESEARCH_PAPER_TOTAL_PAGES,
  RESULT_LEDGER,
  type DiveVerdict,
  type ResearchPaper,
  type ResearchTone,
} from '@/data/researchPapers'
import { findWhitePaperByChapter } from '@/data/whitePapers'

/**
 * Literal Tailwind class pairs per `ResearchTone`. Kept as complete literal
 * strings (never assembled from the token name at runtime) so Tailwind's
 * static scanner can see and ship every class — the same discipline the
 * rest of the design system uses (see `docsCardTone` etc. in primitives.tsx).
 */
const RESEARCH_TONE_CLASSES: Record<ResearchTone, { badge: string; rule: string; border: string }> = {
  primary: {
    badge: 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
    rule: 'bg-[var(--brand-primary)]',
    border: 'border-[var(--brand-primary)]',
  },
  health: {
    badge: 'bg-[var(--story-health)] text-[var(--story-health-foreground)]',
    rule: 'bg-[var(--story-health)]',
    border: 'border-[var(--story-health)]',
  },
  rust: {
    badge: 'bg-[var(--story-rust)] text-[var(--story-rust-foreground)]',
    rule: 'bg-[var(--story-rust)]',
    border: 'border-[var(--story-rust)]',
  },
  accent: {
    badge: 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]',
    rule: 'bg-[var(--brand-accent)]',
    border: 'border-[var(--brand-accent)]',
  },
  violet: {
    badge: 'bg-[var(--story-violet)] text-[var(--story-violet-foreground)]',
    rule: 'bg-[var(--story-violet)]',
    border: 'border-[var(--story-violet)]',
  },
  warm: {
    badge: 'bg-[var(--status-warning)] text-[var(--text-inverse)]',
    rule: 'bg-[var(--status-warning)]',
    border: 'border-[var(--status-warning)]',
  },
  indigo: {
    badge: 'bg-[var(--story-indigo)] text-[var(--story-indigo-foreground)]',
    rule: 'bg-[var(--story-indigo)]',
    border: 'border-[var(--story-indigo)]',
  },
}

/**
 * Plain-English gloss for each dive verdict — see
 * `docs/harbor-research/deep-dives/README.md`'s "Severity, and what each
 * outcome means" for the authoritative definitions this restates.
 */
const DIVE_VERDICT_GLOSS: Record<DiveVerdict, string> = {
  CLEAR: 'genuinely different from the prior work found',
  NARROW: 'survives with a narrower scope than first stated',
  SUBSUMED: 'prior work already proves this',
  CONTRADICTED: 'prior work proved this false — since corrected',
}

function ResearchPaperCard({ paper }: { paper: ResearchPaper }) {
  const tone = RESEARCH_TONE_CLASSES[paper.tone]
  const Icon = paper.icon
  const chapter = findWhitePaperByChapter(paper.chapterRef)

  return (
    <article
      id={`paper-${paper.number}`}
      className="grid min-w-0 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]"
    >
      <div className={`h-[6px] w-full ${tone.rule}`} aria-hidden="true" />
      <header className="grid grid-cols-[auto,1fr] items-start gap-[var(--space-4)] border-b-2 border-[var(--border-strong)] p-[var(--space-5)]">
        <span
          aria-hidden="true"
          className={`grid h-[3.5rem] w-[3.5rem] place-items-center border-2 border-[var(--border-strong)] font-mono text-[length:var(--text-2xl)] font-black leading-none ${tone.badge}`}
        >
          {paper.number}
        </span>
        <div className="min-w-0 space-y-[var(--space-2)]">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <BracketLabel>Paper {paper.number}</BracketLabel>
            <span className="inline-flex items-center gap-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              <Icon aria-hidden="true" size={14} />
              {paper.resultTags.join(' · ')}
            </span>
          </div>
          <PanelTitle as="h3" size="card" className="max-w-[24ch]">
            {paper.title}
          </PanelTitle>
          <p className="font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            {paper.subtitle}
          </p>
        </div>
      </header>

      <div className="grid gap-[var(--space-4)] p-[var(--space-5)]">
        <PanelBody className="max-w-none text-[length:var(--type-panel-body-size)]">{paper.claim}</PanelBody>

        <blockquote className={`border-l-4 pl-[var(--space-4)] ${tone.border}`}>
          <p className="font-mono text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-primary)]">
            {paper.pullQuote}
          </p>
        </blockquote>

        {chapter ? (
          <div className="border-2 border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-4)]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Closest chapter
            </span>{' '}
            <Link
              to={`/whitepaper/${chapter.slug}`}
              className="font-black text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
            >
              {paper.chapterRef} · {chapter.title}
            </Link>
            <p className="mt-[var(--space-1)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              — {paper.chapterWhy}
            </p>
          </div>
        ) : null}

        {paper.priorArtDive ? (
          <div className="border-2 border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-4)]">
            <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              <SearchCheck aria-hidden="true" size={14} />
              Prior-art dive · {paper.priorArtDive.verdict}
            </span>
            <p className="mt-[var(--space-1)] text-[length:var(--type-panel-body-compact-size)] italic leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
              {DIVE_VERDICT_GLOSS[paper.priorArtDive.verdict]}
            </p>
            <p className="mt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              {paper.priorArtDive.summary}
            </p>
            <a
              href={`https://github.com/curiositech/port-daddy/blob/main/docs/harbor-research/deep-dives/${paper.priorArtDive.findingsPath}`}
              target="_blank"
              rel="noreferrer"
              className="mt-[var(--space-2)] inline-flex items-center gap-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
            >
              Read the dive’s findings
              <ArrowRight aria-hidden="true" size={12} />
            </a>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] pt-[var(--space-1)]">
          <a
            href={paper.pdfPath}
            className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-4)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
          >
            <FileText aria-hidden="true" size={14} />
            Read the PDF · {paper.pages} pp
          </a>
          <span className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            {paper.sizeKb} KB
          </span>
        </div>
      </div>
    </article>
  )
}

export default function ResearchLibraryPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Hero ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.92fr)_minmax(18rem,0.5fr)] lg:items-start">
              <div className="space-y-[var(--space-5)]">
                <Link
                  to="/library"
                  className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] hover:text-[var(--brand-primary)]"
                >
                  <ArrowLeft aria-hidden="true" size={14} />
                  Back to the Harbor Library
                </Link>

                <PanelEyebrow>The Harbor Research Program — seven papers, adversarially reviewed</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[22ch]">
                  The whitepapers made the claims. This is where they get proved.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[68ch] text-[length:var(--text-lg)]">
                  Seven library chapters argue the harbor works. Underneath four of
                  them sit theorems the prose alone can&rsquo;t carry — a digest
                  floor measured in bits, a controllability boundary between what
                  a runtime can prevent and what it can only notice, a
                  bribery-proof tower of judges auditing judges, a conservation
                  law that stops reputation from being minted out of thin air.
                  These seven papers are where{' '}
                  <strong className="font-black text-[var(--text-primary)]">R1 through R17</strong>{' '}
                  stop being entries in a results compendium and become proofs:
                  Akerlof&rsquo;s unraveling flipping the moment you attest the
                  engine, a queueing threshold the whitepaper got wrong and this
                  corrects in both directions, an NP-completeness frontier found
                  one clause outside a tractable fragment, a sheaf-cohomology
                  detector whose headline number you can check by hand. Pull out
                  any one of these seven and a specific claim in the library
                  stops being backed.
                </PanelBody>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: '07', label: 'papers, arXiv-style' },
                    { value: '16', label: 'results proved, R1–R17' },
                    { value: String(RESEARCH_PAPER_TOTAL_PAGES), label: 'pages across the set' },
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

                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <a
                    href="#the-papers"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)] shadow-[var(--shadow-brutal)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    Read the seven papers
                    <ArrowRight aria-hidden="true" size={14} />
                  </a>
                  <a
                    href="#result-ledger"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Sigma aria-hidden="true" size={14} />
                    See the R-number ledger
                  </a>
                </div>
              </div>

              <SevenProofsFigure />
            </div>
          </PageContainer>
        </section>

        {/* ── The spine: why these are a program, not seven loose PDFs ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] lg:items-start">
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>Why seven, and why together</PanelEyebrow>
                <PanelBody className="max-w-[34ch] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  The library&rsquo;s three &ldquo;proves&rdquo; chapters — the
                  Anchor Protocol, the Bonded Commons, the Federated Harbor —
                  mechanize identity, conservation, and federation. They never
                  claimed to prove reputation itself, or the oversight math
                  underneath the attention queue, or which governance rules a
                  runtime can actually enforce. That is this program&rsquo;s
                  job.
                </PanelBody>
              </div>
              <blockquote className="border-l-4 border-[var(--brand-primary)] pl-[var(--space-5)]">
                <p className="font-display text-[length:var(--text-2xl)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]">
                  Every headline claim in the library either has a proof
                  chapter behind it already, or it has one of these seven
                  papers. None of the seven is decoration — trace any one back
                  far enough and it is load-bearing under a specific sentence
                  a product page makes.
                </p>
              </blockquote>
            </div>
          </PageContainer>
        </section>

        {/* ── The seven papers ── */}
        <section id="the-papers" className="scroll-mt-[var(--space-8)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The papers</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[16ch]">
                    Seven proofs, in reading order.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Each card names the R-numbers it discharges, quotes its
                  headline theorem or number verbatim, and links to the
                  library chapter its proof is closest to. Read any one on its
                  own — nothing here depends on reading the others first.
                </PanelBody>
              </div>

              <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                {RESEARCH_PAPERS.map((paper) => (
                  <ResearchPaperCard key={paper.id} paper={paper} />
                ))}
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── The R-number ledger ── */}
        <section
          id="result-ledger"
          className="scroll-mt-[var(--space-8)] border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.34fr)_minmax(0,0.66fr)]">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>The result ledger</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                  R1 through R17, and which paper carries each.
                </PanelTitle>
                <PanelBody className="max-w-[44ch] text-[length:var(--text-lg)]">
                  Sixteen of the seventeen numbered results in the compendium
                  land in one of these seven papers. The seventeenth,{' '}
                  <span className="font-black text-[var(--text-primary)]">R8</span>{' '}
                  — the work-unit machine that the daemon itself runs on — is
                  a substrate result with no numbered paper yet; listing it as
                  proved here would overclaim, so it stays off this table on
                  purpose.
                </PanelBody>
              </div>

              <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                <table className="w-full min-w-[32rem] border-collapse">
                  <thead>
                    <tr className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-strong)] text-left">
                      <th className="px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        Result
                      </th>
                      <th className="px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        What it proves
                      </th>
                      <th className="px-[var(--space-4)] py-[var(--space-3)] text-right font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                        Paper
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {RESULT_LEDGER.map((entry) => (
                      <tr key={entry.id} className="border-b-2 border-[var(--border-default)] last:border-b-0">
                        <td className="px-[var(--space-4)] py-[var(--space-3)] font-mono text-[length:var(--type-panel-body-compact-size)] font-black text-[var(--brand-primary)]">
                          {entry.id}
                        </td>
                        <td className="px-[var(--space-4)] py-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                          {entry.label}
                        </td>
                        <td className="px-[var(--space-4)] py-[var(--space-3)] text-right">
                          {entry.paperNumbers.map((number, index) => (
                            <React.Fragment key={number}>
                              {index > 0 ? ', ' : ''}
                              <a
                                href={`#paper-${number}`}
                                className="font-mono text-[length:var(--type-panel-body-compact-size)] font-black text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
                              >
                                {number}
                              </a>
                            </React.Fragment>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Honest status + back to the library ── */}
        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Pre-prints, not scripture</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[20ch]">
                  Every number here is tagged as checkable or as regenerating from a script.
                </PanelTitle>
                <PanelBody className="max-w-[58ch] text-[length:var(--text-lg)]">
                  These are adversarially reviewed pre-prints, not
                  peer-reviewed journal articles — every closed-form number is
                  marked as externally recomputable or as regenerating from a
                  named script at a fixed seed, and every theorem states the
                  boundary where it stops holding. That is the same honesty
                  discipline the library runs on; the math just makes it load
                  more precisely.
                </PanelBody>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] p-[var(--space-5)] shadow-[var(--shadow-brutal)]">
                <PanelEyebrow className="mb-[var(--space-3)]">Keep reading</PanelEyebrow>
                <div className="grid gap-[var(--space-3)]">
                  <Link
                    to="/library"
                    className="inline-flex items-center justify-between gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
                  >
                    The seven chapters
                    <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                  <Link
                    to="/whitepaper/rounds"
                    className="inline-flex items-center justify-between gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] px-[var(--space-4)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
                  >
                    The adversarial review rounds
                    <ArrowRight aria-hidden="true" size={14} />
                  </Link>
                </div>
              </div>
            </div>
          </PageContainer>
        </section>
      </main>

      <Footer />
    </motion.div>
  )
}
