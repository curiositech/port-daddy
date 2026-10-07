# Visual Proof — PR #10184 (`claude/figure-stack-map-redraw`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `57250bb61`, the **figure source under
> review** whose pixels these are (this PR's head before the asset commit). The
> PNG bytes are hosted in the asset-only commit `b67dde5be`, so the raw URLs
> pin to that commit — the commit where the file bytes actually exist. No figure
> source changed between the two.

## What these artefacts show

`fig-swk-stack-map` is redrawn around **provides / assumes**: the old form was a
solid stacked block with a black MACHINE FLOOR band and a bracket labelled "this
chapter"; the new form separates the rungs, puts a `provides` arrow up and an
`assumes` arrow down in every gap, adds a left margin badge naming the part and
chapters that own each rung, and a right-hand audience tag. The claim is that a
reader can now see which direction each dependency runs. That is a claim about a
drawing, so the proof is the drawing, at the size it prints.

Both preambles are shown because the two editions give the figure a different
accent ink (indigo in the Book, teal in the standalone chapter) and a different
measure (4.5 in vs 16.3 cm); the Book column is the binding one and is where the
five rungs plus four arrow gaps have to fit.

## How they were made (reproduce)

```bash
# BEFORE: the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER: the same fragment at this PR's head
git worktree add --detach /tmp/after 57250bb61
cd /tmp/after && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/after-pdf

# 1.0x / 150 dpi raster of page 1 of each, composed side by side
python3 -c "import pymupdf; d=pymupdf.open('<pdf>'); \
    d[0].get_pixmap(matrix=pymupdf.Matrix(150/72,150/72), alpha=False).save('<png>')"
```

**Scale discipline.** `Matrix(150/72, 150/72)` is exactly 1.0x at 150 dpi — the
page as a phone PDF viewer shows it at 100%. Nothing in this directory is a
zoomed crop or a magnified detail. Where a panel is shorter than the full
7x10in (or A4) page, blank page area *below the last inked row* was dropped so
the pair fits a PR body; the full page **width** is always kept, so the column
measure the figure has to live inside is visible, and **no pixel is rescaled** —
every retained pixel is still 150 dpi.

---

## Artefact 1 — `https://media.portdaddy.dev/sha256/b6/b6fa188185ece1b05db37038e644266426a2e0a873deaba2296ae2df17926a9b.png`

- File: `https://media.portdaddy.dev/sha256/b6/b6fa188185ece1b05db37038e644266426a2e0a873deaba2296ae2df17926a9b.png` (293 KiB)
  - raw: `https://media.portdaddy.dev/sha256/b6/b6fa188185ece1b05db37038e644266426a2e0a873deaba2296ae2df17926a9b.png`
- What it shows: BEFORE (merge-base c92efaa5c) | AFTER (this PR) of `fig-swk-stack-map` under the **Book** preamble — Palatino 10.5 pt, 7x10 in trim, 4.5 in column. The printed condition.
- Daemon port: `none` — no daemon; a LaTeX fragment compile, not a running surface
- Run id: `n/a (render)` — deterministic `tectonic` compile of committed sources
- Transcript head hash: `n/a (render)` — no event stream; the input is the .tex in git
- Agent node id: `n/a (render)` — no agent identity participates in a figure compile
- Commit: `57250bb6153ff0985a665b98684a98294ee5f493` (figure source under review)
- Source: `live` — these are the real committed fragment sources compiled by the real house preamble; nothing is mocked, seeded or hand-drawn

## Artefact 2 — `https://media.portdaddy.dev/sha256/4f/4fd45a3f74e7289a61ffaa00489479fe993e60dd78d987672c96c7182dc57631.png`

- File: `https://media.portdaddy.dev/sha256/4f/4fd45a3f74e7289a61ffaa00489479fe993e60dd78d987672c96c7182dc57631.png` (278 KiB)
  - raw: `https://media.portdaddy.dev/sha256/4f/4fd45a3f74e7289a61ffaa00489479fe993e60dd78d987672c96c7182dc57631.png`
- What it shows: The same pair under the **chapter** preamble taken verbatim from `whitepaper/single-writer-kernel.tex` (11 pt Latin Modern, 16.3 cm column).
- Daemon port: `none` — no daemon; a LaTeX fragment compile, not a running surface
- Run id: `n/a (render)` — deterministic `tectonic` compile of committed sources
- Transcript head hash: `n/a (render)` — no event stream; the input is the .tex in git
- Agent node id: `n/a (render)` — no agent identity participates in a figure compile
- Commit: `57250bb6153ff0985a665b98684a98294ee5f493` (figure source under review)
- Source: `live` — these are the real committed fragment sources compiled by the real house preamble; nothing is mocked, seeded or hand-drawn

