# Skill graft plan

**Status:** PROPOSED GRAFTS AND INVENTORY  
**Rule:** reading a skill is not grafting it

The repository already has machine-readable graft machinery:

```text
schemas/agent-harbor/v0/skill-graft.schema.json
lib/skill-graft.ts
lib/skill-graft-events.ts
lib/skill-graft-reconciler.ts
lib/skill-graft-runtime.ts
tests/unit/skill-graft*.test.*
```

Every implementation graft must record source version, adopted ideas, rejected ideas, target contract, code/decision artifacts, and an executable proof. The ledger documents candidates; runtime graft records establish use.

## Graft 1 — Kernel ontology and identity

**Sources:** `agent-identity-continuity-reputation`, `fipa-00023-agent-management`, `agentspeak-bdi`  
**Adopt:** `AgentNode` as durable person; `Body` as replaceable embodiment; office/role distinct from person; identity before capability/reputation; goal distinct from intention.  
**Reject:** self-asserted principal identity; reputation before witnessed outcomes; a new parallel `Incarnation` registry without an explicit alias/migration ADR.  
**Target:** GH-C-001; operator-binding aspects also constrain GH-C-002.  
**Proof:** GH-P-001.

## Graft 2 — Chartroom intention engine

**Sources:** `agentspeak-bdi`, `bdi-agency-model`, `rao-georgeff-1991-modeling-rational-agents-bdi`, `rao-georgeff-1995-bdi-agents-from-theory-to-practice`, `normative-bdi-agents`  
**Adopt:** belief/goal/intention separation; persistent interruptible intentions; event, plan, and intention selection; context guards; reconsideration and drop reasons; norms as constraints/candidate commitments.  
**Reject:** literal AgentSpeak interpreter as an initial dependency; model interpretation as operator authority; private model state represented as observable fact.  
**Target:** GH-C-002 and GH-C-009.  
**Proof:** GH-P-002 and GH-P-003.

**New skill candidate:** `operator-intent-reconciler`. Its allowed primary outputs are `refines`, `adds`, `interrupts`, `contradicts`, `supersedes`, `questions`, and `parks`, always with cited evidence and ambiguity.

## Graft 3 — Parley protocol hardening

**Sources:** `fipa-00025-interaction-protocol-library`, `fipa-00037-communicative-act-library`, `smith-1980-contract-net-protocol`, `normative-bdi-agents`  
**Adopt:** role-parameterized FSMs; conversation identity separate from actor identity; `not-understood`, refusal, failure, timeout, cancellation, duplicate, and out-of-order handling. Contract Net is limited to task-allocation experiments.  
**Reject:** FIPA conformance as evidence of reliable delivery, common knowledge, agreement, or incentive compatibility; a new store that competes with mature Parley.  
**Target:** future Parley protocol-registry contract; existing Parley authority must be reconciled before promotion.  
**Proof:** GH-P-007.

## Graft 4 — Provable action vertical slice

**Sources:** `provable-action-adjudicator`, `destructive-action-policy-matrix`, `human-gate-designer`, `agent-work-receipt-designer`, `idempotency-key-patterns`, `macaroon-capability-credentials`  
**Adopt:** typed immutable request/permit/denial/receipt; exact target and expected-state binding; nonce/idempotency; pre/postcondition observation; partial/indeterminate results; separate credential custody; immutable evidence links.  
**Reject initially:** Lean or Datalog for every action; renaming `WorkReceipt` to `ActionReceipt`; describing post-hoc Arbiter logging as universal pre-execution adjudication.  
**Target:** GH-C-004 through GH-C-008.  
**Proof:** GH-P-004.

**New skill candidate:** `actuator-contract-designer`, covering least authority, TOCTOU, replay, preconditions, observation, compensating actions, partial/indeterminate outcomes, secret isolation, and external exactly-once limits.

## Graft 5 — Claim Forest plus stigmergy

