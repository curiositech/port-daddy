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
  "cheap": "@cf/qwen/qwen3-30b-a3b-fp8",
  "balanced": "@cf/openai/gpt-oss-20b",
  "high": "@cf/openai/gpt-oss-120b",
  "max-thinking": "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "code": "@cf/qwen/qwen2.5-coder-32b-instruct"
};


/** Context windows, so a Worker can budget without a second table. */
export const CF_CONTEXT_WINDOWS: Record<string, number> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": 32768,
  "@cf/openai/gpt-oss-20b": 128000,
  "@cf/openai/gpt-oss-120b": 128000,
  "@cf/moonshotai/kimi-k2.7-code": 262144,
  "@cf/zai-org/glm-4.7-flash": 131072,
  "@cf/zai-org/glm-5.2": 262144,
  "@cf/deepseek-ai/deepseek-v4-flash-0731": 1048576,
  "@cf/deepseek-ai/deepseek-v4-pro-0813": 1048576,
  "@cf/google/gemma-4-26b-a4b-it": 256000,
  "@cf/nvidia/nemotron-3-120b-a12b": 256000,
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": 24000,
  "@cf/meta/llama-3.1-8b-instruct-fp8": 32000,
  "@cf/meta/llama-3.2-1b-instruct": 60000,
  "@cf/meta/llama-3.2-3b-instruct": 80000,
  "@cf/meta/llama-3.2-11b-vision-instruct": 128000,
  "@cf/meta/llama-4-scout-17b-16e-instruct": 131000,
  "@cf/mistralai/mistral-small-3.1-24b-instruct": 128000,
  "@cf/qwen/qwen2.5-coder-32b-instruct": 32768,
  "@cf/qwen/qwq-32b": 24000,
  "@cf/qwen/qwen3.8-27b": 262144,
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": 80000,
  "@cf/ibm-granite/granite-4.0-h-micro": 131000,
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": 128000,
  "@cf/baai/bge-base-en-v1.5": 512
};

/** Workers AI unit prices in USD per MILLION tokens, for the spend meters. */
export const CF_PRICES: Record<string, { input: number; output: number }> = {
  "@cf/qwen/qwen3-30b-a3b-fp8": {
    "input": 0.051,
    "output": 0.335
  },
  "@cf/openai/gpt-oss-20b": {
    "input": 0.2,
    "output": 0.3
  },
  "@cf/openai/gpt-oss-120b": {
    "input": 0.35,
    "output": 0.75
  },
  "@cf/moonshotai/kimi-k2.7-code": {
    "input": 0.95,
    "output": 4
  },
  "@cf/zai-org/glm-4.7-flash": {
    "input": 0.06,
    "output": 0.4
  },
  "@cf/zai-org/glm-5.2": {
    "input": 1.4,
    "output": 4.4
  },
  "@cf/deepseek-ai/deepseek-v4-flash-0731": {
    "input": 0.44,
    "output": 1.32
  },
  "@cf/deepseek-ai/deepseek-v4-pro-0813": {
    "input": 1.32,
    "output": 3.96
  },
  "@cf/google/gemma-4-26b-a4b-it": {
    "input": 0.1,
    "output": 0.3
  },
  "@cf/nvidia/nemotron-3-120b-a12b": {
    "input": 0.5,
    "output": 1.5
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    "input": 0.293,
    "output": 2.253
  },
  "@cf/meta/llama-3.1-8b-instruct-fp8": {
    "input": 0.152,
    "output": 0.287
  },
  "@cf/meta/llama-3.2-1b-instruct": {
    "input": 0.027,
    "output": 0.201
  },
  "@cf/meta/llama-3.2-3b-instruct": {
    "input": 0.051,
    "output": 0.335
  },
  "@cf/meta/llama-3.2-11b-vision-instruct": {
    "input": 0.049,
    "output": 0.676
  },
  "@cf/meta/llama-4-scout-17b-16e-instruct": {
    "input": 0.27,
    "output": 0.85
  },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": {
    "input": 0.351,
    "output": 0.555
  },
  "@cf/qwen/qwen2.5-coder-32b-instruct": {
    "input": 0.66,
    "output": 1
  },
  "@cf/qwen/qwq-32b": {
    "input": 0.66,
    "output": 1
  },
  "@cf/qwen/qwen3.8-27b": {
    "input": 0.45,
    "output": 3.2
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    "input": 0.497,
    "output": 4.881
  },
  "@cf/ibm-granite/granite-4.0-h-micro": {
    "input": 0.017,
    "output": 0.112
  },
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it": {
    "input": 0.351,
    "output": 0.555
  },
  "@cf/baai/bge-base-en-v1.5": {
    "input": 0.02,
    "output": 0
  }
};

