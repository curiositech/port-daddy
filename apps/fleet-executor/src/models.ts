/**
 * Cloudflare Workers AI tier → model resolution for the cloud fleet.
 *
 * Ships in pd-fleet.yml declare a PROVIDER + POWER TIER, never a concrete model
 * id (operator directive 2026-07-06). The daemon resolves those tiers through
 * the single ground-truth registry (lib/model-registry-data.ts). A Cloudflare
 * Worker cannot import that Node-only module, so this is a deliberate, DOCUMENTED
 * MIRROR of the registry's `cloudflare` rows — the only Workers AI ids the
 * executor needs.
 *
 * KEEP IN SYNC with lib/model-registry-data.ts `backends.cloudflare`. The
 * drift-guard test tests/unit/fleet-ship-definitions.test.js ("cloud executor
 * cloudflare tier mirror matches the registry") fails CI if this map and the
 * registry disagree, so a stale mirror cannot silently ship a phantom model id
 * (the failure mode that killed the fleet on 2026-07-03, when every ship
 * pinned a non-existent `@cf/...` id and `ai.run()` hung forever).
 */

/** Mirror of lib/model-registry-data.ts `backends.cloudflare` (capability → id). */
export const CLOUDFLARE_TIER_MODELS: Record<string, string> = {
  cheap: '@cf/zai-org/glm-4.7-flash',
  balanced: '@cf/openai/gpt-oss-120b',
  high: '@cf/moonshotai/kimi-k2-instruct',
  'max-thinking': '@cf/moonshotai/kimi-k2-instruct',
  code: '@cf/qwen/qwen3-30b-a3b-fp8',
};

/** Legacy fleet tier → registry capability (mirror of registry `tierAliases`). */
const TIER_ALIASES: Record<string, string> = {
  low: 'cheap',
  mid: 'balanced',
  high: 'high',
};

/**
 * Resolve a fleet power tier (legacy `low|mid|high` or a registry capability
 * `cheap|balanced|high|max-thinking|code`) to a Cloudflare Workers AI model id,
 * or `null` when the tier is unknown.
 */
export function cfModelForTier(tier: string): string | null {
  const key = tier.trim().toLowerCase();
  const capability = TIER_ALIASES[key] ?? key;
  return CLOUDFLARE_TIER_MODELS[capability] ?? null;
}
