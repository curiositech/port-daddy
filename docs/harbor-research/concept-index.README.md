# The Book's concept index

`docs/harbor-research/concept-index.json` answers one question the library
index does not: **where does each idea live, and what is the Book pretending
it is?**

Two indices, two questions, one join:

| | question | source of record | checker |
| --- | --- | --- | --- |
| `library-index.json` | where does each **result** live? (R1–R17, CR, B6) | hand-written, checked against the corpora | `check_library_index.py` |
| `concept-index.json` | where does each **concept** live, and what metaphor is it wearing? | **generated** from the chapter sources | `build_concept_index.py --check` |

They join on `\label`. Every concept entry carries `library_index_ids`,
**derived** on each build by intersecting the labels the concept sits under
with the labels each library-index entry claims. It is never typed. That is
deliberate: this repo's recurring defect is two lists that must agree with
nothing deriving either from the other, and a hand-typed cross-reference here
would have been a third one. 45 of the 284 concepts join today.

Companion files:

- `concept-index.lexicon.json` — the **only hand-edited input**. Metaphor
  vehicles and their domains, literal-use exceptions, the cash-out marker
  list, concept stopwords, aliases, forced inclusions.
- `concept-index.schema.json` — JSON Schema (draft-07) with a doc-comment on
  every field.
- `CONCEPT-INDEX.md` — a generated, human-readable render. Never hand-edit it.
- `scripts/harbor-research/build_concept_index.py` — generator and checker.

## Running it

```bash
python3 scripts/harbor-research/build_concept_index.py            # coverage report
python3 scripts/harbor-research/build_concept_index.py --write    # regenerate both outputs
python3 scripts/harbor-research/build_concept_index.py --check    # fail if either is stale
python3 scripts/harbor-research/build_concept_index.py --query organ
```

A build takes about 16 seconds and touches no network, no TeX and no PDF.
`.github/workflows/library-checks.yml` runs `--check`, **advisory** for now
(`continue-on-error: true`), the same way the chapter-template and
figure-blocker steps were introduced.

## The rule that decides what a concept is

> A concept is a term that is **MARKED** *and* **REPEATED**.

- **MARKED** — the Book asserts it is a term: it is the title of a
  `definition` / `pdclaim{Definition}` environment, is `\emph`/`\textbf`'d
  *inside* one, is a `\pdgloss` term, is a theorem-family environment's
  title, is a section title, or is a float caption's head. Those are
  *structural* marks and any one of them is enough.
  A bare `\emph`/`\textbf` in running prose is **not** enough on its own,
  because this Book uses both for stress as well as for terms of art: it
  needs two of them, and a single word in `-ed`/`-ing`/`-ly` shape is
  rejected outright.
- **REPEATED** — at least `min_mentions` (3) mentions in comment-stripped
  prose across the Book.

Every rejection is written to `dropped_candidates[]` with its reason, so the
misses are countable. They currently number 2 407 — 2 170 unmarked, 237 below
the mention floor.

## Parsed vs judged

Two fields apply a heuristic and say so in the data:

- `definition.judged` — `false` means the term is emphasised inside a
  definition environment (parsed). `true` means it is emphasised in a
  sentence carrying a definitional cue (*is the*, *we call*, *denotes*).
- `metaphor_passages[].cash_out.judged` — always `true`. Whether a metaphor
  is ever redeemed for a literal statement is decided by a marker count and
  a sentence-length floor, not by understanding.

Nothing else is judged. `mentions`, `floats`, `references`, `exercise_use`,
`first_use` and the vehicle lists are regexes over the source.

## How to add or correct an entry

**You never edit `concept-index.json`.** It is regenerated and diffed. There
are exactly four places a correction can go, and which one depends on what is
wrong.

### 1. The Book is wrong → fix the chapter

A concept with no definition, or whose first use is buried in a table, is the
index reporting a real gap. Fix it in the `.tex`:

```latex
% before: the term is used, never introduced
the substrate organ is the floor
% after: introduced where a reader first meets it
the \textbf{substrate organ} --- the one table every other organ is
discipline over --- is where writes are actually serialised
```

Then `--write` and commit the regenerated pair with the chapter edit. The
index moves because the Book moved; that is the system working.

### 2. The term is real but the harvest missed it → `concept_force_include`

For a concept the Book relies on but never marks (it is never emphasised,
never a heading, never defined in an environment):

```jsonc
"concept_force_include": { "terms": ["conflict domain"] }
```

A forced term is indexed if it occurs at all, bypassing both halves of the
rule. Check first that it is not already in `dropped_candidates[]` under a
reason you would rather fix at the source — `--query <term>` prints the drop
reason when there is no entry.

### 3. The term is not a concept → `concept_stopwords.phrases`

Add the phrase, or the function word it ends in. Keep the list sorted. Do
**not** loosen `plausible_concept()` in the script to get the same effect:
the rule is meant to be one paragraph long and readable in the README.

### 4. The metaphor reading is wrong → three lexicon knobs

- **A vehicle is missing.** Add it under its domain in `metaphor_vehicles`.
  Matching is whole-phrase, case-insensitive, plural-tolerant. An unlisted
  vehicle is *silently absent*, which is why the table is a committed file
  and not a constant in the script.
