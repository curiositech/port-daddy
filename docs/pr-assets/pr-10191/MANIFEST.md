# Visual Proof — PR #10191 (`claude/figure-typography-law`)

Provenance manifest for the page-scale figure renders in this directory, per the
`agent-visual-evidence-manifest` skill. Every artefact carries the six required
fields and an **honest** `sourceLabel`.

> **Two SHAs, on purpose** — the same convention as `docs/pr-assets/pr-729/`.
> Each artefact's `commit` field is `07d9bf752`, the **figure source under
> review** whose pixels these are. The PNG bytes are hosted in the asset-only
> commit `7e69c2056`, so the raw URLs pin to that commit — the commit where the
> file bytes actually exist. No figure source changed between the two.

## What these artefacts show

Thirty-five fragments are restyled here, so a contact sheet would prove nothing
at thumbnail size. Six fragments are shown at full page scale instead, each
chosen because it exercises one clause of the law harder than any other fragment
in the corpus, and five of the six are under the **Book** preamble because the
Book's 4.5 in column and 10.5 pt Palatino are where the 7 pt legibility floor
actually bites (\scriptsize renders at 6.97 pt there).

| fragment | why this one |
|---|---|
| `fig-sealed-operating-curve` | one of six fragments still using `pd guide`, so it is where the dash-geometry fix in `07d9bf752` shows |
| `fig-bonded-key-custody` | seven `\tiny`/`\scriptsize` declarations at the merge-base — the most of any fragment; shown under **both** preambles |
| `fig-anchor-phases` | the largest figure-source change in the diff (17 added / 16 removed), and a `\pdfigsub` gloss-line case |
| `fig-stp-rate-the-raters` | the only fragment that uses both `\pdfigsub` and `\pdfigmath`; its two gloss lines were the worst sub-floor text in the set |
| `fig-sealed-pillar-pipeline` | `pd mono label` (the new identifier role) plus the reversed `pd state` |

**The guide dash, measured rather than asserted.** Read off the two PDFs' own
content streams for `fig-sealed-operating-curve` under the Book preamble:

| | stroke | dash | ink |
|---|---|---|---|
| merge-base | 0.498 pt | on 0.448 pt / off 0.996 pt | `#A4A2A0` |
| this PR | 0.697 pt | on 1.196 pt / off 1.993 pt | `#5F5D59` |

At 150 dpi the old one is a **0.93 px dot on a 0.93 px stroke** — sub-pixel on
both axes. Rasterised, its darkest pixel reaches only **27 % ink** and the column
reads `204, 187, 249, 255, 187, 249, 255 …`: a grey smear at quarter strength,
neither a dot nor a line. The new one rasterises to `0, 32, 108, 177, 255, 255,
255, 206, 108 …` — **100 % ink at the dot core with real paper between dots**,
and 22.3 % mean ink against the old 9.7 %.

## How they were made (reproduce)

```bash
# BEFORE — the same fragment at this PR's merge-base
git worktree add --detach /tmp/before c92efaa5c
cd /tmp/before && bash skills/harbor-chartwork/scripts/compile_fragment.sh \
    <fragment>.tex --preamble book --out /tmp/before-pdf

# AFTER — the same fragment at this PR's head
git worktree add --detach /tmp/after 07d9bf752
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

## Artefact 1 — `https://media.portdaddy.dev/sha256/c3/c37394f0159edcb5d353477568abdb46e7077f24a1c4f446c40778759a6287fb.png`

- File: `https://media.portdaddy.dev/sha256/c3/c37394f0159edcb5d353477568abdb46e7077f24a1c4f446c40778759a6287fb.png` (253 KiB)
  - raw: `https://media.portdaddy.dev/sha256/c3/c37394f0159edcb5d353477568abdb46e7077f24a1c4f446c40778759a6287fb.png`
