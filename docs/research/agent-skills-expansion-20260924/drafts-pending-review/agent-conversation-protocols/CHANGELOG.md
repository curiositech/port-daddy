# Changelog

## [2.0.2] - 2026-09-21

### Fixed

- Enforce closed gather `policy` (`ALL`, `QUORUM`, `FIRST_SUCCESS`) and `reducer` vocabulary in `validateTrace`.
- Reject unsupported policies like `ANY` with `E_GATHER_POLICY` and add adversarial mutation test case.

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

## [2.0.3-draft] - 2026-09-24

### Added

- Source-bound FIPA/A2A/MCP adaptation reference and two Mermaid diagrams.
- Explicit statement that the schema is a local offline contract, not wire or effect conformance.

## [2.0.4-draft] - 2026-09-24

### Fixed

- Made validator shape checks total and added required/type/date/enum validation across the declared schema.
- Rejected self/forward causation, late gather contributions, completed traces with unresolved participants, and invalid acknowledgement declarations.
- Bound message audience labels to recipient-declared labels and rejected duplicate message IDs.

### Clarified

- Documented that digest strings are format-checked inputs only, and that canonical replay, transport deduplication/equivocation, receipt cryptography, reducers, delivery, and external effects are outside offline validator coverage.
