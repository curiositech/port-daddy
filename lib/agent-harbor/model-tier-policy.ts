/**
 * Agent Harbor C2 — model-tier policy (binder ch18 Work Order C2).
 *
 * The frozen contract (agent-run.schema.json body) requires BOTH the abstract
 * tier (`fast|mid|strong|local|custom`) and the provider-specific resolved
 * model name to be visible — "Both tier and resolved name must be visible
 * (ch18 C2 gate)". This module is the single resolution point: given an
 * adapter kind, a requested tier, and an optional explicit model, it returns
 * a fully-resolved `{ modelTier, modelName, provider }` or a typed refusal.
 *
 * Concrete model IDs live ONLY in lib/model-registry-data.ts (ADR-0057);
 * this module declares INTENT — adapter kind + tier map to a registry
 * (backend, capability) pair and resolve at the last second via
 * lib/model-registry.ts. No model ID is hardcoded here.
 *
 * Skill lens `llm-router`: tiers map task classes to models (fast = classify/
 * validate/format, mid = write/implement/review, strong = reason/architect/
 * judge); `local` is the no-marginal-cost lane and `custom` is the operator
 * escape hatch — neither has a defensible default, so both require an
 * explicit model name (fail-closed, never an invisible model).
 */

import type { AdapterKind, ModelTier } from './types.js';
import { getCapabilityProfile } from './capability-matrix.js';
import { resolveModel, type Capability } from '../model-registry.js';

export interface ResolvedModel {
  modelTier: ModelTier;
  /** Provider-specific resolved model name. Never null on a successful resolution. */
  modelName: string;
  provider: string;
}

export interface ModelResolutionError {
  ok: false;
  reason: string;
  /** Which tiers this adapter can serve, for remediation copy. */
  supportedTiers: ModelTier[];
}

export type ModelResolution = ({ ok: true } & ResolvedModel) | ModelResolutionError;

/** Provider label per adapter kind (agent-run body.provider). */
export const ADAPTER_PROVIDERS: Record<AdapterKind, string> = {
  'claude-code': 'anthropic',
  'codex-cli': 'openai',
  cloudflare: 'cloudflare-workers-ai',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  'custom-stdio': 'custom',
  'custom-http': 'custom',
};

/**
 * C2 tier → registry capability (lib/model-registry-data.ts tierAliases
 * cover low/mid/high; the C2 ladder names map onto the same intent scale).
 */
export const TIER_CAPABILITY: Partial<Record<ModelTier, Capability>> = {
  fast: 'cheap',
  mid: 'balanced',
  strong: 'high',
};

/**
 * Adapter kind → model-registry backend key. Only HOSTED adapters (a fixed
 * model is always reachable) appear here. `ollama`/`lmstudio` DO have a
 * registry entry now (lib/model-registry-data.ts), but stay deliberately
 * excluded: the tag/model actually available on an operator's box varies by
 * hardware and what they've pulled/loaded, so a fixed default can silently
 * fail on a machine that doesn't have it — this is a policy choice (fail
 * toward an explicit model name), not a registry gap.
 *
 * 'claude-code' resolves through the registry's 'claude-cli' key, which is a
 * backendAlias for the canonical 'claude' family (lib/model-registry-data.ts)
 * — resolved once in resolveModel(), not re-derived here.
 */
export const ADAPTER_REGISTRY_BACKEND: Partial<Record<AdapterKind, string>> = {
  'claude-code': 'claude-cli',
  'codex-cli': 'codex',
  cloudflare: 'cloudflare',
};

/**
 * Default model for (adapter, tier), resolved from the registry at call time.
 * Returns null when no default exists (local/custom lanes) — null means the
 * caller must supply an explicit name, never that an invisible model is OK.
 */
export function defaultModelFor(kind: AdapterKind, tier: ModelTier): string | null {
  const backend = ADAPTER_REGISTRY_BACKEND[kind];
  const capability = TIER_CAPABILITY[tier];
  if (!backend || !capability) return null;
  try {
    return resolveModel({ backend, capability });
  } catch {
    return null; // unknown backend/capability in this build's registry — fail toward explicit
  }
}

/**
 * Resolve a model tier for an adapter into a concrete model name.
 * Fail-closed: an unresolvable tier is a refusal, never a null modelName —
 * a body with a tier but no resolved name violates the ch18 C2 visibility gate.
 */
export function resolveModelTier(
  kind: AdapterKind,
  tier: ModelTier,
  explicitModelName?: string | null,
): ModelResolution {
  const profile = getCapabilityProfile(kind);
  if (!profile.modelTiers.includes(tier)) {
    return {
      ok: false,
      reason: `adapter ${kind} does not serve model tier "${tier}"`,
      supportedTiers: profile.modelTiers,
    };
  }
  const provider = ADAPTER_PROVIDERS[kind];
  const explicit = explicitModelName?.trim();
  if (explicit) {
    return { ok: true, modelTier: tier, modelName: explicit, provider };
  }
  if (tier === 'local' || tier === 'custom' || profile.requiresExplicitModelName) {
    return {
      ok: false,
      reason: `tier "${tier}" on ${kind} requires an explicit model name — there is no defensible default `
        + '(ch18 C2 gate: model tier and provider-specific model name are both visible)',
      supportedTiers: profile.modelTiers,
    };
  }
  const defaulted = defaultModelFor(kind, tier);
  if (!defaulted) {
    return {
      ok: false,
      reason: `no registry default for ${kind}/${tier}; pass an explicit model name`,
      supportedTiers: profile.modelTiers,
    };
  }
  return { ok: true, modelTier: tier, modelName: defaulted, provider };
}

/** Throwing form for launch paths that must not proceed with an invisible model. */
export function requireResolvedModel(
  kind: AdapterKind,
  tier: ModelTier,
  explicitModelName?: string | null,
): ResolvedModel {
  const resolved = resolveModelTier(kind, tier, explicitModelName);
  if (!resolved.ok) throw new Error(resolved.reason);
  const { ok: _ok, ...rest } = resolved;
  return rest;
}
