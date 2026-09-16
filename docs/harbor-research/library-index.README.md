# The Harbor library index

`docs/harbor-research/library-index.json` is the source of record for one question:
**where does each idea live?** Every result the Harbor Research Program has executed
(R1-R17, CR, B6, per `skills/harbor-results/references/results-compendium.md`) started
life in a standalone paper under `docs/harbor-research/tex/paper1.tex` ... `paper7.tex`.
Some of those results have since been folded into the Coordination Papers textbook
(`whitepaper/textbook.json`'s seven chapters) -- retold in a chapter's own voice, with
its own worked numbers, alongside or instead of the paper's. When a result lives in two
places, both copies need to agree, forever, as either one gets edited. This index says
which results those are, where both copies live, and what numbers must match between
them; `scripts/harbor-research/check_library_index.py` is the checker that enforces it.

Companion documents:
- `docs/harbor-research/library-index.schema.json` -- the JSON Schema (draft-07) for
  `library-index.json`, with a doc-comment on every field.
- `docs/harbor-research/LIBRARY-INDEX.md` -- a generated, human-readable render of the
  index (one section per entry). Never hand-edit it; it is `--write-md`'s output.
- `docs/harbor-research/LIBRARY-SYSTEM.md` -- the system this index is one part of
  (maintained separately; the twin-location headers in the `.tex` files point at it).

## The shape of an entry

Every idea is **one** `entries[]` record, no matter how many files carry it:

```jsonc
{
  "id": "R1",                     // R1..R17, CR, B6, or a label-style id like
                                   // "prop:claim-signaling-ic" for a folded theorem
                                   // that isn't part of that canonical catalog
  "kind": "theorem",               // theorem | lemma | proposition | definition |
                                    // conjecture | corollary | result-family |
                                    // counterexample -- "result-family" is for an id
                                    // that bundles more than one boxed statement
  "title": "...",
  "one_breath": "...",             // one sentence: the paper's own \onebreath{...}
                                    // line for this result if it has one, else the
                                    // theorem/definition statement's first sentence
  "standalone": {                  // the docs/harbor-research/tex/paperN.tex home,
    "file": "docs/harbor-research/tex/paper1.tex",
    "labels": ["sec:floor"],       // \label{...} keys that must exist in file
    "sections": ["S2 (sec:floor), Theorem 1"]   // human pointer, not machine-checked
  },                                // -- or `null` if no paperN.tex has it (yet)
  "chapters": [ { "file": "...", "chapter": 3, "prefix": "ls",
                  "labels": [...], "sections": [...] } ],  // [] if not folded
  "figures": ["docs/harbor-research/figures/fig-r1-relation.tex"],
  "scripts": ["skills/harbor-results/scripts/a7_experiment.py"],
  "numbers": [ { "name": "floor_B_star_bits", "value": "5.98",
                 "tag": "verified", "regex": "5\\.98" } ],
  "mechanization": [],             // .pv / .tla / .z3 / Kani-harnessed .rs paths
  "site": ["/research/paper1.pdf"],
  "status": "folded"               // folded | standalone-only | chapter-only | unplaced
}
```

Read every field's exact contract in `library-index.schema.json` before adding one --
this file only covers the judgment calls the schema can't encode.

### `status`, and why there are four values, not three

- **folded** -- lives in a `standalone` paper *and* at least one chapter.
- **standalone-only** -- a paper has it; no chapter (yet) restates it.
- **chapter-only** -- a chapter has it; no a research paper under `docs/harbor-research/tex/` file
  does. This is real, not a placeholder: R14 and R16 are tagged `paperNumbers: ['1']`
  on the public research-library page (`website-v2/src/data/researchPapers.ts`) as
  "Paper 1's orbit", but `paper1.tex` itself contains no R14/R16 content today (grep
  it) -- their only written-out home is `whitepaper/legible-swarm.tex`. That is a real
  gap between the site's claim and the file on disk, not a modeling choice this index
  should paper over; if a paper1.tex draft later grows that content, promote the entry
  to `folded` and add the twin header pair.
- **unplaced** -- neither a paper nor a chapter has it. Today this is only **R8**,
  which the results compendium itself records as having no paper; its only home is
  the compendium prose and `skills/harbor-results/scripts/c0_workunit.py`. This is a
  deliberate, documented extension of the task's three-value enum (`folded` /
  `standalone-only` / `chapter-only`) -- forcing R8 into `standalone-only` or
  `chapter-only` would assert a location that does not exist. If a future wave folds
  R8 into a chapter, move it to `chapter-only` (or `folded`, once a paper appears).

