# Visual Proof — `claude/math-critique-closeout`

Provenance for the two artifacts in this directory, per the
`agent-visual-evidence-manifest` skill. The seven page-scale stills that cover the
critique application itself live one directory over, in
`docs/pr-assets/pr-10192/MANIFEST.md`; this file covers only what was added here.

## Artifact 1 — `https://media.portdaddy.dev/sha256/99/996ce721ecb09fa3a5f808806e000b40488eac172808c9ed1ad95117039891a9.png`

Chapter 4's succession corner, the page CA-061's retraction settles.

- File: `https://media.portdaddy.dev/sha256/99/996ce721ecb09fa3a5f808806e000b40488eac172808c9ed1ad95117039891a9.png`
- Shows: p.179 of `coordination-papers-mega-volume.pdf` as this branch commits it.
- Render: 1050 x 1500 px, which is exactly a 504 x 720 pt Book page at 150 dpi, scale 1.0 —
  page scale, no crop, no upscale. Measured on the file rather than taken from its name.
- Daemon port: `none` — a PDF rasterisation opens no socket and starts no daemon.
- Run id / transcript head hash / agent node id: `n/a (print render)` — the input is a PDF,
  not an agent session, and no agent identity is depicted.
- Source: `real` — a rasterisation of the committed artifact.

## Artifact 2 — `https://media.portdaddy.dev/sha256/aa/aaa004ee25984734456a2879a5908552aff90b5abd4aa070c2b406e534112eb9.gif`

Three pages the critique changes, each shown before and then after.

- File: `https://media.portdaddy.dev/sha256/aa/aaa004ee25984734456a2879a5908552aff90b5abd4aa070c2b406e534112eb9.gif`
- Shows, at 1400 ms per frame, six frames in three pairs:
  ch.7 "what supplies perfect public monitoring" (main p.366 -> branch p.378);
  ch.5 "why not stake" (main p.242 -> branch p.251);
  ch.4 the succession corner (main p.176 -> branch p.179).
- Inputs: the two **committed** `coordination-papers-mega-volume.pdf` blobs — `origin/main`
  at `5cde03786` (553 pages) and this branch (568 pages). Both were produced by CI's
  `whitepaper-build` job on the real toolchain. **No PDF was built to make this GIF**, and
  none is committed with it.
- Render: PyMuPDF 1.28.2 at 110 dpi, 770 x 1100 px per page, adaptive 128-colour palette.
  The page pixels are the PDF's own; the only ink added is the caption band at the top of
  each frame.
- Daemon port: `none`. Run id / transcript head hash / agent node id: `n/a (print render)`.
- Source: `real`.

### Honest caveats

- **The page numbers are not aligned by number, and cannot be.** The branch inserts material,
  so the book repaginates: 553 pages before, 568 after. Each BEFORE page was chosen as the
  page of `main` with the highest word-set overlap with its AFTER page (Jaccard 0.35 to 0.46).
  That is a good enough alignment to look at the same passage on both sides and a poor enough
  one that some of the difference you see is repagination rather than edit.
- A tour proves what the pages look like. It does not prove the prose on them is correct, and
  it is not a substitute for reading the diff.
