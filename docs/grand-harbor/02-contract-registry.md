# Contract registry

**Status:** PROPOSED  
**Purpose:** turn nouns into reviewable inputs, outputs, transitions, failure semantics, and proof obligations.

Every contract must cover the completeness profile in `checks/completeness-profile.yaml` or state `N/A` with a reason. `TODO` is allowed while a contract is Proposed or Stub; it is forbidden once Contracted.

## First vertical-proof contracts

### GH-C-001 — Actor identity and incarnation

**Promise:** one durable `ActorId` survives body/provider/session replacement; a live `IncarnationId` plus valid `BodyLease` is required to act as it.  
**Inputs:** daemon-minted identity, credential proof, authority epoch, incarnation, predecessor lineage.  
**Outputs:** authenticated Actor snapshot or fail-closed denial.  
**Failure:** forged, stale, revoked, duplicate, split-brain, or unknown identity is not downgraded to a self-asserted alias.  
**Open:** minting, recovery, rotation, simultaneous incarnation, and inheritance semantics.  
**Proof:** kill Builder on backend A; resume on B; preserve identity, obligations, claims disposition, and outcome history without copying raw hidden model state.

### GH-C-002 — Operator authority and intent transition

**Promise:** a model may propose an interpretation of operator speech, but only an attributable authority event mutates canonical program state.  
**Input classes:** `refines | adds | interrupts | contradicts | supersedes | questions | parks`.  
**Outputs:** accepted transition, rejected proposal, or explicit ambiguity.  
**Failure:** no silent replacement, dropped instruction, or authoritative inference from confidence.  
**Open:** exact approval gesture, standing-policy scope, offline behavior, and conflict semantics.

### GH-C-003 — Harbor boundary and grant

**Promise:** cross-Harbor access is an explicit, attributable, scoped, attenuable, revocable grant; collaboration does not merge sovereignty.  
**Inputs:** principals, resource scopes, Harbor epochs, purpose, expiry, delegation chain.  
**Outputs:** usable grant or denial with reason.  
**Failure:** stale epoch, ambiguous principal, widened delegation, or conflicting grant fails closed.  
**Open:** grant composition, in-flight revocation, non-Port-Daddy collaborator semantics.

### GH-C-004 — ActionIntent

**Promise:** one exact proposed effect has a canonical typed representation before authority evaluation.  
**Minimum fields:** kind/action; Actor and incarnation; Harbor/Convoy; exact resource and target; normalized parameters; expected/precondition state; idempotency key; requested budget; intent/program provenance; attachments/digests.  
**Failure:** unknown action, unresolved target, unnormalized agent-supplied authority facts, mutable identifier, or missing precondition is `INVALID`/`INDETERMINATE`, never an implicit permit.  
**Does not:** authorize or execute.

### GH-C-005 — Action adjudication

**Promise:** an isolated deterministic evaluator decides against signed compiled policy and a versioned authoritative causal slice.  
**Decision:** `Deny | Permit | PermitWithObligations | Indeterminate`; whether obligations remain a first-class decision is open.  
**Evidence:** determining clause/policy IDs, policy digest, schema version, entity/snapshot digest, authority epoch, evaluation errors, reason.  
**Failure:** unknown predicate, missing/stale fact, policy error, bad signature, or substrate mismatch fails closed.  
**Does not:** fetch remote policy, invoke a model, generate a proof, or perform an effect on the hot path.

### GH-C-006 — ActionPermit

**Promise:** a permit admits one exact actuator attempt and nothing broader.  
**Minimum binding:** ActionIntent digest; principal/incarnation; action; resource and parameter digest; policy and schema version; entity/snapshot digest; resource state version; authority epoch; nonce; expiry; idempotency key; obligations.  
**Consumption:** atomic, replay-detecting, and target-bound.  
**Open:** delegation, transport/signature, policy-epoch change, use-time reauthorization, crash between issue and effect.  
**Does not:** establish execution.

### GH-C-007 — Actuator execution

**Promise:** a narrow adapter rechecks permit binding, performs only the exact effect, observes/read-backs when possible, and records partial or indeterminate outcomes honestly.  
**Failure classes:** rejected-before-effect; failed-no-effect; succeeded-observed; partial; accepted-external-unknown; indeterminate; compensation-pending.  
**Security:** reusable credentials stay outside the agent body; bypass paths belong to the complete-mediation proof.  
**Does not:** widen authority or collapse an uncertain external result into success.

### GH-C-008 — ActionReceipt and evidence

