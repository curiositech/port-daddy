# Visual proof — `claude/one-margin-system`

`sourceLabel: real`. Every image below is a page of a real PDF built from source
in this repository. No fixture, no mock, no retouching, no rescaling after the
fact.

## Reproduction

```bash
git checkout claude/one-margin-system
scripts/build-whitepapers.sh coordination-papers-mega-volume
python3 - <<'PY'
import pymupdf
d = pymupdf.open('website-v2/public/whitepaper/coordination-papers-mega-volume.pdf')
for idx in (32, 60, 64, 169, 181):
    d[idx].get_pixmap(matrix=pymupdf.Matrix(150/72, 150/72)).save(f'p{idx}.png')
PY
```

Rendered with PyMuPDF at `Matrix(150/72, 150/72)` — the project's 150 dpi, 1.0×
page-scale standard. The Book's 504×720 pt trim gives **1050×1500 px**, which is
the arithmetic of that standard and the check that nothing was rescaled.

## Build receipt

| | |
|---|---|
| Book | `website-v2/public/whitepaper/coordination-papers-mega-volume.pdf` |
| Pages | 543 |
| TeX errors (`^!` in the log) | 0 |
| `Marginpar on page` warnings | 0 |
| sha256 | `411993aae77dbdd5a171ccd69f05ad66274642dba246e50753652f389312dd18` |

The sha256 above is reproducible only at the same HEAD **and the same worktree
path**: `paper_epoch()` derives `SOURCE_DATE_EPOCH` from `git log HEAD -- <transitive
sources>`, and `BUILD_DIR` is `$REPO_ROOT/.cache/whitepaper-build`, which pdfTeX
writes into the trailer `/ID`. Both were held fixed for the before/after control.

## Images

| File | PDF page (0-based) | Book folio | Demonstrates |
|---|---:|---:|---|
| `one-margin-system-pdsession-marginhead-p018.png` | 32 | 18 | `pdsession` — the transcript rule spans `\linewidth+\marginparsep+\marginparwidth`; `\pd@marginhead` — `PITFALL`, `AT THE TERMINAL` |
| `one-margin-system-pdmargincaption-p046.png` | 60 | 46 | `\pdmargincaption` — Table 1.8's caption in the margin column; `\pd@marginglyph` — the worked-example square |
| `one-margin-system-capfits-fallback-p050.png` | 64 | 50 | `\ifpd@capfits` **fires** — Table 1.9's caption measured too tall for the column and set at full measure in the text column instead; margin empty |
| `one-margin-system-pdsidenote-p155.png` | 169 | 155 | `\pdsidenote` — superscript 2 in the line, the note beside it in the margin rather than at the foot of the page |
| `one-margin-system-pdgloss-p167.png` | 181 | 167 | `\pdgloss` — **Read-poverty** bold at its definition, the definition carried in the margin; also `pdrecitation`'s Recall block and a `\pdexercisepointer` |
| `one-margin-system-margin-tour.gif` | — | — | Motion artifact: the five pages above in sequence, margin column tinted, 2.0–2.6 s a frame, looping. Built from the same 150 dpi stills with PIL and downscaled to 620 px wide purely to keep the file small; the PNGs are the full-resolution record. |

## Why the motion artifact is a tour and not an A/B flip

This branch changes no rendered page — the Book is byte-identical before and
after (see the build receipt above). An A/B flip would therefore be two
identical frames presented as a comparison, which would be a dishonest image.
The tour instead shows what the apparatus renders unconditionally, and puts
p.46 next to p.50 so the one real distinction in this branch — a caption that
fits the column against one that does not — reads as motion.

## How the fallback pages were found

The `\ifpd@capfits` `\else` branches in `figures/pd-pedagogy.tex` were temporarily
instrumented with `\typeout{PDFIT-CAPTION-FELLBACK page=\thepage text=#1}` and
`\typeout{PDFIT-SIDENOTE-FELLBACK ...}`, the Book was built, and the log was
counted. **The fallback fires 15 times in the 543-page Book: 13 captions and 2
sidenotes**, reported at `\thepage` 6, 30, 41, 49, 92, 144, 175, 186, 200, 214,
337, 353, 356 (captions) and 282, 401 (sidenotes). Those numbers can lag the
printed folio by one: `\thepage` is read inside the float box, where the page
builder has not yet run — the file's own comments record the same staleness. The
caption reported at 49 is the one printed on folio 50 and shown above. The
instrumentation was reverted before
the build these images come from; the log for that build contains zero `PDFIT`
lines, and the two `pd-pedagogy.tex` twins are byte-identical (`cmp` exit 0).
