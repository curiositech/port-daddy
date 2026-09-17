# P1 — Containment and the Trusted Computing Base

Status: sealed Round 1 position · `SOURCE_PRESENT` + `PROPOSED`

## Thesis

Drydock should prevent capability, not merely judge intent. Hostile or defective
code must be unable to reach a host path, credential, socket, provider,
repository, process tree, or billable API except through a small external
component that can refuse the request cheaply. Policy is useful inside that
component, but policy is not the root of safety. Complete mediation is.

The exact anchor contains a static Drydock architecture, a Rust broker surface,
typed effect concepts, provenance rules, hostile-input fixtures, and validators.
That is `SOURCE_PRESENT`. It is not evidence of a live VM, forced egress,
provider custody, or end-to-end containment. Those claims remain
`BLOCKED_BY_HALT`.

## Strongest design

Make Drydock a separate trusted plane, never a mode inside the subject under
test. Its trusted core should be a deliberately small controller and broker,
implemented in Rust where memory-safe systems boundaries and narrow FFI matter.
A small Swift adapter may configure Apple's Virtualization framework on macOS;
Linux may use Firecracker and its jailer as defense in depth. Neither VMM
replaces the broker.

The guest begins with no network device, shared directory, host home, agent
socket, canonical checkout, credential, clipboard, USB, or ambient service
identity. It receives a sealed source bundle in guest-local storage. Package
hooks, transforms, shell setup, test configuration, and tests are all
adversary-controlled executable input and run only inside the guest. Output
leaves through one bounded export channel into quarantine.

Clean origin is a topology invariant. The controller resolves and fetches an
exact remote commit into a dedicated source vault, records commit and tree
identities, and materializes a fresh worktree or sealed bundle. The operator's
canonical checkout is rejected by repository identity, path, and inode checks,
then absent from the guest. A clean-main policy or Git hook is not a security
boundary; a same-UID process can ignore it.

Every consequential effect traverses a typed ticket. The ticket names the
principal, exact operation, destination, canonical arguments, byte bounds,
concurrency reservation, expiry, idempotency key, cancellation semantics,
generation fence, and expected receipt. It is not a general network socket and
does not convey a raw Git or provider credential. The broker derives request
size and cost bounds from what it observes, never solely from a guest estimate.

Spend needs two different proofs. A durable internal reservation bounds what
the protocol will authorize. It does not by itself cap financial loss. A hard
financial ceiling requires an independent provider account, project, quota, or
payment boundary that actually rejects additional charges, including a measured
worst-case propagation lag. Until that witness exists, Drydock may use fakes,
replay fixtures, and local models but cannot claim a hard-capped provider tier.

Cryptography cannot repair a misplaced witness. A guest-signed “network absent”
statement remains guest asserted. A guest-retained Merkle log becomes useful
only after an external checkpoint. A signed verdict is theater if the subject
can bypass its enforcement point. A capability is theater if the subject also
holds the raw credential. An attestation is theater if the subject controls the
measurement agent or signing key.

The minimum honest witness classes are:

- `HOST_OBSERVED` for VM, mount, device, process, and route facts;
- `BROKER_OBSERVED` for mediated requests and denials;
- `PROVIDER_RECONCILED` for external charges, use, and refusal;
- `MODEL_CHECKED` for abstract state-machine properties;
- `REPLAYED` for a sealed deterministic trace; and
- `GUEST_ASSERTED` for all subject reports.

A claim inherits its weakest required witness. A signature or dashboard does
not upgrade it.

The first implementation tier should be intentionally unimpressive: one
no-network guest, one sealed source bundle, no automatic child creation, zero
retry, one admission writer, and a broker with no real-provider route. Its first
useful proof is that a malicious fixture cannot discover a host mount, use an
ambient socket, retain a stale body's effect authority, multiply births after a
crash, or export beyond quarantine. Only then should replay and a separately
approved single-operation canary be considered.

