# Cancellation must survive conflict recovery

Research date: 6 November 2026. This is a concrete follow-up to NEXT-P6's implementation-conformance obligation.

Harbormaster selects an accepted dispatch, then awaits rebase, status and abort commands. Its conflict path originally reset the dispatch to produced by ID alone. A cancellation committed during any of those waits could therefore be overwritten. This contradicts treating cancellation as a durable change of authority.

The repair makes that reset a compare-and-set from accepted. When no row changes, processing returns skipped before changing the merge queue, emitting conflict events or posting a retry note. Existing accepted-conflict behavior remains covered. The patch does not mediate every external command or solve the successful merge path's cached-acceptance issue.

Three deterministic in-memory SQLite tests pause the injected command runner at rebase, status and abort. They commit a salvage cancellation, resume the command, and check the complete dispatch row, merge-queue row and emitted effects. No actual Git command, daemon or agent executes.

The coordinator independently ran the current tests against an isolated copy of the exact source from commit `449e842ae8e2292d4a67d0ab0b06981dbdc3c87f`. All three failed with the represented salvage-to-produced overwrite. Against the repair, all twenty Harbormaster tests pass. Together with the nine actual-queue future-admission cases, both suites pass 29 tests. Raw outputs and source hashes are retained in `docs/harbor-research/campaigns/2026-11-06/coordinator/dispatch-regression/`.

This is a reproduced source-level race and a bounded repair. It is not evidence that a live cancellation was lost, nor proof that all dispatch writers or external effects obey cancellation. The successful merge path, metadata/revision binding, other SQL writers and interconnection with an admission gate remain explicit research and implementation obligations.
