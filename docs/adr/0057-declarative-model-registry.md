# 0057. The declarative model registry — model names are resolved, never hardcoded

## Status

Accepted

## Context

Model IDs churn faster than almost anything else in the codebase. `claude-sonnet-4-5`
becomes `-4-6` becomes `-4-7`; `gpt-5-mini` gets a successor; a Cloudflare model is
renamed or retired. Each churn is a silent landmine: a literal `'claude-sonnet-4-6'`
buried in `pd-fleet.yml`, a `DEFAULT_OPERATOR_*` constant, a tier map in
`lib/fleet-engine.ts`, a fallback in a route — and when the ID moves, the literal
rots. The cost is real and recent: a survey on 2026-06-15 found model IDs hardcoded
across **135 files**, with the runtime default-resolution surface scattered over a
dozen of them (`lib/fleet-engine.ts` `BUILTIN_MODEL_TIERS`, `lib/spawner.ts`
`DEFAULT_MODELS`, `lib/backend-telemetry-policy.ts` `DEFAULT_OPERATOR_*`, plus route
defaults), each an independent copy of "what model does `cheap`/`high` mean."

The operator named the principle directly: *"WE SHOULD ALMOST NEVER HARD-CODE MODEL
NAMES. Model names must be mapped in last second, like secrets … describe it
declaratively ('cloudflare, cheap', 'claude-cli, high-end, max thinking'), then a
config dictionary is consulted with the latest information (populated every version
build) and spliced in."*

This is the same shape as two existing single-resolver patterns the repo already
trusts: secrets (kept in the keychain, read at the last second, never inlined) and
the **backend resolver** (`lib/llm-backend-resolver.ts` — the one place that reads
`PD_*_BACKEND`, per operator memory `feedback_single_llm_backend_resolver`). Model
IDs deserve the same: one reader, no parallel lookup paths, resolved late.

## Decision

**Introduce a declarative model registry. Code and config declare INTENT — a
`(backend, capability)` pair — and resolve the concrete ID at the last second
through one resolver.**

Three pieces:

1. **`lib/model-registry-data.ts`** — the single data file mapping
   `backend → capability → concrete model ID`. Capabilities are a small fixed
   vocabulary: `cheap`, `balanced`, `high`, `max-thinking`, `code`. The file carries
   provenance (`generatedAt`, `source`) so a stale registry is visible. It is the
   *only* place a concrete model ID legitimately lives, alongside the cost-rate
   table and provider validation lists.

2. **`lib/model-registry.ts`** — the resolver. `resolveModel({ backend, capability })`
   (or a legacy `tier` of low/mid/high, aliased to cheap/balanced/high) reads the
   JSON and returns the ID. A real operator-supplied `explicit` model overrides the
   default; a bare backend-name placeholder (`'claude-code'`) does not. Unknown
   backend or unmapped capability **fail loudly** — never a silent guessed model
   (ADR-0045 loud-fail invariants).

3. **`scripts/refresh-model-registry.ts`** — the per-build populator. It queries
   provider `/models` endpoints (Anthropic, OpenAI) where a key is available, ranks
   them into the capability tiers, and rewrites the data module with a fresh `generatedAt`.
   Where a provider can't be auto-queried it preserves the prior values and reports
   what needs manual review. This is the "refreshed every version build" half of the
   directive — the registry is kept current out-of-band, like rotating a secret.

**A CI guard makes regression impossible.** `tests/unit/no-hardcoded-model-ids.test.js`
fails on any literal model ID under `lib/ routes/ cli/ mcp/`, outside an explicit
allowlist of genuine ID-enumeration surfaces (the pricing table, the backend
catalog, the per-model context-window table, the benchmark suite, provider
supported-model validation lists). The allowlist is the *visible* exception set —
each entry carries a one-line reason and new entries need reviewer sign-off — not a
silent escape hatch. The guard caught a real stray default (`routes/test-hooks.ts`)
on its first run.

### What changed at the call sites

- `lib/backend-telemetry-policy.ts` — the six `DEFAULT_OPERATOR_*` constants now
  resolve from the registry's `cheap` tier. The exported names stay stable for
  importers; the IDs move into the data module. Behavior is byte-identical (cheap == the
  prior operator defaults).
- `lib/fleet-engine.ts` — `BUILTIN_MODEL_TIERS` is derived from the registry for the
  API-backed backends (claude, codex, gemini, openai, groq, cloudflare, aider). Only
  genuinely-special forms stay literal: `claude-cli`'s short CLI aliases
  (`--model sonnet`), `ollama`'s local model names, and `custom`'s placeholders —
  none of which are churning API IDs.
- `lib/spawner.ts` `DEFAULT_MODELS` and `routes/test-hooks.ts` — default model picks
  now call `resolveModel`.

### Reconciliation note

`DEFAULT_OPERATOR_*` and `fleet-engine`'s tier map disagreed for a few backends
(e.g. gemini `low` was `flash-lite` in one and `flash` in the other; openai `low`
was `nano` vs `mini`). Unifying to one registry is the whole point, so the `cheap`
tier adopts the operator-blessed default for those backends — a small, documented
consolidation, not a silent change. Every registry ID is prefix-priced in
`lib/cost-tracker.ts`, so the fail-closed telemetry policy still admits every
resolved model.

## Consequences

- **Positive.** One place to change a model ID. A model rename is a one-line data-module
  edit (or an automatic refresh), not a 135-file sweep. New code physically cannot
  hardcode an ID without tripping CI. Capability descriptors (`cheap`/`max-thinking`)
  are more honest intent than a version-stamped string a reader can't evaluate.
- **Negative / cost.** One more indirection: a reader must open the registry to see
  which concrete model `cheap` resolves to. Mitigated by `registryProvenance()`
  (surfaced in diagnostics) and the small fixed capability vocabulary.
- **Follow-up.** `pd-fleet.yml` fallback entries and `lib/shipwright/archetypes.ts`
  `backendDefault` slugs still embed IDs; converting them to `capability:` descriptors
  needs a fleet-schema field and is tracked (allowlisted, not silently exempt).

## Related

- `lib/llm-backend-resolver.ts` — the sibling single backend resolver this mirrors.
- ADR-0045 — loud-fail invariants (the registry never silently defaults a model).
- Operator memory: `feedback_single_llm_backend_resolver`,
  `feedback_mechanical_work_use_haiku_or_sed`.
