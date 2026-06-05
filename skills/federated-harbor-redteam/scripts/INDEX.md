# Scripts — Federated Harbor (red-team side)

Runnable helpers for a red-team round.

- `env.sh`: shared environment/setup sourced by the other red-team scripts.
- `new-round.sh`: scaffold a new red-team round (directories + probe stub).
- `run-fh-redteam.sh`: drive the red-team agents over a round's probes.
- `verify-probe.sh`: validate a probe against the schema before it is filed.
- `probe-template.json`: JSON Schema for a red-team probe; copied by
  `new-round.sh` and checked by `verify-probe.sh`.
