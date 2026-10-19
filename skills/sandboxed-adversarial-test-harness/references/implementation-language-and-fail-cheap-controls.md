# Implementation Language And Fail-Cheap Controls

Use this when deciding what Drydock is written in, where a trust boundary becomes
a process boundary, how the offline and real-provider packages differ, or whether
a retry, UI, database, memory, training, or evidence feature can silently increase
cost or authority.

## Verdict

Write the **trusted Drydock nucleus in Rust**. Do not write all surrounding product
code in Rust merely for consistency.

- Rust: controller, watchdog, effect/budget broker, manifest validator, capability
  and lease state machines, Trial Basin transition core, receipt hashing/signing,
  SQLite writer, artifact importer, and Linux Firecracker adapter.
- Swift 6: one small out-of-process adapter for Apple's Virtualization.framework.
- Upstream Firecracker + Jailer: Linux VMM; do not fork or reimplement it.
- TypeScript/React: read-only evidence exploration and long-list presentation,
  never admission, budget, kill, signing, or verdict authority.
- JSON Schema and fixed cross-language vectors: interchange.
- TLA+: small abstract safety/liveness models, never runtime authority.
- Any language inside the guest: untrusted subject code.

The reason is not “Rust is a sandbox.” It is not. Rust reduces memory-unsafe bugs
and lets both host platforms share one typed security state machine. Isolation
comes from separate process identities, VM/hypervisor boundaries, absent devices,
external custody, narrow capabilities, and an independent kill path.

Port Daddy's ADR-0120 keeps ordinary product logic in TypeScript and puts canonical
security primitives in Rust. Drydock applies that rule to a new external trusted
computing base. It does not rewrite Port Daddy; Port Daddy remains the untrusted
subject. Record this application explicitly rather than allowing it to look like
an accidental Rust expansion.

## Component and authority matrix

| Component | Process identity | Network | Secrets | May decide | Must never decide |
|---|---|---|---|---|---|
| `drydock-core` | dedicated unprivileged host identity | no general egress | receipt key only through narrow signer handle | manifest validity, resource/effect ceilings, lifecycle, invariant result | provider destination outside sealed profile, provider billing truth |
| `drydock-watchdog` | separate minimal identity | none | none | deadline expiry, controller liveness loss, revoke/kill escalation | scenario content, verdict, budget increase |
| `drydock-broker` | separate broker identity; absent offline | exact provider endpoints only | one run-scoped provider credential | request admission under sealed lease, reservation, dispatch, cancellation, settlement state | raising provider limit, executing guest tools, approving itself |
| `drydock-vz-helper` | signed macOS helper with virtualization entitlement | none | none | mechanical VZ configuration and lifecycle calls | policy, arbitrary paths/devices, budget, verdict |
| Firecracker/Jailer adapter | dedicated Linux launcher and per-run UID/GID | local Firecracker API only | none | exact VMM/jail configuration | scenario, provider call, verdict |
| Trial Basin | same offline package as core, no effect authority | none | none | deterministic legal next actions and invariant evaluation | real I/O |
| guest bootstrap | guest identity | vsock/serial profile only | fake/run capabilities, never raw secret | frame a request or observation | host truth, promotion, ceilings |
| Switchboard | local native operator app | local control channel only | short-lived operator-presence capability | request one of the controller's precomputed actions | hidden manifest fields, arbitrary commands, direct DB write |
| Observatory | read-only local viewer | read-only receipt projection | none | filtering and presentation | any mutation or acknowledgement |

Treat every added process, dependency, dynamic library, parser, device, listener,
and writable path as a TCB increase. “Only glue” is not an exemption.

## Release independence

Drydock's production controller belongs in a separate repository and release
chain. A subject repository pull request may provide inert bytes only. It must not
build, replace, configure, or sign the controller that grades it.

Required release properties:

1. Pin the exact controller, watchdog, broker, platform helper, VMM, image, policy,
   schema, and hostile-specimen digests before staging subject bytes.
2. Verify signatures and hashes before allocating a VM.
3. Distinguish `DEV_UNTRUSTED` controller builds from evidence-capable releases.
4. Use a separate signing identity and protected release workflow from the subject.
5. Disable ambient update checks during a run. Updates are explicit artifacts,
   verified before the next run.
