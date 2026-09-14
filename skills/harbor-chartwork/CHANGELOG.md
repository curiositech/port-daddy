# Harbor Chartwork — Changelog

## Unreleased

### figcheck

- **T9, dash resolution.** A dashed stroke whose on-length or gap is under two device
  pixels, or whose stroke is under one, at `--dash-dpi` (default 150 — a 1.0× screen
  read). This is the check for a defect no source linter can see: `pd guide` shipped
  `on 0.448pt off 0.996pt` on a 0.498pt stroke while the source said `densely dotted` and
  the caption said "dotted" and both were true. Measured in the committed Book PDF, the
  dash declared 69 % of each line as gap and only 34 % of its pixels reached paper, with
  35.4 % of three-period windows containing no paper at all — a third of every guide's
  length had gone solid. T9 reads the dash array off the content stream, so "smaller than
  a pixel" is arithmetic; it does not claim to know whether the result *reads* as dotted.
  **In the CI gate's failing set** from this change.
- **T10, typeface consistency.** More than one text family inside the drawing (caption,
  identifier face and math excluded). Every other check here measures geometry, and none
  looked at the thing a reader notices first: the Book's stack map passes T1–T9 **clean**
  while setting two of its labels in TeXGyrePagellaX and the rest in TeXGyreHeros. T10
  asserts *one* family, not *which* — an edition setting figures in grotesk against a
  Palatino page is deliberate. It counts only spans carrying two consecutive letters,
  which took it from 46 false failures out of 66 fragments to twelve, of which five were
  real. **Not** in the gate's failing set: it cannot yet separate `\mathrm{ok}` from a
  node that reset its own family, and the condition for promoting it is written into
  `check_figure_gate_results.py`.
- `CHECK_LABELS` is asserted against `ALL_CHECKS` at import, so a check added without a
  label fails loudly instead of raising a `KeyError` in the report writer after the JSON
  has already been written.
- T1 findings now name which band they applied. T1 has two floors — 7.0 pt for running
  text, 5.9 pt for a span of three glyphs or fewer — and the second is a decision about
  what T1 measures, not a loophole: a subscript is set at roughly 70 % of its base by
  every typesetter that has ever existed. Measured here: 5.98 pt in a chapter, 6.36 pt in
  the Book. Both pass. `\pdfigmath` is therefore *not* a way to pass T1; it exists
  because 5.98 pt clears 5.9 pt by 0.08 pt.

### tikz_precheck

- **P23, dotted.** The `dotted` / `densely dotted` / `loosely dotted` family takes its
  on-length from `\pgflinewidth`, read when the key is processed, so a `line width=` set
  afterwards moves the stroke and leaves the dash. Banned. The one law rule that also
  applies to the style-definition files, because that is where the defect was.
- **P24, body-font.** A family-selection command in a node's *text* — `\normalfont`,
  `\rmfamily`, `\sffamily`, `\ttfamily`. P21 watches `font=`; this watches the door that
  was actually open. Three fragments used `\normalfont` to get an unemphasised second
  line inside a bold `pd row label`, and `\normalfont` resets to the *document's* family.
  `\mathrm`/`\text` are not flagged: those are math.
- **P25, font-handle.** The general form of P19 and P21, and a **whitelist**: a fragment's
  `font=` may be built only from the house handles. `pd figure` carries the edition's face
  through the *picture-level* `font=` key, and a node's own `font=` is the same key, so it
  replaces that value wholesale. Measured in the Book: `font=\bfseries` renders
  TeXGyrePagellaX-Bold and `font=\itshape` renders TeXGyrePagellaX-Italic inside drawings
  set in TeXGyreHeros. Neither names a family or a size, so no blacklist could have caught
  them. Small caps goes in the node's text as `\textsc{}`, or takes `pd kind tag`.
- **Rule numbering reconciled.** This skill's typographic-law rules were P15–P17; thirty
  three minutes after they landed, `claude/figures-that-were-missing` independently
  published a different P15, P16 and P17. They are now **P18–P25** here, and P15–P17 are
  recorded in `RESERVED_RULE_IDS` as belonging to that branch. This side yielded the
  numbers because renumbering here is something this branch can *do*.
  `TestRuleIdRegistry` asserts the implemented and reserved sets are disjoint, gapless,
  and that every implemented id is documented, so the next claim has to be written down.
- `is_apparatus()` replaces the five-name style-definition list with the `pd-` **prefix**
  this repository already uses for "loaded by the preamble, not `\input` as a picture". A
  name list is defeated by the next name, and `pd-pedagogy.tex` is how this one was.

### compile_fragment.sh

- **Exit 3 for "nothing to draw"**, distinct from 1 for "would not compile". A style or
  apparatus file under `figures/` produces no pages and no `.xdv`; read as a compile
  failure, that reddened `figure-gates` for two files that had simply drawn nothing. The
  test is by shape — LaTeX emits a `!` line for every real error and none when it had
  nothing to typeset — not by a list of today's filenames.

### CI

- The skill's own suite now **runs** (`library-checks.yml`, beside its siblings, with a
  171-test floor). It was red for six days because nothing ran it; a suite that checks the
  checkers and is not itself checked is the same defect one layer up.
  `claude/figcheck-suite-repair` adds the same step with a floor of 86 — if it lands
  first that is a one-number conflict, and the higher number is the right one.

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
