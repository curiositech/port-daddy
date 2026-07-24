import { DEFAULT_OPERATOR_CLAUDE_MODEL, DEFAULT_OPERATOR_CODEX_MODEL } from './backend-telemetry-policy.js';
import { resolveModel } from './model-registry.js';
import { resolveRawBackendName } from './llm-backend-resolver.js';

export interface FleetRuntimeDefaults {
  backend?: string;
  model?: string;
}

export type FleetModelTier = 'low' | 'mid' | 'high';

export interface FleetRuntimeTarget {
  backend?: string;
  model?: string;
  modelTier?: FleetModelTier;
}

export interface ResolvedFleetAgentRuntime {
  backend: string | null;
  model?: string;
  modelTier?: FleetModelTier;
  backendSource: 'agent' | 'env' | 'missing';
  modelSource: 'agent' | 'tier' | 'env' | 'unset';
  warnings: string[];
}

const MODEL_TIERS = new Set<FleetModelTier>(['low', 'mid', 'high']);

// API-backed (and now local-tag-backed) backends derive their low/mid/high
// tiers from the declarative registry (lib/model-registry-data.ts) via
// resolveModel. The map shape is preserved for back-compat with
// routes/fleet.ts importers. `ollama` moved here from SPECIAL_FORM_MODEL_TIERS
// (ADR-0057 model-abstraction unification) — its tag names aren't API ids,
// but they had THREE independently hand-picked defaults across this file,
// lib/spawner.ts, and lib/llm-backend-resolver.ts before the registry grew
// an `ollama` table; one source now, same as every other backend. `deepseek`,
// `xai`, and `lmstudio` are added here too — they already had (or, for
// lmstudio, now have) a registry table but were silently absent from fleet
// tier resolution: a fleet agent declaring `backend: deepseek, modelTier:
// high` used to resolve to nothing (a warning, no model) even though the
// registry has always known deepseek's tiers.
const REGISTRY_TIER_BACKENDS = ['claude', 'codex', 'gemini', 'openai', 'groq', 'cloudflare', 'aider', 'ollama', 'deepseek', 'xai', 'lmstudio'] as const;

// Genuinely-special forms the registry does NOT govern: claude-cli takes the
// CLI's short aliases (`--model sonnet`), custom is a placeholder triple.
// These are stable CLI/local identifiers, not churning API model IDs, so
// they stay literal.
const SPECIAL_FORM_MODEL_TIERS: Record<string, Record<FleetModelTier, string>> = {
  'claude-cli': { low: 'haiku', mid: 'sonnet', high: 'opus' },
  custom: { low: 'custom-low', mid: 'custom-mid', high: 'custom-high' },
};

function tierMapFromRegistry(backend: string): Record<FleetModelTier, string> {
  return {
    low: resolveModel({ backend, tier: 'low' }),
    mid: resolveModel({ backend, tier: 'mid' }),
    high: resolveModel({ backend, tier: 'high' }),
  };
}

export const BUILTIN_MODEL_TIERS: Partial<Record<string, Record<FleetModelTier, string>>> = {
  ...Object.fromEntries(REGISTRY_TIER_BACKENDS.map((backend) => [backend, tierMapFromRegistry(backend)])),
  ...SPECIAL_FORM_MODEL_TIERS,
};

export function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseModelTier(value: string | undefined): FleetModelTier | undefined {
  const normalized = cleanEnvValue(value)?.toLowerCase() as FleetModelTier | undefined;
  return normalized && MODEL_TIERS.has(normalized) ? normalized : undefined;
}

export function parseYamlModelTier(value: { model_tier?: string; modelTier?: string } | undefined): FleetModelTier | undefined {
  return parseModelTier(value?.model_tier) || parseModelTier(value?.modelTier);
}

function normalizeBackendEnvKey(backend: string): string {
  return backend.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

function resolveTierModel(backend: string, modelTier: FleetModelTier): string | undefined {
  const envKey = `PD_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${modelTier.toUpperCase()}`;
  const legacyEnvKey = `PORT_DADDY_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${modelTier.toUpperCase()}`;
  return cleanEnvValue(process.env[envKey])
    || cleanEnvValue(process.env[legacyEnvKey])
    || BUILTIN_MODEL_TIERS[backend]?.[modelTier];
}

export function getFleetRuntimeDefaults(): FleetRuntimeDefaults {
  // Backend name comes from the unified resolver in lib/llm-backend-resolver.ts
  // — same env cascade every actor uses. Spawn-shape needs the raw form so it
  // can distinguish "claude" (SDK) from "claude-cli" (CLI subprocess).
  const { raw } = resolveRawBackendName();
  return {
    backend: raw ?? undefined,
    model: cleanEnvValue(process.env.PD_FLEET_DEFAULT_MODEL)
      || cleanEnvValue(process.env.PORT_DADDY_FLEET_DEFAULT_MODEL),
  };
}

export function resolveFleetAgentRuntime(agent: FleetRuntimeTarget): ResolvedFleetAgentRuntime {
  const defaults = getFleetRuntimeDefaults();
  const explicitBackend = cleanEnvValue(agent.backend);
  const explicitModel = cleanEnvValue(agent.model);
  const explicitModelTier = parseModelTier(agent.modelTier);
  const backend = explicitBackend || defaults.backend || null;
  const tierModel = backend && explicitModelTier ? resolveTierModel(backend, explicitModelTier) : undefined;
  let model = explicitModel || tierModel || defaults.model;

  // A local-CLI backend with no real model resolves its model to the backend's
  // own bare name ("cli:claude-code" -> "claude-code"). That placeholder has
  // no cost-rate entry, so pricing falls back to an estimate and the exact-
  // telemetry gate blocks the launch. Substitute the rate-backed operator
  // default so CLI invocation and cost calculation agree on a real model.
  const CLI_MODEL_PLACEHOLDERS = new Set(['claude-code', 'codex', 'agy', 'agy-cli', 'agy-default', 'gemini', 'groq', 'grok']);
  if (backend && (!model || CLI_MODEL_PLACEHOLDERS.has(model))) {
    if (backend === 'cli:claude-code' || backend === 'claude-cli' || backend === 'claude') {
      model = DEFAULT_OPERATOR_CLAUDE_MODEL;
    } else if (backend === 'cli:codex' || backend === 'codex') {
      model = DEFAULT_OPERATOR_CODEX_MODEL;
    } else if (backend.startsWith('cli:')) {
      model = undefined;
    }
  }

  const warnings: string[] = [];

  if (!backend) {
    warnings.push('missing backend; set agent.backend or PD_FLEET_DEFAULT_BACKEND');
  }
  if (backend && explicitModelTier && !tierModel) {
    warnings.push(`no model mapping for ${backend}/${explicitModelTier}; set model explicitly or define PD_MODEL_TIER_${normalizeBackendEnvKey(backend)}_${explicitModelTier.toUpperCase()}`);
  } else if (backend === 'claude-cli' && !model) {
    warnings.push('model not pinned; claude-cli will use its local default');
  }

  return {
    backend,
    model,
    modelTier: explicitModelTier,
    backendSource: explicitBackend ? 'agent' : defaults.backend ? 'env' : 'missing',
    modelSource: explicitModel ? 'agent' : tierModel ? 'tier' : defaults.model ? 'env' : 'unset',
    warnings,
  };
}
