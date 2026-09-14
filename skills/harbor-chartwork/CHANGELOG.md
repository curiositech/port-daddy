# Harbor Chartwork — Changelog

## v1.0.1 (2026-09-14)

- `scripts/figcheck.py`: `run_figcheck` accepts a `str` again, not only a
  `Path`. It always had, since `pymupdf.open` takes either; 65fabd93f added
  `pdf_path.stem` to the report and narrowed the parameter as a side effect of
  a reporting change. Coerced once at the top of the function, which is a no-op
  for both production callers (they already hold a `Path`), and the function
  finally has a docstring saying what it takes and returns.
- `scripts/figcheck.py`: `--md` works again. The same commit renamed the report
  key `"pdf"` to `"figure"` and left `render_markdown` reading the old name, so
  the documented flag raised `KeyError` on every invocation for six days.
  Neither production caller passes `--md`, and `main`'s except-guard does not
  cover the render call, so nothing surfaced it. The committed reports were
  already migrated; only the reader was left behind.
- `tests/test_figcheck.py`: seven tests over those two holes — argument-type
  tolerance and report/renderer key parity — plus `unittest.main()` moved from
  the middle of the file to the end, where it no longer hides the three tests
  defined below it from anyone running the file directly.
- CI: the suite now runs. `library-checks.yml` discovers
  `skills/harbor-chartwork/tests` beside its four sibling suites, with a
  test-count floor so a module that stops contributing cannot report `OK`.
  Nothing ran these 86 tests before, which is why the 19 errors above lasted
  six days behind a green merge gate.
- No change to `check_t1`-`check_t8` or their helpers. The gate measures
  exactly what it measured before; it is now observed doing so.

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
