import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, FlaskConical, FileText } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { SpineChain } from '@/components/library/SpineChain'
import { TableOfContents } from '@/components/library/TableOfContents'
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
  LIBRARY_CHANGELOG,
  LIBRARY_SPINE,
  TABLE_OF_CONTENTS,
  TEXTBOOK,
  chapterRoleLabel,
  findWhitePaperById,
  type WhitePaper,
} from '@/data/whitePapers'
import { harborEvolutionFigure } from '@/data/manifestoContent'
import { ThemedImage } from '@/components/site/ThemedImage'
import { RESEARCH_PAPERS, RESEARCH_PAPER_TOTAL_PAGES } from '@/data/researchPapers'

/**
 * /library — the page about the manuscript. It says what the book argues,
 * which questions it asks and in what order, how the argument is held to
 * account by proofs and experiments, and where the seven conference-form
 * papers fit. It does not advertise per-chapter PDFs: the Book is one
 * document, and the chapter links go to the chapter pages, not to files.
 * Every number comes from whitepaper/textbook.json and the registry.
 */

const CROSS_REF_KINDS = [
  { key: 'assumes', label: 'Assumes', Icon: ArrowDownRight },
  { key: 'underwrites', label: 'Underwrites', Icon: ArrowUpRight },
  { key: 'provedBy', label: 'Proved by', Icon: BadgeCheck },
  { key: 'proves', label: 'Proves', Icon: BadgeCheck },
] as const

const REPO = 'https://github.com/curiositech/port-daddy'

/** How the manuscript and the repository push on each other. Each row names one loop and where to see it run. */
const ACCOUNTABILITY_LOOPS: Array<{ title: string; body: React.ReactNode; href: string; hrefLabel: string }> = [
  {
    title: 'Every proof the book cites runs on every pull request.',
    body: (
      <>
        The Kani harnesses over the Rust card verifier, every ProVerif model checked
        against its committed result, the relay&rsquo;s TLA<sup>+</sup> specifications
        with their attack configurations, and the Z3 cubic behind the claim-signaling
        threshold all run in CI. A negative control runs beside each one, so a checker
        that stopped finding anything would fail loudly rather than pass quietly. The
        book&rsquo;s appendix of mechanized claims is generated from that manifest,
        never typed.
      </>
    ),
    href: `${REPO}/tree/main/proofs`,
    hrefLabel: 'proofs/ in the repository',
  },
  {
    title: 'Numbers worked by hand carry a tag that says who checked them.',
    body: (
      <>
        Seventeen executed results sit behind the chapters, each with a script and a
        fixed seed. When a chapter walks a number by hand it tags it{' '}
        <code className="font-mono text-[0.9em]">[verified]</code> only if that script
        regenerates it in CI, and{' '}
        <code className="font-mono text-[0.9em]">[internal]</code> when only the
        chapter&rsquo;s own derivation does. The page also says which claims are
        theorems, which are design invariants, which are model-checked, and which are
        still hypotheses awaiting measurement.
      </>
    ),
    href: `${REPO}/tree/main/scripts/harbor-results`,
    hrefLabel: 'the result scripts',
  },
  {
    title: 'What the book cannot settle becomes a pre-registered experiment.',
    body: (
      <>
        The book argues that confinement needs an enforcement point below the agent.
        It does not know whether its single-writer rail is also the right way for
        several agents to share one repository, against a worktree per agent with a
        merge queue. So that question left the prose and became a study with its
        hypotheses, metrics, and kill criterion written down before any code: real
        commit histories replayed through six coordination substrates. Until it
        reports, the rail is a design invariant, not a theorem about collaboration.
      </>
    ),
    href: `${REPO}/tree/main/studies/substrate-study`,
    hrefLabel: 'the study protocol',
  },
  {
    title: 'Claims about the harness itself are graded the same way.',
    body: (
      <>
        A reproducible world plus a schedule of failures is a Genesis. One run of it
        is a Voyage. The behaviour it leaves is the Wake, the structured record the
        Logbook, and the claims we are willing to assert afterwards the Receipt. A
        harness claim is not established because a feature executed; it is
        established when a controlled Genesis produces a Voyage whose consequential
        transitions are backed by durable evidence and an adjudication receipt. The
        front matter adopts that vocabulary and the repository keeps the documents.
      </>
    ),
    href: `${REPO}/blob/main/docs/harbor-research/exposition/HARNESS-LIFECYCLE-PROOF.md`,
    hrefLabel: 'the harness lifecycle proof',
  },
]

