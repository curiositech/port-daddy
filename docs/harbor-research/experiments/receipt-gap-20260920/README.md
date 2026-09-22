# Receipt-gap experiment: archived evidence and offline reproduction

## Evidence identity

This package preserves the reviewed historical **run-02**, not a new measurement
renamed to run-02. The original script, registered protocol, and result JSON are
byte-for-byte copies. Their hashes are in [provenance.json](provenance.json).
No raw SQLite databases are included.

- [Original protocol](original/PROTOCOL.md): predictions and assumptions registered
  before run-02, including its stronger receipt/effect/key/payload gates.
- [Original script](original/receipt_gap_experiment.py): historical executable source.
- [Measured run-02 JSON](experiment-results.json): all before/after rows,
  child exit codes, 22 declared gates, restoration cases and nine oracle mutations.
- [Compact 4 × 3 matrix](matrix.json): a deterministic projection of that JSON,
  suitable for the Book figure. It is derived data, not another experiment.
- [Provenance](provenance.json): origin, hashes, environment and adaptation changes.
- [Repository runner](../../../../scripts/harbor-research/receipt_gap_experiment.py)
  and [tests](../../../../tests/harbor-research/test_receipt_gap_experiment.py).

Historical result SHA256:

`e93863430b6b09d7845aa637304e719114e60c9444529deb3fc1ed6cadbc7a38`

## Measured matrix

Cells are **effect count / sender state**, after one recovery attempt.
Each effect appends 10 synthetic units. These are deterministic finite cases,
not rates or sampled probabilities.

| Cutpoint | Journal retry | Journal hold | Receiver dedup |
| --- | --- | --- | --- |
| No crash | 1 / done | 1 / done | 1 / done |
| Before effect | 1 / done | 0 / pending | 1 / done |
| After effect, before receipt | 2 / done | 1 / pending | 1 / done |
| After receipt | 1 / done | 1 / done | 1 / done |

The two pending histories have identical sender rows but different receiver
effects (zero versus one). A receipt must identify an actual effect with the
expected key and payload; in the dedup arm, exactly one retained key/payload/
receipt row must bind that same effect. These joins passed for all four primary
dedup cases and all four restoration cases. A journal's “done” bit alone is
not the validator.

At-most-once safety alone is possible by never retrying. Useful recovery is an
**additional obligation**: the hold policy avoids duplicates here but neither
completes the pre-effect case nor resolves the after-effect uncertainty.
Pending means unknown, not certified failure or success.

### Known negative evidence

- Deleting the receiver's retained key after its commit yields **two effects**.
- Marking the sender done before the effect yields **zero effects and a false
  done/receipt-999 record**.
- An intact receiver rejects a changed payload without any stored-state change.
  Disabling its binding check accepts the mismatch and returns the old receipt
  for the original payload; unchanged rows do not make that response valid.
- Nine deliberately corrupted receipt/key/payload links are rejected by the
  post-run oracle. The full result names each corruption.

These passing negative-control checks mean the deliberately broken variants
were caught. They do not mean those variants are safe.

## Reproduce locally

Python 3.9+ standard library only. Run from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B \
  scripts/harbor-research/receipt_gap_experiment.py \
  --out .cache/receipt-gap-reproduction-20260920-01

PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -B -m unittest discover \
  -s tests/harbor-research -p test_receipt_gap_experiment.py -v
