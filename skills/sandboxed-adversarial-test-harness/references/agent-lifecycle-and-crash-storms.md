# Durable Agent Lifecycle and Crash-Storm Control

Use this reference when the subject can launch, retry, resume, replace, or hand
work to an agent-like process. VM containment bounds what one body can touch; it
does not prove how many bodies exist, whether a crash orphaned one, or whether a
restart created a second billable incarnation.

## 1. Separate the identities

Never use one string for all of these:

| Record | Meaning |
|---|---|
| Principal | Person or institution requesting/funding work |
| Work intent | Desired outcome and immutable provenance |
| Agent node | Durable logical worker/person |
| Agent run | One admitted attempt |
| Body lease | One expiring, generation-fenced incarnation |
| Backend session | Provider/harness-native conversation handle |
| Process witness | Host-observed process or VM identity |
| Transcript | Durable conversation/event lineage |
| Capability set | Exact tools/effects/resources this body may use |

A PID, alias, model, backend session, transcript, or worktree is never the durable
worker identity. A backend handoff creates a new body generation for the same
agent node only after the old generation is fenced.

## 2. Put one writer before every launcher

Every ingress must call one durable admission transaction. A direct spawn route,
fallback launcher, startup trigger, background queue, test helper, or child-spawn
path that bypasses it invalidates global accounting.

The transaction must reserve, before asynchronous process creation:

- globally live and starting bodies;
- repository, project, backend, provider, and operator capacity;
- attempt count and absolute deadline;
- parent/child count, total descendants, and depth;
- CPU, memory, disk, PID, descriptor, and log limits;
- provider requests, tokens, protocol exposure, and externally custodied loss;
- exact source/worktree/output provenance; and
- the capability environment.

Read-count-then-launch is a race. Check and reserve in one serialized transaction.
Dollar accounting alone is insufficient because subscription or prepaid backends
may report zero marginal cost while still consuming scarce and risky capacity.

## 3. Use a durable lifecycle state machine

The minimum launch states are:

```text
INTENT_CAPTURED -> PLANNED -> ADMISSION_PENDING -> RESERVED
  -> STARTING -> HANDSHAKING -> RUNNING -> DRAINING
  -> COMPLETED | FAILED | KILLED | LOST | QUARANTINED
```

Transitions compare-and-swap both current state and owner generation. A process
cannot be called running until the external controller has:

- committed the reservation;
- created and recorded a host process/VM witness;
- completed a nonce challenge over its dedicated control channel;
- verified the sealed executable/environment manifest;
- bound the expected backend session;
- opened an external transcript sink; and
- issued the exact body capability lease.

Terminal settlement is idempotent and releases each reservation exactly once.

## 4. Witness processes without trusting PID numbers

Record at least:

```text
hostId
hostBootId
pid
processStartIdentity
controllerEpoch
launchNonceHash
executableDigest
sandboxOrVmId
controlChannelId
observedAt
```

Verify the whole tuple before signalling, adopting, or reporting a body. On host
reboot, every old process witness expires. On PID reuse, the new process start
identity, nonce, executable, sandbox, or parent epoch will differ.

Prefer a platform-owned process/VM handle that dies with or is recoverable by the
supervisor. Detached children plus an in-memory child map are not crash recovery.

## 5. Start closed after every controller boot

Boot into `ADMISSION_CLOSED_RECOVERING`. Before any new launch:

1. verify the canonical durable store, schema, integrity, and writer ownership;
2. load durable halt and breaker state;
3. enumerate all nonterminal runs and reservations;
4. enumerate controller-owned process/VM handles;
5. reattach only an exact matching, still-valid body;
6. revoke effects before adjudicating ambiguous bodies;
7. terminate uncommitted or stale-generation bodies;
8. settle known-dead runs or mark them lost/quarantined; and
9. reconcile aggregate counters to durable rows.

If any step is uncertain, keep admission closed. Never interpret “could not find
the old process” as permission to launch a replacement.

## 6. Make agent birth non-retrying by default

The safe initial policy is zero automatic agent-birth retries. A failed birth is
an operator-visible terminal attempt. Later retry requires all of:

- one designated retry owner;
- a new or explicitly reused idempotent reservation;
- capped attempts;
- capped exponential backoff with full jitter;
- the original absolute deadline;
- a closed safety breaker; and
- proof that the prior body is terminated or fenced.

