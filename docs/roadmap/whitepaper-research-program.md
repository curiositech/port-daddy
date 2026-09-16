# Coordination Papers Research and Implementation Program

Updated: 2026-09-08

Registry authority: `roadmap_items` in harbor `port-daddy`
Collected volume: `link:coordination-papers-mega-volume`

## This is the plan. There is no other.

This file is the doc-authority for the Book and the research program, per
[`AUTHORITY.md`](AUTHORITY.md) and Track 8 of
[`UNIFIED-ROADMAP.md`](../recovery/UNIFIED-ROADMAP.md). It carries the forward
plan: what is next, in what order, with what status. Everything else about the
program is a different kind of document and points here rather than carrying
its own copy of the plan:

| File | What it is | What it is not |
|---|---|---|
| this file | the forward plan and its status | a record of what landed |
| [`exposition/TEXTBOOK-BUILD-LEDGER.md`](../harbor-research/exposition/TEXTBOOK-BUILD-LEDGER.md) | what landed, by commit, with measurements | a plan |
| [`exposition/HANDOFF-TEXTBOOK.md`](../harbor-research/exposition/HANDOFF-TEXTBOOK.md) | how to build, look, and resume | a plan |
| [`CRITIQUE-LEDGER.md`](../harbor-research/CRITIQUE-LEDGER.md) | adjudications of outside critique | a plan |
| [`program.json`](../harbor-research/program.json) | the machine-readable research data the site renders | prose |
| the registry (`pd roadmap`, `roadmap.snapshot.json`) | gate truth and join keys | the story |

Rules of maintenance, so this stays the one place: a commit that changes the
status of anything below edits this file in the same commit; a new item enters
here first and the registry second; a wave plan that lives in a session, a
scratchpad, or a chat artifact is not the plan until it is a row here. The
session plan file and the "Harbor Work Register" artifact that carried the
wave plan through 2026-09-07 are retired by this revision.

## Where the Book stands (measured 2026-09-08, local xelatex build)

545, 550 and 546 pages at 7 × 10 in, three editions from one source. Measured on the pages
of all three editions with `page_overflow.py`: **0 margin-note collisions, 0
pieces of ink off the paper, 0 lines of column text over the running foot**;
from the logs, 0 undefined references, 0 `Marginpar on page`, 0 `Float too
large`, 0 `Float(s) lost`. Still open: **129 overfull lines** (3 over 20 pt, 16
between 10 and 20) and 1 overfull vbox (p. 498). The CI TeX Live build runs one
line ahead of the local one from chapter 1 §1.8; page numbers are quoted from
CI PDFs only.

Everything on this page is a measurement, and every measurement above has a
check that reruns it: `page_overflow.py` over every edition in
`whitepaper-build`, `star_exercise_pointers.py --check` and `margin_lint.py` in
`library-checks`. A number here without a check behind it is a claim, and the
next session should treat it as one.

The author read about ten pages at random on 2026-09-08 and found a defect on
every one. The working assumption for everything below is that the rest of
the book has the same texture, and that a sweep which fixes only the pages
the author happened to open has not fixed the book.

## 1. The Book: the defect sweep

Each row is one class of defect, the pages it was found on, the mechanical
check that finds every instance, and the status. A class is closed when its
check runs in `library-checks.yml` and reports zero, not when the pages the
author saw look right.