### Choosing an `id`

Use the R-number (or `CR`/`B6`) whenever the idea is one of the 17 executed results
plus the two named companions in the compendium. For anything else worth indexing --
a result that is *provably* the same in two files but isn't part of that catalog --
use a label-style id built from the shared LaTeX label
(e.g. `prop:claim-signaling-ic`, folded between `paper3.tex`'s S(signaling) and
`agent-transactions-whitepaper.tex`'s claim-signaling-incentive-compatibility
proposition -- same discount-factor threshold, same `proofs/economics/*` mechanization,
two files). Don't invent an entry for a chapter-native theorem that has no twin
anywhere else; list it in `unindexed_allow` instead (see below) -- most of the ~90
labels in the seven textbook chapters are exactly that: real theorems, with no
a research paper under `docs/harbor-research/tex/` counterpart, out of scope for this index.

### `numbers[]` is optional, and it's fine to leave it empty

A number only belongs in `numbers[]` if the *same digits* are checkable at every
location the entry lists. Two locations frequently state the same theorem with two
different **worked examples** (R15's specialization boundary is illustrated with
`(ρ=0.1,c=2)` in `paper6.tex` and with a completely different `(λ=2/hr, μ=3/hr)`
roadmap-owner instance in `legible-swarm.tex` -- same formula, no shared digit). Don't
force a match by loosening the regex to something generic (`\d+` would "pass" against
anything); leave `numbers` empty for that entry instead, or claim only the sub-fact
that genuinely repeats (`R2` skips the two locations' different worked examples and
checks `2.13` alone, since both texts state that one ratio identically).

## How to add an entry

1. Read the result's statement in its a research paper under `docs/harbor-research/tex/` home (or
   confirm it has none, for a `chapter-only` id) and, if folded, in the chapter that
   restates it. Look for the chapter naming its source explicitly -- `\cite{paper1}`,
   `\cite{harborpaper5}`, "item R14 of the research ledger", "Def. III.6.1" -- that is
   the strongest evidence a fold is real and not a coincidental shared vocabulary.
2. Write the `entries[]` object (see shape above). Copy the paper's own
   `\onebreath{...}` line for `one_breath` when it has one.
3. If folded, add the **twin-location header** (see below) to the top of both files,
   before `\documentclass`, if it isn't there already -- a chapter or paper that
   already carries a header for a *different* id just needs this id added to its
   `Index ids` line and, if new, this file added to its `Standalone paper`/`Chapter`
   line(s); don't stack a second header block in the same file.
4. Run the checker (below). Fix whatever it names -- most first-draft failures are
   either a typo'd label or a `numbers[]` regex that doesn't tolerate the two files'
   independent LaTeX formatting of the same digits (a thousands-separator `{,}` in
   one file and not the other is the recurring one; write the regex to match both,
   e.g. `1(\{,\}|,)?350` matches "1350", "1,350" and "1{,}350").
5. Run `--write-md` and commit the regenerated `LIBRARY-INDEX.md` alongside the JSON.

### Twin-location headers

Both files of a folded pair carry an identical-in-structure LaTeX comment block,
before `\documentclass`, naming each other:

```latex
% -----------------------------------------------------------------------
% TWIN-LOCATION NOTICE. This file is one of the shared homes for the same
% results; edit every listed home or the drift checker fails.
%   Standalone paper : docs/harbor-research/tex/paper1.tex (S2-S5)
%   Chapter          : whitepaper/legible-swarm.tex (Chapter 3, The
%                       Legible Swarm; S6 Read-poverty, S7 Discovery,
%                       S8 Tokens)
%   Index ids        : R1, R2, R3, R4
%   Check            : python3 scripts/harbor-research/check_library_index.py
%                      python3 scripts/harbor-research/check_propagated_corrections.py
%                      python3 scripts/harbor-research/check_citations.py
%   System document  : docs/harbor-research/LIBRARY-SYSTEM.md
% -----------------------------------------------------------------------
```

Rules the checker enforces (`check_twin_headers`, which is check (d) of `check_library_index.py`, the twin-header check listed under drift detection in `LIBRARY-SYSTEM.md`):
- The block must contain the literal string `TWIN-LOCATION NOTICE` somewhere before
  `\documentclass`.
- Every partner file this entry's fold requires must be named -- by full repo-relative
  path or by basename -- **as one unbroken string**: don't hyphenate a filename across
  a line wrap (`federated-harbor-\n  whitepaper.tex` does not contain the substring
  `federated-harbor-whitepaper.tex`). Wrap before the filename instead.
