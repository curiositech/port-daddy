# Harbor Chartwork — Changelog

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
