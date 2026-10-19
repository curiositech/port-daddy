# Safety case and containment

## Evidence boundary

**Primary source:** National Institute of Standards and Technology, *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*, January 2023, https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10. **Accessed:** 2026-09-24. **Access depth:** official publication landing page and framework identity. It supports a risk-management framing, not a clinical, legal, youth-safety, platform, incident, price, or local-runtime claim.

These diagrams are a local safety-case method. The deploying team declares the hazard, affected people, authority, threat model, controls, tests, evidence, owner, and residual uncertainty. A requested stop is not a verified fence; distinguish collection state, local effect admission, and in-flight/remote completion.

## Claim-to-evidence path

```mermaid
flowchart LR
    Hazard[Named hazard and affected people] --> Claim[Bounded safety claim]
    Claim --> Control[Configured control]
    Control --> Test[Threat-model test]
    Test --> Evidence[Observed evidence and read-back]
    Evidence --> Decision{Claim supported for declared scope?}
    Decision -->|yes, with limits| Operate[Operate with owner and review date]
    Decision -->|no or unknown| Revise[Revise, narrow, or suspend]
    Revise --> Hazard
```

## Sensitive escalation trace

```mermaid
sequenceDiagram
    participant Signal as Scoped signal
    participant Agent
    participant Policy
    participant Gateway as Independent effect gateway
    participant Remote as Remote service
    participant Owner as Configured owner process
    participant Receipt as Minimal receipt
    Signal->>Agent: observed within authorized input
    Agent->>Policy: classify against declared hazard and existing delegation
    alt Continue within authority
        Policy-->>Agent: continue with boundary and rationale
        Agent->>Receipt: record decision reference and scope, not payload
    else Restrict capabilities
        Policy-->>Gateway: remove named capability at admission boundary
        Gateway-->>Agent: restriction readback or partial/unknown
        Agent->>Receipt: record exact restriction and readback
    else Stop selected
        Policy-->>Gateway: request idempotent fence
        Gateway-->>Agent: requested is not yet verified
        opt In-flight remote work exists
            Agent->>Remote: query or cancel by operation ID when supported
            Remote-->>Agent: completed, cancelled, or unknown
        end
        Gateway-->>Agent: independent readback of in-scope admission fence
        Agent->>Owner: route if declared policy requires
        Agent->>Receipt: record requested/fencing/verified/unknown states
    end
```

The route is an operational design example, not a clinical assessment or a guarantee that escalation will resolve an outcome. A policy decision to continue does not trigger a fence. Restriction/stop claims require independent readback at the specific effect boundary; remote in-flight completion may remain unknown. A Book candidate may use this trace to show a safety case in action, provided Book review compares prior art and avoids novelty or efficacy claims.


## Safe restart after containment

A verified local admission fence says only that the tested boundary denied new in-scope effects at readback time. It does not settle remote calls, queued work, or deletion of derived data. Resolve those by stable operation/artifact identifiers before restart; unresolved cases remain partial/unknown.

```mermaid
flowchart TD
    Contained[Effect fence verified for declared scope] --> Inventory[Enumerate outstanding operations and declared copies]
    Inventory --> Outcome{Every relevant outcome resolved?}
    Outcome -->|no or unknown| Partial[Remain stopped; status partial or unknown]
    Partial --> Reconcile[Query/cancel by identity; do not assume non-execution]
    Reconcile --> Inventory
    Outcome -->|yes| Authority{Fresh authority and scope review succeeds?}
    Authority -->|no| Fenced[Remain fenced; owner review]
    Authority -->|yes| Readback{Fence and policy readback still current?}
    Readback -->|no or unknown| Partial
    Readback -->|yes| Resume[Resume only the authorized capabilities]
```
