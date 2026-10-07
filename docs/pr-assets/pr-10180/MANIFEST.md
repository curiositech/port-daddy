# Visual Proof — PR #10180 (`claude/book-fix-sealed-harbor`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Three before/after pairs from *The Sealed Harbor*, at page scale. This PR
raises the chapter to the `textbook-craft` floors: a claim that was asserted now
carries a worked example the reader can check by hand, and the chapter gains the
apparatus (openers, boundaries, history) the standard asks for. The pairs show
the three places where that is most visible.

## How they were made

These are **not** a local LaTeX rebuild. They are rasterisations of the two
`coordination-papers-mega-volume.pdf` blobs that already exist in this
repository's history:

| | commit | pages | producer |
|---|---|---|---|
| **before** | `c92efaa5c` — merge-base with `main` | 551 | `xdvipdfmx (20260317)` |
| **after** | `8ade37ed6` — this PR's head | 555 | `xdvipdfmx (20260317)` |

Both were produced by the project's own `scripts/build-whitepapers.sh`
toolchain (XeTeX → `xdvipdfmx`) and committed by the branch; the "after" one is
the byte-for-byte artifact this PR ships and the website serves. Rendering the
committed blobs rather than rebuilding is what makes the pair comparable — one
toolchain, one edition, two commits — and it is why **no PDF was regenerated
and none is committed here**. Only PNGs.

`tectonic` 0.15.0 is the only TeX engine in this environment, and its output
differs in pagination from the official toolchain, so it was not used for these
pairs: a tectonic render would not be a picture of what this PR ships.

Rasterised with PyMuPDF 1.28.2 at **150 dpi, scale 1.0×** — page scale, what
a phone PDF viewer shows, per
`skills/harbor-chartwork/references/craft-rules.md` §1.4 ("Test the figure as a
150 dpi PNG at 1.0×"). The page halves are pasted **unscaled and
unannotated**: every pixel inside a page frame is the PDF's own. The only ink
added is the caption band above each page.

## Which pages, and how they were chosen

Pages were not guessed. Both PDFs were flattened to one page-attributed line
stream and diffed with `difflib`. The running head, printed folio and footer are
excluded from that stream **by geometry** (the body band is y ∈ [40, 670] pt of a
504×720 pt page), because the folio changes on every page after an insertion or
deletion and would otherwise report the entire book as changed. Every differing
hunk is then classified as a **real text change** or a **renumber-only** change
by re-comparing both sides with every reference-number token blanked out.

| | count |
|---|---|
| after-pages with a **real** text change | **32** |
| after-pages that changed **only** in reference numbers | 262 |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 555 |

The 262 renumber-only pages are reflow: inserting a worked example
shifts the numbering of everything after it, and every cross-reference follows.
They are not shown, because a page whose only change is `4.6` becoming `4.7` is
not worth a picture. The three pairs below are chosen from the 32 pages
that gained or lost actual text.

Each pair's **before** page is the base page that is genuinely that after-page's
counterpart -- chosen by maximum shared-line overlap over a +/-14 page window,
not by subtracting the page-count delta. That matters: inserting a worked example
shifts everything after it, so the page with the same number is usually not the
same page.

## HONEST caveats — read before trusting the label

- **`sourceLabel: real`** means these pixels come from the real artifact at the
  real commits named. It does **not** mean anyone has certified the typography
  correct — it means the picture is of the true artifact, not a mock-up.
- These renders show the **Book**
  (`coordination-papers-mega-volume.pdf`). This PR also rebuilds the standalone
  `sealed-harbor-whitepaper.pdf`, which is not shown here; the chapter text is the
  same, its pagination is not.
- A render proves what a page looks like. It does not prove the prose is right.

## Reproduce

```bash
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show 8ade37ed6:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[131-1].get_pixmap(dpi=150).save('p131.png')"
```

---

## Artifact 1 — `https://media.portdaddy.dev/sha256/6c/6ca1e70c96b76079271fcc1b84c961dd000566ac8fcd6f0b1c2476396f448ade.png`

1 / A comparison you can do in your head

- File: `https://media.portdaddy.dev/sha256/6c/6ca1e70c96b76079271fcc1b84c961dd000566ac8fcd6f0b1c2476396f448ade.png`
  - raw: `https://media.portdaddy.dev/sha256/6c/6ca1e70c96b76079271fcc1b84c961dd000566ac8fcd6f0b1c2476396f448ade.png`
- Shows: before = p.131 · after = p.131 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 569 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `8ade37ed6` — PR #10180 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 2 — `https://media.portdaddy.dev/sha256/a4/a448db499172d7b368db17058d5ce6854b8a04a7c6285918f80fe17c5475d2b7.png`

2 / The adversarial channel, counted

- File: `https://media.portdaddy.dev/sha256/a4/a448db499172d7b368db17058d5ce6854b8a04a7c6285918f80fe17c5475d2b7.png`
  - raw: `https://media.portdaddy.dev/sha256/a4/a448db499172d7b368db17058d5ce6854b8a04a7c6285918f80fe17c5475d2b7.png`
- Shows: before = p.150 · after = p.151 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 696 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `8ade37ed6` — PR #10180 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 3 — `https://media.portdaddy.dev/sha256/f2/f20cafc2368dab4b4a836c045055dca9c6643db5b99643c8e84221d99d7b4523.png`

3 / More exercises, each graded and pointed at its solution

- File: `https://media.portdaddy.dev/sha256/f2/f20cafc2368dab4b4a836c045055dca9c6643db5b99643c8e84221d99d7b4523.png`
  - raw: `https://media.portdaddy.dev/sha256/f2/f20cafc2368dab4b4a836c045055dca9c6643db5b99643c8e84221d99d7b4523.png`
- Shows: before = p.154 · after = p.155 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 593 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `8ade37ed6` — PR #10180 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked
