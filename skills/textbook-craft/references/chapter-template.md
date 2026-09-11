# The chapter template

The exact page-1/page-2 sequence, sourced from
`docs/harbor-research/exposition/TEXTBOOK-CRAFT.md` §7.1, with the apparatus
vocabulary from `whitepaper/figures/pd-pedagogy.tex` bound to each element.
Follow this order; do not reorder it without a reason a reviewer could check
against `references/canon.md`.

## Page 1 (recto)

1. **Number and proposition-title.** The chapter's proposition sentence is
   its title (per the architecture note the memo cites).
2. **One epigraph, at most two**, set per Chicago Manual of Style ¶1.37: block
   quotation, no quotation marks, source line with a dash, author and work
   only — no full citation. *Admission test*: it must say, in someone else's
   older words, the thing the chapter will make precise (Locke's "acts of the
   mind" for abstraction; Lovelace for symbolic computation). If you cannot
   state in one sentence what the chapter does to the epigraph, cut it.
   Prefer a primary-source sentence from the chapter's own lineage (Ostrom,
   Lampson, Hume, Coase, Aumann, Lamport) over a generic aphorism.
3. **The failure, as a scene with a number in it** (three to eight sentences).
   A concrete operator, swarm, and loss at a stated scale ("four hundred
   summaries an hour, one of which hides the write that mattered"). No
   terminology yet — this is Feynman's drop of water and SICP's dam, not a
   definitions section wearing a scene's clothes.
4. **The question, in one italic sentence**, in the *utrum* ("whether...")
   form. Example shape: *What must remain visible?*
5. **The claim in one breath, boxed, with its epistemic kind.** Halmos: state
   the theorem "first," in one short sentence (p. 138). Use `pdclaim{KIND}{...}`
   with `KIND` one of the four in `SKILL.md`'s honesty ledger (`Theorem`,
   `Design invariant`, `Model-checked property`, `Empirical hypothesis`); the
   box carries the claim in words plus its governing result ID.

## Page 2 (verso)

6. **Objections, three numbered sentences.** The strongest reasons a
   competent reader will think the claim false or trivial, in their best
   form, each with a forward pointer to the section that answers it — the
   *Summa*'s move (objections stated by the author, first, in their best
   form) and Feynman's "You might ask why we cannot...".
7. **The route and the express lane, one paragraph.** State the chapter's
   order and mark which sections an expert may skip and which a newcomer must
   not (CLRS's starred-section sentence is the template). This is
   `harbor-exposition`'s Rail A, restated for a chapter rather than a
   standalone result.
8. **First worked example, hand-checkable, before any definition.** Numbers
   the reader can redo on paper (Halmos's 3×3 case; Feynman's apple). Only
   after this does the first definition appear, and every definition is
   followed at once by an example *and* a non-example (Halmos rule 7).

Nothing else appears on these two pages: no abstract, no keyword list, no
reading-time estimate, no learning-objective bullets, no result table. Those
belong in the manifest (`mega-volume-epistemic-manifest.yaml`) and a
front-matter "Guide to the chapters," never in the chapter's own opening.

`scripts/chapter_lint.py`'s `chapter_opener_and_claim_labeling` floor checks
the mechanical half of this mechanically: whether the first `\section`
opens with prose or an epigraph macro rather than a cold table or claim
environment (advisory today — no chapter in the corpus yet calls an
`\epigraph` macro), and whether every claim-like environment is tagged.

## Body: proof discipline

Every theorem is preceded by a labelled **Proof idea** in plain English
(Lamport's "proof sketch that comes between a statement and its proof";
Sipser's identical convention). A proof longer than about ten lines is a
hierarchical structured proof with named steps, a final Q.E.D. step
restating the goal, 4–10 steps per level, readable at the top level with
subproofs ignored (Lamport). A mechanized result (ProVerif, Kani, TLC) cites
the machine-checked artifact by ID in the proof's first line; the prose proof
then states only what the machine did *not* check.

## Body: worked-example discipline

At least one worked example per section, always before that section's general
statement, with numbers the reader can redo by hand — never a schematic
calculation with variables standing in for numbers. Fade the ladder across a
section's examples and exercises (`references/exercise-design.md` §Fading).
The `pdexample` environment's own head ("Numbers by hand") is the contract:
if a passage cannot honestly claim the reader could redo it on paper, it is
not a worked example and should not use the environment.

## Chapter close

In order:

1. **"Review of the Key Ideas"** (Strang's phrase) — a list of *what remains
   coupled*: the claims and mechanisms this chapter's later chapters will
   depend on, not a restatement of every sentence in the chapter.
2. **Exercises**, grouped by the section they test
   (`\pdexercisesfor{\S\ref{sec:x}}{Section title}`), never scattered mid-body
   (`references/exercise-design.md` §Placement). `chapter_lint.py`'s
   `exercises_at_chapter_end` floor checks this: every `pdexercise` cluster
   must sit inside the chapter's own closing `\section{Exercises}` (advisory
   today — the Book's chapters have not all been relocated yet).
3. **"History and references"** (Nielsen–Chuang/CLRS's phrase) — citations for
   the whole chapter, with a locator into each source (page/section for a
   book, theorem number for a paper, script and seed for a number) as a
   sidenote, so a reader can leap from the chapter's sentence to the original
   passage without a search.
4. **The handoff**: "what this chapter deliberately did not solve," written in
   Halmos's imperative — for each open item, say whether it is proved
   elsewhere, promised later with a pointer, out of scope with a reference, or
   unknown ("Confess immediately!"). Lamport's "possible, not inevitable" is
   the model sentence for any mechanism whose guarantee depends on operation
   rather than on the theorem itself.

## Design constraints (settled, do not relitigate per chapter)

From `docs/harbor-research/exposition/HANDOFF-TEXTBOOK.md` §3: trim 7×10 in,
one-sided, 4.5 in text column, 1.3 in margin column always on the right. A
content kind is signalled by typography and the margin — never a tinted
rectangle (`SKILL.md` §Page grammar has the full table). Color for navigation,
status, and semantic contrast only: two box colors, one accent for headings, a
series color for part openers — never a rainbow of content-kind fills.

## Interludes: the one exception, named as such

One philosophical or historical frame per chapter may survive as an
explicitly-labelled **Interlude** (the *Gödel, Escher, Bach* dialogue slot,
not the argument's premise) — never something the argument rests on, never silently woven into
the argument's own prose. `HANDOFF-TEXTBOOK.md` §6 names live candidates for
this treatment (the Parfit interlude; Hobbes, Sen, Krakoa) as open author
decisions, not settled placements — this skill does not decide those for the
author, it only fixes the *form* an interlude must take once chosen: named,
bounded, and skippable without losing the chapter's argument.
