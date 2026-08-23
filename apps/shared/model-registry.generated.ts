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
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/openai/gpt-oss-20b",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/baai/bge-base-en-v1.5"
];

/** Context windows, so a Worker can budget without a second table. */
export const CF_CONTEXT_WINDOWS: Record<string, number> = {
  "@cf/zai-org/glm-4.7-flash": 131072,
  "@cf/openai/gpt-oss-120b": 128000,
  "@cf/zai-org/glm-5.2": 262144,
  "@cf/deepseek-ai/deepseek-v4-pro-0813": 1048576,
  "@cf/moonshotai/kimi-k2.7-code": 262144,
  "@cf/openai/gpt-oss-20b": 128000,
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": 80000,
  "@cf/baai/bge-base-en-v1.5": 512
};

/** Workers AI unit prices in USD per MILLION tokens, for the spend meters. */
export const CF_PRICES: Record<string, { input: number; output: number }> = {
  "@cf/zai-org/glm-4.7-flash": {
    "input": 0.06,
    "output": 0.4
  },
  "@cf/openai/gpt-oss-120b": {
    "input": 0.35,
    "output": 0.75
  },
  "@cf/zai-org/glm-5.2": {
    "input": 1.4,
    "output": 4.4
  },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    "input": 1.32,
    "output": 3.96
  },
  "@cf/moonshotai/kimi-k2.7-code": {
    "input": 0.95,
    "output": 4
  },
  "@cf/openai/gpt-oss-20b": {
    "input": 0.2,
    "output": 0.3
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    "input": 0.5,
    "output": 4.88
  },
  "@cf/baai/bge-base-en-v1.5": {
    "input": 0.02,
    "output": 0
  }
};

/** The named roles the cloud plane selects by. See config/models.yaml. */
export type CloudPlaneRole = 'shipDefault' | 'shipMid' | 'reviewBot' | 'repairEscalation' | 'synthesisOfficer' | 'shipwright' | 'mediator' | 'optimize' | 'embed';

/**
 * (role → Workers AI model id). The Workers plane selects by role, not by
 * capability rung, because the roles carry policy the ladder cannot express —
 * most importantly that the review model is reachable by role ONLY.
 */
export const CF_ROLE_MODELS: Record<CloudPlaneRole, string> = {
  "shipDefault": "@cf/zai-org/glm-4.7-flash",
  "shipMid": "@cf/openai/gpt-oss-20b",
  "reviewBot": "@cf/openai/gpt-oss-120b",
  "repairEscalation": "@cf/openai/gpt-oss-120b",
  "synthesisOfficer": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "shipwright": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "mediator": "@cf/zai-org/glm-4.7-flash",
  "optimize": "@cf/zai-org/glm-4.7-flash",
  "embed": "@cf/baai/bge-base-en-v1.5"
};

/**
 * Roles a ship's own model pin may select. The review/escalation model is
 * deliberately absent: no ship can pin its way onto the most expensive model.
 */
export const CF_PINNABLE_MODELS: readonly string[] = [
  "@cf/zai-org/glm-4.7-flash",
  "@cf/openai/gpt-oss-20b"
];

/**
 * Guard a requested Workers AI model id.
 *
 * The rationale: an unknown id on Workers AI does not error — it hangs, and the
 * caller reads the blank as a clean result. So a pin outside the allowlist is
 * remapped to the default rather than dispatched.
 *
 * @param requested The id a ship asked for.
 * @returns The requested id when it is pinnable, else the ship default.
 */
export function resolveCfModel(requested: string): string {
  return CF_PINNABLE_MODELS.includes(requested)
    ? requested
    : CF_ROLE_MODELS.shipDefault;
}
