/**
 * Declarative model registry — the ONE place that maps a (backend, capability)
 * descriptor to a concrete model ID.
 *
 * The rule (operator directive, 2026-06-15): **never hardcode a model name.**
 * Model IDs churn like secrets — a `claude-sonnet-4-6` becomes `-4-7` next month
 * and every literal scattered across the repo silently rots. So code and config
 * declare INTENT — a backend plus a capability like `cheap` / `high` /
 * `max-thinking` — and call `resolveModel()` to splice in the real ID at the last
 * second. The concrete IDs live in ONE data file, `lib/model-registry-data.ts`,
 * generated from `config/models.yaml` by `scripts/generate-model-registry.ts`
 * (which also carries the live phantom-id probe: `--probe`).
 *
 * This module is the model analogue of `lib/llm-backend-resolver.ts` (the single
 * backend resolver): one reader, no parallel lookup paths. The
 * `no-hardcoded-model-ids` guard test allowlists only the data module and the
 * cost-rate table — every other runtime site must come through here.
 */

import { MODEL_REGISTRY_DATA, type ModelRegistryData } from './model-registry-data.js';

export type Capability = 'cheap' | 'balanced' | 'high' | 'max-thinking' | 'code';

export const CAPABILITIES: readonly Capability[] = [
  'cheap',
  'balanced',
  'high',
  'max-thinking',
  'code',
] as const;

/** The default capability when a caller declares a backend but no capability. */
export const DEFAULT_CAPABILITY: Capability = 'cheap';

// The registry data is a TS module resolved through the import graph — no
// runtime file read, so it loads identically under bun, @swc/jest, tsc, and
// the dist build. `_resetRegistryCache` exists only for the test API.
let cached: ModelRegistryData | null = null;

function load(): ModelRegistryData {
  if (cached) return cached;
  cached = MODEL_REGISTRY_DATA;
  return cached;
}

/** Map a legacy model_tier (low/mid/high) to a capability. */
export function capabilityForTier(tier: string | null | undefined): Capability {
  if (!tier) return DEFAULT_CAPABILITY;
  const alias = load().tierAliases[tier.trim().toLowerCase()];
  return (alias as Capability) || DEFAULT_CAPABILITY;
}

/**
 * Resolve a backend alias (`anthropic`, `claude-cli`, …) to its canonical
 * family key (`claude`) via `backendAliases`. Unaliased backends pass
 * through unchanged. This is the ONE place backend-name aliasing happens —
 * every caller (registry lookups, the Rust console's generated tier table,
 * agent-harbor's tier policy) goes through here rather than re-deriving its
 * own claude/anthropic/claude-cli equivalence.
 */
export function canonicalBackend(backend: string): string {
  const reg = load();
  return reg.backendAliases[backend] || backend;
}

export interface ResolveModelOptions {
  /** The backend/provider key, e.g. 'anthropic' | 'claude-cli' | 'cloudflare'. */
  backend: string;
  /** The declarative capability. Mutually informative with `tier`. */
  capability?: Capability;
  /** Legacy model_tier (low/mid/high) — mapped to a capability if `capability` is unset. */
  tier?: string | null;
  /**
   * An explicit operator-supplied model ID. If a real human/operator pinned a
   * specific model, honor it — the registry governs DEFAULTS, not overrides.
   * Backend-name placeholders (e.g. the literal 'claude-code') are ignored.
   */
  explicit?: string | null;
}

const BACKEND_NAME_PLACEHOLDERS = new Set([
  'claude-code',
  'claude-cli',
  'codex',
  'agy',
  'agy-cli',
  'gemini',
  'groq',
  'grok',
  'cloudflare',
  'aider',
  'custom',
]);

/**
 * Resolve a concrete model ID from declarative intent.
 *
 * Precedence: a real `explicit` override wins; otherwise (backend, capability)
 * — or (backend, tier→capability) — is looked up in the registry. Unknown
 * backend or unmapped capability fail loudly rather than guessing.
 */
export function resolveModel(opts: ResolveModelOptions): string {
  const explicit = opts.explicit?.trim();
  if (explicit && !BACKEND_NAME_PLACEHOLDERS.has(explicit)) {
    return explicit;
  }

  const reg = load();
  const table = reg.backends[canonicalBackend(opts.backend)];
  if (!table) {
    throw new Error(
      `model-registry: no backend "${opts.backend}" in lib/model-registry-data.ts. ` +
        `Known backends: ${Object.keys(reg.backends).join(', ')} ` +
        `(plus aliases: ${Object.keys(reg.backendAliases).join(', ')}). ` +
        `Add it to the registry — do not hardcode a model ID at the call site.`,
    );
  }

  const capability: Capability =
    opts.capability || capabilityForTier(opts.tier);

  const id = table[capability] || table[DEFAULT_CAPABILITY];
  if (!id) {
    throw new Error(
      `model-registry: backend "${opts.backend}" has no "${capability}" (or "${DEFAULT_CAPABILITY}") ` +
        `mapping in lib/model-registry-data.ts.`,
    );
  }
  return id;
}

/** Provenance for diagnostics / `pd doctor` ("registry seeded 2026-06-15 from …"). */
export function registryProvenance(): { generatedAt: string; generatedBy: string; source: string } {
  const reg = load();
  return {
    generatedAt: reg.generatedAt,
    generatedBy: reg.generatedBy,
    source: reg.source,
  };
}

/** Every concrete model ID the registry currently maps to (for cost-rate coverage checks). */
export function allRegisteredModelIds(): string[] {
  const reg = load();
  const ids = new Set<string>();
  for (const table of Object.values(reg.backends)) {
    for (const id of Object.values(table)) ids.add(id);
  }
  return [...ids];
}

/** Test-only: drop the memoized registry so a rewritten data module is re-read. */
export function _resetRegistryCache(): void {
  cached = null;
}
