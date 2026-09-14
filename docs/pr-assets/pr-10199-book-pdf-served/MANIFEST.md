# Visual Proof — `claude/r2-blob-storage`

Provenance for the Book-PDF artifacts. Both images are rendered from the **real
`coordination-papers-mega-volume.pdf` committed in this repository** —
`sourceLabel: real`. No fixture, no mock, no retouching.

## Why this PR needs visual proof

`VISUAL_SURFACE_RE` in `scripts/lib/user-visible-surfaces.mjs` matches anything
under `website-v2/`, and this diff edits `website-v2/scripts/prune-pages-assets.mjs`
and `website-v2/src/data/whitePapers.test.ts`. The `visual-exempt` marker this PR
used to carry is not available for that path prefix, so it has been removed.

## What is honestly shown, and what is not

The PR's one user-visible effect is that a URL stops returning the SPA shell and
starts returning a 551-page PDF. Two halves, and they are not equally showable
from this environment:

- **The document itself is showable, and is shown.** Both artifacts are real pages
  of the real committed PDF — the document the deploy has been deleting.
- **The served page is not.** There is no browser, headless or otherwise, in the
  environment these artifacts were produced in, so the HTML page a visitor
  currently receives at that URL was not captured as a screenshot. The evidence
  for that half is byte-level and lives in the PR's Test Plan: the response is
  `text/html`, 199,434 bytes, and `cmp`-identical to the response for a path that
  does not exist. No screenshot of it is claimed to exist.

## Provenance

| field | value |
| --- | --- |
| branch head | `2288fd7f671e11b2fb3d84a8deb428c2ef35d7eb` |
| source PDF | `website-v2/public/whitepaper/coordination-papers-mega-volume.pdf`, read with `git show <rev>:<path>` |
| PDF size | **9,740,631 bytes** (9.29 MiB), **551 pages** — measured, not quoted |
| render | PyMuPDF 1.28.2, `Matrix(150/72, 150/72)`, `alpha=False` |
| render standard | **150 dpi, 1.0× page scale** — the project's page-scale standard |
| composite scale | still 0.55×, GIF frames 0.50× — file size only |
| sourceLabel | `real` |

Book trim 504×720 pt → **1050×1500 px** at 150 dpi, which is the arithmetic of the
stated standard and the check that no page was rescaled before compositing.

## Artifacts

| file | shows |
| --- | --- |
| `book-pdf-title-and-abstract.png` | p1 (title page) beside p4 (abstract) of the committed PDF, with a footer carrying the measured size and its ratio to Cloudflare's per-asset limit. |
| `book-pdf-page-tour.gif` | 525×773, 6 frames, 1.5 s each: pp. 1, 4, 12, 260, 310, 362 of the same PDF. A tour of the document that a visitor following the Book's own download link has not been able to open. |

## The numbers on the still, and where each came from

- `9,740,631 bytes` — `git cat-file -s` on the committed blob at the branch head.
- `551 pages` — read back from the PDF with PyMuPDF.
- `26,214,400 bytes` — Cloudflare Pages' documented per-asset limit, the constant
  the guard in `prune-pages-assets.mjs` enforces.
- `37%` — 9,740,631 / 26,214,400 = 0.3716.

## How to reproduce

```
git show 2288fd7f6:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > book.pdf
```

then render pages 1, 4, 12, 260, 310 and 362 with PyMuPDF at `Matrix(150/72, 150/72)`.
