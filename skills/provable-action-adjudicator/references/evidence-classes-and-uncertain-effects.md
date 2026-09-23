# Evidence classes and uncertain effects

Pre-effect adjudication needs two independent claims: the policy verdict is correct for a proposal, and every in-scope effect route is compelled to redeem that permit first. A monitor or post-hoc reconciler supports detection, not compulsory prevention.

For a lost acknowledgement, write `AMBIGUOUS`, fence the old generation, and reconcile with the target before retry. A stable idempotency key only helps when the target binds it to the same payload and authority-relevant request. Never infer “not applied” from a timeout.

Safety claims (no unauthorized/duplicate effect) and liveness claims (eventual reconciliation/recovery) require separate properties and assumptions.

Accessed 2026-09-23. Sources: NIST reference-monitor glossary (https://csrc.nist.gov/glossary/term/reference_monitor); NIST AI 100-2e2025 (https://doi.org/10.6028/NIST.AI.100-2e2025); Carlini et al., “On Evaluating Adversarial Robustness” (https://arxiv.org/abs/1902.06705); Tramer et al., “On Adaptive Attacks” (https://arxiv.org/abs/2002.08347); RFC 9110 §9.2.2 (https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2); AWS Durable Execution idempotency guidance (https://docs.aws.amazon.com/durable-execution/patterns/best-practices/idempotency/).
