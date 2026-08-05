# 0061. Prefetch the local embedding model on first install

## Status

Accepted

## Context

Port Daddy's semantic resolver (`lib/semantic-resolver.ts`) and the LLM semantic
response cache (ADR-0059) run on a **local** embedding model —
`Xenova/all-MiniLM-L6-v2` (~27 MB) via transformers.js — loaded **lazily** on first
use. Two problems followed from "lazy + cwd-relative":

1. **First-use stall / offline failure.** The first semantic operation blocks on a
   network download; if the box is offline at that moment, it stalls the semantic
   queue. The model was never fetched at a controlled time.
2. **Inconsistent cache dirs.** `createSemanticResolver` defaulted to
   `process.cwd()/.cache/transformers`, `server.ts` overrode to
   `REPO_ROOT/.cache/transformers`, and `lib/shipwright/skill-index.ts` used the
   stable `~/.port-daddy/transformers-cache`. `process.cwd()` is unstable for the
   launchd daemon, so a model fetched by one path wasn't found by another — and an
   install-time prefetch would have nowhere reliable to put it.

The operator's directive: *"make sure that the first install of port-daddy
downloads that mini-LM embedding model if it's not present."*

## Decision

**Unify on one stable cache dir and pre-download the model at install time.**

- **`defaultTransformersCacheDir()`** (exported from `lib/semantic-resolver.ts`) is
  the single source of truth: `~/.port-daddy/transformers-cache`
  (overridable via `PD_TRANSFORMERS_CACHE_DIR`). The resolver default and
  `server.ts` now both use it; the shipwright index already used the equivalent
  path. Prefetch writes here, runtime reads here, regardless of cwd / launchd /
  worktree.
- **`scripts/prefetch-embedding-model.ts`** downloads the model into that dir.
  **Idempotent** — skips instantly if the model dir is already populated.
  **Best-effort** — an offline install warns and exits 0; it never fails the
  install, and the runtime still lazily fetches on first use when a network is
  available.
- **`cli/commands/setup.ts`** runs the prefetch as a step in `pd setup` (after the
  daemon step), opt-out via `--no-prefetch`.
- **`pd setup`** offers the one-time prefetch and **`pd doctor`** detects a
  missing model. Homebrew remains an artifact and service installer; it does
  not carry a second in-repository formula or silently own model policy.

## Consequences

- **Positive.** Semantic operations are offline-first after install; no first-use
  stall. One cache dir means no "fetched here, looked there" misses. The prefetch is
  safe to run on every `pd setup` / brew upgrade (idempotent) and never breaks an
  offline install (best-effort).
- **Cost.** ~27 MB downloaded once on first install. Negligible disk; one-time.
- **Migration.** Existing installs that cached under `cwd/.cache` or
  `REPO_ROOT/.cache` will re-download once into `~/.port-daddy/transformers-cache`.
  One-time, 27 MB.
- **Reversible.** `--no-prefetch` (setup) / `PD_TRANSFORMERS_CACHE_DIR` (location).

## Related

- ADR-0059 — the LLM semantic cache that this guarantees a model for.
- `lib/semantic-resolver.ts` — `createLocalEmbedder` / `createSemanticResolver`, the
  runtime readers of this cache dir.
- Operator directive 2026-06-16.
