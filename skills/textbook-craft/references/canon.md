# Canon: what each book does that is worth stealing

Tiers follow `references/sources.md`. Quotations are reproduced from the seed
memo (`docs/harbor-research/exposition/TEXTBOOK-CRAFT.md`) where it read the
source directly, or from this skill's own corpus/web research pass, cited
inline. Nothing here is invented; a claim this file cannot source is marked
`[unverified]` and carries no floor in `scripts/chapter_lint.py`.

## Feynman, *The Feynman Lectures on Physics* Vol. I (Tier A, via seed memo)

Opens on an objection the reader will actually have ("why can't you just give
us the laws on page one?"), then a scene with a number in it (a drop of water,
magnified in four jumps to "about fifteen miles across"). Idealizations are
named in the sentence that introduces the figure ("idealized in several ways
... the particles are drawn with sharp edges, which is inaccurate"). No
references section — Feynman's honest counterexample: a lecture transcript can
skip provenance; a textbook that wants to be checked cannot. **Steal**: name
the figure's idealization in the caption sentence itself, not in a separate
"limitations" aside.

## SICP, Abelson & Sussman, 2nd ed. (Tier A, via seed memo)

Epigraph as compressed table of contents (Locke's three "acts of the mind" for
the abstraction chapter). First sentence names the subject; the governing
metaphor pays a bill three paragraphs later ("a small bug ... can lead to the
catastrophic collapse of an airplane or a dam"). Types `486` before defining
anything. Exercises interleaved at the point of the idea they test, not
banked — the opposite of this skill's own chapter-end rule, and flagged as
such: SICP is a from-scratch introductory text with continuous narrative flow;
the Book and the papers in `whitepaper/` are reference-grade chapters a reader
re-enters mid-argument, where the Wave 12 finding (F1, `READING-FLOW-AUDIT.md`)
was that interleaved exercises *interrupted* the argument. Steal the epigraph
and the concrete-before-definition move; do not steal the exercise placement.
A model whose own honesty rule this skill imports directly: "The purpose of
the substitution is to help us think about procedure application, not to
provide a description of how the interpreter really works" — say when a
teaching model is only a model.

## Knuth, *The Art of Computer Programming* Vol. 1 (Tier A/B, via seed memo)

Two epigraphs per chapter, one framing the subject (Lovelace) and one framing
the reader's work (Epictetus). Every exercise carries a 00–50 rating, an
"M"/"HM" tag, and an arrow for the especially instructive; "each reader should
at least make an attempt to solve all of the problems whose rating is 10 or
less." *The TeXbook*'s single/double "dangerous bend" marks optional depth in
the margin. **Steal**: the rating discipline, generalized to this skill's
three-star `Check`/`Trace`/`Open` ladder (`references/exercise-design.md`) —
Knuth's own scale is too fine-grained for a seven-chapter book with a fixed
apparatus; MacKay's 1–5 (explicitly modeled on Knuth's) is the closer analog
and the one this skill's rating actually descends from.

## Knuth & Graham & Patashnik, *Concrete Mathematics* (Tier C `[unverified]`
in this pass — not re-verified beyond general knowledge)

Its own preface line, widely quoted, states the book's thesis directly: a
"blend of CONtinuous and disCRETE mathematics," built to correct a
mathematics curriculum that had become "so heavily influenced by exposure to
[Bourbaki-style] abstract mathematics" that concrete technique atrophied.
Margin marginal jokes ("graffiti") from students, worked "the hard way" and
"the easy way" side by side. **Steal**: showing a routine calculation by two
methods, deliberately, so the reader learns which one generalizes — the Book's
own "numbers by hand" convention (`pd-pedagogy.tex`'s `pdexample`) does this
once per section; Concrete Mathematics does it inside a single worked example
and is the sharper model when a chapter has exactly one calculation worth
comparing two ways.

## Axler, *Linear Algebra Done Right*, 3rd ed. (Tier A/B, via seed memo)

States design decisions as decisions in the preface: "Each theorem now has a
descriptive name"; "Exercises now appear at the end of each section, rather
than at the end of each chapter"; "definitions are in beige boxes and theorems
are in blue boxes." Restructures the whole book around one cut (determinants
to the end) to buy a shorter, more motivated path to the Fundamental Theorem
of Linear Maps. States its own limits without apology: "You probably cannot
cover everything in this book in one semester." **Steal**: naming a
restructuring decision as a decision, in the same voice as a result — this is
the model for the boundary paragraph in `references/chapter-template.md` and
for `SKILL.md`'s honesty-ledger rule that a scope cut gets a sentence, not a
silence.

