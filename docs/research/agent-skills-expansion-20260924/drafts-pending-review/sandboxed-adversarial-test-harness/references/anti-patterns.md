# Drydock Anti-Patterns

Load this reference when reviewing a design for shortcuts that look safe on the
happy path but disappear under hostile code, process loss, or provider scarcity.

## Same-UID Convenience Called Containment

**Novice:** A worktree, path guard, Seatbelt profile, or process wrapper is “the sandbox.”

**Expert:** Arbitrary code shares too much host authority. Put it behind a VM or
microVM and treat host controls as defense in depth.

**Timeline:** Appears during prototyping, survives because tests pass, fails when a
native module, shell, inherited descriptor, or overlooked path bypasses convention.

## Host Executes The Submitted Test Harness

**Novice:** Run Jest, configuration, and setup on the host against a daemon in a VM.

**Expert:** Pull-request-controlled tests are code. Stage inert bytes and execute
the entire test runner inside a disposable guest.

**Timeline:** Looks efficient in CI, then a configuration file or transform gains
host code execution before the supposedly isolated subject starts.

## Clean Main As A Social Convention

**Novice:** Ask agents to avoid the main checkout and add a pre-commit hook.

**Expert:** Make the canonical checkout absent from guests and invalid in every
packer, broker, and promotion schema. Fetch through a bare source vault, author in
worktrees only, and admit output only into a new linked review worktree. Hooks are
friendly diagnostics, not enforcement.

**Timeline:** Main stays clean during cooperative testing, then one wrong working
directory, inherited `GIT_DIR`, or path alias stages unrelated operator bytes and
turns source provenance into guesswork.

## In-Memory Roster Called Global Accounting

**Novice:** Count children in a process-local map, write the PID later, and restart
a worker when a heartbeat disappears.

**Expert:** Atomically reserve global capacity in a durable external ledger,
witness boot/process-start/nonce/sandbox identity before `RUNNING`, and keep
admission closed after restart until every old body is adopted, terminated,
settled, lost, or quarantined.

**Timeline:** A crash erases the count while detached children survive. Startup
retries create another generation and a crash-plus-spawn loop multiplies bills.

## Backoff Called A Spawn Safety Boundary

**Novice:** Add exponential delay to recursive or crash-triggered spawning.

**Expert:** Deny all but the atomically reserved births, give one layer ownership
of retries, persist attempt and ancestry limits, and open a durable breaker. Full
jitter only desynchronizes a later, already-bounded retry.

**Timeline:** Restart resets the counter or distinct requests bypass exact
idempotency, so every delayed attempt eventually runs.

## Guest Self-Attestation

**Novice:** A failed guest loopback probe proves the host daemon was unreachable.

**Expert:** Prove absent host mounts, devices, routes, and mappings externally;
label guest probes `GUEST_ASSERTED`.

**Timeline:** Reassuring logs collapse under a compromised guest that lies or tests
the wrong namespace.

## Internal Ledger Called A Hard Bill Cap

**Novice:** Reserve five dollars locally, therefore no provider can charge more.

**Expert:** Reservation limits broker authority. Only provider-enforced custody
plus measured enforcement lag bounds actual financial loss.

**Timeline:** Delayed reporting, concurrent requests, or quota propagation allows
overshoot even while the internal ledger looks correct.

## Subscription Called Free

**Novice:** Route unbounded work to a subscription harness because no per-token
invoice is visible.

**Expert:** Keep committed cash and native allowance in separate ledgers, record
authentication mode and observation quality, reserve forecast p95 draw after an
operator reserve, checkpoint before the wall, and treat missing capacity as
`UNKNOWN`.

**Timeline:** Five-hour or weekly allowance vanishes while the cash ledger remains
green, blocking higher-value work and provoking model-switch or retry storms.

## One Language Everywhere

**Novice:** Rewrite the controller, native adapter, UI, guest, and subject in one
language and call the result safer.

**Expert:** Keep one implementation for trusted state and receipt logic, use a
mechanical native helper only where required, keep rich UI read-only, and measure
every process and channel added to the trusted computing base.

**Timeline:** Unsafe FFI, duplicated native policy, or an interactive WebView
quietly becomes the broadest authority path.

## Presentation As Containment

**Novice:** Treat a gallery, `chroot`, sandbox profile, or same-UID wrapper as
evidence that hostile code was contained.

**Expert:** Use the gallery only to inspect evidence, label fixtures honestly, and
require an approved external controller's host receipt for containment.

**Timeline:** The specimen looks boxed in while retaining host paths, hooks,
credentials, sockets, or network authority.

## Guest-Declared Billing Inputs

**Novice:** Trust `inputTokens`, `inputBytes`, or `maxOutput` in the guest request.

**Expert:** The broker measures payloads and derives conservative provider-specific
bounds; host policy supplies maxima.

**Timeline:** Malicious or buggy clients understate inputs and defeat admission.

## Random Chaos Without Replay

**Novice:** Kill processes randomly until something fails.

**Expert:** Control entropy, virtual time, order, and fault schedules; preserve a
seed and minimized counterexample; test safety and liveness.

**Timeline:** An exciting flake consumes days because nobody can reproduce or
distinguish it from infrastructure noise.

## Signed Claims Treated As Truth

**Novice:** The guest signed a PASS receipt, so the run passed.

**Expert:** Signatures prove origin and integrity. Trust comes from witness
position, observed fields, isolation, and downstream verification.

**Timeline:** A compromised subject signs a perfectly authentic lie.