6. Package offline and canary capabilities separately. The T0-T2 install does not
   contain provider adapters or credential loaders.
7. Permit no dynamic provider plugin, guest-selected executable, shell-evaluated
   command, `PATH` lookup, or inherited environment in the trusted processes.

## macOS: Rust nucleus, tiny Swift VZ adapter

Apple's Virtualization.framework is an Objective-C/Swift API with queue and object
lifetime requirements. The first implementation should not move those unsafe
bindings into Rust through a broad third-party FFI layer.

The Swift helper:

- is a signed executable carrying the required virtualization entitlement;
- accepts one versioned fixed-profile request over inherited pipes or pre-opened
  descriptors, not a long-lived public listener;
- rejects caller-selected executable paths, arbitrary mounts, devices, NIC modes,
  or host directories;
- constructs `VZVirtualMachineConfiguration` from absence: no network devices,
  no directory-sharing devices, no graphics/audio/USB/clipboard/Rosetta integration,
  and no custom device unless the reviewed profile names it;
- keeps a safe guest entropy device enabled; deterministic tests inject fake time
  and randomness inside their fixture rather than weakening VM entropy;
- uses immutable boot/input devices and one bounded disposable state/output device;
- reports the complete configured device inventory and lifecycle observations;
- performs a short cooperative stop only when requested, then supports forced stop;
  and
- never reuses writable state after forced termination.

The Swift helper does not parse model requests, artifacts, manifests, receipts, or
guest claims. Where the platform permits it safely, hand an established bounded
socket or file descriptor to Rust; otherwise keep framing mechanical and tiny.

Virtualization.framework save/restore is a boot optimization, not deterministic
replay. Saved state can retain clocks, randomness, sockets, identity, and workload
memory. Defer it until cold-boot correctness and reseeding are proven.

Primary sources:

