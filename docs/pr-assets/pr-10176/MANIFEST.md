# Visual Proof — PR #10176 (`claude/book-fix-spawn-to-person`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Three before/after pairs from *From Spawn to Person*, at page scale. This PR
raises the chapter to the `textbook-craft` floors: a claim that was asserted now
carries a worked example the reader can check by hand, and the chapter gains the
apparatus (openers, boundaries, history) the standard asks for. The pairs show
the three places where that is most visible.

**Artifact 2 records a defect and its fix.** It was, in the first cut of this
manifest, a defect alone: the new `Recall` box collided with Figure 5.3 on Book
p.242. That collision has since been fixed in source, and artifact 2 now carries
three panes — the committed collision, and the two pages the fixed source
renders in its place. Read "How they were made" below before trusting it:
unlike artifacts 1 and 3, its right-hand panes are a **local** render, not a
rasterisation of a committed PDF, and the difference matters.

**Artifacts 1 and 3 were revised after review — read this before trusting the
first two paragraphs above.** A human reviewer correctly flagged that the
committed side-by-side pages for artifacts 1 and 3 "don't show anything
markedly different before and after." That was true, and the cause was not a
fake or reused render: Figure 5.10 (artifact 1) and Table 5.6 (artifact 3) are
genuinely byte-identical between the two commits, and each dominates its page.
The real diff in both cases is a paragraph of prose below the figure/table —
legible if you read the page closely, invisible at a PR-thumbnail glance next
to an unchanged diagram twice its size. That is failure mode "real but subtle
change shown at full-page scale" rather than a provenance problem: both
artifacts' `sourceLabel: real` claim and commit pins were accurate throughout;
the pixels were just the wrong crop to prove the point.