| # | Defect class | Seen on | Finds every instance | Status |
|---|---|---|---|---|
| 1.1 | "Pull quotes" that quote nothing: section theses set in large italic behind a coloured rule, the costume of a quotation with no speaker | p. 182 (read-poverty); 21 sites in 7 chapters | `grep -c '\\pullquote{'` on chapter sources; `check_style_sections.py` rule pending | **landed 2026-09-08** as `\pdthesis` with a Thesis margin head, all 21 sites renamed; rule in `check_style_sections.py` pending |
| 1.2 | Bibliography back-references were links painted over in body grey, so nothing said the page numbers were clickable | every bibliography page | PyMuPDF: colour of numeral spans on pages carrying "Cited on" | **landed 2026-09-08**: numerals in cobalt, return arrow, verified 0x003fb8 on p. 520 |
| 1.3 | Bibliography sorted on the author's *first* name as written, and the same work printed two, three, four times because chapters cite it in different house styles | pp. 517–542 | the generator's own near-duplicate report | **partly landed 2026-09-08**: sort by surname (corporate bodies under their first word; particle names under the main element), the sort and fingerprint functions exported and under test; 301 → 277 entries; 13 near-duplicate pairs reported by chapter. **Open:** the 13 (one wording per work, in every chapter), then the report becomes an error. **Then:** one `references.bib`, one record per work, biblatex `sorting=nyt` — the fix that makes the class impossible rather than caught |
| 1.4 | Margin notes colliding, and margin notes off the paper entirely: a Recall block over an Exercises pointer on p. 162; a portrait and its caption 81 pt below the foot of p. 68; a Recall block 150 pt below the foot of p. 97 | pp. 36, 48, 68, 97, 142, 161, 184, 244, 252, 309, 368, 370, 372, 414 (edition-dependent) | `page_overflow.py`: a margin-collision pass on baselines, an off-the-paper pass that grows the mediabox before extracting (MuPDF drops text outside the page, and its no-clip flag returns a degenerate rect), and a foot-intrusion pass; 12 unit tests, each with a case it fails on | **landed 2026-09-08**: one margin-occupancy system in the `pd-pedagogy.tex` twins — every block measured, raised so its last line sits on the line that issues it, capped by the page top, the last head's own foot and the last block's foot, and recording where it came to rest; the file's last `\marginpar` is gone (the page builder never moves one up, which is how the portrait got off the page). 0 collisions, 0 off-paper, 0 over the foot in all three editions |
| 1.5 | Lines running past the measure: 129 overfull, the worst 40 pt at generated line 6083 | p. 327 and 128 others | the build log; `page_overflow.py` | open; the previous pass took 281 → 130, the residue is figure fragments, generated tables and long monospace tokens; each needs a source fix, not a tolerance |
| 1.6 | Description lists with a wide label column that push the body to a deep hanging indent and let the label overflow its column | pp. 161–162 (modes of cooperation, `leftmargin=2.2cm,style=nextline`) | grep `\begin{description}[leftmargin=` across chapters; every one is a candidate | open; recut as run-in heads (`style=sameline` with a bold label and no fixed column) or as a table |
| 1.7 | A section or chapter ending on a verso leaves the facing recto blank; chapter openers should be title-left / chapter-right pairs | Part IV opener; every chapter end that falls on an even page | `page_spills.py` gains a blank-recto pass | open; a plate in the edition's register on every blank recto (image-model render, provenance sidecar; never TikZ), and `\cleardoublepage` discipline at every opener |
| 1.8 | Tables whose narrow last column wraps every cell to one word per line (Table 4.8, "What it would take to fake") | p. 4.8 in chapter 4 | figcheck T1 on `xltabular`/`tabularx` output; column width vs longest cell | open; give the prose column the width and the glyph columns fixed narrow widths |
| 1.9 | Ideas introduced and dropped: FIPA's Directory Facilitator introduced properly (ch. 4, l. 1825) and returned to only as a related-work row; Agentic Psychosis and BDI each one paragraph in ch. 7, never used again | ch. 4 §4.x, ch. 7 §sec:vibe and the BDI paragraph | the reading-flow audit's mechanism-without-a-run list, extended to *term-without-a-return*: every bold-at-definition term must be used at least once after its section | open; see §4 below for FIPA, and §7 for the density problem |
| 1.10 | Overfull vbox on p. 498 | p. 498 | build log | open |
| 1.11 | Tables too tall for their page printed over the running foot instead of breaking: `tab:honest-state` overran by 303 pt, `tab:handoff` by 51, `tab:app-status` by 60, and the only witness was a `Float too large for page` line in the log that nobody was reading | pp. 153, 305 and the two standalone twins | the foot-intrusion pass of `page_overflow.py`, plus `grep -c 'Float too large'` on every edition log | **landed 2026-09-08**: all three converted to `xltabular`, which breaks across pages and repeats its head, with the caption in `\endfirsthead` and a `(continued)` line on the runs after; 0 `Float too large` in every edition and in both standalone chapters |

**Order.** 1.4 and 1.11 landed 2026-09-08. Next is 1.5 (mechanical, and the
check makes it stay fixed), then 1.6 and 1.8 (both are the same mistake, a fixed column
width in a narrower measure), then 1.7 (needs plates), then 1.3's biblatex
migration, then 1.9 with the chapter work in §7.

## 2. The Book: what is next, in order

The wave plan that ran from Wave 0 to Wave 13 is landed through Wave 12 L3 and
Wave 13's mechanism; its record is the ledger. What remains, in order, each a
row so its status can move:

