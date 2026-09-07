import * as React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, BookOpen, Download } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/Button'
import {
  BracketLabel,
  LandingSection,
  LandingSectionIntro,
  LandingStatsStrip,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import program from '@/data/harborResearchProgram.json'
import { RESEARCH_PAPERS, type ResearchPaper } from '@/data/researchPapers'
import { COLLECTED_VOLUME, TEXTBOOK, findWhitePaperById } from '@/data/whitePapers'

/**
 * /research — the Harbor research program on one page: the seven
 * conference-form papers, the executed results and where each lives in the
 * book, the mechanized estate, the studies under way, the planned lifts, the
 * open problems, and the wrong turns kept on the record.
 *
 * Every number here is read from `harborResearchProgram.json`, the site's
 * byte-identical mirror of `docs/harbor-research/program.json`. That file is
 * derived from the library index, the corpus manifest, and the critique
 * ledger by `scripts/harbor-research/check_research_program.py`, which CI
 * runs on every pull request that touches the program; the mirror test in
 * `harborResearchProgram.test.ts` fails the site build if the two diverge.
 * Nothing on this page is typed twice.
 */

const REPO = 'https://github.com/curiositech/port-daddy'
const blob = (path: string) => `${REPO}/blob/main/${path}`
const tree = (path: string) => `${REPO}/tree/main/${path}`

const megabytes = (sizeKb: number) => `${(sizeKb / 1024).toFixed(1)} MB`

function chapterTitle(number: number) {
  return TEXTBOOK.chapters.find((chapter) => chapter.number === number)?.title ?? `Chapter ${number}`
}

function ChapterLink({ number }: { number: number }) {
  return (
    <span className="text-[var(--text-primary)]">
      {number} · {chapterTitle(number)}
    </span>
  )
}

const RESULT_STATUS_GLOSS: Record<string, string> = {
  folded: 'in a paper and in its chapter',
  'chapter-only': 'proved in the chapter; no standalone paper',
  'standalone-only': 'in a paper; the chapter cites it',
  unplaced: 'not yet placed',
}

const DIVE_VERDICT_GLOSS: Record<string, string> = {
  CLEAR: 'different from the prior work found',
  NARROW: 'survives with a narrower scope than first stated',
  SUBSUMED: 'prior work already proves this',
  CONTRADICTED: 'prior work proved this false; since corrected',
}

const LINK_BUTTON = 'whitespace-normal text-left'

function PaperCard({ paper }: { paper: ResearchPaper }) {
  const chapter = findWhitePaperById(paper.chapterRef)
  const dive = program.deepDives.find((candidate) => candidate.paper === Number(paper.number))
  return (
    <SurfacePanel className="flex h-full flex-col gap-[var(--space-4)]">
      <header className="grid grid-cols-[var(--space-7),1fr] gap-[var(--space-4)]">
        <span aria-hidden="true">
          <PanelTitle as="span" size="display">
            {paper.number}
          </PanelTitle>
        </span>
        <div className="min-w-0 space-y-[var(--space-2)]">
          <PanelEyebrow>
            Paper {paper.number} · {paper.resultTags.join(' · ')}
          </PanelEyebrow>
          <PanelTitle as="h3" size="card" id={`paper-${paper.number}`}>
            {paper.title}
          </PanelTitle>
          <PanelBody size="compact" className="max-w-none">
            {paper.subtitle}
          </PanelBody>
        </div>
      </header>

      <PanelBody className="max-w-none text-[var(--text-primary)]">{paper.claim}</PanelBody>

      <PanelBody as="blockquote" size="compact" className="max-w-none border-l-4 border-[var(--border-strong)] pl-[var(--space-4)] italic">
        {paper.pullQuote}
      </PanelBody>

      {chapter ? (
        <div className="space-y-[var(--space-1)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
          <PanelEyebrow>Folded into the book</PanelEyebrow>
          <PanelBody size="compact" className="max-w-none">
            Chapter {chapter.chapter}, {chapter.title}. It {paper.chapterWhy}.
          </PanelBody>
        </div>
      ) : null}

      {dive ? (
        <div className="space-y-[var(--space-1)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
          <PanelEyebrow>
            Prior-art dive · {dive.verdict} · {DIVE_VERDICT_GLOSS[dive.verdict]}
          </PanelEyebrow>
          <PanelBody size="compact" className="max-w-none">
            {dive.oneLine}{' '}
            <a href={blob(dive.findings)} className="text-[var(--text-primary)] underline underline-offset-4 hover:no-underline">
              Findings
            </a>
            .
          </PanelBody>
        </div>
      ) : (
        <div className="space-y-[var(--space-1)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)]">
          <PanelEyebrow>Prior-art dive</PanelEyebrow>
          <PanelBody size="compact" className="max-w-none">
            None has run against this paper yet; the falsification sweep it reports is its own.
          </PanelBody>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-[var(--space-2)] pt-[var(--space-2)]">
        <Button asChild variant="primary" size="sm" className={LINK_BUTTON}>
          <a href={paper.pdfPath} download>
            <Download aria-hidden="true" size={14} />
            PDF · {paper.pages} pp · {megabytes(paper.sizeKb)}
          </a>
        </Button>
      </div>
    </SurfacePanel>
  )
}

export default function ResearchProgramPage() {
  const { results, estate, critiqueLedger, studies, plannedLifts, openProblems, deepDives, wrongTurns } = program
  const verdicts = deepDives.reduce<Record<string, number>>((acc, dive) => {
    acc[dive.verdict] = (acc[dive.verdict] ?? 0) + 1
    return acc
  }, {})
  const verifiedNumbers = results.reduce((sum, result) => sum + result.numbers.verified, 0)
  const internalNumbers = results.reduce((sum, result) => sum + result.numbers.internal, 0)
  const methods = Object.entries(estate.byMethod).sort((a, b) => b[1] - a[1])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      <main id="main-content">
        {/* ── Hero ── */}
        <LandingSection>
          <img
            src="/img/library/research-hero.jpg"
            alt="A faded watercolour: an enormous pale astrolabe dissolving into fog above a small writing desk on a quay, an open ledger and a lamp on the desk."
            className="mb-[var(--space-6)] block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
            loading="eager"
          />
          <div className="grid gap-[var(--space-7)] lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.7fr)] lg:items-start">
            <div className="space-y-[var(--space-5)]">
              <SectionIntro
                eyebrow="The Harbor research program"
                title="What the whitepaper proves, what it measures, and what it doesn't know yet."
                titleAs="h1"
                titleSize="hero"
                description="The book argues that autonomy only scales when authority, evidence, and consequence stay coupled at every effect boundary. That's an argument, and an argument alone wouldn't be worth much from a project that also sells the software, so this is where the receipts live: seven papers carrying the theorems the chapters lean on, an index that pins every executed result to the chapter holding it, a proof estate that runs in CI, pre-registered studies for the questions the book can't settle from its own results, and a ledger of every objection a reviewer raised with what we did about it."
              />
              <LandingStatsStrip
                stats={[
                  { value: String(RESEARCH_PAPERS.length), label: 'conference-form papers', tone: 'paper' },
                  { value: String(results.length), label: 'executed results, each placed in the book', tone: 'blue' },
                  { value: String(estate.ci.wired), label: 'mechanized artifacts running in CI', tone: 'accent' },
                ]}
              />
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <a href="#the-papers">
                    The seven papers
                    <ArrowRight aria-hidden="true" size={16} />
                  </a>
                </Button>
                <Button asChild variant="secondary" size="lg">
                  <a href="#open-problems">What is still open</a>
                </Button>
              </div>
            </div>

            <SurfacePanel elevation="quiet" className="space-y-[var(--space-4)]">
              <PanelEyebrow>The book these papers stand under</PanelEyebrow>
              <Link to="/library" className="grid grid-cols-[minmax(6rem,0.4fr),1fr] gap-[var(--space-4)]">
                <img
                  src="/whitepaper/plates/cover-maritime.jpg"
                  width={1000}
                  height={1429}
                  alt={`Front cover of ${TEXTBOOK.edition.title}`}
                  className="block aspect-[7/10] w-full border-2 border-[var(--border-strong)] object-cover"
                  loading="lazy"
                />
                <span className="space-y-[var(--space-2)]">
                  <PanelTitle as="span" size="card">
                    {TEXTBOOK.edition.title}
                  </PanelTitle>
                  <PanelBody as="span" size="compact" className="block max-w-none">
                    {TEXTBOOK.edition.subtitle}. {TEXTBOOK.chapters.length} chapters, {COLLECTED_VOLUME.pages} pages, free PDF.
                  </PanelBody>
                </span>
              </Link>
              <PanelBody size="compact" className="max-w-none">
                Each paper below names the chapter that folds it in, and each chapter&rsquo;s status table names the
                paper it stands on, so whichever side you start from, the other is one link away.
              </PanelBody>
              <Button asChild variant="secondary" size="sm" className={LINK_BUTTON}>
                <Link to="/library">
                  <BookOpen aria-hidden="true" size={14} />
                  Read the whitepaper
                </Link>
              </Button>
            </SurfacePanel>
          </div>
        </LandingSection>

        {/* ── How a claim earns its place ── */}
        <LandingSection>
          <div className="space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="How a claim earns its place"
              title="How a result earns its way into a chapter"
              description="Four disciplines, and a result has to survive all of them before it's allowed near the prose. Every count below is read out of the repository's own records at build time (which is the reason a few of them are odd numbers)."
            />
            <ol className="grid gap-[var(--space-4)] md:grid-cols-2 lg:grid-cols-4">
              <li className="min-w-0">
                <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                  <PanelEyebrow>01 · Pre-registered</PanelEyebrow>
                  <PanelTitle as="h3" size="nav">
                    The hypotheses get written before the code does.
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {studies.length === 1 ? 'One study is' : `${studies.length} studies are`} under way right now,
                    with hypotheses, metrics, and a kill criterion committed before the first run &mdash; so we
                    can&rsquo;t quietly move the goalposts afterward. The report gets written whatever the outcome,
                    and if a hypothesis fails, the chapter that depended on it is amended in the same pull request.
                  </PanelBody>
                  <div className="mt-auto">
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <a href="#studies">The studies</a>
                    </Button>
                  </div>
                </SurfacePanel>
              </li>
              <li className="min-w-0">
                <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                  <PanelEyebrow>02 · Falsified first</PanelEyebrow>
                  <PanelTitle as="h3" size="nav">
                    Prior art gets read against the paper itself.
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {deepDives.length} prior-art dives have run to completion so far ({Object.entries(verdicts)
                      .map(([verdict, count]) => `${count} ${verdict.toLowerCase()}`)
                      .join(', ')}
                    ), and every single one of them found something to fix in the paper it was auditing &mdash; which
                    is the point of running them. The {wrongTurns.length} experiments that gave a wrong answer along
                    the way are still in the repository, next to the lesson each one taught.
                  </PanelBody>
                  <div className="mt-auto">
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <a href="#wrong-turns">The wrong turns</a>
                    </Button>
                  </div>
                </SurfacePanel>
              </li>
              <li className="min-w-0">
                <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                  <PanelEyebrow>03 · Mechanized</PanelEyebrow>
                  <PanelTitle as="h3" size="nav">
                    Whatever a machine can check, a machine checks on every pull request.
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {estate.formalArtifacts} formal artifacts across {methods.length} tools, {estate.ci.wired} of them
                    wired into CI with negative controls beside them. Of the numbers the chapters work out by hand,{' '}
                    {verifiedNumbers} carry the verified tag because a script regenerates them and {internalNumbers} carry
                    internal because the chapter&rsquo;s own derivation is the only check &mdash; we&rsquo;d rather you
                    knew which is which.
                  </PanelBody>
                  <div className="mt-auto">
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <a href="#the-estate">The estate</a>
                    </Button>
                  </div>
                </SurfacePanel>
              </li>
              <li className="min-w-0">
                <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                  <PanelEyebrow>04 · Reviewed on the record</PanelEyebrow>
                  <PanelTitle as="h3" size="nav">
                    Every objection anyone raised has a row.
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {critiqueLedger.total} review items from the adversarial rounds and the long-form critiques, and
                    each has a status cell that says what happened to it: {critiqueLedger.done} were done (with the
                    commit that landed them) and {critiqueLedger.declined} were declined, with the reason written down
                    {critiqueLedger.inWave > 0 ? `; ${critiqueLedger.inWave} are still in progress` : ''}. Declining
                    is allowed. Leaving the cell blank isn&rsquo;t.
                  </PanelBody>
                  <div className="mt-auto flex flex-wrap gap-[var(--space-2)]">
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <a href={blob('docs/harbor-research/CRITIQUE-LEDGER.md')}>
                        The ledger
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <Link to="/whitepaper/rounds">The rounds</Link>
                    </Button>
                  </div>
                </SurfacePanel>
              </li>
            </ol>
          </div>
        </LandingSection>

        {/* ── The seven papers ── */}
        <LandingSection>
          <div id="the-papers" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="The papers"
              title="Seven papers, one result each, written for a program committee."
              description="Each is a standalone pre-print in the shape a program committee expects, and each card names the results it discharges, quotes the headline theorem verbatim, and points at the chapter of the book that folds it in. None of them depends on reading the others first."
            />
            <img
              src="/img/library/research-papers.jpg"
              alt="Seven small folded-paper boats in a loose line on still grey water, a vast faint moon behind them; faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            <ol className="grid gap-[var(--space-5)] lg:grid-cols-2">
              {RESEARCH_PAPERS.map((paper) => (
                <li key={paper.id} className="min-w-0">
                  <PaperCard paper={paper} />
                </li>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── The result ledger ── */}
        <LandingSection>
          <div id="the-results" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="The result ledger"
              title="Every executed result, and where it lives"
              description="One row per result, straight from the library index: the chapter that holds it, the paper that carries it, and how many of its numbers a script regenerates. A result with no paper listed is proved inside its chapter; a result with no chapter twin is cited from its paper, and the placement column says which."
            />
            <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
              <table className="w-full min-w-[52rem] border-collapse">
                <thead>
                  <tr className="border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-left">
                    {['Result', 'What it establishes', 'Chapter', 'Paper', 'Numbers', 'Placement'].map((heading) => (
                      <th key={heading} className="px-[var(--space-3)] py-[var(--space-3)] align-bottom">
                        <PanelEyebrow>{heading}</PanelEyebrow>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr key={result.id} className="border-b-2 border-[var(--border-default)] align-top last:border-b-0">
                      <td className="px-[var(--space-3)] py-[var(--space-3)] font-mono text-[length:var(--type-panel-body-compact-size)] font-semibold text-[var(--text-primary)]">
                        {result.id}
                      </td>
                      <td className="px-[var(--space-3)] py-[var(--space-3)]">
                        <PanelBody size="compact" className="max-w-[36ch] text-[var(--text-primary)]">
                          {result.title}
                        </PanelBody>
                      </td>
                      <td className="px-[var(--space-3)] py-[var(--space-3)]">
                        <PanelBody size="compact" className="max-w-[22ch]">
                          {result.chapters.map((chapter, index) => (
                            <React.Fragment key={chapter}>
                              {index > 0 ? '; ' : ''}
                              <ChapterLink number={chapter} />
                            </React.Fragment>
                          ))}
                        </PanelBody>
                      </td>
                      <td className="px-[var(--space-3)] py-[var(--space-3)]">
                        <PanelBody size="compact">
                          {result.paper ? (
                            <a href={`#paper-${result.paper}`} className="underline underline-offset-4 hover:no-underline">
                              Paper {result.paper}
                            </a>
                          ) : (
                            'chapter'
                          )}
                        </PanelBody>
                      </td>
                      <td className="px-[var(--space-3)] py-[var(--space-3)] font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                        {result.numbers.verified} verified · {result.numbers.internal} internal
                      </td>
                      <td className="px-[var(--space-3)] py-[var(--space-3)]">
                        <PanelBody size="compact" className="max-w-[20ch]">
                          {RESULT_STATUS_GLOSS[result.status] ?? result.status}
                        </PanelBody>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PanelBody size="compact" className="max-w-none">
              Verified means a named script at a fixed seed regenerates the number in CI; internal means the chapter&rsquo;s
              own derivation is the only check we have. The index itself is{' '}
              <a href={blob('docs/harbor-research/library-index.json')} className="text-[var(--text-primary)] underline underline-offset-4 hover:no-underline">
                library-index.json
              </a>
              , and a checker fails the build if a theorem turns up in any of the three corpora without a row claiming it.
            </PanelBody>
          </div>
        </LandingSection>

        {/* ── The mechanized estate ── */}
        <LandingSection>
          <div id="the-estate" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="The mechanized estate"
              title="One manifest, every proof, and only two states it can be in"
              description="A mechanized artifact is either wired into CI or marked retired with the reason, and a retired model can't be cited as evidence anywhere in the book. We used to have a third state (a proof that existed on disk and that everyone assumed still ran), and it's the reason this manifest exists. The book's appendix of mechanized claims is generated from it."
            />
            <img
              src="/img/library/research-estate.jpg"
              alt="A colossal brass padlock dissolving into cloud above a tiny key on a wooden table at the water\u2019s edge; faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.5fr)_minmax(0,0.5fr)]">
              <SurfacePanel className="space-y-[var(--space-4)]">
                <PanelEyebrow>By tool</PanelEyebrow>
                <ul className="grid gap-[var(--space-2)]">
                  {methods.map(([method, count]) => (
                    <li key={method} className="flex items-baseline justify-between gap-[var(--space-4)] border-b-2 border-[var(--border-default)] pb-[var(--space-2)] last:border-b-0">
                      <PanelBody size="compact" className="text-[var(--text-primary)]">
                        {method}
                      </PanelBody>
                      <span className="font-mono text-[length:var(--type-panel-body-compact-size)] font-semibold text-[var(--text-primary)]">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
                <PanelBody size="compact" className="max-w-none">
                  {estate.formalArtifacts} formal artifacts plus {estate.researchProgramArtifacts} result suites and
                  simulations; {estate.ci.wired} run in CI and {estate.ci.retired} are retired and say why. Among the
                  formal artifacts, {estate.byKind['negative-control'] ?? 0} are negative controls &mdash; models that
                  are <em>supposed</em> to fail &mdash; so a checker that had quietly stopped finding anything would
                  go red rather than green.
                </PanelBody>
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                    <a href={blob(estate.manifest)}>
                      The manifest
                      <ArrowUpRight aria-hidden="true" size={14} />
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                    <a href={tree('proofs')}>
                      proofs/ in the repository
                      <ArrowUpRight aria-hidden="true" size={14} />
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                    <Link to="/whitepaper/how-we-prove-game-theory">How the game theory is checked</Link>
                  </Button>
                </div>
              </SurfacePanel>
              <SurfacePanel elevation="quiet" className="space-y-[var(--space-3)]">
                <PanelEyebrow>Not green, and the manifest says so</PanelEyebrow>
                <ul className="grid gap-[var(--space-3)]">
                  {estate.notCurrent.map((artifact) => (
                    <li key={artifact.id} className="space-y-[var(--space-1)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] first:border-t-0 first:pt-0">
                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <BracketLabel>{artifact.status}</BracketLabel>
                        <span className="font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-primary)]">
                          {artifact.id}
                        </span>
                      </div>
                      <PanelBody size="compact" className="max-w-none">
                        {artifact.method}. {artifact.note.split(/(?<=\.)\s/)[0]}
                      </PanelBody>
                    </li>
                  ))}
                </ul>
              </SurfacePanel>
            </div>
          </div>
        </LandingSection>

        {/* ── Studies under way and planned lifts ── */}
        <LandingSection>
          <div id="studies" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Under way"
              title="What the book couldn't settle, it's now measuring"
              description="A study starts as a question the book's own results can't answer, and it becomes a protocol before it becomes code: hypotheses, metrics, a kill criterion, and a rule for what the book does with each possible outcome (including the embarrassing one)."
            />
            <img
              src="/img/library/research-studies.jpg"
              alt="One small rowboat holding a measuring pole upright in a vast pale harbour, ripples spreading, an immense faint shape beneath the water; faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            {studies.map((study) => (
              <SurfacePanel key={study.id} className="space-y-[var(--space-5)]">
                <div className="space-y-[var(--space-2)]">
                  <PanelEyebrow>
                    {study.status} · pre-registered {study.preRegistered} · chapter{' '}
                    {study.chapters.join(', ')}
                  </PanelEyebrow>
                  <PanelTitle as="h3" size="section">
                    {study.title}
                  </PanelTitle>
                </div>
                <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>The question</PanelEyebrow>
                    <PanelBody className="max-w-none">{study.question}</PanelBody>
                    <PanelEyebrow>The design</PanelEyebrow>
                    <PanelBody size="compact" className="max-w-none">
                      {study.design}
                    </PanelBody>
                    {study.notRunnableHere ? (
                      <>
                        <PanelEyebrow>Not runnable in the build container</PanelEyebrow>
                        <PanelBody size="compact" className="max-w-none">
                          {study.notRunnableHere}
                        </PanelBody>
                      </>
                    ) : null}
                  </div>
                  <div className="space-y-[var(--space-3)]">
                    <PanelEyebrow>Hypotheses, as written before the first run</PanelEyebrow>
                    <ol className="grid gap-[var(--space-3)]">
                      {study.hypotheses.map((hypothesis) => (
                        <li key={hypothesis.id} className="grid grid-cols-[var(--space-7),1fr] gap-[var(--space-3)]">
                          <span className="font-mono text-[length:var(--type-panel-body-compact-size)] font-semibold text-[var(--text-primary)]">
                            {hypothesis.id}
                          </span>
                          <div className="min-w-0 space-y-[var(--space-1)]">
                            <PanelTitle as="h4" size="nav">
                              {hypothesis.title}
                            </PanelTitle>
                            <PanelBody size="compact" className="max-w-none">
                              {hypothesis.statement}
                            </PanelBody>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
                <div className="space-y-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)]">
                  <PanelEyebrow>What happens to the book</PanelEyebrow>
                  <PanelBody size="compact" className="max-w-none">
                    {study.reportRule}
                  </PanelBody>
                  <div className="flex flex-wrap gap-[var(--space-2)] pt-[var(--space-2)]">
                    <Button asChild variant="secondary" size="sm" className={LINK_BUTTON}>
                      <a href={blob(study.protocol)}>
                        The pre-registered protocol
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                      <a href={tree(`studies/${study.dir}`)}>
                        The harness and results
                        <ArrowUpRight aria-hidden="true" size={14} />
                      </a>
                    </Button>
                  </div>
                </div>
              </SurfacePanel>
            ))}

            <div className="space-y-[var(--space-4)]">
              <SectionIntro
                eyebrow="Planned lifts"
                title="Proofs we have in one form and owe in a stronger one"
                titleSize="section"
              />
              <ol className="grid gap-[var(--space-4)] md:grid-cols-2">
                {plannedLifts.map((lift) => (
                  <li key={lift.id} className="min-w-0">
                    <SurfacePanel padding="compact" className="flex h-full flex-col gap-[var(--space-2)]">
                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <BracketLabel>{lift.status}</BracketLabel>
                        {lift.result ? (
                          <span className="font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                            {lift.result}
                          </span>
                        ) : null}
                      </div>
                      <PanelTitle as="h4" size="nav">
                        {lift.title}
                      </PanelTitle>
                      <PanelBody size="compact" className="max-w-none">
                        {lift.statement}
                      </PanelBody>
                      <PanelBody size="compact" className="mt-auto max-w-none">
                        Chapter{lift.chapters.length > 1 ? 's' : ''}{' '}
                        {lift.chapters.map((chapter, index) => (
                          <React.Fragment key={chapter}>
                            {index > 0 ? '; ' : ''}
                            <ChapterLink number={chapter} />
                          </React.Fragment>
                        ))}
                      </PanelBody>
                    </SurfacePanel>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </LandingSection>

        {/* ── Open problems ── */}
        <LandingSection>
          <div id="open-problems" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Open problems"
              title="What the book names as its own next work"
              description="Each of these is a specific silence that a product decision ran into, or a boundary a theorem draws around itself, with a link to the document that named it and the chapter that owes it. A problem leaves this list when a section, a proof, or a study closes it, and not before."
            />
            <img
              src="/img/library/research-open.jpg"
              alt="An unfinished sea chart on a desk with a pencil across it, most of the sheet blank, a colossal unpainted coastline suggested above; faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            <ol className="grid gap-[var(--space-4)] lg:grid-cols-2">
              {openProblems.map((problem, index) => (
                <li key={problem.id} className="min-w-0">
                  <SurfacePanel className="flex h-full flex-col gap-[var(--space-3)]">
                    <PanelEyebrow>
                      {String(index + 1).padStart(2, '0')} · chapter{problem.chapters.length > 1 ? 's' : ''}{' '}
                      {problem.chapters.join(', ')}
                    </PanelEyebrow>
                    <PanelTitle as="h3" size="nav">
                      {problem.title}
                    </PanelTitle>
                    <PanelBody size="compact" className="max-w-none">
                      {problem.statement}
                    </PanelBody>
                    <div className="mt-auto">
                      <Button asChild variant="ghost" size="sm" className={LINK_BUTTON}>
                        <a href={blob(problem.source)}>
                          Where it is named
                          <ArrowUpRight aria-hidden="true" size={14} />
                        </a>
                      </Button>
                    </div>
                  </SurfacePanel>
                </li>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── Wrong turns ── */}
        <LandingSection>
          <div id="wrong-turns" className="scroll-mt-[var(--space-8)] space-y-[var(--space-6)]">
            <LandingSectionIntro
              eyebrow="Wrong turns, kept"
              title="The experiments that gave the wrong answer stay in the repository"
              description="Each one sits next to its corrected version with the lesson it taught, on the theory that the next person about to make the same mistake should find it already made, annotated, and a little embarrassing."
            />
            <img
              src="/img/library/research-wrong-turns.jpg"
              alt="A single tilted channel buoy adrift with faint circles of old wake, a great pale wave frozen above it; faded watercolour."
              className="block aspect-[16/9] w-full border-2 border-[var(--border-strong)] object-cover"
              loading="lazy"
            />
            <ol className="grid gap-[var(--space-3)]">
              {wrongTurns.map((turn) => (
                <li key={turn.file} className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-default)] pt-[var(--space-3)] sm:grid-cols-[minmax(12rem,auto),1fr] sm:gap-[var(--space-4)]">
                  <div className="space-y-[var(--space-1)]">
                    <a
                      href={blob(`docs/harbor-research/wrong-turns/${turn.file}`)}
                      className="font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-primary)] underline underline-offset-4 hover:no-underline"
                    >
                      {turn.file}
                    </a>
                    <PanelEyebrow>{turn.result}</PanelEyebrow>
                  </div>
                  <PanelBody size="compact" className="max-w-none">
                    {turn.lesson}
                  </PanelBody>
                </li>
              ))}
            </ol>
          </div>
        </LandingSection>

        {/* ── Keep reading ── */}
        <LandingSection>
          <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)] lg:items-start">
            <SectionIntro
              eyebrow="Keep reading"
              title="The argument is in the book; the proofs are here; the record is in the repository"
              titleSize="section"
              description={`This whole page is rendered from one file, docs/harbor-research/program.json, and that file is checked on every pull request against the results index, the proof manifest, the review ledger, and whatever studies are on disk — so when the program moves, this page is forced to move with it, and we can't forget to update it. Last synced ${program.updated}.`}
            />
            <SurfacePanel elevation="quiet" className="grid gap-[var(--space-2)]">
              <Button asChild variant="secondary" size="md" className="justify-between whitespace-normal text-left">
                <Link to="/library">
                  The whitepaper, as one book
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="md" className="justify-between whitespace-normal text-left">
                <Link to="/whitepaper/rounds">
                  The adversarial review rounds
                  <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </Button>
              <Button asChild variant="secondary" size="md" className="justify-between whitespace-normal text-left">
                <a href={tree('docs/harbor-research')}>
                  docs/harbor-research in the repository
                  <ArrowUpRight aria-hidden="true" size={14} />
                </a>
              </Button>
            </SurfacePanel>
          </div>
        </LandingSection>
      </main>

      <Footer />
    </motion.div>
  )
}
