# Textbook Craft — Changelog

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