**Source:** `stigmergic-diffusion-medium` plus existing Claim Forest and pheromone code  
**Adopt from the skill:** provenance, bounded strength, decay, resolution damping, advisory gradients, graph projection.  
**Reject:** replacing claims, scheduler, permissions, or completion authority; claiming the full graph-Laplacian medium already exists.  
**Target:** GH-C-010.  
**Proof:** GH-P-005.

## Graft 6 — Porthole evidence explorer

**Sources:** `agent-work-receipt-designer`, `focus-receipt-proof-gate`, Agent Harbor event sourcing/search disciplines, privacy/redaction skills already used by Agent Harbor  
**Adopt:** projections rebuild from canonical events; assertions traverse to evidence or the first missing edge; terminal/browser/native captures are attachments; privacy decisions happen before the first durable write.  
**Target:** GH-C-008.  
**Proof:** GH-P-006.

**New skill candidate:** `evidence-chain-debugging`.

## Graft 7 — Runtime confinement

**Sources:** `fleet-event-spawn-trust`, `sqlite-durable-agent-state`, `advanced-rust-patterns`, `rust-performance-and-idioms`  
**Adopt:** Harbor-owned spawn; explicit sandbox profile, body lease, grants, capability endpoint; durable state and idempotent recovery; security primitive in the Rust TCB.  
**Reject:** same-UID coordination locks as OS enforcement; credential possession as authority; self-reported budget as cost truth.  
**Target:** future confinement/secret-broker contract; GH-C-001 and GH-C-007 are the current adjacent contracts.  
**Proof:** GH-P-008.

**New skill candidate:** `same-uid-agent-confinement`, explicitly separating coordination, OS enforcement, credential non-possession, network mediation, detection, and attestation.

## Graft 8 — Selection and credit assignment

**Sources:** outcome/reputation research and existing skill-selection substrates  
**Adopt:** decision episode, candidate set, policy version, evidence available at selection, outcome vector, uncertainty, stratification, shadow candidates, regret, rollback.  
**Reject:** `skill present + success = skill good`; estimator as architecture; uncorrected Elo as outcome truth.  
**Target:** future selection/outcome-attribution contract; GH-C-008 supplies evidence and GH-C-012 depends on the result.  
**Proof:** GH-P-010.

**New skill candidates:** `skill-credit-assignment` and `selection-policy-experimentation`.

## Graft 9 — Relay and economy sequencing

**Sources:** `pd-relay-zero-trust`, `local-first-tenancy-boundary`, `macaroon-capability-credentials`, FIPA role/protocol skills; later `three-sided-agent-labor-market`, `mechanism-design-for-agent-labor`, `cryptoeconomic-protocol-security`  
**Adopt:** directional grants and evidence contracts; events cross, databases and implied consensus do not; identity/outcome proof before reputation; independent settlement oracle.  
**Reject:** Float Plans in Relay's first critical path; payment as proof of outcome; `pd-anchor` primitives as completed economic settlement.  
**Target:** GH-C-003 and GH-C-012 plus future outcome/settlement contracts.  
**Proof:** GH-P-009 and GH-P-011.

## Skill inventory corrections

- `agentspeak-bdi` points at nonexistent `normative-bdi-agent-architecture`; the existing skill is `normative-bdi-agents`.
- `stigmergic-diffusion-medium` points at three absent companions: `active-inference-agent`, `belief-market-tateonnement`, and `immune-selection-pressure`.
- Existing audit warnings include missing reference/example/diagram indexes across several BDI, identity, and receipt skills.
- No machine-readable graft currently binds BDI/FIPA skills to Chartroom or Parley.
- The audit should verify that relationship targets exist, not merely that source skill folders parse.

## Example graft record

```yaml
graft:
  skill: agentspeak-bdi@content-digest
  target_contracts: [GH-C-002, GH-C-009]
  adopted:
    - persistent intention separation
    - event, plan, and intention selection loci
    - context guards
  rejected:
    - literal AgentSpeak syntax as first implementation
    - model belief represented as substrate fact
  artifacts:
    - docs/adr/...
    - lib/chartroom/...
  proofs:
    - GH-P-003
```
