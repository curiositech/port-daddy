# Visual Proof — PR #10222 (`claude/one-reader-map`)

Provenance manifest for the two-page reader's-map spread fix, per the
`agent-visual-evidence-manifest` skill, adapted for a static print artifact the
way `docs/pr-assets/pr-10175/MANIFEST.md` adapts it: this depicts a rendered
page of the Book, not a running daemon or UI, so the daemon/run/transcript
fields are honestly `n/a` rather than filled with placeholders.

## What these artifacts show

The reported bug: the book-level reader's-map figure (`figures/fig-book-reader-map.tex`),
introduced by this PR, squeezed all four Parts into one full-width figure and
relied on the front-matter overflow safety net to rescale it to fit. The
author's screenshot of the committed `coordination-papers-mega-volume.pdf`
showed Part III's header clipped mid-word ("What Survives the Resta[rt]")
with Part IV missing past the trim. The fix redraws the figure as a genuine
two-page spread — Parts I–II on one page, Parts III–IV on the next, split at
the book's own Part II / Part III seam — so neither half needs the rescale
hook at all. These two PNGs are that fix, at page scale.

## How they were made — read this before trusting the label

**These are not rasterisations of the officially committed
`coordination-papers-mega-volume.pdf`.** That file is exactly the artifact
under dispute (see above), and PR #10230 (separately, in this same session)
removes CI's habit of committing a freshly rendered copy of it onto every
whitepaper PR head — the committed blob in this PR's tree is stale/noise
that this PR's own follow-up commit drops once #10230 lands on `main`, not
a page anyone should still be rasterising.

Instead, this container **has a working LaTeX toolchain** (`xelatex`,
TeX Live 2023 — `tectonic` is not installed here) and these are real
`xelatex` compiles of the **exact, current, committed source**: the real
`coordination-papers-mega-volume-preamble.tex`, `coordination-papers-mega-volume-seams.tex`,
and the front matter of `coordination-papers-mega-volume.tex` verbatim through
`\input{figures/fig-book-reader-map}` and a few paragraphs past it, truncated
there with `\end{document}` rather than continuing into the eight generated
chapter bodies (which the front matter's pagination does not depend on — the
figure sits entirely before any chapter content). This is a real compile of
this PR's real change, not a mock-up or a hand-edited image; it is simply a
compile of the front matter alone rather than the full 552-page Book, because
the full Book was not rebuilt in this session (see the PR's own "what I could
not run" note).

Rasterised with PyMuPDF 1.28.2 at 150 dpi (scale 1.0×, i.e. what a phone PDF
viewer shows), matching `skills/harbor-chartwork/references/craft-rules.md`
§1.4 and the convention `docs/pr-assets/pr-10175/MANIFEST.md` already used for
this same Book. Full page, unscaled, unannotated — every pixel inside the
frame is xelatex's own output; the only thing added is this manifest.

Independently, `skills/harbor-chartwork/scripts/figcheck.py` was run against
the compiled PDF (both the original single-page design and this fix, same
harness) for a non-visual, geometry-based cross-check: the original's
rescaled annotations fail its T1 legibility-floor check (`digest-with-zoom,
consent` and `role vs. person` render at 5.83pt against a 7.00pt floor, 8
failures total); this fix's T1 count is 0. T4 (a drawn line intersecting the
"Part N" header text's bounding box) fires identically on both — 4
findings — because it is a pre-existing characteristic of the shared header
rule sitting directly above the header text in both designs, not a
regression, and visually (see the renders below) the rule sits cleanly above
the letterforms in both.

## Reproduce

```bash
cd website-v2/public/whitepaper
sed -n '1,210p' coordination-papers-mega-volume.tex > /tmp/zz-front.tex
echo '\end{document}' >> /tmp/zz-front.tex
cp /tmp/zz-front.tex zz-front.tex   # relative \input paths need this directory
xelatex -interaction=nonstopmode zz-front.tex
python3 -c "
import pymupdf
d = pymupdf.open('zz-front.pdf')
d[5].get_pixmap(dpi=150).save('page1.png')  # Parts I-II
d[6].get_pixmap(dpi=150).save('page2.png')  # Parts III-IV
"
```

## Artifact 1 — `https://media.portdaddy.dev/sha256/e2/e2de6c2a995130cf1cfa3dc1a6a9982a9f830b2ae9c22225eae71498367611a8.png`

Page one of the spread: Parts I–II (chapters 1–4), five archetype lanes, no
caption (see the figure's own header comment for why: a caption here would
consume a figure number the rest of the Book would then have to renumber
around).

- File: `https://media.portdaddy.dev/sha256/e2/e2de6c2a995130cf1cfa3dc1a6a9982a9f830b2ae9c22225eae71498367611a8.png`
- Shows: page 6 of a 7-page front-matter-only compile (this PR's committed source, truncated after the figure)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 1050×1500 px; 62 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `3db7c6ffa` — this PR's head at capture time, the commit under review
- Source: `real` — a real `xelatex` compile of the exact committed front-matter
  source and figure at that commit, rasterised with PyMuPDF; not the
  officially committed Book PDF (see "How they were made" above), not
  fixtured, not mocked

## Artifact 2 — `https://media.portdaddy.dev/sha256/ef/efdba3abbbd04846188e7c59da79278c00c49ddf5bf5d13cf720a27907fcc739.png`

Page two of the spread: Parts III–IV (chapters 5–8), row labels repeated,
carries the figure's caption and `\label{fig:book-reader-map}`.

- File: `https://media.portdaddy.dev/sha256/ef/efdba3abbbd04846188e7c59da79278c00c49ddf5bf5d13cf720a27907fcc739.png`
- Shows: page 7 of the same front-matter-only compile
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 1050×1500 px; 211 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `3db7c6ffa` — this PR's head at capture time, the commit under review
- Source: `real` — a real `xelatex` compile of the exact committed front-matter
  source and figure at that commit, rasterised with PyMuPDF; not the
  officially committed Book PDF, not fixtured, not mocked

## HONEST caveats

- These renders prove the figure fits its page and reads without truncation
  at page scale, in a real compile of this PR's real source. They do **not**
  prove the full 552-page Book still paginates identically elsewhere, or that
  the page numbers shown (roman `iii`/`iv` in the header) exactly match where
  the figure lands once all eight chapters are present — the front-matter
  page count does not depend on chapter content, but this was not verified
  against a full Book rebuild in this session.
- This book is a plain (oneside) `article`-class document, not
  `\documentclass[twoside]{book}`. "Page one" / "page two" here are two
  consecutive pages joined by `\clearpage`, not a binding-guaranteed
  left/right facing pair — see the figure's own header comment.
- A render proves what a page looks like. It does not prove the archetype
  routing itself is the right five categories, or the right split point —
  that is an editorial judgment call already made in this PR's design, not
  re-litigated here.
