# Tufte Evidence Design

Applies Edward Tufte's evidence-design doctrine — data-ink ratio, graphical
integrity and the Lie Factor, small multiples, sparklines, layering and
micro/macro readings, the fundamental principles of analytical design, and
sentences-over-bullets — to choosing and auditing how a piece of evidence
should be shown, in this repository's LaTeX Book and its documentation
website alike.

## Structure

```
tufte-evidence-design/
├── SKILL.md                          # Decision tree + checklists + anti-patterns
├── CHANGELOG.md
├── README.md                         # This file
├── references/
│   ├── doctrines.md                  # The principles, with sourcing, from all four books
│   ├── margin-apparatus.md           # tufte-latex vs. this repo's pdmarginfigure/pdgloss state
│   ├── web-application.md            # Applying the doctrines to website-v2
│   ├── critiques-and-limits.md       # Few, Cairo, Munzner, Wilke, Kosara, accessibility
│   └── sources.md                    # Citation + verification status for every claim
├── scripts/
│   ├── ink_audit.py                  # Heuristic ink-fraction / chartjunk-proxy audit for a PNG
│   ├── margin_lint.py                # Mechanical checks on a Book chapter's margin apparatus
│   └── tufte.py                      # One CLI: audit / margin-lint / checklist / decision-tree
└── examples/
    ├── dashboard-to-sparkline-table.md
    └── challenger-style-redesign.md
```

## Quick Start

1. Read SKILL.md's decision tree to pick the evidence form (table, sparkline,
   small multiples, annotated chart, margin figure, or a plain sentence), or
   run `python3 scripts/tufte.py decision-tree` to print it.
2. Run the matching checklist in SKILL.md before shipping a chart, table, or
   Book chapter's margin apparatus, or print one directly:
   `python3 scripts/tufte.py checklist sparklines`.
3. For a rendered PNG figure, get a second opinion:
   `python3 scripts/tufte.py audit path/to/figure.png` (add `--strict` to
   fail the command on any heuristic flag).
4. When in doubt about whether to deviate from a Tufte rule, read
   `references/critiques-and-limits.md` before overriding the checklist.
5. Adding marginalia or a `\pdgloss` to a Book chapter? Read
   `references/margin-apparatus.md` first, then check the chapter with
   `python3 scripts/tufte.py margin-lint path/to/chapter.tex` (or with no
   arguments, to check all eight Book chapters at once).

## Validation

```
python3 /root/.claude/skills/skill-architect/scripts/validate_skill.py skills/tufte-evidence-design
python3 /root/.claude/skills/skill-architect/scripts/check_self_contained.py skills/tufte-evidence-design
python3 skills/tufte-evidence-design/scripts/margin_lint.py
python3 -m unittest discover -s tests/harbor-research -p 'test_margin_lint.py'
python3 -m unittest discover -s tests/harbor-research -p 'test_tufte_cli.py'
```
