# Responsible Logging — Changelog

## v1.0.0 (2026-07-20)

- Initial skill: responsible logging for long-lived services/daemons.
- Core process: audit → reach for a primitive → stable governor key → rotation +
  captured-stdout trap → correlation ids + fail-safe.
- Cardinal anti-pattern documented (error-log-in-unthrottled-loop) with the 313 GB
  Port Daddy case study and the narrow-patch-recurrence lesson.
- Second anti-pattern: trusting the in-process logger to bound ALL output (captured-stdout
  trap).
- `scripts/audit_logging.py`: stdlib-only auditor ranking CARDINAL/HIGH/MEDIUM findings with
  CI-friendly exit codes.
- References: case study, stack-agnostic governor primitive, rotation/capture traps,
  multi-tenant correlation + fail-safe observability.