- [Apple Virtualization.framework](https://developer.apple.com/documentation/virtualization)
- [Apple VM configuration](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration)
- [Apple network devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/networkdevices)
- [Apple directory-sharing devices](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration/directorysharingdevices)
- [Apple virtualization entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.virtualization)
- [Apple VM stop](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop%28completionhandler%3A%29)

Lima, Tart, QEMU, and Apple container tooling are useful research and image
prototyping inputs. They are not the first enforcement witness. QEMU record/replay
may become a separate deterministic instruction-level laboratory when that value
outweighs its much larger device/emulator surface.

## Linux: upstream Firecracker, not a new VMM

The Linux adapter speaks the local Firecracker API and invokes an exact paired
Firecracker/Jailer release. It requires:

- Linux with KVM; macOS is a client, never the Firecracker enforcement host;
- one microVM per run, initially one run globally;
- unique unprivileged UID/GID and fresh root-owned jail inputs;
- Jailer, default restrictive seccomp, namespaces, and verified cgroup v2
  membership and hard limits;
- immutable kernel/root filesystem plus disposable writable block devices;
- no virtual NIC initially;
- one bounded per-run vsock endpoint with authenticated framing;
- external wall-clock watchdog, disk/output quotas, and process teardown; and
- host filtering and broker mediation before any later networked profile.

Use exact evidence labels:

- `HYPERVISOR_ENFORCED`: CPU privilege and guest-memory boundary supplied by KVM.
- `VMM_CONFIGURED`: emulated devices, configured RAM/vCPU, absent virtual NIC.
- `KERNEL_ENFORCED`: UID, namespaces, cgroups, seccomp, Landlock, packet policy.
- `BROKER_ENFORCED`: destination, credential, request, byte, token, spend, retry.
- `GUEST_ASSERTED`: in-guest limits, probes, tests, and logs.

Firecracker explicitly does not filter guest traffic. A TAP device without separate
host filtering is not controlled egress. Snapshot files are hostile, sensitive,
version-constrained state; defer snapshots until cold boot, new handshake, identity
reseed, and snapshot custody are proven.

Primary sources:

- [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md)
- [Firecracker production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
- [Firecracker Jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md)
- [Firecracker vsock](https://github.com/firecracker-microvm/firecracker/blob/main/docs/vsock.md)
- [Firecracker snapshot support](https://github.com/firecracker-microvm/firecracker/blob/main/docs/snapshotting/snapshot-support.md)

## Cross-process and guest protocol

Prefer a boring protocol over a clever one:

- fixed `u32` length prefix followed by a bounded canonical UTF-8 JSON frame;
- protocol version, run ID, lease ID, fencing generation, sequence, command type,
  deadline, payload digest, and prior-frame digest in every authority-bearing frame;
- strict enums and `deny_unknown_fields`; no coercion, comments, duplicate keys,
  non-finite numbers, floating money, or implicit default authority;
- independent maximum for frame, stream, total run, list length, string length,
  nesting depth, and decompressed bytes;
- request/response idempotency and replay window; and
- accepted and rejected fixture vectors asserted by Rust and Swift.

Hash a domain-separated, versioned invariant encoding. RFC 8785 canonical JSON is
a suitable cross-language candidate if its exact number/string constraints are
accepted. Do not silently reuse an ambiguous legacy event-chain format. A
signature authenticates bytes and signer; the witness class still determines what
the statement proves.

Primary sources:

- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html)
- [RFC 9162 Merkle inclusion and consistency proofs](https://www.rfc-editor.org/rfc/rfc9162.html)

## Deterministic Trial Basin core

Make the central operation pure:

```text
step(state, action, virtual_time, entropy_word)
  -> (next_state, declared_effects)
```

The product executes only declared effects admitted by adapters. Every source of
nondeterminism is injected: clock, sleeper, RNG, ID, filesystem result, transport
delivery, provider chunk, crash point, and operator decision.

The replay bundle contains controller/schema versions, root and derived seeds,
virtual epoch, decision tape, fault plan, normalized trace, and final state hash.
Initial scheduling is a single explicit event queue. Test-only schedule exploration
does not ship as a runtime failpoint API.

Use:

- table tests and Proptest for sequential state machines and shrinking;
- Tokio paused time only for code that actually uses Tokio time;
- Loom for tiny synchronization primitives;
- Shuttle for larger reproducible schedule sampling;
- Turmoil for later Tokio network simulations, not SQLite's native VFS;
- process-kill tests around real SQLite transaction boundaries;
- cargo-fuzz for every hostile parser/importer; and
- TLA+ for small lease, reservation, retry, and teardown models.

Every effect and settlement carries a fencing generation. Model the case where A's
lease expires, B receives generation `g+1`, and stale A attempts completion. A job
ID without current generation and holder identity is not authority.

## Durable authority store

Use one SQLite database and one Rust writer. UI, Swift, guest, broker adapters, and
report exporters never write it directly.

- Resolve one explicit platform application-support path. Reject worktrees,
  package directories, caches, and temporary directories.
- Use WAL for concurrent read projections and one bounded write queue.
- Use `synchronous=FULL` for approval, reservation, dispatch intent, revocation,
  settlement, receipt root, and teardown transitions.
- Use `BEGIN IMMEDIATE` and append the state transition plus event/outbox record in
  one transaction.
- Add a bounded `busy_timeout`; expiry blocks work instead of retrying forever.
- Apply idempotent migrations and query the actual target objects afterward.
- Rebuild unfinished runs, reservations, breaker state, leases, and teardown before
  admitting work after restart.
- Corruption, unverifiable schema, failed integrity check, or disk reserve breach
  disarms every effect-capable profile.

Authority events remain immutable. Seal finite sequence ranges into Merkle-rooted
segments. Large content-addressed blobs, logs, diffs, and recordings have separate
byte/count/age limits. Compaction records source range/root, reducer version,
retained aggregate, deleted blob digests, reason, and resulting root. Deleting a
sensitive payload leaves a tombstone and digest. Dashboard buckets and search
indexes are rebuildable projections, never authority.

Use SQLite backup or a verified checkpointed export. Copying only the main file in
WAL mode is not a backup.

Primary sources:

- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite synchronous pragma](https://www.sqlite.org/pragma.html#pragma_synchronous)
- [SQLite online backup API](https://www.sqlite.org/backup.html)

## Zero-spend and canary packaging

T0-T2 are incapable of external spend:

- no VM network device;
- no real-provider broker binary or adapter in the installed profile;
- no provider credential reader;
- no GitHub, Relay, Fleet, or canonical daemon capability;
- no scheduled or event-triggered promotion;
- no dynamic work intake; guest suggestions leave only quarantined proposal data;
  and
- no automatic move from fake/replay/local inference to a real provider.

Agent training stays offline. Rewards derive from host/broker evidence such as exit
codes, invariant results, exact diffs, denied unsafe actions, and sealed artifacts,
never agent confidence or prose. A learned policy, episodic memory, transcript, or
retrieved history is a digest-pinned input. It cannot grant identity, money,
network, files, or promotion.

Private/local is the default evidence scope. Export to repo, team, provider, or
public scope requires a destination-specific consent step that names retained
fields and deletion/export behavior. “Local-only uploads nothing” needs an external
zero-packet test, not a setting label.

## Real-provider fail-cheap contract

The T3A billable broker is a separate signed package and process. It holds one run-scoped
credential for one dedicated provider account/project/payment cell. The internal
ledger limits protocol authority. A provider control limits actual loss only when
its documented and measured overshoot is included in the approved exposure.

Do not call a provider dashboard budget “custody” by default. OpenAI documents
non-instantaneous limit enforcement and possible overage; prepaid usage can also
settle after balance exhaustion. Cloudflare AI Gateway describes its spend limits
as eventually consistent and its cost accounting as best-effort. AWS Budgets is
updated only a few times per day. Anthropic documents an enforced monthly cap,
but its account scope and completion-time behavior still need a dedicated-cell
probe before Drydock may state a per-run bound. These are useful outer controls,
not interchangeable guarantees.

If the provider cannot supply a dedicated cell, a stable worst-case unit price,
and a finite measured or documented overshoot bound, mark
`financialCustody: unproven` and deny T3A. T0-T2 remain available. Never convert an
unknown overshoot into a generous safety margin.

Initial T3A limits are intentionally severe:

| Dimension | First canary |
|---|---:|
| requests | 1 |
| total attempts | 1 |
| concurrent requests | 1 |
| tool calls | 0 |
| child work items | 0 |
| automatic retries | 0 |
| automatic budget refill | never |
| provider/model choices | exactly 1 sealed pair |
| guest credentials | 0 |

An operator grant binds run, provider, model, account cell, price digest, input
bound, output cap, request and attempt counts, absolute deadline, custody evidence,
measured quota lag/overshoot, and expiry. It is one-shot. Wall-clock date changes do
not refill it.

Reserve all possible attempts before the first provider byte. The broker derives
input bounds from bytes and attachments it actually receives or resolves. The guest
may request less; it cannot declare billable size or raise policy.

### Durable breaker

Breaker state survives process restart and is scoped at least by provider account,
project, model, and custody cell.

| State | Meaning | Paid call allowed? |
|---|---|---:|
| `DISARMED` | default; no live grant | no |
| `ARMED_ONE_SHOT` | exact grant and reservation committed | exactly the bound operation |
| `IN_FLIGHT` | provider dispatch may have begun | no second operation |
| `SETTLED` | usage reconciled and remainder released | no |
| `FORCED_OPEN` | ambiguity, failure, discrepancy, or operator emergency stop | no |
| `PROBE_APPROVED` | separate human-approved half-open probe with new reservation | exactly one probe |

Timeout after write, missing usage, stale prices, custody drift, provider overage,
receipt failure, broker crash, or reconciliation mismatch goes to `FORCED_OPEN`.
Time alone never transitions it to a paid half-open state.

The first canary has no retry. If a later reviewed profile introduces retries:

- one layer immediately above the provider owns them; provider SDK retries are off;
- all attempts are included in the original reservation;
- total attempts are at most three and aggregate retry traffic is at most 10%;
- every request is idempotent and carries one idempotency key;
- backoff is full jitter and honors a bounded `Retry-After`;
- every hop receives the remaining absolute deadline;
- auth, permission, malformed input, stale policy/catalog/custody, unknown commit,
  receipt failure, and breaker rejection never retry; and
- a retry that cannot complete inside remaining time is denied before sleeping.

Multiple layers with three retries can amplify one action to dozens of calls. The
correct default for expensive agent work is not “three retries”; it is **zero**
until a fixture proves exactly why a retry is safe and already funded.

Primary sources:

- [Google SRE: addressing cascading failures](https://sre.google/sre-book/addressing-cascading-failures/)
- [AWS: exponential backoff and jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Microsoft circuit breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
- [OpenAI: API usage and spend limits](https://help.openai.com/en/articles/6614457)
- [OpenAI: prepaid billing](https://help.openai.com/en/articles/8264644)
- [Cloudflare AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/)
- [Anthropic API rate and spend limits](https://platform.claude.com/docs/en/api/rate-limits)
- [AWS Budgets update cadence](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

## Operator surfaces

Keep rich presentation out of mutation authority:

1. **Switchboard:** a small native Rust app. It can choose only controller-generated
   sealed plans and send typed launch, cut-egress, pause, kill, inspect, and export
   requests. The controller independently validates every request. Framework choice
   follows a D0 accessibility/security spike; no WebView belongs in the first
   mutation path.
2. **Observatory:** TypeScript/React, read-only. It handles search, filters,
   redaction-aware display, and large histories. Virtualize long fixed summary rows,
   keep detail in a separate pane, preserve stable item identity and scroll anchor,
   and bound overscan. It has no mutation endpoint or database access.

Controls have separate semantics and receipts. For every verb track `QUEUED`,
`DELIVERED`, and one of `ACKNOWLEDGED`, `FAILED`, `EXPIRED`, or `UNSUPPORTED`.
Pause is not kill; cancel cannot undo settled effects; UI delivery is not host
acknowledgement. Resume creates a linked successor receipt rather than rewriting
history.

The operator sees before launch:

```text
External spend: $0.00
Network device: absent
Provider calls: impossible
Guest credentials: none
Wall time: 10 minutes
Kill path: watchdog armed
```

A canary instead says, for example:

```text
Maximum financial exposure: $0.05
Provider-side ceiling: $0.04
Measured enforcement tolerance: $0.01
Requests: 1
Retries: none
Expires: 14:32:10 local time
```

Do not collapse those three dollar lines into “budget enabled.”

Keep emergency actions reachable in one action and any aggregate claim zoomable to
its exact command, diff, test, packet, spend row, or receipt within two actions.
One calm glow may mark a new meaningful event; it does not repeat. Reduced motion
uses stable border, icon, text, color, and timestamp changes.

Visual proof covers active, historical, blocked, stale, approval-gate, interrupt or
kill, and receipt-recovery states. Each artifact manifest binds binary and source
digests, fixture/real classification, run/receipt/command IDs, event head, capture
time, viewport, scale, theme, motion setting, and redaction state. UI state rebuilt
from a cache is not receipt proof.

## Implementation acceptance checklist

- [ ] Controller is built and signed outside the subject repository.
- [ ] Offline package inspection proves no provider adapter or credential loader.
- [ ] Rust is canonical for every authority transition and receipt hash.
- [ ] Swift helper has a fixed request schema and no policy, credential, or verdict code.
- [ ] macOS device inventory proves no network/share/integration device.
- [ ] Linux launch proves patched paired VMM/Jailer, unique UID/GID, cgroup membership, seccomp, namespaces, and no NIC.
- [ ] Every frame parser is fuzzed and rejects unknown/oversized input.
- [ ] Pure transition replay yields the same normalized trace and state hash.
- [ ] Stale fencing generation cannot complete, publish, or settle.
- [ ] SQLite power-loss policy, migrations, backups, corruption, and disk-reserve failures are exercised.
- [ ] T0-T2 external packet and provider-call counts are externally observed zero.
- [ ] Source comes from an independently witnessed remote object in a dedicated
      bare vault; the canonical checkout is never mounted, opened, packaged, or
      accepted as an artifact target.
- [ ] Every authoring or promotion path is a fresh linked worktree on a
      non-default branch, and before/after receipts prove canonical HEAD, index,
      worktree, untracked inventory, object store, and refs unchanged.
- [ ] First T3A has one request, one attempt, no tool, one dedicated custody cell, and a durable forced-open path.
- [ ] First T3B has one request, one attempt, no tool, schema-valid native-unit
      evidence, an atomic p95-plus-checkpoint-tail reservation, and no hard-cash-cap claim.
- [ ] No automatic refill, promotion, breaker half-open, agent spawn, or retry exists.
- [ ] Switchboard can revoke and kill without Observatory or guest cooperation.
- [ ] Every UI claim zooms to immutable evidence and stale/unknown never appears healthy.

Fail any checked item closed at the tier it protects. A lower offline tier may
remain available when a higher tier is blocked.
