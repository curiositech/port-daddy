# Agent-skills expansion, 2026-09-24

This review branch applies 86 source-bound, hash-verified skill bundles under `skills/`. The source inventory covered 170 skills; 117 offline bundles were drafted. The remaining 31 offline bundles are retained under `drafts-pending-review/` because they lack final acceptance. In several cases the drafts shorten existing skills, so their guidance must be merged before replacing canonical entrypoints. No claim of complete ASCII conversion across all 170 skills is made.

`catalog/` is the exhaustive research target list. `research/` contains the Luna source investigations. `campaign-progress.json` is the frozen pre-integration snapshot; its `canonical_skills_edited: 0` is historical and does not describe this branch. The 86 accepted bundle manifests and receipts remain in the offline handoff; this branch applies their exact hashed files.

`book-figure-ports/` contains TeX and Mermaid source, validation records, and research for 12 figure ports in three styles (36 variants), including worked exercises. Rendered binary previews remain in the offline handoff and are excluded from Git; R2 publication has not yet been verified. The manuscript itself is unchanged; placement proposals are in `ASTRA-BOOK-REVIEW.md` and `BOOK-PLACEMENT-REVIEW.md`. Figure acceptance applies to the standalone renders, not page-level publication in the Book.

The source handoff was mistakenly written under a different shared checkout on `master`; no Port Daddy primary-checkout file was edited. This branch copies the task-owned, selected files into a dedicated linked Port Daddy worktree.
