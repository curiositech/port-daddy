# Visual Proof — PR #10190 (`claude/figures-that-were-missing`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `e4f4f7f3c`, the **figure source under
> review** whose pixels these are. The PNG bytes are hosted in the asset-only
> commit `d642ac597`, so the raw URLs pin to that commit — the commit where the
> file bytes actually exist. No figure source changed between the two.

## What these artefacts show

Three figures, three different honest comparisons.

`fig-bc-delta-threshold` and `fig-he-succession-price` **do not exist at the
merge-base** (`c92efaa5c`), so a before/after pair would be a fabrication. What
is shown instead is the comparison that does carry information: the same
fragment under the **Book** preamble beside the **chapter** preamble, because
the two editions restyle the figure language differently and a new figure has to
be legible in both.

`fig-anchor-handshake-ladder` was drawn on this branch in `6251d2538` and then
**redrawn** in `79d9fdeb3`. Its before is therefore the first drawn form on this
same branch — a flat four-message ladder with a dotted daemon lifeline — against
the sequence diagram that replaced it, where "the daemon is not contacted again"
is carried by a shaded region instead of a dotted line.

## How they were made (reproduce)

```bash
# BEFORE — the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER — the same fragment at this PR's head
git worktree add --detach /tmp/after e4f4f7f3c
cd /tmp/after && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/after-pdf

# 1.0x / 150 dpi raster of page 1 of each, then composed side by side
python3 -c "import pymupdf; d=pymupdf.open('<pdf>'); \
  d[0].get_pixmap(matrix=pymupdf.Matrix(150/72,150/72), alpha=False).save('<png>')"
```

**Scale discipline.** `Matrix(150/72, 150/72)` is exactly 1.0× at 150 dpi — the
page as a phone PDF viewer shows it at 100%. Nothing here is a zoomed crop or a
magnified detail. Blank page area *below the last inked row* is dropped so the
pair fits a PR body; the full page **width** is always kept, so the column measure
the figure has to live inside stays visible, and **no pixel is rescaled**. The
only ink added is the grey caption band naming each panel.

---

## Artefact 1 — `bc-delta-threshold-book-vs-chapter-1x-150dpi.png`

- File: `docs/pr-assets/pr-10190/bc-delta-threshold-book-vs-chapter-1x-150dpi.png` (368 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/d642ac5976604ec4dd9e4a3d89cab240f855ab23/docs/pr-assets/pr-10190/bc-delta-threshold-book-vs-chapter-1x-150dpi.png`
- What it shows: NEW figure `fig-bc-delta-threshold` under the **Book** preamble (left) and the **chapter** preamble of `agent-transactions-whitepaper.tex` (right). There is no BEFORE — the fragment is added by this PR.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `e4f4f7f3ce513b4ff23ffaae2d03b2efd5504276` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 2 — `he-succession-price-book-vs-chapter-1x-150dpi.png`

- File: `docs/pr-assets/pr-10190/he-succession-price-book-vs-chapter-1x-150dpi.png` (285 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/d642ac5976604ec4dd9e4a3d89cab240f855ab23/docs/pr-assets/pr-10190/he-succession-price-book-vs-chapter-1x-150dpi.png`
- What it shows: NEW figure `fig-he-succession-price`, Book edition (left) beside chapter edition (right). No BEFORE — added by this PR.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `e4f4f7f3ce513b4ff23ffaae2d03b2efd5504276` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 3 — `anchor-handshake-ladder-redraw-book-1x-150dpi.png`

- File: `docs/pr-assets/pr-10190/anchor-handshake-ladder-redraw-book-1x-150dpi.png` (250 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/d642ac5976604ec4dd9e4a3d89cab240f855ab23/docs/pr-assets/pr-10190/anchor-handshake-ladder-redraw-book-1x-150dpi.png`
- What it shows: `fig-anchor-handshake-ladder` BEFORE (the first drawn form, `6251d2538`) | AFTER (the redraw at this PR's head), under the **Book** preamble.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `e4f4f7f3ce513b4ff23ffaae2d03b2efd5504276` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 4 — `anchor-handshake-ladder-redraw-chapter-1x-150dpi.png`

- File: `docs/pr-assets/pr-10190/anchor-handshake-ladder-redraw-chapter-1x-150dpi.png` (254 KiB)
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/d642ac5976604ec4dd9e4a3d89cab240f855ab23/docs/pr-assets/pr-10190/anchor-handshake-ladder-redraw-chapter-1x-150dpi.png`
- What it shows: The same redraw pair under the **chapter** preamble of `anchor-protocol-whitepaper.tex` (11 pt Latin Modern, 16.3 cm column).
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `e4f4f7f3ce513b4ff23ffaae2d03b2efd5504276` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

