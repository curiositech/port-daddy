# Spawn-to-Person diagram repair proof

The contact sheet and animated tour record the post-repair geometry from the
PDF at the time of the original diagram review — a 36-page build. The paper has
since grown to 41 pages (submission-craft polish pass, 2026-08-26), which moved
some figures. Page numbers below are re-verified against the current 41-page
build (`pdftotext`, matched on each figure's exact caption text), not left
stale at their original 36-page locations:

- page 12: the three continuity organs (unchanged);
- page 14: the Chapter III maturity ledger (unchanged);
- page 20: the local-identity attack boundary (was page 17);
- page 21: the local-versus-cross-operator keystone split (was page 18).

The contact sheet and tour GIF themselves are unchanged static artifacts from
the original review — their hashes below still match — so the visual geometry
they show remains a valid record of the reviewed figures even though the
figures now sit at different page numbers in the regrown document.

Artifacts:

- `spawn-to-person-diagram-repairs.jpg` — selected-page contact sheet, SHA-256
  `6c5507dd28e2050ffaa5171625d0839c70b9b2b0b742261362540fe7528291ef`;
- `spawn-to-person-diagram-tour.gif` — labeled four-frame visual tour, SHA-256
  `833a1ef14c71d1ed6a1f1460959e2b6998119734fb19520e639abe51877ad265`;
- `website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf` — reproducibly generated
  41-page source artifact, SHA-256
  `4a7996a51bf36ed234902881ec39c6662d48a0d4c61b630766459a6462dda536`.

The checksums bind this proof record to the generated artifact at the reviewed
head. They are expected to change if the PDF is rebuilt from a later commit,
even when the visible page geometry is unchanged — as happened here.