**Promise:** immutable receipt binds request, permit, actuator, timestamps, observations, external identifiers, obligation discharge, costs, uncertainty, and evidence hashes.  
**Reconciliation:** if an external service may have accepted an effect before a crash, state becomes `INDETERMINATE` and read-after-write reconciliation emits another evidence event rather than rewriting history.  
**Does not:** automatically prove user/business outcome.

### GH-C-009 — Intent persistence and scheduling

**Promise:** accepted intentions remain queryable and schedulable through interruption, body replacement, and compaction.  
**Required transitions:** propose, accept, activate, suspend, block, resume, supersede, abandon, complete, fail.  
**Portable continuity:** preserve observable state in a signed content-addressed task capsule; do not promise bit-identical hidden activations/provider state.  
**Open:** scheduling policy, memory selection, operator contradiction, split responsibility.

### GH-C-010 — Claim and pheromone coordination

**Claim promise:** authoritative coordination state has scope, owner, lease/expiry, conflict, transfer, release, abandonment, and salvage semantics.  
**Pheromone promise:** advisory signal has source, scope, kind, strength, created time, half-life, evidence, and poisoning controls.  
**Invariant:** deleting every pheromone may change advice but cannot change claims, grants, permissions, or completion.

### GH-C-011 — Projection consistency

**Promise:** pd-console, FleetBar, Porthole, PWA, Claim Tree, and generated roadmaps show source authority, revision/epoch, freshness, and stale/degraded state. Commands route through shared contracts; no surface privately reimplements authority.  
**Fast acknowledgement:** UI may instantly say `captured`, `requested`, `denied`, `permitted`, or `revocation issued`; it may not say `executed`, `proved`, or `revoked at the actuator` before evidence exists.

### GH-C-012 — Convoy lifecycle and economics

**Accepted lifecycle:** `ConvoySource → staged instance → signed ConvoyReleaseCapsule → target profile → operation/upgrade/revocation`.  
**Economic separation:** execution COGS authority is distinct from commerce/action authority. A `$10 sale → ≤$8 provider COGS` is a configurable release-policy example, not a universal margin.  
**Records:** funding evidence; customer entitlement; execution economic authority; actual COGS accrual; commerce action authority.  
**Admission loop:** estimate → reserve worst case atomically → execute → measure externally → commit actual/release remainder.  
**Invariants:** no minting; nested attenuation; exact partial accrual; idempotency; versioned pricing; refund/reversal does not erase realized cost; founder subsidies are explicit.  
**First proof:** owner-funded hosted web, two agents, deterministic economics simulator, capsule-bound receipts, no customer money.

## Contract completeness matrix

| Contract | Identity | Authority | Concurrency/TOCTOU | Failure/partial | Replay | Revocation | Budget | Privacy | Cross-Harbor | Proof |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GH-C-001 | ✓ | ✓ | Open | ✓ | Open | Open | N/A | ✓ | Open | Defined |
| GH-C-002 | ✓ | ✓ | Open | ✓ | Open | Open | N/A | Open | Open | Open |
| GH-C-003 | ✓ | ✓ | Open | ✓ | Open | Open | Open | ✓ | ✓ | Open |
| GH-C-004 | ✓ | Requested | ✓ | ✓ | ✓ | N/A | ✓ | ✓ | ✓ | Schema needed |
| GH-C-005 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Differential/mutation |
| GH-C-006 | ✓ | ✓ | ✓ | ✓ | ✓ | Open | ✓ | ✓ | Open | Adversarial |
| GH-C-007 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Open | Bypass/readback |
| GH-C-008 | ✓ | Evidence | ✓ | ✓ | ✓ | Immutable history | ✓ | Open | Open | Verifier needed |
| GH-C-009 | ✓ | ✓ | Open | ✓ | ✓ | ✓ | ✓ | ✓ | Open | Interrupt/resume |
| GH-C-010 | ✓ | Coordination only | ✓ | ✓ | ✓ | ✓ | N/A | Open | Open | Delete-pheromone test |
| GH-C-011 | ✓ | Projection only | ✓ | ✓ | N/A | Freshness | ✓ | ✓ | ✓ | Source/epoch UI |
| GH-C-012 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Open | Capsule/economics voyage |

## Staged contract families

Resource grants, secret broker, embodiment adapters, outcome attribution, skill binding, selection episodes, Relay federation, reputation, confidential execution, and economic settlement have placeholder records in `stubs/`. They may not be used to satisfy a required proof until promoted through review.

