# Severity Rubric

Use this when classifying product-review findings.

| Severity | Meaning | Examples |
| --- | --- | --- |
| `must-fix-before-build` | Blocks a new user, creates trust risk, or invalidates architecture. | No account path, no provider fallback, secrets unclear, agent can mutate without approval. |
| `can-build-with-risk` | Build can start, but the risk must be tracked and owned. | Pricing copy incomplete, support workflow manual, telemetry dashboard deferred. |
| `watch-after-launch` | Acceptable for MVP if explicitly monitored. | Edge-case import failure, nice-to-have onboarding copy, secondary persona unsupported. |

## Escalation Rules

- Missing account path is always at least `can-build-with-risk`; it is `must-fix-before-build` if saved work, billing, teams, or audit logs exist.
- Missing provider fallback is `must-fix-before-build` for AI-first products.
- Missing rollback or approval is `must-fix-before-build` for agent write actions.
- Missing support path is `can-build-with-risk` unless failures can destroy user work, then it is `must-fix-before-build`.