/** The named roles the cloud plane selects by. See config/models.yaml. */
export type CloudPlaneRole = 'shipDefault' | 'shipMid' | 'reviewBot' | 'repairEscalation' | 'author' | 'synthesisOfficer' | 'shipwright' | 'mediator' | 'optimize' | 'embed';

/**
 * (role → Workers AI model id). The Workers plane selects by role, not by
 * capability rung, because the roles carry policy the ladder cannot express —
 * most importantly that the review model is reachable by role ONLY.
 */
export const CF_ROLE_MODELS: Record<CloudPlaneRole, string> = {
  "shipDefault": "@cf/qwen/qwen3-30b-a3b-fp8",
  "shipMid": "@cf/openai/gpt-oss-20b",
  "reviewBot": "@cf/openai/gpt-oss-120b",
  "repairEscalation": "@cf/openai/gpt-oss-120b",
  "author": "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "synthesisOfficer": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "shipwright": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "mediator": "@cf/qwen/qwen3-30b-a3b-fp8",
  "optimize": "@cf/qwen/qwen3-30b-a3b-fp8",
  "embed": "@cf/baai/bge-base-en-v1.5"
};

/**
 * Every Workers AI id the executor admits as a ship's declared pin.
 *
 * This replaces an allowlist of PINNABLE ROLES that existed to stop a ship
 * pinning its way onto the most expensive model. That ceiling is gone on
 * purpose: over a live 14-day window the busiest ship's entire Workers AI spend
 * was under $0.90, while the ceiling was quietly remapping two pins the
 * operator had deliberately tiered up down to the cheap tier. Protecting
 * pennies by degrading declared intent is a worse trade than the spend it saved.
 *
 * What remains is the guard that was always load-bearing: an id must be REAL.
 * An unknown Workers AI id does not 404 — it returns a blank the parser reads
 * as a clean result, which is how two phantom ids silenced this fleet.
 */
export const CF_ADMITTED_MODELS: readonly string[] = [
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/openai/gpt-oss-20b",
  "@cf/openai/gpt-oss-120b",
  "@cf/moonshotai/kimi-k2.7-code",
  "@cf/zai-org/glm-4.7-flash",
  "@cf/zai-org/glm-5.2",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/deepseek-ai/deepseek-v4-pro-0813",
  "@cf/google/gemma-4-26b-a4b-it",
  "@cf/nvidia/nemotron-3-120b-a12b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.2-1b-instruct",
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/qwen/qwen2.5-coder-32b-instruct",
  "@cf/qwen/qwq-32b",
  "@cf/qwen/qwen3.8-27b",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/ibm-granite/granite-4.0-h-micro",
  "@cf/aisingapore/gemma-sea-lion-v4-27b-it"
];

/**
 * Guard a requested Workers AI model id.
 *
 * @param requested The id a ship asked for.
 * @returns The requested id when it is admitted, else the ship default.
 */
export function resolveCfModel(requested: string): string {
  return CF_ADMITTED_MODELS.includes(requested)
    ? requested
    : CF_ROLE_MODELS.shipDefault;
}
