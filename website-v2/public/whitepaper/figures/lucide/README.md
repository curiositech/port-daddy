# Book semantic icons

Unmodified SVGs from Lucide commit `951813ce76a859d4d8b145366972cbb237147a4e`.
Source: https://github.com/lucide-icons/lucide/tree/951813ce76a859d4d8b145366972cbb237147a4e/icons
The accompanying LICENSE includes ISC and applicable Feather MIT notices.

Vector PDFs are generated with librsvg's `rsvg-convert --format=pdf1.5`.
Rebuild with `bash scripts/harbor-research/vendor_lucide_book_icons.sh`.
No custom icon approximations are used. The shared helper places each icon at
12pt, independently of the block's semantic color and original text label.

Mappings: scroll-text = theorem/lemma/proposition/corollary; book-open =
definition; key-round = property; flask-conical = empirical hypothesis and
conjecture; lock-keyhole = design invariant; calculator = numbers by hand;
list-checks = model-checked property; file-text = neutral fallback.
Protocols use workflow from the same pinned revision. The connected steps
identify a procedure, not a proof or an implementation-status claim.

Terminal transcripts use `terminal` from the same pinned commit. Its full
Feather MIT notice is included in LICENSE alongside Lucide ISC. The terminal
frame fixture converts this SVG into its own build directory; no source
assets or live services are modified by that test.
