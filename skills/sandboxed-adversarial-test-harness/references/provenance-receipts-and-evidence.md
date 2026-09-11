# Provenance, Receipts / Evidence

Use this when sealing Drydock inputs, designing receipts, classifying evidence,
deciding which component may assert a field, or judging what a signature supports.

## Witness position precedes cryptography

A signature establishes the integrity and origin of a statement. It does not prove
that the signer was independent, observed the claimed fact, or told the truth.

| Evidence class | Appropriate witness | Example fields | Cannot establish alone |
|---|---|---|---|
| `HOST_OBSERVED` | external controller or hypervisor manager | VM identity, devices, mounts, host routes, cgroup, lifecycle, kill | guest semantic correctness |
| `BROKER_OBSERVED` | typed effect broker | payload size, policy decision, provider dispatch, bytes returned | provider invoice truth without reconciliation |
| `PROVIDER_RECONCILED` | provider account or payment records | quota, rejection, usage, invoice, credit | host isolation or request intent |
| `GUEST_ASSERTED` | test subject or guest runner | logs, probes, tests, claimed output | its own containment or host state |
| `MODEL_CHECKED` | model checker plus exact model/configuration | bounded invariant or liveness result | concrete implementation refinement |
| `REPLAYED` | deterministic controller | same seed/schedule reproduced observation | unvisited schedules or external provider behavior |
| `HUMAN_APPROVED` | authenticated operator action | exact tier, limit, subject, expiry | successful enforcement or execution |

Spelling the class in the receipt prevents a UI from flattening unlike facts into a
single green “verified” badge.

## Sealed input manifest

Record every input that can influence execution:

- controller and broker build digests;
- VM image, kernel, initrd, firmware, and configuration digests;
- source URI, normalized remote, exact commit, tree, and archive/image digest;
- test bundle, test runner, configuration, setup/teardown, transform, and helper digests;
- scenario, fixture, fake/replay provider, schedule-policy, and seed digests;
- capability, effect, resource, network, retention, and promotion policy digests;
- provider/model mapping and price catalog digest/freshness;
- operator approval identity, scope, timestamp, expiry, and nonce; and
- all external parameters, resolved dependencies, and controller system parameters.

The controller obtains source through an explicit repository root or read-only
fetcher. It never lets Git walk upward from an arbitrary working directory. It
stages submitted source and tests as inert bytes and does not import, evaluate, or
execute them on the host.

SLSA's build model is useful here: tenant-controlled external parameters are
untrusted and should be complete; resolved dependencies identify what those
parameters selected; the trusted control plane generates and signs provenance.
SLSA also requires isolation between build environments at hardened levels.

Primary sources:

- [SLSA Provenance model](https://slsa.dev/spec/v1.0-rc2/provenance)
- [SLSA Build Track basics](https://slsa.dev/spec/v1.2/build-track-basics)
- [SLSA threats and mitigations](https://slsa.dev/spec/v1.2/threats)

## Receipt chain

Use append-only, content-addressed events. Each event includes:

- schema version, event ID, prior-event digest, run ID, and monotonic sequence;
- wall and monotonic timestamps with the clock source named;
- actor/witness identity and evidence class;
- subject, controller, policy, scenario, and capability digests;
- transition type, idempotency key, request/response digests, and decision;
- redacted measurements and references to separately retained payloads;
- signature or MAC bound to the full canonical representation; and
- retention class, tombstone state, and disclosure policy.

The terminal receipt commits to the ordered event chain, output inventory, evidence
completeness, residuals, and exact verdict. A verifier reconstructs the chain from
genesis, checks sequence and hashes, verifies signatures against a pinned trust root,
and rejects missing, duplicate, reordered, or unknown critical events.

### Crash consistency

- Append the reservation before opening a provider connection.
- Persist cancellation and revocation before asking the guest to stop.
- Make each transition idempotent under duplicate delivery.
- Recover from the last valid committed prefix; never skip an invalid middle event.
- Treat a missing terminal receipt as `INCOMPLETE`, not success.
- Preserve uncertain reservations and provider calls until reconciliation or
  adjudication makes the conservation state explicit.

### Transparency and inclusion

A Merkle or transparency log can prove that a signed receipt was included and that
the log remains append-only. It cannot prove that the underlying observation was
true. Sigstore Rekor is a useful reference for inclusion and consistency proofs;
Drydock still needs its own witness and field semantics.

Primary source: [Sigstore Rekor overview](https://docs.sigstore.dev/logging/overview/).

## Provenance ownership matrix

| Field | Primary authority | Guest contribution |
|---|---|---|
| image, source, test, and scenario digests | controller fetcher and sealer | requested reference only |
| device, mount, network, and resource manifests | controller or hypervisor manager | optional diagnostic probe |
| billable input bounds | broker over resolved payload | lower requested cap or consistency hint |
| provider quota, rejection, usage, and invoice | provider plus external reconciler | request correlation ID |
| test semantics and assertions | guest test runner | full assertion and logs, always `GUEST_ASSERTED` |
| artifact bytes and inventory | controller quarantine collector | proposed manifest, not authoritative inventory |
| approval | authenticated operator surface | none |
| terminal verdict | independent adjudicator over required evidence | one input, never sole authority |

No single signer should own both the effect and the only evidence that it was
bounded. Where separation is temporarily impossible, label the receipt weaker and
block any tier that requires independence.

## Verification order

1. Verify the envelope and signer against a pinned root.
2. Verify schema and canonical encoding; reject unknown critical fields.
3. Verify subject/output digests against the actual bytes.
4. Verify the complete prior-event chain and terminal commitment.
5. Verify each field was asserted by an allowed witness class.
6. Verify immutable inputs and external parameters match the approved run.
7. Verify required evidence is complete for the requested tier.
8. Recompute conservation, capability, resource, and lifecycle invariants.
9. Verify output quarantine and promotion are separate events.
10. Emit an exact verdict and preserve discrepancies.

## Adversarial receipt cases

- Guest signs a false PASS.
- Guest reports host loopback when it tested only guest loopback.
- Output digest is valid but source digest names another repository or commit.
- One middle event is removed and the terminal receipt is re-signed.
- Events are duplicated or reordered across a crash/retry.
- Controller key appears inside guest-readable storage.
- Two runs share a receipt key, socket path, output object, or mutable cache.
- Receipt claims zero egress while host packet evidence is absent.
- Provider usage arrives after terminal settlement and exceeds reservation.
- Transparency-log inclusion is presented as proof the underlying claim is true.

Each attack must end in `FAIL`, `INVALID`, `INCOMPLETE`, or `UNCERTAIN`, never PASS.
