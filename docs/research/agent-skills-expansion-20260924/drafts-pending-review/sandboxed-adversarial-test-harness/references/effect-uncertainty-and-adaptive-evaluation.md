# Uncertain effect matrix

| Fault boundary | Local record | Independent target truth | Required disposition |
|---|---|---|---|
| before send | no intent | absent | safe retry only if key is stable |
| after send, before reply | intent exists | unknown | HOLD; query/deduplicate, never blind retry |
| after remote commit, before local receipt | intent exists | committed | reconcile receipt, no repeat |
| after reply, before durable receipt | response volatile | unknown until query | HOLD and reconcile |

For idempotent effects, bind a stable operation key to payload and authority digest, and prove the target deduplicates it. For non-idempotent effects, use at-most-once/no-retry or a compensating action with new authority; compensation is not prevention.

Adaptive tests must use a hidden independently durable truth ledger and attacker-aware detector rules. Separate safety (no unauthorized/duplicate effect or conservation breach) from liveness (eventual settlement/recovery under stated fairness).

Accessed 2026-09-23. Sources: NIST reference-monitor glossary (https://csrc.nist.gov/glossary/term/reference_monitor); NIST AI 100-2e2025 (https://doi.org/10.6028/NIST.AI.100-2e2025); Carlini et al., “On Evaluating Adversarial Robustness” (https://arxiv.org/abs/1902.06705); Tramer et al., “On Adaptive Attacks” (https://arxiv.org/abs/2002.08347); RFC 9110 §9.2.2 (https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2); AWS Durable Execution idempotency guidance (https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/).
