# Protocol frame icon dependencies

Nine unmodified SVGs from [Lucide commit 951813ce76a859d4d8b145366972cbb237147a4e](https://github.com/lucide-icons/lucide/tree/951813ce76a859d4d8b145366972cbb237147a4e/icons).
The complete pinned LICENSE carries Lucide ISC and applicable Feather MIT notices;
retain LICENSE, LICENSE.lucide.txt, and LICENSE.feather.txt in both source mirrors.

The shared helper references book-open, calculator, file-text, flask-conical,
key-round, list-checks, lock-keyhole, scroll-text, and workflow. All nine travel
with the helper, although this checkpoint activates only the Protocol/workflow
family. It does not adopt terminal styling or broader semantic changes.

SVGs are the upstream sources. PDFs are vector rendering inputs, mirrored
byte-for-byte in whitepaper/figures/lucide. The helper uses 12-point glyphs.
The workflow icon is black currentColor inside the copper protocol frame.

From repository root, verify pinned upstream sources and rebuild into a NEW
persistent directory (requires curl and librsvg):

    bash scripts/harbor-research/vendor_lucide_book_icons.sh .cache/protocol-icons-review

Expected output: nine verified SVGs, nine regenerated PDFs, complete notices,
and the converter version in the named directory. The recipe never overwrites
checked-in assets. Conversion bytes can vary by librsvg/Cairo version; the
checkpoint manifest hashes the actual frozen PDF bytes.
