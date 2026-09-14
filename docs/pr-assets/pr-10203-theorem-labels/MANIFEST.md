# Visual Proof — `claude/fix-duplicate-theorem-labels`

Provenance for the theorem-label rename artifacts. Every image is a **real page
of a real PDF committed in this repository** — `sourceLabel: real`. No fixture,
no mock, no retouching.

## Why this PR needs visual proof

`scripts/lib/user-visible-surfaces.mjs` classifies anything under `website-v2/`
as a visual surface (`VISUAL_SURFACE_RE`), and this diff edits three files under
`website-v2/public/whitepaper/` along with four rebuilt PDFs. `visual-exempt` is
ruled out for a whitepaper surface, so the proof is the printed pages.

The claim under test is unusual: **the rename should change nothing on the page.**
A `\label`/`\ref` rename alters a cross-reference key, not the number that gets
printed, so the correct visual result is no visible difference at all. That is a
falsifiable claim, and it is what these artifacts check.

## Provenance

| field | value |
| --- | --- |
| branch head | `93b9cf2f3bd784ce2810b64d17e6ce1127eb144a` |
| baseline | merge-base `c92efaa5cf5557c2ab23c862af24333adf0dd8f4` |
| PDFs compared | the four committed PDFs in the diff, read with `git show <rev>:<path>` |
| render | PyMuPDF 1.28.2, `Matrix(150/72, 150/72)`, `alpha=False` |
| render standard | **150 dpi, 1.0× page scale** — the project's page-scale standard |
| sweep render | 110 dpi for the all-pages sweep, 150 dpi for the committed stills |
| composite scale | stills 0.55×, GIF frames 0.52× — file size only; the renders above are the record |
| sourceLabel | `real` |

Book trim 504×720 pt → **1050×1500 px** at 150 dpi, which is the arithmetic of
the stated standard and the check that nothing was rescaled before compositing.

## The measurement

Every page of all four PDFs in the diff was rendered on both sides and compared
as raw pixel samples:

| PDF | pages | pages differing in pixels |
| --- | --- | --- |
| `coordination-papers-mega-volume.pdf` | 551 | **0** |
| `agent-transactions-whitepaper.pdf` | 60 | **0** |
| `spawn-to-person-whitepaper.pdf` | 53 | **0** |
| `harbor-economy-whitepaper.pdf` | 48 | **0** |
| **total** | **712** | **0** |

The three committed stills were re-compared at 150 dpi individually and are
pixel-identical there too.

Text sweep for `??` — the string LaTeX prints for an undefined `\ref` — over the
whole Book: **no page on either side contains it.** The four renamed labels are
cited on Book pages 260, 261, 279, 280 (Def. 5.7.2), 310 (Def. 6.6.2) and 362
(Def. 7.7.1), and every citation still prints a real number.

## Artifacts

| file | shows |
| --- | --- |
| `book-p260-def-cross-operator-attestation.png` | Book p260, before \| after. `Definition 5.7.2 (Cross-operator attestation)` — `def:0040b` → `def:cross-operator-attestation`, from `spawn-to-person.tex`. |
| `book-p310-def-cross-operator-attestation-problem.png` | Book p310, before \| after. `Definition 6.6.2 (The cross-operator attestation problem)` — `def:0040b` → `def:cross-operator-attestation-problem`, from `harbor-economy.tex`. |
| `book-p362-def-bonded-float-plan.png` | Book p362, before \| after. `Definition 7.7.1 (Float Plan)` — `def:float-plan` → `def:bonded-float-plan`, from `agent-transactions-whitepaper.tex`. |
| `label-rename-no-ink-moved.gif` | 546×803, 6 frames, 1.6 s each: the three pages above as before→after flips. A flip that does not flicker is the result. |

Each still carries a band naming the ref and page it came from, and a footer
stating the definition, the rename and the 150 dpi verdict.

## How to reproduce

```
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > base.pdf
git show 93b9cf2f3:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > head.pdf
```

then render each page of both with PyMuPDF at `Matrix(150/72, 150/72)` and
compare `pixmap.samples`. Repeat for the other three PDFs named in the table.
