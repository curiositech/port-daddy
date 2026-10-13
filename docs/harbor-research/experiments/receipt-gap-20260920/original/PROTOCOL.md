# One experiment: the missing-receipt crash window

Initial registration preceded execution of `receipt_gap_experiment.py`.
Amendment before run-02: require receipt/effect/key/payload joins in every intact
receiver-dedup case, including all restoration cases, and test the stronger
oracle against nine in-memory corruptions. Run-01 is retained as preliminary;
its count/state-only receiver gates are insufficient for the final claim.
This is an offline local-storage experiment, not a Paper 8 system evaluation.
Any subsequent observations belong in `experiment-results.json`, not in the
candidate Book note as an empirical claim.

## Question and intervention

Does retrying a pending operation after a worker dies duplicate its effect when
only the sender keeps the deduplication journal? Compare three recovery policies:

| Policy | Recovery from pending | Receiver contract |
| --- | --- | --- |
| `journal_retry` | Send the same request again | Append every request; no deduplication |
| `journal_hold` | Return unknown; do not send | Append every request; no deduplication |
| `receiver_dedup` | Send the same request again | In one transaction: bind the namespaced key to the payload, append one effect, retain the binding; on identical retry return the stored receipt; reject changed payload |

The sender journal and receiver use separate SQLite databases. A child worker
executes a synthetic payment of 10 units, then exits abruptly at a declared
cutpoint using `os._exit(70)`. A new child performs one recovery attempt. No
network, credentials, daemon, model, Git command, or real payment is used.

The four schedules are: no crash; after durable intent but before sending;
after receiver commit but before local receipt; after local receipt but before
returning to the caller. This gives 12 policy/schedule cases [derived: 3 × 4].
There is one principal, one key, one request, and at most one recovery attempt
per case. The finite matrix is enumerated, not sampled; there is no seed.

## Observation boundary

The recovery worker sees its local journal and responses to requests it makes.
It cannot inspect the receiver database to choose a recovery action. Only the
test controller reads both databases afterward. This keeps the hidden answer
out of the recovery policy. The controller's post-run oracle is not a product
reconciliation mechanism.

For each case record child exit codes, effect count, total units, local receipt
state, and receiver key count. For a completed operation, require its receipt
to identify the recorded effect with the expected key and payload. In the
receiver-dedup arm also require exactly one retained key record, whose key,
payload, and receipt match that same effect. Apply these joins to all four
restoration cases, not just the primary cases. Save state *before*
recovery as well: the two pending histories must look identical to the sender
while the effect counts differ. A completed local row with no effect is a false
completion; a pending row is an unknown outcome, not a certified failure.

## Preregistered gates

These are predictions, not measured results:

| Schedule | Blind retry: effects / state | Hold: effects / state | Receiver dedup: effects / state |
| --- | --- | --- | --- |
| No crash | 1 / done | 1 / done | 1 / done |
| Before effect | 1 / done | 0 / pending | 1 / done |
| After effect, before receipt | 2 / done | 1 / pending | 1 / done |
| After receipt | 1 / done | 1 / done | 1 / done |

Fail the narrow retry-safe implementation claim if any receiver-dedup case has
more than one effect, falsely reports completion, or cannot finish after this
one injected crash once storage and the worker are available. Fail the witness
if the before-effect and after-effect histories expose different sender state.
Do not call hold a recovery success just because it avoids duplicates: its
before-effect case leaves an unpaid bill, and its after-effect case remains
unresolved locally.

Negative controls must be caught:

1. Delete only the mock receiver's retained key after the effect-before-receipt
   crash. The retry must expose a second effect (retention matters).
2. Mark the local operation done before sending, then crash before the effect.
   Recovery must expose false completion with zero effects (write order matters).
3. Retry a retained key with a different payload. The intact receiver must
   reject it without changing the effect or receipt; an explicit binding-check
   mutant must be caught accepting the mismatch (key binding matters).

The script then reruns the four intact receiver-dedup schedules in fresh
databases. These four restoration checks are additional to the 12 primary
cases. Nine in-memory oracle controls corrupt local receipt/key, effect
receipt/key/payload, retained receipt/key/payload, or remove the retained key;
the strengthened validator must reject each. They add no worker launches.
All retained experiment databases are tiny and recoverable.

## Run

From this sidecar directory, choose a fresh child output directory:

```sh
/usr/bin/python3 receipt_gap_experiment.py --out run-02
```

Python standard library only. The script refuses an existing output directory
and refuses output outside its own sidecar directory. Every worker has a
five-second timeout. Exact launch count: 12 primary pairs = 24,
two crash/recovery mutation pairs = 4,
four restoration pairs = 8: **36 child launches maximum** [derived]. Payload
binding checks execute directly in the controller against separate mock
databases. Normal execution should take seconds; the timeout bound is 180
seconds, with no retries on infrastructure errors.

Read `run-02/experiment-results.json` and the retained SQLite stores. Exit zero
means the declared finite gates and mutation checks passed; it is not a proof
about arbitrary schedules or the canonical runtime.

## Falsification and transfer boundary

The equal-local-state pair derives the ambiguity of this chosen interface; the
finite crash run tests its implementation. Neither is a new general
impossibility theorem. A real receiver may supply a queryable operation record,
a naturally idempotent operation, a distributed transaction, or another
reconciliation protocol; those are alternative contracts, not counterexamples
to the restricted sender-only witness. At-most-once safety alone can also be
obtained by never retrying; the missing obligation is useful recovery without
duplicate effects or false completion.

The receiver-dedup arm assumes serial requests, retained namespace/key/payload
bindings, and atomic effect-plus-key storage in the same database. It does not
test a sink whose irreversible effect is outside that transaction, key expiry,
concurrent clients, malicious receivers, cancellation, provider adapters,
power loss/fsync guarantees, or indefinite unavailability. A transactional
outbox alone does not make an arbitrary external sink obey this contract.
The key-deletion control demonstrates one excluded regime; it does not model
all retention failures.

Before any Paper 8 product claim, repeat the same cutpoint/oracle protocol on
the actual authorized broker and receiver, with its retention and request-binding
contract declared. That follow-on is not authorized or attempted here.
