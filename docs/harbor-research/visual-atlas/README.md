# Book visual atlas: editorial ledger

The atlas compares **405 scored works in 18 families**, with **318 additional
fragments and duplicates retained for audit**. The 723 records cover the frozen
812-page Book PDF with SHA-256
`5c467da4e10998ba9bb59a18f54b8038e80e588c453f1d12082ccb489e5867e7`.
This ledger preserves the inventory, human judgments, evidence gaps, scoring
contract and proposed generator families. It does not approve a new design or
certify mathematical claims, empirical performance or publication rights.

## Open and use

The local deliverable is `.scratch/visual-atlas/site/index.html`. The portable
`book-visual-atlas.zip` sits beside `site/`; unzip it and open its `index.html`.
It works offline, including source snapshots and all image/page-context links.
The full Book PDF is identified by digest rather than duplicated in the ZIP.

The first view groups the full layer stack, the layer reference table and the
margin ladder. Choose any family, compare selected items, arrange them with
dragging or arrow buttons, and inspect each assessment. You can change scores
or type, write editorial notes and designate exemplars. Baseline judgments are
retained. Decisions persist in browser storage; export JSON to preserve or
transfer them. Import requires the exact same PDF digest. Arrangement is an
editorial preference, not a new quality or evidence claim.

## What was checked

- All 263 captioned figures, tables and listings have source bindings.
- All 41 PDF listing destinations are represented, including 16 unnumbered ones.
- All 113 raster placements are retained; 91 of 92 distinct images match source
  assets exactly. The unresolved small scene pictogram remains an audit record.
- Six unnumbered tables and the complete margin layer ladder are included.
- Human screening distinguishes actual diagrams from text-callout frames and
  groups separated components of one exhibit instead of ranking them twice.
- Each ranked work has a stated purpose, actual rendered inspection, eight
  dimension scores with rationales, strengths, defects, improvements, and
  available source/data lineage with its verification limits.
- The final site validation checks all image/context paths, copied source
  hashes, score arithmetic, review completeness and family membership.

A source match does not verify an external rights claim or replay a numerical
experiment. There is no frozen XeTeX execution recorder; the completeness claim
is bounded to explicit PDF objects and the reviewed source/macro census.
Full limitations are in `coverage.json` and each review.

## Authority and files

- `inventory.json`: stable IDs, source ranges, occurrences and unaltered captions.
- `screening.json`: recorded visual inclusion/exclusion decisions.
- `reviews/`: authored baseline reviews, separate from operator overrides.
- `coverage.json`: frozen-PDF completeness receipt and explicit limits.
- `validation.json`: final integrated-site validation.
- `reproduction.json`: end-to-end regeneration and unchanged semantic/source checks.
- `final-qa-result.json`, `final-layout-report.json`: browser checks.
- `manifest.json`: hashes for the frozen JSON evidence.

The [rubric](../visual-atlas-rubric.md) defines scores. The
[family proposal](../visual-atlas-family-proposal.md) defines the next design
work: shared semantic registries and family-specific generators, with common
role tokens and SVG glyph interfaces. It is a proposal, not implemented drawing
logic. Existing manuscript and PDF files are unchanged by this atlas task.

## Reproduction

See `scripts/book-visual-atlas/inventory/README.md` for extracting the matching
PDF and sources. Then run from the dedicated feature worktree:

```sh
python3 scripts/book-visual-atlas/build.py .scratch/visual-atlas/inventory/atlas.json \
  --output .scratch/visual-atlas/site --source-root "$PWD" \
  --screening docs/harbor-research/visual-atlas/screening.json \
  --reviews docs/harbor-research/visual-atlas/reviews/*.json
python3 scripts/book-visual-atlas/validate.py .scratch/visual-atlas/site \
  --output .scratch/visual-atlas/verification/atlas-validation.json
```

To regenerate the portable ZIP and refresh this ledger from the current
review workspace, run `python3 scripts/book-visual-atlas/snapshot.py` after
final browser QA. Rebuilding or extracting does not invent new aesthetic
judgments; a changed PDF requires a new visual review and digest-bound ledger.
