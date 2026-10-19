# Visual Proof — PR #10177 (`claude/book-fix-bonded-commons`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Three before/after pairs from *The Bonded Commons*, at page scale. This PR
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
| **after** | `25f41e6da` — this PR's head | 554 | `xdvipdfmx (20260317)` |

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
| after-pages with a **real** text change | **26** |
| after-pages that changed **only** in reference numbers | 82 |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 554 |

The 82 renumber-only pages are reflow: inserting a worked example
shifts the numbering of everything after it, and every cross-reference follows.
They are not shown, because a page whose only change is `4.6` becoming `4.7` is
not worth a picture. The three pairs below are chosen from the 26 pages
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
  `agent-transactions-whitepaper.pdf`, which is not shown here; the chapter text is the
  same, its pagination is not.
- A render proves what a page looks like. It does not prove the prose is right.

## Reproduce

```bash
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show 25f41e6da:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[341-1].get_pixmap(dpi=150).save('p341.png')"
```

---

## Artifact 1 — `https://media.portdaddy.dev/sha256/d3/d3d0f8e63169de8044e73744a1372856ce5e4544f8ebef0106ffc253e8558e36.png`

1 / The exact count behind O(n^2)

- File: `https://media.portdaddy.dev/sha256/d3/d3d0f8e63169de8044e73744a1372856ce5e4544f8ebef0106ffc253e8558e36.png`
  - raw: `https://media.portdaddy.dev/sha256/d3/d3d0f8e63169de8044e73744a1372856ce5e4544f8ebef0106ffc253e8558e36.png`
- Shows: before = p.341 · after = p.341 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 547 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `25f41e6da` — PR #10177 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 2 — `https://media.portdaddy.dev/sha256/da/da8d976400d3e27e2a8ba4679e17e9e39269d95080a51d479fe90ca8ba0325ad.png`

2 / When a crashed agent is declared dead, second by second

- File: `https://media.portdaddy.dev/sha256/da/da8d976400d3e27e2a8ba4679e17e9e39269d95080a51d479fe90ca8ba0325ad.png`
  - raw: `https://media.portdaddy.dev/sha256/da/da8d976400d3e27e2a8ba4679e17e9e39269d95080a51d479fe90ca8ba0325ad.png`
- Shows: before = p.360 · after = p.362 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 754 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `25f41e6da` — PR #10177 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 3 — `https://media.portdaddy.dev/sha256/c6/c6f39b50a76f08cc71f873f09545728253480acc6c6b2dc10e1378320fa1caef.png`

3 / The TLA+ invariant joined to the subsystem that realizes it

- File: `https://media.portdaddy.dev/sha256/c6/c6f39b50a76f08cc71f873f09545728253480acc6c6b2dc10e1378320fa1caef.png`
  - raw: `https://media.portdaddy.dev/sha256/c6/c6f39b50a76f08cc71f873f09545728253480acc6c6b2dc10e1378320fa1caef.png`
- Shows: before = p.387 · after = p.389 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 688 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `25f41e6da` — PR #10177 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked
