# Atomic admission: contract and refinement obligations

Status: proposed contract aligned with Blue's global-clock design; final implementation mapping and model results follow in `REPORT.md`. This is White's argument for Root to adjudicate, not a self-issued acceptance.

The protected effect is one named synchronous dispatch database operation. It is not a worker launch, network request, Git merge, or any other effect performed after the database transaction. An accepted database mutation cannot retrospectively authorize an already performed external effect.

## Binding and linearization

Let a token carry `(database instance, revision, authority epoch, policy identity, model identity, operation, immutable input, decision, completeness)`. Database-instance binding may be supplied by an opaque, process-local handle accepted only by its issuing authority. Every successful SQL `INSERT`, `UPDATE`, or `DELETE` on `dispatches` advances a durable global revision, including metadata writes and SQL updates whose visible state label does not change. Trigger installation precedes migration insertion. Initialization must preserve existing revision state; deletion and recreation never reset the clock. Revision overflow must fail closed rather than reuse an old value.

Issuance records an actual row/database snapshot and the trusted current authority. It does not authorize an effect. The checker is trusted to produce `safe` only after complete exploration of its declared finite model under its declared policy; `unsafe`, `unknown`, timeout, malformed output, and incomplete exploration do not admit a mutation. Root must separately adjudicate whether this checker and graph faithfully represent the required policy. A default policy with no denied states can provide useful mutation-binding tests but proves no substantive conflict prohibition.

Consumption obtains the SQLite write reservation, compares the token to current durable revision and trusted authority, verifies its exact operation and immutable input, and performs the named synchronous operation in that same transaction. A later read-then-write comparison is insufficient. No asynchronous callback or externally visible effect belongs inside this atomicity claim. A failed comparison performs no protected mutation; an operation failure rolls its database writes back. The receipt/token lifecycle must prevent replay, including operations that produce only an abstract stutter or no physical write.

Exact request binding does not establish the provenance of caller-supplied snapshots. For preparation rollback, the successful preparation must issue its opaque rollback token after its own write and before returning to the caller's await. Restoration consumes that same token. It must not accept old `before`/`prepared` snapshots and issue a fresh token around them: an intervening timestamp/state ABA can make those snapshots look eligible while the new token certifies only the current revision. The rollback mutation therefore has no public fresh-issuance route or permissive snapshot overload.

Configuration authority is distinct from token fields. A caller cannot make its token current by echoing its own model or policy digest. Replacing a policy/model is a trusted administrative operation that advances the authority epoch. An omitted or identical installation may preserve the epoch; changing A to B and back to A must advance it twice. Canonical identities bind exact semantics, including the writer relation, label abstraction, policy specification and checker version. They are not freely asserted labels or evidence of a signature.

## Safety argument

Assume: (H1) trigger integrity and a non-reused global clock; (H2) serialized atomic compare-and-effect transactions; (H3) non-forgeable local token identity, immutable request binding and correct single-use lifecycle; (H4) current, trusted authority installation with non-reused epoch; and (H5) sound checking of a complete abstraction over the named writer domain.

At a successful consumption's linearization point, equality with the issued global revision excludes every committed intervening dispatch mutation by H1. Equality with the authority tuple excludes every intervening installation by H4. H2 excludes an unobserved write between comparison and effect. H3 supplies the exact checked operation/input and excludes replay. Thus the applied operation has the same input state and authority as the accepted check. H5 can then transfer the declared finite-model safety result to this operation. Without H5 the first four hypotheses establish freshness and request binding only. None establishes complete mediation of arbitrary database users or external effects.

Rollback preserves committed database state. Whether a failed token is burned or retryable is an implementation choice only if it cannot authorize a different request and any retry rechecks all bindings. A successful return must not be reported before the transaction commits. Concurrent readers, workers and other connections must not create a path around the write reservation.

## Writer coverage

The state graph must cover insertion roots, update edges, deletion, and label-preserving stutters. The required named paths include proposal and auto-claim insertion; projection materialization; nonempty legacy import; claim and next-proposed claim; start; produce; request-review; accept/reject; settlement shortcuts; cancel; prepare-for-run and compare-and-set restoration; requeue and salvage recovery; execution-identity binding; spawned-agent stamping; and Harbormaster conflict restoration. Schema/bootstrap and any additional source writers belong in Red's independent inventory.

Each concrete successful step must map to an explicit operation-labeled edge or a justified abstraction stutter. Rejected and idempotent calls also need observations. Recovery predicates, retry counters, leases, timestamps, multiple rows and rollback can make the abstract graph an overapproximation; that is safe for universal conflict exclusion only if the model never omits an actual successor. A policy that examines a field discarded by the abstraction invalidates that refinement.

A finite source scanner detects changes in its searched language and file inventory. It does not prove there is no dynamically assembled SQL, unscanned source, privileged database client, malicious trigger replacement, schema reset, backup rollback, or external effect. Database triggers invalidate tokens after out-of-band mutations but do not demand admission for those writes. These are explicit trusted administrative and complete-mediation boundaries, not successful coverage results.

## Preregistered controls

1. A safe, complete, fresh token performs a real accepted effect.
2. An intervening state or metadata write rejects an earlier token.
3. State ABA and delete/recreate reject despite equal visible state.
4. Policy, model and authority-epoch replacements reject earlier tokens.
5. Unknown, unsafe and incomplete checks reject with no effect.
6. Reuse and request substitution cannot authorize another effect.
7. A split compare/effect mutant admits a stale operation after the intervening write; the atomic primitive prevents this interleaving.
8. Failure during a multiwrite operation leaves no partial committed effect.
9. Preparation rollback preserves its original token across the await; a mutant that refreshes admission around stale caller snapshots admits an unauthorized ABA rollback even though its final revision comparison is current.

The finite TLC model will test token binding and the named adversarial interleavings. Blue's SQLite controls must establish the corresponding implementation behavior, including triggers and transaction rollback. The model cannot prove that implementation mapping by itself. Same-host team separation is procedural; no privacy or hostile-code containment claim is made.
