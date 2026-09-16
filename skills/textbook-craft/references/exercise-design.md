# Exercise design: the ladder, the kinds, the solution-key rules

## The four phases (Pólya) and four processes (Mason–Burton–Stacey)

Every exercise, worked example, and chapter's own argument should be locatable
on Pólya's ladder:

1. **Understand the problem** — restate it in your own words; identify what is
   given, what is sought, what is the condition.
2. **Devise a plan** — find the connection to something already known; have
   you seen this problem, or one like it, before?
3. **Carry out the plan** — execute, checking each step.
4. **Look back** — can the result be checked? Can it be derived differently?
   Can the method be used for some other problem?

Phase 4 is the phase every rushed apparatus drops first. A worked example that
stops at the numeric answer has skipped it, not merely shortened it — mark the
gap honestly rather than pretending the example was complete.

Mason–Burton–Stacey's four processes cut *across* the four phases rather than
replacing them, and map onto the chapter opener directly
(`references/chapter-template.md`):

| Process | What it does | Where it lands in a chapter |
|---|---|---|
| Specializing | work one concrete instance | the worked example, page 2 |
| Generalizing | state the pattern the instance exhibits | the proof idea → theorem box |
| Conjecturing | say what you think is true, before proving it | the claim box, stated before its proof |
| Convincing | make the case — to yourself, then a "friend," then an "enemy" | the proof itself, then the objections (the *Summa*'s move) |

## Kinds and ratings

Three kinds, exactly (per `pd-pedagogy.tex`'s `\pdexercise` and the review
corpus's own vocabulary; do not invent a fourth):

- **Check** — short, closed, one right answer, tests whether the reader
  understood the definition or claim just given.
- **Trace** — walk a concrete mechanism through a specific run by hand;
  the reader produces a trace, not a proof.
- **Open** — a design or proof obligation with no single closed-form answer;
  gets a defensible obligation in the solutions, never a fabricated closed
  form (see §Solution-key rules).

Rating: 1–3 stars (not Knuth's finer 00–50 scale — too fine-grained for a
seven-chapter book with a fixed apparatus; MacKay's coarser 1–5, itself
modeled on Knuth, is the closer ancestor and this skill's 1–3 is MacKay's
scale compressed further for a smaller total exercise count per chapter).
Star count answers "how much of the section's apparatus does this need," not
raw difficulty — a 1-star Check can still be conceptually hard if it is
short and closed; a 3-star Open is not "the hardest exercise," it is the one
whose answer the solutions key cannot give in closed form.

## Placement: chapter end, never mid-argument

Exercises live in a chapter-end `Exercises` section grouped by the section
they test (`\pdexercisesfor{\S\ref{sec:x}}{Section title}`), with a margin
pointer at the point in the body where the cluster used to interrupt the
argument (`\pdexercisepointer`/`\pdexercisepointerone`). This is not a style
preference — it is Wave 12's own measured finding (`READING-FLOW-AUDIT.md`
F1): "exercises interrupted the argument in triples after almost every
section," fixed by "mov[ing] to chapter-end Exercises sections with margin
pointers." `whitepaper/single-writer-kernel.tex`'s `\exercises{...}` blocks,
scattered after nine subsections, are the *pre-fix* pattern —
`scripts/chapter_lint.py` detects exactly this and reports it as a floor
violation, not a style note.

**Two-tier split** (CLRS): short section-grain exercises test the immediate
idea; longer chapter-end "problems" may introduce new material the section
itself did not cover. Do not silently promote a new mechanism the chapter depends on
into a starred exercise — a Coordination Review finding already named this
failure directly: a threat model "belongs in Chapter II's threat model as a
named section, not in a starred exercise."

## Fading within a ladder

Renkl & Atkinson's fading (`references/learning-science.md`): across a
section's exercise sequence, remove one worked step at a time rather than
jumping from a fully worked example straight to a blank exercise.

```
Example 1 (fully worked, every step shown, in the pdexample block)
  ↓ fade one step
Exercise 1.1 (Check, ★) — same shape, last step left for the reader
  ↓ fade further
Exercise 1.2 (Check/Trace, ★★) — two steps left for the reader
  ↓ generalize the shape
Exercise 1.3 (Open, ★★★) — the reader supplies the whole plan
```

A section that jumps from one fully-worked example to a 3-star Open exercise
has skipped the ladder's middle rungs — `scripts/chapter_lint.py` cannot
detect a missing *rung* mechanically (it has no notion of difficulty), but it
does report the raw count and kind distribution per section so a reviewer can
see the gap.

## Solution-key rules (project-internal, quoted verbatim)

From `docs/harbor-research/exposition/memo-solution-key.md`, itself quoting
*The Harbor After the Harbor*'s own solution key (memo page 13):

> "Where an exercise depends on a false premise in the manuscript, the
> solution repairs the premise instead of manufacturing the requested
> conclusion."

> "Open problems receive a defensible design or proof obligation rather than a
> fictional closed-form solution."

Both rules generalize past the exercise apparatus: apply Rule 1 whenever a
chapter's own body states something that later analysis shows to be false,
overscoped, or the wrong direction (see the memo-solution-key's own worked
instances — a corrected Theorem III.6.1, a corrected Figure I.6/Eq. I.1,
several "correction" trace items). The fix is a correction stated plainly,
followed by the intended answer; it is never a silent rewrite that erases what
was wrong, and never an answer that quietly assumes the false premise was
true. Apply Rule 2 to every `Open`-kind exercise's solution and to any
open item in the chapter's own "what this chapter deliberately did not solve"
section (`SKILL.md` §Honesty ledger): say whether it is proved elsewhere,
promised later with a pointer, out of scope with a reference, or unknown.
"Confess immediately" (Halmos, p. 137) is the same rule in one sentence.

## Premise corrections: worth citing, not hiding

Lakatos's local/global counterexample distinction
(`references/canon.md` §Lakatos) is the theoretical frame for why a premise
correction belongs in the text rather than a quiet edit: a **local**
counterexample (a lemma was wrong; the theorem survives, re-scoped) and a
**global** counterexample (the theorem itself was false as stated) call for
different repairs, and the memo-solution-key's own corrected items are
instances of exactly this — e.g. "A uniqueness constraint proves at most one
row per exact key. It does not exclude overlapping line intervals... The
theorem must be scoped accordingly" is a local correction (the theorem
survives, re-scoped); "Free fresh identities do not by themselves imply that
every sanction disappears... The valid theorem is conditional" is closer to a
global one (the universal claim as printed is false; a conditional replacement
is proposed). A chapter that hides such a correction inside a silent revision
loses the pedagogical value Lakatos is arguing for: the reader should see
*which* counterexample forced *which* kind of repair.

## Recitation prompts: interleaved, not summarized

Three retrieval prompts per section (`pdrecitation`, "Recall" — see
`references/learning-science.md` §Retrieval practice). At least one prompt per
chapter should re-ask an earlier chapter's question from the new chapter's
vantage point — Halmos's spiral (rule 7, p. 133: "review Section 1 ... from the
point of view of Section 2") made explicit and interleaved (Rohrer/Bjork).
Never replace a recitation prompt with a restated summary sentence: a summary
is rereading, not retrieval, and Dunlosky et al. rated rereading low-utility
against retrieval practice.
