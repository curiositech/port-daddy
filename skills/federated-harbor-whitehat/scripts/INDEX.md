# Scripts — Federated Harbor (whitehat / defense side)

Runnable helpers for a whitehat round.

- `env.sh`: shared environment/setup sourced by the other whitehat scripts.
- `new-round.sh`: scaffold a new whitehat round (directories + defense stub).
- `run-fh-whitehats.sh`: drive the whitehat defense agents over a round's claims.
- `run-fh-secops-lead.sh`: run the secops lead to coordinate the round.
- `defense-template.json`: JSON Schema for a whitehat defense record; copied by
  `new-round.sh`.
