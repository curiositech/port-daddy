# Drydock: Controlled Port Daddy Execution and Agent Simulation

> A proving ground that the test subject cannot fund, escape, or certify by itself.

**Status:** PROPOSED / PORT DADDY RUNTIME REMAINS HALTED

**Source snapshot:** `curiositech/port-daddy@ea797e6244ca5153bcf0faed926a53ac306d5b26`

**Parent roadmap:** `port-daddy-unified-product-hypertree`

**Companions:**

- [The Grand Harbor Atlas](./grand-harbor-product-atlas.md)
- [Drydock Agent Lifecycle and Operator Control](./drydock-agent-lifecycle-and-operator-control.md)
- [Drydock Resurrection, Capacity, and Context Control](./drydock-resurrection-capacity-and-context-control.md)
- [Drydock execution hypertree](./drydock-resurrection-hypertree.json)
- [Drydock operator journey storyboard](../design/drydock-operator-journeys/index.html)

**Prepared:** 2026-09-08

**Execution note:** This design was produced by static source inspection. No Port Daddy daemon, CLI, Fleet process, agent backend, pd-console, FleetBar, integration suite, or provider call was launched.

---

## 0. Decision brief

Port Daddy must not be restarted on trust, on a code review, or on the strength of tests that it launches and grades itself.

Build **Drydock** as a small, non-agentic control system outside Port Daddy. Drydock creates disposable virtual machines, admits immutable inputs, mediates every effect, reserves worst-case protocol exposure before any request, records receipts outside the guest, and can stop the run without asking the guest to cooperate. A real-provider run additionally requires an independently enforced, dedicated provider or payment cell whose nominal limit plus finite measured overshoot fits the approved financial exposure; an internal ledger alone cannot make that promise.

Inside Drydock, build **Trial Basin** as the deterministic scenario and simulation layer. Trial Basin can replay known incidents, puppet scripted and model-backed workers, inject failures, explore concurrent schedules, and compare observed behavior with explicit invariants.

Agent execution additionally passes through the companion **Agent Lifecycle
Ledger**. It atomically reserves global capacity before birth, separates one
durable worker from replaceable backend/process bodies, witnesses process identity
without treating a PID as identity, reconciles every nonterminal run before
reopening after a crash, and keeps crash-storm breakers durable. No test tier may
route around that ledger merely because its provider cost appears to be zero.

The first useful result is not a live agent. It is a hostile inert specimen failing to:

- read the host;
- reach the network;
- contact the canonical daemon;
- obtain a credential;
- write outside its disposable disk;
- exceed CPU, memory, disk, process, log, or time limits; or
- create a bill.

Only after those proofs pass should Port Daddy source enter a zero-network guest. Real-provider canaries come later, require a dedicated provider or payment cell with a finite worst-case loss measured in cents, and require an explicit operator promotion for each run. If enforcement is delayed and the maximum overshoot cannot be bounded, that real endpoint is ineligible for a canary.

This proposal also changes the meaning of the repository test suite. `npm test` should eventually mean **zero network, zero provider spend, zero canonical-runtime contact**. Tests that need a daemon should receive an already-provisioned Drydock endpoint and run lease rather than quietly starting a same-UID daemon from source.

---

## 1. Why this exists

The September 2026 halt revealed a control-plane failure, not merely a billing surprise. Port Daddy had mechanisms that described budgets, recorded costs, sandboxed cooperative workers, and displayed activity, but no independent mechanism proved the maximum loss before execution.

Several current source truths matter:

1. `tests/helpers/ephemeral-daemon.js` starts `server.ts` directly under the test runner's UID and begins its environment with `...process.env`. It isolates the database and socket, but it does not create an OS trust boundary or prove provider credentials absent.
2. `jest.config.js` includes an integration project whose global setup launches that daemon automatically. A generic `npm test` is therefore not a pure or runtime-free operation.
3. `scripts/chaos.ts` calls `resolveDaemonUrl()`, mints actors, and writes services, sessions, locks, messages, and inbox records. It is a live-state mutator masquerading as a convenient scenario generator.
4. `lib/coast-guard/egress-meter.ts` accurately states that a malicious same-UID child can unset proxy variables and bypass its cap. It is useful cooperative-case machinery, not a containment proof.
5. `SpawnSpec.budgetUsd` in `lib/spawner.ts` is documented as enforced after telemetry. The backend runs first; cost is computed and recorded afterward; only then can the result become `over_budget`.
6. `tests/unit/spawner-budget-cap.test.js` currently asserts that a missing, zero, negative, malformed, or non-number budget creates no hard cap and may still complete paid work.
7. `lib/cost-tracker.ts` is retrospective accounting. Its purpose is to record what happened, not reserve authority before it happens.
8. `lib/bonds.ts` contains a useful local escrow and conservation model, but Port Daddy cannot be the independent spend authority while Port Daddy itself is the subject under test.

None of these observations means the code is worthless. It means each mechanism has a narrower proof boundary than the product story had allowed.

Drydock makes those boundaries explicit and supplies the missing external control.

---

## 2. Goals and non-goals

### 2.1 Goals

Drydock must make it possible to:

- run untrusted Port Daddy builds without access to the operator's machine, accounts, canonical runtime, or repositories;
- deterministically simulate one worker, many workers, providers, GitHub, Relay, clocks, failures, and human decisions;
- prove a broker protocol-exposure ceiling before a request starts and, only when backed by a dedicated external cell with bounded enforcement tolerance, a hard upper bound on actual financial loss;
- distinguish attempted effects from permitted effects and completed effects;
- replay incidents and race schedules from content-addressed inputs;
- collect trustworthy evidence even when the guest crashes or lies;
- graduate the repository test suite from process isolation to system isolation;
- exercise failure paths that are unsafe or expensive on a developer machine;
- compare implementations against the same typed scenario and invariant set;
- prove that crashes, retries, duplicate ingress, backend handoff, and host reboot
  cannot create an unaccounted process or second authoritative body; and
- make promotion from simulation to tiny real canary deliberate and reversible.

### 2.2 Non-goals

The first Drydock is not:

- a general-purpose cloud platform;
- a new agent orchestrator;
- a model that decides whether Port Daddy is safe;
- a replacement for unit tests;
- a guarantee against a hypervisor or host-kernel vulnerability;
- a way to put production credentials into a guest more carefully;
- a reason to restart the canonical daemon early;
- an automatic release gate that spends real money;
- a remote-harbor custody protocol; or
- proof that an agent's output is good merely because its effects were bounded.

Containment, correctness, usefulness, and moral legitimacy are separate claims.

---

## 3. Safety axioms

Every design decision follows from eight axioms.

### Axiom 1: the subject is adversarial

Assume the guest has root, understands the harness, can alter Port Daddy, can spawn subprocesses, can flood every channel, and may coordinate multiple workers against the boundary.

### Axiom 2: policy inside the subject is evidence, not enforcement

Environment variables, prompts, application counters, middleware, in-guest firewalls, and in-guest logs can improve behavior. They do not establish a hard boundary against the guest.

### Axiom 3: no effect without a host-controlled channel

Filesystem export, network egress, credentials, provider calls, Git publication, clocks, and promotion must cross a channel owned by Drydock. If an effect has a bypass path, the effect is not controlled.

### Axiom 4: no money without prior reservation

Observing cost after a call is accounting. The broker must reserve its conservative maximum charge before the first provider byte is sent. That reservation bounds what the broker is authorized to dispatch; it bounds actual financial loss only when a dedicated provider or payment cell independently stops further liability and its nominal limit plus worst-case enforcement overshoot fits the operator's approved exposure.

### Axiom 5: absence is safer than filtering

No network device is stronger than an allowlist. No host mount is stronger than a read-only mount. No secret in the guest is stronger than secret scrubbing. Add channels only for a named test tier.

### Axiom 6: the witness is outside the accused system

Run state, budget state, kill decisions, packet attempts, and final evidence are recorded by the host controller. Guest receipts can be included, but cannot overwrite or certify the host record.

### Axiom 7: promotion is a new authority grant

A simulation PASS does not silently authorize a canary. A canary PASS does not silently authorize multi-agent execution. Each tier requires a separate, explicit, expiring lease.

### Axiom 8: the canonical checkout is a read-only projection

The host checkout of `main` is not a workplace, cache, staging directory, source
authority, artifact destination, or place from which an agent may commit. It must
equal the independently fetched `origin/main` tree and contain nothing else.
Agents work only in disposable linked worktrees created from a dedicated bare
source vault. The guest cannot see the canonical checkout at all. Detection is
not the primary defense: the path, file descriptors, Git common directory, and
write authority are absent from the guest and denied to every promotion channel.

---

## 4. Threat model

### 4.1 Protected assets

Drydock protects:

- the operator's provider, GitHub, Cloudflare, Apple, signing, and Relay credentials;
- local repositories, worktrees, Keychain, SSH configuration, cloud configuration, browser state, and home directory;
- the canonical Port Daddy socket, port, database, services, and launchd state;
- the operator's provider balances and subscription quotas;
- the integrity of source inputs and collected outputs;
- the meaning of test and release evidence;
- other machines and services reachable from the host; and
- the host's availability against resource exhaustion.

### 4.2 Adversaries

The design assumes any combination of:

- compromised Port Daddy source;
- a prompt-injected model;
- an agent intentionally evading a budget;
- a runaway recursive spawn loop;
- colluding workers;
- a malicious skill or repository test;
- a dependency executing at install or test time;
- a guest process with root;
- malformed or adversarial provider responses;
- a replayed or duplicated request;
- a stale or malicious price catalog;
- a forged guest receipt;
- a crash between reserve, dispatch, response, and settlement;
- a compromised output artifact; and
- a controller implementation bug.

### 4.3 Residual risks

Drydock reduces but cannot eliminate:

- hypervisor, host-kernel, firmware, or CPU escape vulnerabilities;
- physical compromise of the host;
- malicious controller binaries or build supply chain;
- provider billing that differs from its published contract; this is financially bounded only when a dedicated external cell has a finite documented-and-measured overshoot included in the operator's exposure, otherwise the real-provider tier is denied;
- operator error when approving a higher tier;
- side channels within the limits of the selected virtualization platform; and
- semantic harms in output that do not require a prohibited external effect.

These remain explicit in every promotion receipt. “Ran in Drydock” is not shorthand for “risk-free.”

This threat model adopts the controllable/uncontrollable event split developed in
the repository's [assurance paper](../harbor-research/tex/paper4.tex). Drydock can
prevent only effects whose complete channel it owns: VM devices, host mounts,
brokered egress, credential use, publication, and process lifetime. Model thought,
internal planning, and any effect with an unmediated bypass are detect-only or
outside the claim. The scenario catalog must therefore classify each forbidden
event before promising prevention that a supervisor can prevent it.

---

## 5. Trust and process topology

```mermaid
flowchart TB
    Operator([Operator])
    Approval[/"Explicit tier and budget approval"/]

    subgraph Host["Host trust boundary"]
        Controller["Drydock controller<br/>Verifies digests and owns VM, clock, limits, kill switch, and run state"]
        Broker["Budget and effect broker<br/>Holds credentials, reserves cost, exposes typed operations, and denies undeclared effects"]
        Log[("External receipt log<br/>Append-only observations, settlements, effects, and artifact digests")]

        subgraph Guest["Disposable guest"]
            Driver["Trial Basin driver<br/>Virtual clock, deterministic scheduler, fake services, faults, and assertions"]
            Subject["Port Daddy test subject<br/>No host mounts, raw credentials, or general network"]
            Storage[("Read-only source, disposable state, and bounded output")]
        end
    end

    Operator --> Approval
    Approval --> Controller
    Controller -->|Creates, constrains, and destroys| Driver
    Controller --> Broker
    Broker -->|Capabilities and bounded results| Driver
    Driver -->|Typed effect requests| Broker
    Driver -->|Schedules and injects faults| Subject
    Subject -->|Events and effect requests| Driver
    Storage --> Subject
    Driver -.->|Guest evidence over controller-owned channel| Controller
    Controller -->|Host observations and bounded guest evidence| Log
    Broker -->|Reservations and effect attempts| Log
```