## Spivak, *Calculus*, 3rd ed. (Tier B, via seed memo)

"Every aspect of this book was influenced by the desire to present calculus
not merely as a prelude to but as the first real encounter with mathematics"
(preface). Lamport takes his own epigraph from the same preface: "precision
and rigor are neither deterrents to intuition, nor ends in themselves, but the
natural medium in which to formulate and think about mathematical questions."
**Steal**: the framing move — a first course is not a prelude to the real
subject, it is the subject, done carefully. Applies directly to a chapter that
covers ground a specialist reader thinks they already know (the express lane
in `harbor-exposition` handles the specialist; this line is for the chapter's
own self-conception, not the reader-routing mechanism).

## Strang, *Introduction to Linear Algebra*, 6th ed. (Tier B, via seed memo)

Every section ends with "Review of the Key Ideas," "Worked Examples," a
problem set, and "Challenge Problems"; topic headings in blue. **Steal**: the
fixed, repeated apparatus at section end — a reader who has internalized the
shape of one section can navigate every later one without re-learning the
book's structure. This skill's chapter-end sequence
(`references/chapter-template.md` §Chapter close) is Strang's move promoted to
chapter grain, because the Book's chapters are long enough that section-grain
repetition (Strang's own scale) would itself become the "repeated reader maps"
anti-pattern the reviewers already flagged.

## Sipser, *Introduction to the Theory of Computation* (Tier B, via seed memo)

"Proofs are presented with a 'proof idea' component to reveal the concepts
underpinning the formalism" (publisher copy). **Steal directly, byte for
byte**: this is exactly `pd-pedagogy.tex`'s and `harbor-exposition`'s "proof
idea before proof" rule, and Lamport's "a proof sketch that comes between a
statement and its proof." Three independent sources converging on one move is
as strong a floor as this skill gets to assert.

## CLRS, Cormen–Leiserson–Rivest–Stein (Tier B, via seed memo)

"A starred section is not necessarily more difficult than an unstarred one,
but it may require an understanding of more advanced mathematics" (preface).
Sections end with short exercises; chapters end with "problems" that "often
introduce new material," plus "chapter notes that give historical details and
references." **Steal**: the two-tier exercise system (short section exercises
for the immediate idea, longer chapter-end problems that introduce new
material) and the explicit warning that "starred" tracks difficulty of
prerequisite, not of the section — a signal this skill's rating stars
(`references/exercise-design.md`) must not silently conflate with sheer
difficulty either.

## Pierce, *Types and Programming Languages* (Tier B, via seed memo)

"The approach is pragmatic and operational; each new concept is motivated by
programming examples ... Each chapter is accompanied by numerous exercises and
solutions" (MIT Press copy). **Steal**: "motivated by programming examples"
as the standing instruction for a chapter whose subject is otherwise abstract
— the direct model for this skill's "worked example before definition"
non-negotiable.

## MacKay, *Information Theory, Inference, and Learning Algorithms* (Tier B,
via seed memo)

1–5 exercise rating "similar to that used by Knuth (1968)," recommended ones
"marked by a marginal encouraging rat," and the solution's page number printed
beside the rating. Gives away the free PDF. **Steal, directly**: printing the
solution's page number beside the exercise rather than making the reader hunt
for it — this is `pd-pedagogy.tex`'s `\pdexercise` margin note
(`\itshape Solution p.\,\pageref{sol:#2}`) and the model exercise-ladder
citation this skill treats as essential, not decorative.

