# Harbor Chartwork — Changelog

## Unreleased

- `references/craft-rules.md` gains §7, "Claims, notation and convention": the eight
  rules drawn out of one review of `fig:anchor-handshake-ladder` — caption–drawing
  integrity, caption vocabulary, one notation per entity, show data variation not design
  variation, use the convention before inventing, encode the boundary don't annotate it,
  caption states the claim, termination padding, and edition type. The old §7
  (sources) becomes §8.
- `scripts/tikz_precheck.py` gains P15 (a caption promising `dotted`/`dashed`/`shaded`/
  `bold`/`greyed`/`hatched` with no directive that could draw it), P16 (one identifier
  spelled two ways in a fragment) and P17 (a caption naming an identifier no label
  carries; warning). Each has a passing and a failing fixture in
  `tests/test_tikz_precheck_new_rules.py`. All three run clean over all ~100 fragments
  in the three corpora.
- Not mechanized, and marked as human rules in craft-rules.md: register mixing
  (`$card_0$` vs `\texttt{card\_0}`), figure-versus-chapter notation disagreement, and
  "drawn but too faint to read". A node/lifeline overlap check was not added to the
  source linter either — figcheck's T4 already answers that soundly on the compiled PDF.

## v1.0.0 (2026-09-06)

- Initial skill: deterministic figure-QA tooling for the three Harbor TikZ
  corpora (website-v2/public/whitepaper/figures, whitepaper/figures,
  docs/harbor-research/figures).
- `scripts/compile_fragment.sh`: wraps and compiles one bare fragment
  standalone, reusing the real chapter/paper preamble verbatim.
- `scripts/tikz_precheck.py`: source-level lint (provenance comment, `\tiny`,
  off-palette colors, unwrapped multi-word nodes, internal result labels in
  titles; `\resizebox` warns only).
- `scripts/figcheck.py`: seven PyMuPDF rendered-geometry checks (T1-T7) on a
  compiled fragment PDF.
- `scripts/contact_sheet.py`: batch review grid with filename captions.
- `scripts/build_corpus_audit.py`: regenerates `references/corpus-audit.md`,
  the deterministic inventory across all three corpora.
- `references/taxonomy.md`, `references/craft-rules.md`,
  `references/research-notes.md`: placeholder stubs, pending the book's
  author.
