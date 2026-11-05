# Dated manuscript and decoded-claim verification

The canonical manuscripts use the edition date in `book/textbook.json`: **5 November 2026**. Editorial decisions and the unpublished changelog live in the `BOOK-SALVAGE-CLAIMS-20261105` Omni ledger record. Neither that ledger nor private Suisse fonts is included in the public source archive.

## Evidence boundaries

- `kani-verification.json` and the compressed execution logs record five successful local Kani 0.67.0 harnesses, all 17 satisfied cover obligations, two intended counterexamples after removing policy checks, and 103 native Rust tests. Source hashes bind the results. These are bounded post-decoding and capability results, not verification of signatures, arbitrary strings, a complete signed delegation chain, or deployed mediation. The parser harness is manual-only and was not rerun in this slice.
- `independent-source-review.json` records the adversarial review and the correction of the parser scheduling description. The actual manual trigger is tested; no recurring job was added.
- `publication-pdf-checks.txt`, `consumed-inputs.json`, and `publication-font-profile.json` bind the local Suisse publication candidate to its inputs and six mechanical PDF gates. Private font bytes are not stored here.
- `root-visual-review.json`, `structure-visual-review.json`, and the prose review describe human visual inspection at contact-sheet and readable-spread scales. `render-differential.json` compares every page of the final candidate with that reviewed proof at 108 dpi: 815 pages are pixel-identical; physical pages 210 and 799 were inspected again. This is visual acceptance within the recorded scope, not a claim to have re-proved every theorem.
- `extracted-source-build.json` records a separate build from the public archive using its included open fonts. Its pagination is not evidence for the Suisse edition.

Source merge, publication-artifact merge, hosted checks, and independently fetched production bytes are separate release gates. Local success alone does not assert that any of those gates has completed. The publication PR carries the accepted PDF and facing-page derivative; the source PR preserves the committed public Book.

## Reproduction

Run the five harnesses named in `.github/workflows/proofs.yml`, then the log checker and negative-control runner in `core/harbor-card-rs/scripts/`. Run `cargo test` for the same crate. The finite capability grammars and bounds are stated in `kani_claims.rs`, `kani_claims_domain.rs`, and `book/corpus.json`.

Extract the public source download using `scripts/build-book-source.py extract`; run `bash book/BUILDING.sh` in the extracted directory. The archive contains the complete canonical `book/` inputs and the explicit build helpers. Its manifest verifies every packaged file before building.
