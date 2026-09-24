# Agent Labor Pricing Function

An offline method bundle for designing a variable-cost agent-labor price with a buyer-visible unit, a separate cost floor, guardrails, and deterministic persona stress checks.

## Quick start

1. Read `SKILL.md`, then `references/pricing-model-decision-guide.md`.
2. Fill a plan matching `schemas/pricing-plan.schema.json` and retain the detailed cost ledger that supports its summary fields.
3. Run `node scripts/pricing_stress.mjs --input plan.json --status`.
4. Default and `--status` modes are report-only and exit 0 for a well-formed pass or block. Add `--strict` in a review gate: a blocked report returns status 2; malformed input returns 1.
5. Use `templates/output-template.md` to separate planning assumptions from measured or live evidence.

The bundle does not bill users, invoke providers, or prove live guardrail enforcement.

Run the portable regression suite with `node --test tests/pricing_stress.test.mjs`.
