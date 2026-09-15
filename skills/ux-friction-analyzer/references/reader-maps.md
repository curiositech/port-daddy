# Reader Maps and Vocational Paths

Load this when the document tells its readers how to read it — a "Reader's
Map", a "How to use this book", a role-based docs track, a "if you are a
practitioner, start at Chapter 7".

A reader map is a **promise made to a named kind of person**, and it is the
only part of a technical document that can be broken without any single page
being wrong. The book reads perfectly in order. The map sends a practitioner
past Chapter 2. Chapter 7 uses a definition from Chapter 2. Nobody reading
linearly will ever notice, the author least of all, and every practitioner who
trusted the map hits a wall and concludes the book is over their head.

That defect has a name here — **broken-by-map prerequisite** — and it is the
single highest-value thing this skill finds in a book that has a reader map.

## Extracting the map

1. **Find it.** Usually the preface, an early "How to read this book", a
   chapter-dependency diagram, or a table of tracks. Docs sites put it in a
   landing page of role tiles. Some books bury it in the last paragraph of the
   introduction, which is itself a finding — a map only linear readers find is
   a map for people who did not need it.
2. **Write down each route as an ordered node list**, exactly as printed.
   Resist tidying it. If the map says "Chapters 1, 3, 7–9, and the appendix",
   that is the route; if that route is wrong, you want the model to say so, not
   your correction of it.
3. **Name the persona each route addresses**, in the document's own words
   where it gives them: "practitioner", "the reader who wants the algorithms",
   "a second course". The vocational identity is the point — the map is
   claiming this route suits this kind of working life.
4. **Give each route its own patience budget.** This is the step most often
   skipped and it changes the answer. A practitioner track is being read by
   someone with an afternoon; the theorist track by someone with a term. The
   book's overall budget is nobody's.
5. **Give each route its own reader mode.** A practitioner track is usually
   read in `scan` or `skim` mode even when the book as a whole is a `study`
   read. See `references/reading-models.md`.

Encode them as `readerPaths` in the surface graph
(`schemas/surface-graph.schema.json`) and run the model as usual. Each route is
evaluated as its own surface: the same chain, restricted to the prescribed
nodes in the prescribed order.

## The four failure modes of a reader map

### 1. Broken-by-map prerequisite

The route skips the node that introduces a concept a later node on the route
needs. Finding: `reader-map-broken-prerequisite`, gating.

The model distinguishes this from a concept nothing introduces anywhere. The
fixes are different:

| Defect | Fix |
| --- | --- |
| Concept introduced nowhere | Introduce it, or declare it as required background |
| Concept introduced, but the route skips it | **Fix the map** — add the chapter to the route — *or* give that route a self-contained gloss at the point of use |

The second fix is usually the right one, and it is cheap: a boxed "if you came
here from the practitioner track, here is what you need from §2.3 in four
sentences." Books that do this well feel generous. Books that do not feel
gate-kept, which is a reputation earned by a typesetting decision rather than
by any opinion the author holds.

### 2. Route that never pays off

The map sends a named reader down a path containing no payoff node. Finding:
`reader-map-omits-payoff`, gating. This is a promise broken in public: the
document said "this route is for you", and the route rewards someone else.

### 3. Route over its own budget

The route fits the book's patience budget but not *this reader's*. A
practitioner track that promises four hours to someone with one is broken even
if every chapter on it is excellent. Surfaced as a path-scoped
`reader-path-patience-budget-exceeded`.

### 4. Route nobody is, and reader nobody routed

Two mirror-image defects, and both are judgement calls the model cannot make
for you:

- **A route with no persona** is a route somebody invented because the
  structure suggested it, not because a reader exists who wants it.
- **A persona with no route** is a reader the map forgot. If
  `product-appeal-analyzer` is scoring a persona that no `readerPaths` entry
  addresses, either the map has a gap or that persona is not really a target.
  Decide which, out loud, in the report.

## A shorter route completes more and teaches less

Expect this, and do not be fooled by it. In the shipped example
(`examples/surfer-latex-book.json`) the practitioner route completes at 61%
and the full theorist route at 36% — and the practitioner route is the broken
one. It is shorter, so fewer people quit along it; it also skips the two
chapters that introduce the concepts it needs.

**Completion alone never validates a map.** Read completion together with
`brokenByMap` and payoff reach, in that order:

1. Does the route reach a payoff? (If no: the route is pointless.)
2. Does the route carry its own prerequisites? (If no: the route is a trap.)
3. Does it fit this reader's budget? (If no: the route is a wish.)
4. *Then* how many finish it?

## What the readout gives you per route

`readout.readerPaths[]` carries, for each route: the prescribed `nodes`, the
`skipped` ones, `brokenByMap` with the concept, where it is needed and which
node introduces it, plus that route's own `completion`, `medianExitNode`,
`payoffReach` (including time to first insight), and its complete finding list.

High and critical findings from each route are also re-surfaced at the top
level, prefixed with the route and persona and carrying a `path` field, so a
book that reads fine linearly and badly along its own prescribed route cannot
pass quietly.

## Handing routes to the appeal side

`product-appeal-analyzer` scores whether each persona *wants* what its route
offers, using the same route structure. Friction asks whether the route works;
appeal asks whether it was worth walking. Pass the per-route completion, payoff
reach, and time-to-first-insight into that skill's
`technicalDocument.readerMap.paths` block and score the personas against the
routes the document actually prints.

The pairing produces the report sentence that is usually worth the whole audit:
*"The practitioner route is the one your practitioners will take, it skips the
two chapters that define what it needs, and it reaches the result 12 minutes
after their attention budget runs out."*