### 5.1 Trusted computing base

The initial trusted computing base is deliberately small:

- the host OS and hypervisor;
- the Drydock controller;
- image and source digest verification;
- the budget/effect broker;
- the external receipt writer;
- the operator approval surface; and
- the minimal transport connecting guest requests to the broker.

Port Daddy, its dependencies, its tests, its databases, every agent backend, and all guest tooling are outside the trusted computing base.

### 5.2 Controller rules

The controller:

- is a separate executable and package from Port Daddy;
- has no model backend and never delegates a safety decision to an agent;
- does not import Port Daddy runtime modules;
- accepts only versioned declarative manifests;
- uses monotonic host time for leases and deadlines;
- stores control state outside guest-writable storage;
- has a single bounded concurrency default;
- can be stopped independently of the guest;
- cannot be configured from a guest message; and
- emits a receipt for every state transition, denial, and override.

An eventual polished UI may share visual language with FleetBar or the Bridge. It must not depend on either application being healthy.

### 5.3 Implementation language is part of the trust boundary

**Decision: implement the Drydock security nucleus in Rust, not all of Drydock and
not Port Daddy itself.** The language split follows authority:

| Component | Language / mechanism | Authority and reason |
|---|---|---|
| `drydock-core` | Rust | Canonical manifest validation, lifecycle state machine, capability derivation, resource policy, receipt chain, and SQLite writer. This is trusted security logic and must have one implementation. |
| `drydock-watchdog` | a second small Rust process | Owns the host deadline, controller liveness lease, effect revocation, and forced teardown. It must still act when the controller, UI, or guest is wedged. |
| `drydock-broker` | a separately packaged Rust process | The only process that may hold a provider credential or open approved external connections. It is absent from the T0-T2 installation and is never dynamically loaded by guest input. |
| `trial-basin` | Rust library and executable | Deterministic event queue, virtual clock, seeded faults, fake/replay services, invariant evaluation, and counterexample minimization. Its initial scheduler is single-threaded and explicit rather than relying on host thread timing. |
| macOS VM adapter | a tiny Swift 6 helper over Virtualization.framework | Swift is the narrow, first-class bridge to Apple's Objective-C/Swift API. It configures and controls the VM; it does not decide policy, hold credentials, write the ledger, or issue verdicts. |
| Linux VM adapter | Rust controller over upstream Firecracker and Jailer binaries | Firecracker is already the reviewed VMM. Drydock should orchestrate its API and verify its jail rather than fork or reimplement the VMM. |
| guest bootstrap | minimal Rust or shell-free static helper; untrusted | Frames requests and observations inside the guest. It receives no authority merely because it is written in Rust. |
| Switchboard | small native Rust control surface | Displays the sealed launch contract and exposes only launch, cut-egress, kill, inspect, and export. No WebView or dynamic extension belongs on the authority path. The exact Rust UI toolkit is a D0 spike, not a security primitive. |
| Observatory | TypeScript/React, read-only | Rich browsing of receipts, traces, diffs, and long event histories. It receives no mutation capability. Large collections use windowed rendering with stable row identity and measured overscan. |
| schemas and formal models | JSON Schema/test vectors plus TLA+ | Language-neutral interchange and finite-state specification. Rust is the canonical runtime validator; generated or second-language readers must pass the same fixtures. |
| Port Daddy and submitted tests | their existing languages; untrusted | They are subjects. Rewriting them in Rust would not move them outside the guest or make their assertions authoritative. |

This is consistent with ADR-0120's rule that security primitives have one small
Rust implementation while ordinary Port Daddy product logic stays TypeScript.
Drydock is not another Port Daddy product plane: its controller, broker, watchdog,
and durable admission state are the external trusted computing base. Rust reduces
memory-unsafe implementation risk and gives the macOS and Linux paths one typed
state machine, but isolation still comes from process identities, VM boundaries,
device absence, external custody, and revocation. A Rust process running with the
guest's identity or importing guest-controlled modules would be just as
disqualified as a TypeScript process.

The production controller should live in a **separate repository and release
chain** from Port Daddy. A Port Daddy pull request may supply inert source and test
bytes, but cannot rebuild, replace, configure, or sign the controller that judges
it. The Drydock host pins signed controller, helper, VMM, image, and policy digests.
Any development copy built from the Port Daddy tree is `DEV_UNTRUSTED` and cannot
issue promotion evidence.

Every cross-process protocol is versioned, length-prefixed, size-bounded, rejects
unknown fields, and has fixture vectors for accepted and rejected frames. The
macOS Swift helper uses inherited pipes or pre-opened descriptors instead of a
discoverable general-purpose listener. The controller passes run-scoped handles,
not ambient paths or environment. Neither helper nor UI can raise a ceiling or
select a new executable after sealing.

The reusable decision and build rules live in
`skills/sandboxed-adversarial-test-harness/references/implementation-language-and-fail-cheap-controls.md`.

---

## 6. Isolation profiles

### 6.1 macOS development profile

Use a disposable Linux virtual machine built with Apple's Virtualization framework. A Lima `vz` prototype is acceptable for learning and image tooling, but only with a fully audited configuration and without treating Lima defaults as the security case.

Required profile:

- no directory sharing from `/Users`;
- no Rosetta sharing;
- no SSH agent forwarding;
- no host clipboard integration;
- no host socket passthrough;
- no bridged networking;
- no general NAT networking;
- no raw disk containing host data;
- read-only, digest-pinned base image;
- read-only, digest-pinned input volume;
- disposable copy-on-write state disk;
- a separate bounded output disk initialized by the controller;
- fixed vCPU and RAM;
- host-enforced wall-clock deadline; and
- teardown that detaches and destroys the overlay before the run can be reused.

The source bundle should be an archive or filesystem image created from an exact
Git tree in a dedicated bare source vault, never from the canonical checkout or a
developer's mutable worktree.

### 6.2 Linux high-assurance profile

Use Firecracker on a dedicated Linux KVM host when the team needs a smaller microVM surface, repeatable high-volume runs, or stronger production-style isolation.

Required host posture includes:

- a dedicated unprivileged UID/GID for each microVM or run;
- Firecracker's jailer;
- default seccomp filters or stricter reviewed filters;
- namespaces and cgroups;
- CPU, memory, process, disk, network, and time limits;
- no host swap for guest memory where practical;
- bounded serial output and log drains;
- read-only root image plus disposable overlay;
- per-run network namespace with no default route; and
- a clean host image that does not contain operator credentials.

Firecracker is a Linux/KVM choice. It is not presented as a native macOS path.

### 6.3 gVisor as an inner defense

Selected untrusted guest workloads may run under gVisor inside the VM. On a nested guest, its userspace `systrap` platform is more plausible than nested KVM. This can reduce exposure to the guest kernel but adds compatibility and performance cost.

gVisor does not replace the outer VM, the host budget broker, or the absence of host mounts.

### 6.4 Containers are not the primary boundary

A container can be a useful packaging and process-control layer inside a guest. A same-kernel container on the operator's machine is not sufficient for hostile Port Daddy execution because a container escape or privileged host integration collapses the boundary directly into the operator environment.

### 6.5 Three machines, three purposes

The long-term topology may use:

| Profile | Purpose | Allowed tiers |
|---|---|---|
| Developer Mac VM | fast offline simulations and source integration | T0-T2 |
| Dedicated Linux microVM host | adversarial and concurrent system trials | T0-T5 |
| Isolated canary host/account | tiny billable-provider or subscription-capacity checks | T3A/T3B-T4 |

No profile shares the canonical daemon's state directory.

Primary platform references:

