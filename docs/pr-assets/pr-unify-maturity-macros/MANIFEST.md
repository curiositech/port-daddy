# Visual Proof — `claude/unify-maturity-macros`

One artifact. Provenance per the `agent-visual-evidence-manifest` skill.

## Artifact 1 — `legible-swarm-p62-honest-labels-1x-150dpi.png`

The Legible Swarm, Appendix "Implementation and status", page 62 — before and after, side by side.

- File: `docs/pr-assets/pr-unify-maturity-macros/legible-swarm-p62-honest-labels-1x-150dpi.png`
- Shows: **before** = `legible-swarm-whitepaper.pdf` p.62 built from `origin/main` at `47d900a59`;
  **after** = the same page built from this branch merged onto that same `main`. Both halves are
  64-page builds; the page number does not move.
- Render: 150 dpi, scale 1.0x, PyMuPDF 1.28.2; two 1241x1754 px A4 pages pasted side by side,
  unscaled and unannotated. The only ink added is the caption line above each page.
- Build: `scripts/build-whitepapers.sh legible-swarm` (latexmk -> XeLaTeX), run twice in this
  session against the two trees. `built 1 PDF(s); 0 failure(s)` both times.
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon.
- Run id: `n/a (print render)` — the input is a PDF, not an agent session.
- Transcript head hash: `n/a (print render)` — no transcript exists to hash.
- Agent node id: `n/a (print render)` — no agent identity is depicted.
- Source: `real` — both halves are real renders of real source at the two commits named.
- **Honest caveat, stated because it changes what you are looking at:** this render was produced
  on a host whose TeX Live does not carry the house faces (Pagella / Heros / Source Code Pro).
  Both halves fall back to Latin Modern, identically. The pair is therefore sound for the words
  it is offered to prove — which status word prints at which call site — and is **not** a
  faithful picture of the shipped typography. It is not the committed artifact, and no PDF built
  in this session is committed.

## What changed on this page

Measured by diffing the two pages' extracted text:

- the honest-label key reads `implemented / partial / specified / proposed` where it read
  `built / built (weak) / designed / vision`;
- the evidence key's third grade reads `unproved` where it read `proposed`, so the page no
  longer defines one word twice, eight lines apart, on two different axes;
- Table 14's caption, and the sentence introducing the key, follow.
