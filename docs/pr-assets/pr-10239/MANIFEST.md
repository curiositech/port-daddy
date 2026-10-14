# Visual Proof — PR #10239 (`claude/book-fix-legible-swarm-ch4`)

Provenance manifest for the page-scale chapter renders, per the
`agent-visual-evidence-manifest` skill. Every artifact below carries the six
required fields and an honest `sourceLabel`.

## What these artifacts show

Three before/after pairs from *The Legible Swarm* (Chapter 4), at page
scale. This PR raises the chapter to the `textbook-craft` floors: three
already-dramatized scenes and one already-derived threshold are boxed as
`pdexample`s, and one brand-new example counts the chapter's own honesty-
ledger status table by hand. The pairs show the three places where that is
most visible.

## How they were made

These are **not** rasterizations of a previously-committed PDF — no LaTeX
toolchain was available to the four sibling PRs (#10176, #10179, #10180,
#10181), so they rasterized `coordination-papers-mega-volume.pdf` blobs
already committed in the repository's history. This container **does** have
one (`xelatex`, `pdflatex`), so these renders come from a genuine standalone
compile of `whitepaper/legible-swarm.tex` at each commit, three passes each
to settle cross-references and citations:

| | commit | pages | producer |
|---|---|---|---|
| **before** | `104959367` — `origin/main` at this PR's merge-base | 64 | `xelatex` (TeX Live, this container) |
| **after** | `18c5d2d62` — this PR's head | 66 | `xelatex` (TeX Live, this container) |

Both compiles ran the chapter standalone (not through
`scripts/build-whitepapers.sh`, which targets the published
`website-v2/public/whitepaper/` output the repo's
`fix(whitepaper): stop committing the Book to every PR` policy now keeps out
of content PRs) — `cd whitepaper && xelatex legible-swarm.tex`, run three
times per commit. Rasterized with PyMuPDF 1.28.2 at **150 dpi, scale 1.0×**
— page scale, what a phone PDF viewer shows, per
`skills/harbor-chartwork/references/craft-rules.md` §1.4. No annotation was
added; every pixel inside a page frame is the compiled PDF's own.

## HONEST caveats — read before trusting the label

- **`sourceLabel: real`** means these pixels come from a real compile of the
  named commit's source, with a real TeX engine, not a mock-up or a
  hand-edited screenshot. It does not mean the render matches what
  `whitepaper-build.yml`'s pinned container would produce byte-for-byte —
  this container's TeX Live version is whatever ships in the sandbox image,
  not the pinned CI container, so page 8's content is what matters here,
  not whether page counts would match a CI-produced PDF exactly.
- Both PDFs are the **standalone chapter paper**, not the collated Book
  (`coordination-papers-mega-volume.pdf`); this PR does not touch the Book
  file, so no Book-scale render is offered.
- A render proves what a page looks like. It does not prove the prose is
  right.

## Reproduce

```bash
git worktree add /tmp/ls-before origin/main
cd /tmp/ls-before/whitepaper && xelatex legible-swarm.tex && xelatex legible-swarm.tex && xelatex legible-swarm.tex
python3 -c "import pymupdf; pymupdf.open('legible-swarm.pdf')[7].get_pixmap(dpi=150).save('p8.png')"
```

---

## Artifact 1 — `worked-afternoon-{before-p8,after-p8}.png`

1 / Introduction: the promoted "Six agents, four failures" example

- Files: `docs/pr-assets/pr-10239/worked-afternoon-before-p8.png`,
  `docs/pr-assets/pr-10239/worked-afternoon-after-p8.png`
- Shows: before = p.8 · after = p.8 (page number unchanged — content boxed
  in place, not relocated)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 1241×1754 px each
- Daemon port: `none` — a PDF rasterization opens no socket and starts no
  daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a
  session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `18c5d2d62` — this PR's head. The `before` half is the merge-base
  commit `104959367` on `origin/main`, which is what "before" means.
- Source: `real` — compiled from `whitepaper/legible-swarm.tex` at those two
  commits with `xelatex` in this container; not fixtured, not mocked

## Artifact 2 — `digest-catches-lie-{before-p14,after-p15}.png`

2 / The mechanism section: the promoted "digest catches the lie" scene

- Files: `docs/pr-assets/pr-10239/digest-catches-lie-before-p14.png`,
  `docs/pr-assets/pr-10239/digest-catches-lie-after-p15.png`
- Shows: before = p.14 · after = p.15 (shifted one page by earlier
  insertions in the same chapter)
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 1241×1754 px each
- Daemon port: `none` — a PDF rasterization opens no socket and starts no
  daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a
  session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `18c5d2d62` — this PR's head; before is merge-base `104959367`.
- Source: `real` — compiled from `whitepaper/legible-swarm.tex` at those two
  commits with `xelatex` in this container; not fixtured, not mocked

## Artifact 3 — `honesty-ledger-count-{before-p64,after-p66}.png`

3 / Implementation and status: the new "Counting the wedge's own honesty
ledger" example

- Files: `docs/pr-assets/pr-10239/honesty-ledger-count-before-p64.png`,
  `docs/pr-assets/pr-10239/honesty-ledger-count-after-p66.png`
- Shows: before = p.64 · after = p.66
- Render: 150 dpi, scale 1.0×, PyMuPDF 1.28.2; 1241×1754 px each
- Daemon port: `none` — a PDF rasterization opens no socket and starts no
  daemon
- Run id: `n/a (print render)` — no agent run; the input is a PDF, not a
  session
- Transcript head hash: `n/a (print render)` — no transcript exists to hash
- Agent node id: `n/a (print render)` — no agent identity is depicted
- Commit: `18c5d2d62` — this PR's head; before is merge-base `104959367`.
- Source: `real` — compiled from `whitepaper/legible-swarm.tex` at those two
  commits with `xelatex` in this container; not fixtured, not mocked
