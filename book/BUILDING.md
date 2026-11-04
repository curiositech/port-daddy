# Build Governing AI Agents

This archive contains the complete Book manuscript, chapter registry, figures,
artwork, bibliography data, solution keys, shared typography, open fonts and the
same generator and TeX build scripts used by the repository. All authored Book
inputs live in `book/`. The `scripts/` directory contains the small build toolchain.
No Git checkout, npm installation, account, API key or network access is needed
once the build dependencies are installed.

## Build the complete book

Install **Node.js 22 or newer**, **Python 3.10 or newer**, Bash and a complete
**TeX Live with XeLaTeX**. `latexmk` is optional: the shared builder otherwise
runs XeLaTeX repeatedly, up to eight passes, until references and margins settle.
A minimal BasicTeX installation may lack required packages; missing packages
fail the build instead of being downloaded automatically.

From the extracted directory containing this README, run:

```sh
bash book/BUILDING.sh
```

The resulting PDF is
`website-v2/public/whitepaper/coordination-papers-mega-volume.pdf`.
Generated chapter assembly, logs, solution streams and input recorder files are
in `.cache/whitepaper-build/coordination-papers-mega-volume/`.

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
