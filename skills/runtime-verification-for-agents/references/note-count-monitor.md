# Note-count monitor contract and fixture

This reference scopes the worked example to one monotonically increasing count
for one immutable session generation. It is useful for detecting count
decreases across covered observations; it does not prove note identity,
authorship, append-only behavior, or prevention. See [monitoring boundary and
evaluation](monitoring-boundary-and-evaluation.md) before making stronger
claims.

## Required source contract

A real adapter must provide a consistent committed read with exact session ID,
immutable generation ID, active/closed/missing state, a nonnegative safe integer
count, and a source revision `{ generation, sequence }`, and an authoritative high-water
mark with the same generation and sequence. The source adapter must provide an atomic compare-and-set operation for a
baseline advance, conditioned on the exact prior property/session/generation/
count/revision, and must guarantee that the high-water mark is current and that
the read is transactionally consistent; a stale revision behind that mark is `UNKNOWN`. Revision sequence
must be monotone within that generation. Baseline and closure receipts must bind the property version, session ID, generation, and exact closed source
revision, then be verified by the trusted source adapter. A boolean fixture
verifier here is not cryptographic evidence.

Initial baselining is explicit and requires an authenticated, one-use receipt
binding the property version, session ID, generation, exact baseline count, and
exact source revision. The adapter atomically claims that receipt and persists
the baseline record; a replay or second claim is rejected. After restart, call
`restoreBaseline` from the durable authority. If the record is missing or does
not match the expected active generation, return `UNKNOWN`; a new count is never
substituted for continuity.
Checks without an in-memory baseline return `UNKNOWN` until the durable record
is restored. Calling initial-baseline setup after a monitor gap cannot replay a
consumed receipt; any separately authorized new baseline epoch must be declared
explicitly and cannot prove continuity across that gap. Baseline setup cannot
replace an existing baseline.

For each active snapshot, validate shape before numeric comparison:
`Number.isSafeInteger(noteCount) && noteCount >= 0`; revision and high-water
sequences must also be nonnegative safe integers and equal for the same
generation. `NaN`, infinities, fractions, negatives, strings,
missing fields, generation mismatch, session mismatch, stale revision, and
revision regression return `UNKNOWN`, never `PASS`. Every accepted newer nondecreasing observation must atomically compare-and-set
the durable baseline against the exact prior property/session/generation/count/
revision before updating in-memory state. A stale CAS or persistence failure is
`UNKNOWN`; after restart, restoration must return the advanced durable count and
revision. A count decrease at a newer revision returns `VIOLATION` while
retaining the last verified count and revision. An equal revision with changed count is inconsistent and returns
`UNKNOWN`. An older revision cannot advance the baseline even if its count is
higher.

A closed state retires a baseline only with a valid closure receipt for the same
property version, session ID, and generation, bound to that closed snapshot's
exact source revision. The adapter must persist retirement before the in-memory
monitor forgets the baseline; failed persistence stays `UNKNOWN`.
A missing row, wrong-generation receipt, or unverified active-session inventory
remains `UNKNOWN`. A verified empty active inventory yields no session findings
only when there are no previously tracked baselines; an unverified empty inventory
is itself an `UNKNOWN` finding. A re-opened/reused ID requires closure of the old
generation and a new authorized baseline for its new generation.

The runnable implementation under `examples/` and deterministic fixtures under
`tests/` exercise these cases against in-memory objects only. Their verifier
methods model the real adapter contract and do not prove a production store,
receipt signer, query consistency, event completeness, or effect controller.
