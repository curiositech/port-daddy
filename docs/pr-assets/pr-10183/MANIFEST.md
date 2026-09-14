# Visual Proof — PR #10183 (`claude/book-fix-legible-swarm`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Three before/after pairs from *The Legible Swarm*, at page scale. This PR
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
| **after** | `6adb413da` — this PR's head | 555 | `xdvipdfmx (20260317)` |

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
| after-pages with a **real** text change | **47** |
| after-pages that changed **only** in reference numbers | 131 |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 555 |

The 131 renumber-only pages are reflow: inserting a worked example
shifts the numbering of everything after it, and every cross-reference follows.
They are not shown, because a page whose only change is `4.6` becoming `4.7` is
not worth a picture. The three pairs below are chosen from the 47 pages
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
  `legible-swarm-whitepaper.pdf`, which is not shown here; the chapter text is the
  same, its pagination is not.
- A render proves what a page looks like. It does not prove the prose is right.

## Reproduce

```bash
git show c92efaa5c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show 6adb413da:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[169-1].get_pixmap(dpi=150).save('p169.png')"
```

---

## Artifact 1 — `worked-example-two-rows.png`

1 / The legibility rule, given a worked example a reader can check

- File: `docs/pr-assets/pr-10183/worked-example-two-rows.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/56e442630506712337ec199c6f0924eafc2a1484/docs/pr-assets/pr-10183/worked-example-two-rows.png`
- Shows: before = p.167 · after = p.169 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 799 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `6adb413da` — PR #10183 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 2 — `fail-loud-and-escalation.png`

2 / An invariant tied to its twin, and the queue's spoofable surface named

- File: `docs/pr-assets/pr-10183/fail-loud-and-escalation.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/56e442630506712337ec199c6f0924eafc2a1484/docs/pr-assets/pr-10183/fail-loud-and-escalation.png`
- Shows: before = p.202 · after = p.206 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 754 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `6adb413da` — PR #10183 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 3 — `opening-scenario.png`

3 / The opening problem, told as a numbered scenario

- File: `docs/pr-assets/pr-10183/opening-scenario.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/56e442630506712337ec199c6f0924eafc2a1484/docs/pr-assets/pr-10183/opening-scenario.png`
- Shows: before = p.160 · after = p.162 (the committed Book PDF)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 804 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `6adb413da` — PR #10183 head, the commit under review. The `before`
  half is necessarily an earlier commit (c92efaa5c1 (main at the merge-base)), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked
