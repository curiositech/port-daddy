# Visual Proof — `claude/fix-anchor-four-phases-figure`

Provenance manifest for the page-scale render in this directory, per the
`agent-visual-evidence-manifest` skill.

## What this artefact shows

**Root cause, restated visually.** `anchor-protocol-whitepaper.tex` §2 ("The
Anchor Protocol Architecture") promised a four-phase flow figure
(`Figure~\ref{fig:anchor-four-phases}`) but `figures/fig-anchor-four-phases.tex`
never existed — only `figures/fig-anchor-phases.tex`, an orphaned three-phase
predecessor whose own header comment said the four-phase file "strictly
subsumes" it. Someone had substituted a plain data table
(`tab:anchor-four-phases`) for the missing figure instead. This PR builds the
real figure.

The single artefact below is page 5 of the compiled chapter, rendered twice:
**BEFORE** (this PR's merge-base, `104959367`) shows the table-only
presentation the prose pointed a reader past on the way to a citation that
resolved to nothing drawn. **AFTER** (this PR's head, `93eb6030c`) shows the
same page with the new figure inserted above the table, which now reads as an
explicit lookup companion rather than the only representation.

## How it was made (reproduce)

```bash
# BEFORE — the chapter at this PR's merge-base
git worktree add --detach /tmp/before 104959367
cd /tmp/before/website-v2/public/whitepaper && \
  latexmk -pdf -interaction=nonstopmode -halt-on-error anchor-protocol-whitepaper.tex
pdftoppm -png -r 150 -f 5 -l 5 anchor-protocol-whitepaper.pdf /tmp/pr-assets/before

# AFTER — the chapter at this PR's head
cd /path/to/checkout/website-v2/public/whitepaper && \
  latexmk -pdf -interaction=nonstopmode -halt-on-error anchor-protocol-whitepaper.tex
pdftoppm -png -r 150 -f 5 -l 5 anchor-protocol-whitepaper.pdf /tmp/pr-assets/after

# Trim trailing blank page area (keep full page width), compose side by side
# with a caption band naming each panel. See the PIL script inlined in the
# session that produced this PR for the exact compositing.
```

**Scale discipline.** `pdftoppm -r 150` renders at 150 dpi with no additional
scaling — the page as a phone PDF viewer shows it at 100%. Blank page area
*below the last inked row* is dropped from each panel so the pair fits a PR
body; the full page **width** is always kept, so the column measure the
figure has to live inside stays visible, and no pixel is rescaled.

---

## Artefact — `anchor-four-phases-before-after-1x-150dpi.png`

- File: `docs/pr-assets/fix-anchor-four-phases-figure/anchor-four-phases-before-after-1x-150dpi.png` (664 KiB)
- What it shows: page 5 of the compiled `anchor-protocol-whitepaper.pdf`,
  BEFORE (table-only, §2 citing only `Table~\ref{tab:anchor-four-phases}`)
  next to AFTER (the new `Figure~\ref{fig:anchor-four-phases}` inserted above
  the same table, now captioned as a lookup companion, with the prose citing
  both).
- Daemon port: `none` — a `latexmk`/`pdftoppm` compile-and-rasterize opens no
  socket and starts no daemon.
- Run id: `none` — not a daemon-backed run; a local, deterministic LaTeX
  build from checked-out source.
- Transcript head hash: `none` — not applicable; there is no agent
  conversation transcript backing this artefact's content, only the compiler.
- Agent node id: `none` — single-session local build, no multi-agent
  coordination produced this artefact.
- Commit: BEFORE panel is rendered from `104959367d8557763456f8b63bff934388e50e2`
  (this PR's merge-base with `main`); AFTER panel is rendered from
  `93eb6030cdfca1b2aca26cac2fdb7e074c113f82` (this PR's head commit, the one
  that adds `figures/fig-anchor-four-phases.tex` and wires it into the
  chapter).
- Source label: **real** — both panels are unmodified `pdftoppm` rasters of
  an actual `pdflatex`/`latexmk` compile of the real chapter source at each
  commit; no panel is a mock, a fixture, or a hand-edited composite of
  anything other than the two page rasters plus the added caption bands and
  divider line.
