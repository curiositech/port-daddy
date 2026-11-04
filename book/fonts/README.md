# Book typography: Suisse Int’l

The chosen Swiss Book face is **Suisse Int’l**, purchased in four real cuts:
Regular, Regular Italic, Semibold and Semibold Italic. These serve prose,
headings, part/chapter openers, contents, marginalia, captions and diagrams.
Code stays Source Code Pro; mathematical symbols and Greek stay newpxmath.
The shared typography module owns these roles, not individual figures.

## Private licensed inputs

Keep the OTFs and personal EULA **outside the repository**. Never put them in
`public/`, commit them, or include them in a downloadable CI artifact. The
purchase archive and EULA can contain personal billing data. Ignore rules
are a backstop, not permission to store commercial fonts in site assets.

Set `PD_BOOK_FONT_DIR` to the external directory containing
`SuisseIntl-Regular.otf`, `SuisseIntl-RegularItalic.otf`,
`SuisseIntl-Semibold.otf`, and `SuisseIntl-SemiboldItalic.otf`.
Both `scripts/build-whitepapers.sh` and the Book fragment compiler use it.
`scripts/prepare-book-fonts.py BUILD_DIR` writes a private TeX configuration and
hash receipt, **not copies of the fonts**. Missing files fail a Suisse build;
no system installation, conversion or synthetic style is needed.

Suisse prose uses proportional numerals. Axes, tables and captions use its
tabular lining numerals. These cuts have no small-cap glyphs: legacy small-cap
requests retain the real upright face and current weight, never a simulated
small-cap transform or an unrelated serif. The typography-expert guidance
informs this restrained hierarchy and supported-feature check.

## Open-font proofs and publication boundary

An unlicensed checkout uses the vendored **Source Sans 3 proof profile**, named
in the log and PDF creator metadata. Its pagination and clearance measurements
are not Suisse evidence. Choose `PD_BOOK_FONT_PROFILE=open-proof` with no font
directory, or set `PD_BOOK_FONT_PROFILE=suisse` to require Suisse and fail if its
directory is missing. Supplying `PD_BOOK_FONT_DIR` selects Suisse automatically.

Public CI has not been provisioned with commercial fonts. A licensed
publication pipeline must supply them privately and require the Suisse profile;
do not publish an open-font proof as the approved Suisse edition. Follow the
EULA supplied with the purchase for permitted use.

Run `test_book_typography.py` with `BOOK_TYPOGRAPHY_PDF` pointing to the full
Book and `BOOK_TYPOGRAPHY_FACE=SuisseIntl` to check real embedded styles, prose,
all four part spreads and all eight chapter openers. Use
`export_book_type_review.py` for a compact review of that same Book.

## Retained OFL proof assets

The earlier Source Sans 3 implementation remains available to unlicensed
development and CI. It is no longer the author's selected production face.

The operator clarified **sans serif**, not serif, on 2026-09-17. The earlier
Source Serif 4 proof is superseded. Its licensed assets are retained for
comparison, but no active Swiss typography role loads them.

These are unmodified OpenType files under the SIL Open Font License 1.1.
Each directory includes its upstream license and copyright notice. Loading
uses repository-relative filenames, not fonts installed on the build host.

| Assets | Upstream | Pinned revision |
|---|---|---|
| `source-serif/` | [Adobe Source Serif](https://github.com/adobe-fonts/source-serif) | `80d3f8894c09c937bebfa9011247d2e1c79fd6f4` |
| `source-sans/` | [Adobe Source Sans](https://github.com/adobe-fonts/source-sans) | `87b37a2daaed80fcb8e8ccb0085c4d72ddade12e` |

Files come from each revision's `OTF/` directory; licenses come from
`LICENSE.md`. Regular, Italic (`It`), Semibold, and Semibold Italic are the only
weights shipped. Serif includes Text, Caption, and Display cuts. No variable
font instancing, synthetic styles, or renamed derivatives are used.

The mathematical symbol and Greek fonts remain `newpxmath`; explicit math
text, operators, and numerals use the shared sans. This preserves the established
proof notation while its compatibility is checked on rendered pages.

`newpxtext` resets the body family at the end of the preamble. The Book's
shared typography module therefore repeats the public `fontspec` selection
in a later hook. Do not replace that with a bare `rmdefault` assignment:
feature-bearing faces and microtype's font cache also need consistent state.
Set `BOOK_TYPOGRAPHY_PDF` when running `test_book_typography.py` to check the
actual prose fonts in an assembled PDF, not merely the intended source.
Font changes require a fresh full-Book build and figure clearance review;
successful font loading alone says nothing about wrapping or collisions.

No commercial font license is needed for the open-font proof profile. The OFL
licenses in these directories do not apply to Suisse.

Prose selects proportional numerals. Axes, data and marginalia use Source
Sans's default equal-width lining numerals, with its `pnum` and `onum`
alternates explicitly disabled. The font does not need a `tnum` feature to
have tabular defaults; never request unsupported features by assumption.
