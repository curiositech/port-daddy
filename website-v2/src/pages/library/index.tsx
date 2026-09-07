import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Download } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { SpineChain } from '@/components/library/SpineChain'
import { ThreeSidedMarket } from '@/components/library/ThreeSidedMarket'
import { Button } from '@/components/ui/Button'
import {
  BracketLabel,
  CommandBlock,
  LandingSection,
  LandingSectionIntro,
  LandingStatsStrip,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
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
 * papers fit. It sells one download, the Book, and points at chapters rather
 * than at detached per-chapter files.
 *
 * Every piece of type on this page comes from the site primitives (eyebrow,
 * title, body, button); the page adds layout, never a font role of its own.
 * Every number comes from whitepaper/textbook.json and the registry.
 */

const REPO = 'https://github.com/curiositech/port-daddy'
const AUTHOR = 'Erich Owens'
const IMPRINT = 'Curiositech'

function megabytes(sizeKb: number): string {
  return `${(sizeKb / 1024).toFixed(1)} MB`
}

const CROSS_REF_KINDS = [
  { key: 'assumes', label: 'Assumes' },
  { key: 'underwrites', label: 'Underwrites' },
  { key: 'provedBy', label: 'Proved by' },
  { key: 'proves', label: 'Proves' },
] as const

/** How the manuscript and the repository push on each other: one loop per card, with where to see it run. */
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
        <code>[verified]</code> only if that script regenerates it in CI, and{' '}
        <code>[internal]</code> when only the chapter&rsquo;s own derivation does. The
        page also says which claims are theorems, which are design invariants, which
        are model-checked, and which are still hypotheses awaiting measurement.
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

const LINEAGE: Array<[string, string]> = [
  ['Hobbes', 'Thomas Hobbes, Leviathan (1651): the war of all against all, and rational consent to a common authority.'],
  ['Ostrom', 'Elinor Ostrom, Governing the Commons (1990); Nobel, 2009. Shared resources are governed by local institutions with clear rules and records. Cf. Hardin, The Tragedy of the Commons (Science, 1968).'],
  ['Scott', 'James C. Scott, Seeing Like a State (1998): legibility as the instrument of governance, and the danger of flattening away local knowledge.'],
  ['Parfit', 'Derek Parfit, Reasons and Persons (1984): identity as psychological continuity rather than a fixed essence.'],
  ['Lampson', 'Butler Lampson, Protection (1971), and James Anderson’s 1972 reference-monitor report: complete mediation, tamper-proof, small enough to verify; the kernel chapter’s standard for an enforcement point.'],
  ['Reputation', 'Elo (1960s) for chess; Bradley–Terry (1952) for paired comparisons; EigenTrust (Kamvar et al., 2003) for networked reputation. On bounded memory: Liu and Skrzypacz (2014).'],
  ['Mechanism design', 'Hurwicz, Maskin, Myerson (Nobel, 2007): rules whose honest outcome survives self-interested play. Myerson–Satterthwaite (1983): no bilateral-trade mechanism is simultaneously efficient, individually rational, and budget-balanced.'],
  ['Formal verification', 'Symbolic analysis and model checking: ProVerif and Tamarin (TLS 1.3, Signal), TLA⁺ (AWS; Newcombe et al., CACM 2015). The proving chapters use ProVerif, TLA⁺, Z3, and the Kani model checker.'],
]

function chapterLabel(id: string): string {
  const paper = findWhitePaperById(id)
  return paper ? `${paper.chapter} · ${paper.title}` : id
}

function chapterRecord(id: string) {
  return TEXTBOOK.chapters.find((chapter) => chapter.id === id)
}

function CrossRefRow({ label, edges }: { label: string; edges: Array<{ id: string; why: string }> }) {
  return (
    <div className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0 sm:grid-cols-[minmax(7rem,auto),1fr] sm:gap-[var(--space-4)]">
      <PanelEyebrow>{label}</PanelEyebrow>
      <ul className="grid gap-[var(--space-2)]">
        {edges.map((edge) => (
          <li key={`${label}-${edge.id}`}>
            <PanelBody as="span" size="compact" className="max-w-none">
              <Link
                to={`/whitepaper/${findWhitePaperById(edge.id)?.slug ?? ''}`}
                className="text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline"
              >
                {chapterLabel(edge.id)}
              </Link>
              {' '}&mdash; {edge.why}
            </PanelBody>
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
    return <CrossRefRow key={kind.key} label={kind.label} edges={edges} />
  }).filter(Boolean)

  return (
    <SurfacePanel className="grid gap-[var(--panel-gap)]" padding="default">
      <article id={`chapter-${paper.id}`} className="grid gap-[var(--panel-gap)]">
        <header className="grid grid-cols-[var(--space-7),1fr] gap-[var(--space-4)]">
          <span aria-hidden="true">
            <PanelTitle as="span" size="display">
              {paper.chapter}
            </PanelTitle>
          </span>
          <div className="min-w-0 space-y-[var(--space-2)]">
            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
              <BracketLabel>{chapterRoleLabel(paper)}</BracketLabel>
              <PanelEyebrow>{paper.layer}</PanelEyebrow>
            </div>
            <PanelTitle as="h3" size="card">
              {paper.title}
            </PanelTitle>
            {record ? (
              <PanelBody size="compact" className="max-w-none italic text-[var(--text-primary)]">
                {record.question}
              </PanelBody>
            ) : null}
          </div>
        </header>

        <PanelBody className="max-w-none">{paper.claim}</PanelBody>

        <div className="space-y-[var(--space-1)]">
          <PanelEyebrow>Maturity, in the book&rsquo;s own grade</PanelEyebrow>
          <PanelBody size="compact" className="max-w-none">
            {paper.maturity}
          </PanelBody>
        </div>

        {refRows.length > 0 ? (
          <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
            {refRows}
          </SurfacePanel>
        ) : null}

        <div>
          <Button asChild variant="primary" size="md">
            <Link to={paper.readerHref}>
              Read the chapter
              <ArrowRight aria-hidden="true" size={14} />
            </Link>
          </Button>
        </div>
      </article>
    </SurfacePanel>
  )
}

export default function LibraryPage() {
  const chapterCount = TEXTBOOK.chapters.length
  const partCount = TEXTBOOK.parts.length
  const editions = COLLECTED_VOLUME.editions ?? []

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Hero: the reader's situation, then the book, sold as a book ── */}
        <LandingSection>
          <div className="grid gap-[var(--space-7)] lg:grid-cols-12 lg:items-start">
            <div className="space-y-[var(--space-6)] lg:col-span-7">
              <SectionIntro
                eyebrow="The Harbor Library"
                titleAs="h1"
                titleSize="hero"
                titleClassName="max-w-[15ch]"
                title="One book about what happens after you walk away."
                description={
                  <>
                    You can hand a goal to a program and leave the room. Come back and ten
                    agents are on the repo. Two edited the same file, and the second erased
                    the first. One made the tests pass by deleting them. Nothing inside any
                    one agent caused that. The failure lives between them, in the place where
                    nobody keeps the record. This book is the argument for keeping it, and
                    for what follows once you do.
                  </>
                }
              />

              <SurfacePanel elevation="quiet" className="space-y-[var(--space-2)]">
                <PanelEyebrow>The one claim, from page one</PanelEyebrow>
                <PanelTitle as="p" size="card">
                  {TEXTBOOK.edition.claim}
                </PanelTitle>
              </SurfacePanel>

              <LandingStatsStrip
                stats={[
                  { value: String(partCount), label: 'parts', tone: 'paper' },
                  { value: String(chapterCount), label: 'chapters, in dependency order', tone: 'paper' },
                  { value: String(COLLECTED_VOLUME.pages), label: `pages, ${TEXTBOOK.edition.version}`, tone: 'paper' },
                ]}
              />

              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a href="#the-questions">
                    Start with the questions
                    <ArrowRight aria-hidden="true" size={14} />
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <a href="#the-loop">How it is held to account</a>
                </Button>
              </div>
            </div>

            {/* The book, as a bookseller would show it: cover, title, author, format, size. */}
            <SurfacePanel className="space-y-[var(--panel-gap)] lg:col-span-5" padding="default">
              <img
                src="/whitepaper/plates/cover-maritime.jpg"
                width={1000}
                height={1429}
                alt={`Front cover of ${TEXTBOOK.edition.title}: the title over a faded watercolour of a colossal presence above a small harbor.`}
                className="block aspect-[7/10] w-full border-2 border-[var(--border-strong)] object-cover"
                loading="eager"
              />
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>{IMPRINT} · {TEXTBOOK.edition.date}</PanelEyebrow>
                <PanelTitle as="h2" size="card">
                  {TEXTBOOK.edition.title}
                </PanelTitle>
                <PanelBody size="compact" className="max-w-none">
                  {TEXTBOOK.edition.subtitle}. {AUTHOR}. {TEXTBOOK.edition.version}.
                </PanelBody>
                <PanelBody size="compact" className="max-w-none text-[var(--text-primary)]">
                  PDF · {COLLECTED_VOLUME.pages} pages · {megabytes(COLLECTED_VOLUME.sizeKb)} · {COLLECTED_VOLUME.references} references · free
                </PanelBody>
              </div>
              <Button asChild variant="primary" size="lg" className="w-full">
                <a href={COLLECTED_VOLUME.downloadUrl} download>
                  <Download aria-hidden="true" size={16} />
                  Download the book (PDF)
                </a>
              </Button>
              {editions.length > 0 ? (
                <div className="space-y-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
                  <PanelEyebrow>The same book, set two other ways</PanelEyebrow>
                  <ul className="grid grid-cols-2 gap-[var(--space-3)]">
                    {editions.map((edition) => (
                      <li key={edition.id}>
                        <a
                          href={edition.pdfPath}
                          download
                          className="group grid gap-[var(--space-2)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
                        >
                          <img
                            src={`/whitepaper/plates/cover-${edition.id.replace('coordination-papers-mega-volume-', '')}.jpg`}
                            width={1000}
                            height={1429}
                            alt={`Front cover of the ${edition.title}`}
                            className="block aspect-[7/10] w-full border-2 border-[var(--border-default)] object-cover transition-colors group-hover:border-[var(--border-strong)]"
                            loading="lazy"
                          />
                          <PanelBody as="span" size="compact" className="max-w-none">
                            {edition.title} · PDF · {edition.pages} pp · {megabytes(edition.sizeKb)}
                          </PanelBody>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </SurfacePanel>
          </div>
        </LandingSection>

        {/* ── The eight questions, in the order they have to be asked ── */}
        <LandingSection>
          <div id="the-questions" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="The questions"
              title="Eight questions, in the order they have to be asked."
              description="Each chapter opens on one question and answers it before it does anything else. The order is the dependency order: a chapter stands on the ones before it, and each proving chapter follows the chapter whose promises it keeps. Read the questions alone and you have the argument."
            />
            <ol className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
              {TEXTBOOK.chapters.map((chapter) => (
                <li key={chapter.id} className="min-w-0">
                  <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]" padding="compact">
                    <span aria-hidden="true">
                      <PanelTitle as="span" size="display">
                        {chapter.number}
                      </PanelTitle>
                    </span>
                    <PanelTitle as="p" size="nav">
                      {chapter.question}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {chapter.oneLine}
                    </PanelBody>
                    <div className="mt-auto">
                      <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                        <Link to={findWhitePaperById(chapter.id)?.readerHref ?? '/library'}>
                          {chapter.title}
                          <ArrowRight aria-hidden="true" size={14} />
                        </Link>
                      </Button>
                    </div>
                  </SurfacePanel>
                </li>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── What the manuscript argues ── */}
        <LandingSection>
          <div className="space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="What it argues"
              title="From the machine, up to the market."
              description="One sentence holds the whole book together. Pull out any link and the chain above it falls, which is why the harbor comes before the economy and why memory, not cryptography, is the foundation."
            />
            <SurfacePanel elevation="quiet" className="space-y-[var(--space-2)]">
              <PanelEyebrow>The spine</PanelEyebrow>
              <PanelTitle as="p" size="card">
                {LIBRARY_SPINE}
              </PanelTitle>
            </SurfacePanel>

            <div className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4">
              {TEXTBOOK.parts.map((part) => (
                <SurfacePanel key={part.id} padding="compact" className="space-y-[var(--space-2)]">
                  <PanelEyebrow>Part {part.numeral}</PanelEyebrow>
                  <PanelTitle as="h3" size="nav">
                    {part.title}
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {part.blurb}
                  </PanelBody>
                </SurfacePanel>
              ))}
            </div>

            <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
              <SurfacePanel className="space-y-[var(--space-3)]">
                <PanelEyebrow>How every claim is labelled</PanelEyebrow>
                <PanelBody className="max-w-none">
                  A <strong>theorem</strong> follows from a stated model. A{' '}
                  <strong>design invariant</strong> is meant to hold and is backed by code
                  and tests. A <strong>model-checked property</strong> holds for a bounded
                  model a checker exhausted. An <strong>empirical hypothesis</strong> is
                  waiting to be measured. Runtime claims name one of five assurance modes,
                  Observed, Coordinated, Brokered, Confined, Attested, in increasing order
                  of what the harbor itself enforces. None is promoted into another.
                </PanelBody>
              </SurfacePanel>
              <SurfacePanel className="space-y-[var(--space-3)]">
                <PanelEyebrow>What page one admits</PanelEyebrow>
                <PanelBody className="max-w-none">
                  The daemon, its single-writer record, the operator projections, the durable
                  work records, a bounded-verified card checker, and the relay run today. The
                  sealed room, attenuation at every hop, the claim-signaling incentive, and
                  the bond ledger&rsquo;s conservation are modelled and machine-checked but
                  not running. The confined mode itself, cross-authority settlement, and the
                  federation&rsquo;s witness log are proposed. The book prescribes an
                  enforcement point below the agent and treats today&rsquo;s tool-level
                  interceptors as interim.
                </PanelBody>
              </SurfacePanel>
            </div>

            <SurfacePanel padding="compact" className="p-0">
              <figure>
                <ThemedImage
                  src={harborEvolutionFigure.src}
                  alt={harborEvolutionFigure.alt}
                  className="block w-full border-b-2 border-[var(--border-strong)] object-cover"
                  loading="lazy"
                />
                <div className="grid gap-px border-b-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-3">
                  {harborEvolutionFigure.stages.map((stage) => (
                    <div key={stage.numeral} className="space-y-[var(--space-2)] bg-[var(--surface-base)] p-[var(--space-4)]">
                      <PanelTitle as="p" size="card">
                        {stage.numeral}
                      </PanelTitle>
                      <PanelBody size="compact" className="max-w-none">
                        {stage.label}
                      </PanelBody>
                    </div>
                  ))}
                </div>
                <figcaption className="p-[var(--space-4)]">
                  <PanelBody size="compact" className="max-w-none">
                    {harborEvolutionFigure.caption}
                  </PanelBody>
                </figcaption>
              </figure>
            </SurfacePanel>
          </div>
        </LandingSection>

        {/* ── The loop: how the book and the code push on each other ── */}
        <LandingSection>
          <div id="the-loop" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Held to account"
              title="The book and the code push on each other."
              description="A manuscript about accountable work has to be accountable itself. Four loops run between these chapters and the repository, and each one is visible: what a chapter proves, CI checks; what a chapter measures, a script regenerates; what a chapter cannot settle becomes an experiment with its hypotheses written down first; and what the product learns comes back as the next revision."
            />
            <ol className="grid gap-[var(--space-4)] lg:grid-cols-2">
              {ACCOUNTABILITY_LOOPS.map((loop, index) => (
                <li key={loop.title} className="min-w-0">
                  <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                    <PanelEyebrow>{String(index + 1).padStart(2, '0')}</PanelEyebrow>
                    <PanelTitle as="h3" size="nav">
                      {loop.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {loop.body}
                    </PanelBody>
                    <div className="mt-auto">
                      <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                        <a href={loop.href}>
                          {loop.hrefLabel}
                          <ArrowUpRight aria-hidden="true" size={14} />
                        </a>
                      </Button>
                    </div>
                  </SurfacePanel>
                </li>
              ))}
            </ol>
            <SurfacePanel elevation="quiet" className="space-y-[var(--space-2)]">
              <PanelEyebrow>What the book still owes</PanelEyebrow>
              <PanelBody className="max-w-none">
                The manuscript names its own gaps rather than papering them: a procedure for
                moving write authority between harbors, the release ledger run in the
                provider&rsquo;s direction, the arithmetic of disputes and partial work, a
                constitution for who may suspend a publisher, and one table joining the
                evidence labels the product uses with the claim kinds the book uses. Each is
                a section in a later revision, and each is tracked in the open with the
                decision that asked for it.
              </PanelBody>
              <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                <Link to="/research#open-problems">
                  The open problems, with the studies and proofs behind the book
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </Button>
            </SurfacePanel>
          </div>
        </LandingSection>

        {/* ── The seven conference-form papers ── */}
        <LandingSection>
          <div className="space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="The research papers, in conference form"
              title="Seven papers, one result each, written for a program committee."
              description={
                <>
                  The chapters fold these results in as labelled claims with their proofs.
                  The papers keep the form a reviewer expects: abstract, related work, the
                  theorem, the experiment, {RESEARCH_PAPER_TOTAL_PAGES} pages across{' '}
                  {RESEARCH_PAPERS.length} of them, each adversarially reviewed. Read one when
                  you want a single result without the book around it.
                </>
              }
            />
            <ol className="grid gap-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-3">
              {RESEARCH_PAPERS.map((paper) => {
                const home = findWhitePaperById(paper.chapterRef)
                return (
                  <li key={paper.id} className="min-w-0">
                    <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]" padding="compact">
                      <PanelEyebrow>Paper {paper.number} · {paper.subtitle}</PanelEyebrow>
                      <PanelTitle as="h3" size="nav">
                        {paper.title}
                      </PanelTitle>
                      <PanelBody size="compact" className="max-w-none">
                        {paper.claim}
                      </PanelBody>
                      {home ? (
                        <PanelBody size="compact" className="max-w-none">
                          Folded into chapter {home.chapter}, {home.title}: {paper.chapterWhy}.
                        </PanelBody>
                      ) : null}
                      <div className="mt-auto flex flex-wrap gap-[var(--space-2)]">
                        <Button asChild variant="secondary" size="sm">
                          <Link to={`/research#paper-${paper.number}`}>About the paper</Link>
                        </Button>
                        <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                          <a href={paper.pdfPath}>
                            PDF · {paper.pages} pp · {megabytes(paper.sizeKb)}
                          </a>
                        </Button>
                      </div>
                    </SurfacePanel>
                  </li>
                )
              })}
            </ol>
            <div>
              <Button asChild variant="primary" size="lg" className="whitespace-normal text-center">
                <Link to="/research">
                  The research program: results, studies, open problems
                  <ArrowRight aria-hidden="true" size={16} />
                </Link>
              </Button>
            </div>
          </div>
        </LandingSection>

        {/* ── The chapters, part by part, in the order the argument needs ── */}
        <LandingSection>
          <div id="the-chapters" className="scroll-mt-[var(--space-8)] space-y-[var(--space-7)]">
            <LandingSectionIntro
              eyebrow="The chapters"
              title="Each card says what it stands on."
              description="Every chapter names what it assumes from the chapters below it, what it underwrites above, and which chapter proves it. The maturity line on each card is the book's own grade, not a promise: built, built weakly, designed, or a research direction."
            />
            {TABLE_OF_CONTENTS.map((part) => (
              <div key={part.id} className="space-y-[var(--space-5)]">
                <SectionIntro eyebrow={`Part ${part.numeral}`} title={part.title} description={part.blurb} titleSize="section" />
                <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                  {part.papers.map((paper) => (
                    <ChapterCard key={paper.id} paper={paper} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </LandingSection>

        {/* ── Two figures the book keeps returning to ── */}
        <LandingSection>
          <div id="the-architecture-drawn" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Drawn once"
              title="The spine and the market."
              description="Two figures the book keeps returning to: the spine that threads the chapters, and the three-sided market of the economy chapter settling onto one conserving bond ledger."
            />
            <div className="grid gap-[var(--space-6)]">
              <SpineChain />
              <ThreeSidedMarket />
            </div>
          </div>
        </LandingSection>

        {/* ── Install ── */}
        <LandingSection>
          <div className="grid gap-[var(--space-6)] lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7">
              <LandingSectionIntro
                eyebrow="Working software and the finished argument"
                title="You need none of the theory for the first benefit."
                description="The harbor runs now. The economy is the thing it was always for. One command, and two agents that used to collide take turns instead; the book is what you read when you want to know why that is the right first move and what has to come after it."
              />
            </div>
            <SurfacePanel className="space-y-[var(--space-3)] lg:col-span-5">
              <PanelEyebrow>Open the harbor</PanelEyebrow>
              <CommandBlock command="brew install curiositech/tap/port-daddy && pd setup" title="install" />
              <PanelBody size="compact" className="max-w-none">
                <code>pd claim</code> is the single-writer kernel&rsquo;s first sentence; the{' '}
                <Link to="/docs/quickstart" className="text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline">
                  quickstart
                </Link>{' '}
                has two agents coordinated in ten minutes.
              </PanelBody>
            </SurfacePanel>
          </div>
        </LandingSection>

        {/* ── Library changelog ── */}
        <LandingSection>
          <div id="library-changelog" className="scroll-mt-[var(--space-8)] grid gap-[var(--space-6)] lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionIntro
                eyebrow="Library changelog"
                title="What changed, and when."
                titleSize="section"
                description={
                  <>
                    The manuscript is revised in the open: argued with, proven against, and
                    corrected where a proof or an experiment said so. One entry per wave,
                    newest first. The per-objection history of the adversarial reviews is on{' '}
                    <Link to="/whitepaper/rounds" className="text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline">
                      the review rounds
                    </Link>
                    .
                  </>
                }
              />
            </div>
            <div className="grid gap-[var(--space-4)] lg:col-span-8">
              {LIBRARY_CHANGELOG.map((entry) => (
                <SurfacePanel key={`${entry.date}-${entry.title}`} className="grid gap-[var(--space-3)]">
                  <article className="grid gap-[var(--space-3)]">
                    <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                      <PanelEyebrow>
                        <time dateTime={entry.dateIso}>{entry.date}</time>
                      </PanelEyebrow>
                      <PanelEyebrow>
                        Chapters {entry.chapters.map((id) => findWhitePaperById(id)?.chapter ?? id).join(' · ')}
                      </PanelEyebrow>
                    </div>
                    <PanelTitle as="h3" size="nav">
                      {entry.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {entry.summary}
                    </PanelBody>
                  </article>
                </SurfacePanel>
              ))}
            </div>
          </div>
        </LandingSection>

        {/* ── References (the introduction's footnotes) ── */}
        <section className="py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
          <PageContainer width="wide" className="space-y-[var(--space-5)]">
            <PanelEyebrow>References and intellectual lineage</PanelEyebrow>
            <ol className="grid gap-[var(--space-3)] lg:grid-cols-2">
              {LINEAGE.map(([term, body]) => (
                <li key={term} className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] sm:grid-cols-[minmax(9rem,auto),1fr] sm:gap-[var(--space-4)]">
                  <PanelEyebrow>{term}</PanelEyebrow>
                  <PanelBody size="compact" className="max-w-none">
                    {body}
                  </PanelBody>
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