## Rudin, *Principles of Mathematical Analysis* (Tier C `[unverified]`; cited
as the counter-example, not the model)

Widely known — and this skill does not have a verified primary-source quote to
cite beyond that reputation — for a terse, motivation-free
definition-theorem-proof presentation with almost no worked examples or
prose bridging. It is the deductivist style Lakatos names in Appendix 2 of
*Proofs and Refutations*, executed at the highest level of technical polish.
**Do not steal**: this skill's "worked example before definition" rule and its
ban on "definitions-first" sections (`SKILL.md` Anti-Patterns) are stated
*against* this style, not derived from it. Rudin earns a place in this canon
only as the honest name for the failure mode Halmos, Gowers, and Chow all
independently warn against.

## Halmos, "How to Write Mathematics" (Tier A, read page by page)

Thirteen rules, quoted and page-cited in the seed memo §3.1; the two load-
bearing for this skill: "the heart of mathematics consists of concrete
examples and concrete problems ... organize your work around the central,
crucial examples and counterexamples" (p. 129), and "tell the reader where
every statement stands ... Complete honesty makes for greatest clarity" (p.
137). Also the omission rule this skill's anti-patterns section is built on:
"Half the art of good writing is the art of omission" (p. 149).

## Knuth, Larrabee, Roberts, *Mathematical Writing* (Tier B, via seed memo)

Confirmed by derivative course notes rather than held directly: separate
symbols with words, never open a sentence with a symbol, one notation per
thing. Overlaps Halmos's mechanics rules exactly; cited here because it is a
second, independent source for the same floor, from a CS-pedagogy course
(Stanford CS 209) rather than a pure-math one.

## Pólya, *How to Solve It* (1945) — Tier B (seed memo); corpus present but
its own knowledge-map extraction returned empty on this pass, see
`references/sources.md`

Four phases, in order, never skipped: **understand the problem**, **devise a
plan**, **carry out the plan**, **look back**. "Look back" is the phase every
textbook's exercise apparatus drops first under deadline pressure — a
worked example that stops at the answer has skipped Pólya's fourth phase, not
merely trimmed length. `references/exercise-design.md` builds the exercise
ladder directly on these four phases plus Mason–Burton–Stacey's, below.

## Lakatos, *Proofs and Refutations* (1976) — Tier A (corpus fetch, this pass)

A proof is "a thought-experiment which suggests a decomposition of the
original conjecture into subconjectures or lemmas" — not a guarantee, a
structured argument that can be locally or globally refuted. **Local
counterexample**: refutes a lemma; the proof can be repaired. **Global
counterexample**: refutes the main conjecture; the claim itself must change.
**Monster-barring** (anti-pattern, named directly in `SKILL.md`): redefining a
term to exclude an inconvenient counterexample as "not really" an instance,
rather than engaging it — the mathematical-exposition version of narrowing a
claim's scope after the fact without saying so. Appendix 2's attack on
"deductivist style" is the seed memo's own citation for why Euclid's
`Elements` is a bad pedagogical template despite its historical stature:
"Deductivist style hides the struggle, hides the adventure... the successive
tentative formulations of the theorem ... are doomed to oblivion while the end
result is exalted into sacred infallibility." **Steal**: an exercise or a
chapter's own text should show which counterexample forced which correction,
not present only the corrected final form — directly actionable for this
project's own memo-solution-key corrections (`references/exercise-design.md`
§Premise corrections), which already do this.

## Hersh, *What Is Mathematics, Really?* (1997) — Tier A (corpus fetch, this
pass)

