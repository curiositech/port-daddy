# Sealed-room redraw brief

This batch borrows the supplied Swiss-modern references' cutaways, aligned comparisons,
and recognizable records. Their numerical and architectural claims are not evidence.
The existing source chapter and finite-model checker own these figures' claims.

## VIII/fig:sealed-pillar-pipeline

- Reader question: which controls mediate an output, and whose authority removes a restriction?
- Claim: the worker's outputs pass through an in-guest monitor and outer gateway;
  releasing an owner's restriction requires that owner's gate.
- Grammar: component cutaway feeding two typed release paths, with document-shaped
  contract/output artifacts. This supersedes the atlas's overloaded four-property pipeline:
  the adjacent evidence table already names the four claims and their checkers.
- Evidence: sealed-harbor.tex, “Two fences” and “Whole-worker taint and two gates”.
  A value labelled {D,E} may become {E} with Derek's permission, or {D} with Erin's.
- Counter-reading: the gates are not two stages in series; their owners are not their
  recipients. The public receipt channel is omitted explicitly. This is a proposed
  architecture, not a drawing of a deployed/verified confidential VM.
- Reject: homogeneous boxes obscure artifacts versus controls; an illustrated fortress
  would falsely suggest complete protection against unmodelled channels.
- Acceptance: follow one output through both fences, then identify who authorizes it
  and who receives it. Labels remain at 9pt in a native 4.5-inch column.

## VIII/fig:sealed-two-worlds

- Reader question: what can Erin observe when the secret changes but its parity does not?
- Claim: equal-parity secrets produce the same observable log at each step of the shown
  load/read/submit/release trace; the raw-secret mutation breaks that equality at release.
- Grammar: shared-step two-run comparison, plus a separate observed counterexample.
- Evidence: c1_noninterference.py, secrets 0 and 2; empty logs until release, then
  ((gate,0),) in both honest runs and ((gate,0),)/((gate,2),) with the leaky gate.
- Counter-reading: compare observations, not internal states; the secret inputs do differ.
  One shown trace does not prove unbounded noninterference. The caption retains depth 7
  and the four-secret domain; the chapter retains the bypass mutation separately.
- Reject: a branch in one run would erase that these are two separate executions.
- Acceptance: identify the differing inputs, equal output observations, and the exact
  mutation that makes the pair distinguishable. No repeated whole-figure heading.

## Review status

Parent inspected the Book-size proof and the assembled pages: folios 154 and 156.
Both use the private Suisse profile and native 9pt diagram labels. Their measured
ink widths are 323.85pt and 316.85pt against a 325.215pt body column; no scaling.
The model was rerun, and the exact honest/mutated logs are protected by regression
tests. This is finite-model evidence, not a deployed confidentiality guarantee.

The full rebuild exposed neighboring Figure 3.9's caption displaced 35.5pt above
its owner. Its redundant wording was shortened, preserving the honest-mechanism
versus malicious-channel-capacity distinction. See the batch handoff for the
final rebuilt caption check and the separate unresolved prose-baseline queue.

The skill atlas now reflects the actual claims: component/control flow rather
than a repeated four-checker table, and observer logs rather than equal internal
states. Parent review is not author approval; nothing in this batch is published.
