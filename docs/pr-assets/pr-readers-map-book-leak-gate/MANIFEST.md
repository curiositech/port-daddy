# Visual Proof — `claude/generator-readers-map-gate`

Provenance manifest for the Reader's-Map Book-leak artifacts, per the
`agent-visual-evidence-manifest` skill. Every artifact is a **real page of a real
PDF built from source in this repository** — `sourceLabel: real`. Nothing here is
a fixture, a mock, or a hand-edited image.

## Why this PR needs visual proof at all

The diff touches `website-v2/public/whitepaper/harbor-economy.tex`, and
`scripts/lib/user-visible-surfaces.mjs` classifies anything under `website-v2/`
as a visual surface (`VISUAL_SURFACE_RE`). `scripts/check-pr-requirements.mjs`
therefore requires a screenshot **and** a motion artifact. A `visual-exempt`
marker would be dishonest here — the change really does remove printed pages
from a published PDF — so the proof is the pages themselves.

## Provenance

| field | value |
| --- | --- |
| commit (code under review) | `7c5755e8ce0c0f55cfeb7460856b3f2317b8c497` |
| baseline compared against | `origin/main` @ `c92efaa5c` |
| builder | `scripts/build-whitepapers.sh coordination-papers-mega-volume` / `harbor-economy` |
| engine | XeTeX 3.141592653-2.6-0.999995 (TeX Live 2023/Debian), via `latexmk -xelatex` |
| render | PyMuPDF 1.28.2, `Matrix(150/72, 150/72)`, `alpha=False` |
| render standard | **150 dpi, 1.0× page scale** — what a phone PDF viewer shows |
| sourceLabel | `real` (built from source; no fixture, no mock, no retouching) |

Book trim is 504×720 pt → **1050×1500 px** at 150 dpi. The standalone paper is
A4 → **1241×1754 px**. Those dimensions are the arithmetic of the stated render
standard and are the check that no artifact was rescaled after the fact.

## Page counts

| build | pages |
| --- | --- |
| Book @ `origin/main` | **549** |
| Book @ `7c5755e8c` | **547** |

**−2 pages, one per repaired chapter.** Both the Single-Writer Kernel's and the
Harbor Economy's maps were leaking; the branch stars both, so two pages stop
being printed. (A single-chapter fix would have been −1.)

## Artifacts

### The leak, and its removal — Harbor Economy

| file | shows |
| --- | --- |
| `book-before-economy-readers-map-printed-p291.png` | Book @ main, PDF p291 / **book page 276**. The chapter abstract, then **`6.1 Reader's map`** — a *numbered* section, printed inside the Book. |
| `book-after-economy-readers-map-gone-p290.png` | Book @ branch, PDF p290 / **book page 275**. Byte-for-byte the same page down to the maturity-key box, then **`6.1 The thesis: a market, not a payment rail`**. The map is gone and §6.1 is reclaimed. |
| `book-before-economy-readers-map-table-p292.png` | Book @ main, PDF p292 / book page 277. The routing table itself — `Table 6.1: Where to enter, by who you are`, five reader types — the page the front matter promised would not be there. |

The first pair is the same slot in the chapter, which is why it is the primary
evidence: only the heading differs.

### The leak, and its removal — Single-Writer Kernel

| file | shows |
| --- | --- |
| `book-before-kernel-readers-map-printed-p023.png` | Book @ main, PDF p23 / book page 8. `Table 1.2: Reader's Map. Find your row; read those sections first.` |
| `book-after-kernel-readers-map-gone-p022.png` | Book @ branch, PDF p22 / book page 7. The same slot, now carrying `Table 1.1` (the maturity scale) — the following body has flowed up into the reclaimed page. |

### The thing that could silently regress — standalone paper

`\section*` alone would drop the map out of the standalone paper's Contents.
`\addcontentsline` is what prevents that, and these two are its proof:

| file | shows |
| --- | --- |
| `standalone-economy-readers-map-kept-p005.png` | `harbor-economy-whitepaper.pdf` @ branch, p5. The map is **still printed**, now as an unnumbered `Reader's map`, with its full routing table. |
| `standalone-economy-contents-lists-map-p003.png` | Same PDF, p3. The Contents **still lists** `Reader's map … 5`, unnumbered, above `1 The thesis…`. This is the `\addcontentsline`. |

The standalone paper is **48 pages before and after**. Nothing was lost from it.

### Motion artifact

`readers-map-book-leak-before-after.gif` — 760×1086, 4 frames, 1.6 s each,
looping: economy before → economy after → kernel before → kernel after. Down-
scaled from the 150 dpi PNGs above purely to keep the file small; the PNGs are
the full-resolution record.

## How to reproduce

```
git worktree add <wt-main>   origin/main
git worktree add <wt-branch> claude/generator-readers-map-gate
( cd <wt>; scripts/build-whitepapers.sh coordination-papers-mega-volume )
( cd <wt-branch>; scripts/build-whitepapers.sh harbor-economy )
```

then render any page with PyMuPDF at `Matrix(150/72, 150/72)`. The build pins
`SOURCE_DATE_EPOCH` per paper, so the same source tree renders identically on the
same TeX Live.
