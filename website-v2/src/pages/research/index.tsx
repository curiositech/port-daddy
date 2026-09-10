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
        Seven papers in submission form. Every result in them is folded into a chapter of
        the Book, in the Book's own voice and with the worked examples a chapter needs —
        these are the versions you would send to a referee, kept byte-stable so a citation
        to one still resolves.
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
      body: 'The falsification attempt is written down — what would break the claim, and how many tries it gets — before the run, so a null result is a result rather than a thing quietly not mentioned.',
    },
    {
      n: '02',
      title: 'Falsified first',
      body: 'Every headline number comes with the count of attempts that tried to break it and failed. A bound nobody attacked is a conjecture with good posture.',
    },
    {
      n: '03',
      title: 'Mechanized where it can be',
      body: 'Where a claim fits a checker, a checker holds it — ProVerif, TLA⁺, Apalache, Kani, Z3 — and where it does not, the paper says so instead of implying a machine agreed.',
    },
    {
      n: '04',
      title: 'Reviewed on the record',
      body: 'Adversarial review rounds, prior-art dives and the corrections they forced are published alongside the papers, including the rounds where the reviewers were right.',
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
        Before a result is claimed as new, somebody goes looking for the paper that already
        proved it. A dive ends in one of four verdicts, and two of them are bad news for us —
        which is the point of running them, and of publishing the ones that came back
        narrow.
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
          {undived.map((paper) => paper.title).join(', ')} — named here rather than left as a
          gap you would have to notice.
        </p>
      ) : null}
    </div>
  )
}

function EstatePanel() {
  return (
    <div className="space-y-5">
      <p className="max-w-[76ch] text-[15px] leading-[1.65] text-[var(--text-secondary)]">
        The formal estate is a manifest, not a claim: every model, harness and checker in the
        repository is either wired into a CI job that runs it, or explicitly retired with the
        reason written down. There is no third state, and a checker that has never been run
        is not evidence of anything.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            t: 'The negative controls matter most',
            b: 'Half the estate is models that are supposed to FAIL — the unsigned envelope, the rollback configuration, the multi-hop attack before the fix. They are what prove the passing runs are not vacuous, and they are the ones that went missing the longest.',
          },
          {
            t: 'Bounded means bounded',
            b: 'A Kani harness with the crypto stubbed proves no panic on the parse path under a fixed unwind, and that is what the Book now says it proves — not "verified in Rust". The every-hop attenuation property is ProVerif’s, and lives in a different file.',
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
        Read the manifest: every artifact, and the job that runs it →
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
        headline: 'Seven papers, in the form a referee would want them.',
        standfirst:
          'Every one of these results is also in the Book, folded into a chapter with the worked examples a reader needs — these are the same results with the pedagogy taken out and the apparatus left in.',
        render: () => <PapersPanel />,
      },
      {
        id: 'method',
        label: 'Method',
        flag: 'fl-kilo',
        meaning: 'Kilo — I wish to communicate with you',
        color: 'var(--brand-accent)',
        onColor: 'var(--brand-accent-foreground)',
        headline: 'Four moves, and the third one is the expensive one.',
        standfirst:
          'Pre-register the attack, run it, mechanise what a machine can hold, and publish the review that found the hole — in that order, because doing them out of order is how you end up believing your own abstract.',
        render: () => <MethodPanel />,
      },
      {
        id: 'dives',
        label: 'Prior art',
        flag: 'fl-uniform',
        meaning: 'Uniform — you are running into danger',
        color: 'var(--story-rust)',
        onColor: 'var(--story-rust-foreground)',
        headline: 'Somebody probably proved it first. Go and look.',
        standfirst:
          'A dive that comes back SUBSUMED costs a claim and buys a citation, which is a trade worth making every time — and the ones we have not run yet are named rather than left for you to spot.',
        render: () => <DivesPanel />,
      },
      {
        id: 'estate',
        label: 'The estate',
        flag: 'fl-charlie',
        meaning: 'Charlie — affirmative',
        color: 'var(--story-indigo)',
        onColor: 'var(--story-indigo-foreground)',
        headline: 'Wired, or retired. There is no third state.',
        standfirst:
          'A model checked into a repository and never run again is decoration; the manifest exists so that every artifact has to be one thing or the other, on the record.',
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
                The Book is where these results are taught; this is where they are argued to
                a referee — same author, same numbers, and every falsification attempt that
                failed to break them counted out loud.
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
