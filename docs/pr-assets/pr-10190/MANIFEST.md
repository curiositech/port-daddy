# Visual Proof — PR #10190 (`claude/figures-that-were-missing`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `00d00787e`, the **figure source under
> review** whose pixels these are. The PNG bytes are hosted in the asset-only
> commit `70aef86ce`, so the raw URLs pin to that commit — the commit where the
> file bytes actually exist. No figure source changed between the two.

## What these artefacts show

Three figures, three different honest comparisons.

`fig-bc-delta-threshold` and `fig-he-succession-price` **do not exist at the
merge-base** (`c92efaa5c`), so a before/after pair would be a fabrication. What
is shown instead is the comparison that does carry information: the same
fragment under the **Book** preamble beside the **chapter** preamble, because
the two editions restyle the figure language differently and a new figure has to
be legible — and truthfully captioned — in both. In particular `pd caution
datum` is a diamond under the chapter preamble and a square under the Book's, so
the two panels are what lets a reviewer confirm that the corrected caption ("the
marked point at δ = 0.30") is true of both editions where the earlier wording
was true of only one.

`fig-anchor-handshake-ladder` was drawn on this branch in `6251d2538` and then
**redrawn** in `79d9fdeb3`. Its before is therefore the first drawn form on this
same branch — a flat four-message ladder whose daemon lifeline went dotted —
against the sequence diagram that replaced it, where "the daemon is not
contacted again" is carried by a shaded region instead. That substitution is
worth looking at: at 150 dpi the old dotted lifeline is the kind of sub-pixel
dash that antialiases into nothing, and the shaded region is not.

## How they were made (reproduce)

```bash
# BEFORE — the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER — the same fragment at this PR's head
git worktree add --detach /tmp/after 00d00787e
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

## Artefact 1 — `https://media.portdaddy.dev/sha256/4e/4e9606cb8017d2fd8a7f39bdd6034754591e3cfbbaf710138bf9ebafe9c473e6.png`

- File: `https://media.portdaddy.dev/sha256/4e/4e9606cb8017d2fd8a7f39bdd6034754591e3cfbbaf710138bf9ebafe9c473e6.png` (383 KiB)
  - raw: `https://media.portdaddy.dev/sha256/4e/4e9606cb8017d2fd8a7f39bdd6034754591e3cfbbaf710138bf9ebafe9c473e6.png`
- What it shows: NEW figure `fig-bc-delta-threshold` under the **Book** preamble (left) and the **chapter** preamble of `agent-transactions-whitepaper.tex` (right). No BEFORE — the fragment is added by this PR. Read the marked point at δ = 0.30: a square on the left, a diamond on the right, and a caption that now names neither.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `00d00787efd56e3e17ffbf4278d4386b2f28353e` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 2 — `https://media.portdaddy.dev/sha256/d6/d661a0419acc271a7ecd32d49b9b3f4375314a79c76d9cc359f3b2db94da3e11.png`

- File: `https://media.portdaddy.dev/sha256/d6/d661a0419acc271a7ecd32d49b9b3f4375314a79c76d9cc359f3b2db94da3e11.png` (317 KiB)
  - raw: `https://media.portdaddy.dev/sha256/d6/d661a0419acc271a7ecd32d49b9b3f4375314a79c76d9cc359f3b2db94da3e11.png`
- What it shows: NEW figure `fig-he-succession-price`, Book edition (left) beside chapter edition (right). No BEFORE — added by this PR.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `00d00787efd56e3e17ffbf4278d4386b2f28353e` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 3 — `https://media.portdaddy.dev/sha256/af/af283018c53f10b03d0d3194e1a968c21c6dc8d387ba0550cb401673ad0e051a.png`

- File: `https://media.portdaddy.dev/sha256/af/af283018c53f10b03d0d3194e1a968c21c6dc8d387ba0550cb401673ad0e051a.png` (251 KiB)
  - raw: `https://media.portdaddy.dev/sha256/af/af283018c53f10b03d0d3194e1a968c21c6dc8d387ba0550cb401673ad0e051a.png`
- What it shows: `fig-anchor-handshake-ladder` BEFORE (the first drawn form, `6251d2538`) | AFTER (the redraw at this PR's head), under the **Book** preamble.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `00d00787efd56e3e17ffbf4278d4386b2f28353e` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 4 — `https://media.portdaddy.dev/sha256/d5/d526ed50363ae296152bd9f82f034791fca9530e1b73ef12912cd6bd8d3e6e74.png`

- File: `https://media.portdaddy.dev/sha256/d5/d526ed50363ae296152bd9f82f034791fca9530e1b73ef12912cd6bd8d3e6e74.png` (254 KiB)
  - raw: `https://media.portdaddy.dev/sha256/d5/d526ed50363ae296152bd9f82f034791fca9530e1b73ef12912cd6bd8d3e6e74.png`
- What it shows: The same redraw pair under the **chapter** preamble of `anchor-protocol-whitepaper.tex` (11 pt Latin Modern, 16.3 cm column).
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `00d00787efd56e3e17ffbf4278d4386b2f28353e` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

