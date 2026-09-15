# Drydock Architecture Decisions

This is the compact decision ledger. The long design volumes preserve rationale,
alternatives, and research citations; this file says where the present design
draws boundaries.

## Authority and process placement

| Component | Holds | Must not hold | Default process/language target | State |
|---|---|---|---|---|
| Operator surface | Intent and bounded approvals | Raw provider credentials, VM handles, direct ledger writes | Rust/GPUI console plus bounded web/iOS projections | TARGET |
| Command verifier | Nonce, expiry, scope, signer verification | Launch policy, long-lived bearer, semantic judgment | Small host TCB, Rust | TARGET |
| Drydock controller | VM lifecycle, clock, fencing, run transitions, kill | Work authorship, success judgment, provider secret | Rust service | TARGET |
| Hypertree execution reducer | Admit typed lifecycle events and derive one canonical projection | I/O, process launch, credentials, client commands | Pure controller-local TypeScript product plane | SOURCE-PRESENT / T0 |
| macOS VM adapter | Narrow Virtualization.framework calls and VM handle | Ledger, policy, credential, agent context | Tiny out-of-process Swift adapter | TARGET |
| Linux VM adapter | Firecracker API and process handle | Reimplemented VMM, ledger, policy | Upstream Firecracker plus narrow Rust adapter | TARGET |
| Lifecycle ledger | Agent/run/body generations, leases, witnesses, breakers | Prompt text as identity, hidden process discovery | Single-writer SQLite initially | TARGET |
| Capacity broker | Native allowance observations, reservations, settlement | Invented remaining quota, raw account bearer in guest | Rust service with provider-specific read adapters | TARGET |
| Effect broker | Typed operations and scoped credential redemption | General egress, raw secret disclosure, self-approved retries | Rust service; adapters outside guest | TARGET |
| Cognition compiler | Hypertree, capsule, prompt, tool/skill mapping | Launch, reserve, grant, settle | Pure/deterministic core; language may follow product plane | TARGET |
| Guest driver | Virtual clock, scenario, faults, assertions | Host policy, keys, final verdict | Guest-local deterministic runner | TARGET |
| Subject/body | Work and guest-asserted events | Ambient host/network/credential authority | Untrusted; any language/backend | TARGET |
| Reaper/watchdog | Fence, stop, kill observation, orphan flag | Spawn successor, clear breaker, declare success | Separate Rust process | TARGET |
| Evidence log | Append-only host/broker observations and digests | Mutation authority, inferred causation | Host-owned durable writer | TARGET |
| Porthole/Scout projection | Capture, replay, navigation, visual proof | Authorization, containment judgment | Read-only product projection | PARTIAL/TARGET |

Rust is chosen for the stable authority-bearing nucleus because memory-safe
systems code, explicit types, and releaseable static components shrink risk.
Fast-changing execution-product policy remains TypeScript under ADR-0120; moving
that policy into Rust would create another semantic implementation without
creating isolation. Rust is not an isolation boundary. A hypervisor/kernel
supplies the boundary; process separation keeps a native adapter from inheriting
the whole TCB.

## Five planes that must not collapse

1. **Control plane:** verifies operator commands and changes admission/lifecycle.
2. **Execution plane:** disposable VM, scenario driver, subject, and body.
3. **Effect plane:** typed broker calls, credentials, capacity, and settlement.
4. **Cognition plane:** plans, capsules, prompts, capabilities, and memory policy.
5. **Evidence plane:** immutable observations, receipt chain, and read projections.

The daemon may coordinate proposals, but it must not become the sole launcher,
ledger writer, kill switch, secret broker, semantic judge, and witness. Split
authority by consequence, not by package name.

## Worktree and source boundary

- The operator's main checkout is a clean projection of live `origin/main`.
- A host source vault resolves and verifies the exact remote commit and tree.
- The controller creates a fresh linked review worktree or immutable archive from
  that pin. It rejects wrong remote, dirty state, main/default branch, symlink
  escape, and path/inode alias to the canonical checkout.