- What it shows: BEFORE | AFTER of `fig-sealed-operating-curve` (Book preamble). The vertical `pd guide` is the element to read: sub-pixel dots at the merge-base, a real dotted rule at HEAD.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 2 — `https://media.portdaddy.dev/sha256/df/df8f7d63c26b4298ad41dcd068d69f984596e0d8c42b8643f732f0b765356dcb.png`

- File: `https://media.portdaddy.dev/sha256/df/df8f7d63c26b4298ad41dcd068d69f984596e0d8c42b8643f732f0b765356dcb.png` (166 KiB)
  - raw: `https://media.portdaddy.dev/sha256/df/df8f7d63c26b4298ad41dcd068d69f984596e0d8c42b8643f732f0b765356dcb.png`
- What it shows: BEFORE | AFTER of `fig-bonded-key-custody` (Book preamble) — seven `\\tiny`/`\\scriptsize` declarations replaced by the one legal size.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 3 — `https://media.portdaddy.dev/sha256/7d/7d3da562b13fab6fb21cebf16a08ce06d35124bfb7ff192363d77b74c87a8f2e.png`

- File: `https://media.portdaddy.dev/sha256/7d/7d3da562b13fab6fb21cebf16a08ce06d35124bfb7ff192363d77b74c87a8f2e.png` (246 KiB)
  - raw: `https://media.portdaddy.dev/sha256/7d/7d3da562b13fab6fb21cebf16a08ce06d35124bfb7ff192363d77b74c87a8f2e.png`
- What it shows: The same pair under the **chapter** preamble (11 pt Latin Modern, 16.3 cm column).
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 4 — `https://media.portdaddy.dev/sha256/48/48ed13bc9141e1cd6670b8ca48787160b271898cade2ed15e33a8b5377ef295e.png`

- File: `https://media.portdaddy.dev/sha256/48/48ed13bc9141e1cd6670b8ca48787160b271898cade2ed15e33a8b5377ef295e.png` (220 KiB)
  - raw: `https://media.portdaddy.dev/sha256/48/48ed13bc9141e1cd6670b8ca48787160b271898cade2ed15e33a8b5377ef295e.png`
- What it shows: BEFORE | AFTER of `fig-anchor-phases` (Book preamble), the largest figure-source change in the diff.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 5 — `https://media.portdaddy.dev/sha256/33/33ad4d08501d7567637fc6c78527baf35fcf03bf381f1da24787b8b2629e9444.png`

- File: `https://media.portdaddy.dev/sha256/33/33ad4d08501d7567637fc6c78527baf35fcf03bf381f1da24787b8b2629e9444.png` (272 KiB)
  - raw: `https://media.portdaddy.dev/sha256/33/33ad4d08501d7567637fc6c78527baf35fcf03bf381f1da24787b8b2629e9444.png`
- What it shows: BEFORE | AFTER of `fig-stp-rate-the-raters` (Book preamble). The two gloss lines ("reaches root near level 27/53") are the clearest sub-floor text in the corpus.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

## Artefact 6 — `https://media.portdaddy.dev/sha256/13/135782ee276c626390719a4cfe758f7f94ec9e9ac28142a813c9ede72155bd9b.png`

- File: `https://media.portdaddy.dev/sha256/13/135782ee276c626390719a4cfe758f7f94ec9e9ac28142a813c9ede72155bd9b.png` (284 KiB)
  - raw: `https://media.portdaddy.dev/sha256/13/135782ee276c626390719a4cfe758f7f94ec9e9ac28142a813c9ede72155bd9b.png`
- What it shows: BEFORE | AFTER of `fig-sealed-pillar-pipeline` (Book preamble) — the new `pd mono label` identifier role and the reversed `pd state`.
- Daemon port: `none` — a `tectonic` fragment compile opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a `.tex` blob in git
- Transcript head hash: `n/a (print render)` — no event stream to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `07d9bf752e0cb56d8e8c2ad49bbb2eae054abf32` (figure source under review)
- Source: `live` — the real committed fragment compiled by the real house preamble; nothing mocked, seeded or hand-drawn