function chapterLabel(id: string): string {
  const paper = findWhitePaperById(id)
  return paper ? `${paper.chapter} · ${paper.title}` : id
}

function chapterRecord(id: string) {
  return TEXTBOOK.chapters.find((chapter) => chapter.id === id)
}

function CrossRefRow({
  label,
  Icon,
  edges,
}: {
  label: string
  Icon: typeof ArrowRight
  edges: Array<{ id: string; why: string }>
}) {
  return (
    <div className="grid grid-cols-[auto,1fr] gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0">
      <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
        <Icon aria-hidden="true" size={14} className="text-[var(--brand-primary)]" />
        {label}
      </span>
      <ul className="grid gap-[var(--space-2)]">
        {edges.map((edge) => (
          <li key={`${label}-${edge.id}`} className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            <Link
              to={`/whitepaper/${findWhitePaperById(edge.id)?.slug ?? ''}`}
              className="font-black text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
            >
              {chapterLabel(edge.id)}
            </Link>{' '}
            — {edge.why}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ChapterCard({ paper }: { paper: WhitePaper }) {
  const record = chapterRecord(paper.id)
  const refRows = CROSS_REF_KINDS.map((kind) => {
    const edges = paper.crossRefs[kind.key]
    if (!edges || edges.length === 0) return null
    return <CrossRefRow key={kind.key} label={kind.label} Icon={kind.Icon} edges={edges} />
  }).filter(Boolean)

  return (
    <article
      id={`chapter-${paper.id}`}
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
            <BracketLabel>{chapterRoleLabel(paper)}</BracketLabel>
            <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {paper.layer}
            </span>
          </div>
          <PanelTitle as="h3" size="card" className="max-w-[20ch]">
            {paper.title}
          </PanelTitle>
          {record ? (
            <p className="font-display text-[length:var(--type-panel-body-size)] italic leading-[var(--leading-body-compact)] text-[var(--text-primary)]">
              {record.question}
            </p>
          ) : null}
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
  const chapterCount = TEXTBOOK.chapters.length
  const partCount = TEXTBOOK.parts.length

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Hero: the reader's situation, then the book ── */}
        <section className="border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,0.92fr)_minmax(20rem,0.5fr)] lg:items-start">
              <div className="space-y-[var(--space-5)]">
                <PanelEyebrow>The Harbor Library</PanelEyebrow>
                <PanelTitle as="h1" size="hero" className="max-w-[15ch]">
                  One book about what happens after you walk away.
                </PanelTitle>
                <PanelBody size="default" className="max-w-[62ch] text-[length:var(--text-lg)]">
                  You can hand a goal to a program and leave the room. Come back and ten
                  agents are on the repo. Two edited the same file, and the second erased
                  the first. One made the tests pass by deleting them. Nothing inside any
                  one agent caused that. The failure lives between them, in the place where
                  nobody keeps the record. This book is the argument for keeping it, and
                  for what follows once you do: {chapterCount} chapters in {partCount}{' '}
                  parts, one claim, and the proofs and experiments that hold the claim to
                  account.
                </PanelBody>

                <blockquote className="!mt-[var(--space-6)] border-l-4 border-[var(--brand-primary)] pl-[var(--space-5)]">
                  <p className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]">
                    {TEXTBOOK.edition.claim}
                  </p>
                  <footer className="mt-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    The one claim, from page one
                  </footer>
                </blockquote>

                <div className="grid gap-[var(--space-3)] border-y-2 border-[var(--border-strong)] py-[var(--space-4)] sm:grid-cols-3">
                  {[
                    { value: String(partCount).padStart(2, '0'), label: 'parts' },
                    { value: String(chapterCount).padStart(2, '0'), label: 'chapters, in dependency order' },
                    { value: String(COLLECTED_VOLUME.pages), label: `pages, version ${TEXTBOOK.edition.version.replace(/\s*\(.*\)$/, '')}` },
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
                  href={COLLECTED_VOLUME.downloadUrl}
                  download
                  className="group grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] p-[var(--space-5)] text-[var(--brand-primary-foreground)] shadow-[var(--shadow-brutal)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:grid-cols-[auto_1fr_auto] sm:items-center"
                >
                  <span className="grid h-12 w-12 place-items-center border-2 border-current">
                    <FileText aria-hidden="true" size={24} />
                  </span>
                  <span className="grid gap-[var(--space-1)]">
                    <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                      Download the book
                    </span>
                    <span className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)]">
                      {COLLECTED_VOLUME.title}
                    </span>
                    <span className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]">
                      {TEXTBOOK.edition.subtitle} · {COLLECTED_VOLUME.pages} pages · {COLLECTED_VOLUME.references} references
                    </span>
                  </span>
                  <ArrowDownRight
                    aria-hidden="true"
                    size={24}
                    className="transition-transform group-hover:translate-x-1 group-hover:translate-y-1"
                  />
                </a>

                {COLLECTED_VOLUME.editions && COLLECTED_VOLUME.editions.length > 0 && (
                  <p className="max-w-[62ch] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    The same book, set two other ways:{' '}
                    {COLLECTED_VOLUME.editions.map((edition, index) => (
                      <React.Fragment key={edition.id}>
                        {index > 0 ? ' · ' : ''}
                        <a
                          href={edition.pdfPath}
                          download
                          className="underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--text-primary)]"
                        >
                          {edition.title}
                        </a>
                      </React.Fragment>
                    ))}
                  </p>
                )}

                <div className="flex flex-wrap gap-[var(--space-3)]">
                  <a
                    href="#the-questions"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    Start with the questions
                    <ArrowRight aria-hidden="true" size={14} />
                  </a>
                  <a
                    href="#the-loop"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                  >
                    How it is held to account
                  </a>
                </div>
              </div>

              <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] shadow-[var(--shadow-brutal)]">
                <img
                  src="/whitepaper/plates/jacket.jpg"
                  alt="Jacket of The Harbor, the Person, and the Economy: a colossal figure over a small harbor, in faded watercolour."
                  className="block aspect-[7/10] w-full object-cover"
                  loading="eager"
                />
                <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {TEXTBOOK.edition.title}. {TEXTBOOK.edition.version}, {TEXTBOOK.edition.date}. The
                  book is ahead of the product and says so on its first page: what runs
                  today, what is modelled and machine-checked, and what is proposed.
                </figcaption>
              </figure>
            </div>
          </PageContainer>
        </section>

        {/* ── The eight questions, in the order they have to be asked ── */}
        <section id="the-questions" className="scroll-mt-[var(--space-8)] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The questions</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    Eight questions, in the order they have to be asked.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Each chapter opens on one question and answers it before it does
                  anything else. The order is the dependency order: a chapter stands on
                  the ones before it, and each proving chapter follows the chapter whose
                  promises it keeps. Read the questions alone and you have the argument.
                </PanelBody>
              </div>

              <ol className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
                {TEXTBOOK.chapters.map((chapter) => (
                  <li
                    key={chapter.id}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)]"
                  >
                    <span className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--brand-primary)]">
                      {chapter.number}
                    </span>
                    <p className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]">
                      {chapter.question}
                    </p>
                    <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {chapter.oneLine}
                    </p>
                    <Link
                      to={findWhitePaperById(chapter.id)?.readerHref ?? '/library'}
                      className="mt-auto inline-flex items-center gap-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
                    >
                      {chapter.title}
                      <ArrowRight aria-hidden="true" size={12} />
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </PageContainer>
        </section>

        {/* ── What the manuscript argues ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.32fr)_minmax(0,0.68fr)] lg:items-start">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>What it argues</PanelEyebrow>
                  <PanelTitle as="h2" size="section" className="max-w-[16ch]">
                    From the machine, up to the market.
                  </PanelTitle>
                  <PanelBody className="max-w-[34ch] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                    One sentence holds the whole book together. Pull out any link and the
                    chain above it falls, which is why the harbor comes before the economy
                    and why memory, not cryptography, is the foundation.
                  </PanelBody>
                </div>
                <blockquote className="border-l-4 border-[var(--brand-primary)] pl-[var(--space-5)]">
                  <p className="font-display text-[length:var(--text-2xl)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]">
                    {LIBRARY_SPINE}
                  </p>
                </blockquote>
              </div>

              <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2 lg:grid-cols-4">
                {TEXTBOOK.parts.map((part) => (
                  <div key={part.id} className="space-y-[var(--space-2)] bg-[var(--surface-base)] p-[var(--space-4)]">
                    <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                      Part {part.numeral}
                    </span>
                    <h3 className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                      {part.title}
                    </h3>
                    <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                      {part.blurb}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                <div className="space-y-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <PanelEyebrow>How every claim is labelled</PanelEyebrow>
                  <PanelBody className="max-w-none text-[length:var(--type-panel-body-size)]">
                    A <strong className="font-black text-[var(--text-primary)]">theorem</strong> follows
                    from a stated model. A{' '}
                    <strong className="font-black text-[var(--text-primary)]">design invariant</strong> is
                    meant to hold and is backed by code and tests. A{' '}
                    <strong className="font-black text-[var(--text-primary)]">model-checked property</strong>{' '}
                    holds for a bounded model a checker exhausted. An{' '}
                    <strong className="font-black text-[var(--text-primary)]">empirical hypothesis</strong>{' '}
                    is waiting to be measured. Runtime claims name one of five assurance
                    modes, Observed, Coordinated, Brokered, Confined, Attested, in
                    increasing order of what the harbor itself enforces. None is promoted
                    into another.
                  </PanelBody>
                </div>
                <div className="space-y-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
                  <PanelEyebrow>What page one admits</PanelEyebrow>
                  <PanelBody className="max-w-none text-[length:var(--type-panel-body-size)]">
                    The daemon, its single-writer record, the operator projections, the
                    durable work records, a bounded-verified card checker, and the relay
                    run today. The sealed room, attenuation at every hop, the
                    claim-signaling incentive, and the bond ledger&rsquo;s conservation
                    are modelled and machine-checked but not running. The confined mode
                    itself, cross-authority settlement, and the federation&rsquo;s witness
                    log are proposed. The book prescribes an enforcement point below the
                    agent and treats today&rsquo;s tool-level interceptors as interim.
                  </PanelBody>
                </div>
              </div>

              <figure className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
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
            </div>
          </PageContainer>
        </section>

        {/* ── The loop: how the book and the code push on each other ── */}
        <section id="the-loop" className="scroll-mt-[var(--space-8)] border-b-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>Held to account</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    The book and the code push on each other.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  A manuscript about accountable work has to be accountable itself. Four
                  loops run between these chapters and the repository, and each one is
                  visible: what a chapter proves, CI checks; what a chapter measures, a
                  script regenerates; what a chapter cannot settle becomes an experiment
                  with its hypotheses written down first; and what the product learns
                  comes back as the next revision.
                </PanelBody>
              </div>

              <ol className="grid gap-[var(--space-4)] lg:grid-cols-2">
                {ACCOUNTABILITY_LOOPS.map((loop, index) => (
                  <li
                    key={loop.title}
                    className="grid gap-[var(--space-3)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] shadow-[var(--shadow-brutal)]"
                  >
                    <span className="font-mono text-[length:var(--text-2xl)] font-black leading-none text-[var(--brand-primary)]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-display text-[length:var(--text-xl)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                      {loop.title}
                    </h3>
                    <PanelBody className="max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                      {loop.body}
                    </PanelBody>
                    <a
                      href={loop.href}
                      className="mt-auto inline-flex w-fit items-center gap-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
                    >
                      {loop.hrefLabel}
                      <ArrowUpRight aria-hidden="true" size={12} />
                    </a>
                  </li>
                ))}
              </ol>

              <div className="grid gap-[var(--space-3)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-5)] lg:grid-cols-[minmax(0,0.3fr)_minmax(0,0.7fr)]">
                <PanelEyebrow>What the book still owes</PanelEyebrow>
                <PanelBody className="max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  The manuscript names its own gaps rather than papering them: a procedure
                  for moving write authority between harbors, the release ledger run in the
                  provider&rsquo;s direction, the arithmetic of disputes and partial work, a
                  constitution for who may suspend a publisher, and one table joining the
                  evidence labels the product uses with the claim kinds the book uses. Each
                  is a section in a later revision, and each is tracked in the open with the
                  decision that asked for it.
                </PanelBody>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── The seven conference-form papers ── */}
        <section className="border-b-2 border-[var(--border-strong)] bg-[var(--story-indigo)] py-[var(--space-7)] text-[var(--story-indigo-foreground)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-6)]">
              <div className="grid gap-[var(--space-3)] sm:grid-cols-[auto,1fr] sm:items-start">
                <span className="grid h-14 w-14 place-items-center border-2 border-current">
                  <FlaskConical aria-hidden="true" size={28} />
                </span>
                <div className="space-y-[var(--space-2)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                    The research papers, in conference form
                  </span>
                  <h2 className="max-w-[40ch] font-display text-[length:var(--text-3xl)] font-black leading-[var(--leading-display-tight)] !text-[var(--story-indigo-foreground)]">
                    Seven papers, one result each, written for a program committee.
                  </h2>
                  <p className="max-w-[68ch] text-[length:var(--text-lg)] leading-[var(--leading-body)]">
                    The chapters fold these results in as labelled claims with their
                    proofs. The papers keep the form a reviewer expects: abstract, related
                    work, the theorem, the experiment, {RESEARCH_PAPER_TOTAL_PAGES} pages
                    across {RESEARCH_PAPERS.length} of them, each adversarially reviewed.
                    Read one when you want a single result without the book around it.
                  </p>
                </div>
              </div>

              <ol className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
                {RESEARCH_PAPERS.map((paper) => {
                  const home = findWhitePaperById(paper.chapterRef)
                  return (
                    <li
                      key={paper.id}
                      className="grid gap-[var(--space-2)] border-2 border-current bg-[var(--story-indigo)] p-[var(--space-4)]"
                    >
                      <span className="flex items-center gap-[var(--space-2)]">
                        <span className="grid h-7 w-7 shrink-0 place-items-center border-2 border-current font-mono text-[length:var(--text-sm)] font-black leading-none">
                          {paper.number}
                        </span>
                        <span className="font-display text-[length:var(--text-base)] font-black leading-[var(--leading-nav)]">
                          {paper.title}
                        </span>
                      </span>
                      <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] opacity-80">
                        {paper.subtitle}
                      </span>
                      <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]">
                        {paper.claim}
                      </span>
                      {home ? (
                        <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] opacity-80">
                          Folded into chapter {home.chapter}, {home.title}: {paper.chapterWhy}.
                        </span>
                      ) : null}
                      <span className="mt-auto flex flex-wrap gap-[var(--space-3)] pt-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]">
                        <Link
                          to={`/library/research#paper-${paper.number}`}
                          className="inline-flex items-center gap-[var(--space-1)] underline underline-offset-4 hover:no-underline"
                        >
                          About the paper
                          <ArrowRight aria-hidden="true" size={12} />
                        </Link>
                        <a
                          href={paper.pdfPath}
                          className="inline-flex items-center gap-[var(--space-1)] underline underline-offset-4 hover:no-underline"
                        >
                          <FileText aria-hidden="true" size={12} />
                          PDF · {paper.pages} pp
                        </a>
                      </span>
                    </li>
                  )
                })}
              </ol>

              <Link
                to="/library/research"
                className="group inline-flex w-fit items-center gap-[var(--space-2)] border-2 border-current bg-[var(--story-indigo-foreground)] px-[var(--space-5)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--story-indigo)] transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
              >
                The research library, with the prior-art dives
                <ArrowRight aria-hidden="true" size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </PageContainer>
        </section>

        {/* ── The table of contents and the chapters, part by part ── */}
        <section id="the-chapters" className="scroll-mt-[var(--space-8)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="space-y-[var(--space-7)]">
              <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] lg:items-end">
                <div className="space-y-[var(--space-3)]">
                  <PanelEyebrow>The chapters</PanelEyebrow>
                  <PanelTitle as="h2" size="display" className="max-w-[14ch]">
                    Each card says what it stands on.
                  </PanelTitle>
                </div>
                <PanelBody className="max-w-[60ch] text-[length:var(--text-lg)]">
                  Every chapter names what it{' '}
                  <strong className="font-black text-[var(--text-primary)]">assumes</strong> from
                  the chapters below it, what it{' '}
                  <strong className="font-black text-[var(--text-primary)]">underwrites</strong>{' '}
                  above, and which chapter{' '}
                  <strong className="font-black text-[var(--text-primary)]">proves</strong> it.
                  The maturity line on each card is the book&rsquo;s own grade, not a
                  promise: built, built weakly, designed, or a research direction.
                </PanelBody>
              </div>

              <TableOfContents />

              {TABLE_OF_CONTENTS.map((part) => (
                <div key={part.id} className="space-y-[var(--space-5)]">
                  <GroupHeading eyebrow={`Part ${part.numeral}`} title={part.title} description={part.blurb} />
                  <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                    {part.papers.map((paper) => (
                      <ChapterCard key={paper.id} paper={paper} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </PageContainer>
        </section>

        {/* ── Two figures the book keeps returning to ── */}
        <section
          id="the-architecture-drawn"
          className="scroll-mt-[var(--space-8)] border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]"
        >
          <PageContainer width="wide">
            <div className="space-y-[var(--space-3)]">
              <PanelEyebrow>Drawn once</PanelEyebrow>
              <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                The spine and the market.
              </PanelTitle>
              <PanelBody className="max-w-[52ch] text-[length:var(--type-panel-body-size)]">
                Two figures the book keeps returning to: the spine that threads the
                chapters, and the three-sided market of the economy chapter settling onto
                one conserving bond ledger.
              </PanelBody>
            </div>
            <div className="mt-[var(--space-5)] grid gap-[var(--space-6)]">
              <SpineChain />
              <ThreeSidedMarket />
            </div>
          </PageContainer>
        </section>

        {/* ── Install ── */}
        <section className="border-t-2 border-[var(--border-strong)] py-[var(--space-7)] lg:py-[var(--space-8)]">
          <PageContainer width="wide">
            <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:items-center">
              <div className="space-y-[var(--space-3)]">
                <PanelEyebrow>Working software and the finished argument</PanelEyebrow>
                <PanelTitle as="h2" size="section" className="max-w-[18ch]">
                  You need none of the theory for the first benefit.
                </PanelTitle>
                <PanelBody className="max-w-[58ch] text-[length:var(--text-lg)]">
                  The harbor runs now. The economy is the thing it was always for. One
                  command, and two agents that used to collide take turns instead; the
                  book is what you read when you want to know why that is the right first
                  move and what has to come after it.
                </PanelBody>
              </div>
              <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-strong)] p-[var(--space-5)] shadow-[var(--shadow-brutal)]">
                <PanelEyebrow className="mb-[var(--space-3)]">Open the harbor</PanelEyebrow>
                <pre className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] font-mono text-[length:var(--text-base)] leading-[var(--leading-code)] text-[var(--text-primary)]">
                  <code>brew install curiositech/tap/port-daddy &amp;&amp; pd setup</code>
                </pre>
                <PanelBody className="mt-[var(--space-3)] max-w-none text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  <code className="font-mono">pd claim</code> is the single-writer kernel&rsquo;s
                  first sentence; the{' '}
                  <Link to="/docs/quickstart" className="font-black text-[var(--brand-primary)] underline underline-offset-4 hover:no-underline">
                    quickstart
                  </Link>{' '}
                  has two agents coordinated in ten minutes.
                </PanelBody>
              </div>
            </div>
          </PageContainer>
        </section>

        {/* ── Library changelog ── */}
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
                  The manuscript is revised in the open: argued with, proven against,
                  and corrected where a proof or an experiment said so. One entry per
                  wave, newest first. The per-objection history of the adversarial
                  reviews is on{' '}
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
                        {entry.chapters.map((id) => findWhitePaperById(id)?.chapter ?? id).join(' · ')}
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
                ['Lampson', 'Butler Lampson, “Protection” (1971), and James Anderson’s 1972 reference-monitor report — complete mediation, tamper-proof, small enough to verify; the kernel chapter’s standard for an enforcement point.'],
                ['Reputation', 'Elo (1960s) for chess; Bradley–Terry (1952) for paired comparisons; EigenTrust (Kamvar et al., 2003) for networked reputation. On bounded memory: Liu & Skrzypacz (2014).'],
                ['Mechanism design', 'Hurwicz, Maskin, Myerson — Nobel 2007 — rules whose honest outcome survives self-interested play. Myerson–Satterthwaite (1983): no bilateral-trade mechanism is simultaneously efficient, individually rational, and budget-balanced.'],
                ['Formal verification', 'Symbolic analysis and model checking — ProVerif/Tamarin (TLS 1.3, Signal), TLA⁺ (AWS; Newcombe et al., CACM 2015). The proving chapters use ProVerif, TLA⁺, Z3, and the Kani model checker.'],
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
