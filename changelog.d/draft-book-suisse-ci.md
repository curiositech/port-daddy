type: added

- **The website now serves the Book as merged, set in Suisse.** CI restores the licensed fonts from repository secrets (`scripts/book-fonts/ci_fonts.py`, checked against pinned SHA-256 digests and deleted when the job ends), builds the publication edition, runs every page check on it, and lays out the facing copy. Pull requests that touch the Book get the same check, and each website deploy serves the checked PDF and facing copy in place of the committed ones. Until the fonts are uploaded once, deploys ship the committed Book and say so. See ADR-0145.
