# Visual Proof — PR #10192 (`claude/apply-manuscript-critique`)

Provenance manifest for the page-scale Book renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Seven artifacts, in two groups.

**Artifacts 1-4 are rendering defects this branch found and fixed.** Three are
the ones this PR's Test Plan claims and nobody had seen; the fourth is the
margin-plate overrun the tip commit fixes. None could be shown from committed
artifacts: every one was introduced *and* fixed inside this branch, so no
committed PDF ever contained it. Each is a pair of `tectonic` builds of this
branch's own source that differ by exactly one thing.

**Artifacts 5-7 are the substantive chapter changes**, rendered from the two
committed Book PDFs -- the merge-base and this PR's head.

## How they were made

Two methods, because the two groups of artifact ask different questions.

**Artifacts 5-7 (what the PR delivers).** Rasterisations of the two
`coordination-papers-mega-volume.pdf` blobs already in this repository:

| | commit | pages | producer |
|---|---|---|---|
| **before** | `2f2969af9` — merge-base with `claude/manuscript-review-ledger` (#10185), **not** `main` | 551 | `xdvipdfmx (20260317)` |
| **after** | `f3b8cb47c` — this PR's head | 564 | `xdvipdfmx (20260317)` |

Both come from the project's own `scripts/build-whitepapers.sh` toolchain
(XeTeX -> `xdvipdfmx`). **No PDF was regenerated and none is committed here** --
only PNGs.

**Artifacts 1-4 (the defects).** These *required* a rebuild, and the
rebuild is declared. `tectonic` 0.15.0 was run twice against this branch's head
source from `website-v2/public/whitepaper/`, after
`node scripts/generate-mega-whitepaper.mjs`:

- the **AFTER** build is the head source unmodified;
- the **BEFORE** build is the head source with exactly three one-line fixes
  reverted (the `split` in Eq. 4.4, the `tabularx` column spec of Table A.11,
  and `\\pdchapref{fh}` back to `\\pdchapref{federated}`).

Same engine, same source tree, one variable at a time. The tectonic build
independently reproduces this PR's Test Plan numbers: **562 pages, 9.42 MiB,
zero undefined references, worst remaining overfull 30.25 pt** -- and the
reverted build reproduces the defects, at **162.5 pt** overfull and one
`Hyper reference 'chap:federated' ... undefined` warning.

Tectonic is used here **only to look at pages**. Its pagination differs from the
official toolchain (562 pages against the committed 564), which is exactly why
artifacts 4-6 do not use it, and why no tectonic PDF is committed.

**The committed Book PDF on this branch is one commit stale, by design.** Blob
`08f18f7b0` is byte-identical at `eec37eb96` and at the tip `9e47633b0`: the tip
commit changes two margin anchors in ch. 4 and deliberately does **not** rebuild
the PDF, because substituting a local render for CI's is the drift
`whitepaper-build.yml` exists to undo. So artifacts 5-7 show the Book as CI last
rendered it, and artifact 4 is the only view of what the tip commit changes.

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
| after-pages with a **real** text change | **116** |
| after-pages that changed **only** in reference numbers | 249 |
| pages with identical text but moved pixels | 0 |
| page count | 551 -> 564 |

116 changed pages is too many to ship, and a contact sheet of 116 thumbnails
would be unreadable at page scale. Artifacts 4-6 are the three chapter changes
the PR body itself leads with -- the withdrawn section title in ch. 2, the
monitoring boundary in ch. 7, and the stake objection in ch. 5.

Artifact 4 was found by a different route: scanning every page of both builds
for text blocks whose bounding box leaves the 504x720 pt paper.

## HONEST caveats — read before trusting the label

- **`sourceLabel: real`** means these pixels come from the real artifact at the
  real commits named. It does **not** mean anyone has certified the typography
  correct — it means the picture is of the true artifact, not a mock-up.
- **Artifacts 1-4 are not the shipped artifact.** They are tectonic
  builds, declared as such above. They show that the three fixes do what the
  Test Plan says; they do not show the bytes the website serves.
- **Artifact 3's defect is nearly invisible at page scale, and that is the
  finding.** The two pages differ on 1,153 of 2.3 million pixels: four words.
  "The Federated Harbor" sets in body black (#000000) when the key is undefined
  and in the house link colour (#403A34) when it resolves, and only the fixed
  page carries the link annotation to the chapter opener. A page render is the
  wrong instrument for this defect; the log warning that caught it was the right
  one.
- This PR is **stacked on `claude/manuscript-review-ledger` (#10185)**. "Before"
  therefore means that branch's tip, not `main`.
- A render proves what a page looks like. It does not prove the prose is right.

## Reproduce

```bash
git show 2f2969af9:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > before.pdf
git show f3b8cb47c:website-v2/public/whitepaper/coordination-papers-mega-volume.pdf > after.pdf
python3 -c "import pymupdf; pymupdf.open('after.pdf')[195-1].get_pixmap(dpi=150).save('p195.png')"
```

---

## Artifact 1 — `defect-1-equation-over-measure.png`

Defect 1 / Eq. 4.4 ran off the measure

- File: `docs/pr-assets/pr-10192/defect-1-equation-over-measure.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/defect-1-equation-over-measure.png`
- Shows: before = p.195 · after = p.195 (a tectonic 0.15.0 build of this branch's head source, with the fix reverted on the BEFORE half only)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 606 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — `real` in the sense that matters here: both halves are real renders of real source. They are **not** the committed artifact -- tectonic paginates differently from the official toolchain -- and the BEFORE half is this branch's head source with exactly one fix reverted, because the defect was introduced and fixed inside this branch and no committed PDF ever contained it. Same engine on both sides, so the pair is comparable
- Note: Both halves are tectonic 0.15.0 builds of the SAME head source, differing only by reverting the split in whitepaper/legible-swarm.tex. Same engine on both sides, so the pair is comparable; neither half is the committed artifact.

## Artifact 2 — `defect-2-ownership-table-columns.png`

Defect 2 / Table A.11 gave its narrowest content the widest column

- File: `docs/pr-assets/pr-10192/defect-2-ownership-table-columns.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/defect-2-ownership-table-columns.png`
- Shows: before = p.536 · after = p.536 (a tectonic 0.15.0 build of this branch's head source, with the fix reverted on the BEFORE half only)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 364 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — `real` in the sense that matters here: both halves are real renders of real source. They are **not** the committed artifact -- tectonic paginates differently from the official toolchain -- and the BEFORE half is this branch's head source with exactly one fix reverted, because the defect was introduced and fixed inside this branch and no committed PDF ever contained it. Same engine on both sides, so the pair is comparable
- Note: Reverting one tabularx column spec in coordination-papers-mega-volume-appendices.tex is the only difference between these two builds.

## Artifact 3 — `defect-3-chapref-dead-link.png`

Defect 3 / A chapter reference that renders but does not link

- File: `docs/pr-assets/pr-10192/defect-3-chapref-dead-link.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/defect-3-chapref-dead-link.png`
- Shows: before = p.374 · after = p.374 (a tectonic 0.15.0 build of this branch's head source, with the fix reverted on the BEFORE half only)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1728 px; 484 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — `real` in the sense that matters here: both halves are real renders of real source. They are **not** the committed artifact -- tectonic paginates differently from the official toolchain -- and the BEFORE half is this branch's head source with exactly one fix reverted, because the defect was introduced and fixed inside this branch and no committed PDF ever contained it. Same engine on both sides, so the pair is comparable
- Note: This defect is very nearly invisible: the ink differs on four words only (1,153 of 2.3M pixels). 'The Federated Harbor' sets in body black #000000 before and in the house link colour #403A34 after, and only the AFTER page carries the link annotation to the chapter opener.

## Artifact 4 — `defect-4-margin-plate-off-paper.png`

Defect 4 / a margin plate the trimmer would have cut

- File: `docs/pr-assets/pr-10192/defect-4-margin-plate-off-paper.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/defect-4-margin-plate-off-paper.png`
- Shows: before = p.192 · after = p.193 (tectonic builds of this branch at two of its own commits)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 926 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — `real` in the sense that matters here: both halves are real renders of real source. They are **not** the committed artifact -- tectonic paginates differently from the official toolchain -- and the BEFORE half is this branch's head source with exactly one fix reverted, because the defect was introduced and fixed inside this branch and no committed PDF ever contained it. Same engine on both sides, so the pair is comparable
- Note: Measured, not asserted: scanning every page for text blocks whose bbox leaves the 504x720 pt paper, the eec37eb96 build has 1 (this one, 2.0 pt past the bottom) and the 9e47633b0 build has 0. The commit that fixed it reports 1.4 pt for Leviathan and 11.7 pt for Shannon on CI's xelatex render; tectonic paginates differently, so the amount differs while the defect and its removal do not.

## Artifact 5 — `ch2-withdrawn-section-title.png`

Chapter 2 / a section title withdrawn rather than hedged

- File: `docs/pr-assets/pr-10192/ch2-withdrawn-section-title.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/ch2-withdrawn-section-title.png`
- Shows: before = p.107 · after = p.110 (the committed Book PDF (blob 08f18f7b0, identical at eec37eb96 and at the tip))
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 624 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 6 — `ch7-perfect-public-monitoring.png`

Chapter 7 / the assumption that was being made silently

- File: `docs/pr-assets/pr-10192/ch7-perfect-public-monitoring.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/ch7-perfect-public-monitoring.png`
- Shows: before = p.366 · after = p.374 (the committed Book PDF (blob 08f18f7b0, identical at eec37eb96 and at the tip))
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 731 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked

## Artifact 7 — `ch5-why-not-stake.png`

Chapter 5 / the objection answered rather than ignored

- File: `docs/pr-assets/pr-10192/ch5-why-not-stake.png`
  - raw: `https://raw.githubusercontent.com/curiositech/port-daddy/96277b558a2406ad32ace239b912d24161bad6a9/docs/pr-assets/pr-10192/ch5-why-not-stake.png`
- Shows: before = p.241 · after = p.246 (the committed Book PDF (blob 08f18f7b0, identical at eec37eb96 and at the tip))
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 2174×1634 px; 522 KB
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `f3b8cb47c (branch tip at capture time)` — PR #10192 head, the commit under review. The `before`
  half is necessarily an earlier commit (2f2969af959189917cff4a8ae48b1d52cc6e1db9), which is what "before" means.
- Source: `real` — rasterised from the `coordination-papers-mega-volume.pdf` committed at those two commits; not rebuilt, not fixtured, not mocked
