# ADR-0143: The Book is the only published whitepaper edition

- **Status:** Accepted publication policy; current manuscript acceptance is separate.
- **Date:** 2026-09-20
- **Retains:** the publication decision from PR #10251, reconciled with main.

## Context

The project previously published the eight chapters both individually and in
`coordination-papers-mega-volume.pdf`. Maintaining separate published layouts
made it possible for a reader to download an outdated chapter edition and
required editorial work to support artifacts the project no longer wanted.

PR #10172 retired those eight standalone PDFs. It merged on 2026-09-15 as
`58db38017474625f20dca142d665c4bd5cfee5c7`. The original version of this ADR
said that retirement was still unmerged; that statement is obsolete.

## Decision

The canonical published whitepaper edition is the Book,
`coordination-papers-mega-volume.pdf`. Chapter download links target the Book;
retired standalone chapter URLs retain the redirects established by #10172.
Do not rebuild or restore the eight retired chapter PDFs or their independent
publication metadata as a side effect of an editorial change.

The source chapters remain inputs to the Book through
`whitepaper/textbook.json` and `scripts/generate-mega-whitepaper.mjs`.
Source-level branches used for isolated chapter compilation and structural
checks are not a second published edition. An explicitly requested local
alternate-edition build is also not publication authority.

Book layout decisions belong to the accepted manuscript and its figure and
margin-system contracts. This publication ADR does not freeze a particular
caption placement algorithm, a number of inline table captions, or a count
of fallback placements observed in an older PDF. Those implementation details
in the original #10251 draft require the current Book owner's source and
render acceptance before they can be declared current policy.

## Delivery boundary

A source merge, a successful PDF build, and a public Book release establish
different facts. Publication requires an accepted artifact tied to its exact
source revision and the reviewed release process. A working-tree PDF is not
bound to the checkout's HEAD when its source is dirty.

The Book/atlas source reconciliation and any review-media archival work must
retain their own evidence. Moving review assets does not authorize deletion
of Book inputs, and landing this decision does not certify an unmerged
manuscript or authorize a public release.

## Consequences

- Editorial and build work maintains one canonical published Book.
- Tests and metadata for a retired standalone publication path should be
  reconciled with the Book contract rather than regenerating that artifact.
- An old branch carrying standalone PDF or digest churn must preserve its
  useful source changes without restoring retired publication outputs.
- Source and artifact acceptance are recorded with immutable revisions and
  hashes; publication-policy agreement cannot substitute for that evidence.

## References

- [#10172: Retire the eight standalone chapter PDFs](https://github.com/curiositech/port-daddy/pull/10172)
- [#10251: Original Book-only edition decision](https://github.com/curiositech/port-daddy/pull/10251)
- [#10197: Earlier margin apparatus work](https://github.com/curiositech/port-daddy/pull/10197)
- [#10208: Earlier single margin-system proposal](https://github.com/curiositech/port-daddy/pull/10208)
- [ADR-0142: Review-evidence media offload](0142-r2-media-offload.md)