```

Choose a new output directory for every invocation. Existing directories are
refused, not cleaned. Scratch is limited to a strict child of repository
`.cache`, or a strict child of `~/coding/tmp` **outside the repository**.
Broad roots, repository source directories, symlink aliases, unmarked worker
cases, mismatched run markers, and aliased databases/journals are refused.
The marker is an accidental-misuse guard, not authentication or protection
against a malicious filesystem racing the process.

Fresh results say `run_kind: fresh-reproduction`, have their own UUID and current
script hash, and reference the historical result hash. Their hashes must never
be substituted for run-02's. The original protocol's historical invocation/path
restriction is retained unchanged; use the repository command above now.
Do not execute the archived script in the evidence directory: it would write
synthetic databases alongside the archive.

### Registered reuse gate (before repository smoke execution)

Fail packaging validation if any of these fails:

1. All three historical artifact hashes match; the compact matrix projects
   exactly from the historical raw rows.
2. The fresh run's primary, mutation, binding, restoration and oracle records
   and its 22 declared checks equal the historical JSON, excluding environment
   and fresh-run provenance fields.
3. Independently asserted raw rows reproduce the 4 × 3 matrix, the two-history
   witness, all eight intact/restored dedup joins, and the known broken variants.
4. All nine original oracle corruptions are rejected. Fresh-only checker tests
   also reject a forged count hiding a second effect and a Boolean receipt.
5. In recovery tests, a connection guard rejects any read outside the sender DB
   and a forbidden controller snapshot raises. The request-response interface
   is stubbed only for this isolation test; the separate crash matrix uses the
   actual SQLite mock receiver.
6. Wrong-payload retry rejects unchanged. A fresh-only SQLite trigger forces
   failure between effect insertion and key insertion: both must roll back.
   Removing the trigger must restore the ordinary receiver behavior.
7. Existing outputs, source paths, unmarked/aliased fixtures, and mixed CLI modes
   are refused before unintended writes. A simulated worker timeout is not
   retried. Generated databases remain under scratch, never in this package.

The packaged checker accepts both SQLite tuple rows and deserialized JSON list
rows, closes connections explicitly, and checks raw-row/count consistency.
These are reuse/checker changes, not retroactive claims about the original
script. The three policy algorithms, cutpoints, transaction boundaries, payload,
single-recovery schedule and original mutation semantics are unchanged.

## Budget and observer boundary

Each complete matrix execution launches exactly **36 workers**: 24 primary,
4 mutation, 8 restoration. Binding checks are direct controller calls and add
no workers. Each worker has a five-second timeout, with no infrastructure retry;
180 seconds is the sum of worker wait bounds, **not** an end-to-end wall-clock
guarantee. The test driver caps its one fresh matrix at 190 seconds. Additional
test CLI launches only check refusal paths; they do not launch crash workers.
No matrix reruns occur automatically on failure.

The test suite retains its distinctly named fresh result and tiny synthetic
stores in `.cache/receipt-gap-tests/reproduction-*/` and prints the exact data
path/hash. These caches are not publication artifacts. Tests and script use no
network, PD, paid calls, credentials or real payment effects.

Sender recovery reads its journal and the response from a requested operation.
The controller separately observes both stores before/after recovery; those
observations are never passed into the recovery decision. The receiver runs in
the worker's OS process as a mock API backed by another database. Thus this is
**code/interface-level observer separation, not OS-enforced process isolation**.

## Claim and transfer limits

| Status | Supported statement | Boundary |
| --- | --- | --- |
| Measured, historical run-02 | This local finite crash fixture produced the recorded matrix and caught its declared negative controls. | Not statistical generalization or product evaluation. |
| Derived from the interface and observed pair | The same pending sender state is compatible with no committed effect or one committed effect. | Not a new general impossibility theorem. |
| Reproduction/test evidence | The packaged implementation preserves the recorded experiment and tests observer isolation and misuse guards. | Fresh checks have their own provenance; they were not run-02 observations. |
| Not tested/proposed only | Transfer to an actual broker/provider or independent irreversible sink. | Requires a separately authorized protocol; not attempted here. |

Receiver dedup assumes serial requests, retained namespace/key/payload bindings,
and atomic storage of effect and key **in the same SQLite transaction**. The
“effect” is a mock database row, not a charge or external irreversible action.
No claim is made about concurrent clients, key expiry, malicious receivers,
cancellation, provider adapters, power loss/fsync guarantees, or indefinite
unavailability. Key deletion demonstrates one excluded regime only.

Queryable operation status, naturally idempotent effects, distributed
transactions and reconciliation are alternative receiver contracts. A sender
outbox alone does not give an arbitrary external sink this mock's contract.
No system-wide exactly-once or Paper 8 implementation claim follows.
