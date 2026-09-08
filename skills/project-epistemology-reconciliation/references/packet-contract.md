# Packet contract

The packet is a single-scope, local declaration audit. It is not a signed
authorization envelope, event-store export or complete logical proposition
language. Unknown properties are rejected so misspelled safety fields cannot
quietly disappear. All properties in the schema are required.

- `schemaVersion`: exactly `1`.
- `method`: solo or independent; claims of independence require independent
  mode, sealed first positions and the same frozen input. These are declarations,
  not an isolation measurement.
- `scope`: opaque single-scope ID, source head and current nonnegative revision.
- `decision`: draft or ready, named Steward and owner, opaque proposal digest,
  execution request, operator halt, and declared authority verification.
- `cost`: whether paid work is requested, known telemetry, aggregate reservation
  and nonnegative USD cap. Paid requests require all three safeguards and a
  positive cap. The check does not enforce a provider's spending limit.
- `evidence`: unique IDs, scope, declared authorization and source/observation/
  inference/missing warrant. Cross-scope evidence fails this deliberately narrow
  contract even when declared authorized; use a future explicitly scoped
  protocol rather than inventing a merged scope.
- `findings`: unique IDs, warrant class, allegation/verified status, known evidence
  references, disposition and whether unresolved status blocks the decision.
  Verified findings require at least one source or observation and no missing
  or inference-only premise. A hypothesis cannot carry verified status without
  an explicit warrant revision. This cannot establish the source's actual truth.
- `dissent`: one record per rejected finding, with rationale and reopening
  condition. References must resolve; duplicates are malformed. Other findings
  may also carry dissent.
- `preview`: availability, proposal digest, source head, state revision and affected outcomes.
  The exact proposal, source head and revision must match, including while drafting; a draft
  with missing preview is valid input but returns a reconciliation finding.

`draft` permits open findings; `ready` permits neither open/escalated findings
nor active blockers, including accepted or deferred blockers. `blocking: true`
means the blocker remains active; acknowledging it does not resolve it. Any
rejected finding needs a dissent record. A ready
packet also needs declared decision authority. An explicit halt blocks declared
execution or paid work even if every other field looks ready. Drafting without
those actions can continue during a halt.

The auditor returns `pass`, `findings` and `recommendations`. Each finding has
one of three stable anti-pattern IDs, a path and a human-readable explanation.
It deliberately has no aggregate score: a good preview cannot compensate for
an authority problem. Fixing declarations without checking their real-world
basis is not remediation.

Always retain accompanying case notes with propositions, scope/valid time,
alternatives and evidence limitations. Do not place raw sensitive evidence in
this packet merely because it is local. Retention and disclosure remain separate
authorization decisions. The script neither fetches nor transmits content.
