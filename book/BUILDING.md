# Build Governing AI Agents

This archive contains the complete Book manuscript, chapter registry, figures,
artwork, bibliography data, solution keys, shared typography, open fonts and the
same generator and TeX build scripts used by the repository. All authored Book
inputs live in `book/`. The `scripts/` directory contains the small build toolchain.
No Git checkout, npm installation, account, API key or network access is needed
once the build dependencies are installed.

## Build the complete book

Install **Node.js 22 or newer**, **Python 3.10 or newer**, Bash and a complete
**TeX Live with XeLaTeX** and `makeindex` (part of every TeX Live; it sorts the
index of defined terms). `latexmk` is optional: the shared builder otherwise
runs XeLaTeX repeatedly, up to eight passes, with `makeindex` between passes,
until references, margins and the index settle.
A minimal BasicTeX installation may lack required packages; missing packages
fail the build instead of being downloaded automatically.

From the extracted directory containing this README, run:

```sh
bash book/BUILDING.sh
```

The resulting PDF is
`website-v2/public/whitepaper/coordination-papers-mega-volume.pdf`.
Generated chapter assembly, the glossary, the index, logs, solution streams and
input recorder files are in `.cache/whitepaper-build/coordination-papers-mega-volume/`.

The launcher verifies every distributed source against `SOURCE-MANIFEST.json`
before building. To edit your own copy, first verify the received files with
`python3 scripts/build-book-source.py verify`, then run the shared build directly
with `PD_BOOK_FONT_PROFILE=open-proof bash scripts/build-whitepapers.sh coordination-papers-mega-volume`.
Do not relabel a modified tree as the original verified archive.

## Typography and the published PDF

The default build deliberately uses the included **Source Sans 3** fonts under
the SIL Open Font License. It compiles the entire manuscript. It is an open-font
proof, and its page breaks and figure clearances can differ from the published
Suisse edition. It is not a byte-for-byte reproduction of the published PDF.

The published Book uses privately licensed **Suisse Int'l**. These commercial
font files and purchase documents are not distributed. To use your own licensed
copy, set `PD_BOOK_FONT_DIR` to a directory outside the extracted source containing
`SuisseIntl-Regular.otf`, `SuisseIntl-RegularItalic.otf`,
`SuisseIntl-Semibold.otf` and `SuisseIntl-SemiboldItalic.otf`, then run:

```sh
PD_BOOK_FONT_DIR=/path/to/your/licensed/OTF bash book/BUILDING.sh --publication
```

This mode refuses to substitute fonts when a required file is missing. It does
not itself certify a modified PDF for publication. Font licenses and pinned
upstream hashes are included under `book/fonts/`; icon licenses accompany the
icons under `book/figures/lucide/`. The repository license is included as
`LICENSE`; this package does not grant additional rights to third-party work.

## Fixed build environment and provenance

Hosted verification uses Node.js 22, Python 3 and the repository's pinned image:

```text
texlive/texlive@sha256:ee8ecc627897eabeb42d862d8187546483455e66ce94aa5c2bce1b45a977ab27
```

The image supplies TeX Live; Node and Python must also be available in the
build environment. The archive fixes `SOURCE_DATE_EPOCH=1700000000`, independently
of the extraction time or any surrounding repository. TeX package and font
versions can change layout, so a different TeX Live installation is not evidence
of byte-identical reproduction. The manifest records each source SHA-256 and
byte count, the fixed epoch and the pinned image. It contains no compiled Book
PDF; the full site provides the accepted PDF separately.

The build itself does not execute the research program's simulations or proof
checkers. The included corpus registry documents their provenance; a successful
Book compile verifies typesetting, not those mathematical or empirical results.

## Build identifier

`\pdbuildid` prints which build a PDF is: the short commit, the font profile
and the date, for example `dfce4990d · open-proof · 9 November 2026`. It is
defined in `book/figures/pd-buildid.tex` from three parts:

- `\pdbuildcommit`: HEAD of the repository, with `+modified` when a Book
  input has uncommitted changes. An extracted source archive has no Git and
  prints `source` and the first twelve digits of its `SOURCE-MANIFEST.json`
  digest instead. Setting `PD_BOOK_COMMIT` overrides both.
