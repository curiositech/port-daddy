# Proactive delegation and interruption

## Source boundary

**Primary source:** National Institute of Standards and Technology, *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*, January 2023, https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10. **Accessed:** 2026-09-24. **Access depth:** official publication landing page and framework identity; this reference applies only the framework's risk-management framing. It does not establish a platform capability, legal conclusion, local runtime result, universal metric, or approval threshold.

The workflow below is a local design procedure. A product team supplies the delegated scope, permitted action types, evaluation cohort, and opt-out route before it relies on the procedure.

```mermaid
flowchart LR
    Signal[Observed signal] --> Eligible{Eligible under declared policy?}
    Eligible -->|no| Suppress[Suppress and retain no action claim]
    Eligible -->|yes| Scope{Inside delegated scope?}
    Scope -->|no| Clarify[Ask or defer]
    Scope -->|yes| Consequence{Policy requires new approval?}
    Consequence -->|no; already authorized| Action[Notify or take permitted action]
    Consequence -->|yes| Approval[Request approval]
    Consequence -->|unknown| Defer[Resolve policy uncertainty]
    Action --> Receipt[Record decision status, basis, and opt-out]
    Approval --> Pending[Wait for a decision; no action outcome yet]
    Pending --> Receipt
```

An interruption policy needs outcome evidence, not an assumed “helpfulness” percentage. The review loop makes false positives, false negatives, interruption burden, and opt-out visible alongside benefit.

```mermaid
flowchart TD
    Policy[Declared policy and evaluation cohort] --> Observe[Observe outcomes]
    Observe --> Benefit[Benefit observations]
    Observe --> FP[False-positive or harm observations]
    Observe --> FN[Missed-opportunity observations]
    Observe --> Burden[Interruption burden and opt-outs]
    Benefit --> Review{Policy still meets declared rule?}
    FP --> Review
    FN --> Review
    Burden --> Review
    Review -->|yes| Continue[Continue with receipt]
    Review -->|no or unknown| Revise[Revise, narrow, or suspend]
    Revise --> Policy
```

## Constructed weekly scheduling assistant

For a Book-candidate specimen, a scheduling assistant may observe a calendar conflict, check a user-declared delegation rule, ask before any consequential change, and show the resulting receipt with an opt-out. Scheduling assistance has direct prior art in LookOut; see [method sources and evaluation](mixed-initiative-evaluation.md). This constructed illustration makes no efficacy or novelty claim. Any Book treatment must compare prior art and gather evaluation evidence before making broader claims.

Honor existing delegation and approvals. Consequence and reversibility inform the policy; they do not erase a valid prior authorization or require the user to approve the same action repeatedly.
