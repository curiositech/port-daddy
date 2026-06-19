# Scripts — Federated Harbor (author side)

Runnable helpers for an authoring round.

- `new-round.sh`: scaffold a new authoring round (directories + probe stub) so a
  drafter can start against the current topic map.
- `voice-check.sh`: run a draft through the registered voice check before it is
  proposed.
- `probe-template.json`: JSON Schema for an author-side claim probe; copied by
  `new-round.sh` and validated by the round tooling.
