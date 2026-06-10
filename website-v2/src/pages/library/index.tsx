import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Compass, FileText } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
} from '@/components/site/primitives'
import { NestingDiagram } from '@/components/library/NestingDiagram'
import { ReadingDag } from '@/components/library/ReadingDag'
import { SpineChain } from '@/components/library/SpineChain'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import {
  EXPLAIN_PAPERS,
  PROVE_PAPERS,
  READING_PATHS,
  WHITE_PAPERS,
  findWhitePaperByChapter,
  type WhitePaper,
} from '@/data/whitePapers'

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

        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <span className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
            <BadgeCheck aria-hidden="true" size={14} className="text-[var(--brand-primary)]" />
            {paper.maturity}
          </span>
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
  const totalPages = WHITE_PAPERS.reduce((sum, paper) => sum + paper.pages, 0)

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
                <PanelEyebrow>The Harbor Library — one argument, seven chapters</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[17ch]">
                  A harbor-master for your swarm of agents.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[62ch] text-[length:var(--text-lg)]">
                  Ten agents on one repo make you less sure, not more. Two edit
                  the same file and the second erases the first. One &ldquo;fixes&rdquo;
                  the tests by deleting them. The fix is not a better agent — it
                  is a local authority that makes the whole swarm{' '}
                  <em className="not-italic font-black text-[var(--text-primary)]">legible, accountable, and safe</em>{' '}
                  to one operator. That is the product you can run today. The same
                  authority becomes a market only once you sail out to trade — and
                  this library builds the whole climb, in order.
                </PanelBody>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: '04', label: 'chapters explain' },
                    { value: '03', label: 'chapters prove' },
                    { value: String(totalPages), label: 'pages, free PDFs' },
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
                    href="#read-it"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    <Compass aria-hidden="true" size={15} />
                    Where to start
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

              {/* The L0 → L3 nesting, drawn — the structure of the whole library,
                  up front. Switches light/dark with the page via tokens. */}
              <NestingDiagram />
            </div>
          </PageContainer>
        </section>

        {/* ── The spine, drawn as a chain ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-5)]">
              <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The spine</PanelEyebrow>
                  <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                    Seven links. One chain.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[58ch] text-[length:var(--text-lg)]">
                  The whole library is one sentence, and the sentence is a chain.
                  Memory makes continuity; continuity makes a person; a person
                  accrues a record; a record is reputation; reputation is an
                  asset; assets make a market. Each link is built in the chapter
                  tagged on it.
                </PanelBody>
              </div>
              <SpineChain />
            </div>
          </PageContainer>
        </section>

        {/* ── Read it in order: the dependency DAG ── */}
        <section id="read-it" className="scroll-mt-[var(--space-8)] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-5)]">
              <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>Where to start</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    Read down the left.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  The four explaining chapters are a spine: read them top to
                  bottom and the argument lands in order. The three proving
                  chapters sit beside the claims they discharge — dip into one
                  when a skeptic wants the math, then climb back. Every node is a
                  link straight to the chapter.
                </PanelBody>
              </div>
              <ReadingDag />
            </div>
          </PageContainer>
        </section>

        {/* ── The chapters: explain (I–IV) then prove (V–VII) ── */}
        <section id="the-chapters" className="scroll-mt-[var(--space-8)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-7)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The seven chapters</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    Each one, in a sentence.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Here is the whole library at a glance. Every card states the
                  chapter&rsquo;s one claim, what it stands on, and how mature it
                  is — built, partial, specified, or proven. Read the claim. If it
                  earns a click, the chapter is one away.
                </PanelBody>
              </div>

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

        {/* ── The payoff: what the economy looks like ── */}
        <section className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-5)]">
              <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>Specified · targeted 2027</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[16ch]">
                    A market for trustworthy agents.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  None of this is the product yet — the wedge is. But it is where
                  the climb leads. Once an agent has a reputation that cannot be
                  faked, three kinds of seller can trade on it: people sell their
                  labor, owners rent their agents, authors license their skills.
                  All three settle on one ledger, through an escrow that can pay
                  or refuse but never redirect. You would not buy the crypto; you
                  would buy <em className="not-italic font-black text-[var(--text-primary)]">hosted trust</em>.
                </PanelBody>
              </div>
              <ThreeSidedMarket />
            </div>
          </PageContainer>
        </section>

        {/* ── Reading paths ── */}
        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
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
