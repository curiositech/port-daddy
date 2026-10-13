# Bibliography Reference

## biblatex + biber (default for new documents)

```latex
\usepackage[backend=biber, style=numeric-comp, sorting=nyt, maxbibnames=6]{biblatex}
\addbibresource{refs.bib}     % note: full filename WITH .bib, unlike \bibliography
...
\printbibliography[heading=bibintoc]   % adds Bibliography to the ToC
```

Style cheat sheet:

| `style=` | Output |
|---|---|
| `numeric-comp` | [3, 7–9] — compressed numeric, STEM default |
| `authoryear` | (Knuth 1984) — social/physical sciences |
| `alphabetic` | [Knu84] |
| `ieee` | IEEE-look numeric |
| `apa` | APA 7 (load `\usepackage[style=apa]{biblatex}` + `\DeclareLanguageMapping`) |

Citation commands: `\autocite` (adapts to style — prefer it), `\textcite{k}` → "Knuth (1984)
shows...", `\parencite`, `\cite`. Page ranges: `\autocite[12--15]{knuth84}`.

## natbib + bibtex (when the template demands it)

```latex
\usepackage[numbers,sort&compress]{natbib}   % or [round] for author-year
...
\bibliographystyle{plainnat}   % or the journal's .bst
\bibliography{refs}            % NO .bib extension here
```

`\citep{k}` → (Knuth, 1984); `\citet{k}` → Knuth (1984). If you see raw `\cite` producing
"[Knuth, 1984]" weirdness in an author-year style, someone mixed plain `\cite` semantics —
normalize to `\citep`/`\citet`.

**Never load both natbib and biblatex.** Symptom of accidental mixing: 
`! LaTeX Error: Command \citep already defined` or biblatex's
`Conflicting package: natbib`.

## .bib Hygiene

```bibtex
@article{knuth1984literate,
  author  = {Knuth, Donald E.},
  title   = {Literate Programming},
  journal = {The Computer Journal},
  year    = {1984},
  volume  = {27},
  number  = {2},
  pages   = {97--111},
  doi     = {10.1093/comjnl/27.2.97},
}
```

- **Key scheme**: `authorYEARfirstword` — stable, greppable, collision-resistant.
- **Protect capitals** in titles with braces: `title = {The {LLM} Revolution}` — bibtex
  styles downcase titles otherwise. Don't brace the whole title (`{{...}}`) — it defeats
  style-driven casing entirely.
- `pages = {97--111}` — double hyphen.
- Authors: `Last, First and Last, First` — the `and` is the separator; commas inside a
  name require the `Last, First` form. Corporate authors: `author = {{Google Research}}`.
- Prefer `doi`/`url` fields over stuffing links in `note`.
- Google Scholar exports are dirty: wrong casing, missing DOIs, `journal = {arXiv preprint
  arXiv:...}`. For arXiv use `@misc` with `eprint`/`archivePrefix` (biblatex renders these
  properly with `style=...` + `eprint=true`).

## Backend Debugging

| Symptom | Fix |
|---|---|
| Citations render as `[?]` / bold key | bib pass never ran or errored — run `latexmk`; check `build/main.blg` (bibtex) or `.blg` from biber |
| `Please (re)run Biber on the file` | latexmk handles it; manually: `biber build/main` (no extension) |
| `I found no \citation commands` (bibtex) | ran bibtex on wrong dir/file — bibtex must run in the aux dir; latexmk avoids this whole class |
| Biber `data source not found` | `\addbibresource` path relative to main.tex, needs `.bib` extension |
| Entry silently missing from bibliography | only cited entries print; `\nocite{key}` or `\nocite{*}` to force |
| Weird casing in titles | unprotected capitals — brace acronyms |
| `Biber error: ... .bcf` version mismatch | TeX Live's biblatex and biber versions diverged — update both together (`tlmgr update biber biblatex`) |

## Switching bibtex → biblatex (migration)

1. Replace `\bibliographystyle{...}` + `\bibliography{refs}` with the biblatex preamble +
   `\printbibliography`.
2. `\citep` → `\parencite`, `\citet` → `\textcite` (project-wide sed).
3. Delete stale `.bbl`/`.aux` before the first rebuild — stale bibtex `.bbl` files cause
   inscrutable errors under biber.
4. Journal submission caveat: many publishers still require bibtex + their `.bst`, and
   arXiv wants the `.bbl` inlined — check before migrating a paper mid-submission.
