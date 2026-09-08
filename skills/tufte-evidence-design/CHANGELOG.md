# Tufte Evidence Design — Changelog

## v1.1.0 (2026-09-07)

- `figures/pd-pedagogy.tex` (and its byte-identical website-v2 twin): added
  `\pdgloss{Term}{one-line definition}`, the margin gloss `references/margin-apparatus.md`
  had recorded as planned. It bolds the term at its point of definition in the
  running text and carries the definition as a margin note built from the
  same `\pd@marginhead` small-caps convention `\keyidea`/`\pitfall` use,
  folded into one `\marginnote` call so it cannot collide with an
  independent one at the same source line; outside the margin column it
  folds back into the sentence as a parenthetical. Compile-verified both
  ways with tectonic, standalone under a real chapter preamble and under the
  Book's own margin-column preamble via `compile_fragment.sh --preamble book`.
  `references/margin-apparatus.md` section 2 and its Net comparison table,
  and SKILL.md's checklist and anti-pattern section, updated to say it
  exists rather than that it's missing. No chapter calls it yet; that
  editorial pass is the author's.
- `scripts/margin_lint.py`: a mechanical checker over the Book's eight
  chapter sources (read by default from `whitepaper/textbook.json`) for the
  margin-apparatus rules that are actually mechanical: at most one
  `\pdmarginfigure` per section, every referenced slug's plate and sidecar
  present (reusing `scripts/harbor-research/check_marginalia_sidecars.py`'s <!-- phantom-ok -->
  path logic, a repo-root script outside this skill, and its field checks by import, not duplication), a term glossed at
  most once per chapter, and a gloss sitting inside real running prose
  rather than alone in its own paragraph. `\footnote` in a chapter body is
  reported but left advisory: every current instance is a substantive
  provenance note pointing at a companion paper, and this repository has no
  numbered-sidenote equivalent to rewrite it into, so converting one is an
  editorial call, not a mechanical fix. Running it over the eight chapters
  today finds zero enforced violations and nine advisory footnote findings.
  `scripts/harbor-research/check_marginalia_sidecars.py` <!-- phantom-ok -->
  (a repo-root script, not in this skill) gained a small `plates_dir()`
  helper so both checkers share one path definition.
- `skills/harbor-chartwork/scripts/figcheck.py`: each page's report now
  carries an advisory `ink` block (ink_fraction, edge_density,
  distinct_colors, flags) computed by rendering the page's already-measured
  content region to a pixmap and running it through this skill's
  `ink_audit.py`, imported rather than copied; the two headline numbers are
  added to the markdown report. It can never change figcheck's own pass/fail
  exit code, and every existing figcheck test still passes.
- `scripts/tufte.py`: one CLI entry point with four subcommands —
  `audit <png...>` (delegates to `ink_audit.py`, `--strict` to fail on any
  heuristic flag), `margin-lint <tex...>` (delegates to `margin_lint.py`),
  `checklist <kind>` (prints one checklist read live from SKILL.md, kinds
  never hardcoded), and `decision-tree` (prints SKILL.md's mermaid flowchart
  as text). Documented in SKILL.md's reference table and in README.md.
- SKILL.md's decision tree: four branches (the sparkline-bearing table, the
  single annotated chart, small multiples, and the Challenger-style causal
  redesign) each gained a one-line pointer into the exact
  `references/critiques-and-limits.md` section that records a known
  objection to that branch's rule (Accessibility, Stephen Few, Tamara
  Munzner, Alberto Cairo), so a reader following the tree meets the
  objection before applying the rule.
- `.github/workflows/library-checks.yml`: a new step, "Margin apparatus
  rules hold in every chapter," running `margin_lint.py` over the eight
  chapters; `skills/tufte-evidence-design/**` added to the workflow's path
  filters.
- `tests/harbor-research/test_margin_lint.py` and `test_tufte_cli.py`: fixture
  tests covering one pass and one violation per `margin_lint.py` rule and the
  CLI's exit codes, following the existing `test_check_marginalia_sidecars.py`
  pattern.

## v1.0.0 (2026-09-07)

- Initial skill creation, built from a research pass over Edward Tufte's four
  books (The Visual Display of Quantitative Information; Envisioning
  Information; Visual Explanations; Beautiful Evidence), his one-day course,
  and The Cognitive Style of PowerPoint.
- SKILL.md: evidence-form decision tree (table / sparkline / small multiples /
  annotated chart / margin figure / sentence), checklists for graphical
  integrity, data-ink/chartjunk, small multiples, sparklines, the margin
  apparatus, and words-numbers-images/sentences-over-bullets; four
  anti-patterns with novice/expert framing.
- `references/doctrines.md`: the eighteen doctrines with sourcing.
- `references/margin-apparatus.md`: tufte-latex's sidenote/margin/fullwidth
  implementation (fetched directly from GitHub) compared against this
  repository's actual state — `\pdmarginfigure` implemented,
  `\pdgloss` planned but not yet built (per
  `docs/harbor-research/exposition/HANDOFF-TEXTBOOK.md`) — plus concrete
  per-chapter marginalia placement notes drawn from
  `docs/harbor-research/exposition/MARGINALIA-PLACEMENT.md` and
  `READING-FLOW-AUDIT.md`.
- `references/web-application.md`: the same doctrines applied to
  `website-v2` docs pages.
- `references/critiques-and-limits.md`: Few, Cairo, Munzner, Wilke, Kosara,
  and the accessibility gap.
- `references/sources.md`: full citation list with `[verified]`/`[unverified]`
  marking per claim.
- `scripts/ink_audit.py`: heuristic ink-fraction/chartjunk-proxy audit for a
  PNG, using Pillow when available and a pure-stdlib PNG decoder otherwise;
  tested against both code paths on synthetic clean and cluttered images.
- `examples/`: two worked before/after redesigns (stat-card dashboard →
  sparkline table; chronological incident chart → causal scatter).
