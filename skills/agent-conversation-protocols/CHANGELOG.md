# Changelog

## [2.0.1] - 2026-09-17

### Fixed

- Require every declared gather to satisfy its `ALL`, `QUORUM`, or
  `FIRST_SUCCESS` contribution threshold before a trace may be `COMPLETED`.

## [2.0.0] - 2026-09-16

### Changed

- Replaced generic conversation-pattern advice with a closed, ordered, replay-safe trace contract.
- Removed runtime topology, delegation, spawning, framework, and confidence-threshold prescriptions.
- Added audience/scope binding, epoch and body-generation checks, per-sender sequencing, fixed gathers, terminal fences, and acknowledgement semantics.
- Added executable semantic validation and an adversarial mutation bundle.

### Removed

- Manager, voting, and consensus language that could be mistaken for truth or execution authority.
- Unbounded conversation loops and dynamic topology changes.
- Broad Write, Bash, and network tool access.
