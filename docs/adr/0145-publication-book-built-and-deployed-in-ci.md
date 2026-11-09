# ADR-0145: CI sets the publication Book in Suisse and deploys it with the site

- **Status:** Accepted
- **Date:** 2026-11-09
- **Relates to:** [ADR-0143](0143-book-is-the-only-published-whitepaper-edition.md), [ADR-0144](0144-book-r2-mirror-with-one-mutable-pointer.md)

## Context

The Book is published in Suisse Intl, a face licensed to its owner. The
license forbids redistributing the font files, so they have never been in
the repository, and CI could only build the open-proof edition in Source
Sans. The two editions paginate differently: a page can overflow in one
and not the other.

So the published Book was a local build. Someone with the fonts built it,
checked it and committed the PDF in an artifact PR, and the website served
whatever PDF was committed. In practice that meant the site lagged the
manuscript. On 9 November 2026 it served an 817-page Book from 5 November
while main held a 1,010-page Book carrying the third pass.

## Decision

**The fonts reach CI as repository secrets.** A secret holds at most 48 KB.
`scripts/book-fonts/ci_fonts.py upload` makes a deterministic tar of the four
OTF files, compresses it with xz to 257 KiB, encodes it in base64 and sets
it as eight slices, `BOOK_SUISSE_00` to `BOOK_SUISSE_07`. The workflow names
twelve slots. The licence holder runs the upload once, with `gh` signed in.
`ci_fonts.py restore` reassembles the slices in CI. It refuses a gap, any
archive member other than the four files, and any file whose SHA-256
differs from the pins in `scripts/book-fonts/suisse-sha256.json`. It writes
the files with mode 0600 into the runner's temporary directory, outside the
checkout, and the job deletes them in an `always()` step. Fork pull requests
receive no secrets.

**`book-publication.yml` builds and judges the Suisse edition.** It runs on
pull requests that touch a Book input, and deploy-website-v2.yml calls it.
It builds with `book/BUILDING.sh --publication` in the pinned TeX Live image
and runs `run_pdf_checks.py` on the result. It then lays out the facing copy
and binds it to the Book with `check-book-spreads.mjs`. It caches only the
published files: the PDF, the facing copy and its receipt. The cache key is
the source receipt's digest of every Book input, plus the pipeline that
builds and checks them. The receipt is verified against the tree before the
key is formed, so a deploy whose Book inputs did not move reuses a checked
PDF without restoring the fonts.

**The deploy serves the Book it built.** deploy-website-v2.yml copies the
two PDFs and the receipt over the committed copies, recomputes the site's
page count, size and digest for them with `check-whitepaper-metadata.ts
--fix`, and builds the site. If the Book fails its checks, the workflow
deploys nothing. If the fonts are not configured, the committed Book ships
as before and the run says so.

## Consequences

- Every merge that changes the Book publishes it, in its published face, after
  the same page checks a local build passes.
- The committed `coordination-papers-mega-volume.pdf` and its facing copy are
  no longer what readers download. They remain the fallback when the fonts are
  absent, and the open-proof workflow still restores them on ordinary runs.
- The deployed Book prints its build identifier: the commit, the font profile
  and the date of its newest input.
- A Book that fails its checks on main blocks the website deploy until it is
  fixed. Pull-request runs make that rare, because they run the same checks on
  the same image with the same fonts.
- The ADR-0144 R2 mirror stays unwired. It can take the same artifact later.
