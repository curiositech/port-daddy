# Fleet pause authority

Global Fleet control lives in Relay's `FleetControl` Durable Object, named
`global`. The signed-in operator gate on `POST /v1/fleet/pause` remains the
only public write route. An internal `FleetControlService` binding admits
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

Suspensions carry the durable `pd-fleet-suspension:v1` check marker and a
retryable intent reason, rather than a terminal model verdict. The queue
acknowledges a suspended message without scheduling automatic retries. An
explicit redelivery after a transient outage can resume at the original
epoch; a real pause/resume requires a new delivery because its epoch changed.

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
The in-memory storage fixture is not a live Cloudflare restart/durability test;
deployment and real multi-region observations remain unverified.
