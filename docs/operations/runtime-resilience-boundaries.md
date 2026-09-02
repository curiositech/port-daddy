# Backend recovery boundaries

This is the source contract for `lib/agent-resilience.ts`, the optional dependency
loader, and dispatch failure decisions. It is not a daemon-deployment receipt.

## Retry and circuit ownership

Every attempt obtains a generation-bound lease from `BackendCircuitBreaker`.
Closed circuits may admit concurrent operations. A recovering circuit admits
exactly one physical probe, even when `successThreshold` requires several
sequential successes. Settlement is idempotent; an old generation cannot clear a
new outage. Permanent task failures do not count as backend failures or as proof
of recovery.

`runResilientSpawn` applies one total deadline to operations and backoff, default
60 seconds. The callback receives an `AbortSignal`. Callers may choose another
positive integer budget up to the platform timer maximum (2,147,483,647 ms).
Cancellation and deadline errors are non-retryable. A server minimum that cannot
fit the remaining budget is returned as a terminal disposition, not shortened
to a local backoff cap. Multiple textual Retry-After hints preserve the longest
minimum, including exception causes; malformed, negative, fractional, unsupported
date, or overflowing hints do not silently fall back to a faster retry.

Abort requests do not prove a provider stopped. An abandoned operation keeps an
admission reservation until its underlying promise actually settles. Late
success releases that reservation but cannot close a newer circuit generation.
An operation that never settles therefore requires actual host/runtime repair;
cooldown alone does not authorize overlapping replacement work.

The dependency loader uses the same admission and deadline mechanics. Its
`any-failure` circuit policy tracks **dependency availability**, not permission
to retry a failed call: a permanent authentication error gets one attempt,
while repeated missing-native-library calls still enter cooldown. Concurrent
loads coalesce, successful values cache, and late timed-out results never seed
the cache. A healthy post-cooldown probe restores availability.

## Error provenance and diagnostic privacy

Classification examines own data `status` and `statusCode` fields on concrete
exceptions and bounded, cycle-safe causes. Permanent structural facts outrank
transient prose, including conflicting fields on the same exception. Accessors
are never invoked and cannot regain transient authority through their message.
Text classification remains a dependency-compatibility input; it is not a
credential to spawn another agent.

Dispatch accepts recoverable failures only when their exact error object has
an in-process host witness. The foreground adapter creates this witness from
an actual child OS error. A foreground timeout remains non-authorizing: direct
child close does not prove that descendants stopped, and this launcher does not
own a process group. It signals only its child, never a guessed group. It never
parses stderr, model output, or tool JSON into transport authority. A JSON clone
does not retain the witness. Actual ENOENT can skip a useless same-backend retry;
unknown failures and permission failures cannot authorize successors. Existing
cost, frozen-chain, successor-cap and salvage policies still apply.

Structured resilience diagnostics use closed error codes and safe labels, not
raw exception messages or stacks. Known backend aliases remain readable;
custom backend/dependency identifiers become bounded opaque correlation tags.
Those tags are not encryption. Governed log keys use the same safe labels so
suppression rollups cannot reintroduce a private dependency name. Existing
request, actor and tenant correlation remains attached; the logger's separate
correlation-input contract is unchanged. Display errors elsewhere are not
claimed scrubbed by this bounded slice.

## Verified boundary and remaining integration

Source tests cover competing probes, stale and repeated settlement, cancellation
in backoff, operation-plus-sleep deadlines, oversized retry hints, uncooperative
loads, actual child-event fixtures, a synthetic child/grandchild surviving the
parent's timeout, and the real LogGovernor/correlation sink.
No live provider calls or real secret fixtures are needed.

The daemon uses `createConductorSpawnAdapter`, not the foreground adapter.
Current Conductor/spawner results preserve display strings but do not produce
the process-local failure witness. The shared runner now refuses to manufacture
successor authority from those strings; a regression exercises that actual
Conductor adapter. **Positive production recovery is still unwired.** It needs
an independently reviewed spawner-lifecycle transport slice, coordinated with
the separate spawned-worktree binding work. This document does not imply that
all backend callers use `runResilientSpawn`, that the canonical daemon was
restarted, or that any provider-side effect was cancelled successfully.