- Every index id the fold covers must appear in the header text somewhere.
- A chapter or paper with **more than one** twin (e.g. `legible-swarm.tex` folds
  results from both `paper1.tex` and `paper6.tex`) gets multiple `Standalone paper` /
  `Chapter` lines in **one** header block, not one block per partner.
- Keep the whole block under 14 lines. Use plain ASCII dashes (`% ---...`) in a file
  whose other comments are plain ASCII, or the box-drawing dash (`─`) already used in
  a file's own `%` comments -- match what's already there.
- A `chapter-only` or `standalone-only` (or `unplaced`) entry has only one location
  and needs no header at all; don't add one pre-emptively.

The header is comment-only, placed before `\documentclass`, and must never change
typeset output. After adding one, regenerate the Book
(`node scripts/generate-mega-whitepaper.mjs .cache/<anything>`) and run
`node --test scripts/generate-mega-whitepaper.test.mjs` to confirm nothing moved.

### `unindexed_allow[]`

The coverage checker (check (b)) demands that *every* `\label{thm:...|lem:...|
prop:...|cor:...|def:...|conj:...}` and every `\begin{theorem|lemma|proposition|
corollary|definition|conjecture}` across the three corpora is accounted for --
claimed by some entry, or listed here with a reason. Two shapes of allow entry:

- **A real label with no twin.** `{"id": "prop:legible-sovereign", "file":
  "whitepaper/legible-swarm.tex", "reason": "Chapter-native ... not part of the
  R1-R17/CR/B6 catalog."}` -- the overwhelming majority of the ~90 entries here. This
  is not a loophole; it's the expected state for a chapter theorem that simply has no
  research-paper counterpart.
- **An unlabeled theorem-family environment.** Task scope for this wave forbids
  editing `.tex` files beyond the twin-location headers, so a pre-existing
  `\begin{corollary}[...]` with no `\label` (there are six: one in `paper1.tex`, two
  each in `exec1.tex`/`exec2.tex`, one in `anchor-protocol-whitepaper.tex`) cannot be
  fixed by adding a label from this wave. Allow it with the synthetic id the checker
  itself computes and prints on failure: `unlabeled-env:<repo-relative-file>:<line>`.
  **This id is line-number-sensitive** -- editing anything above that line (including
  a future twin-location header insertion) shifts it, and the checker will fail
  loudly, naming the *new* line, until the allow entry is updated to match. That is
  working as intended, not a bug to route around with a looser id scheme: it is a
  live check that the reference still points at the environment it claims to.

## Running the checker

```bash
python3 scripts/harbor-research/check_library_index.py            # checks (a)-(e)
python3 scripts/harbor-research/check_library_index.py --verbose  # + the full inventory
python3 scripts/harbor-research/check_library_index.py --write-md # regenerate LIBRARY-INDEX.md
python3 scripts/harbor-research/check_library_index.py --check-md # + fail if it's stale
```

Exit status is 0 iff every requested check passes; each failure line names the entry,
the file, and (for coverage) the exact line, so a fix is usually a one-line edit to
`library-index.json` or the LaTeX comment header. `.github/workflows/library-checks.yml`
runs the first form and the `--check-md` form as two of its steps, alongside
`check_citations.py` and `check_propagated_corrections.py`.

Tests: `python3 -m unittest discover -s tests/harbor-research` (stdlib `unittest`
only; each test builds a small fixture repo in a tempdir and runs the real checker
against it via an internal `--repo-root` flag -- production usage never passes that
flag, and always checks this repository in place).

## What the checker deliberately does not do

- It does not re-derive whether a fold is *correct* -- only that the index's claims
  about it (labels exist, numbers match, headers are mutual) are internally
  consistent. A wrong `one_breath` or a `kind` that doesn't match the box's own
  terminology is a human review question, not something a regex can catch.
- It does not run LaTeX or check that a file compiles -- that is
  `harbor-research-build.yml`'s and `whitepaper-build.yml`'s job.
- It does not check citations (`\cite`/`\bibitem`) -- `check_citations.py` does that,
  independently, over the same three corpora.
- It does not re-verify a script's printed numbers -- re-running
  `skills/harbor-results/scripts/*.py` at the program's seed (20260816) is how a
  `[internal]`-tagged number is actually re-derived; this checker only confirms the
  digits the papers *claim* those scripts produce are the digits printed in every
  location that repeats them.
