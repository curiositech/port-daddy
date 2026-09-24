---
name: provable-action-adjudicator
description: >-
  Audits and designs evidence-bound pre-effect action-adjudication contracts:
  typed proposals, policy- and authority-bound decisions, one-use permits,
  effect receipts, and a claim ladder that separates verifier correctness from
  complete mediation. Use for a concrete consequential-action boundary, threat
  model, bypass inventory, or adjudication evidence packet. NOT for claiming a
  deployed reference monitor, generic policy-language authoring, generic Lean or
  Datalog work, prompt safety, post-hoc log analysis, or production latency
  claims without local reproducible evidence.
license: Apache-2.0
allowed-tools: Read,Write,Edit,Grep,Glob,Bash(node:*)
metadata:
  category: Agent Safety & Authority
  tags:
    - action-adjudication
    - pre-effect
    - capability
    - evidence
    - threat-model
  provenance:
    kind: first-party
    owners: [port-daddy]
  pairs-with:
    - skill: agent-control-command-contract
      reason: Defines typed intent and command boundaries.
    - skill: mcp-trust-broker
      reason: Defines authority attenuation and external tool custody.
    - skill: agent-work-receipt-designer
      reason: Defines attributable effect and settlement receipts.
    - skill: sandboxed-adversarial-test-harness
      reason: Exercises bypasses and escaped-effect paths.
  io-contract:
    kind: deliverable
    consumes:
      - kind: effect-boundary-and-threat-model
        format: markdown-or-json
      - kind: source-and-runtime-evidence
        format: markdown-or-json
    produces:
      - kind: adjudication-audit
        format: json
      - kind: claim-and-bypass-ledger
        format: markdown
---

# Provable Action Adjudicator

This skill does not make an adjudicator provable by naming formal methods. It
forces each claim onto the highest rung its evidence actually supports.

## Halt and effect gate

A static contract, schema, fixture, signature, or passing verifier is not a
runtime interception proof. When the subject runtime is halted:

- inspect source and immutable evidence only;
- build schemas, fixtures, validators, and threat models;
- label dynamic mediation claims `BLOCKED_BY_HALT`;
- never launch the subject to improve the evidence tier.

## Claim ladder

Rungs are cumulative, never interchangeable:

| Rung | Claim | Minimum evidence |
|---|---|---|
| `CONTRACT_PARSED` | The proposal and receipts match a closed schema. | Schema validation and negative field/type cases. |
| `VERIFIER_TESTED` | The verifier rejects declared invalid relationships. | Exact code digest, mutation corpus, and observed results. |
| `AUTHORITY_BOUND` | Decision inputs bind current principal, scope, policy, and time. | Independent authority receipt and stale/scope/replay tests. |
| `PRE_EFFECT_BOUND` | A permit is consumed before one exact effect path opens. | Intent-before-send and one-use redemption evidence. |
| `MEDIATION_INVENTORIED` | Every declared effect class has an identified enforcement boundary. | Enumerated channels, owners, bypasses, and unknowns. |
| `MEDIATION_WITNESSED` | Independent witnesses observed all in-scope bypass attempts fail. | Exact-build dynamic evidence from outside requester/actuator. |

Only the final rung may support a bounded complete-mediation claim, and only for
the enumerated subject, build, effects, policy, environment, and observation
window. It never proves all possible effects in an open system.

## Authority separation

Keep these roles independently attestable:

1. **Requester** creates a typed `ActionProposal`.
2. **Approver**, when policy requires a person, attests informed assent to an
   immutable review envelope. Approval is not a permit.
3. **Authority verifier** proves current principal, scope, audience, expiry,
   revocation, and resource binding.
4. **Policy adjudicator** returns `ALLOW`, `DENY`, or `INDETERMINATE` for exact
   proposal, authority, policy, and state digests.
5. **Controller/effect broker** owns the channel and accepts one exact permit.
6. **Actuator** performs at most the permitted effect.
7. **Witness/reconciler** observes provider or target truth independently.

No component may request, approve, adjudicate, execute, and certify the same
consequential transition. Process names are not separation; keys, custody,
release boundaries, and failure domains matter.

## Pre-effect protocol

