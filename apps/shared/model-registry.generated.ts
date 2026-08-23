/**
 * Cloudflare-plane model registry — GENERATED. Do not hand-edit.
 *
 * Source of truth: config/models.yaml
 * Regenerate:      npx tsx scripts/generate-model-registry.ts --write
 *
 * Workers cannot import from the daemon's lib/, so this self-contained module is
 * emitted from the same source the daemon reads. Before it existed, the executor
 * and the relay each carried their own hardcoded model constants and drifted —
 * including a phantom id that made ai.run() hang rather than fail.
 */

export type CloudflareCapability = 'cheap' | 'balanced' | 'high' | 'max-thinking' | 'code';

/** (capability → Workers AI model id) for the cloud plane. */
export const CF_MODELS: Record<CloudflareCapability, string> = {
  "cheap": "@cf/zai-org/glm-4.7-flash",
  "balanced": "@cf/openai/gpt-oss-120b",
  "high": "@cf/zai-org/glm-5.2",
  "max-thinking": "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "code": "@cf/moonshotai/kimi-k2.7-code"
};

/**
 * Every GA Workers AI id the registry knows. The executor uses this as its
 * fail-toward-a-working-model guard: an id outside this set is treated as
 * unknown and remapped rather than dispatched, because an unknown id does not
 * error on Workers AI — it hangs.
 */
export const KNOWN_GOOD_CF_MODELS: readonly string[] = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/openai/gpt-oss-120b",
  "@cf/zai-org/glm-5.2",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/moonshotai/kimi-k2.7-code"
];

/** Context windows, so a Worker can budget without a second table. */
export const CF_CONTEXT_WINDOWS: Record<string, number> = {
  "@cf/zai-org/glm-4.7-flash": 131072,
  "@cf/openai/gpt-oss-120b": 128000,
  "@cf/zai-org/glm-5.2": 262144,
  "@cf/deepseek-ai/deepseek-v4-pro-0813": 1048576,
  "@cf/moonshotai/kimi-k2.7-code": 262144
};
