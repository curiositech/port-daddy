# Visual Proof — PR #10178 (`claude/figure-qa-resync`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `02553929f`, the **figure source under
> review** whose pixels these are. The PNG bytes are hosted in the asset-only
> commit `91fe9ef95`, so the raw URLs pin to that commit — the commit where the
> file bytes actually exist. No figure source changed between the two.

## What these artefacts show

**Said plainly: the proof that carries this PR is a re-derivation, not a
picture.** This PR changes figure-QA *records* — 59 modified, 27 deleted, 4
added — and not one drawing. A before/after of any figure would be two identical
images, which is worse than no evidence because it looks like evidence.

So the pictures below do the one visual job that is honest here: they draw each
record's **own finding bounding boxes** as locator rectangles over an untouched
page-scale render of the live fragment. The page under the boxes is the
compiler's own output at 1.0× / 150 dpi; the only ink added is the rectangles,
and every rectangle's coordinates come straight out of the JSON under review.
That lets a reviewer ask the only question that matters — *does the record point
at something that is actually there?* — by looking.

## How they were made (reproduce)

```bash
# BEFORE — the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER — the same fragment at this PR's head
git worktree add --detach /tmp/after 02553929f
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

## Artefact 1 — `https://media.portdaddy.dev/sha256/e5/e5a99bc94289d89e8e335a1fe2389e74b5df864868004e61c3e2186a7f92e1d5.png`

- File: `https://media.portdaddy.dev/sha256/e5/e5a99bc94289d89e8e335a1fe2389e74b5df864868004e61c3e2186a7f92e1d5.png` (105 KiB)
  - raw: `https://media.portdaddy.dev/sha256/e5/e5a99bc94289d89e8e335a1fe2389e74b5df864868004e61c3e2186a7f92e1d5.png`
- What it shows: The OLD record's 29 finding boxes (left) and the NEW record's 0 (right), over the same untouched render of `fig-swk-durability-faultclass`. The old boxes land on blank paper and on 8.97 pt text; one is at y=843 pt on an 842 pt page.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `02553929ff99f26b142643e55d16e1cfa64e2f24` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 2 — `https://media.portdaddy.dev/sha256/bb/bb76f507e4f31b81d5198cefced8272a96be8a0758579d17edf5236eafded0c2.png`

- File: `https://media.portdaddy.dev/sha256/bb/bb76f507e4f31b81d5198cefced8272a96be8a0758579d17edf5236eafded0c2.png` (112 KiB)
  - raw: `https://media.portdaddy.dev/sha256/bb/bb76f507e4f31b81d5198cefced8272a96be8a0758579d17edf5236eafded0c2.png`
- What it shows: `fig-stp-parfit-chain`: 23 old findings vs 15 new. Four old T1 boxes sit in the CAPTION, outside the drawing; the new ones land on the sub-7 pt math subscripts on the transitive ledger rail.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `02553929ff99f26b142643e55d16e1cfa64e2f24` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 3 — `https://media.portdaddy.dev/sha256/15/157048e1e22a8ae66530506a4b8fbfbb5ba30b35a8c9fd10ef0f58078e9b1bf3.png`

- File: `https://media.portdaddy.dev/sha256/15/157048e1e22a8ae66530506a4b8fbfbb5ba30b35a8c9fd10ef0f58078e9b1bf3.png` (165 KiB)
  - raw: `https://media.portdaddy.dev/sha256/15/157048e1e22a8ae66530506a4b8fbfbb5ba30b35a8c9fd10ef0f58078e9b1bf3.png`
- What it shows: `fig-fh-xfer-ceremony`: T1 goes 16 -> 0 and T4 goes 5 -> 6. The new T4 boxes each enclose a real label collision ("+ attenuated card" against "destination verifies locally"; the revocation note against the rail below it).
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `02553929ff99f26b142643e55d16e1cfa64e2f24` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