| # | Work | Depends on | Status |
|---|---|---|---|
| 2.1 | Defect sweep §1, classes 1.4–1.8 and 1.10 | — | in progress |
| 2.2 | Wave 11.4 redraws, chapters 2–8, from written specs, inspected in all three editions on one contact sheet | the figure standard exemplar (author decision) | chapters 2, 5, 6–8 in flight from workers; ch. 3 passes |
| 2.3 | The 18 additions from the triage: plots from `sweep-delta.sh`, `b7_escalation_band.py`, `sheaf_consistency_radius.py`; sessions for chapters 3–6; the R12 lineage DAG; the fleet `pd status` session | 2.2 | partly landed (probation cliff, cycle-vs-cut, three sessions) |
| 2.4 | Worked-example floor: one per section, anchor and sealed first; `check_style_sections.py` enforces | — | open |
| 2.5 | Pseudocode listings to the CLRS register (`algpseudocode`), kernel first | — | open |
| 2.6 | The comparative argument the book has been avoiding: §4 below | — | **open, promoted** |
| 2.7 | One vocabulary: §5 below | — | **decided, execution open** |
| 2.8 | Fold from The Grand Harbor: §6 below | 2.7 | open |
| 2.9 | Chapter 7's density: §7 below | — | open |
| 2.10 | Reading-flow audit re-run on the whole book after 2.1–2.5; product-appeal page | 2.1–2.5 | open |
| 2.11 | Whole-book contact sheets, three editions, for the author | 2.1–2.10 | open |
| 2.12 | Publication receipt (below) | 2.11 | open |

## 3. The research program: smarter, wider, better-proven, faster

The author's question, answered as moves rather than adjectives.

| # | Move | What it buys | Status |
|---|---|---|---|
| 3.1 | **One harness.** The Trial Basin from The Grand Harbor §5.12 is the substrate study's `PROTOCOL.md` generalised: a scenario DSL, deterministic First Tides, seeds under `harbor-results`' discipline, result cards that can *downgrade* a claim. S1/S2, the G5–G7 counterfactual coalition estimates, G11 congestion, G17 attention, G18 ecology all run in it. One harness is what makes "super fast" possible: a new question is a scenario file, not a new script | every empirical claim gets a falsifier at the cost of a file | open; design first, `studies/trial-basin/` |
| 3.2 | **Diff the G-cards against the estate before importing them.** G0 is `Conservation.tla` (done); G19 is B4/R17 (done); G5's Shapley needs 3.1; about six of twenty are landed work under new names. The rest enter `program.json` as `plannedLifts` or `studies`, each with model, falsifier, and chapter | no duplicate research | open |
| 3.3 | **Wider: credit the canon.** The four literature reviews (#10076) list the canon the chapters never engaged — Kofman–Lawarrée and Tirole for the inspection tower, Levien for no-mint, Sheridan for the operator, Lykouris–Vassilvitskii for paging, SPKI/SDSI for attenuation, Sabelfeld–Sands for declassification. `wave-16/credit-the-canon` is the first pass. The public names go first and the private coinages second, in every chapter | the book stops restating known results under private names | in progress |
| 3.4 | **Better-proven.** The queued lifts stand: R8 → Apalache, R9 → Isabelle, the Merkle binding to EasyCrypt, C2 take-rate. Add: the every-hop attenuation property as a ProVerif theorem cited from the text (it is `v7`, but the anchor chapter says "Kani" where it should say this); the CRDT boundary of §4 as a TLA⁺ model with the two failure traces | claims cite the artifact that proves them | open |
| 3.5 | **Faster.** Falsification-first is already the rule: sweep before proving, mutation-test every checker. Two accelerants: (a) every R-script emits its figure's CSV so a plot is a build step, not a session; (b) `record_sessions.sh` derives every terminal session from a committed log, so a session is regenerated, never retyped | the empirical half of the book rebuilds from `make` | (b) landed; (a) open |
| 3.6 | **Smarter.** The critique ledger's move set (monster-barring, lemma-incorporation, in Lakatos's names) becomes the vocabulary of the wrong-turns file, so a correction is filed as a *kind* of correction and the same kind is looked for elsewhere | corrections generalise | open |

## 4. The argument the book has to win: why not CRDTs

The Book mentions CRDTs once — chapter 1, line 344, in the list of reflexes
("Raft, Paxos, CRDTs") it then sets aside. Given that the single-writer rail is
the central claim, that is an argument declined, not an argument won. The
August row A.4 of this file asked for a comparative chapter against FIPA/JADE,
actor systems, capability security, tuple spaces, mechanism design,
distributed ledgers and modern agent runtimes; it was never written. This is
that row, sharpened to the one comparison that can actually beat us.

