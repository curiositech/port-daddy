# Textbook Craft

How the best math/CS textbooks build a chapter — Halmos, Axler, SICP, Knuth,
Feynman, Sipser, CLRS, Pierce, MacKay, Pólya, Lakatos, Hersh, Mason–Burton–
Stacey, Tufte, Gawande, Meadows — turned into a decision tree, a chapter
template, an exercise ladder, a page grammar, and a mechanical linter for the
Harbor Book's own chapters.

## Structure

```
textbook-craft/
├── SKILL.md                        # Decision tree, chapter template, page grammar,
│                                    #   pacing rules, honesty ledger, anti-patterns
├── CHANGELOG.md                    # Version history
├── README.md                       # This file
├── references/
│   ├── canon.md                    # What each named textbook does, worth stealing
│   ├── learning-science.md         # The cited studies behind every craft rule
│   ├── exercise-design.md          # Pólya's phases, kinds, ratings, fading, solution-key rules
│   ├── chapter-template.md         # The page-1/page-2 sequence and chapter-close order
│   └── sources.md                  # Tiered source list, incl. the corpus files cited by path
├── scripts/
│   └── chapter_lint.py             # Parses .tex chapter(s), reports structure vs. this skill's floors
├── tests/
│   └── test_chapter_lint.py        # Unit tests for chapter_lint.py's parsing and floors
└── examples/
    ├── chapter1-lint-report.txt    # A real run against whitepaper/single-writer-kernel.tex
    ├── consolidated-lint-report.txt # The one-table report across all eight Book chapters
    └── README.md
```

## Quick Start

1. Read `SKILL.md`'s decision tree to place the paragraph you're writing.
2. Drafting a chapter opener or closing sequence? Read
   `references/chapter-template.md`.
3. Placing or grading an exercise? Read `references/exercise-design.md`.
4. Auditing an existing chapter? Run:
   ```bash
   python3 skills/textbook-craft/scripts/chapter_lint.py path/to/chapter.tex
   ```
   Auditing every Book chapter at once? Run it with no path at all (it reads
   `whitepaper/textbook.json`'s chapter list) for one consolidated table:
   ```bash
   python3 skills/textbook-craft/scripts/chapter_lint.py --strict
   ```
5. Doubt a rule? Every one traces to `references/canon.md` or
   `references/learning-science.md`, each tiered per `references/sources.md`.

## Seed and provenance

Built from `docs/harbor-research/exposition/TEXTBOOK-CRAFT.md` (the research
memo), `READING-FLOW-AUDIT.md` (measured reading-flow findings on the Book's
own rendered pages), `HANDOFF-TEXTBOOK.md` (the settled design contracts),
`docs/harbor-research/exposition/memo-solution-key.md` (the exercise
solution-key's own two governing rules), `whitepaper/figures/pd-pedagogy.tex`
(the actual macro vocabulary), and `skills/harbor-exposition/SKILL.md` (the
seven-moves style this skill is downstream of, not a duplicate of) — extended
with targeted web/corpus research (Pólya, Lakatos, Hersh, Mason–Burton–
Stacey, Chi, Rohrer/Bjork, and the author's public corpus at
`github.com/curiositech/some_claude_skills`). Full citation tiers in
`references/sources.md`.