- **A vehicle is being read figuratively when it is literal.** Add a marker
  to `vehicle_literal_exceptions` — a case-sensitive substring that, present
  in the same paragraph, means the word is being used literally (a product
  name, a cited title, a real physical thing). Suppressions are recorded in
  each entry's `metaphor.suppressed[]` rather than dropped, so an over-broad
  exception shows up in the next diff.
- **A cash-out is scoring when it explains nothing (or vice versa).** Tune
  `cash_out_markers`: `markers` (mechanism nouns), `min_markers` (2) and
  `min_sentence_chars` (40). Both floors are hand-tuned against a known
  failure: at `min_markers: 1` with no length floor, *"It is not a
  database."* scored as a cash-out, which is a negation, not a redemption.

After any lexicon edit: `--write`, then `--check`, then commit the lexicon
and both regenerated outputs **in one commit**. A lexicon change without its
regenerated outputs fails CI, which is the point.

## Reading an entry

```
  mentions              every use site, grouped by file: {chapter, file, lines[]}
  first_use             earliest anywhere, AND earliest in prose
  first_use.pdgloss_anchor   file:line where \pdgloss{Term}{...} belongs
  definition            where it is actually defined, with judged=parsed|heuristic
  explanation           paragraphs that explain rather than use
  open_problems         where the Book says this is unresolved (OP-N, op: labels, cues)
  floats                figures/plots/tables by label; captions live in the top-level table
  references            the \pdcite keys attached to it
  exercise_use          which exercises exercise it, and whether the solution names it
  library_index_ids     derived join to library-index.json
  metaphor              vehicle, domain, occurrences, and passage ids
```

`sections`, `floats` and `metaphor_passages` at the top level are **fact
tables**. A passage's vehicles and cash-out verdict are properties of the
passage, recorded once; entries point at them by id. Restating them per
concept is what made the first build 33 MB, and would have been one more
pair of lists that must agree.

## The specimen this exists for

`--query organ`, then read `s:single-writer-kernel:435-479`:

§1.3 "The kernel as seven organs" runs **anatomy** (*organ*, *tissue*,
*connective tissue*), **medicine** (*symptom*), **architecture** (*the
substrate organ is the floor*) and **moral** (*tables with discipline*,
*the temptation*) — four source domains in one section. `cash_out.in_prose`
is `false`. `cash_out.only_in_float_caption` is `true`: the one sentence
that says what the seven organs literally are — *"All seven are disciplines
over one SQLite/WAL file: one commit history, not seven stores"* — is in the
caption of `tab:swk-seven-organs`, not in the prose. And even that sentence
carries `still_figurative: ["discipline"]`.

If an entry ever stops making a collision like that obvious, the schema is
wrong and the schema is what to change.

## What this index deliberately does not do

- It does not resolve anaphora. *It*, *the former*, *that discipline* are not
  counted, so every `mention_count` is a floor, not a total.
- It does not decide whether a metaphor is *good*. It reports which domains
  meet, where, and whether anything literal sits nearby. Mixing is sometimes
  right; the index exists so the choice is visible, not so it is forbidden.
- It does not check that a `\pdcite` key resolves — `check_citations.py` does
  that, over the same corpora.
- It does not check that a `\label` is unique or that a result lives in two
  places — `check_library_index.py` and `check_duplicate_theorems.py` do.
- It does not run LaTeX. `whitepaper-build.yml` does.

## Keeping it current

Two mechanisms, and the recommendation is **both, in this order**:

1. **The staleness check is the load-bearing one.** `--check` rebuilds from
   the sources and fails if the committed copy differs. Regenerate-and-diff,
   never hand-edit. It cannot drift, because there is nothing to drift *from*
   — the sources are the only input. Wired into `library-checks.yml`,
   advisory at first.
2. **A cheap-model refresh path exists but is second.** Everything a small
   model can usefully do here is *lexicon* work: reading
   `dropped_candidates[]` and proposing `concept_force_include` or
   `concept_stopwords` additions, or proposing new `metaphor_vehicles` rows
   from the prose. That is judgement on a small, reviewable, sorted JSON
   file — and every proposal is validated by re-running the generator. A
   model should never be asked to write `concept-index.json` itself; the
   generator does that in 16 seconds, deterministically, and a model's copy
   would be exactly the second list this index was designed not to become.

Suggested prompt for (2):

> Read `docs/harbor-research/concept-index.json`'s `dropped_candidates[]`.
> For each id dropped with reason "marked once, by emphasis only", decide
> whether the Book relies on it as a term of art. Propose additions to
> `concept_force_include.terms` or `concept_stopwords.phrases` in
> `concept-index.lexicon.json`. Change nothing else. Then run
> `python3 scripts/harbor-research/build_concept_index.py --write` and
> `--check`, and show the coverage delta.

## Tests

`python3 -m unittest discover -s tests/harbor-research -p 'test_*.py'`.
`tests/harbor-research/test_build_concept_index.py` builds a small fixture
repo in a tempdir and runs the real generator against it via the internal
`--repo-root` flag — the same convention as
`test_check_library_index.py`. Production usage never passes that flag and
always reads this repository in place.
