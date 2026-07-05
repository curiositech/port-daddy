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
 * Skill lens `llm-router`: tiers map task classes to models (fast = classify/
 * validate/format, mid = write/implement/review, strong = reason/architect/
 * judge); `local` is the no-marginal-cost lane and `custom` is the operator
 * escape hatch. Default names below are asserted by test against
 * lib/backend-catalog.ts entries so the two sources cannot drift.
 */

import type { AdapterKind, ModelTier } from './types.js';
import { getCapabilityProfile } from './capability-matrix.js';

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
 * Default tier→model names. Kept aligned with lib/backend-catalog.ts models
 * lists (the drift tripwire test asserts membership). local/custom tiers have
 * no defensible default — the operator's model IS the configuration — so they
 * are absent here and require an explicit name.
 */
export const DEFAULT_TIER_MODELS: Partial<Record<AdapterKind, Partial<Record<ModelTier, string>>>> = {
  'claude-code': {
    fast: 'claude-haiku-4-5',
    mid: 'claude-sonnet-4-6',
    strong: 'claude-opus-4-8',
  },
  'codex-cli': {
    fast: 'gpt-5.4-mini',
    mid: 'gpt-5.3-codex',
    strong: 'gpt-5.4',
  },
  cloudflare: {
    fast: '@cf/meta/llama-4-scout-17b-16e-instruct',
    mid: '@cf/qwen/qwen3-30b-a3b-fp8',
    strong: '@cf/openai/gpt-oss-120b',
  },
};

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
  const defaulted = DEFAULT_TIER_MODELS[kind]?.[tier];
  if (!defaulted) {
    return {
      ok: false,
      reason: `no default model registered for ${kind}/${tier}; pass an explicit model name`,
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
