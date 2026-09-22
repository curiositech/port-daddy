# Changelog

## 1.0.1 — 2026-09-17

- Bind every closed effect receipt to the declared effect-boundary principal.
- Reject effect-level handoffs under `NO_SETTLEMENT`, even when settlement metadata itself is empty.
- Add wrong-authority and forbidden-handoff adversarial mutations.

## 1.0.0 — 2026-09-16

- Establish native-vector conservation across reservation, admission, effects, and settlement handoff.
- Separate scheduler, capacity broker, admission writer, effect boundary, and settlement authority.
- Make ambiguity holds, stop reserves, no-settlement profiles, and compensation-as-new-effect explicit.
- Add a closed schema, semantic validator, executable example, activation corpus, and adversarial test bundle.
