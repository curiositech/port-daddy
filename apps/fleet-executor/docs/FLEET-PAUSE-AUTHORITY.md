# Fleet pause authority

Global Fleet control lives in Relay's `FleetControl` Durable Object, named
`global`. The signed-in operator gate on `POST /v1/fleet/pause` remains the
only public global-toggle route. An internal `FleetControlService` binding admits
executor work; it exposes no HTTP admission or resume endpoint.

The object commits `{ paused, revision, pausedAt }` and its monotonic revision
counter in one storage transaction before acknowledging a toggle. Every new
ship consults that same object. A run binds its next ship to the revision it
first observed. The object durably retains that binding by repository and run
ID across queue redeliveries and continuation messages. XO editing, XO triage,
and Mediator admission also require it. A pause/resume cycle invalidates that
run's old admission; a new explicitly requested delivery gets a new run ID.
Missing bindings, absent/malformed records, failed reads, and revision drift
deny new work. Existing KV pause strings cannot authorize anything.

Resume requires `{ paused: false, expectedRevision, requestId }`. The revision
must be the positive revision the operator observed; `requestId` identifies
that logical request. Relay first prepares an immutable target revision while
the object remains paused, writes the compatibility projection for that target,
then commits the prepared revision. Direct unpause through the object's generic
setter is refused. A replay returns its original receipt only while that receipt
is still current. A delayed resume or a replay after a newer pause is refused.
Emergency `{ paused: true }` remains unconditional. Fresh unknown state must
first be explicitly paused before any resume can be authorized.

Pause prevents new automated admissions and is rechecked at each paid call and
external-effect boundary. A provider request already in flight cannot be
physically recalled and may consume until its bounded deadline, but its output
is discarded after the control fence changes and cannot authorize a later
review, continuation, mediator effect, or terminal verdict. Human editing and
evidence access are unaffected by this global automated-work gate.

Paused or unknown runs attempt to report a failing required check with the
reason that review was not performed. That visible receipt is best-effort: a
GitHub token, check-creation, or check-completion outage can leave the check
absent or pending, but never passing. Branch protection and the durable intent
hold remain fail-closed while the receipt is repaired. Relay health exposes `paused: null`,
`pauseStatus: "unknown"`, and `automationBlocked: true` for unknown authority;
the project verdict controls show Unknown and remain disabled. FleetBar and
pd-console also preserve and display Unknown, including missing, null,
malformed, or contradictory health fields.

Suspensions carry the durable `pd-fleet-suspension:v1` check marker and explicit
`waiting_for_control` intent/transcript state, rather than a terminal model
verdict or provider retry. Health counts waiting work separately and excludes
it from retry counts and queue estimates. Activity and receipts prioritize the
hold even if an older transcript header says failure. The GitHub required check
still fails: a control hold is not a passing review.

The queue acknowledges a durably recorded suspension without scheduling retries.
Ordinary duplicate webhook or consumer deliveries cannot reopen it. An operator
can POST `/v1/fleet/control-requeues/:deliveryId` with `{ expectedRevision,
requestId }` using account operator or break-glass authorization, then redeliver
the original GitHub webhook. This grants one signed redelivery; it does not
queue or run work itself. Cookie/read-capability access cannot authorize it.
Issuance and actual webhook admission both consult the run-bound control epoch.
One conditional admission wins duplicate races. The durable request ID and
suspension incarnation prevent reusing a grant after a second suspension.
A real pause/resume cycle requires a new delivery because its epoch changed.
Queue-send failure remains explicitly retryable under the same checked epoch.
Missing admission storage fails closed, without the former unchecked enqueue.

Dead-letter repair follows the same control contract. It rechecks the global
and repository authorities after claiming the repair and immediately before
token minting, check lookup, every GitHub check mutation attempt, telemetry,
and any automatic retry decision. OFF or unknown moves the intent into the same
durable control hold and acknowledges the dead-letter message without a GitHub
mutation or another scheduled attempt. Resume alone cannot reopen that hold.