```mermaid
sequenceDiagram
  participant R as Requester
  participant A as Authority verifier
  participant J as Adjudicator
  participant C as Protected controller
  participant E as External effect
  participant W as Independent witness

  R->>A: proposal digest + current authority
  A-->>J: verified authority receipt
  J-->>C: exact decision receipt
  alt DENY or INDETERMINATE
    C-->>R: refusal; channel remains closed
  else ALLOW
    C->>C: atomically redeem one-use permit
    C->>E: record intent, then transmit exact effect
    E-->>W: provider/target observation
    W-->>C: effect or ambiguity receipt
  end
```

`DENY` and `INDETERMINATE` make execution unreachable. Compensation is a new
effect requiring a new proposal and permit; it is never preventive mediation.

## Audit procedure

1. Freeze subject commit/build, policy digest, environment, actor/body
   generation, repository/harbor, and exact effect classes.
2. Enumerate every route to those effects: tools, filesystem, sockets, child
   processes, inherited descriptors, raw credentials, provider sessions,
   plugins, hooks, and out-of-band UI or API paths.
3. Identify the owner and witness of each channel. Mark anything requester- or
   guest-controlled as untrusted.
4. Trace proposal → authority → policy → decision → permit → redemption → intent
   → effect → reconciliation. Missing joins become `UNKNOWN`, never implied.
5. Mutate every bound axis, replay nonce, policy/state digest, order, and witness.
6. Record escaped or unmediated paths even if the declared tool boundary works.
7. Emit `schemas/adjudication-audit.schema.json` and validate it with
   `scripts/validate-adjudication-audit.mjs`.

## Required bypass tests

At minimum test stale generation, wrong actor, wrong repo/harbor, wrong target or
parameters, expired/revoked authority, changed policy/state, duplicate
redemption, decision after effect, requester self-adjudication, `DENY` execution,
unbound compensation, raw credential/socket/process bypass, missing witness,
lost acknowledgement, and ambiguous provider state.

## Anti-patterns

### Framework hook equals reference monitor

**Novice:** every normal tool call passes one callback, so mediation is complete.
**Expert:** inventory every effect channel and independently test bypasses.
**Detection:** an effect can occur through shell, child process, inherited
descriptor, direct network, credential, plugin, or human UI without the hook.

### Signed means true

**Novice:** a valid signature proves policy compliance or effect success.
**Expert:** signatures prove authorship/integrity; witness class determines what
the signer could know.
**Detection:** the same component signs both assertion and acceptance.

### Deny then compensate

**Novice:** execute a denied operation and repair it afterward.
**Expert:** deny leaves the channel closed; compensation has separate authority.
**Detection:** any `DENY` trace contains an effect or actuator receipt.

### Benchmark inheritance

**Novice:** publish another system's latency as this system's target.
**Expert:** record external results as context and benchmark the exact local path.
**Detection:** a performance number lacks artifact, machine, command, workload,
sample distribution, and raw result locators.

## Output and validation

The JSON audit is the primary deliverable. It reports one bounded claim, all
unknowns, the mediation inventory, mutation results, and a terminal status of
`PASS`, `FAIL`, or `BLOCKED`. `PASS` at `MEDIATION_WITNESSED` requires dynamic,
independent evidence; static packets normally terminate `BLOCKED` at a lower
rung.

```bash
node skills/provable-action-adjudicator/scripts/validate-adjudication-audit.mjs <audit.json>
node skills/provable-action-adjudicator/scripts/test-bundle.mjs
```

## Load on demand

| File | Load when |
|---|---|
| `references/repository-status.md` | Distinguishing current Port Daddy contracts from deployed enforcement. |
| `references/claim-ladder-and-threat-model.md` | Building a mediation inventory or adversarial claim. |
| `references/source-ledger.md` | Citing external definitions, standards, or research. |
| `references/benchmark-protocol.md` | Making any latency, throughput, or overhead claim. |
| `diagrams/01-claim-ladder.md` | Explaining evidence maturity. |
| `diagrams/02-pre-effect-sequence.md` | Reviewing role separation and execution order. |
| `examples/static-verifier-audit.json` | Starting a static, explicitly blocked audit packet. |
| `scripts/test-bundle.mjs` | Running the positive and adversarial validator corpus. |
| `tests/activation.md` | Testing skill routing. |

## Evidence and unknown-effect rule

Load `references/evidence-classes-and-uncertain-effects.md` for proof/model/simulation/production boundaries, timeout dispositions, and the distinction between prevention, detection, safety, and liveness.