Framework-level action adjudication can improve broker decisions, but it cannot
be the containment boundary. Aspect interception sees only actions represented
in that framework. Shells, inherited descriptors, direct network APIs, native
modules, and new adapters remain bypasses unless the VM and broker make them
unreachable.

## Non-negotiables

1. **Absent before filtered.** Devices, mounts, sockets, credentials, and routes
   do not exist until explicitly added and externally witnessed.
2. **Complete mediation or no consequential authority.** A policy engine cannot
   substitute for an unreachable bypass path.
3. **Clean origin by topology.** The canonical checkout and host credentials
   are never guest inputs.
4. **Independent ceilings.** Admission, CPU, RAM, disk, time, process count,
   egress, and money each have a named enforcing authority.
5. **Weakest-witness truth.** Signatures and proofs retain the witness class of
   the observation they bind.

## Falsification tests

- Enumerate host paths, inherited descriptors, virtual devices, sockets,
  DNS/IP routes, credential locations, and VMM export channels from the host
  configuration and attack each one. A failed guest `curl` is insufficient.
- Put malicious `preinstall`, transform, shell setup, test configuration, and
  Git configuration into a source bundle; prove none executes on the host.
- Crash at every admission, launch, heartbeat, cancel, settlement, and teardown
  transition; prove one effect-authorized body, no unreserved birth, and closed
  admission after restart.
- Race spend, timeout, and replay; prove broker refusal and provider-side refusal
  before calling a ceiling hard.
- Let a compromised guest sign a false statement; prove witness class does not
  change.
- Point an input at the canonical checkout with otherwise matching bytes; prove
  identity-based rejection.

One demonstrated egress bypass, raw guest secret, canonical mount, orphaned
effect body, or unaccounted provider charge returns the affected tier to T0.

## Impossible combinations

- Hostile-code containment plus same-UID raw credentials.
- Complete mediation plus a guest network adapter or inherited host socket.
- Clean-main provenance plus a canonical-checkout mount.
- A hard spend cap backed only by an internal ledger.
- OS containment claimed from application join-point interception.
- Guest-controlled signing presented as independent containment evidence.
- Safe recovery plus automatic retry before durable reconciliation.
- A read-only observatory that can also approve or issue effects.

## Skill findings

- `sandboxed-adversarial-test-harness` has strong boundaries and witness
  vocabulary; add hostile gather/reducer and multi-node cancellation fixtures.
- `agentic-zero-trust-security` overactivates and occasionally treats
  WASM/container execution as sufficient sandboxing; add a VM/broker boundary,
  primary references, activation tests, and a changelog.
- `macos-host-security` correctly distinguishes detection from prevention; add
  a Virtualization device/mount receipt schema and falsification fixtures.
- `runtime-verification-for-agents` must say explicitly that monitoring cannot
  re-contain an escaped process or un-leak a secret.
- `provable-action-adjudicator` should be narrowed to in-band policy
  adjudication until it has a complete mediation inventory and bypass tests.

## Missing skill

`drydock-mediation-completeness`

Activate when a design claims that every effect path from an untrusted guest is
mediated: VM devices, inherited descriptors, mounts, egress, broker reachability,
and capability redemption. **NOT for** policy authoring, credential issuance,
generic VM tuning, ordinary unit-test isolation, or post-hoc logging.

It must produce a mediation graph, enforcing component per path, negative
capability evidence, host-observed receipt fields, and one hostile bypass
specimen per path.

## Confidence and unknowns

Confidence is high in the boundary argument and low in all unobserved dynamic
claims. Unknowns include guest image and entitlement design, exact Linux target,
provider-specific quota semantics, and whether the existing broker can be made
small enough without widening its TCB.

Primary references: [Apple Virtualization](https://developer.apple.com/documentation/virtualization),
[Firecracker](https://firecracker-microvm.github.io/), and
[NIST FIPS 186-5](https://csrc.nist.gov/pubs/fips/186-5/final).
