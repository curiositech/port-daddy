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
  TEXTBOOK,
  findWhitePaperById,
} from '@/data/whitePapers'
import { harborEvolutionFigure } from '@/data/manifestoContent'
import { ThemedImage } from '@/components/site/ThemedImage'
import { RESEARCH_PAPERS, RESEARCH_PAPER_TOTAL_PAGES } from '@/data/researchPapers'

/**
 * /library — the page about the book. It sells one thing, the Book, shows
 * its outline (four parts, eight chapters, one question each), says what it
 * argues and how it is kept honest, lists the seven conference-form papers,
 * and carries the library changelog. It never points at a chapter as a
 * separate document: the chapters are listed, not linked, because the book
 * is one PDF and that is what you download.
 *
 * Art: the Book's own plates (cover, frontispiece, part plates, chapter
 * washes under public/whitepaper/plates/) plus two pieces painted for this
 * page in the same register (public/img/library/). Type comes from the site
 * primitives only.
 */

const REPO = 'https://github.com/curiositech/port-daddy'
const AUTHOR = 'Erich Owens'
const IMPRINT = 'Curiositech'

function megabytes(sizeKb: number): string {
  return `${(sizeKb / 1024).toFixed(1)} MB`
}

/** The four loops between the manuscript and the repository, with where each one runs. */
const HONESTY_LOOPS: Array<{ title: string; body: React.ReactNode; href: string; hrefLabel: string }> = [
  {
    title: 'Every proof the book cites runs on every pull request.',
    body: (
      <>
        The Kani harnesses over the Rust card verifier, every ProVerif model (each
        checked against the result it committed), the relay&rsquo;s TLA<sup>+</sup>{' '}
        specifications with their attack configurations, and the Z3 cubic behind the
        claim-signaling threshold all run in CI. Each one has a negative control
        sitting next to it &mdash; a model that is <em>supposed</em> to fail &mdash; so a
        checker that quietly stopped finding anything would go red instead of green.
        The book&rsquo;s appendix of mechanized claims is generated straight from that
        manifest; nobody types it.
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
        fixed seed. When a chapter walks a number out by hand, it gets the{' '}
        <code>[verified]</code> tag only if that script regenerates it in CI; if the
        only check is the chapter&rsquo;s own derivation, the tag says{' '}
        <code>[internal]</code>, and you should read it that way. The same page tells
        you which of its claims are theorems, which are design invariants, which have
        been model-checked, and which are hypotheses still waiting for a measurement.
      </>
    ),
    href: `${REPO}/tree/main/scripts/harbor-results`,
    hrefLabel: 'the result scripts',
  },
  {
    title: 'What the book cannot settle becomes a pre-registered experiment.',
    body: (
      <>
        The book argues, from a theorem, that confinement needs an enforcement point
        below the agent. What it honestly doesn&rsquo;t know is whether its
        single-writer rail is also the right way for several agents to share one
        repository, compared with the thing the rest of the industry does (a worktree
        per agent and a merge queue). So that question was taken out of the prose and
        turned into a study &mdash; hypotheses, metrics, and a kill criterion written
        down before any code existed &mdash; that replays real commit histories through
        six coordination substrates. Until it reports, the rail stays a design
        invariant; the book won&rsquo;t call it a theorem about collaboration.
      </>
    ),
    href: `${REPO}/tree/main/studies/substrate-study`,
    hrefLabel: 'the study protocol',
  },
  {
    title: 'Claims about the harness itself are graded the same way.',
    body: (
      <>
        A reproducible world plus a schedule of failures is a <em>Genesis</em>; one
        run through it is a <em>Voyage</em>; the behaviour it leaves behind is the{' '}
        <em>Wake</em>, the structured record of that behaviour is the <em>Logbook</em>,
        and the claims we&rsquo;re still willing to make afterward are the{' '}
        <em>Receipt</em>. The point of the vocabulary is a discipline: a claim about
        the harness doesn&rsquo;t count because a feature ran once and looked fine. It
        counts when a controlled Genesis produces a Voyage whose consequential
        transitions have durable evidence and an adjudication receipt behind them.
        The book&rsquo;s front matter adopts the words; the repository keeps the
        documents they came from.
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

/**
 * The Book's own plates, named by the part's numeral and the chapter's
 * prefix, so a part or chapter added to textbook.json picks up its plate
 * without a table to keep in step. `libraryPlates.test.ts` asserts every
 * file exists.
 */
export function partPlate(numeral: string) {
  return `/whitepaper/plates/part-${numeral}.jpg`
}

export function chapterPlate(prefix: string) {
  return `/whitepaper/plates/chapter-${prefix}.jpg`
}

function roleLine(chapterId: string): string | null {
  const record = TEXTBOOK.chapters.find((chapter) => chapter.id === chapterId)
  if (!record) return null
  if (record.role === 'proves' && record.discharges) {
    const target = TEXTBOOK.chapters.find((chapter) => chapter.id === record.discharges)
    return target ? `proves chapter ${target.number}` : 'proves'
  }
  return 'builds'
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
                eyebrow="The whitepaper"
                titleAs="h1"
                titleSize="hero"
                titleClassName="max-w-[15ch]"
                title="One book about what happens after you walk away."
                description={
                  <>
                    You hand a goal to a program, leave the room, and come back to find ten
                    agents on the repo &mdash; two of them edited the same file (the second
                    erased the first), and a third made the tests pass by deleting them.
                    Nothing inside any one of those agents caused that. The failure lives
                    <em> between</em> them, in the place where nobody was keeping the record,
                    and this book is the long argument for keeping it &mdash; and for what
                    becomes possible once you do.
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
                  { value: String(chapterCount), label: 'chapters, in the order the argument needs', tone: 'paper' },
                  { value: String(COLLECTED_VOLUME.pages), label: `pages, ${TEXTBOOK.edition.version}`, tone: 'paper' },
                ]}
              />

              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a href="#outline">
                    The outline
                    <ArrowRight aria-hidden="true" size={14} />
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <a href="#kept-honest">How the book is kept honest</a>
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

        {/* ── The outline: four parts, eight chapters, one question each ── */}
        <LandingSection>
          <div id="outline" className="scroll-mt-[var(--space-8)] space-y-[var(--space-7)]">
            <LandingSectionIntro
              eyebrow="The outline"
              title="Four parts, eight chapters, one question each."
              description="Every chapter opens on a single question and won't do anything else until it has answered it. The order isn't editorial; it's structural — each chapter stands on the ones before it, and each proving chapter sits right after the chapter whose promises it has to keep. Read the eight questions on their own and you'll have the shape of the argument."
            />

            <ol className="grid gap-[var(--space-7)]">
              {TEXTBOOK.parts.map((part) => (
                <li key={part.id} className="grid gap-[var(--space-5)] border-t-2 border-[var(--border-strong)] pt-[var(--space-6)] lg:grid-cols-12">
                  <div className="lg:col-span-4">
                    <img
                      src={partPlate(part.numeral)}
                      alt={`Part ${part.numeral} plate: ${part.title}`}
                      className="mb-[var(--space-4)] block aspect-[7/10] w-full max-w-[22rem] border-2 border-[var(--border-strong)] object-cover"
                      loading="lazy"
                    />
                    <PanelEyebrow>Part {part.numeral}</PanelEyebrow>
                    <PanelTitle as="h3" size="section" className="mt-[var(--space-1)]">
                      {part.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="mt-[var(--space-2)] max-w-none">
                      {part.blurb}
                    </PanelBody>
                  </div>
                  <ol className="grid gap-[var(--space-4)] lg:col-span-8">
                    {part.chapters.map((chapterId) => {
                      const chapter = TEXTBOOK.chapters.find((candidate) => candidate.id === chapterId)
                      if (!chapter) return null
                      const role = roleLine(chapter.id)
                      return (
                        <li
                          key={chapter.id}
                          className="grid grid-cols-[minmax(4.5rem,7rem),1fr] gap-[var(--space-4)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)] first:border-t-0 first:pt-0"
                        >
                          <img
                            src={chapterPlate(chapter.prefix)}
                            alt=""
                            aria-hidden="true"
                            className="block aspect-[3/4] w-full border-2 border-[var(--border-default)] object-cover"
                            loading="lazy"
                          />
                          <div className="min-w-0 space-y-[var(--space-1)]">
                            <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                              <PanelEyebrow>Chapter {chapter.number}</PanelEyebrow>
                              {role ? <BracketLabel>{role}</BracketLabel> : null}
                            </div>
                            <PanelTitle as="h4" size="card">
                              {chapter.title}
                            </PanelTitle>
                            <PanelBody size="compact" className="max-w-none italic text-[var(--text-primary)]">
                              {chapter.question}
                            </PanelBody>
                            <PanelBody size="compact" className="max-w-none">
                              {chapter.oneLine}
                            </PanelBody>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </li>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── What the manuscript argues ── */}
        <LandingSection>
          <div className="grid gap-[var(--space-7)] lg:grid-cols-12 lg:items-start">
            <div className="space-y-[var(--space-6)] lg:col-span-7">
              <LandingSectionIntro
                eyebrow="What it argues"
                title="From the machine, up to the market."
                description="One sentence holds the whole book together (it's just below). Pull any link out of it and everything above that link comes down, which is why the harbor has to come before the economy, and why the foundation turns out to be memory rather than cryptography — a surprise the first time you see it, and obvious afterward."
              />
              <SurfacePanel elevation="quiet" className="space-y-[var(--space-2)]">
                <PanelEyebrow>The spine</PanelEyebrow>
                <PanelTitle as="p" size="card">
                  {LIBRARY_SPINE}
                </PanelTitle>
              </SurfacePanel>
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>How every claim is labelled</PanelEyebrow>
                <PanelBody className="max-w-none">
                  Every important sentence in the book wears one of four labels, and they
                  don&rsquo;t get promoted into one another. A <strong>theorem</strong> follows
                  from a stated model; a <strong>design invariant</strong> is something the
                  system is built to keep, backed by code and tests rather than a proof; a{' '}
                  <strong>model-checked property</strong> holds for a bounded model that a
                  checker actually exhausted; and an <strong>empirical hypothesis</strong> is
                  a claim still waiting on a measurement. Anything said about the running
                  system also names its assurance mode &mdash; Observed, Coordinated,
                  Brokered, Confined, or Attested, in increasing order of how much the harbor
                  itself enforces &mdash; so you can always tell a promise from a property.
                </PanelBody>
              </div>
              <div className="space-y-[var(--space-2)]">
                <PanelEyebrow>What page one admits</PanelEyebrow>
                <PanelBody className="max-w-none">
                  The book is ahead of the product and says so on its first page rather
                  than in a footnote. Running today: the daemon and its single-writer record,
                  the operator&rsquo;s projections of it, durable work records, a card
                  checker whose proofs are bounded (not full), and the relay. Modelled and
                  machine-checked but not yet running: the sealed room, attenuation at every
                  hop, the incentive to signal claims truthfully, and the bond ledger&rsquo;s
                  conservation law. Proposed, and neither built nor modelled: the confined
                  mode itself, settlement across authorities, and the federation&rsquo;s
                  witness log. The honest consequence is that the git shim and the
                  coordination guard you can install today are interim instruments &mdash;
                  the book wants an enforcement point <em>below</em> the agent, and it
                  doesn&rsquo;t pretend a hook is one.
                </PanelBody>
              </div>
            </div>
            <figure className="lg:col-span-5">
              <img
                src="/whitepaper/plates/frontispiece.jpg"
                alt="The book’s frontispiece: an engraved colossus standing waist-deep in a harbour, its torso an open clockwork movement worked over with circuit tracery and picked out in gold, a blank banner above it and ten small framed vignettes below."
                className="block w-full border-2 border-[var(--border-strong)] object-cover"
                loading="lazy"
              />
              <figcaption className="mt-[var(--space-2)]">
                <PanelBody size="compact" className="max-w-none">
                  The frontispiece, engraved after Hobbes: a colossus in a harbour, and ten
                  small compartments of the ordinary things it is made of. Its body used to
                  be a grid of clerks at desks &mdash; it is a movement now, gears and circuit
                  tracery with gold in the trim, which is closer to what the book actually
                  argues.
                </PanelBody>
              </figcaption>
            </figure>
          </div>
          <SurfacePanel padding="compact" className="mt-[var(--space-7)] p-0">
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
        </LandingSection>

        {/* ── How the book is kept honest ── */}
        <LandingSection>
          <div id="kept-honest" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <img
              src="/img/library/library-honest.jpg"
              alt="A lighthouse keeper’s logbook open on a scarred table beside a small brass balance weighing a feather against a pebble; through the window an immense pale planet fills the sky. Faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            <LandingSectionIntro
              eyebrow="How the book is kept honest"
              title="The book and the code push on each other."
              description="A manuscript about accountable work had better be honest about itself, so four loops run between these chapters and the repository, and you can watch each of them turn. Whatever a chapter proves, CI re-checks on every pull request. Whatever a chapter measures, a script regenerates from a fixed seed. Whatever a chapter can't settle from its own results gets written up as an experiment (hypotheses first, code second). And whatever the product learns from running comes back around as the next revision of the text."
            />
            <ol className="grid gap-[var(--space-5)]">
              {HONESTY_LOOPS.map((loop, index) => (
                <li
                  key={loop.title}
                  className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)] lg:grid-cols-12"
                >
                  <div className="lg:col-span-4">
                    <PanelEyebrow>{String(index + 1).padStart(2, '0')}</PanelEyebrow>
                    <PanelTitle as="h3" size="nav" className="mt-[var(--space-1)]">
                      {loop.title}
                    </PanelTitle>
                  </div>
                  <div className="space-y-[var(--space-3)] lg:col-span-8">
                    <PanelBody size="compact" className="max-w-none">
                      {loop.body}
                    </PanelBody>
                    <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                      <a href={loop.href}>
                        {loop.hrefLabel}
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </a>
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
            <SurfacePanel elevation="quiet" className="space-y-[var(--space-2)]">
              <PanelEyebrow>What the book still owes</PanelEyebrow>
              <PanelBody className="max-w-none">
                The manuscript names its own gaps instead of papering over them. There is
                no procedure yet for moving write authority from one harbor to another; the
                release ledger has only been written in the customer&rsquo;s direction, not
                the provider&rsquo;s; nobody has done the arithmetic of disputes and partial
                work; there&rsquo;s no constitution for who may suspend a publisher; and the
                evidence labels the product uses and the claim kinds the book uses still
                live in two tables when they should be one. Each of those is a section owed
                to a later revision, and each is tracked in the open next to the product
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
                  The chapters fold every one of these results in as a labelled claim with
                  its proof, so you don&rsquo;t need the papers to read the book. They exist
                  because a program committee wants a different shape than a reader does
                  &mdash; abstract, related work, the theorem, the experiment, and nothing
                  else &mdash; and {RESEARCH_PAPER_TOTAL_PAGES} pages across{' '}
                  {RESEARCH_PAPERS.length} of them is what that shape costs. Each has been
                  adversarially reviewed. Pick one up when you want a single result without
                  the book around it.
                </>
              }
            />
            <ol className="grid gap-[var(--space-3)]">
              {RESEARCH_PAPERS.map((paper) => {
                const home = findWhitePaperById(paper.chapterRef)
                return (
                  <li
                    key={paper.id}
                    className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] sm:grid-cols-[minmax(3rem,4rem),1fr,auto] sm:gap-[var(--space-4)]"
                  >
                    <span aria-hidden="true">
                      <PanelTitle as="span" size="card">
                        {paper.number}
                      </PanelTitle>
                    </span>
                    <div className="min-w-0 space-y-[var(--space-1)]">
                      <PanelTitle as="h3" size="nav">
                        {paper.title}
                      </PanelTitle>
                      <PanelEyebrow>{paper.subtitle}</PanelEyebrow>
                      <PanelBody size="compact" className="max-w-none">
                        {paper.claim}
                        {home ? ` Folded into chapter ${home.chapter}, ${home.title}.` : ''}
                      </PanelBody>
                    </div>
                    <div className="flex items-start">
                      <Button asChild variant="ghost" size="sm" className="whitespace-normal text-left">
                        <a href={paper.pdfPath}>
                          PDF · {paper.pages} pp · {megabytes(paper.sizeKb)}
                        </a>
                      </Button>
                    </div>
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

        {/* ── Two figures the book keeps returning to ── */}
        <LandingSection>
          <div id="the-architecture-drawn" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Drawn once"
              title="The spine and the market."
              description="Two figures the book keeps coming back to: the spine that threads the chapters together, and the economy chapter's three-sided market settling onto one bond ledger that conserves."
            />
            <div className="grid gap-[var(--space-6)]">
              <SpineChain />
              <ThreeSidedMarket />
            </div>
          </div>
        </LandingSection>

        {/* ── Install ── */}
        <LandingSection>
          <img
            src="/img/library/library-harbor.jpg"
            alt="A small fishing boat entering a harbour mouth between two tiny lights at dusk; above the clouds, the faint colossal hull of something far larger passes over. Faded watercolour."
            className="mb-[var(--space-6)] block aspect-[21/9] w-full border-2 border-[var(--border-strong)] object-cover"
            loading="lazy"
          />
          <div className="grid gap-[var(--space-6)] lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-7">
              <LandingSectionIntro
                eyebrow="Working software and the finished argument"
                title="You need none of the theory for the first benefit."
                description="The harbor runs now; the economy is the thing it was always for. One command and two agents that used to collide start taking turns — that's the whole first benefit, and it needs none of the theory. The book is for the evening you want to know why that was the right first move, and what has to come after it."
              />
            </div>
            <SurfacePanel className="space-y-[var(--space-3)] lg:col-span-5">
              <PanelEyebrow>Open the harbor</PanelEyebrow>
              <CommandBlock command="brew install curiositech/tap/port-daddy && pd setup" title="install" />
              <PanelBody size="compact" className="max-w-none">
                <code>pd claim</code> is the single-writer kernel&rsquo;s first sentence, spoken out loud; the{' '}
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
                    The manuscript is revised in the open &mdash; argued with, proven against,
                    and corrected wherever a proof or an experiment said it had to be. One
                    entry per wave, newest first. If you want the objection-by-objection
                    history of the adversarial reviews, that lives on{' '}
                    <Link to="/whitepaper/rounds" className="text-[var(--text-primary)] underline underline-offset-4 hover:text-[var(--brand-primary)] hover:no-underline">
                      the review rounds
                    </Link>
                    .
                  </>
                }
              />
            </div>
            <ol className="grid gap-[var(--space-4)] lg:col-span-8">
              {LIBRARY_CHANGELOG.map((entry) => (
                <li key={`${entry.date}-${entry.title}`} className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)]">
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
                </li>
              ))}
            </ol>
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
