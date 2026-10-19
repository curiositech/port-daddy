# Checker contracts

## Chapter and reader checkers

- `python3 scripts/chapter_lint.py [CHAPTER.tex ...] [--json|--md] [--strict|--max-blocking N] [--table] [--apparatus FILE]` —
  a DO-CONFIRM checklist (Gawande, `references/canon.md`) that strips TeX
  comments (an unescaped `%`, the same idiom `check_plate_provenance.py` uses
  in the harbor-research scripts, not yet merged to main <!-- cite-exempt -->)
  before every regex pass, then reports, against this
  skill's floors:
  - **`worked_example_per_section`** — every body section has >=1 worked
    example (`pdexample`/`example`). Counts use each section span, so duplicate
    headings cannot borrow examples. This measures presence, not whether the
    example precedes the general statement. Only explicit `--apparatus FILE`
    declarations exclude sections; undeclared sections remain body. An empty
    body fails rather than passing vacuously.
  - **`claims_carry_epistemic_kind`** — every claim-like environment
    (theorem/lemma/definition/property/corollary, or `pdclaim{KIND}{...}`)
    carries an epistemic-kind tag *inside its own body* (a brace-and-env
    -balanced extent, not a fixed character window that can borrow a
    neighboring claim's tag).
  - **`no_tinted_box_macros`** — a legacy `\newcommand` that draws a
    `fill=` node is dead only if `whitepaper/figures/pd-pedagogy.tex`'s own
    `\AtBeginDocument` block actually re-`\long\def`'s that exact macro
    name (parsed from the file itself, not inferred from whether the
    chapter happens to `\input` it — see SKILL.md's Page grammar section).
  - **`imports_pd_pedagogy_twin`** — the chapter `\input{s}`
    `figures/pd-pedagogy` at all, independent of whether any legacy macro
    happens to be neutralized: without it the chapter gets no shared page
    grammar (claim boxes, boundaries, worked examples, exercises).
  - **`exercises_at_chapter_end`** (advisory) — every `pdexercise` cluster
    sits inside the chapter's own closing `\section{Exercises}`, not
    scattered mid-body. Which section *is* that one is decided by exact
    title first (the normalized title IS "Exercises"), then by which
    candidate actually contains `\pdexercisesfor`/`\pdexercise` clusters,
    then by position; the report names the section it judged against. A
    plain substring rule picked `spawn-to-person.tex`'s later
    "Open problems (the starred exercises, collected)" and reported all 50
    correctly-placed clusters as misplaced. Advisory because the Book's
    chapters have not all been relocated to this rule yet.
  - **`chapter_opener_and_claim_labeling`** (advisory) — the chapter's
    first body `\section` opens with prose or an epigraph macro rather than a
    cold table or claim, and every claim-like environment is tagged.
    Advisory because no chapter in the corpus yet opens with an epigraph.
  - **`at_most_one_labelled_interlude`** — sections/subsections *titled*
    "Interlude". Two or more fails and blocks; one or none reports `REVIEW`,
    not `PASS`, since the unlabelled kind is outside what any script can
    see (§Philosopher Detours). A citation-footprint count rides along
    explicitly marked as a hint and never sets the verdict.
  - **`chapter_close_apparatus`** — Review/History/boundary sections present
    by title keyword.

  Four statuses: `PASS` (met, and the floor can see the whole rule it
  states), `REVIEW` (everything measurable came back clean, but the rule is
  only partly mechanically visible — a human still has to read; never
  blocks), `WARN` (an advisory floor unmet), `FAIL` (a blocking floor
  unmet). Report-only by default (exit 0); `--strict` exits 1 if any
  **blocking** (non-advisory) floor is violated — an advisory floor left
  unmet is reported (status `WARN`) but never trips `--strict`. Given more than one
  chapter, or `--table`, the report becomes one consolidated table (chapter,
  floor, status, detail) instead of N separate reports; given no chapter at
  all, the chapter list is read from `whitepaper/textbook.json` (the same
  convention `skills/tufte-evidence-design/scripts/margin_lint.py` uses), so
  neither this script's CLI nor its CI step hard-codes the Book's chapter
  paths. Tested on `whitepaper/single-writer-kernel.tex` (see
  `examples/chapter1-lint-report.txt`) and, consolidated across all eight
  Book chapters, in `examples/consolidated-lint-report.txt` — the same
  report `library-checks.yml`'s CI step reads using
  `--apparatus whitepaper/chapter-apparatus.json --max-blocking 15`. The
  ceiling is the current measured debt, not a clean chapter verdict, and
  the step is required. Invalid metadata fails independently of the budget. Unit tests:
  `tests/test_chapter_lint.py` and `tests/test_apparatus_metrics.py`
  (`python3 -m unittest discover -s
  skills/textbook-craft/tests -p 'test_*.py'`).

### Explicit apparatus declarations

Read `references/chapter-lint-apparatus.md` before editing the versioned
`--apparatus` sidecar or changing the CI blocking ceiling. Section roles are
author-declared, and the ceiling measures known debt rather than approval.

- `python3 scripts/readers_eye.py [CHAPTER.tex ...] [--json|--summary] [--rule RULE] [--limit N] [--strict] [--selftest]` —
  the mechanical half of the reader's-eye check. Where `chapter_lint.py`
  measures **structure** (is the worked example present, is the claim
  tagged, is the exercise at the end), this asks whether a reader could
  follow the sentence at all. It counts and matches; it does not judge
  prose. Six rules, each countable without a taste judgement:
  `abstraction-run`, `artifact-register-drift`, `caption-carries-the-fact`,
  `metaphor-domain-collision`, `metaphor-never-instantiated`,
  `undefined-slash-pair`. Given no chapter it reads the chapter list from
  `whitepaper/textbook.json`, the same convention `chapter_lint.py` uses.
  Exit 0 when nothing is reported, 1 under `--strict` when something is,
  2 when a file cannot be read; `--selftest` runs the clean-vs-bad fixture
  pair and reports whether they separate. Stdlib only. Advisory in CI on
  day one, on the same reasoning that made the figure-blocker step
  advisory: a check nobody has cleaned up after yet must not freeze the
  merge queue. Its word lists live in
  `references/readers-eye-lexicon.json`, not in the script. The judge pass it
  hands off to is `references/readers-eye.md` §5, which also carries the
  reader's persona, the finding shape, and the corpus baseline the
  thresholds were tuned against. Unit tests:
  `tests/harbor-research/test_readers_eye.py`.
