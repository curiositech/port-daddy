# Three object drawings and the resulting page repair

## Implemented scope

Three approved generated illustrations are placed at native 1.3-inch width:
the overlapping rope splice in Chapter 5, reusable printing block in Chapter 6,
and locally controlled turnstile in Chapter 8. Each has one caption and no
repeated heading. Exact prompts, tool/model reporting and image checksums
travel with their PNGs in `plates/margin-evidence/`.

The former printing-stamp photograph and its JSON remain unchanged; replacing
its placement did not delete the documentary asset. Parent and independent
review inspected the three drawings on their actual owning pages, not just
thumbnail previews. `test_book_margin_object_batch.py` checks original bytes,
caption ownership, native dimensions and outside-column placement.

This brings the placed inventory to eight, one per chapter. The operator's
minimum is forty, five per chapter: thirty-two placements remain. Generated
but unplaced art does not count.

## Flow repairs

- Keep the Six Pairs calculation with its figure; give the binomial count its
  own display and the reader exercise its own paragraph.
- Keep Structural Scope's complete authorization premise and inclusion chain
  with the heading. Two opening body lines were insufficient because they cut
  the condition, not because two is a universally wrong line count.
- Table 7.4 exposed a narrow consequence column after surrounding pagination
  changed. Wrap the event and severity columns at .27 and .225 of text width;
  let the consequence column use the remainder. No type shrinkage.
- Move the existing moral-harm paragraph before that table, unchanged.
  Shorten the Hickman portrait caption's repeated attribution; its complete
  author/work/year source note remains beside it.

The existing no-mint regression incorrectly required a complete closing
paragraph on the exact preceding page. Parent and independent inspection
showed the complete paragraph directly above its figure. The replacement
guard permits either location, but rejects a split paragraph, missing words,
duplicate paragraph or reversed reading order. It does not join a paragraph
across page boundaries to manufacture a pass.

## Proof record and limits

All paths below are under `.cache/book-heading-paragraphs-20260920/`.

| Candidate | Pages | Disposition |
| --- | --- | --- |
| `art-proof` | 713 | New art visually passes; Table 7.4 caption displaced and columns cramped. |
| `art-proof2` | 712 | 251 scoped tests pass; table caption still too low and severity needs more width. |
| `art-proof3` | 712 | Final table and turnstile page pass parent visual review; all 251 scoped tests and three object tests pass. Convergence warning prevents checkpoint acceptance. |

`art-proof3` PDF SHA-256:
`a5c1e80acee72a20e8fd273031bfce49e1b9068316a53d361f951757c61ac639`.
AUX SHA-256:
`7e753dc1db891895a8b51db0990d106ada666048daa889ffc51cb9f6c478919e`.

Its checks preserve 2,172 public identities, 271 section anchors and all 553
complete citation occurrence records against the earlier scoped baseline.
All 1,362 margin objects are placed; 233 captions and 193 owner-adjacency
checks have no findings. Page audit reports no lost ink, margin collisions or
footer intrusions. Thirty-seven full-width and sixty whitespace candidates
still require judgment; forty-three overfull warnings remain. These are not
whole-Book visual or scientific certification.

The Structural Scope sidecar has 23 passing controls and correctly rejects
the old split opening. It resolves the supplied AUX destination rather than
freezing a folio. Sidecar:
`~/coding/tmp/book-structural-scope-regression-20260920/REPORT.md`.

**Convergence gate found during final review:** the last TeX log still reports
`PD-MARGIN-CONVERGENCE: pending` and asks for a rerun. The earlier accepted
`04f453` baseline carries that warning too. Preserve its historical bounded
review, but do not present it as proven converged. Parent is running additional
passes into `art-proof4`; Maxwell is investigating the hash-based gate without
altering it. A successful process exit and matching public labels alone do not
clear this warning. Do not mark this batch accepted until the final artifact
and convergence evidence agree.

## Retained next work

The parking-meter artwork can proceed to a placement trial. The speaking-tube
and annunciator artworks remain approved but their original slots crowd source
notes; Turing is finding better owners. These holds follow the Tufte margin
adjacency rule, not an objection to the user's five-per-chapter requirement.

The color/edge prototype, no-mint/trade/Mara paragraph decompression, protocol
source checkpoint, terminal restyling, Swiss plates, sparklines, figure atlas,
citations, reproducibility bundle and research lanes all remain on BOOK-TODO.
No scientific experiment or provider run occurred in this integration pass;
the $50 experiment budget remains untouched. No local Port Daddy runtime was
started. No full-Book publication or arXiv submission is claimed.
