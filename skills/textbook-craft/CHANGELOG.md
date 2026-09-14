# Textbook Craft — Changelog

## v1.2.0 (2026-09-14)

`worked_example_per_section` counted apparatus sections as body sections, and
so overstated its own backlog by 86% (117 sections reported against 63 real).

- **The floor is a body-section floor.** It asked every top-level `\section`
  for a worked example, including the "Exercises", "Review of the key ideas",
  "Limitations and boundaries", "Related work", "Reader's Map", "Formal
  Verification Status" and "Full ProVerif Models" sections — the sections
  SKILL.md §Pacing rules already exempts by name ("outside an Exercises
  section, which is expected to be prose-only"), and which this floor exists
  to be the source-level proxy for. Across the Book it flagged **117 of 138
  sections, 54 of them apparatus**. The honest figure is **63 of 84 body
  sections**: still a large backlog, but one that can be worked.
- **One list.** The vocabulary lives in `APPARATUS_SECTION_PATTERNS` and
  nowhere else; `CHAPTER_CLOSE_KEYWORDS` and `EXERCISES_SECTION_TITLE_RE` are
  now *derived by reference* from it (the same compiled `Pattern` objects),
  and `tests/test_chapter_lint.py` asserts that identity — plus a source scan
  that fails if an apparatus token is ever compiled twice.
- **A structural signal, not only a title regex.** A section whose own
  `\label` is in the `app:` namespace is apparatus whatever its title says.
  That is author-declared, and it catches what a title cannot: anchor-
  protocol's "Phase 2: Asymmetric Ed25519" is 57 lines of dumped ProVerif
  source.
- **`boundary_or_handoff` narrowed** from a bare `boundary` to `scope
  boundary|boundaries`. The bare token matched sealed-harbor.tex's "The gate
  sits on the only enforceable boundary" — a core body section, the fourth of
  ten. No chapter's `chapter_close_apparatus` verdict changes (each still
  matches through `limitations`, `threat model`, `open problems`, `what this
  chapter`, or `assumes and provides`); a test pins both halves.
- **The same blind spot in `chapter_opener_and_claim_labeling`**, fixed: six
  chapters open with a Reader's Map, so the floor was reading the first line
  of the map rather than of the argument (wrong section on five of eight
  chapters; it happened to read "prose" either way, so no verdict moves).
- **Every exemption is printed** in the report, with its kind and whether the
  title or the label earned it. A floor that quietly shrinks its own
  denominator is the failure this change exists to end, not to repeat.
- **New `--max-blocking N`**, and `library-checks.yml`'s step promoted from
  `continue-on-error: true` to `--max-blocking 17` — the honest count of
  blocking failures today. The count may fall, never rise.
- `TINTED_BOX_MACROS` listed `scene` twice, so legible-swarm.tex's single
  `\newcommand{\scene}` was counted and printed as two macros (5 reported,
  4 real). De-duplicated, with an assert against a repeat.
- Committed examples regenerated. 37 unit tests → 61.

## v1.1.0 (2026-09-08)

Six `chapter_lint.py` fixes from PR #10074 review bots (lead-accepted), plus
CI wiring and a consolidated report:

- Strip TeX comments (`(?<!\\)%.*$`, the idiom `scripts/harbor-research/
  check_plate_provenance.py` proved out) before every regex pass, in place,
  preserving newlines so line numbers stay correct for free.
- `claims_carry_epistemic_kind`: the tag must sit inside the claim's own
  brace-and-env-balanced body (new `balanced_env_body`), not a fixed
  ±200/400-character window that could borrow a neighboring claim's tag.
- `no_tinted_box_macros`: dead-or-live is settled by parsing
  `whitepaper/figures/pd-pedagogy.tex` itself (which macro names its
  `\AtBeginDocument` block actually re-`\long\def`'s), located by walking
  upward from the chapter's own path rather than a hard-coded absolute
  path — not by whether the chapter's own `\input` line is present.
- New floor `imports_pd_pedagogy_twin`: a chapter must `\input` the
  pedagogy twin outright, independent of whether any legacy macro happens
  to be neutralized.
- `exercises_at_chapter_end` tightened to the chapter's own closing
  `\section{Exercises}` specifically (not merely some section along the
  way that shares the word) and made advisory: the Book's chapters have
  not all been relocated to this rule yet.
- New floor `chapter_opener_and_claim_labeling` (advisory): the first
  `\section` must open with prose or an epigraph macro, not a cold table
  or claim, and every claim-like environment must be tagged.
- Multi-chapter consolidated report (`--table`, or simply more than one
  chapter path) and a default chapter list read from
  `whitepaper/textbook.json` when none is given, mirroring
  `skills/tufte-evidence-design/scripts/margin_lint.py`'s own convention.
- `.github/workflows/library-checks.yml` runs the skill's own unit tests
  and the chapter floors across all eight Book chapters (advisory /
  `continue-on-error` for now: two blocking floors already fail on several
  chapters, pre-dating this change).
- `skills/textbook-craft/tests/test_chapter_lint.py`: unit tests for every
  item above.
- `examples/consolidated-lint-report.txt`: the one-table report CI reads.
  `examples/chapter1-lint-report.txt` regenerated against the chapter's
  current (post-relocation) state.

## v1.0.0 (2026-09-07)

- Initial skill, built from `docs/harbor-research/exposition/TEXTBOOK-CRAFT.md`
  (seed research memo), `READING-FLOW-AUDIT.md`, `HANDOFF-TEXTBOOK.md`,
  `memo-solution-key.md`, `whitepaper/figures/pd-pedagogy.tex`, and
  `skills/harbor-exposition/SKILL.md`, extended with web research (Rudin,
  Mason–Burton–Stacey, Chi self-explanation, Rohrer/Bjork interleaving) and
  the author's public corpus (`github.com/curiositech/some_claude_skills`,
  `corpus/`: Pólya, Lakatos ×2, Hersh, Meadows, Gawande).
- `SKILL.md`: decision tree (which page element does a paragraph need), the
  chapter template summary, exercise ladder, worked-example discipline, page
  grammar table bound to `pd-pedagogy.tex`'s real macro vocabulary, pacing
  rules from the measured reading-flow findings, the four-kind honesty
  ledger, five anti-patterns, and NOT-for boundaries against
  `harbor-exposition`, `harbor-chartwork`, and `latex-whitepaper-engineering`.
- `references/canon.md`, `references/learning-science.md`,
  `references/exercise-design.md`, `references/chapter-template.md`,
  `references/sources.md`.
- `scripts/chapter_lint.py` (stdlib only): parses a `.tex` chapter and reports
  sections, worked examples per section, exercise-cluster placement, claim
  epistemic-kind tagging, interlude count, legacy tinted-box macro
  definitions (aware of `\input{figures/pd-pedagogy}` neutralizing them), and
  chapter-close apparatus, against this skill's floors. Tested against
  `whitepaper/single-writer-kernel.tex` (fails 5/6 floors — a pre-reform
  chapter, captured honestly in `examples/chapter1-lint-report.txt`) and
  spot-checked against a pd-pedagogy-adopted chapter to confirm it correctly
  passes the floors that chapter actually meets.
- `examples/chapter1-lint-report.txt` and `examples/README.md`.
