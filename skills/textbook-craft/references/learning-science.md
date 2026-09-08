# Learning science: the evidence behind the craft rules

Every rule in `SKILL.md`'s decision tree and `references/chapter-template.md`
traces to one of these findings. This file exists so a reviewer who doubts a
rule ("why does the worked example have to come before the definition?") can
check the citation rather than take the skill's word for it. Tiers follow
`references/sources.md`.

## The worked-example effect (Tier A, via seed memo)

Sweller & Cooper 1985 (*Cognition and Instruction* 2(1), 59–89): algebra
students who studied worked examples, with total study time held fixed,
later solved transfer problems faster and with fewer errors than students who
spent the same time solving problems from scratch. Kirschner, Sweller, Clark
2006 (*Educational Psychologist* 41(2), 75–86) generalize: for novices, guided
instruction beats minimally guided discovery — "discovery learning" is not
free, it costs working-memory capacity a novice does not have to spare.

**Rule derived**: at least one fully worked example per section, before the
general statement, with every step shown (`references/exercise-design.md`
§Worked-example discipline).

## Expertise-reversal effect (Tier A, via seed memo)

Kalyuga, Ayres, Chandler, Sweller 2003 (*Educational Psychologist* 38(1),
23–31): scaffolding that helps a novice can measurably *hurt* an expert —
redundant explanation the expert already holds in long-term memory now
competes for the same working-memory capacity as the material being read.

**Rule derived**: the express lane. `harbor-exposition`'s Rail A (one-breath
sentence, then the box, for the expert who wants to jump straight there) is
this effect made structural, and this skill's chapter opener adopts the same
split (`references/chapter-template.md` §Page 2, "the route and the express
lane"). A chapter with only one reading path is, for exactly half its
audience, actively worse than no scaffolding at all — not merely
unoptimized.

## Fading (Tier A, via seed memo)

Renkl & Atkinson 2003 (*Educational Psychologist* 38(1), 15–22): remove worked
solution steps one at a time across a sequence of examples, so the reader
supplies the missing step, rather than presenting either all-worked or
all-blank problems.

**Rule derived**: an exercise ladder within a section (or across a chapter's
worked examples) should visibly narrow the amount of the solution shown, not
present three equally-worked examples or jump straight from one full worked
example to a blank exercise. `references/exercise-design.md` §Fading gives the
concrete three-step pattern.

## Self-explanation effect (Tier A, this pass's web search)

Chi, Bassok, Lewis, Reimann, Glaser 1989 (*Cognitive Science* 13(2), 145–182):
studying the *same* worked examples, "good" students who spontaneously
explained each step to themselves — connecting an action back to the
underlying principle — learned substantially more than "poor" students who
read the same examples without self-explaining. Chi & VanLehn 1994 (*Cognitive
Science* 18, 439–477) showed the effect can be *elicited*: prompting students
to explain, even those who would not do it spontaneously, improves outcomes.

**Rule derived**: a worked example's prose should name *why* each step is
taken, not only *what* the step is — the "Numbers by hand" convention in
`pd-pedagogy.tex`'s `pdexample` environment should read as an explanation a
reader could have generated, not a computation a reader must merely verify.
Retrieval prompts (`pdrecitation`, "Recall") that ask "why" rather than "what"
are the elicited form of this effect, applied at review time instead of study
time.

## Retrieval practice, not rereading (Tier A, via seed memo)

Roediger & Karpicke 2006 (*Psychological Science* 17(3), 249–255): "Taking a
memory test not only assesses what one knows, but also enhances later
retention" — the testing effect. After a week, students who were tested
retained more than students who reread the same material for equal time.
Karpicke & Blunt 2011 (*Science* 331, 772–775): retrieval practice beat
concept-mapping even when the final test *was* a concept map — the advantage
is not test-format matching, it is the act of retrieval itself. Dunlosky,
Rawson, Marsh, Nathan, Willingham 2013 (*Psychological Science in the Public
Interest* 14(1), 4–58) rated practice testing and distributed practice the two
"high utility" study techniques of ten reviewed; rereading and highlighting —
the two most common student strategies — rated low utility.

**Rule derived**: short retrieval prompts at section end, with the answer
available but not adjacent (Halmos's honesty rule again: a reader who cannot
check an answer is not being tested, they are being asked to trust). Never
substitute a summary paragraph for a retrieval prompt — rereading a summary is
exactly the low-utility strategy Dunlosky et al. measured against retrieval.

## Desirable difficulties: interleaving and spacing (Tier B, this pass's web
search)

Rohrer & Taylor 2007: shuffling the order of mathematics practice problems
(interleaving) *dropped* practice accuracy from 89% to 60% — but raised
accuracy on a test given a week later from 20% to 63%. The difficulty during
practice is not incidental to the later gain; it is a large part of what
causes it — a "desirable difficulty" (Bjork). Rohrer & Hartwig 2020: "That
difficulties can be desirable is not intuitive" — the effect is easy to
undersell in a self-report from the learner, who *feels* like blocked practice
worked better.

**Rule derived, applied carefully**: a chapter's own retrieval prompts and
review problems should re-ask earlier material interleaved with new material
— Halmos's "spiral" (§3.1 rule 7 in `references/canon.md`) is exactly this,
independently arrived at from the mathematical-writing side. But this is a
rule for the *reader's own review schedule* across chapters, not a license to
scatter a chapter's own exercises mid-argument — that is a *different*
difficulty (losing the argument's thread), not a desirable one, and it is
exactly what Wave 12's finding F1 (`READING-FLOW-AUDIT.md`) measured as a
reading-flow defect on this book's own rendered pages. Desirable difficulty in
retrieval timing and undesirable difficulty in argument continuity are not the
same axis; do not use one literature to justify the other.

## Concreteness fading, with a caveat (Tier A, via seed memo)

Fyfe, McNeil, Son, Goldstone 2014 (*Educational Psychology Review* 26(1),
9–25): begin with a concrete instance and fade explicitly toward the abstract
form, rather than presenting either extreme alone. Kaminski, Sloutsky, Heckler
2008 (*Science* 320, 454–455) reported a transfer advantage for a single
*abstract* presentation over multiple concrete ones; a 2020 replication
narrowed that claim considerably.

**Rule derived, stated as a caveat rather than a rule**: "concrete before
abstract" is not unconditionally supported by every study in this literature.
The defensible, narrower claim this skill actually asserts: examples must be
simple, motivating, and illustrative — and a well-chosen abstract example can
itself be all three (a 3×3 matrix is "concrete" in Halmos's sense even though
it is already symbolic). Do not cite Fyfe et al. as proof that every chapter
needs a training-wheels concrete pass before its real content; cite it only
for the narrower claim that the reader's first encounter with an idea should
not be its most general form.

## Where the honesty ledger comes from (Tier A, project-internal + Meadows)

The memo-solution-key's two governing rules — "where an exercise depends on a
false premise ... the solution repairs the premise instead of manufacturing
the requested conclusion" and "open problems receive a defensible design or
proof obligation rather than a fictional closed-form solution" — are not
externally sourced learning-science findings; they are this project's own
discipline, and this skill imports them unchanged
(`references/exercise-design.md` §Solution-key rules). They pair with
Meadows's leverage-points ranking (`references/canon.md` §Meadows): a false
premise is a structural defect, and papering over it with a plausible-looking
answer is a parameter-level patch on a rules-level problem.
