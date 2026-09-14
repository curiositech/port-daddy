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
that logical request. The object compares and commits atomically. A replay
returns its original receipt only while that receipt is still current; it
never writes again. A delayed resume or a replay after a newer pause is
refused. Emergency `{ paused: true }` remains unconditional. Fresh unknown
state must first be explicitly paused before any resume can be authorized.

Pause prevents new ship admissions after the committed toggle. Work already
admitted may drain through its existing bounded model/sandbox deadline and
publish its receipt; this is not an instant kill. Human editing and evidence
access are unaffected by this global automated-work gate.

Paused or unknown runs report a failing required check with the reason that
review was not performed. Relay health exposes `paused: null`,
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

The D1 state-constraint replacement migration must be applied before this code;
it preserves existing rows, generations, indexes and structured legacy suspension
markers. It adds the durable requeue authorization ledger. Queue send and D1
admission are not atomic: a crash after claiming admission but before send may
leave `admitting` work requiring repair; it cannot justify automatic requeue.

The merge-group event currently lacks verified constituent review receipts.
Its required Fleet check therefore fails with an explicit coverage hold.
Returning that check to success requires a separate implementation that
verifies every constituent PR and exact head's completed review evidence.
Queue CI alone is insufficient.

## Release state

These changes are source-built and locally tested, not deployed. Relay's new
SQLite Durable Object migration and exported service entrypoint must exist
before the executor binding is deployed. New object state is unknown by
default; no KV migration silently resumes Fleet. The authorized operator must
explicitly set the desired control state through the existing account control.
This change does not authorize deployment, resumption, or paid runs.

Local tests exercise parser rejection, serialized toggle/admission ordering,
pause/resume revisions, storage failure, stale KV isolation, and bounded drain.
The recovery lifecycle tests use real HMAC webhook admission, the actual consumer,
the full SQLite migration chain and the control-object implementation, with mocked
GitHub/provider boundaries. They do not invoke providers or deploy Workers.
The in-memory storage fixture is not a live Cloudflare restart/durability test;
deployment and real multi-region observations remain unverified.