**The rule.** The book states the strongest case for convergent replication,
answers it, and names the falsifier. If the falsifier fires, the book changes
its position, in print, as a recorded wrong turn. That is what the critique
ledger is for.

**The strongest case against us**, which the chapter must state in its own
words before answering it:

1. *Zed's collaboration is CRDT-based and works.* Two people edit one buffer
   with no lock and no writer rail; the Grand Harbor itself says not to try
   to beat Zed at editing. If a CRDT buffer is good enough for two humans,
   what is the argument that it is not good enough for two agents?
2. *Local-first software* (Kleppmann, Ink & Switch) argues that a single
   writer is exactly the availability failure users hate, and that
   Automerge/Yjs give you offline work and merge-on-reconnect for free.
3. *Git is already a merge-based system.* Every worker has a full replica and
   merges; the rail is a lock bolted onto a system designed not to need one.
4. *The read side is where the book says the next order of magnitude is won*
   (ch. 4's thesis), and the read side — notes, presence, the ledger
   projection, Harbor Lights as "a deterministic read model built from
   canonical events" — is event-sourced, convergent, multi-writer by design.
   The book's own architecture is half CRDT already.

**The answer the book should give**, as claims with kinds:

- Convergence is not correctness. A CRDT guarantees every replica reaches the
  same state; it says nothing about whether that state compiles, passes the
  tests, or keeps the invariant. Two agents' edits to one function converge to
  a function neither wrote. The kernel's write is not a data update, it is a
  *commitment* graded by an oracle at commit (ch. 1's commitment-closure
  oracle), and grading needs a point where the whole is checked — a serial
  point. *Design invariant.*
- Authority has to live somewhere. In a CRDT every replica is equal, which is
  the property the book argues against: confinement needs an enforcement point
  below the agent (ch. 1's supervisory-control argument, R5). A CRDT cannot
  refuse a write; the rail can. *Theorem, by reduction to R5.*
- Conflict is semantic, and semantic conflict is coarse. The rail with claims
  at symbol level is a coarser lock than a character-level CRDT, deliberately:
  it admits the semantic check at the granularity the check can run. The
  price is the wait; the substrate study (S2) measures it. *Empirical
  hypothesis, with the study named.*
- **And the concession the book must make:** the commitment layer is
  single-writer; the *evidence* layer — notes, presence, the ledger's
  projections, federated gossip of signed facts (ch. 8) — is convergent
  replication and should say so, using the field's names. The boundary
  between the two is a claim in its own right, and it is the one that needs
  a model: a TLA⁺ specification with the two failure traces (a convergent
  commitment that fails its oracle; a serialised note that loses availability
  for nothing).

**The falsifier.** S2 in `studies/substrate-study/PROTOCOL.md`: rail versus
advisory-with-bypass versus worktree-per-agent-plus-merge-queue on replayed
real commit histories. If the merge-queue arm produces equal verified value at
lower wait and equal collision rate, the rail loses and the chapter says so.

**Placement.** A section in chapter 1 (the argument and the boundary claim)
and the comparison appendix the A.4 row asked for, with FIPA (the Directory
Facilitator, push-based, that ch. 4 introduces and drops), actor systems, tuple
spaces, and capability security each given their strongest form. FIPA's
return is not a related-work row: ch. 4's directory *is* a DF with a 2025
threat model, and the chapter should say what FIPA got right, what it could
not have known, and what the split ranker changes.

## 5. One vocabulary

**Decision (the author, 2026-09-08): one.** The Book has four statement kinds
(Theorem / Design invariant / Model-checked property / Empirical hypothesis),
five assurance modes (Observed / Coordinated / Brokered / Confined /
Attested), a four-valued maturity table (implemented / partial / specified /
proposed); the product has five evidence labels; The Grand Harbor proposes
nine Atlas states. `program.json` already carries this as the open problem
`one-label-scheme`. It is no longer open; it is decided, and the work is the
execution.

**The one table** has three orthogonal columns, because the five vocabularies
were answering three different questions and conflating them is where the
sprawl came from:

| Column | Question it answers | Values |
|---|---|---|
| *kind* | what sort of claim is this | Theorem · Design invariant · Model-checked property · Empirical hypothesis |
| *maturity* | how built is it | implemented · partial · specified · proposed |
| *assurance* | what enforces it at run time | Observed · Coordinated · Brokered · Confined · Attested |

Every consequential statement in the book, every product badge, and every
roadmap item cites a row of this table. The Grand Harbor's nine states map
onto it without loss: SHIPPED and BUILT are maturity; PROVED-BOUNDED,
CONJECTURED, CONTRADICTED, OPEN and REJECTED are kind plus a status; OBSERVED
is assurance; DESIGNED is maturity. Nothing in the nine needs a fourth column.

**Execution.** The table lives once, in the Book's implementation-boundary
appendix, generated from a small JSON that `program.json` and the site's
badge component both read. `check_style_sections.py` fails a claim without a
kind; `check_research_program.py` fails a result without a maturity. The
product's five evidence labels are retired in favour of the assurance column.
Owner: the appendix wave; the site's badge change follows.

## 6. What the Book takes from The Grand Harbor, and what it declines

*The Grand Harbor* (integration draft 2026-08-28, uploaded 2026-09-08) is the
best statement of the program's *why* in the corpus, and it is staged as if
the repository were four months behind where it is. The assessment is in the
session record; the decisions are here.

| # | From the plan | Book action | Status |
|---|---|---|---|
| 6.1 | §2 the refused sentence; lineage / affiliation / contribution / custody; the prohibition on caste; School not caste | New section in chapter 5, after personhood-as-ledger-position: who owns a worker's residual, and why lineage is not title. The four categories as a table; caste as a Design invariant the ledger enforces (no inherited reputation without provenance, no forfeiture on exit, no transfer of identity as an asset) | open |
| 6.2 | G6 Myerson graph-restricted value; G7 Owen value for Schools and crews | Chapter 7: which relationships enabled value; whether a coordinator earns rent from connectivity or from owning the platform; Owen value as the mechanism behind 6.1. Both need 3.1 to estimate | open |
| 6.3 | G3–G4 core, least core, nucleolus; G8 Nash bargaining under declared threat points | Chapter 6, as the cooperative complement to the Myerson–Satterthwaite corner the chapter already has | open |
| 6.4 | G10 quadratic funding for the commons | Chapter 7, with Sybil resistance named as the precondition | open |
| 6.5 | G11 claim congestion as a congestion game; a potential function | Chapter 1, the claim machinery's missing equilibrium analysis | open |
| 6.6 | G17 operator attention as control; the out-of-the-loop experiment with injected false-green | Chapter 4: the experiment ch. 4 §4.5.6 writes a cheque for and never cashes ("a console that draws all of them beautifully… has made the floor easier to forget"). Runs in 3.1 | open |
| 6.7 | G18 evolutionary ecology; monoculture; concentration, not revenue | Chapter 7 or 8, the counterweight to the Chandlery | open |
| 6.8 | §12 political philosophy: republican non-domination (Pettit), Ostrom's design principles applied, mētis, moral uncertainty across five worlds | Chapter 7's interlude, and the front matter's statement of what the book is for. Non-domination and moral uncertainty are new to the corpus | open |
| 6.9 | §5.12 Trial Basin | 3.1 above | open |
| 6.10 | §6 and §17 vocabulary program: Charter, Passage Plan, Leg, Watch | **Declined for the Book.** ADR-0010's own rule is that a maritime name ships only when it clarifies authority, lifecycle, containment, movement or evidence. Harbor Lights, Chandlery, Voyage Receipt and Ship's Articles clear it; Leg and Watch do not. The Book's argument is that administrative facts must be legible; a private dialect in the one artifact meant to explain the system to outsiders is what chapter 4 warns against | decided |
| 6.11 | §7 nine Atlas states | Folded into §5's one table | decided |
| 6.12 | G0, G19 | Already landed (`Conservation.tla`; B4/R17); no new work | decided |
| 6.13 | §10.1 status table | Stale against the estate; superseded by `program.json` | decided |

## 7. Open problem 9: origination of unowned work

Added to `program.json` this revision. The statement, extended by the author's
questions of 2026-09-08:

Every mechanism the Book has — receipts, bonds, escrow, reputation as a ledger
position, δ\*, ρ\* — binds an agent to something it *agreed to do*. The dead
daemon and the red test have no counterparty and no price; nothing in the
institution assigns a defect nobody chartered. Ostrom's monitoring and
graduated sanctions presuppose a promise to monitor against. The problem has
four parts, and the first is the one the author named the same morning the
gap was found: an agent posted that a red check was "not this PR's" and moved
on.

1. **Origination.** What mechanism makes an unowned defect somebody's, and
   prices it, without a charter? Candidates: a standing bounty on the commons'
   own invariants; a rotation; an obligation attached to *proximity* (the
   agent that observed it); a market in which noticing is paid.
2. **Variable lifetimes.** An agent alive only for this PR values the PR's
   completion and nothing after it; that is why it needs adversarial
   reviewers — and the reviewers' lifetimes and incentives are the same
   question one level up. Who checks the checkers, and with what horizon? Is
   there an ideal attention span for a reviewer, and is it longer than the
   thing reviewed?
3. **Memory.** Who remembers old plans, old documents, old ideas, and how?
   Episodic memory induction into Standing Orders (the doctrine loop) is one
   answer; this file being the one plan is another; neither is measured.
4. **Market or evaluator.** Is this solved by a market in which agents that
   simply do the thing better and with less error win the work, or does it
   require evaluators and judges who give feedback immediately and in
   aggregate? The Book's ch. 5 (reputation) and ch. 7 (bonds) say market; the
   grading-oracle recursion (B.2 below) says the evaluator is unavoidable and
   has to be paid and bonded. The honest position is that it needs both and
   the boundary between them is unwritten.

Chapter home: 7 (the institution), with a pointer from 1 (the kernel cannot
see it) and 5 (identity is what makes it assignable). Falsifier: the Trial
Basin scenario in which an invariant breaks with no charter open, under each
candidate mechanism, measuring time-to-owner and time-to-fix.

## 8. Porthole: so then what

Porthole (the causal replay surface: what the worker saw, the plan it held,
the tool it invoked, what changed, the message that altered course) is both
the most useful product idea in the Grand Harbor and a complete attack
surface: a replay of everything an agent saw is a perfect exfiltration
channel, semantic search over receipts is search over secrets, visual capture
is capture, and "receipts for agents" makes a receipt an authority object.

*Then what* is the sealed room's ledger run in the other direction — which
`program.json` already lists as the open problem `ledger-other-direction` —
applied to Porthole specifically:

| # | Item | Status |
|---|---|---|
| 8.1 | Porthole's read path is metered by the release ledger of chapter 3: a replay is a release, budgeted and logged, and a semantic query is a query against the ledger, not the store | open |
| 8.2 | Receipts are scoped and signed like Harbor Cards: attenuable, expiring, revocable, and a receipt that grants authority says so in its type | open |
| 8.3 | Visual capture under the redaction discipline the marginalia and session tooling already have to obey, with the capture itself receipted | open |
| 8.4 | A threat model for Porthole as a deep-dive in `program.json`, and a section in chapter 3 | open |

## 9. Building the harbor with the harbor, across the credential jump

The program has been building Port Daddy with Port Daddy, and the author is
right that the bootstrap will not survive the step from uncredentialed to
credentialed: the day every write boundary demands a daemon-minted credential
(D.2 below) is the day our own workflow is refused.

The jump is a migration, and migrations need a bridge, not a flag day:

| # | Step | Done when |
|---|---|---|
| 9.1 | **Shadow mode.** Issue and verify credentials at every write boundary; enforce nothing; log every write that *would* have been refused | the refusal log exists and is read |
| 9.2 | **Measure ourselves.** Replay our own commit history (S2 already replays real histories) through the credentialed path; the refusal rate on our real workflow is the number that decides when to enforce | refusal rate on N days of real work under a stated threshold |
| 9.3 | **Fix what would be refused**, in the product, not by widening admission — the Grand Harbor's Passage 0 rule | the log is quiet |
| 9.4 | **Enforce per boundary**, most consequential first (the commit path), with the shadow log kept as the regression test | every boundary enforces; the log stays quiet |
| 9.5 | **Jump back on.** Our own work runs credentialed; the uncredentialed path is deprecated by receipt (a dated last-use), then removed | last uncredentialed write is dated |

What we build in the meantime: the credential path itself and the refusal
log, using the product as it is. What we test with: the Trial Basin, on our
own history. When we jump back on: at 9.4, boundary by boundary, never all at
once.

## Roadmap registry

| Link | Status | Outcome |
|---|---|---|
| `link:coordination-papers-mega-volume` | now | Ship the cohesive volume: the defect sweep (§1), the remaining Book work (§2), the comparative argument (§4), one vocabulary (§5), the Grand Harbor folds (§6), the publication receipt. |
| `link:coordination-papers-proof-program` | backlog | Close theorem, security, game-theoretic, conservation, dissemination, and model-to-runtime proof obligations (B below; 3.4). |
| `link:coordination-papers-empirical-program` | backlog | Measure the parameters and failure modes the formal claims depend on; the Trial Basin (3.1); publish reproducible traces (C below). |
| `link:coordination-papers-runtime-closure` | backlog | Build the missing identity, outcome, checkpoint, relay, revocation, custody, settlement, and projection-consistency mechanisms (D below); the credential bridge (§9). |

Rows in §§1–9 above without their own registry slug are children of
`link:coordination-papers-mega-volume` until the registry can take them
(`optout: registry append-only through the daemon; not reachable from the
build sandbox`).

## Purpose

The eight chapters form one research program: local coordination kernel,
capability security, the sealed room, operator legibility and authority,
durable agent identity, harbor economics, bonded accountability, and
federation. This roadmap keeps three kinds of work separate so a formal
result is never mistaken for a runtime guarantee:

- **Paper work** sharpens definitions, assumptions, counterexamples, and the
  cross-chapter argument.
- **Proof and empirical work** establishes which claims survive adversarial or
  measured conditions.
- **Runtime work** closes the implementation gaps identified by the papers.

The status vocabulary is the one table in §5.

## A. Add to the papers

1. Maintain one volume-wide assumption and notation concordance. Every symbol,
   trust root, failure model, clock assumption, oracle, and unit of account gets
   one canonical meaning plus chapter-local aliases. *(Partly landed: the
   library index and twin headers; the concordance table itself is open.)*
2. Add a claim-to-artifact matrix for every theorem and security property:
   specification, proof/model, executable conformance test, deployed witness, and
   known counterexample. *(Landed as the mechanized-claims appendix from
   `whitepaper/corpus.json`.)*
3. Add compact adversarial case studies spanning the whole stack: identity reset,
   false completion, verifier capture, partitioned revocation, escrow bypass,
   redelivery, and operator override. *(Open.)*
4. Add a comparative chapter or appendix positioning the stack against FIPA/JADE,
   actor systems, capability security, tuple spaces, mechanism design,
   distributed ledgers, and modern agent runtimes without flattening their threat
   models. *(Promoted to §4; the CRDT argument is its spine.)*
5. Keep an editioned implementation ledger in every release and link each status
   row to concrete source, test, model, or deployment evidence. *(Landed; the
   four chapter status tables and the estate.)*

## B. Prove

1. State each game with players, information, timing, action space, payoffs,
   deviations, equilibrium concept, and parameter region. Prove or falsify the
   claimed honest-strategy result under collusion, Sybils, cheap reset, judge
   capture, delayed evidence, and bounded rationality. *(δ\* resynced and
   mechanized; ρ\*, the probation cliff and the escalation band landed; the
   cooperative-game complement is §6.2–6.3.)*
2. Close the grading-oracle recursion: define independence and conflicts, specify
   appeals and re-audits, and establish conditions under which error contracts
   rather than merely moving to another judge. *(Open; it is part 4 of open
   problem 9.)*
3. Prove settlement and custody conservation per unit of account, then state the
   additional valuation assumptions needed for cross-currency exposure.
   *(Conservation landed in TLA⁺; cross-currency is the open problem
   `dispute-arithmetic` and the Grand Harbor's multi-currency question.)*
4. Derive dissemination safety and liveness separately for connected operation,
   finite partitions, redelivery, reordering, and equivocation. Map model rounds
   to measured wall-clock distributions rather than asserting a deadline.
   *(Revocation and webhook models run in CI; the wall-clock mapping is open.)*
5. Establish a model-to-runtime conformance chain for capability attenuation,
   sealed relay, custody, revocation, and settlement. Record bounds such as chain
   depth and adversary class explicitly. *(ProVerif and Kani run in CI; the
   text still credits Kani where `v7` is the proof — 3.4.)*
6. Characterize the Proof-of-Attention game class and either prove approximation
   or tightness bounds for the proposed allocation rule, or narrow the claim.
   *(Open; G17 is the experimental half.)*

## C. Try and measure

1. Calibrate operator miss and false-alarm costs, detection probability, slash
   probability, discount factors, and payoff ranges using replayable workloads.
2. Run judge-validity experiments with seeded defects, blind duplicate ratings,
   conflict graphs, appeals, and re-audits; report inter-rater reliability and
   adversarial catch rates.
3. Chaos-test crash recovery, at-least-once delivery, duplicated messages,
   partitions, revocation lag, stale custody, and restart/resurrection across all
   supported adapters.
4. Attack identity-reset laundering by minting fresh actors under shared budgets
   and bonds; measure whether any legacy or bypass path restores a clean slate.
5. Publish small, versioned trace bundles that reproduce each empirical figure and
   link them from the relevant theorem or status row. *(Sessions land from
   committed logs; the CSV-per-figure rule is 3.5a.)*

All of C runs in the Trial Basin (3.1) once it exists; until then in
`studies/substrate-study/`.

## D. Add to the code

1. Extend the shipped commitment substrate into a reputation-grade
   witnessed-outcome ledger with neutral grading events, identity binding,
   conflicts, appeals, sanctions, and append-only correction.
2. Require daemon-minted actor credentials at every security-relevant write
   boundary; migrate legacy asserted identifiers and test impersonation/reset
   failures end to end. *(The bridge is §9.)*
3. Build portable execution-state checkpoint and successor restoration where an
   adapter can support it, and expose an explicit unsupported grade elsewhere.
4. Implement HPKE-style sealed cross-harbor relay, witness-log revocation,
   non-bypassable custody, and a minimal settlement prototype behind conformance
   tests and fault injection.
5. Make every roadmap and status projection identify its authority source and fail
   loud on divergence; close the current fragmented-projection class rather than
   reconciling counts by hand. *(This file's maintenance rule is the doc half;
   the registry half is `roadmap-schema-wiring`.)*
6. Make Fleet review resumable at ship and chunk boundaries: checkpoint completed
   comments and spend, bound GitHub reads/writes, and ensure a retry cannot replay
   every successful ship after one provider or remote-completion failure.
7. Apply and verify the production migration for `fleet_run_spend`; fail the
   deployment check if the executor schema and Worker code disagree.
8. Turn single-chunk memory ceilings and empty provider responses into explicit,
   exact-head failure receipts. A tracking label is not a substitute for a
   completed review when review protection is waiting on Fleet.
9. Coalesce or discard stale-head deliveries before expensive model work, and
   make the current head SHA visible in the queue, check-run, and review receipt.
10. Make Purser fail closed before retargeting a reviewed PR: resolve every
    referenced path, reject binary-as-text assertions and malformed source
    escapes, execute the generated tests in the real repository harness, and
    preserve the original base unless that exact generated branch is green.

## Current implementation evidence

| Mechanism | Grade | Evidence and remaining boundary |
|---|---|---|
| Durable commitments and obligation monitor | partial | `lib/commitments.ts`, `lib/obligation-monitor.ts`, API/CLI routes, and focused tests ship. Neutral graded outcomes, sanctions, and reputation binding do not. |
| Local actor identity root | partial | `lib/actor-souls.ts`, actor registration, lookup credential, bounded newcomer pool, and budget-guard tests ship. Universal write-boundary enforcement and legacy migration do not (§9). |
| Execution checkpoint | partial | Recovery passes durable notes and summaries, not portable execution state. |
| Cross-operator attestation and federation runtime | specified/proposed | Protocols and bounded models exist; the mutually sovereign deployed path and conformance chain remain open. |
| Reproducible collected-volume publication | implemented | The deterministic generator fails closed on missing sources, cyclic imports, missing citations, and namespace collisions; the build pins source epochs and produces the standalone artifacts plus the three editions of the Book. Production publication still requires the receipt below. |
| Exact-head Fleet publication review | partial | GitHub records a Fleetbot request signal and the executor rejects stale heads, but the August 5 publication run exposed one- and two-chunk memory failures, empty provider responses, replayed work, and a missing production `fleet_run_spend` table. A successful exact-head Fleet receipt remains the closure condition. |
| Purser adversarial-test gate | partial | Purser can state a useful steel-manned contract and retarget a PR through generated tests, but publication review produced tests that parsed a PDF as HTML, referenced absent files, or used malformed TeX string escapes. The operator rejected those branches; generation is not authoritative until the candidate tests execute successfully before retargeting. |

## Exit criteria

The program is not "done" when the prose is persuasive. It is done when every
foundational claim is one of: (a) proved under named assumptions and linked to a
conforming implementation; (b) empirically supported with reproducible evidence;
or (c) explicitly narrowed or rejected. The production library must publish the
same edition and implementation grades that the repository builds.

### Publication receipt contract

Every published edition must append one immutable receipt that records, together:

- the landed source commit and volume edition;
- the mega-volume route, page count, byte count, and SHA-256 digest of each
  of the three editions;
- the route and SHA-256 digest of each of the seven standalone papers;
- the production library deployment identifier and verification timestamp.

The release item stays `now` until those values are read back from production and
match the landed artifacts. A preview URL, local build, or CI artifact is evidence
for the release, but is not the release receipt.
