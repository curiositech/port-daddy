# ADR-0140: Provable Action Adjudication Contract

- **Status:** Proposed; Phase 0 implemented as evidence contracts and a pure verifier
- **Date:** 2026-09-08
- **Roadmap:** `provable-action-adjudicator`
- **Builds on:** [ADR-0040](0040-non-forgeable-actor-identity.md),
  [ADR-0050](0050-coast-guard.md), [ADR-0053](0053-out-of-band-enforcement.md),
  [ADR-0120](0120-rust-kernel-boundary.md),
  [ADR-0132](0132-merge-authority-reconciliation.md),
  [ADR-0134](0134-control-command-ingress-and-consent-transport.md), and
  [ADR-0136](0136-cross-runtime-execution-envelope.md)
- **Related in-flight design:** Grand Harbor / Drydock PR #10107, one-use
  action capabilities PR #9822, exact operator admission PR #9963, operator
  human gate PR #10088, and global stop controls PR #10115

## Context

The north-star Ledger names RCP-9, a provable action adjudicator, as open. The
repository already has valuable pieces, but no canonical object that answers
all of these questions together:

1. What exact action and parameters were proposed by which body?
2. Which exact policy and authority decided it?
3. Was the decision made before the effect at a channel the runtime could
   actually refuse?
4. Does the observed effect bind to that exact decision?
5. If no valid decision exists, can the record say bypass without laundering
   later observation into permission?

`preToolGate` and `postToolGate` answer part of this for classified shell
commands. They have no production call sites at the time of this decision, and
the post-tool path correctly describes itself as observation after side
effects. `CapabilityDecision` answers a different question: whether a product
surface may present or dispatch an Agent Harbor operation. Neither is a
universal, exact action permit.

PR #10104 supplies a useful negative witness. The operator force-landed the
halted-hook repair as merge commit
`02a10b2848a1d8c53f39e42f652c0bc2595617b4`. That was an operator action, but
no pre-effect adjudication receipt exists. This ADR records it as
`bypass-unadjudicated`; it does not invent retrospective permission or dispute
the operator's authority to act directly.

Port Daddy is halted while this Phase 0 lands. No daemon, Fleet, hook, or agent
runtime is started to exercise it.

## Decision

### Three records, with no implied upgrades

Adopt three tolerant-reader Agent Harbor v0 contracts:

| Record | Establishes | Does not establish |
| --- | --- | --- |
| `ActionProposal` | Exact subject, operation, target scope, parameters, policy inputs, and request time | Permission or execution |
| `AdjudicationReceipt` | A decision over the proposal digest under an exact policy/evaluator and named authority | Complete mediation merely because the fields exist |
| `EffectReceipt` | An independently witnessed effect linked to an action and optional adjudication digest | Correctness, causation, or authorization when the adjudication is absent or invalid |

The action and adjudication digests use the existing canonical JSON plus
SHA-256 convention. A changed byte in subject, operation, target, parameters,
policy inputs, decision, authority, or mediation posture changes the binding.

### Fail-closed executable predicate

`verifyAdjudication` returns `executable: true` only when all of the following
hold:

- the receipt binds to the exact proposal digest;
- the proposal and receipt are current at evaluation time;
- the receipt was issued after the proposal;
- the policy digest is in the caller's trusted policy set;
- an injected authority-proof verifier validates the receipt;
- test-fixture authority is never production-executable, and a permit carries
  a content-addressed authority grant;
- the evaluator is separated from the acting subject;
- the decision claims a pre-effect interception point;
- a named reason exists;
- `permit-with-obligations` names at least one concrete predicate; and
- every obligation deadline is well formed and still satisfiable at the
  pre-effect decision point; and
- the decision is `permit` or `permit-with-obligations`.

The TypeScript verifier deliberately does not implement signatures. ADR-0120
requires signing and verification primitives to live once in the Rust kernel;
Phase 0 accepts a verifier callback so tests can prove fail-closed composition
without creating a third cryptographic implementation.

Historical effects are evaluated at their occurrence time. A valid prior
permit does not become a bypass when its lease later expires.

### Bypass and violation vocabulary

Observed effects are classified exhaustively:

- `authorized`: exact valid prior permit;
- `authorized-with-open-obligations`: exact valid prior permit whose receipt
  carries obligations that still require separate closure receipts;
- `bypass-unadjudicated`: no prior receipt was supplied;
- `bypass-invalid-adjudication`: a receipt exists but its binding, policy,
  authority, separation, timing, target, or independently checked effect
  witness fails; or
