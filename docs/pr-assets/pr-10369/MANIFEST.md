# Visual Proof — PR #10369 (`fix/harbor-card-pattern-covers`)

Two artifacts. `book/corpus.json` feeds the Book's "Mechanized claims"
appendix, and this PR changes one row of it (`relay-card-revocation-tla`):
a fifth path, `proofs/relay/CardRevocation_dbepoch.cfg`, and a new
evidence policy.

| field | value |
|---|---|
| file | `corpus-card-revocation-row.png` (sha256 `449664f9be2b6885e60cd97217f071666444de42c14517896d5ac86a238b9a70`) |
| source commit | `5d61acf5f` (`book/corpus.json` as committed on this branch) |
| generator | `renderMechanizedClaims(loadCorpus())` from `scripts/generate-mega-whitepaper.mjs`, unmodified |
| typesetting | the TLA+/TLC table only, `pdflatex` (TeX Live, `article` 11pt), Book geometry 7 x 10 in, inner 0.8 in, outer 1.7 in |
| raster | `pdftoppm -r 150`, page 1 of 2 (page 2 holds the table's last row, unchanged) |
| sourceLabel | **standalone render of real generator output**. Fonts are Latin Modern, not the Book's; pagination is not the Book's. The full Book is rebuilt and page-checked by `whitepaper-build` on this PR. |

## Before/after GIF

| field | value |
|---|---|
| file | `corpus-card-revocation-before-after.gif` (sha256 `6be14f62258465c98247170954dbf03afbdb22e824c3581062f1a09f30ad0278`) |
| frames | 2, 2.5 s each, looping: `origin/main` at `6e54fdb62`, then this branch at `5d61acf5f` |
| generator | `renderMechanizedClaims(loadCorpus(path))` on each commit's `book/corpus.json`; the same typesetting and raster settings as the PNG above, 16-level greyscale |
| sourceLabel | **standalone render of real generator output**, same limits as the PNG. It is the motion artifact for the `website-v2/public/_redirects` change, which only rewrites the Book source download key that the corpus edit moved; that file has no rendered page of its own. |
