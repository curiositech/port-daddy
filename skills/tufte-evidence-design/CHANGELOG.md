# Tufte Evidence Design — Changelog

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