- The guest receives read-only source and a disposable writable overlay. It never
  receives the canonical checkout or the host `.git` control directory.
- Output returns to quarantine as content-addressed patches/artifacts, then enters
  a fresh non-default host review worktree only after inspection.
- No guest can push, merge, tag, or modify GitHub directly.

## Global body accounting

One durable admission writer owns compare-and-swap transitions for:

- AgentNode identity;
- admitted run and work-node obligation;
- body generation and fencing token;
- backend session handle;
- VM/process witness;
- capacity and concurrency reservations;
- parent/child ancestry and retry attempt;
- heartbeat, deadline, teardown, and reconciliation state.

Reservation precedes process creation. On controller boot, admission starts closed
until every nonterminal run reconciles against platform handles, processes,
broker leases, and effect receipts. A missing process can become proved absent,
not silently reusable capacity. A found orphan is fenced before any successor.

## Resurrection boundary

Resurrection means assigning a new body to the same durable AgentNode after:

1. predecessor generation fenced;
2. process/VM absence or quarantine established;
3. every non-idempotent effect reconciled;
4. worktree diff and claims inventoried;
5. capsule integrity and citation coverage verified;
6. destination capacity freshly reserved;
7. tools, MCPs, skills, hooks, prompts, and permissions freshly compiled;
8. successor challenges the capsule and exact work obligation.

Native provider resume is an optimization only when session ownership, freshness,
and effect history are proved. Otherwise create a new provider session while
preserving AgentNode identity and recording semantic discontinuity.

## Capacity and context boundary

- Cash/credit exposure is one ledger.
- Subscription allowance is a vector of provider-native windows and reset clocks.
- Compute, wall time, storage, output bytes, bodies, and child depth are separate
  limits.
- Context pressure is forecast against the next atomic action plus checkpoint
  tail, not merely current tokens.
- Unknown remaining allowance denies real dispatch or selects an explicitly
  approved conservative route.
- Preemptive compaction freezes new effects, preserves complete tool pairs, seals
  a cited capsule, and verifies it before truncating context.
- Scratch may be discarded; governing decisions, unresolved effects, accepted
  plans, provenance, and operator constraints require durable evidence.

## Capability boundary

The capability compiler starts from no authority. For one work phase it maps each
requested tool/skill/MCP/hook/permission as:

- `EXACT`: same semantics and no wider authority;
- `EQUIVALENT`: different mechanism with proven equivalent outcome;
- `NARROWED`: less authority, with impact stated;
- `OMITTED`: unnecessary for the phase;
- `BLOCKED`: required semantics cannot be provided safely.

Names, prompt annotations, schema hiding, environment inheritance, and copied
context files are not capabilities. Credentials remain in the effect broker.

## Operator and projection boundary

The console, FleetBar, iOS client, Relay, and Porthole/Scout views consume typed
records. They do not infer identity by string matching or keep a second private
lifecycle truth. They can request bounded commands; the host verifier/controller
decides and receipts the transition.

The operator must be able to start one worker, inspect its chat and evidence,
switch sessions/repos, pause/stop/cancel, choose a backend, review capability
translation, respond to HITL, inspect artifacts/PRs, and join securely from iOS.
Every summary reaches primary evidence in two actions or fewer.

## Rejected architectures

- Containers, Seatbelt, seccomp, namespaces, or path checks as the sole boundary
  for arbitrary hostile code.
- Guest-held provider keys or unrestricted proxy/network access.
- In-memory process counts or retry counters as global accounting.
- A single fake dollar exchange rate for subscription capacity.
- Transcript copy as identity continuity.
- One process both launches a body and certifies that it is gone.
- A read UI that writes authoritative lifecycle rows directly.
- Automatic retries for body birth or ambiguous effects in the first tier.