The **front/back distinction**: the front is the polished
definition-theorem-proof presentation; the back is "guessing, tentative
exploration, messy reasoning" — the actual research process. "You have to
guess a mathematical theorem before you prove it; you have to have the idea of
the proof before you carry through the details." "The working mathematician is
a Platonist on weekdays, a formalist on weekends" — experts hold both views at
once; novices are shown only the front and never told the back exists.
**Steal, directly**: this is the theoretical justification for "worked example
before definition" that this skill shares with `harbor-exposition` and with
Gowers's "examples first" — not a stylistic preference but a claim about how
the idea was actually found, which the chapter owes the reader honestly.

## Mason, Burton, Stacey, *Thinking Mathematically* (1982/2010) — Tier B (this
pass's web search)

Four processes, cutting across Pólya's four phases rather than replacing them:
**specializing** (work a particular instance), **generalizing** (find the
pattern that instance exhibits), **conjecturing** (state what you think is
true), **convincing** (make the case, to yourself first, then to a
"friend," then to an "enemy" — the reviewer's own escalating audience). Their
own two-phase decomposition of problem solving — **entry** and **attack**
contain specializing; **attack** and **review** contain generalizing — maps
directly onto the chapter opener's page-1/page-2 split
(`references/chapter-template.md`): the failure-scene and worked example are
entry/specializing; the proof idea and theorem are attack/generalizing; the
boundary section is review.

## Tufte, *Beautiful Evidence* (2006) and Tufte-LaTeX (Tier B, via seed memo)

"Sidenotes are much better than footnotes because you never know what the
footnote holds. Sidenotes are best when the reader can tell, out of the
corner of her eye, whether they are worth examining." The asymmetric page
(wide margin column, narrower text column) this recommends is exactly
`HANDOFF-TEXTBOOK.md`'s settled trim (7×10 in, 4.5 in column, 1.3 in margin
column) and exactly what `pd-pedagogy.tex`'s `\ifpdmargincolumn` switches on.
**Steal**: every provenance pointer — a result ID, a citation, a solution page
number — belongs in the margin, not in a footnote or a parenthetical, so it
"costs nothing to ignore and nothing to follow."

## Osborne & Rubinstein, *A Course in Game Theory* (1994) — Tier B, via seed
memo

Their preface has a section no math or CS book here has: "Disagreements
Between the Authors" — "We see no reason why a jointly authored book should
reflect a uniform view" — and they explicitly decline completeness rather than
pretending to it. **Steal**: naming a genuine unresolved disagreement in the
text, at the point it matters, instead of silently picking a side and hiding
the debate — directly relevant to a book with multiple contributing sessions
whose judgments sometimes differ (see `HANDOFF-TEXTBOOK.md` §6, "open
decisions for the author").

## Corpus: Gawande, *The Checklist Manifesto* (2010) — Tier A (corpus fetch,
this pass)

A good checklist is short (one page, 60–90 seconds), targets 5–9 **killer
items** — the steps a skilled practitioner is most likely to skip under
pressure or complexity, not every step — and comes in two disciplines:
**READ-DO** (perform each step as you read it, for an unfamiliar procedure)
and **DO-CONFIRM** (perform from memory, then pause to verify, for an expert).
"First drafts always fail" — checklists are tested against real deployment
conditions and revised, not designed once from a desk. **Steal, directly**:
`scripts/chapter_lint.py`'s whole design brief. It is a DO-CONFIRM checklist
for an author who already knows how to write a chapter, not a READ-DO
tutorial — it reports floors crossed, not "how to write a good chapter."

## Corpus: Meadows, *Thinking in Systems* (2008) — Tier A (corpus fetch, this
pass)

Leverage points ranked from weakest to strongest: parameters, information
flows, rules, goals, paradigms — "power over the rules is real power," and the
higher the leverage, the more resistance the intervention meets. "A stock is
the present memory of the history of changing flows within the system."
**Steal, as a diagnostic**: when a chapter reads badly, ask which leverage
level the fix belongs at before touching prose. An "estimator catalog" or a
"repeated reader map" (`SKILL.md` Anti-Patterns) is a parameter-level fix
(add more content) papering over a structural one (the chapter doesn't know
what it's for); the honest fix is at the rules/goals level — cut the section,
don't decorate it.
