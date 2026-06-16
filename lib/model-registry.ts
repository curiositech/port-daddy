/**
 * Declarative model registry — the ONE place that maps a (backend, capability)
 * descriptor to a concrete model ID.
 *
 * The rule (operator directive, 2026-06-15): **never hardcode a model name.**
 * Model IDs churn like secrets — a `claude-sonnet-4-6` becomes `-4-7` next month
 * and every literal scattered across the repo silently rots. So code and config
 * declare INTENT — a backend plus a capability like `cheap` / `high` /
 * `max-thinking` — and call `resolveModel()` to splice in the real ID at the last
 * second. The concrete IDs live in ONE data file, `config/model-registry.json`,
 * refreshed per version build by `scripts/refresh-model-registry.ts`.
 *
 * This module is the model analogue of `lib/llm-backend-resolver.ts` (the single
 * backend resolver): one reader, no parallel lookup paths. The
 * `no-hardcoded-model-ids` guard test allowlists only the JSON data file and the
 * cost-rate table — every other runtime site must come through here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

interface RegistryData {
  generatedAt: string;
  generatedBy: string;
  source: string;
  capabilities: Record<string, string>;
  tierAliases: Record<string, Capability>;
  backends: Record<string, Record<string, string>>;
}

let cached: RegistryData | null = null;

/** Candidate locations for config/model-registry.json across cwd shapes. */
function registryPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)); // lib/ (or dist/lib/)
  return [
    join(here, '..', 'config', 'model-registry.json'),
    join(here, '..', '..', 'config', 'model-registry.json'), // dist/ build
    join(process.cwd(), 'config', 'model-registry.json'),
  ];
}

function load(): RegistryData {
  if (cached) return cached;
  const tried: string[] = [];
  for (const p of registryPaths()) {
    try {
      const raw = readFileSync(p, 'utf8');
      cached = JSON.parse(raw) as RegistryData;
      return cached;
    } catch {
      tried.push(p);
    }
  }
  // Loud fail — never silently default a model. (ADR loud-fail invariants.)
  throw new Error(
    `model-registry: could not load config/model-registry.json (tried: ${tried.join(
      ', ',
    )}). The registry is required to resolve any model ID.`,
  );
}

/** Map a legacy model_tier (low/mid/high) to a capability. */
export function capabilityForTier(tier: string | null | undefined): Capability {
  if (!tier) return DEFAULT_CAPABILITY;
  const alias = load().tierAliases[tier.trim().toLowerCase()];
  return (alias as Capability) || DEFAULT_CAPABILITY;
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
  const table = reg.backends[opts.backend];
  if (!table) {
    throw new Error(
      `model-registry: no backend "${opts.backend}" in config/model-registry.json. ` +
        `Known backends: ${Object.keys(reg.backends).join(', ')}. ` +
        `Add it to the registry — do not hardcode a model ID at the call site.`,
    );
  }

  const capability: Capability =
    opts.capability || capabilityForTier(opts.tier);

  const id = table[capability] || table[DEFAULT_CAPABILITY];
  if (!id) {
    throw new Error(
      `model-registry: backend "${opts.backend}" has no "${capability}" (or "${DEFAULT_CAPABILITY}") ` +
        `mapping in config/model-registry.json.`,
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

/** Test-only: drop the memoized registry so a rewritten JSON is re-read. */
export function _resetRegistryCache(): void {
  cached = null;
}
