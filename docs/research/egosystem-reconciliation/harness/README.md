# Offline temporal and consequence laboratory

This is D1a: a synthetic, single-epoch replay harness and an adapter to the
existing [Harbor R17 checker](../../../../skills/harbor-results/scripts/b4_deontic_fragment.py).
It is not an event store, authority verifier, daemon route, inference service,
or implementation of the complete proposed event envelope. Nothing here can
accept a real project decision or execute an effect.

From the repository root, with Python 3.10+:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s docs/research/egosystem-reconciliation/harness -p 'test_*.py' -v
PYTHONDONTWRITEBYTECODE=1 python3 docs/research/egosystem-reconciliation/harness/run_cases.py
PYTHONDONTWRITEBYTECODE=1 python3 skills/harbor-results/scripts/b4_deontic_fragment.py
```

All output goes to stdout/stderr. There are no network calls or artifact writes.
The standard library is sufficient. R17 is a fixed repository dependency, not
vendored into the independently portable declaration-auditor skill.

## What this establishes

- Recorded sequence and effective time are independent. A later-recorded,
  backdated exception changes the current understanding of an earlier time,
  without changing what an earlier recorded prefix said.
- Scope exceptions narrow only named scopes of the referenced norm. They do
  not delete the old decision or rewrite an actor's assertion.
- Acknowledgment is not acceptance. Only the debtor accepts/refuses a proposed
  fixture commitment. The beneficiary may cancel an accepted commitment;
  fulfillment requires a visible evidence record matching its named oracle.
  These fixture rules are not a replacement for the production commitment API.
- Departure does not erase a commitment or transfer it to a successor.
- Invalidation marks dependent support as challenged as of the correction;
  it does not silently repeal an accepted norm or cancel a commitment. Analysis
  refuses invalidated premises. Erasure suppresses payloads and derivatives even
  in historical reads; it does not mutate the retained source log.
- Current supplied read access governs old queries. Tenant/project selection
  happens before reference resolution; identical IDs in another tenant do not
  join this stream. Hidden/expired premises suppress their derived records.
- Consequence checks distinguish remote ciphertext storage from server-side
  decryption, and show how a database removal defeats an accepted commitment.

Assertions never enter the world-fact set. Hypothetical proposal atoms are
explicitly labeled in derivation witnesses. Accepted commitments supply a
reserved `commitment-active:<id>` atom, attributable to the commitment and its
acceptance receipt. Rules cannot support themselves through cycles.

## Exact boundaries

Inputs are **already-admitted synthetic records**. Their principal/audience
fields do not authenticate anyone. The supplied current access policy is trusted
fixture input, not proof that production revocation works. The caller already
knows the stream prefix metadata; this is not a timing, scheduling, stream-size,
or distributed noninterference proof. No cache or queue is implemented.

Limits: 4,096 input records, at most 512 in the selected stream, 1 MB serialized
selected stream, 256-character atoms, 128 atoms per list, and 128 visible records
for consequence analysis. Horn closure has a default 4,096 operation budget;
exhaustion raises an error, never a conflict-free answer. R17's pair enumeration
is separately bounded by these input caps. Its existing `_sweep_pairs` scans all
active intervals, including non-clashing pairs: **do not inherit the advertised
output-sensitive scaling bound as a measured property of that implementation**.
A scaling audit/optimized implementation is a gate before large-corpus use.

This adapter uses Horn integrity constraints and O/F conflicts at one query
tick, with ground scope atoms. R17's original sweep separately exercises
exclusive claims and difference constraints. No disjunction, unification,
negation-as-failure, natural-language normalization, similarity matching, or
symbolic intervals are added. `completeWithinFragment` means only closure of
this bounded visible fixture, never completeness of the project's knowledge.

D1b remains deferred: production-envelope conformance, writer-epoch handoff,
append compare-and-swap, effect/uncertain-outcome and aggregate-reservation
state machines, and retained audit skeletons after real payload deletion.
Unsupported epochs and incomplete/reordered prefixes fail closed here.
There is no measured H1–H4 benefit, participant study, or production integration.

## Evidence and mutations

The test suite includes a Horn-propagation mutant that misses an indirect
conflict. Paired fixtures change a hidden premise and verify the public value
does not change; identical names across tenants remain separate; current
revocation refuses an old query. These are finite contract checks, not a security
proof. The original R17 seeded sweep and its independent oracle remain intact.

Owner: current #10108 author for D1a. Research promotion and integration owners,
acceptance evidence, recovery and deferred gates are in
[the integration contract](../final/harbor-integration-contract.md).
