# Frozen Book inventory pipeline

This pipeline reconstructs the inventory for the 812-page release PDF with SHA256
`5c467da4e10998ba9bb59a18f54b8038e80e588c453f1d12082ccb489e5867e7`.
It writes only `.scratch/visual-atlas/inventory/` and
`.scratch/visual-atlas/verification/`. It does not compile or modify the Book.

Run from a dedicated linked feature worktree, with the frozen release PDF and
matching generated sources already present:

```sh
/opt/anaconda3/bin/python3 scripts/book-visual-atlas/inventory/run.py
```

Requirements: Python, PyMuPDF (`fitz`), and Pillow. The path above is the runtime
used for this release. The wrapper verifies the repository root, a linked
worktree `.git` file, and a feature branch before invoking any write step. It
runs every subprocess with that explicit worktree as its working directory.
It never invokes Port Daddy or starts a runtime.

Required inputs:

- `.scratch/publication-repair/release/governing-ai-agents.pdf`
- `.cache/whitepaper-build/coordination-papers-mega-volume/`, including converged
  AUX, `mega-volume-body.tex`, and `book-sol-*.tex`
- `whitepaper/` and `website-v2/public/whitepaper/` source trees and image receipts

The root extractor `scripts/book_visual_atlas_inventory.py` captures the 263 AUX
caption records, all 113 PDF raster placements, 346 vector audit components and
one explicit margin exhibit. These helpers then bind listing and input sources,
apply the recorded human screening decisions, reconstruct original fragment
links, add six actual uncaptioned tables and sixteen uncaptioned listings, and
crop the named ladder and listing boundaries. `bind_raster_sources.py` preserves
both exact JPEG-decoder pixel identities and original PNG RGB planes, then attaches
asset-specific sidecars or collection generation receipts. The gate requires
91 matched assets and preserves the scene-icon exclusion. Existing IDs remain stable;
`v00705` through `v00723` are the later completeness repairs.

`source-map-specs.json` contains reviewed source ranges and their expected file
hashes. `make_source_maps.py` fails if those frozen sources change. It does not
claim that an inlining marker proves byte-identical generator output.

Final outputs:

- `inventory/atlas.json`: 723 occurrence/source audit records.
- `inventory/coverage-proof.json`: bounded completeness checks and explicit limits.
- `verification/coverage-verdict.json`: the same final verdict.
- `inventory/crops/`, `contexts/`, `sources/`: actual PDF crops and source snippets.
- `verification/expanded-source-census.json`: candidate source environments,
  including unused definitions and source-only duplicate branches.

To rerun only the final gate without regenerating images:

```sh
/opt/anaconda3/bin/python3 scripts/book-visual-atlas/inventory/verify_inventory.py
```

The 723 records reconcile as 263 captioned objects + 92 unique raster assets +
346 vector audit components + 1 margin exhibit + 5 additional table records +
16 additional listings. A sixth uncaptioned table is already one of the vector
components (`v00588`). Text-callout frames remain auditable but are excluded from
independent illustration ranking. Duplicate caption hyperlink destinations are
not additional figures.

The `screen_reviewed_candidates.py` decisions are recorded human inspection of
this exact PDF, not automatic aesthetic classification. Its provisional scalar
scores are not the final eight-dimension reviews. Final review JSON files under
`.scratch/visual-atlas/reviews/` are separate editorial artifacts and must be
merged by the site builder. Regeneration does not independently rerun statistical
models, validate publication rights, or certify print readability.

There is no frozen XeTeX recorder `.fls`; coverage rests on explicit PDF objects,
source traversal and the reviewed macro/environment census. The gate reports
this boundary and the unmatched tiny scene pictogram instead of claiming a
general proof for arbitrary TeX execution.