Do not place retries in both the controller and backend adapter. An adapter may
return typed retry advice; only the controller decides.

## 7. Use persistent scoped breakers

Breakers should exist at installation, operator, harbor/project, repository,
intent ancestry, backend, provider, and remote-ingress scopes.

Safety states are:

- `CLOSED`
- `OPEN`
- `HALF_OPEN_PROBE`
- `FORCED_OPEN`

Use `FORCED_OPEN` for external halt, database uncertainty, conservation failure,
orphaned process, lost capability channel, overspend, repeated pre-handshake
failure, recursive flood, suspicious unique-intent flood, or restart instability.

Safety breakers persist across process restart, host reboot, deployment, calendar
reset, UI reconnect, and budget-window rollover. Time alone never clears them.
One authenticated operator reset may clear a breaker only after named recovery
preconditions pass and a reset receipt is written.

## 8. Bound exact duplicates and varied floods

Require a durable idempotency key per logical launch. Duplicate requests return
the existing run and reservation.

Idempotency does not stop 1,000 distinct keys. Also enforce:

- a durable token bucket;
- bounded pending queue bytes and row count;
- hard globally starting/running ceilings;
- attempts per intent;
- direct-child, descendant, and depth limits; and
- content-equivalence grouping for operator attention.

Semantic similarity is a warning projection, not the enforcement boundary. Hard
resource and authority limits apply even when every request is textually unique.

A child carves from the parent's declared envelope. It never creates a new root
budget. The first safe tier sets child depth to zero.

## 9. Transfer continuity without transferring secrets

A cross-backend handoff:

1. drains or kills the old body under a deadline;
2. externally persists transcript and artifact cursors;
3. constructs a sanitized, signed, single-use handoff capsule;
4. revokes the old generation;
5. compiles the destination capability environment;
6. shows unsupported or narrowed capabilities;
7. reserves the successor body; and
8. launches it at the next generation.

Prompts, skills, MCP manifests, hooks, and policies transfer as content-addressed
inputs with provenance. Provider and repository credentials do not transfer.
Permissions are freshly issued, expiring capabilities. Hooks are executable and
run only inside the guest after allowlist/signature review.

At most one body may be authoritative for an agent node and work intent unless a
separate plan explicitly admits parallel embodiment.

## 10. Keep remote state a projection

A remote pub/sub service, WebSocket room, cloud state object, provider session, or
mobile app can store cursors and deliver signed commands. It cannot certify local
process liveness, reserve local resources, clear local breakers, or mint body
authority.

Remote commands bind the target agent, run, body generation, authority epoch,
verb, arguments digest, one-use ID, and expiry. The local authority revalidates
them at redemption.

Shard remote coordination by conversation/operator/harbor rather than creating a
single global object. Keep global capacity conservation with the resource owner;
give remote cells only signed, expiring slices.

## 11. Required adversarial tests

At minimum, test:

1. 1,000 exact duplicate launch requests produce one body.
2. 1,000 unique and semantically varied requests stay within the global ceiling.
3. Crash after reservation but before process creation.
4. Crash after process creation but before witness commit.
5. Crash after witness but before handshake.
6. Crash after handshake but before running commit.
7. Host reboot and PID reuse.
8. Stale body output during backend handoff.
9. Missing or changed MCP/skill/prompt/hook/capability digest.
10. Replayed or expired remote command.
11. Durable store lock, corruption, missing path, and partial migration.
12. Network partition across leased remote capacity.

All flood and crash tests use inert specimens and fake providers. The acceptance
claim is bounded denial and recovery at zero external spend.

## 12. Review questions

- Can every launch ingress be enumerated and shown to enter one transaction?
- Can a process exist before reservation commit?
- What proves the body behind a PID is the admitted one?
- What happens at each crash seam?
- What state survives a controller and host restart?
- Which single component owns retries?
- What permanently opens the safety breaker?
- Can a zero-dollar backend still exceed process or request capacity?
- Can any child create new root authority?
- Can the old body act after handoff?
- Which capsule fields are integrity-only, and which are authenticated authority?
- Can the destination silently lose a tool, skill, MCP, hook, or permission?
- Can a remote projection create or duplicate a local effect?
- Does every terminal path conserve reservations exactly once?

If any answer depends on the agent, guest, UI, or restarted daemon telling the
truth about itself, the lifecycle proof is incomplete.
