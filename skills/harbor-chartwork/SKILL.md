---
name: harbor-chartwork
description: "Chartwork for the Harbor library: choosing the diagram kind that fits an idea and drawing it in TikZ to the house style, with mechanical figure QA. Use when drafting, redesigning, auditing or QA-ing any figure in the chapters or research papers. NOT for matplotlib/raster plots, web SVG components, slide decks, or prose exposition."
license: FSL-1.1-MIT
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
metadata:
  category: Writing
  tags: [latex, tikz, figure-qa, whitepaper, harbor-research]
  pairs-with: [tikz-figure-engineering, whitepaper-figure-system]
  provenance:
    kind: first-party
---

# Harbor Chartwork

Three TikZ figure corpora feed the Harbor library: `website-v2/public/whitepaper/figures/`
and `whitepaper/figures/` (the seven chapter whitepapers, `hh*`-palette house style), and
`docs/harbor-research/figures/` (the seven research papers, `harborblue`/`shipred`/`seagreen`
palette). Every fragment is a bare `.tex` file `\input` at point of use -- none carries its
own `\documentclass` (six orphaned `website-v2/figures/diag-*.tex` files excepted), so none
compiles or previews on its own without help.

This skill is the toolsmith's half of chartwork: deterministic scripts that compile a lone
fragment, lint its source, inspect its rendered geometry, and lay a batch out for review. It
does not decide what a figure should say, and it does not redesign one -- that is craft and
editorial judgment, kept in `references/craft-rules.md` and `references/taxonomy.md` (both
pending, see below) for the book's author to write.

## When to use

Use this skill whenever you are drafting a new figure, revising an existing one, or auditing
the corpus for compile/lint/geometry problems -- in any of the three directories above.

Do **not** use it for matplotlib/raster plots, web/SVG UI components, slide decks, or prose
exposition. For choosing a figure's *semantic form* in the whitepaper corpus specifically
(relation vs. plot vs. state machine vs. ...), see `whitepaper-figure-system` first; for TikZ
layout craft, typography, and render-review discipline once the form is chosen, see
`tikz-figure-engineering`. Both predate this skill and own real, non-overlapping ground --
see "Relationship to other skills" below.

## The QA loop: precheck -> compile -> figcheck -> contact sheet

```bash
# 1. Source lint, no TeX needed -- fast, run this first and on every edit.
python3 scripts/tikz_precheck.py path/to/fig-whatever.tex

# 2. Compile it standalone, wrapped in the real chapter/paper preamble.
scripts/compile_fragment.sh path/to/fig-whatever.tex --out /tmp/chartwork/fig-whatever

# 3. Geometry QA on the compiled PDF: minimum text size, overflow, overlap,
#    a line through text, off-page content, dead canvas, overwidth content.
python3 scripts/figcheck.py /tmp/chartwork/fig-whatever/fig-whatever.pdf

# 4. Reviewing several figures together: one contact sheet, captioned by file.
python3 scripts/contact_sheet.py /tmp/chartwork/*/*.pdf --out /tmp/chartwork/sheet.png
```

A fragment passes this skill's QA when steps 1-3 all pass (step 3's T6/T7 are warn-only).
None of these tools rewrites a fragment; they only report. `scripts/build_corpus_audit.py`
runs the whole loop over every fragment in all three corpora at once and regenerates
`references/corpus-audit.md` -- re-run it after any figure change to refresh that inventory.

## Scripts

| Script | What it does |
|---|---|
| `scripts/tikz_precheck.py FRAGMENT.tex...` | Source lint, no TeX: missing provenance comment, `\tiny`, an off-palette color, an unwrapped multi-word node, an internal result label (`R\d+`/`CR-\d`/`B6`) in a title; P10 `\tiny`, P11 `\scriptsize` in a fragment, P13 a bare low-alpha fill with no edge (errors); P12 `\resizebox` below 0.85 and P14 `\scriptsize` row labels (warnings). JSON/markdown via `--json`/`--md`. Exit 0 clean, 1 on a hard finding. |
| `scripts/compile_fragment.sh FRAGMENT.tex [--preamble chapter\|research] [--out DIR]` | Wraps the fragment in the real chapter/paper preamble (read from the real source at run time, not hand-copied) and compiles with tectonic. Writes `DIR/<stem>.pdf` + `.log`. Exit 0 clean; non-zero with the first TeX error on failure. |
| `scripts/figcheck.py PDF [--json OUT] [--md OUT] [--min-font-pt 7] [--textwidth-cm 16.3]` | Eight PyMuPDF geometry checks (T1-T8) on a compiled fragment PDF; T6/T7 are warn-only, T8 (drawing or text colliding with the caption) fails. Exit 0 clean, 1 on a T1-T5 or T8 failure. |
| `scripts/contact_sheet.py PDF... --out sheet.png [--cols 4] [--dpi 150]` | Renders page 0 of each PDF to a captioned thumbnail grid (Pillow). A missing/broken PDF becomes a labeled placeholder cell. |
| `scripts/build_corpus_audit.py [--out PATH] [--skip-compile]` | Runs the whole loop over all three corpora and (re)writes `references/corpus-audit.md`. `--skip-compile` runs precheck only, for a fast pass. |

## Relationship to other skills

`tikz-figure-engineering` owns TikZ source craft, typography, spacing, and its own
render-review loop (`render_tikz_figure.py`) for the whitepaper corpus specifically; its
renderer and this skill's `compile_fragment.sh`/`figcheck.py` both compile-and-inspect a
figure but answer different questions (page-fit/warnings vs. seven specific rendered-geometry
checks with a JSON/markdown contract) and neither replaces the other today. `whitepaper-figure-
system` owns semantic form (what a whitepaper figure should be) and its own atlas-coverage
checker; it does not reach the research corpus or run any of the checks here. This skill adds
what neither had: a script that actually compiles a bare fragment standalone (required before
either of the other two's renderers can run against a whitepaper fragment in isolation), a
source lint pass, and one inventory spanning all three corpora together.

## References

| File | Consult when |
|---|---|
| `references/corpus-audit.md` | You need the current compile/lint/geometry status of a specific fragment, or corpus-wide totals. Regenerate with `build_corpus_audit.py` after any figure change. |
| `references/taxonomy.md` | Authored by the book's author; pending. |
| `references/craft-rules.md` | Authored by the book's author; pending. |
| `references/research-notes.md` | Authored by the book's author; pending. |

## Validation

`tests/test_figcheck.py` and `tests/test_tikz_precheck.py` cover the two Python checkers
against fixture PDFs/fixture strings (see each script's own `--help` for CLI details):

```bash
python3 -m unittest discover -s skills/harbor-chartwork/tests -p 'test_*.py' -v
```
