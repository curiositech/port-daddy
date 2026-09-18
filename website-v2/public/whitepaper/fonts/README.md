# Book type assets

The Swiss edition uses **Source Sans 3** for its technical, instructional
register: open counters for dense labels, real small caps for the existing
apparatus, and one family shared by prose, diagrams and navigation. Regular
and real Semibold establish hierarchy without unrelated display faces. Source
Code Pro remains the literal/code face supplied by the TeX bundle.

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

Source Sans is a humanist choice inside the Swiss grid, not an imitation of
Helvetica. Archivo is a sturdier neo-grotesque alternative; IBM Plex Sans
leans more overtly industrial. Source fits this teaching book's prose/code
mixture and already supplies real small caps and the four styles in use.
The typography-expert skill guided that register-and-role choice. No trial
font or paid license is required by this implementation.

Prose selects proportional numerals. Axes, data and marginalia use Source
Sans's default equal-width lining numerals, with its `pnum` and `onum`
alternates explicitly disabled. The font does not need a `tnum` feature to
have tabular defaults; never request unsupported features by assumption.
