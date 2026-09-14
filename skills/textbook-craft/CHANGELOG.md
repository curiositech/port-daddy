# Textbook Craft — Changelog

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