- `\pdbuilddate`: the UTC date of `SOURCE_DATE_EPOCH`, which
  `scripts/build-whitepapers.sh` computes per build from the Book's sources and
  this archive fixes at 1700000000.
- `\pdbuildfontprofile`: `open-proof` or `suisse`, as
  `scripts/prepare-book-fonts.py` selected.

The generator writes the first two into
`.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-build-id.tex`.
A commit identifier changes when a branch is rebased even if no input did, so
compare consumed input hashes, not the printed commit, when deciding whether
an accepted PDF still matches its sources.

## Cross-chapter pointers

`\weld{label}{keyword}` (`book/figures/pd-weld.tex`) points from one chapter to
a numbered section of another. It prints `§N, p. P` when the target is three or
more pages away and `§N` when it is nearer; a pointer that printed its page on
the previous pass keeps it down to two pages, so the build converges. In a
chapter an unprefixed label is the chapter's own and `<prefix>:<label>` is
another chapter's, as for `\ref`; Chapter 0's sections are `prereq:<label>`.
The volume appendices cannot be reached from a chapter.

The keyword prints nothing. `scripts/lint/check-welds.mjs` checks that every
weld's label names a numbered section of the assembled Book and that the
section's text contains the keyword. The generator runs the same check, so a
broken weld fails the build before TeX starts, and writes the chapter-by-chapter
dependency matrix the welds define to `mega-volume-welds.json`. In the
repository, `node scripts/lint/check-welds.mjs --matrix PATH` writes it on its
own.

## Status tables from the manifest

During the build, `scripts/harbor-research/render_status_tables.py` writes one
table per chapter, `mega-volume-status-<prefix>.tex`, into the generated-input
directory. Each lists every artifact in `book/corpus.json` that the chapter
names, with the manifest's status in the Book's markers (`\Closed`,
`\SpecOnly`, `\Partial`, `\Open`). A chapter includes one with
`\pdgeneratedinput{../.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-status-<prefix>.tex}{status table}`.
To render one table on its own:
`python3 scripts/harbor-research/render_status_tables.py --chapter bonded`.

In the repository, `scripts/harbor-research/check_status_consistency.py`
reports every artifact a chapter names whose printed status word disagrees
with the manifest. It is report-only (exit 0) until the hand-written tables
are replaced; `--strict` makes a disagreement fail.

## The corrections ledger

`book/corrections.yaml` holds one row per correction that changes printed
text: `id`, `item`, `file`, `before`, `after` and `source`. In the repository,
`scripts/harbor-research/check_corrections.py BOOK.pdf` reads the built PDF
and fails when a row's `before` still prints or its `after` does not, naming
the row and the page. Either side may be `null` (a pure addition or removal),
but not both. With `--baseline-pdf` and a Book built from the base branch, it
also lists as "vacuous" every `before` that the old Book never printed either.
`scripts/harbor-research/run_pdf_checks.py` runs it on every PDF it checks.

## Code and runs cut from the Book's kernel

`book/excerpts/` holds the code and the recorded output that the Book prints
from its own kernel, `harbord`. Nothing in it is written by hand. The kernel's
repository cuts it with `tools/excerpts.mjs build --out book/excerpts`:

- `<name>.code` is the lines between two snippet markers in a source file.
- `<name>.tex` carries the file, its first and last line, and the language.
- `<name>.txt` is a recorded run or terminal session.
- `manifest.json` pins the commit and a SHA-256 for every file.

Four macros in `book/figures/pd-listing.tex` set these files: `\pdexcerpt`
for code, `\pdrun` and `\pdrunlines` for a recorded run, and `\pdsessionfile`
for a terminal session. To change a listing, change the kernel and cut again.

In the repository, `tests/harbor-research/test_book_excerpts.py` fails when a
file here is not the one the manifest pins, and when the Book prints an
excerpt the manifest does not list. The check against the kernel's source,
`tools/excerpts.mjs check`, runs in the kernel's repository, which is private.
