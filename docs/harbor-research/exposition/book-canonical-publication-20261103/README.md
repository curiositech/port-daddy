# Canonical-source Book publication

This publication binds the reviewed 844-page Suisse Book to the canonical sources
merged in PR #10349. All 147 recorded direct/explicit Book and build inputs, all
eight authored chapter sources, and Chapter 0 match the actual accepted extraction,
merged sources, and publication tree. A fresh assembly from the publication sources
is byte-identical to all nine accepted assembly outputs, including the generated
chapter body recorded for the accepted PDF. The PDF was copied without recompiling
it; the facing copy was regenerated and checks every character position, link,
bookmark and destination.

The [acceptance receipt](acceptance.json) identifies the exact PDF and facing-copy
bytes, toolchain/font evidence, PDF checks and their limits. The
[source reconciliation](source-reconciliation.json) enumerates every difference
between the accepted extraction and the complete source-package inventory: nine
changed supporting files, eight removed unused solution duplicates, and two added
standalone test fixtures. Eight of those changed files were already in merged
PR #10349; the publication changes only the cover provenance metadata. The original
extraction manifest predates two disclosed edits and is not presented as the final
accepted-input snapshot. The recorded generated TeX streams and the byte-identical
fresh assembly establish that boundary.

All six PDF gate checks pass, with zero overfull boxes in the final TeX log.
[The check log](pdf-checks.log) retains advisories: 96 pages in whitespace review,
53 whitespace spill warnings, and 74 pictures extended past the column by the
safety net. It reports no paper-edge loss or margin-column collision.

An independent reviewer inspected the three affected two-page spreads; see
[the scoped visual review](independent-review.json) and [page comparison](page-comparison.json).
This evidence does not claim a new whole-book mathematical or aesthetic review.
The complete public source archive uses redistributed open fonts; private Suisse
font files are excluded. Protected artifact merge, production deployment and public
byte verification remain separate checkpoints.
