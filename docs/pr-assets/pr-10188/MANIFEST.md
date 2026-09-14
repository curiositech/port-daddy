# Visual Proof — PR #10188 (`claude/kernel-readers-map`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

This PR stars the kernel chapter's Reader's Map (`\\section` ->
`\\section*`), which makes the Book's generator drop it. The three pairs show,
in order: the Reader's Map table gone from the page it occupied, the section
heading and its lead-in gone, and the Contents page -- which is where the
**second, larger** effect is visible.

## How they were made

These are **not** a local LaTeX rebuild. They are rasterisations of the two
`coordination-papers-mega-volume.pdf` blobs that already exist in this
repository's history:

| | commit | pages | producer |
|---|---|---|---|
| **before** | `c92efaa5c` — merge-base with `main` | 551 | `xdvipdfmx (20260317)` |
| **after** | `a2d02810c` — this PR's head | 550 | `xdvipdfmx (20260317)` |

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

For this PR the diff is small and the answer is sharp:

| | count |
|---|---|
| after-pages with a **real** text change | **4** (pp. 10, 23, 78, 79) |
| after-pages that changed **only** in reference numbers | **205** |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 550 |

The 205 renumber-only pages are not padding and they are not nothing: starring
the section removes it from the numbering, so every section in Chapter 1 from
1.4 onward shifts down by one, and every cross-reference to them anywhere in the
book follows. Artifact 3 shows that cascade in a single picture rather than
shipping 205 near-identical page shots.

## HONEST caveats — read before trusting the label

- **`sourceLabel: real`** means these pixels come from the real artifact at the
  real commits named. It does **not** mean anyone has certified the typography
  correct — it means the picture is of the true artifact, not a mock-up.
- These renders show the **Book**
  (`coordination-papers-mega-volume.pdf`). The standalone
  `single-writer-kernel-whitepaper.pdf` behaves **differently and deliberately
  so**: it keeps the Reader's Map (now unnumbered, with an explicit
  `\\addcontentsline` entry). Verified: the phrase "Map below routes you to a
  15-minute path" is present in the standalone at head and absent from the Book.
- The renumbering is **not** Book-only. The standalone paper renumbers too: 44
  of its 58 pages change reference numbers.
- A render proves what a page looks like. It does not prove the prose is right.

## Reproduce

```bash
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show a2d02810c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[23-1].get_pixmap(dpi=150).save('p23.png')"
```

---

## Artifact 1 — `readers-map-page.png`

1 / The Reader's Map table stops printing in the Book

- File: `docs/pr-assets/pr-10188/readers-map-page.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/f759fa462f22031fe84b1fb470b3cb7ab8b7ecc4/docs/pr-assets/pr-10188/readers-map-page.png`
- Shows: before = p.23 · after = p.23 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 444 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `a2d02810c3f` — PR #10188 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 2 — `readers-map-heading.png`

2 / The section heading and its lead-in go with it

- File: `docs/pr-assets/pr-10188/readers-map-heading.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/f759fa462f22031fe84b1fb470b3cb7ab8b7ecc4/docs/pr-assets/pr-10188/readers-map-heading.png`
- Shows: before = p.22 · after = p.22 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 399 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `a2d02810c3f` — PR #10188 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 3 — `contents-renumber.png`

3 / Contents: the entry disappears and Chapter 1 renumbers from 1.4 down

- File: `docs/pr-assets/pr-10188/contents-renumber.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/f759fa462f22031fe84b1fb470b3cb7ab8b7ecc4/docs/pr-assets/pr-10188/contents-renumber.png`
- Shows: before = p.10 · after = p.10 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 481 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `a2d02810c3f` — PR #10188 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked
