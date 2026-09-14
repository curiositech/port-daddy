import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { DeckShell, type DeckSignal } from '@/components/library/DeckShell'
import { RESEARCH_PAPERS, RESEARCH_PAPER_TOTAL_PAGES, type ResearchPaper } from '@/data/researchPapers'
import { WHITE_PAPERS } from '@/data/whitePapers'

/**
 * /research — the research program, on one screen.
 *
 * Same shape as /whitepaper and for the same reason: the method, the seven
 * standalone papers, the prior-art dives and the mechanised estate were a
 * single column that had to be scrolled through in the order it happened to
 * be written in. They are four panels now, and a reader who came for one of
 * them reaches it in one click.
 *
 * The relationship to the Book matters and is stated on every paper rather
 * than assumed: these are the submission-form write-ups of results the Book
 * folds into its chapters. Same author, same results, two forms.
 */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
      {children}
    </div>
  )
}

const VERDICT_INK: Record<string, string> = {
  CLEAR: 'var(--status-success)',
  NARROW: 'var(--status-warning)',
  SUBSUMED: 'var(--text-muted)',
  CONTRADICTED: 'var(--status-error)',
}

function chapterTitleFor(chapterRef: string) {
  const chapter = WHITE_PAPERS.find((paper) => paper.id === chapterRef)
  return chapter ? `chapter ${chapter.chapter}, ${chapter.title}` : chapterRef
}

function PaperRow({ paper }: { paper: ResearchPaper }) {
  return (
    <article className="border-b border-[var(--hair)] py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-bold text-[var(--brand-primary)]">
          {paper.number.padStart(2, '0')}
        </span>
        <h3 className="text-[17px] font-bold leading-tight tracking-[-0.012em] text-[var(--text-primary)]">
          {paper.title}
        </h3>
        <span className="text-[14px] italic text-[var(--text-muted)]">{paper.subtitle}</span>
      </div>
      <p className="mt-1.5 max-w-[76ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
        {paper.claim}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Folded into {chapterTitleFor(paper.chapterRef)}
        </span>
        <span className="font-mono text-[11px] text-[var(--text-ghost)]">
          {paper.resultTags.join(' · ')}
        </span>
        <a
          href={paper.pdfPath}
          className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--brand-primary)] no-underline hover:underline"
        >
          PDF · {paper.pages} pp
        </a>
      </div>
    </article>
  )
}

function PapersPanel() {
  return (
    <div>
      <p className="mb-3 max-w-[76ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        Every result in these papers also appears in the Book, rewritten in the Book's voice
        with the worked examples a chapter needs. What's here is the version you'd send to a
        referee, and the files don't move, so a citation to one of them still resolves years
        from now.
      </p>
      {RESEARCH_PAPERS.map((paper) => (
        <PaperRow key={paper.id} paper={paper} />
      ))}
    </div>
  )
}

function MethodPanel() {
  const moves = [
    {
      n: '01',
      title: 'Pre-registered',
      body: 'Before a run starts we write down what result would break the claim, and how many attempts it gets. A run that comes back negative then gets published too, since we committed to publishing it before we knew which way it would go.',
    },
    {
      n: '02',
      title: 'The falsification count',
      body: 'Every headline number is reported with the count of attempts that tried to break it and failed — the information floor in paper 1 came through sixteen of them, including one where the encoder was given the answer. A bound nobody has attacked is still a conjecture, so the count travels with the number.',
    },
    {
      n: '03',
      title: 'Mechanized where a checker fits',
      body: 'Claims that fit a checker get one: ProVerif for the protocol models, TLA⁺ and Apalache for the state machines, Kani for the Rust, Z3 for the thresholds. Where no checker fits, the paper marks that claim as unmechanized, so you can tell which results a machine has actually seen.',
    },
    {
      n: '04',
      title: 'Reviewed on the record',
      body: 'Review rounds and prior-art dives are published next to the papers. Several of them found real errors — a misnamed theorem in paper 5, an arithmetic slip in paper 3, an over-strict "iff" in paper 6 — and the corrected claims are what you are reading now.',
    },
  ]
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {moves.map((move) => (
        <div key={move.n} className="border-l-2 border-[var(--brand-primary)] pl-3">
          <Eyebrow>
            {move.n} · {move.title}
          </Eyebrow>
          <p className="mt-1.5 max-w-[52ch] text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
            {move.body}
          </p>
        </div>
      ))}
    </div>
  )
}

function DivesPanel() {
  const dived = RESEARCH_PAPERS.filter((paper) => paper.priorArtDive)
  const undived = RESEARCH_PAPERS.filter((paper) => !paper.priorArtDive)
  return (
    <div className="space-y-5">
      <p className="max-w-[76ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        Before we claim a result is new, somebody goes looking for the paper that already
        proved it. Every dive is below with its verdict and what it changed — several of them
        caught errors in our own arithmetic and wording, and those corrections are in the
        published papers.
      </p>
      <div className="space-y-3">
        {dived.map((paper) => {
          const dive = paper.priorArtDive
          if (!dive) return null
          return (
            <div key={paper.id} className="border-l-[3px] pl-3" style={{ borderColor: VERDICT_INK[dive.verdict] }}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className="font-mono text-[11px] font-bold uppercase tracking-[0.11em]"
                  style={{ color: VERDICT_INK[dive.verdict] }}
                >
                  {dive.verdict}
                </span>
                <span className="text-[15px] font-bold text-[var(--text-primary)]">{paper.title}</span>
              </div>
              <p className="mt-1 max-w-[74ch] text-[14px] leading-[1.55] text-[var(--text-secondary)]">
                {dive.summary}
              </p>
            </div>
          )
        })}
      </div>
      {undived.length > 0 ? (
        <p className="max-w-[74ch] text-[14px] leading-[1.6] text-[var(--text-muted)]">
          No dive has run yet against{' '}
          {undived.map((paper) => paper.title).join(', ')}. Until one does, nothing on this page
          says whether prior art already covers that result.
        </p>
      ) : null}
    </div>
  )
}

function EstatePanel() {
  return (
    <div className="space-y-5">
      <p className="max-w-[76ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        Every model, harness and checker in the repository is either wired into a CI job that
        runs it or marked retired with the reason written down, and the manifest says which for
        all of them. There's no third category for the ones nobody has gotten around to,
        because a checker that never runs isn't evidence of anything.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            t: 'The negative controls',
            b: 'About half the estate is models that are supposed to fail: an unsigned envelope, a rolled-back configuration, the multi-hop attack as it stood before the fix. They\'re the reason a green run means something — without a case the checker can actually fail, a pass only tells you the question was too easy.',
          },
          {
            t: 'What the Kani harness actually proves',
            b: 'The Kani harness stubs out the crypto and checks one thing: that the parse path doesn\'t panic, under a fixed unwind bound. That\'s what the Book claims for it, and the wording matters, because "verified in Rust" would imply a much larger result. The every-hop attenuation property is proved in ProVerif, in a different file.',
          },
        ].map((item) => (
          <div key={item.t} className="border border-[var(--hair)] bg-[var(--surface-raised)] p-4">
            <div className="text-[15px] font-bold text-[var(--text-primary)]">{item.t}</div>
            <p className="mt-1.5 max-w-[52ch] text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              {item.b}
            </p>
          </div>
        ))}
      </div>
      {/*
        This pointed at /library/proofs, a page that was planned and never
        built -- so the panel that exists to say "every artifact is wired or
        retired, on the record" ended in a link to nothing. The record is the
        manifest, and the manifest is a file anyone can read, so the link goes
        there instead of to a page that would only paraphrase it.
      */}
      <a
        href="https://github.com/curiositech/port-daddy/blob/main/whitepaper/corpus.json"
        className="inline-block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--brand-primary)] no-underline hover:underline"
      >
        Every artifact and the job that runs it, on GitHub
      </a>
    </div>
  )
}

export default function ResearchProgramPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const signals: DeckSignal[] = React.useMemo(
    () => [
      {
        id: 'papers',
        label: 'The papers',
        flag: 'fl-papa',
        meaning: 'Papa — about to proceed to sea',
        color: 'var(--brand-primary)',
        onColor: 'var(--brand-primary-foreground)',
        headline: 'Seven papers, and the chapter each one is folded into.',
        standfirst:
          'Same results the Book teaches, written up for review. The proofs run in full, there are no worked examples, and the related work is where a reviewer will look for it.',
        render: () => <PapersPanel />,
      },
      {
        id: 'method',
        label: 'Method',
        flag: 'fl-kilo',
        meaning: 'Kilo — I wish to communicate with you',
        color: 'var(--brand-accent)',
        onColor: 'var(--brand-accent-foreground)',
        headline: 'How a result gets from a guess to a claim.',
        standfirst:
          'We decide what would refute a claim before we test it, hand what fits a checker to a checker, and publish the adversarial review that corrected it. An early 8/14 bound did not survive that process, and it was cut.',
        render: () => <MethodPanel />,
      },
      {
        id: 'dives',
        label: 'Prior art',
        flag: 'fl-uniform',
        meaning: 'Uniform — you are running into danger',
        color: 'var(--story-rust)',
        onColor: 'var(--story-rust-foreground)',
        headline: 'We look for the paper that already proved it.',
        standfirst:
          'A dive comes back CLEAR, NARROW, SUBSUMED or CONTRADICTED, and the last two would cost us the claim. Every paper but one has had a dive run against it; the one that hasn\'t is named below.',
        render: () => <DivesPanel />,
      },
      {
        id: 'estate',
        label: 'The estate',
        flag: 'fl-charlie',
        meaning: 'Charlie — affirmative',
        color: 'var(--story-indigo)',
        onColor: 'var(--story-indigo-foreground)',
        headline: 'Every model either runs in CI or is marked retired.',
        standfirst:
          'The manifest pairs every model with the CI job that runs it. A model with no job has to be marked retired, with a reason, before it is allowed to sit in the repository.',
        render: () => <EstatePanel />,
      },
    ],
    [],
  )

  const requested = searchParams.get('panel')
  const activeId = signals.some((signal) => signal.id === requested) ? (requested as string) : 'papers'

  const select = React.useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams)
      next.set('panel', id)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  return (
    <main id="main-content">
      <DeckShell
        routeLabel="/research"
        hoist={['fl-romeo', 'fl-papa']}
        art={{
          light: '/img/generated/library/program-light.webp',
          dark: '/img/generated/library/program-dark.webp',
          alt: 'A cut-paper diorama seen from above: sealed paper manuscripts fanned on the left, a checking machine paying out punched tape on the right, a signal mast flying Papa over Delta.',
        }}
        activeId={activeId}
        onSelect={select}
        signals={signals}
        masthead={
          <div className="space-y-5">
            <div>
              <Eyebrow>The research program</Eyebrow>
              <h1 className="mt-2 max-w-[17ch] text-[clamp(30px,3.4vw,46px)] font-bold leading-[1.04] tracking-[-0.035em] text-[var(--text-primary)]">
                The results, in submission form.
              </h1>
              <p className="deck-voice mt-3 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--text-secondary)]">
                The Book teaches these results; these papers argue them to a referee. Same
                author and the same numbers either way, with the count of failed attempts to
                break each one reported alongside it.
              </p>
            </div>

            <div className="flex flex-wrap gap-x-7 gap-y-3">
              {[
                { n: String(RESEARCH_PAPERS.length).padStart(2, '0'), l: 'papers' },
                { n: String(RESEARCH_PAPER_TOTAL_PAGES), l: 'pages, free' },
                {
                  n: String(new Set(RESEARCH_PAPERS.flatMap((paper) => paper.resultTags)).size),
                  l: 'results discharged',
                },
              ].map((stat) => (
                <div key={stat.l} className="border-t-2 border-[var(--border-strong)] pt-2">
                  <div className="font-mono text-[26px] font-bold leading-none text-[var(--text-primary)]">
                    {stat.n}
                  </div>
                  <div className="mt-1 text-[12.5px] text-[var(--text-muted)]">{stat.l}</div>
                </div>
              ))}
            </div>

            <a
              href="/whitepaper"
              className="inline-block bg-[var(--brand-primary)] px-5 py-3 font-mono text-[13px] font-bold tracking-[0.04em] text-[var(--brand-primary-foreground)] no-underline"
            >
              Read the Book instead
            </a>
          </div>
        }
      />
    </main>
  )
}