- [Apple: Creating and running a Linux virtual machine](https://developer.apple.com/documentation/virtualization/creating-and-running-a-linux-virtual-machine)
- [Apple: custom virtual-network attachment](https://developer.apple.com/documentation/virtualization/vzvmnetnetworkdeviceattachment)
- [Lima: Virtualization.framework driver](https://lima-vm.io/docs/config/vmtype/vz/)
- [Lima: mounts](https://lima-vm.io/docs/config/mount/)
- [Firecracker: getting started and KVM requirements](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- [Firecracker: production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md)
- [gVisor: platform selection](https://gvisor.dev/docs/user_guide/platforms/)
- [gVisor: production guidance](https://gvisor.dev/docs/user_guide/production/)

---

## 7. Immutable staging and provenance

Every run begins from a sealed `RunManifest`. The controller resolves no floating branch after sealing.

### 7.1 Required input identities

The manifest binds:

- normalized repository remote;
- independently observed remote-ref commit for `refs/heads/main`;
- exact source commit;
- source-tree digest;
- source archive or input-volume digest;
- base image digest;
- controller version digest;
- scenario digest;
- policy digest;
- provider price-catalog digest;
- optional dependency-lock digests;
- expected output schema; and
- operator approval identity and expiry.

### 7.2 Source packaging

The source packer runs outside the guest, reads only a dedicated bare source
vault, and must:

1. query the named remote for the exact `refs/heads/main` object without consulting
   a developer checkout's remote-tracking ref;
2. fetch that exact object into the dedicated bare vault;
3. verify the normalized remote, object reachability, commit, and tree against policy;
4. create a fresh detached linked worktree in the approved worktree root from that
   object, never a parent checkout discovered by walking upward;
5. reject a path equal to, inside, or resolving through the canonical checkout and
   reject a Git common directory that is not the approved vault;
6. export only the exact tree from that fresh worktree;
7. reject submodules or large-file pointers not pinned by digest;
8. reject sockets, devices, setuid files, and absolute symlinks;
9. produce a deterministic archive or filesystem image;
10. hash the result; and
11. seal the remote witness, commit, tree, worktree identity, and archive digest
    into the run lease.

This directly addresses the dispatch provenance regression in which a worktree operation could inherit the wrong parent Git repository. The guest receives a sealed tree and has no authority to reinterpret its origin.

Repository hooks, hook configuration, and hook-arming code are **subject bytes**,
not host policy. The packer excludes `.git`, parent repository configuration, and
host hooks. A scenario may deliberately execute a submitted hook only inside the
disposable guest, after the exact tree is sealed, with the same zero-network or
brokered-effect limits as every other hostile process. No hook runs during host
fetch, export, verification, image construction, artifact promotion, or receipt
publication. Therefore a product feature that arms hooks is testable behavior; it
never becomes a Drydock controller extension.

### 7.3 Canonical-checkout exclusion and worktree-only authorship

Drydock treats the host's canonical checkout as a protected projection whose only
valid state is the exact tree of the independently witnessed `origin/main` commit,
with a clean index, clean worktree, no untracked files, and no local commit. It is
not trusted merely because `git status` happens to be clean: a stale clean checkout
is still not `origin/main`, and a mutable remote-tracking ref is not a live remote
witness.

Prevention has four independent layers:

1. **No path:** the canonical checkout, its parent directories, and its Git common
   directory are absent from every guest device and mount manifest.
2. **No host authority:** agents and guest-facing helpers run as identities that
   cannot traverse or write the canonical checkout. A read-only snapshot or ACL is
   defense in depth; absence from the guest remains the primary boundary.
3. **No valid target:** the artifact broker accepts only a newly created linked
   review worktree beneath an approved worktree root. It rejects `main`, `master`,
   detached canonical paths, path aliases, symlink aliases, ancestor traversal,
   caller-selected `GIT_DIR`/`GIT_WORK_TREE`, and an unexpected Git common directory.
4. **No direct publication:** the guest exports a bounded patch or Git bundle into
   quarantine. A separate promoter may apply it only to the named review worktree
   on a non-default branch after re-verifying remote, base, clean state, and target
   identity. The guest has no production remote or GitHub credential.

The source worktree used to build a guest is disposable and read-only after
sealing. Authoring happens in a separate guest-local worktree backed by a
guest-local repository copy. Its commits are evidence objects only. They cannot
move a host ref. When output is approved, the promoter creates another fresh host
linked worktree from the current independently fetched `origin/main`, verifies it
is outside the canonical checkout, and applies the quarantined change there. No
agent command ever runs with the canonical checkout as its working directory.

Before and after every run and promotion attempt, a checkout-integrity witness
records the canonical path identity, HEAD, index tree, worktree tree, untracked
count, Git common-directory identity, and comparison with the live remote witness.
Any disagreement blocks new work and is surfaced as a host-integrity incident. The
witness detects host activity outside Drydock; it does not retroactively make an
exposed path safe.

Drydock never resets, stashes, deletes, restores, relocates, or otherwise “cleans”
a divergent canonical checkout. Those bytes may belong to a person or another
tool. Only a separately authorized checkout custodian may replace the projection
from the verified remote tree, and that replacement has its own destructive-action
preview and receipt. A host operator or root process outside Drydock remains able
to mutate host storage; that residual is stated plainly rather than misrepresented
as a hypervisor guarantee.

Repository hooks and wrappers may provide a friendly error when someone tries to
commit from the canonical checkout, but they are bypassable ergonomics, not the
security boundary. Remote branch protection remains independently required.

### 7.4 No ambient package installation

Initial tiers use prebuilt, digest-pinned images. `npm install`, package-manager hooks, Homebrew, `curl | sh`, and arbitrary dependency downloads are denied inside a run.

A future dependency-fetch stage is a separate, networked build chamber whose outputs are scanned, pinned, and promoted into an image. It is not the same trust tier as executing the result.

### 7.5 Output quarantine

Guest output never lands directly in the canonical checkout, a developer
worktree, or a Git remote. It enters a quarantine store with:

- file-count and byte ceilings;
- path normalization;
- no devices, sockets, fifos, setuid bits, or escaping symlinks;
- content hashes;
- malware and archive-bomb checks where appropriate;
- textual diff generation outside the guest;
- explicit operator or reviewer promotion; and
- an immutable link to the run receipt.

A patch is evidence, not an instruction to apply itself. Promotion creates and
targets a fresh linked review worktree; a canonical-checkout or default-branch
target is structurally invalid rather than an overrideable warning.

---

## 8. Network and effect control

### 8.1 Default: no network device

T0 and T1 runs have no guest network device. This is stronger and simpler than proving an allowlist against every client, protocol, proxy setting, subprocess, DNS method, and packet encoding.

Fake services can run inside the same guest on a private loopback. They cannot bind the host.

### 8.2 Mediated network profile

When a tier needs external behavior, the controller attaches a purpose-built isolated network or a narrow host/guest transport. The guest has no default route to the internet.

The broker rejects:

- arbitrary DNS;
- arbitrary TCP or UDP;
- `CONNECT` tunneling;
- private, loopback, link-local, multicast, LAN, and cloud metadata destinations;
- redirects to undeclared origins;
- alternate ports and protocols;
- unbounded streaming;
- request bodies over the lease limit; and
- any request without a live operation capability.

The broker exposes typed operations such as `model.complete`, `github.fixture.read`, or `relay.fixture.publish`. It does not expose a generic proxy.

### 8.3 Model protocol

The guest calls a provider-neutral Drydock Model Protocol. It refers to immutable input already held by the controller; it does not get to declare the billable input size that drives reservation:

```json
{
  "operation": "model.complete",
  "leaseId": "lease_01...",
  "requestId": "req_01...",
  "providerClass": "fake|replay|real-canary",
  "modelClass": "low-reasoning",
  "input": {
    "payloadRef": "run-input:sha256:...",
    "claimedDigest": "sha256:...",
    "claimedBytes": 4120
  },
  "requestedMaxOutputTokens": 600,
  "timeoutMs": 20000
}
```

The broker resolves `payloadRef` from a controller-owned sealed store, or receives the payload in the same authenticated and size-bounded frame. It recomputes the digest and byte count, inventories tool and media inputs, and derives a conservative provider-specific upper bound for every billable input dimension. Guest-supplied digest, size, and output fields are requests or consistency hints, never accounting authority. A mismatch, unresolved reference, unsupported input kind, or request above the capability ceiling is denied before reservation.

For fake and replay tiers, the response is local and deterministic. For a real canary, the host reserves from those broker-observed inputs and host policy, constructs the vendor request itself, holds the credential, terminates the provider connection, and returns only the bounded result.

The guest never chooses an arbitrary model identifier or URL. Logical model classes map to a sealed host policy.

### 8.4 Git and GitHub

The first four tiers provide local Git fixtures only. The guest has no GitHub token and cannot push, comment, open a pull request, trigger automation, or merge.

If a later test requires GitHub behavior:

- use a dedicated throwaway organization or repository;
- use an app installation scoped to that repository and operation class;
- mint a short-lived token outside the guest;
- expose typed fixture operations rather than the token;
- set an external action and spend budget;
- deny repository administration and workflow mutation; and
- destroy the fixture after an external collector records it.

Production repositories are never the first proving target.

### 8.5 Host-proven canonical-runtime isolation

Before launch, the host controller proves from its own VM and network configuration that the guest has:

- no host home, source checkout, `~/.port-daddy`, Keychain, service-control, or canonical socket mount;
- no Unix-socket mapping or port-forward to the canonical daemon;
- no route to the host, the canonical daemon address, the LAN, or a general NAT gateway; and
- no effect channel except the run-scoped typed broker transport.

The host and broker record attempts that cross a host-owned virtual device or broker boundary. Guest loopback is the guest's own namespace, however: a connect to guest `127.0.0.1:9876` is not a packet to host loopback, and the host cannot claim to observe a guest-only path or syscall without a separately trusted external instrumentation mechanism.

Optional in-guest probes may check familiar ports, socket names, home prefixes, or service paths as defense in depth. Their results are labeled `GUEST_ASSERTED`; they cannot satisfy the isolation gate or certify the host. A host-observed route, mount, mapping, or broker-policy violation fails the scenario and terminates the guest.

---

## 9. Credential custody and capabilities

### 9.1 No raw secret crosses the boundary

The guest receives neither provider secrets nor a general bearer capable of requesting arbitrary operations. The host broker owns vendor credentials in an isolated key store.

### 9.2 Operation capability

Each capability is bound to:

- run ID;
- guest measurement or image digest;
- source and scenario digest;
- operation class;
- logical provider/model class;
- maximum calls;
- maximum input/output tokens and bytes;
- worst-case reserved cost;
- expiry and monotonic deadline;
- idempotency policy;
- allowed response destination; and
- operator approval receipt.

Capabilities are one-shot by default. A run cannot mint, widen, renew, or transfer them.

### 9.3 Redaction and evidence

The host receipt records request and response digests, sizes, model mapping, token counts, reservation, settlement, timing, and policy decision. Raw prompts or model outputs are retained only when the scenario's data policy explicitly permits them.

Credential values, authorization headers, cookies, and provider request signatures are never written to guest logs or run artifacts.

---

## 10. Spend control as an externally backed prepaid state machine

### 10.1 Unit of account

Use integer micro-USD or a smaller fixed integer unit, never binary floating point, for reservations and settlement.

The price catalog is:

- fetched and signed outside the guest;
- versioned by digest;
- scoped to provider and model;
- explicit about input, cached input, output, tool, image, and fixed fees;
- timestamped with a maximum age; and
- attached to every reservation receipt.

Unknown, missing, contradictory, or stale price means **deny** or **use a fake provider**.

### 10.2 Request lifecycle

```mermaid
stateDiagram-v2
    state "EXPIRED / REFUNDED" as EXPIRED_REFUNDED
    state "SETTLED + REFUNDED REMAINDER" as SETTLED

    [*] --> PROPOSED
    PROPOSED --> RESERVED: capability, catalog, ceilings, and idempotency valid
    RESERVED --> EXPIRED_REFUNDED: dispatch lease expires
    RESERVED --> DISPATCHED: provider dispatch begins
    DISPATCHED --> UNCERTAIN: outcome unknown; hold reservation
    DISPATCHED --> SETTLED: usage reconciled
    UNCERTAIN --> SETTLED: reconcile or settle conservatively
    EXPIRED_REFUNDED --> [*]
    SETTLED --> [*]
```

No provider connection is opened before `RESERVED` is durably committed. For a real canary, the controller also proves that the dedicated external cell's configured limit plus finite documented-and-measured enforcement tolerance fits the run's approved financial-loss ceiling. Internal reservation is necessary but not sufficient for that claim.

### 10.3 Worst-case reservation

For request `q`:

```text
reserve(q) = fixed_fee
           + broker_input_token_upper_bound  * input_price
           + broker_cached_token_upper_bound * cached_input_price
           + policy_output_token_ceiling     * output_price
           + policy_tool_call_ceiling        * max_tool_fee
           + bounded_safety_margin
```

The broker derives input bounds from the payload bytes and attachments it actually resolves or receives. Output and tool ceilings come from the signed capability and sealed host policy. Guest declarations can only request less; they cannot increase or understate the values used for reservation.

Admission succeeds only when the reservation fits every remaining ceiling:

- request;
- actor;
- run;
- project;
- provider;
- hour;
- day;
- operator account; and
- global emergency cap.

The minimum remaining ceiling wins.

### 10.4 Conservation invariant

For each funded account, all terms are non-negative integer units and the state conservation equation is:

```text
gross_deposits + authorized_credits
  = available
  + outstanding_reservations
  + settled_provider_spend
  + external_withdrawals
  + adjudication_holds
```

Reservation release is an internal transfer from `outstanding_reservations` back to `available`; it is not a separate cumulative refund term. A provider reversal that restores account value is an `authorized_credit`. A dispute amount removed from ordinary availability remains in `adjudication_holds` until a terminal transition moves it elsewhere.

For example, depositing 10 and reserving 5 yields `available=5, reservations=5`. Releasing the reservation yields `available=10, reservations=0`. Settling 2 and releasing the remaining 3 yields `available=8, settled=2`. Every state still conserves 10 without counting the release twice.

Every transition is atomic and idempotent. Property tests explore crashes and duplicate messages at every boundary.

### 10.5 Retry rules

- A duplicate idempotency key returns the original state and never dispatches twice.
- An explicitly non-idempotent retry requires a new reservation.
- A timed-out provider call becomes `UNCERTAIN`; its full reservation remains held until provider reconciliation or conservative settlement.
- Guest restart cannot create a new allowance.
- Concurrent requests reserve independently before either leaves the host.
- A response stream is cut off when its output allowance is exhausted.

### 10.6 Subscription and flat-rate backends

CLI subscriptions without a provider-enforced marginal cap are not “free.” They consume finite account capacity and can trigger consequential automation.

Until Drydock can obtain a dedicated external cell whose total worst-case liability is finite and fits the approved exposure, these backends are allowed only as:

- deterministic fakes;
- recorded replay; or
- local model adapters with host compute limits.

An internal estimate such as `$0.001` is telemetry, not a spend boundary.

### 10.7 Fail-cheap operating contract

The safest failed run is the one rejected before a VM boots, a provider socket
opens, or a retry timer exists. Drydock therefore has stronger defaults than a
normal resilient service:

1. **T0-T2 have zero external-spend capability by construction.** Their installed
   package contains fake and replay adapters only. The real-provider broker is a
   separate signed artifact on a separate canary host or account.
2. **No time-based refill exists.** A daily reset can restart a runaway system at
   midnight. Funds enter a canary cell only through an explicit, expiring,
   one-shot operator grant bound to run, provider, model, request count, attempt
   count, output ceiling, price digest, and custody evidence.
3. **The first T3A or T3B profile permits one request, one attempt, concurrency
   one, no tools, and no recursive work.** A failed request ends the run. Automatic
   provider retries remain disabled until a later adversarial gate proves
   idempotency, aggregate pre-reservation, deadline propagation, and provider
   behavior.
4. **All possible attempts are reserved before the first attempt.** If a later
   profile permits two attempts, the reservation covers two worst-case calls;
   there is one retrying layer only. Provider SDK retry loops are disabled.
5. **Ambiguity trips a durable breaker.** Timeout after write, missing usage,
   quota disagreement, stale price data, provider overage, receipt-store failure,
   or broker restart moves the provider cell to `FORCED_OPEN`. It never
   automatically becomes half-open; a new human-approved probe has its own lease
   and reservation.
6. **Deadlines only decrease.** The operator lease carries an absolute monotonic
   deadline. Controller, broker, helper, and guest receive the remaining time,
   never a fresh timeout.
7. **The controller cannot spend to diagnose a spend failure.** Reconciliation is
   a read-only provider query under a distinct credential and call ceiling, or an
   operator-supplied receipt. No model is asked whether the bill looks safe.
8. **Emergency stop is a negative-authority path.** The operator or watchdog may
   bypass normal dispatch sequencing only to revoke broker leases, cut egress, or
   force teardown. That path cannot mint, widen, resume, retry, publish, settle as
   success, or otherwise create a positive effect. The broker remains the sole
   gateway for admitted external effects; it is not a single point that may block
   emergency revocation.

If retries are ever enabled after the one-attempt baseline, they require an
idempotency key, full-jitter backoff, an aggregate retry ratio no greater than 10%,
a total attempt cap no greater than three, and enough remaining absolute deadline
for the complete next attempt. Authentication, authorization, validation, stale
catalog, custody, receipt, and unknown-commit failures never retry. These generic
upper bounds do not grant retries; the sealed provider profile must opt in to a
smaller bound.

| Failure observed before or during a run | Mandatory cheap response | New paid call? |
|---|---|---:|
| malformed or unknown manifest field | `INVALID`; write denial receipt | no |
| database unavailable, locked past deadline, corrupt, or migration unverified | `BLOCKED`; keep broker disarmed | no |
| image, source, policy, price, or helper digest mismatch | `INVALID`; do not boot | no |
| custody evidence missing, shared, stale, or larger than approval | `BLOCKED`; fake/replay remains available | no |
| breaker open or prior usage unresolved | `BLOCKED`; reconcile or abandon cell | no |
| guest asks for more bytes, tools, attempts, actors, or time | deny request; preserve run ceiling | no |
| receipt storage approaches its reserved disk floor | revoke egress, stop dispatch, kill if evidence cannot drain | no |
| provider may have accepted a timed-out request | `UNCERTAIN`; hold full reservation and open breaker | no |
| operator UI disconnects | controller/watchdog continue the sealed deadline; no promotion | no |
| controller heartbeat expires | watchdog cuts broker authority, then forces VM teardown | no |

The pre-launch contract uses plain quantities: `External spend: $0.00`, or for a
canary, `At most $0.05 · one request · no retries · expires 14:32:10`. It also
shows the provider-side ceiling and measured overshoot allowance separately.
“Budget configured” is never rendered as “cannot exceed.”

---

## 11. Compute, process, and output budgets

Every run has hard host-side limits:

| Resource | Initial default | Enforcement witness |
|---|---:|---|
| vCPU | 1 | hypervisor/controller |
| RAM | 2 GiB | hypervisor/controller |
| guest disk | 8 GiB COW | block device/controller |
| output disk | 64 MiB | dedicated bounded volume |
| PIDs | 128 | cgroup/guest supervisor plus VM deadline |
| file descriptors | 512 | guest profile plus host deadline |
| wall time | 10 minutes | monotonic host timer |
| idle time | 60 seconds | host-observed event silence |
| stdout/stderr | 8 MiB ring each | host collector |
| artifacts | 256 files | output importer |
| external calls | 0 except explicit canary | broker ledger |
| concurrent actors | 1 | controller scheduler |
| spawn depth | 0 | scenario policy/broker denial |

Values are policy examples, not magic constants. The important property is that the guest cannot raise them.

Serial and console output must be drained into bounded rings. A guest that floods logs should lose output, receive a receipt annotation, and eventually be terminated; it must not exhaust host memory or disk.

---

## 12. Run lifecycle

Drydock uses an externally driven lifecycle:

1. **PLAN** — parse the scenario and compute maximum exposure.
2. **SEAL** — resolve immutable image, source, policy, price, and scenario digests.
3. **APPROVE** — obtain the tier-specific operator lease.
4. **RESERVE** — reserve aggregate run budget before a networked guest can exist.
5. **STAGE** — create read-only inputs, disposable disks, and output quota.
6. **BOOT** — start the guest without network.
7. **ATTEST** — verify the expected guest bootstrap measurement and protocol version.
8. **HANDSHAKE** — issue the minimum run capability.
9. **DRIVE** — advance deterministic scenario events.
10. **INJECT** — apply declared faults and schedule choices.
11. **OBSERVE** — collect host and guest event streams without trusting either as the other.
12. **QUIESCE** — revoke operation capabilities and wait for bounded shutdown.
13. **COLLECT** — detach the output volume and import through quarantine.
14. **VERIFY** — evaluate invariants from external receipts.
15. **SETTLE** — settle or retain reservations and emit the final budget receipt.
16. **DESTROY** — destroy guest state and prove no reusable lease remains.

The controller may transition to `KILLING` from any state after `BOOT`. Kill revokes egress first, then stops the VM. If graceful shutdown does not complete within the host deadline, destruction is forced.

---

## 13. Trial Basin scenario model

### 13.1 Scenario as data

Scenarios are versioned, reviewable data rather than imperative scripts that discover the local environment.

```yaml
apiVersion: drydock.portdaddy.dev/v1alpha1
kind: TrialScenario
metadata:
  name: duplicate-provider-timeout-conserves-budget
  labels:
    tier: T1
    family: spend-control
spec:
  subject:
    repository: https://github.com/curiositech/port-daddy.git
    commit: 0123456789abcdef0123456789abcdef01234567
    treeDigest: sha256:...
    entrypoint: fixture:budget-state-machine
  environment:
    imageDigest: sha256:...
    network: none
    clock: virtual
    seed: 884219
    resources:
      cpus: 1
      memoryMiB: 512
      wallTimeMs: 30000
      outputBytes: 1048576
  budget:
    currency: microUSD
    runCeiling: 25000
    realProviderCeiling: 0
  actors:
    - id: requester
      driver: scripted
      script: fixtures/actors/requester-duplicate-timeout.yaml
    - id: provider
      driver: fake-provider
      fixture: fixtures/providers/partial-stream-timeout.json
  schedule:
    mode: deterministic
    decisions:
      - after: request.reserved
        inject: broker.crash
      - after: broker.restart
        deliverTwice: request.retry
  assertions:
    - reservation.count == 1
    - provider.dispatch.count == 1
    - account.conservationError == 0
    - network.externalPackets == 0
    - run.result == blocked_uncertain
  artifacts:
    retain:
      - external-receipt.json
      - event-trace.ndjson
      - invariant-report.json
```

### 13.2 Schema constraints

The schema rejects:

- floating source refs;
- missing resource ceilings;
- unlabeled network access;
- real providers in T0-T2;
- real-provider ceilings larger than the approved lease;
- inherited environment variables;
- host paths;
- arbitrary shell in the host controller;
- unknown actor drivers;
- unbounded event queues; and
- retention without a data policy.

### 13.3 No ambient environment

The controller builds each guest environment from an explicit allowlist. It never starts with `process.env` and removes keys afterward.

Allowed values are mundane, deterministic runtime settings such as:

- `HOME=/run/drydock/home`;
- `TMPDIR=/run/drydock/tmp`;
- locale;
- virtual time seed;
- run ID;
- input/output mount points; and
- broker endpoint and opaque operation capability when the tier requires it.

Provider, GitHub, cloud, signing, SSH, Keychain, proxy, and canonical Port Daddy variables are absent by construction.

---

## 14. Puppet actors

Trial Basin should support several actor classes behind one event protocol.

### 14.1 Scripted actor

A deterministic state machine emits exact actions in response to exact events. Use it to prove protocol and concurrency behavior without model variability or spend.

Example behaviors:

- heartbeat, claim, edit, test, handoff, complete;
- crash after claiming;
- duplicate a request;
- ignore cancellation;
- attempt an undeclared file write;
- exceed output quota; and
- falsely report success.

### 14.2 Trace-replay actor

Replays a redacted, content-addressed historical event trace. It can preserve timing or run under virtual time. This is the preferred path for reproducing expensive incidents without calling a provider.

### 14.3 Fault actor

Behaves maliciously or irrationally to attack the boundary:

- probes the host filesystem;
- scans network ranges;
- unsets proxy variables;
- opens raw sockets;
- forks recursively;
- creates symlink escapes;
- emits malformed receipts;
- floods logs;
- lies about completion; and
- colludes with another actor through every available channel.

### 14.4 Local-model actor

Uses a digest-pinned local model reachable only through the host broker. It has CPU/GPU, token, request, and time ceilings but no external dollar spend. Local compute is still metered as a resource.

### 14.5 Real-provider canary actor

Uses a real provider only in T3A or T3B (or a later reviewed tier), with a
one-run capability, exact max output, and no tools or external side effects.
T3A additionally requires a dedicated provider/payment cell whose configured
limit plus measured enforcement tolerance fits the approved cash exposure.
T3B instead requires fresh provider-native usage evidence, one atomic reservation
across every canonical capacity bucket and alias, a checkpoint tail, and
before/after settlement; it is never represented as a hard cash cap. This actor
exists to detect protocol drift, not to do useful product work.

### 14.6 Mixed crew

Combines deterministic requesters, replayed workers, one model-backed participant, and fault actors. This lets concurrency and institution-level behavior be tested without multiplying real calls.

All actors emit the same typed envelope:

```json
{
  "actorId": "actor-scripted-1",
  "sequence": 42,
  "virtualTimeNs": 17000000,
  "eventType": "work.completed",
  "payloadDigest": "sha256:...",
  "causalParents": ["event:41"],
  "claimedAuthority": ["fixture.write"],
  "observedAuthority": ["fixture.write"],
  "result": { "kind": "success", "artifactDigest": "sha256:..." }
}
```

The canonical schema fixes key names and value types; JSON member order has no
semantic meaning. Canonical hashing follows the versioned receipt encoding rather
than display order. Unknown fields, duplicate keys, invalid sequence numbers, and
unordered or duplicate causal-parent identities are rejected.

---

## 15. Determinism and schedule control

Agent systems are concurrent systems. “Run it again” is not a reproducibility strategy.

Trial Basin owns:

- a virtual clock;
- seeded pseudo-randomness;
- a deterministic event queue;
- explicit delivery order;
- bounded actor turns;
- message duplication, delay, loss, and reordering;
- filesystem and database fault points;
- provider chunk boundaries;
- process signals; and
- scheduler decision recording.

Each run emits a schedule trace. A failing schedule can be replayed exactly and minimized to the smallest causal sequence.

### 15.1 Schedule exploration

For finite scripted scenarios, use bounded systematic exploration rather than only random fuzzing:

- vary ordering at declared yield points;
- collapse equivalent independent steps;
- stop after the first invariant failure;
- save the minimal counterexample; and
- report unexplored state-space bounds honestly.

### 15.2 Metamorphic checks

Useful metamorphic relations include:

- duplicating an idempotent event does not duplicate an effect;
- delaying a heartbeat changes freshness, not authority;
- changing actor display name does not change identity binding;
- reordering independent reads does not change settlement;
- adding irrelevant files does not change repository provenance;
- retrying after a settled request returns the same receipt;
- killing an actor after output quarantine cannot publish the output; and
- changing a floating branch after sealing cannot change the guest source.

### 15.3 Pure transition core and test-only nondeterminism

The simulation nucleus should be expressible as a pure transition:

```text
step(state, action, virtual_time, entropy_word)
  -> (next_state, declared_effects)
```

Wall time, random IDs, sleep, filesystem results, transport delivery, provider
chunks, and operator decisions enter as typed inputs. The product core emits
effects but does not perform them. Adapters execute an admitted effect and feed a
typed observation back into the next transition. This lets the same state logic
drive table tests, property tests, replay, bounded schedule exploration, and the
real controller without shipping a test scheduler or failpoint API in production.

The first implementation deliberately uses one explicit event queue. Concurrency
is simulated by choosing among legal next actions and recording the choice. Native
threads are introduced only around adapters whose blocking behavior demands them;
their synchronization is tested separately with bounded Rust concurrency tools.

Every replay bundle includes the controller and schema versions, root seed,
derived actor seeds, virtual epoch, decision tape, injected faults, normalized
trace, and final state hash. The invariant is not bit-identical VM execution.
Apple's VM API supplies real entropy and does not expose a deterministic host clock
or fixed RNG seed. Keep safe guest entropy enabled; tests that need controlled time
or randomness replace those dependencies inside the guest fixture and label that
fact. A matching sealed bundle must reproduce the normalized state/effect trace,
or the result is `NONDETERMINISTIC`, not PASS.

The initial test allocation is:

| Tool | Narrow job | Not evidence for |
|---|---|---|
| table tests + Proptest | sequential state-machine traces, arithmetic, shrinking | native races or VM containment |
| Tokio paused time | timers and deadlines implemented on Tokio time | direct wall-clock calls or deterministic scheduling |
| Loom | two- or three-task synchronization primitives | whole-controller behavior |
| Shuttle | larger schedule sampling with persisted replay | exhaustive proof |
| Turmoil | later Tokio transport partitions, delay, and restart | SQLite VFS or host kernel behavior |
| process crash harness | kill around real SQLite transaction boundaries | power-loss behavior unless separately exercised |
| TLA+ | small lease, budget, retry, and teardown safety/liveness model | implementation conformance by itself |
| cargo-fuzz | parsers, frames, manifests, receipts, and artifact import | semantic correctness |

At minimum, model stale lease completion: actor A holds generation `g`, the lease
expires, actor B obtains `g+1`, then A attempts completion or settlement. Every
effect and charge must carry the current fencing generation; a job ID alone is not
sufficient authority.

---

## 16. Fault library

The reusable fault library should include:

### 16.1 Provider faults

- 401/403 credential rejection;
- 429 with and without retry hints;
- 500/502/503;
- connection refusal;
- DNS failure;
- delayed first byte;
- partial stream then timeout;
- response larger than the lease;
- malformed usage metadata;
- usage missing entirely;
- price catalog changes mid-run;
- provider bills more than expected; and
- duplicated provider acknowledgment.

### 16.2 Process faults

- crash before child launch;
- crash after reservation but before dispatch;
- crash after dispatch but before durable result;
- SIGTERM ignored;
- SIGKILL;
- fork bomb;
- CPU spin;
- memory pressure;
- descriptor exhaustion;
- endless stdout/stderr;
- disk fill; and
- zombie process tree.

### 16.3 Coordination faults

- stale heartbeat;
- conflicting claims;
- duplicate session identity;
- handoff without authority;
- worker dies with dirty output;
- manager disappears;
- cancel races with completion;
- old receipt projected onto a new head;
- infrastructure failure reported as PASS;
- queue says active while no worker exists; and
- one incident fans out into many redundant paid reviewers.

### 16.4 Repository and artifact faults

- wrong parent repository discovered by upward Git search;
- branch head moves after sealing;
- malicious submodule;
- absolute or escaping symlink;
- case-collision path;
- archive traversal;
- archive bomb;
- output executable with setuid bit;
- diff contains an undeclared file;
- generated artifact disagrees with source; and
- patch applies cleanly to the wrong base.

### 16.5 Network faults and attacks

- unset proxy variables;
- alternate HTTP library;
- direct IP after DNS denial;
- IPv6 bypass;
- UDP and QUIC;
- raw socket;
- redirect to private address;
- cloud metadata endpoint;
- host gateway probe;
- canonical daemon probe;
- DNS rebinding;
- tunneled protocol; and
- colluding guest service.

---

## 17. Evidence and receipts

### 17.1 External event chain

The controller writes append-only NDJSON or a small typed log whose records form a hash chain:

```text
eventHash[n] = H(
  protocolVersion,
  runId,
  sequence,
  monotonicTime,
  eventType,
  payloadDigest,
  previousEventHash
)
```

The chain establishes ordering and tamper evidence for the recorded bytes. It does not establish that a guest assertion is true. Host observation and guest assertion remain different event types.

### 17.2 Minimum receipt bundle

Every run returns:

- sealed run manifest;
- controller, image, source, policy, scenario, and price digests;
- approval and lease identity;
- resource limits and measured usage;
- all effect requests and allow/deny decisions;
- budget reservations, settlements, refunds, and uncertainty;
- network attachment state and packet-attempt summary;
- bounded stdout/stderr digests plus retained tails;
- process exit and kill evidence;
- artifact manifest and quarantine decisions;
- invariant results;
- final chain root; and
- destruction/revocation receipt.

### 17.3 Evidence labels

Every assertion is labeled as one of:

- `HOST_OBSERVED`;
- `BROKER_OBSERVED`;
- `GUEST_ASSERTED`;
- `DERIVED`;
- `OPERATOR_APPROVED`; or
- `EXTERNAL_PROVIDER_REPORTED`.

The UI never renders a guest assertion as an external observation.

### 17.4 Privacy and retention

Default retention keeps digests, sizes, timing, policy decisions, cost, and errors. Prompt text, source contents, model output, and full terminal streams require an explicit data-retention class.

Deletion can remove encrypted payload blobs while preserving the receipt that a payload existed and was intentionally removed under policy.

### 17.5 Durable state, recovery, and proof-preserving compaction

Drydock begins with one SQLite database owned by `drydock-core` and zero other
writers. The resolved path is explicit in the signed installation configuration,
displayed to the operator, and may live only in a platform application-support
directory. A Git worktree, package installation directory, cache, temporary
directory, or guest-mounted path is invalid. There is no per-tool fallback path.

The authority store uses:

- one in-process write queue and read-only viewer connections;
- `WAL`, a bounded `busy_timeout`, and `synchronous=FULL` for transitions that
  precede an external dispatch or establish approval, reservation, revocation,
  settlement, chain root, or teardown;
- `BEGIN IMMEDIATE` around each state transition and its outbox/event row;
- schema-versioned, idempotent migrations with a post-apply probe of the real
  table, column, index, and constraint;
- unique run, lease, idempotency, provider-request, receipt-sequence, and custody
  keys; and
- reconstruction of leases, reservations, breaker state, and unfinished teardown
  before the process accepts a new command after restart.

`busy_timeout` is a bounded wait, not a concurrency strategy. A lock that outlives
the command deadline fails closed. Corruption, an unverified migration, failed
integrity check, or unavailable disk blocks boot of any effect-capable profile.

Raw authority events are not dashboard metrics and must not be silently rolled up
or overwritten. The controller seals append-only receipt segments by sequence
range and Merkle root. SQLite stores the authoritative transition rows plus the
segment inventory; content-addressed payload blobs and bounded log tails live in a
separate quota-controlled store. A compaction record names the source range,
source root, reducer version, retained aggregate, removed blob digests, policy,
operator or automatic authority, and resulting root. Spend, approval, custody,
uncertainty, dispute, and revocation records remain until their terminal retention
rule is independently satisfied.

Dashboard counters are rebuildable projections and may use minute/hour buckets.
They never replace authority rows. Payload deletion preserves a tombstone and
digest so a receipt remains intelligible without preserving sensitive content.
Incremental vacuum and WAL checkpointing run only under an explicit maintenance
budget; failure to compact lowers or stops admission before storage exhaustion.

Each backup or export uses SQLite's backup mechanism or a verified checkpointed
snapshot, never a copy of the main database without its WAL. Restore is accepted
only after integrity, schema, chain, reservation conservation, and unfinished-run
recovery checks pass.

---

## 18. Trial tiers

| Tier | Subject | Provider | Network | Side effects | Promotion authority |
|---|---|---|---|---|---|
| T0 Static | no guest process | none | none | none | automatic after schema validation |
| T1 Deterministic | pure components and scripted actors | fake | none | disposable guest only | controller policy |
| T2 Replay | Port Daddy components or daemon in guest | fake/replay | no external network | disposable guest only | reviewed scenario lease |
| T3A Billable canary | one bounded code path | one billable request under a dedicated, bounded-loss external cell | broker only | no GitHub or production writes | explicit per-run operator approval |
| T3B Subscription canary | one bounded code path | one subscription-backed request under a fresh native-capacity reservation | broker only | no GitHub or production writes | explicit per-run operator approval |
| T4 Single worker | one agent on throwaway fixture repo | fake first, tiny T3A or T3B real call optional | typed broker only | quarantine output | explicit operator approval |
| T5 Crew | bounded multi-agent institution | predominantly fake/replay | laboratory services only | fixture systems | separate reviewed program |
| T6 Federation | multiple remote Drydock cells | mixed | bounded Relay laboratory | no production custody | deferred, adversarial proof required |

Rules:

- While the operator halt is active, only static D0 design and validation are
  available. Every dynamic tier reports `NOT_PROVISIONED` or `BLOCKED`, never
  PASS. D1 begins only in the separately released Drydock project under a later
  explicit build authority; no Port Daddy process is started to exercise this
  proposal or its companion skill.
- T0-T2 have a real-provider budget of exactly zero.
- A higher-tier PASS does not retroactively make a lower-tier failure irrelevant.
- T3A and T3B are never automatic on pull request open, synchronize, schedule,
  or release.
- T3A is unavailable when the provider/payment cell's total worst-case liability,
  including enforcement lag and overshoot, cannot be finitely bounded; a host
  ledger and one-run capability do not substitute for that proof.
- T3B is unavailable without fresh account-scoped native usage, reset, and
  concurrency evidence plus an atomic worst-case reservation across canonical
  buckets and aliases. A dollar estimate cannot substitute for native capacity.
- T4 begins with one actor, one external call at a time, and no production remote.
- T5 has one aggregate budget; workers do not each receive independent hidden ceilings.
- T6 is unshipped until cross-harbor custody and revocation survive adversarial proof.

---

## 19. Repository test-suite integration

### 19.1 Current taxonomy is too coarse

The present Jest configuration has `unit`, `purser`, and `integration` projects. This describes folder ownership, not effect risk. The integration project automatically starts a source daemon. Some “unit” tests can still open loopback sockets, spawn processes, or use injected runners.

Replace folder-only trust with explicit effect metadata.

### 19.2 Proposed commands

```text
npm run test:offline       # pure/unit tests; no daemon, subprocess, socket, or network
npm run test:sim           # deterministic fake actors/providers; still no external network
npm run test:guest         # source daemon only inside a supplied T2 Drydock run
npm run test:adversarial   # microVM fault and escape suite
npm run test:canary        # manual T3A custody or T3B capacity lease required
npm run test:all-safe      # offline + sim; the default local/PR command
```

Eventually `npm test` should alias `test:all-safe`, not the integration project.

### 19.3 Test metadata

Every test file or manifest declares:

```json
{
  "tier": "T0|T1|T2|T3A|T3B",
  "runtime": "none|component|daemon",
  "process": "none|fixture|subject",
  "network": "none|loopback-fixture|broker",
  "credentials": "none|opaque-run-capability",
  "realProviderBudgetMicroUsd": 0,
  "canonicalRuntime": "forbidden",
  "sourceMaterialization": "sealed-vault-worktree",
  "hostPromotionTarget": "fresh-linked-review-worktree",
  "retention": "digests|redacted|full-approved"
}
```

Unlabeled tests default to T0 restrictions. A test that attempts more than it declared fails before the effect.

### 19.4 Replace automatic ephemeral-daemon launch

`tests/helpers/global-setup.js` should stop launching `server.ts` itself.

The T2 replacement is:

1. the external controller starts a guest from a sealed manifest;
2. the controller stages a sealed source-and-test bundle as inert data, without importing or executing any pull-request-controlled module on the host;
3. the guest supervisor starts the daemon with an explicit environment allowlist;
4. Jest, its configuration, global setup and teardown, transforms, test helpers, and the tests themselves all execute inside that disposable guest, or inside a second disposable test-runner guest under the same run lease;
5. the controller exposes only a run-scoped transport between those guests and supplies `DRYDOCK_RUN_RECEIPT` and `DRYDOCK_SUBJECT_ENDPOINT` to the guest-side test runner;
6. guest-side setup verifies the endpoint belongs to that receipt and is not canonical;
7. tests run against that endpoint; and
8. guest-side teardown requests quiescence, while the external controller remains solely responsible for revocation, kill, collection, and destruction.

The CI or developer host never executes JavaScript, TypeScript, shell hooks, package scripts, Jest configuration, transforms, or test code from the submitted source. In a split subject/test-runner topology, both guests are disposable, have no host mount or ambient credential, and communicate only over the lease-bound transport. The host controller handles sealed bytes, measurements, policy, lifecycle, and receipts; it does not load the submitted test harness into its own process.

If the supplied receipt is absent, expired, mismatched, or not T2, integration tests refuse to run. They do not fall back to a local daemon.

### 19.5 Supplant `scripts/chaos.ts`

The imperative script should be replaced, not preserved as a legacy alternate path.

Its useful scenario becomes declarative fixtures:

- services;
- actors;
- sessions;
- claims and locks;
- pub/sub and inbox events;
- virtual timing; and
- expected projection state.

The fixture driver targets only a receipt-bound Drydock endpoint. There is no default daemon discovery and no actor credential minted outside the guest fixture.

### 19.6 Preserve useful seams

`createSpawner({ runnerOverrides })` is a valuable seam for T1 deterministic providers. Keep and formalize it behind the provider protocol.

`lib/bonds.ts` supplies useful conservation and escrow state-machine ideas. Reuse the model and property tests in the external broker, but do not import the in-subject implementation as the authority.

`lib/coast-guard/egress-meter.ts` remains useful for component behavior and cooperative defense. Its tests should explicitly assert the documented same-UID limitation and never cite it as the T2 network boundary.

`lib/cost-tracker.ts` remains useful for reconciling reported usage after execution. It should compare against broker settlement, not decide whether a request may begin.

### 19.7 Independent admission checks and supplementary guest probes

Before any T2 test sends a request, the external controller independently attests that:

- the endpoint is a lease-bound Drydock transport;
- run ID, receipt, source digest, and expected commit agree;
- the source remote witness, bare-vault object, sealed source worktree, and input
  image agree on one commit and tree;
- the VM manifest contains no host-home, canonical-state, or source-worktree mount;
- the canonical-checkout path and Git common directory are absent, and their
  before-run integrity witness still equals the live `origin/main` witness;
- the network manifest contains no host route, canonical port forward, general external route, or undeclared device; and
- the real-provider capability and provider-side financial authority are both absent.

The guest-side bootstrap repeats useful endpoint, path, socket, and route probes, but records them as `GUEST_ASSERTED`. Those probes can catch packaging mistakes; they do not satisfy the host isolation gate and cannot upgrade missing host evidence.

Any mismatch aborts the suite without trying another endpoint.

---

## 20. Test strategy enabled by Drydock

### 20.1 Property-based state-machine tests

Generate long traces over:

- reserve;
- dispatch;
- timeout;
- retry;
- settle;
- refund;
- cancel;
- crash;
- restart; and
- reconcile.

Assert conservation, one dispatch per idempotency key, no negative balance, no expired capability use, and no effect before reservation.

### 20.2 Model checking

Specify the budget broker and run lifecycle as small TLA+ or Alloy models. Check safety properties such as:

- settled spend never exceeds deposited funds;
- an unapproved run never reaches provider dispatch;
- a revoked lease never returns to active;
- destroy eventually follows a terminal run; and
- duplicate messages do not create duplicate charges.

The executable property suite should share generated traces with the model where practical.

### 20.3 Differential testing

Feed the same Drydock Model Protocol trace to:

- fake provider;
- replay provider;
- local-model adapter; and
- tiny real canary.

Compare envelope semantics, streaming boundaries, usage reconciliation, error classes, timeout behavior, and cancellation. Do not require model text equality.

### 20.4 Mutation testing

Deliberately remove or invert each safety check and prove an adversarial scenario fails:

- reservation after dispatch;
- permissive missing budget;
- stale price allowed;
- capability not source-bound;
- artifact path not normalized;
- canonical endpoint fallback;
- network device accidentally attached;
- log ring unbounded;
- duplicate idempotency accepted; and
- guest assertion treated as host observation.

A boundary without a test that catches its removal is not yet a maintained boundary.

### 20.5 Incident replay library

Encode important incidents as immutable scenarios, including:

- runaway fleet spend;
- wrong-repository dispatch worktree;
- stale exact-head verdict projected onto a new head;
- sandbox setup failure incorrectly interpreted as PASS;
- fleet-wide infrastructure failure fanning out across PRs;
- stale claims blocking a successor;
- unsupervised daemon mistaken for canonical runtime;
- credential unavailable after identity cutover; and
- tap/release/runtime provenance disagreement.

Each incident records the bad state, the expected fail-closed result, and the evidence required to call the repair proven.

### 20.6 Human-in-the-loop simulation

Trial Basin can pause at approval points and provide a synthetic operator choice. Scenarios should test:

- approval denied;
- approval expires;
- operator narrows budget;
- operator kills during a stream;
- operator is unavailable;
- two operators conflict; and
- UI displays unknown or stale truth.

The simulator must never auto-upgrade silence into consent.

---

## 21. CI and release architecture

### 21.1 Pull-request lane

Untrusted pull-request code receives:

- T0 static checks;
- T1 deterministic tests;
- no repository write token;
- no provider credential;
- no canonical daemon;
- no hosted agent-review fan-out; and
- no automatic T3A or T3B promotion.

Docs-only pull requests must not trigger paid ideation merely because the source diff is cheap to inspect. Workflow and webhook policy must share one explicit no-spend classification.

### 21.2 Isolated system-test lane

T2 runs on a dedicated Drydock host:

- the CI service submits only sealed source and scenario digests;
- the host obtains source through a read-only fetcher and stages it as inert bytes without executing submitted code;
- Jest and every submitted test/setup/transform process execute only inside a disposable guest;
- the guest receives no CI token;
- the guest cannot post a status;
- the external collector signs the result and posts it with a narrowly scoped identity; and
- artifacts remain quarantined until collection succeeds.

### 21.3 Real canary lanes

Both T3A and T3B require:

- manual environment approval;
- an OIDC-derived, one-run host capability where supported, which limits protocol authority but is not itself a financial cap;
- a dedicated provider account, project, key, seat, or payment rail with exact
  account and product-scope evidence;
- one provider/model mapping;
- one request at a time;
- no tools, GitHub writes, or production state;
- provider-side max-output enforcement;
- external settlement reconciliation; and
- automatic revocation at terminal state.

A scheduled job, release tag, pull-request event, or guest request cannot grant
this approval. T3A additionally requires a dedicated external cell whose
configured limit plus measured enforcement tolerance is expressed in cents,
fits the approved run exposure, and cannot be raised by the broker credential.
If the provider offers no independently enforceable custody primitive, T3A
remains unavailable. T3B instead requires a content-addressed capacity evidence
receipt with fresh provider-native remaining/reset/concurrency observations,
conservative drift margin, p95 burn plus checkpoint tail, and one atomic
reservation across every affected canonical capacity bucket and alias. Unknown
or stale capacity denies T3B. Neither lane silently falls back to the other.

### 21.4 Release evidence

A release may cite Drydock receipts for containment and scenario behavior, but release automation remains a separate witness. Signing, notarization, package promotion, fresh install, supervision, and installed/running hash agreement each retain their own receipts.

---

## 22. Drydock Control Room

The operator needs a tiny independent surface that works while every Port Daddy process is off.

### 22.1 Pre-launch view

Show:

- exact source and image digests;
- scenario and tier;
- network device state;
- allowed operations;
- credentials present in host custody;
- credentials exposed to guest: always none;
- maximum dollar and token exposure;
- CPU, memory, disk, process, output, and time ceilings;
- retention policy;
- approval expiry; and
- the strongest unresolved risk.

The primary action reads like `Launch sealed T1 simulation · $0 external spend`, not `Run`.

### 22.2 Live view

Show calm, typed state:

- lifecycle phase;
- virtual and wall time;
- active actor and current scenario step;
- resources used versus ceiling;
- network attempts allowed and denied;
- available, reserved, uncertain, and settled spend;
- recent meaningful event;
- invariant failures; and
- artifact output motion.

One edge glow may signal a new meaningful event. There is no repeating throb. Reduced-motion mode uses stable luminance, border, or icon changes.

### 22.3 Controls

Controls are:

- **Cut egress** — revoke broker capabilities immediately;
- **Pause scenario** — stop event delivery while resource deadlines remain visible;
- **Kill guest** — revoke effects then stop the VM;
- **Inspect** — open exact event, packet decision, budget receipt, log tail, or artifact;
- **Export receipt** — save the immutable run bundle; and
- **Promote artifact** — move selected quarantined output into a separate review workflow.

No control depends on a guest acknowledgment.

### 22.4 Honest terminal states

Use precise outcomes:

- `PASS` — every required invariant was externally evaluated and held;
- `FAIL` — a required invariant was evaluated and violated;
- `BLOCKED` — a declared prerequisite prevented evaluation;
- `KILLED` — the controller terminated the run;
- `UNCERTAIN` — external effect or settlement could not be reconciled;
- `INVALID` — manifest, source, policy, or receipt binding failed; and
- `INCOMPLETE` — evidence collection ended before all gates were evaluated.

Infrastructure failure never becomes PASS or “neutral success.”

### 22.5 Authority split, control receipts, and operator task budget

The Control Room is two applications over one typed projection:

- **Switchboard** is a small native Rust surface on the trusted host. It can show
  and approve a sealed launch contract, cut egress, pause scenario delivery, kill
  a guest, and export a receipt. It cannot edit arbitrary manifests, paths,
  commands, provider URLs, or limits. The controller recomputes and displays the
  exact contract after every selection; the UI cannot submit hidden fields.
- **Observatory** is a read-only TypeScript/React evidence browser. It receives
  bounded, redacted projections and content-addressed evidence links. It has no
  control socket, approval key, provider credential, or generic controller API.
  Large run, event, artifact, and receipt lists use windowed rendering, stable
  row IDs, measured row heights, and bounded overscan so a hostile history cannot
  freeze the emergency controls.

The split keeps a rich WebView and its dependencies out of the mutation path. A
future single-window shell may visually compose both surfaces, but its read-only
pane still cannot inherit control authority.

A gallery may visualize fixtures and receipts, but `chroot`, `sandbox-exec`, a
same-UID process wrapper, or a polished rendering is not a Drydock isolation
mechanism. Such a gallery remains `FIXTURE_PROOF` or `DEV_UNTRUSTED` until an
approved external controller supplies the host evidence. Presentation cannot
upgrade the witness class of what it displays.

Control verbs have separate receipts. `pause`, `cut-egress`, `kill`, `inspect`,
`export`, and `promote` are not aliases for a generic “stop.” Every command moves
through `QUEUED`, `DELIVERED`, and one of `ACKNOWLEDGED`, `FAILED`, `EXPIRED`, or
`UNSUPPORTED`. A kill is acknowledged only after host observation proves the VM
process stopped and its effect leases were revoked. A pause is acknowledged only
after scenario delivery and guest execution reach the profile's defined quiescent
state. UI optimism is not acknowledgement.

The operator task budget is explicit:

| Operator goal | Maximum interaction from the current screen | Proof shown |
|---|---:|---|
| understand whether a run can spend money | 0 actions | permanent amount, calls, attempts, expiry, provider custody, and overshoot line |
| launch a sealed T1/T2 run | 2 actions | review exact contract; deliberate launch |
| launch a T3A or T3B canary | 2 actions after OS presence check | exact one-shot custody or native-capacity receipt and typed risk acknowledgement |
| cut all egress | 1 action | broker revocation acknowledgement or explicit expiry/failure |
| kill the guest | 1 action | host-observed process stop plus teardown state |
| inspect any warning or glow | at most 2 actions | exact event, command, packet decision, test, diff, budget row, or receipt |
| export the complete receipt | at most 2 actions | bundle digest, size, retention class, and destination |

One calm edge/card glow marks a new meaningful transition. It fires once, then
becomes a stable live indicator. Reduced-motion mode uses a static color, border,
icon, and timestamp change. Activity volume never produces a repeating pulse.

Any implementation PR for the Control Room must manifest evidence for active,
historical, blocked, stale, approval-gate, interrupt/kill, and receipt-recovery
states. Each screenshot or recording binds the controller binary, UI binary,
fixture, run ID, source state, timestamp, and visible claim. A polished fixture is
`FIXTURE_PROOF`; it is not production evidence. After relaunch, every visible
state must rebuild from controller receipts rather than a cached UI model.

---

## 23. Adversarial acceptance gates

Drydock is not accepted until an independent reviewer can reproduce these gates from a clean controller installation.

| Gate ID | Attack or failure | Required observation |
|---|---|---|
| `DRY-01` | Guest reads operator home | read denied; host path absent |
| `DRY-02` | Guest reads Keychain/SSH/cloud config | files absent; no mounted path |
| `DRY-03` | Guest probes canonical socket/9876 | host VM/network manifests prove no mount, mapping, or route; guest probe is supplementary |
| `DRY-04` | Guest unsets proxy variables | external packet count remains zero |
| `DRY-05` | Guest opens raw TCP/UDP/IPv6/QUIC | denied outside declared transport |
| `DRY-06` | Guest targets metadata/private/LAN address | broker deny before connection |
| `DRY-07` | Guest requests undeclared provider/model | capability mismatch; no reservation or dispatch |
| `DRY-08` | Guest omits budget | request denied before dispatch |
| `DRY-09` | Price catalog missing or stale | real request denied |
| `DRY-10` | Output exceeds token cap | broker cuts stream; settlement within reservation |
| `DRY-11` | Duplicate idempotency key | one provider dispatch, one settlement |
| `DRY-12` | Crash after reservation | reservation survives and reconciles conservatively |
| `DRY-13` | Controller restarts | run remains bounded; no lease widening |
| `DRY-14` | Guest forges PASS receipt | labeled guest assertion; host result unchanged |
| `DRY-15` | Guest floods serial/stdout | bounded ring; host remains available |
| `DRY-16` | Fork bomb or zombie tree | resource cap/kill; guest destroyed |
| `DRY-17` | Disk/archive bomb | output cap/import rejection |
| `DRY-18` | Symlink/path traversal artifact | quarantine rejects it |
| `DRY-19` | Source branch moves after seal | guest tree and receipt remain pinned |
| `DRY-20` | Wrong parent Git repository present | source packer rejects provenance mismatch |
| `DRY-21` | Guest writes production GitHub | no operation exists; no credential present |
| `DRY-22` | Guest tries to trigger paid CI/Fleet | no production remote or token; denied event |
| `DRY-23` | Two actors race one balance | atomic reservations conserve account |
| `DRY-24` | One actor recursively spawns | depth ceiling denies child |
| `DRY-25` | Cancel races with provider stream | egress revoked; bounded settlement; exact outcome |
| `DRY-26` | Provider omits usage | result `UNCERTAIN` or conservative settlement, never PASS |
| `DRY-27` | Provider exceeds or lags the configured quota | measured overshoot remains within the separately approved tolerance; discrepancy blocks promotion and preserves evidence |
| `DRY-28` | Artifact claims wrong source head | digest mismatch blocks promotion |
| `DRY-29` | Teardown interrupted | recovery finds and destroys orphan with revoked lease |
| `DRY-30` | Malicious controller test mutation | specimen suite catches removal of each critical gate |
| `DRY-31` | Guest or submitted test targets the canonical checkout by direct path, symlink, parent traversal, inherited descriptor, or caller-selected Git environment | path and descriptor absent; host access denied; checkout-integrity receipt unchanged |
| `DRY-32` | Artifact promotion names the canonical checkout, default branch, stale worktree, wrong common directory, or path alias | broker rejects before extraction or Git mutation; no canonical file, index, object, or ref changes |
| `DRY-33` | 1,000 simultaneous launch requests reuse one idempotency key | one run, one reservation, at most one body; duplicates return the same receipt |
| `DRY-34` | Controller crashes after reservation and before process creation | durable reservation remains; no process appears; admission stays closed until reconciliation |
| `DRY-35` | Controller crashes after process/VM creation and before witness or handshake commit | platform reaper revokes effects and terminates the uncommitted body; no automatic replacement |
| `DRY-36` | PID is reused or the host reboots while a run is nonterminal | stale witness cannot attach, signal, or authorize a process; continuation requires a new fenced generation |
| `DRY-37` | Crash-triggered, recursive, or semantically varied requests attempt 1,000 births through every ingress | aggregate reservation admits only the configured maximum; durable breaker opens; queue remains bounded; time/reset does not clear it |
| `DRY-38` | Fenced old body calls a tool, appends current transcript, writes output, or settles work | every stale-generation operation is denied and linked to the handoff receipt |
| `DRY-39` | Same-family or cross-family backend handoff races old output and new startup | at most one authoritative body; AgentNode and transcript lineage remain intact; unsupported context is explicit |
| `DRY-40` | Destination lacks or changes an MCP, skill, prompt, hook, permission, or policy digest | compatibility narrows, quarantines, or blocks before launch; no secret or ambient permission is copied |
| `DRY-41` | iOS/Relay command is replayed, expired, targets an old generation, or uses an old authority epoch | local authority denies it exactly once and preserves a zoomable receipt |
| `DRY-42` | Remote session hibernates, restarts, disconnects, reorders, or redelivers events | projection reconstructs from a durable cursor; no duplicated control or spawn effect occurs |
| `DRY-43` | Lifecycle database is locked, corrupt, missing, or partially migrated | admission remains closed; no fallback database or spawn loop starts; exact repair evidence is shown |
| `DRY-44` | Concurrent local and remote cells try to spend or spawn from one aggregate envelope | leased slices conserve the global vector; disconnected cells fail closed and cannot double spend |

Passing once is not enough. Gates need stable automated fixtures and a signed controller build identity.

---

## 24. Bootstrap plan

The bootstrap avoids the paradox of using Port Daddy to prove Port Daddy safe.

### D0 — Paper boundary and schemas

Deliver without running Port Daddy:

- threat model;
- controller/guest boundary;
- versioned `RunManifest`, `TrialScenario`, capability, event, budget, and receipt schemas;
- invariant catalog;
- attack matrix;
- accepted implementation-language/process matrix, including the explicit
  Drydock application of ADR-0120;
- pure `step(state, action, virtual_time, entropy)` transition contract;
- fail-cheap breaker, retry, deadline, storage, and retention contracts;
- durable agent-lifecycle identity, admission, reservation, process-witness,
  generation-fencing, backend-continuation, and closed-before-recovery contracts;
- canonical-checkout exclusion, bare-vault provenance, worktree-only authorship,
  and checkout-integrity receipt contracts; and
- explicit non-goals.

**Gate:** independent design review can identify exactly which process, language,
credential, storage path, kernel/hypervisor mechanism, and witness controls each
effect. A pull request changing Port Daddy cannot change the controller artifact
that grades it.

### D1 — Inert VM controller

Create a separate Drydock repository and signed release chain. Build the Rust
controller/watchdog and the smallest possible Swift Virtualization.framework
helper. Boot only a tiny inert image that prints a nonce and exits. The offline
installation contains no provider adapter, credential reader, generic shell
launcher, dynamic plugin loader, or networked update path.

**Gate:** controller/helper/VMM/image/source digests, fixed device profile,
resource ceilings, no-network boot, bounded output, independent watchdog kill,
destruction, restart recovery, and external receipt all pass. Cooperative stop is
tested separately from forced stop; a forced-stop disk is never reused. The source
vault creates a sealed disposable worktree while canonical-checkout path access is
denied and before/after canonical integrity receipts are identical.

### D2 — Fake broker and budget ledger

Implement typed fake-provider operations, integer reservation/settlement, the
durable breaker, fencing generations, absolute deadlines, the single-writer
authority store, and the Agent Lifecycle Ledger. The ledger joins one durable
worker to its run, body lease, process witness, backend session, transcript,
capability envelope, and reservations before reporting `RUNNING`. The Trial Basin
transition function remains usable without a VM.

**Gate:** property, replay, migration, corruption, power-loss-policy, and
crash/retry traces preserve conservation, at-most-once dispatch, stale-lease
rejection, no-dispatch-before-reserve, and no automatic breaker re-arm.

### D3 — Hostile specimen suite

Run purpose-built malicious specimens, not Port Daddy:

- filesystem probes;
- network bypasses;
- fork/memory/disk/log bombs;
- malformed protocol frames;
- capability replay; and
- artifact attacks.

**Gate:** all applicable `DRY-01` through `DRY-44` adversarial gates fail closed and host availability remains within defined bounds.

### D4 — Port Daddy T1 components

Package selected pure modules into the guest with fake clocks and providers. Do not start the daemon.

**Gate:** deterministic component scenarios pass with no network and no canonical-state contact.

### D5 — Port Daddy T2 daemon

Start the daemon only inside the disposable guest. Replace inherited environment, default discovery, and host-mounted state.

**Gate:** incident replays, canonical sentinels, provenance checks, process-tree cleanup, and receipt binding pass.

### D6 — Test-suite routing

Make `npm test` offline/sim-only. Convert integration and chaos behavior to receipt-bound scenarios. Add effect metadata and fail-closed setup.

**Gate:** a clean developer or PR run can prove zero daemon, zero provider, zero external packet, and zero canonical contact.

### D7 — Tiny real canary

After separate operator review, connect one dedicated provider or payment cell to one provider operation. Its configured limit plus finite measured enforcement tolerance must fit the approved run exposure.

**Gate:** dedicated-cell proof, configured cents plus bounded overshoot, exact maximum output, one request, one attempt, provider settlement reconciliation, and revocation all pass. A broker reservation or dashboard budget without a finite external loss bound fails this gate.

### D8 — Single-worker fixture

Run one worker against a throwaway fixture repository with output quarantine and no remote writes.

**Gate:** bounded work completes or fails without exceeding effects, resources, or spend; every result zooms to evidence.

### D9 — Cooperative crew and federation

Defer until single-worker containment, aggregate budgeting, identity, settlement, and remote custody each have adversarial proof.

**Gate:** separately specified. It is not implied by D8.

---

## 25. Work packages

These are proposed roadmap children under `port-daddy-unified-product-hypertree`. They are not claimed as live registry mutations while the runtime is halted.

| Proposed slug | Outcome | Estimate | Dependencies | Acceptance evidence |
|---|---|---:|---|---|
| `drydock-safety-model` | Schemas, threat model, language/process boundary, pure transition function, invariant and tier contracts | 5 | none | reviewed D0 artifacts |
| `drydock-source-vault-worktree-gate` | Bare remote source vault, live-ref witness, canonical-checkout exclusion, disposable source worktrees, and fresh review-worktree promotion | 5 | safety model | identical before/after canonical receipts plus DRY-31/32 |
| `drydock-inert-vm-controller` | Separate Rust controller/watchdog release plus minimal Swift VZ helper and inert guest | 8 | safety model | D1 signed-build and runtime receipts |
| `drydock-budget-effect-broker` | Separate Rust broker, prepaid integer ledger, durable breaker, fake provider, and single-writer store | 8 | safety model | D2 property, migration, corruption, and crash receipts |
| `drydock-agent-lifecycle-ledger` | Global atomic admission, durable person/run/body separation, process witnesses, generation fencing, restart reconciliation, and typed event outbox | 8 | safety model; broker | DRY-33–39 and DRY-43 |
| `drydock-spawn-storm-breakers` | Persistent scoped breakers, bounded queue, ancestry ceilings, deadlines, and zero-retry birth default | 5 | lifecycle ledger; broker | DRY-33–37 |
| `drydock-capability-capsules` | Content-addressed MCP, skill, prompt, hook, tool, and permission environment with quarantine and compatibility compilation | 8 | lifecycle ledger | DRY-38–40 |
| `drydock-cross-backend-continuation` | Identity-preserving same-family resume and cross-family successor handoff with at most one authoritative body | 8 | lifecycle ledger; capability capsules | DRY-36 and DRY-38–40 |
| `drydock-hostile-specimens` | Escape, network, resource, protocol, and artifact attacks | 8 | controller; broker | D3 matrix |
| `drydock-port-daddy-component-profile` | Pure Port Daddy T1 packaging | 5 | hostile specimens | D4 receipts |
| `drydock-port-daddy-daemon-profile` | Port Daddy T2 guest without ambient authority | 8 | component profile | D5 incident replays |
| `drydock-test-suite-routing` | Safe default commands and receipt-bound integration | 8 | daemon profile | D6 zero-effect proof |
| `drydock-real-provider-canary` | One externally bounded-loss provider operation | 5 | broker; independent review; dedicated external cell with finite overshoot | D7 custody and settlement receipts |
| `drydock-single-worker-fixture` | One worker, fixture repo, quarantined patch | 8 | canary; provenance repair | D8 end-to-end receipt |
| `drydock-control-room` | Independent operator launch/kill/inspect UI plus pd-console single-worker conversation, session switcher, and backend-continuation projection | 8 | controller; lifecycle ledger; receipt model | usability, identity-continuity, and kill proof |
| `drydock-mobile-session-join` | Passkey-backed iOS/Relay conversation join and one-use remote control commands | 8 | lifecycle ledger; control room; typed presence | DRY-41/42 |

Owners remain unassigned until a safe work mechanism exists. Building Drydock must not require restarting Port Daddy or spending on coordinated agents.

---

## 26. Restart decision

This document does not authorize a restart.

A future operator may consider a limited restart only after all of the following are independently evidenced:

1. D0-D5 are complete on a clean controller installation.
2. All applicable `DRY-01` through `DRY-44` adversarial gates pass.
3. The controller and broker are outside Port Daddy's process, package, credential, and storage authority.
4. The exact Port Daddy source image is sealed by digest.
5. The run has no host mounts and no canonical daemon route.
6. Real-provider budget is zero for the first daemon trials.
7. Incident scenarios reproduce the prior unsafe behavior and the repaired behavior fails closed.
8. Output is quarantined and cannot publish itself.
9. Kill and destruction work while the guest is unresponsive.
10. The operator sees maximum exposure before launch.

The first permitted Port Daddy execution should be a T2 no-network guest, not the canonical runtime.

Restoring the canonical runtime is a later and stronger decision. It requires its own installation, release, supervision, identity, provider, Fleet, webhook, and spend-control evidence. Drydock PASS is necessary evidence, not unilateral authority.

---

## 27. Explicitly rejected shortcuts

Reject:

- “just use Docker” as the only isolation boundary;
- proxy environment variables as forced egress;
- putting a dollar limit in the prompt;
- evaluating cost only after completion;
- treating missing budget as unlimited;
- passing provider or GitHub credentials into the guest;
- exposing a generic HTTP CONNECT proxy;
- mounting the developer worktree writable;
- mounting or exposing the canonical checkout at all, even read-only;
- using the canonical checkout, its Git common directory, or a mutable local
  `origin/main` ref as source authority;
- creating, amending, applying, staging, committing, or promoting from the
  canonical checkout or directly on the default branch;
- using the canonical daemon with a temporary database;
- discovering a default daemon endpoint;
- allowing integration tests to fall back when no Drydock receipt exists;
- letting the guest post its own PASS status;
- automatic real-provider canaries on PRs or schedules;
- docs-only paid review fan-out by default;
- using Port Daddy agents to implement or adjudicate the bootstrap boundary;
- assuming a local model is unmetered merely because it has no token invoice; and
- calling a neutral or infrastructure-failed run successful.

---

## 28. Open design questions

These require review before implementation:

1. **Resolved for D1:** the canonical controller, watchdog, broker, and Trial Basin
   core are Rust; the macOS VZ helper is a tiny out-of-process Swift 6 adapter;
   Lima is learning/image tooling only; Firecracker remains the Linux VMM. Reopen
   only if the Swift helper starts making policy decisions, selecting arbitrary
   host paths, or parsing hostile semantic payloads. At that point an all-Swift
   controller may be a smaller real TCB than a dishonest “tiny helper.”
2. Which component signs run receipts, and how is its key rotated without giving Port Daddy signing authority?
3. Is vsock available and sufficiently auditable for the macOS profile, or should the first mediated profile use a host-only isolated NIC with a custom protocol?
4. Which price source and freshness policy governs worst-case reservation when providers publish tiered or cached-token rates?
5. How should provider billing disagreement settle: conservative full reservation, account quarantine, or explicit operator adjudication?
6. What source and output data may be retained for transcript replay?
7. Which malicious specimen set should be maintained by a separately owned security repository?
8. How will CI prove that a result came from an approved Drydock controller build rather than a forged status poster?
9. What minimum hardware isolation is required before T3A or T3B?
10. When should local GPU inference use a dedicated machine rather than sharing the developer Mac?
11. How should aggregate compute and account quota be represented beside dollar spend?
12. What independent emergency UI remains available if both Port Daddy and the main developer environment are compromised?

---

## 29. Source map

Current repository surfaces that motivated or can inform the design:

| Surface | Current truth | Drydock disposition |
|---|---|---|
| `jest.config.js` | generic test command includes daemon integration project | safe default excludes runtime; T2 requires receipt |
| `tests/helpers/global-setup.js` | launches source daemon automatically | replaced by supplied Drydock endpoint |
| `tests/helpers/ephemeral-daemon.js` | temporary state, same UID, inherited environment | no longer a security boundary; guest-only helper if retained |
| `scripts/chaos.ts` | discovers default daemon and performs live writes | supplanted by declarative TrialScenario |
| `lib/coast-guard/egress-meter.ts` | cooperative proxy; documented direct-egress bypass | component defense only, never containment proof |
| `lib/spawner.ts` | runner injection seam; budget checked after execution | keep fake seam; require external pre-reservation |
| `tests/unit/spawner-budget-cap.test.js` | missing/invalid budget means no cap | reverse for external effects: no valid lease means deny |
| `lib/cost-tracker.ts` | post-execution cost computation and recording | reconciliation witness, not admission authority |
| `lib/bonds.ts` | local escrow, partial slash/refund, conservation concepts | model input; external broker owns test authority |
| `lib/dispatch/spawn-adapter.ts` | prior provenance defect surface | sealed source packer prevents ambient Git discovery |
| `docs/adr/0050-coast-guard.md` | in-subject sandbox and egress design | nested defense, not external supervisor |
| `docs/adr/0120-rust-kernel-boundary.md` | security primitives are Rust-canonical; product planes stay TypeScript; process isolation remains separate | Drydock applies the Rust rule to its external TCB without rewriting the Port Daddy subject |
| `docs/adr/0138-distress-register-emergency-broadcast.md` | distress and halt design; explicitly notes the incident file is not yet shipped | external halt and restart control input |
| `docs/adr/0139-verdict-integrity-separating-infra-failure-from-review-verdict.md` | false final signals amplify repeated agent investigation and spend | incident replay and fail-legible verdict gates |
| `docs/research/north-star/` | supervisory control, economy, evidence hypotheses | formal and adversarial Trial Basin program |
| `skills/sandboxed-adversarial-test-harness/` | agent-facing Drydock review method, specialist references, activation tests, and static bundle validation | design/audit guide only; its legacy audit script remains T0 lint rather than runtime proof |

### 29.1 Bounded research review, 2026-09-08

The language and bootstrap decisions were challenged by five isolated, read-only
research lanes. They covered macOS Virtualization.framework and language binding;
Linux Firecracker/Jailer deployment; provider spend custody and retry amplification;
deterministic simulation/formal methods; and durable state/operator evidence.

Each lane was prohibited from launching Port Daddy, running repository tests or
builds, calling a model provider, editing files, opening a pull request, spending
money, or spawning descendants. Their output was advisory. This proposal cites the
primary platform and standards sources that support adopted claims; an agent's
summary is not itself evidence.

The review changed the design in six concrete ways:

1. The controller became a Rust security nucleus with a tiny out-of-process Swift
   adapter, instead of an all-Swift application or broad Rust/Objective-C FFI.
2. The Linux lane standardized on pinned upstream Firecracker/Jailer, no NIC at
   first, verified cgroup membership, and deferred snapshots.
3. Paid canaries became one request and one attempt, with no automatic retry,
   refill, or breaker half-open path.
4. Provider dashboard limits became measured outer controls rather than assumed
   exact custody; an unbounded overshoot denies T3A, while missing or stale
   provider-native capacity evidence denies T3B.
5. The simulator became a pure transition with explicit effects, virtual time,
   injected entropy, and fencing generations.
6. Mutation moved into a small native Switchboard while the rich React Observatory
   became read-only and independently virtualized for hostile histories.

External claims adopted by this revision are grounded in current primary sources:

- macOS VM configuration and entitlement:
  [Virtualization.framework](https://developer.apple.com/documentation/virtualization),
  [`VZVirtualMachineConfiguration`](https://developer.apple.com/documentation/virtualization/vzvirtualmachineconfiguration),
  and [the virtualization entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.virtualization);
- Linux microVM isolation:
  [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md),
  [Jailer](https://github.com/firecracker-microvm/firecracker/blob/main/docs/jailer.md),
  and [production host setup](https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md);
- delayed or approximate spend enforcement:
  [OpenAI API spend limits](https://help.openai.com/en/articles/6614457),
  [OpenAI prepaid billing](https://help.openai.com/en/articles/8264644),
  [Cloudflare AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/),
  [Anthropic API spend limits](https://platform.claude.com/docs/en/api/rate-limits),
  and [AWS Budgets update cadence](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html);
- durable authority state:
  [SQLite WAL](https://www.sqlite.org/wal.html),
  [`synchronous`](https://www.sqlite.org/pragma.html#pragma_synchronous), and
  [the SQLite backup API](https://www.sqlite.org/backup.html); and
- canonical receipts:
  [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) and
  [RFC 9162](https://www.rfc-editor.org/rfc/rfc9162.html).

---

## 30. Definition of satisfaction

Drydock succeeds when the operator can say, before execution:

> This exact source may run for this exact scenario, for this long, with these files, these resources, and these typed effects. The broker cannot authorize more than this protocol-exposure ceiling. When a dedicated provider or payment cell independently bounds its configured limit plus worst-case enforcement overshoot, actual financial loss is also capped at the approved exposure. If the source lies, loops, crashes, colludes, or refuses to stop, the boundary outside it still holds and leaves me evidence.

Trial Basin succeeds when a researcher can then ask:

> What happens if five imperfect workers inherit partial memories, disagree about authority, lose a provider mid-stream, and must still conserve money and preserve useful labor?

The first sentence makes the second one safe enough to explore.