Relay also writes the existing `fleet:paused` KV record as a deny-only
compatibility projection. Pause writes `true` to KV before the Durable Object
transition. Resume prepares while the Durable Object is still paused, writes
KV `false` for the prepared target revision, and only then commits that exact
Durable Object revision. A failed false projection leaves canonical authority
paused; a failed or superseded commit restores the KV denial best-effort while
the canonical object remains paused. Relay acknowledges only after the prepared
projection and commit both succeed. This is defense in depth, not mixed-version
authority: [Workers KV is eventually consistent](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
so a cached `false` can remain visible elsewhere after the write. Current executors still require the
canonical Durable Object receipt; a readable KV false never authorizes work by
itself, while true, missing, malformed, or unreadable KV state can only add a
denial during the rollout window.

The Durable-Object-aware executor is therefore the minimum safe deployment and
rollback floor. The Relay service entrypoint and Durable Object must exist in a
fail-closed unknown or paused state before the executor can bind to them. The
new executor must then serve 100% of queue traffic before any operator resume is
accepted; do not use a gradual deployment with an older executor, and do not
roll back beneath this floor. Only after that floor and the paused readback are
proved may the account control be treated as operational. If the floor cannot
be proven, stop or drain the queue consumer rather than relying on KV
propagation. This source change does not perform or authorize that deployment.

The additive D1 control-waiting migration must be applied before this code. It
keeps the original intent table and state constraint intact for rollback, adds
`control_waiting_at`, `control_wait_count`, and `requeue_revision`, and adds the
durable requeue authorization ledger. Raw terminal `state = 'cancelled'` plus a
non-null `control_waiting_at` is projected as logical `waiting_for_control`, so
a rolled-back executor stays inert. Legacy `retrying` rows carrying the bounded
`Fleet suspended:` marker remain recognized without a destructive backfill. Authorized
redelivery clears the marker while conditionally returning the row to
`admitting`. Queue send and D1 admission are not atomic: a crash after claiming
admission but before send may leave `admitting` work requiring repair; it cannot
justify automatic requeue.

The merge-group event currently lacks verified constituent review receipts.
Its required Fleet check therefore fails with an explicit coverage hold.
Returning that check to success requires a separate implementation that
verifies every constituent PR and exact head's completed review evidence.
Queue CI alone is insufficient.
The coverage hold does not require an AI binding. Token, check creation
and completion failures propagate to the queue's bounded retry path, with the
merge-group SHA preserved in durable attempt/failure evidence. A retried hold
reuses its exact App/run-bound check instead of silently acknowledging an absent
gate; the dead-letter handler also understands the merge-group head.

The admission ledger is mandatory execution authority. A missing D1 binding,
missing or mismatched intent row, non-runnable state, failed attempt-claim write,
or changed attempt cursor denies execution before model work. Hot boundaries
recheck that exact durable attempt; there is no compatibility path that may
downgrade missing authority to unowned execution.

## Release state

These changes are source-built and locally tested, not deployed. The executor
deployment workflow is manual: merging source does not activate or spend. The
activation sequence is (1) install the production Relay migration, service
entrypoint, and Durable Object while its state remains unknown or explicitly
paused; (2) deploy and verify the Durable-Object-aware executor at 100%; (3)
read back the paused state through both authority and operator surfaces; and
only then (4) let the authorized operator explicitly resume. No KV migration
silently resumes Fleet. This change does not authorize deployment, resumption,
or paid runs, and pre-control executor versions are not valid rollback targets
after activation.

Local tests exercise parser rejection, serialized toggle/admission ordering,
pause/resume revisions, prepared-but-not-committed admission, rollback-projection ordering and partial failure,
storage failure, stale KV isolation, exact-attempt continuation takeover, and
attempt takeover during reducer calls. Dead-letter tests cover global pause,
unknown authority, repository OFF, post-claim pause, pre-mutation pause, and
OFF replacing an otherwise automatic repair retry.
The recovery lifecycle tests use real HMAC webhook admission, the actual consumer,
the full SQLite migration chain and the control-object implementation, with mocked
GitHub/provider boundaries. They do not invoke providers or deploy Workers.
The in-memory storage fixture is not a live Cloudflare restart/durability test;
deployment and real multi-region observations remain unverified.
