# Monitoring is not compulsory enforcement

A monitor can observe a transition and trigger an alert, repair, or halt; it cannot prevent a prior effect unless the protected controller consumes its decision before opening that exact effect channel. Treat “monitor rejects” as a detection claim unless the evidence shows compulsory, pre-effect mediation for every declared route.

## Evidence classes

| Class | Supports | Does not support |
|---|---|---|
| Proof | theorem under stated model | implementation or deployment |
| Finite model check | explored finite abstraction | unbounded behavior |
| Deterministic simulation | replayed schedules and injected faults | host/provider enforcement |
| LLM evaluation | sampled behavior under pinned model/tools | reliable behavior under changed incentives |
| Production witness | observed build/configuration/window | other builds, channels, or future windows |

## Adaptive evaluation

Freeze the detector build, then let the attacker know its rules. Score against a separately durable hidden-truth ledger, not the detector’s own log. Hold out attack families and report conditional false acceptance for bad artifacts, false alarms, and detection delay separately. Agreement between judges is not ground truth.

**Accessed:** 2026-09-24. Sources: NIST reference-monitor glossary (living glossary, term-level access: https://csrc.nist.gov/glossary/term/reference_monitor); NIST AI 100-2e2025 (2025, source identity only: https://doi.org/10.6028/NIST.AI.100-2e2025); Carlini et al., “On Evaluating Adversarial Robustness” (2019 paper: https://arxiv.org/abs/1902.06705); Tramer et al., “On Adaptive Attacks” (2020 paper: https://arxiv.org/abs/2002.08347); RFC 9110 §9.2.2 (2022 standard: https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2); AWS Durable Execution idempotency guidance (living documentation: https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/). These sources constrain concepts; no local controller or provider behavior was tested.