Both files have been replaced (same filenames, same underlying source
pixels — nothing was re-rendered from different PDFs) with a two-row
composite: the original full-page before/after pair, now with a red box drawn
around the changed region so a reader can find it on the real page, plus a
"detail" row that re-rasterises just that region straight from the same PDFs
at 340 dpi (vs. the page-scale renders' 150 dpi) so the added sentences are
readable without opening the image at native size. The detail row's "before"
panel carries a grey box at the same coordinates, showing there is nothing
there yet. No new PDF was built and no page was re-chosen; this is the same
`c92efaa5c` / `4396e3984` pair, same page numbers, cropped and boxed rather
than pasted whole. See each artifact's entry below for the exact PDF-point
rectangles used, enough to reproduce the crop from the same `before.pdf` /
`after.pdf` named in "Reproduce".

## How they were made

Artifacts 1 and 3, and artifact 2's before pane, are **not** a local LaTeX
rebuild. They are rasterisations of the two
`coordination-papers-mega-volume.pdf` blobs that already exist in this
repository's history:

| | commit | pages | producer |
|---|---|---|---|
| **before** | `c92efaa5c` — merge-base with `main` | 551 | `xdvipdfmx (20260317)` |
| **after** | `4396e3984` — this PR's head | 553 | `xdvipdfmx (20260317)` |

Both were produced by the project's own `scripts/build-whitepapers.sh`
toolchain (XeTeX → `xdvipdfmx`) and committed by the branch; the "after" one is
the byte-for-byte artifact this PR ships and the website serves. Rendering the
committed blobs rather than rebuilding is what makes the pair comparable — one
toolchain, one edition, two commits — and it is why **no PDF was regenerated
and none is committed here**. Only PNGs.

That holds for artifacts 1 and 3 without qualification, and for artifact 2's
**before** pane. Artifact 2's two **after** panes could not be made that way:
they show a fix made after the committed PDF was built, and the committed PDF at
this commit is still the pre-fix render — the `whitepaper-build` workflow
regenerates and commits it in its own pinned TeX Live container after this
commit lands. So those two panes are a local `xelatex` build of this branch's
source (XeTeX 3.141592653-2.6-0.999995, TeX Live 2023/Debian), rasterised the
same way at the same dpi. They are a picture of the *source* this PR ships, not
of the *PDF* it ships, and they are labelled so in the image itself.

The consequence to keep in mind: that engine paginates the Book at 551 pages
where the published container's does 553, so the after panes' page numbers
(p.240, p.241) are the local engine's, and the published edition will put the
same material within a page or two of them. What does not move with pagination
is the thing under review — whether the Recall block can reach the figure at
all — and that was checked mechanically rather than by eye. See "What was
measured" below.

Rasterised with PyMuPDF 1.28.2 at **150 dpi, scale 1.0×** — page scale, what
a phone PDF viewer shows, per
`skills/harbor-chartwork/references/craft-rules.md` §1.4 ("Test the figure as a
150 dpi PNG at 1.0×"). Every page — half or pane — is pasted **unscaled and
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
| after-pages with a **real** text change | **53** |
| after-pages that changed **only** in reference numbers | 85 |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 553 |

The 85 renumber-only pages are reflow: inserting a worked example
shifts the numbering of everything after it, and every cross-reference follows.
They are not shown, because a page whose only change is `4.6` becoming `4.7` is
not worth a picture. The three pairs below are chosen from the 53 pages
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
  `spawn-to-person-whitepaper.pdf`, which is not shown here; the chapter text is the
  same, its pagination is not.
- **This PR introduced a margin collision on Book p.242, and it is now fixed**
  (artifact 2). It was the only one of the nine Book-chapter PRs in this batch
  that added a prose-on-prose overprint anywhere in the Book. The committed
  `coordination-papers-mega-volume.pdf` at this commit still contains it — it
  is the render the collision was measured on, and it is the artifact 2 before
  pane — because the PDF is rebuilt by CI, one commit behind its own source.
  Trust the source, and the mechanical check below, for what is fixed; trust
  the committed PDF only for what was broken.
- A render proves what a page looks like. It does not prove the prose is right.

## What was measured

Prose-on-prose overprinting is checked mechanically, not by eye: every word box
on a page is compared against every other, and a pair that intersects while
sitting on different text lines is an overprint. The extractor reports a small
constant background of such pairs from math accents and stacked fractions
(`turn`/`Í`, `1`/`2;`); those are the same on every build and are not collisions.

| | overprints |
|---|---|
| committed Book PDF, p.242 (the defect) | **6** |
| fixed source, local render, the pages carrying the same material | **0** |

Because the collision is a function of where the page happens to break, the
fixed source was also built at three page breaks forced onto the relevant spot
(the figure driven to a page top; a break forced immediately before the Recall
block; a break forced immediately before the worked example). In all three the
figure and the Recall block land on different pages and the count stays at
0. The pre-fix source at the first of those three reproduces the committed
defect word for word, which is what makes the comparison a comparison.

## Reproduce

```bash
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show 4396e3984:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[277-1].get_pixmap(dpi=150).save('p277.png')"
```

Artifacts 1 and 3's detail rows re-rasterise a sub-rectangle of the same pages
straight from the vector PDF, rather than upscaling a raster crop:

```python
import pymupdf
after = pymupdf.open("after.pdf")
# Artifact 1, "Now you try" box, page index 276 (Book p.277):
rect = pymupdf.Rect(57.6, 614.5, 381.6, 637.6)
after[276].get_pixmap(matrix=pymupdf.Matrix(340/72, 340/72), clip=rect).save("detail.png")
```

Artifact 2's after panes come from a build instead of a blob:

```bash
node scripts/generate-mega-whitepaper.mjs .cache/whitepaper-build/coordination-papers-mega-volume
cd website-v2/public/whitepaper
latexmk -xelatex -interaction=nonstopmode -outdir=/tmp/book coordination-papers-mega-volume.tex
```

---

## Artifact 1 — `worked-example-retraction.png`

1 / A retraction, followed through the protocol

- File: `docs/pr-assets/pr-10176/worked-example-retraction.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/HEAD/docs/pr-assets/pr-10176/worked-example-retraction.png`
- Shows: before = p.277 · after = p.277 (the committed Book PDF). **Revised**:
  Figure 5.10 is byte-identical on both sides (as it should be — nothing about
  the figure changed), so the top row shows the full page with a red box around
  the paragraph that did change, and the bottom row re-rasterises exactly that
  box from the same two PDFs at 340 dpi so the new sentences are legible
  in-place. Two spans changed, both boxed: an italic lead-in clause at PDF
  points (57.6, 401.1)–(295.3, 411.6), and a three-line "Now you try" exercise
  at (57.6, 614.5)–(381.6, 637.6) — both taken from `after.pdf` page index 276
  (0-based); the same rectangles are boxed in grey on `before.pdf`'s page 276
  to show they're empty there.
- Render: full-page rows at 150 dpi (unchanged from the original artifact);
  detail rows re-rasterised at 340 dpi via `page.get_pixmap(clip=rect)` on the
  same `before.pdf`/`after.pdf`, scale 1.0× at capture, PyMuPDF 1.28.2;
  3166×2457 px; 1110 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `4396e3984` — PR #10176 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — every pixel (full-page rows and detail-crop rows alike) is
  rasterised from the `coordination-papers-mega-volume.pdf` committed at those
  two commits; not rebuilt, not fixtured, not mocked. The only added ink is the
  red/grey boxes and the caption text, exactly as in the original artifact's
  "only ink added is the caption band" convention.

## Artifact 2 — `recall-box.png`

2 / The Recall box no longer meets Figure 5.3 — the regression this PR introduced, fixed

- File: `docs/pr-assets/pr-10176/recall-box.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/HEAD/docs/pr-assets/pr-10176/recall-box.png`
- Shows: three panes — before = p.242 of the committed Book PDF (the defect) ·
  after = p.240 and p.241 of a local `xelatex` render of the fixed source
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 3250×1658 px; 1114 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: the branch head that carries the fix. The `before` pane is the
  `coordination-papers-mega-volume.pdf` committed on this branch before it —
  the pre-fix render, which is what "before" means here.
- Source: `real` for the before pane — rasterised from the committed PDF, not
  rebuilt, not fixtured, not mocked. `real (local render)` for the two after
  panes — real source, really compiled, but by this environment's XeTeX and not
  by the container that builds the published PDF. See "How they were made".
- Note on the defect, kept on the record: five words in the `Recall` margin box
  physically overprinted five words of Figure 5.3's third panel — 'episode'
  under 'RECALL', 'weight' under 'Without', 'crime:' under 'what', and
  'operations' under both 'between' and 'connectedness'. The cause was not the
  box's styling but its source position. Figure 5.3 is wider than the measure,
  so the Book's overflow net sets it over the column *and* the outer margin,
  where its third panel's note reaches about 30pt into the margin column; the
  Recall block is a margin device that is raised so its last line sits on the
  line issuing it, and it was issued directly under that figure, so the raise
  took it straight up into the panel. `\pd@placemargin`'s occupancy caps could
  not have caught it — they track margin heads and earlier margin blocks, and a
  float that overruns its measure is neither. The fix draws the figure before
  the worked example instead of after it, which leaves a block of prose taller
  than the Recall block between the float and the block's anchor, so no page
  break can bring them into contact.

## Artifact 3 — `claim-kinds-labelled.png`

3 / Claim kinds labelled, and kept distinct from maturity

- File: `docs/pr-assets/pr-10176/claim-kinds-labelled.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/HEAD/docs/pr-assets/pr-10176/claim-kinds-labelled.png`
- Shows: before = p.260 · after = p.260 (the committed Book PDF). **Revised**:
  Table 5.6 is byte-identical on both sides, and both added clauses sit inside
  otherwise-unchanged paragraphs above it, so the top row shows the full page
  with two red boxes (regions A and B) around the paragraphs that changed, and
  two detail rows below re-rasterise those boxes from the same two PDFs at 340
  dpi. Region A (end of the "single-operator layers" paragraph) is PDF points
  (57.6, 102.2)–(383.3, 137.8); region B (end of the Definition 5.7.2
  paragraph) is (57.3, 234.2)–(383.3, 282.4) — both on `after.pdf` page index
  259 (0-based), with the identical rectangles boxed in grey on `before.pdf`'s
  page 259 to show the "Kind: SPECIFIED" clauses aren't there yet.
- Render: full-page rows at 150 dpi (unchanged from the original artifact);
  detail rows re-rasterised at 340 dpi via `page.get_pixmap(clip=rect)` on the
  same `before.pdf`/`after.pdf`, scale 1.0× at capture, PyMuPDF 1.28.2;
  3166×1875 px; 948 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `4396e3984` — PR #10176 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — every pixel (full-page rows and detail-crop rows alike) is
  rasterised from the `coordination-papers-mega-volume.pdf` committed at those
  two commits; not rebuilt, not fixtured, not mocked. The only added ink is the
  red/grey boxes and the caption text, exactly as in the original artifact's
  "only ink added is the caption band" convention.
