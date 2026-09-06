# Reading-flow audit

How the Textbook Edition reads for each kind of reader it claims to serve, measured
on the rendered pages, with the fixes each finding maps to. Method: the
`ux-friction-analyzer` journey simulation (time to first checkable fact, chunks per
step, context preserved, progress shown) plus three measures the book adds for
itself: **kinds per page** (distinct content kinds a page shows; target ≤ 3 on 95 % of
body pages, measured by `scripts/harbor-research/page_kinds.py`), **back-references
per page** (cross-references a reader must chase to follow the argument; target ≤ 2),
and **time to first checkable fact** in a chapter (target: the first spread).

## 1. Archetypes

Merged from the chapters' reader's maps, the whitepaper critical review's nine
personas (`docs/whitepaper-critical-review.md` Part 1) and the site's three UX
personas (`docs/UX_FRICTION_ANALYSIS.md`). Eight journeys, each with the question the
reader carries and the page they bounce on if it is not answered.

| # | archetype | carries the question | first stop | bounces when |
|---|---|---|---|---|
| A1 | formal-methods reviewer | are the theorems stated as theorems, and what checked them? | front matter's four statement kinds; chapter 1 §invariants; appendix "Mechanized claims" | a claim reads as philosophy before it reads as a statement with a kind |
| A2 | protocol / cryptoeconomic designer | where is the mechanism, and what attack does it survive? | chapter 2 ceremony; chapter 7 δ\* game; chapter 6 succession price | the headline mechanism is more than three jumps from the chapter opening |
| A3 | distributed-systems engineer | would I build this, and what does it cost at runtime? | chapter 1 single-writer discipline; the terminal sessions; chapter 2 primitives | too much frame, not enough algorithm; no run shown |
| A4 | engineering manager evaluating deployment | what is implemented, what is partial, what would it cost me? | each chapter's Limitations table; the assurance modes; chapter 6 deployment economics | maturity is not visible at a glance |
| A5 | AI-safety or philosophy-first reader | how does accountability follow from the economics rather than from alignment? | chapter 4 legibility budget; chapter 5 personhood interlude; chapter 6 | plumbing (filters, Merkle) arrives before the argument |
| A6 | operator or agent author (the practitioner) | what do I type, and what will I see? | chapter 1 resource organ session; chapter 4 operator surface; chapter 2 cards | nothing on the page looks like the tool |
| A7 | instructor or completionist | can I teach from this, and can I check my answers? | the exercises sections, solutions, review of key ideas | exercises are scattered or unmarked; no solutions page |
| A8 | short-on-time skeptic (fifteen minutes) | what is the one claim, and is it honest about what it is not? | front matter one-breath claims; each chapter's first two pages; boundaries | the first spread has no checkable fact |

## 2. Measures (whole book)

Filled from `page_kinds.py` and the link audit on each interim build. First row is the
build in which the page grammar landed (7 × 10, Palatino, exercises at chapter end).

| build | pages | kinds/page mean | share ≤ 3 | pages ≥ 5 | longest run with no visual | links | undefined refs |
|---|---|---|---|---|---|---|---|
| 2026-09-06 grammar | 538 | — | — | — | — | 3,393 | 0 |

## 3. Journeys

One table per archetype per interim build; steps are the pages actually turned. To be
filled as chapters land in the new grammar; the kernel first.

## 4. Product appeal (the bookstore test)

Cover, spine sentence, table of contents, three random spreads: each must answer "what
is this and is it for me" in under ten seconds. Table stakes: readable type at arm's
length, findable exercises, a real index, solutions. Differentiators: mechanized proofs
cited by artifact, recorded terminal sessions, live links, plates. Honest signal: would
the archetype keep reading past the first spread. Judged on the three spreads attached
to each build's report.

## 5. Findings and fixes

| # | archetype(s) | finding | fix | status |
|---|---|---|---|---|
| F1 | A7, A8 | exercises interrupted the argument in triples after almost every section | moved to chapter-end Exercises sections with margin pointers | done (round 4) |
| F2 | all | five content kinds signalled by five tinted rectangles; nothing readable at a glance | page grammar by typography and margin; no fills | done (round 4) |
| F3 | A3, A6 | no page showed the tool running | recorded terminal sessions (`pdsession`), kernel first | in progress |
| F4 | A1, A4 | figures did not carry a readable fact | triage and redraws (wave 11) | in progress |
