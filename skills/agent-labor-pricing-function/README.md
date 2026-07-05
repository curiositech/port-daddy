# Agent Labor Pricing Function

Design a pricing/packaging function for variable-cost agent labor that clears a real cost floor and never surprises the buyer.

Use this skill when a Port Daddy feature, tier, or the stalled Phase 2 pricing lane needs a pricing model choice, a buyer-predictable value metric, a unit-cost floor, and bill-shock guardrails before launch.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/pricing-model-decision-guide.md` to pick a model (per-seat, metered, credits, hybrid, outcome) matched to your value metric and buyer.
3. Load `references/unit-economics-and-guardrails.md` to build the cost floor and design spend caps, budget previews, and transparent metering.
4. Draft a pricing plan JSON matching `schemas/pricing-plan.schema.json`, with realistic persona usage profiles (solo founder, staff engineer, enterprise admin).
5. Run `node scripts/pricing_stress.mjs --input plan.json`.

The output reports per-persona margin and a bill-shock risk level. Fix any negative-margin persona and any missing guardrail on a usage-exposed model before treating the plan as launch-ready.
