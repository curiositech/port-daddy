# Threat and failure model

**Status:** SEED; MUST EXPAND WITH EACH CONTRACT

The trusted core is valuable only if its claim is narrow enough to test. This register covers malicious bodies, confused models, honest concurrency, infrastructure failure, operator mistakes, and economic incentives.

## Identity and lifecycle

| Threat/failure | Required response |
|---|---|
| Body self-selects or resets identity | daemon-minted credential; security-relevant writes verify it |
| Outcome whitewashing via new provider session | outcome lineage binds durable `AgentNode`, not session |
| Original body returns after resurrection | reject or represent concurrent embodiment under explicit policy; never silent split brain |
| Forged/stale portable task capsule | signature, content digest, issuer, actor binding, event cursor, epoch and expiry checks |
| Selective continuity hides obligation | manifest exposes omitted/unavailable/unknown items |

## Authority and effects

| Threat/failure | Required response |
|---|---|
| Credential confused with authority | credential remains only authentication/actuation material; grant/policy/permit decide |
| Confused-deputy target substitution | permit binds exact resource and typed parameters |
| TOCTOU after policy evaluation | compare-and-swap on exact policy/entity/resource versions before permit persistence |
| Permit replay | nonce, expiry, idempotency, consumption ledger |
| Cedar returns decision plus errors | Port Daddy wrapper treats any evaluation error as indeterminate/deny |
| Agent bypasses actuator | Harbor-owned spawn, secret non-possession, egress/confinement, complete-mediation proof |
| Provider accepts then connection dies | `Indeterminate`; observe target before retry |
| Rollback assumed to undo effect | rollback is a new governed action with its own failure semantics |

## Coordination and cognition

| Threat/failure | Required response |
|---|---|
| New chat idea silently erases decision | stable IDs, relationship classification, explicit amendment/supersession |
| Pheromone gaming or self-reinforcing heat | provenance, bounded strength, decay, damping, separate signals, no-signal invariance |
| Stale claim blocks indefinitely | lease/liveness evidence and attributable salvage |
| Suggestion treated as authority | UI and runtime distinction; normal adjudication still applies |
| Model interpretation hallucinates intent | raw utterance retained; proposal is non-authoritative; ambiguity allowed |

## Evidence and privacy

| Threat/failure | Required response |
|---|---|
| Terminal output presented as proof | attachment only; receipt/observation chain required |
| Stale-head test presented as current | exact artifact/head binding and `stale` evidence state |
| Aggregate green hides failed child | child result remains visible and blocks declared completion policy |
| Replay causes live effect | replay projection has no actuator capability and persistent watermark |
| Secret enters immutable log | privacy/DLP decision before first durable write; transform is itself evidenced |
| Later mutation rewrites history | retain observation time and content digest; show current state separately |

## Federation and economy

| Threat/failure | Required response |
|---|---|
| Connected transport implies authority | directional grant and receiving-Harbor adjudication remain required |
| Remote assertion treated as local fact | evidence acceptance contract and observer labels |
| Revocation races with admitted effect | record all causal times/epochs; expose unresolved in-flight state |
| Buyer payment spent twice | atomic reservation and economic-authority conservation |
| Failed work erases provider costs | observed COGS settles independently from outcome |
| Publisher self-reports reputation | durable identity plus witnessed outcomes and estimator uncertainty |
| Confidential work cannot be disputed | predeclared evidence commitments and independent settlement oracle |

## Operational failures

- projection unavailable: show last known sequence/epoch and staleness; do not replace known state with a spinner;
- policy/entity store unavailable: deny or enter declared degraded mode; never claim ordinary authorization;
- cost meter unavailable: show enforcement uncertainty and follow configured stop/ceiling policy;
- conflicting receipts: open evidence conflict; do not select the favorable one;
- Harbor partition: preserve local events and divergence; do not simulate consensus;
- cancellation timeout: terminal or recovery state remains visible;
- migration partial failure: retain old authority read-only until signed new readback, or roll forward under an explicit recovery plan.

## Review completion profile

Every material proposal must mark `addressed`, `not applicable—with reason`, or `open` for: identity, authority, lifecycle, failure, timeout, cancellation, replay, delegation, revocation, concurrency, budget, privacy, provenance, migration, observability, epistemic guarantee, cross-Harbor semantics, operator override, backward compatibility, and proof.

