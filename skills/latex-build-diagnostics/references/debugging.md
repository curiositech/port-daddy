# Compile Debugging & Toolchain Reference

## Log Anatomy

The `.log` is verbose because it interleaves file-opens `(...)`, font loads, and warnings.
Navigation strategy:

1. Search for `!` — hard errors. **Fix the first one only**, then recompile; later errors
   are usually cascade.
2. The `l.<number>` line under an error is where TeX *noticed*, not necessarily where the
   mistake *is* (runaway arguments are often lines earlier).
3. Compile with `-file-line-error` to get `./chapter2.tex:41:` prefixes — essential in
   multi-file projects.
4. `-interaction=nonstopmode -halt-on-error` for scripted builds: no interactive prompt,
   stop at first error.
5. After errors are gone, sweep warnings: search `LaTeX Warning:` and `Overfull`.

## Error Catalog (beyond the SKILL.md triage table)

| Error | Diagnosis |
|---|---|
| `! Emergency stop` / `File ended while scanning use of ...` | unbalanced environment or `{` at EOF — check the environment named in the message |
| `! TeX capacity exceeded [main memory]` | infinite macro recursion (self-referencing `\newcommand`), or genuinely huge tikz/pgfplots — for the latter, `lualatex` (dynamic memory) |
| `! Undefined control sequence \babel@...` etc. deep in a package | stale `.aux`/`.toc` from a previous package set — `latexmk -C` and rebuild |
| `! I can't write on file 'main.pdf'` | PDF open in a viewer that locks it (Windows/Preview quirks) or missing `-outdir` |
| `! Illegal unit of measure (pt inserted)` | a length was expected, got text — often a missing argument to `\includegraphics[width=]` or bad `\setlength` |
| `! Not in outer par mode` | float (`figure`/`table`) inside a box/minipage/footnote — use `[H]` via `float` pkg there, or restructure |
| `! Float(s) lost` | float declared inside a box that was never output |
| `! LaTeX Error: Too many unprocessed floats` | >18 floats queued and page never flushed — add `\clearpage` or loosen float params |
| `! You can't use \hskip in vertical mode` | stray spacing macro between paragraphs, often from a broken macro definition |
| `! Package inputenc Error: Unicode character X not set up` | pdfLaTeX + a glyph with no mapping — add the right font/pkg or switch to LuaLaTeX |
| Blank/garbled PDF, no errors | shell PDF viewer cache — but first check log for `no output PDF` and for zero-page `Fatal error occurred` |

## Warnings That Matter

| Warning | Action |
|---|---|
| `LaTeX Warning: Reference 'x' on page N undefined` | typo'd `\label`/`\ref` pair, or label inside an environment that never executed |
| `LaTeX Warning: There were multiply-defined labels` | duplicate `\label{}` — commonly from copy-pasted figures |
| `Overfull \hbox (Xpt too wide)` | X > ~5pt is visible in print. Fixes in order: rewrite the sentence, add hyphenation hints (`hy\-phen\-ate`), `\sloppy` locally, microtype usually prevents most |
| `Underfull \hbox (badness 10000)` | almost always a `\\` used to end a paragraph, or `\linebreak` abuse |
| `Font shape ... undefined` | requested a shape the font lacks (e.g., small-caps bold) — LaTeX substitutes; change font or accept |
| `pdfTeX warning: destination with the same identifier` | duplicate labels reaching hyperref — fix the multiply-defined labels |

## Package Conflicts

Recipes for the recurring ones:

- **hyperref**: load after almost everything (notable exceptions: `cleveref`, `bookmark`,
  and `geometry`'s fine either way). Symptoms of wrong order: broken links, `\autoref`
  naming errors, `Option clash`.
- **Option clash for package X**: something loaded X earlier with different options
  (often the class itself). Fix: `\PassOptionsToPackage{opts}{X}` *before*
  `\documentclass`, or drop your options if the class's are fine.
- **caption/subcaption vs float classes**: load `caption` before `hyperref`; use
  `subcaption`, never the ancient `subfigure`/`subfig` (broken with hyperref).
- **enumitem vs beamer**: beamer has its own list internals; don't load enumitem in slides.
- **Command already defined**: two packages exporting the same macro — load order decides,
  or `\let\oldcmd\cmd` dance, or (better) drop one package.

## TeX Live Maintenance

```bash
tlmgr search --global --file missing.sty   # which package owns a .sty
sudo tlmgr install <pkg>
sudo tlmgr update --self --all             # biber/biblatex mismatches need this
```

- macOS: full MacTeX ships everything (~5GB); BasicTeX needs frequent `tlmgr install`.
- **Cross-year upgrades** (TeX Live 2024→2025) reset installed packages — a document that
  "suddenly" fails after an OS/TeX upgrade usually just lost packages: reinstall, and
  update biber+biblatex together.
- Overleaf pins a TeX Live image per project (project settings) — "works on Overleaf,
  fails locally" is almost always a version skew or a missing local package.

## Minimization (the universal technique)

For any error you can't place:

1. Copy the document; delete half the body (or move `\end{document}` up). Error persists?
   Problem is in the remaining half. Recurse. Three or four bisections isolate a line.
2. For preamble suspects: comment out half the `\usepackage` lines; recurse.
3. The endpoint is an MWE (minimal working example) — usually the fix becomes obvious;
   if not, it's now postable to tex.stackexchange.