- `violation-against-decision`: the effect occurred after a valid deny or
  indeterminate decision.

This vocabulary separates normative authority from physical capability. An
effect can happen without permission; observing it does not make it permitted.

### Trust boundary

Phase 0 is a contract and verifier, not a reference monitor. Production earns
complete mediation only when a separately installed, non-agentic controller:

- owns the credential, network, filesystem, process, or provider channel that
  causes the effect;
- verifies the receipt before releasing that channel;
- cannot be rewritten or restarted by the subject it judges;
- signs append-only adjudication and effect receipts; and
- denies when policy, provenance, identity, proof, time, or controller state
  is unknown.

Grand Harbor calls that controller Drydock and states the governing invariant:
Port Daddy may not be its own safety adjudicator. This ADR adopts that boundary.
The Agent Harbor module is the protocol adapter and independent test oracle;
it is not the final authority.

## Whitepaper reconciliation

| Canon | Reconciliation |
| --- | --- |
| *The Legible Swarm* | Every authority act gets a named reason and a zoomable record; consent is scoped, revocable, and action-class specific. The receipt binds the reason, policy, grant, and action. |
| *The Single-Writer Kernel* | Permission remains distinct from capability. Preventive claims require a controllable pre-commit gate; post-commit observation remains detection. Phase 0 makes that distinction machine-readable without claiming deployment. |
| *Spawn to Person* | Actor, body, session, and execution-envelope identity remain separate. A successor or body cannot inherit authority by implication. |
| *The Anchor Protocol* | Attenuated identity/capability proofs supply authority evidence, but possession alone is not the adjudication decision. The future proof verifier stays in the Rust security kernel. |
| *The Harbor Economy* | Ability and permission remain distinct, and settlement cannot infer semantic causation from an effect receipt alone. |
| *The Federated Harbor* | Transport and inclusion evidence do not decide authorization. Cross-harbor policy remains locally sovereign and requires an outside witness or adjudicator for disputed causation. |

No whitepaper claim is upgraded from designed to built by this phase.

## Implementation Matrix

| Phase | Roadmap slug | Status | Depends on | Description |
| --- | --- | --- | --- | --- |
| 0 | provable-action-adjudicator | now | — | Freeze proposal/adjudication/effect schemas, exact digest verifier, fail-closed classifications, and PR #10104 bypass fixture |
| 1 | provable-action-policy-ir | backlog | Phase 0 | Compile reviewed policy into a deterministic, versioned intermediate representation with negative fixtures and proof obligations |
| 2 | provable-action-kernel-proof | backlog | Phase 1, PR #9822 | Add canonical Rust signing/verification and one-use action-capability binding with cross-runtime parity vectors |
| 3 | drydock-external-controller | blocked | Phase 2, Grand Harbor/Drydock decision | Build the separately installed controller and independently prove credential, network, process, filesystem, and spend mediation |
| 4 | provable-action-production-wiring | blocked | Phase 3 | Route every controllable production effect through Drydock; red-team complete mediation and keep unsupported channels denied |

Phase 0 does not close RCP-9. It supplies the stable evidence boundary required
before policy formalization or external enforcement can be tested honestly.

## Consequences

### Positive

- Exact proposal, policy, decision, and effect joins replace prose claims.
- Missing or stale authority fails closed and remains distinguishable from a
  valid deny.
- Historical bypass incidents can become regression fixtures without being
  rewritten as authorized successes.
- The contract composes with in-flight one-use capability and Drydock work
  without duplicating either implementation.

### Negative

- The verifier is only as trustworthy as its policy allowlist and injected
  authority-proof verifier.
- Phase 0 cannot stop any effect. Callers must not describe it as containment,
  enforcement, or a completed reference monitor.
- Obligation closure needs a subsequent receipt contract; this phase only
  preserves the obligation instead of silently dropping it.

### Rejected alternatives

- **Extend `CapabilityDecision` into the action permit.** That object is a
  product-surface decision and lacks exact action/policy/effect binding.
- **Call `preToolGate` the universal monitor.** It is command-specific and
  currently unwired; doing so would overclaim complete mediation.
- **Build an ambient post-hoc observer first.** It can produce bypass evidence,
  but cannot prevent the effect it observes.
- **Verify signatures in TypeScript.** That violates ADR-0120's one-canonical-
  primitive boundary.
- **Let Port Daddy issue and verify its own permit.** A compromised subject
  could self-clear, contradicting Grand Harbor Passage 0.
