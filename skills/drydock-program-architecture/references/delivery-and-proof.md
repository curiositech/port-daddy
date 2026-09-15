# Drydock Delivery and Proof

The delivery order is designed to fail cheaply. Each stage produces inert,
reviewable artifacts before any more authority exists.

## Stages

| Stage | Build | Must prove | Must not do |
|---|---|---|---|
| D0 | Vocabulary, schemas, hypertree, threat model, diagrams | Closed contracts, DAG validity, explicit unknowns | Start subject or provider |
| D1 | Inert controller transition core | Deterministic lifecycle and crash recovery under fixtures | Create a VM or process |
| D2 | Fake capacity/effect brokers | Conservation, expiry, ambiguity holds, no oversubscription | Hold real credential |
| D3 | Hostile specimen and Trial Basin library | Reproducible faults, minimized counterexamples | Run submitted code on host |
| D4 | VM adapter with no network/shared mounts | Exact image/source witness, kill/reap, canonical checkout absent | Expose provider or Git remote |
| D5 | Zero-network Port Daddy subject in guest | Cold birth, stop, crash, resume, teardown, receipt completeness | Treat guest log as host proof |
| D6 | Test-suite routing and quarantine | Host never executes submitted harness; artifacts are bounded | Auto-import patches |
| D7 | One separately approved provider canary | Provider custody or fresh native allowance, one attempt, settlement | Retry or widen tier |
| D8 | One fixture-repository worker | End-to-end operator journey and reviewed quarantined diff | Touch production repo |
| D9 | Cooperative crew/federation | Global conservation, identity, ordering, remote custody | Infer from single-worker proof |

An active runtime halt caps **promotion and dynamic proof** at T0. It does not
forbid ordinary source implementation of later stages in dedicated worktrees;
those implementations remain source-present and unpromoted until their required
external witnesses can legally run.

## Promotion tiers

| Tier | Authority | Required external witness |
|---|---|---|
| T0 Static | No execution, network, credential, or spend | Source/schema validators |
| T1 Deterministic guest | Fake services in disposable VM | Controller VM/device/process receipts |
| T2 Replay guest | Recorded effects, no external network | Exact trace and replay digest |
| T3A Billable canary | One real billable operation | Provider-enforced cash custody plus reconciliation |
| T3B Subscription canary | One subscription-backed operation | Fresh native-unit reservation and before/after observations |
| T4 Fixture worker | One worker on fake repo/services | Full lifecycle, effect, artifact, and operator receipts |
| T5 Crew | Multiple workers under aggregate ceilings | Global accounting and race/adversarial proof |
| T6 Federation | Cross-host effects and settlement | Remote custody and Byzantine/adversarial evidence |

Each tier requires a new exact grant. A PASS does not travel across commit, tree,
image, controller, policy, scenario, provider, price/capacity snapshot, or tier.

## Witness classes

| Class | Can establish | Cannot establish alone |
|---|---|---|
| HOST_OBSERVED | VM/device/mount/process/cgroup/kill facts | Guest semantics or provider settlement |
| BROKER_OBSERVED | Framed request, decision, bytes, dispatch, response | Provider billing truth beyond its channel |
| CAPACITY_OBSERVED | Native allowance, reset, freshness, parser provenance | Hard cash ceiling |
| PROVIDER_RECONCILED | Usage, quota, invoice, refusal | Host containment |
| GUEST_ASSERTED | Test result, probe, log, proposed artifact | Containment, absence, or authority |
| MODEL_CHECKED | Property over exact finite model/config | Concrete implementation correctness |
| REPLAYED | Same trace under exact fixtures/seed/schedule | Real-world provider behavior |
| OPERATOR_OBSERVED | Legibility and control-path usability | Backend invariant without linked evidence |

## Required proof families

### Safety

- canonical checkout structurally absent;
- no undeclared device, mount, socket, route, credential, or destination;
- one effect-capable body generation;
- reservation never oversubscribed under concurrency/crash;
- ambiguous non-idempotent effect never replayed;
- output cannot self-promote or overwrite input;
- kill and spend denial remain reachable outside the guest.

### Liveness

- a valid admitted body reaches RUNNING or a specific terminal failure;
- cancellation reaches fenced/settled terminal state;
- restart reconciliation eventually classifies every nonterminal run under named
  fairness assumptions;
- safe compaction or hibernation happens before allowance/context exhaustion;
- a compatible successor can continue after proved predecessor loss;
- stale breakers require explicit authorized resolution, not time-based forgetting.

### Economics

- integer/native-unit conservation;
- reservation before dispatch;
- expiry refunds only undispatched capacity;
- uncertain dispatch holds worst-case capacity;
- provider-side loss ceiling measured when claimed;
- subscription windows never collapsed into cash or called free;
- aggregate child/body/retry limits remain bounded under crash storms.

### Operator experience

- one-worker launch and clear denial reasons;
- live body/session/repo identity without substring inference;
- pause/stop/cancel reachable while guest is wedged;
- backend switch shows exact capability omissions and context loss;
- stale/offline/unknown states are distinct;
- capacity pressure explains forecast, reserve, and next safe action;
- every card zooms to primary evidence in two actions or fewer;
- reduced-motion activity signal and keyboard/text-scale accessibility.

## Non-tautological test strategy

Avoid tests that merely restate configuration. Each test must force the
implementation to make a consequential choice.

| Test family | Example adversary | Meaningful assertion |
|---|---|---|
| Provenance | Dirty source, wrong remote, symlink alias, main path | Launch is impossible before any guest exists |
| Boundary | DNS exfiltration, metadata SSRF, host socket scan | Host-observed channel/device absence or broker denial |
| Process | PID reuse, orphan child, VM API timeout | Generation/witness mismatch quarantines and capacity stays held |
| Spawn storm | Crash before handshake repeated 1,000 times | Durable global reservation and breaker cap births across restarts |
| Effect | Lost response after non-idempotent dispatch | No replay; reconciliation required |
| Capacity | Stale or malformed subscription observation | Real dispatch denied; fake route remains available |
| Context | Hard limit between tool request/result | Tail marked uncertain; no false complete capsule |
| Resurrection | New backend lacks required MCP semantics | Translation BLOCKED; no successor authority |
| Evidence | Guest forges PASS receipt | Witness class remains GUEST_ASSERTED; promotion denied |
| Teardown | Guest ignores stop and forks children | Host kills full witness scope or reports unresolved quarantine |

Use property-based transition tests, schedule exploration, model checking of small
state machines, incident replay, mutation testing, and differential adapters.
Preserve minimized counterexamples as stable fixtures.

## Pull-request proof packet

A Drydock implementation PR should include:

1. exact base/head/tree and linear-history evidence;
2. changed authority surfaces and threat-model delta;
3. focused and full source test receipts;
4. schema, Mermaid, link, and skill-bundle validation;
5. adversarial cases with witness classes and negative outcomes;
6. actual operator-facing artifact captures for UI changes;
7. explicit local/runtime/provider claims that remain unverified;
8. every review thread and bot finding disposition;
9. exact-head hosted CI and independent skeptical review;
10. merge-queue and final merge commit/tree verification.

Hosted CI red is a stop signal. Diagnose the first causal failing job rather than
restarting downstream aggregate gates. After a head changes, all prior exact-head
receipts are superseded.

## Verdict language

Use only `PASS`, `FAIL`, `INVALID`, `INCOMPLETE`, or `UNCERTAIN` for a tested
tier. Use `BLOCKED` and `NOT_PROVISIONED` for work that could not legally or
physically run. Never turn sandbox setup failure, missing witness, skipped body,
or stale capacity into PASS or neutral success.
