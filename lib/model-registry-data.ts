/**
 * Model registry DATA — GENERATED. Do not hand-edit.
 *
 * Source of truth: config/models.yaml
 * Regenerate:      npx tsx scripts/generate-model-registry.ts --write
 *
 * This is a TS module (not a runtime-read JSON) so it resolves through the
 * import graph identically under bun, @swc/jest, tsc, and the dist build — no
 * fragile cwd/path resolution. Hand-editing it will be reverted by the next
 * generation and is caught by tests/unit/model-registry-canon.test.js.
 *
 * Capabilities: cheap / balanced / high / max-thinking / code.
 * NEVER hardcode a model ID elsewhere — declare a (backend, capability) and call
 * resolveModel() (lib/model-registry.ts).
 */

/** One catalog row: price, context, provenance, and lifecycle for a concrete id. */
export interface ModelCatalogEntry {
  provider: string;
  plane: 'direct-api' | 'workers-ai' | 'ai-gateway' | 'cli' | 'local';
  priceIn: number;
  priceOut: number;
  priceCachedIn?: number;
  contextWindow: number;
  capabilities: string[];
  status: 'ga' | 'deprecated' | 'retired';
  verifiedAt: string;
  verifiedBy: 'live-probe' | 'vendor-docs' | 'cf-catalog' | 'carried';
  priceBasis: 'vendor-docs' | 'estimate';
  /**
   * The reasoning-effort values this exact id accepts, live-probed.
   *
   * Not decoration: the values are model-specific and the API rejects an
   * unsupported one with a 400 before any token is spent. Pinning the id
   * without pinning its accepted parameter values is what let a hardcoded
   * `effort: 'minimal'` kill four of five OpenAI rungs while the registry
   * looked correct. Absent for models that take no effort parameter at all.
   */
  reasoningEfforts?: string[];
  /** The effort used when a caller names none — the cheapest supported rung. */
  defaultEffort?: string;
  notes?: string;
}

export interface ModelRegistryData {
  generatedAt: string;
  generatedBy: string;
  source: string;
  tierAliases: Record<string, string>;
  /** Legacy//external tier vocabularies mapped onto the capability ladder. */
  harborTiers: Record<string, string>;
  /** Transport-level model nicknames (e.g. the claude CLI's haiku/sonnet/opus). */
  cliAliases: Record<string, Record<string, string>>;
  /**
   * Backend-name aliases resolved in exactly one place: canonicalBackend() in
   * lib/model-registry.ts. Aliased backends share a model family and differ only
   * in transport; a backend with a genuinely different lineup (codex) keeps its
   * own table instead.
   */
  backendAliases: Record<string, string>;
  /** Every concrete id, with the facts that used to live in four separate tables. */
  models: Record<string, ModelCatalogEntry>;
  backends: Record<string, Record<string, string>>;
}

export const MODEL_REGISTRY_DATA: ModelRegistryData = {
  "generatedAt": "2026-08-23",
  "generatedBy": "config/models.yaml — hand-edited source of truth; scripts/generate-model-registry.ts emits the artifacts",
  "source": "Anthropic ids + pricing from the claude-api skill reference (2026-06-24 cache; undated ID form is mandatory — never append date suffixes). OpenAI ids live-probed against GET /v1/models on 2026-08-23. Gemini ids live-probed against GET /v1beta/models on 2026-08-23 — this probe caught `gemini-3.1-pro` as a PHANTOM (only `gemini-3.1-pro-preview` is served), which would have 404'd in production. Cloudflare ids + unit pricing + context windows from the Cloudflare model pages (developers.cloudflare.com/workers-ai/models/*) cross-checked against the operator-supplied 2026-08-12 catalog export.",
  "tierAliases": {
    "low": "cheap",
    "mid": "balanced",
    "high": "high"
  },
  "harborTiers": {
    "fast": "cheap",
    "mid": "balanced",
    "strong": "high",
    "local": "cheap",
    "custom": "balanced"
  },
  "cliAliases": {
    "claude-cli": {
      "cheap": "haiku",
      "balanced": "sonnet",
      "high": "opus",
      "max-thinking": "opus",
      "code": "sonnet"
    }
  },
  "backendAliases": {
    "anthropic": "claude",
    "claude-cli": "claude",
    "aider": "openai"
  },
  "models": {
    "claude-haiku-4-5": {
      "provider": "anthropic",
      "plane": "direct-api",
      "priceIn": 1,
      "priceOut": 5,
      "contextWindow": 200000,
      "capabilities": [
        "function-calling",
        "vision"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "vendor-docs",
      "priceBasis": "vendor-docs",
      "notes": "Undated id form is mandatory. The previous registry value `claude-haiku-4-5-20251001` carried a date suffix the current API reference explicitly forbids appending."
    },
    "claude-sonnet-5": {
      "provider": "anthropic",
      "plane": "direct-api",
      "priceIn": 3,
      "priceOut": 15,
      "contextWindow": 1000000,
      "capabilities": [
        "function-calling",
        "vision",
        "adaptive-thinking"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs",
      "notes": "Live-observed serving this repo's own claude-code spawns (modelUsage reported claude-sonnet-5). Intro pricing $2.00/$10.00 runs through 2026-08-31; the standing rate is recorded here so cost math does not silently under-report after the intro window closes."
    },
    "claude-opus-5": {
      "provider": "anthropic",
      "plane": "direct-api",
      "priceIn": 5,
      "priceOut": 25,
      "contextWindow": 1000000,
      "capabilities": [
        "function-calling",
        "vision",
        "adaptive-thinking"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "vendor-docs",
      "priceBasis": "vendor-docs"
    },
    "claude-fable-5": {
      "provider": "anthropic",
      "plane": "direct-api",
      "priceIn": 10,
      "priceOut": 50,
      "contextWindow": 1000000,
      "capabilities": [
        "function-calling",
        "vision",
        "adaptive-thinking-always-on"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "vendor-docs",
      "priceBasis": "vendor-docs",
      "notes": "Thinking is always on and cannot be disabled; requires 30-day data retention (unavailable under zero-data-retention orgs). Reserved for max-thinking so routine work never silently lands on the priciest model."
    },
    "gpt-5-mini": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 0.25,
      "priceOut": 2,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "minimal",
        "low",
        "medium",
        "high"
      ],
      "defaultEffort": "minimal",
      "notes": "The only model in this lineup that still accepts `minimal`; it is also the only one that rejects `none` and `xhigh`. Retained as the `cheap` rung."
    },
    "gpt-5.4": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 1.25,
      "priceOut": 10,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      "defaultEffort": "low"
    },
    "gpt-5.5-pro": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 15,
      "priceOut": 120,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "medium",
        "high",
        "xhigh"
      ],
      "defaultEffort": "medium",
      "notes": "Thinking is always on and cannot be disabled — the live probe confirms the doc: it is the one model here that rejects `none`, `minimal` AND `low`, so `medium` is its floor rather than a choice."
    },
    "gpt-5.3-codex": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 1.25,
      "priceOut": 10,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling",
        "reasoning",
        "code-specialized"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      "defaultEffort": "low"
    },
    "gpt-5.6-sol": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 1.25,
      "priceOut": 10,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "defaultEffort": "low",
      "notes": "Price and context window are UNVERIFIED — carried from the gpt-5.5 row because the vendor exposes neither via the API and no doc names these variants. Existence, serving, both API shapes and the effort set are live-probed."
    },
    "gpt-5.4-mini": {
      "provider": "openai",
      "plane": "cli",
      "priceIn": 0.25,
      "priceOut": 2,
      "contextWindow": 400000,
      "capabilities": [
        "function-calling"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh"
      ],
      "defaultEffort": "low"
    },
    "@cf/qwen/qwen3-30b-a3b-fp8": {
      "provider": "qwen",
      "plane": "workers-ai",
      "priceIn": 0.051,
      "priceOut": 0.335,
      "contextWindow": 32768,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/openai/gpt-oss-20b": {
      "provider": "openai",
      "plane": "workers-ai",
      "priceIn": 0.2,
      "priceOut": 0.3,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/openai/gpt-oss-120b": {
      "provider": "openai",
      "plane": "workers-ai",
      "priceIn": 0.35,
      "priceOut": 0.75,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/moonshotai/kimi-k2.7-code": {
      "provider": "moonshotai",
      "plane": "workers-ai",
      "priceIn": 0.95,
      "priceOut": 4,
      "contextWindow": 262144,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/zai-org/glm-4.7-flash": {
      "provider": "zai-org",
      "plane": "workers-ai",
      "priceIn": 0.06,
      "priceOut": 0.4,
      "contextWindow": 131072,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/zai-org/glm-5.2": {
      "provider": "zai-org",
      "plane": "workers-ai",
      "priceIn": 1.4,
      "priceOut": 4.4,
      "contextWindow": 262144,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/deepseek-ai/deepseek-v4-flash-0731": {
      "provider": "deepseek-ai",
      "plane": "workers-ai",
      "priceIn": 0.44,
      "priceOut": 1.32,
      "contextWindow": 1048576,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/deepseek-ai/deepseek-v4-pro-0813": {
      "provider": "deepseek-ai",
      "plane": "workers-ai",
      "priceIn": 1.32,
      "priceOut": 3.96,
      "contextWindow": 1048576,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/google/gemma-4-26b-a4b-it": {
      "provider": "google",
      "plane": "workers-ai",
      "priceIn": 0.1,
      "priceOut": 0.3,
      "contextWindow": 256000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/nvidia/nemotron-3-120b-a12b": {
      "provider": "nvidia",
      "plane": "workers-ai",
      "priceIn": 0.5,
      "priceOut": 1.5,
      "contextWindow": 256000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.293,
      "priceOut": 2.253,
      "contextWindow": 24000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.1-8b-instruct-fp8": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.152,
      "priceOut": 0.287,
      "contextWindow": 32000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.2-1b-instruct": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.027,
      "priceOut": 0.201,
      "contextWindow": 60000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.2-3b-instruct": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.051,
      "priceOut": 0.335,
      "contextWindow": 80000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.2-11b-vision-instruct": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.049,
      "priceOut": 0.676,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-4-scout-17b-16e-instruct": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.27,
      "priceOut": 0.85,
      "contextWindow": 131000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/mistralai/mistral-small-3.1-24b-instruct": {
      "provider": "mistralai",
      "plane": "workers-ai",
      "priceIn": 0.351,
      "priceOut": 0.555,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/qwen/qwen2.5-coder-32b-instruct": {
      "provider": "qwen",
      "plane": "workers-ai",
      "priceIn": 0.66,
      "priceOut": 1,
      "contextWindow": 32768,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/qwen/qwq-32b": {
      "provider": "qwen",
      "plane": "workers-ai",
      "priceIn": 0.66,
      "priceOut": 1,
      "contextWindow": 24000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/qwen/qwen3.8-27b": {
      "provider": "qwen",
      "plane": "workers-ai",
      "priceIn": 0.45,
      "priceOut": 3.2,
      "contextWindow": 262144,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
      "provider": "deepseek-ai",
      "plane": "workers-ai",
      "priceIn": 0.497,
      "priceOut": 4.881,
      "contextWindow": 80000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/ibm-granite/granite-4.0-h-micro": {
      "provider": "ibm-granite",
      "plane": "workers-ai",
      "priceIn": 0.017,
      "priceOut": 0.112,
      "contextWindow": 131000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/aisingapore/gemma-sea-lion-v4-27b-it": {
      "provider": "aisingapore",
      "plane": "workers-ai",
      "priceIn": 0.351,
      "priceOut": 0.555,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "@cf/baai/bge-base-en-v1.5": {
      "provider": "baai",
      "plane": "workers-ai",
      "priceIn": 0.02,
      "priceOut": 0,
      "contextWindow": 512,
      "capabilities": [
        "embedding"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-22",
      "verifiedBy": "cf-catalog",
      "priceBasis": "vendor-docs"
    },
    "gemini-3.7-flash": {
      "provider": "google",
      "plane": "direct-api",
      "priceIn": 0.3,
      "priceOut": 2.5,
      "contextWindow": 1000000,
      "capabilities": [
        "function-calling",
        "vision",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate"
    },
    "gemini-3.1-pro-preview": {
      "provider": "google",
      "plane": "direct-api",
      "priceIn": 1.25,
      "priceOut": 10,
      "contextWindow": 1000000,
      "capabilities": [
        "function-calling",
        "vision",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "estimate",
      "notes": "The `-preview` suffix is REQUIRED — a live probe of GET /v1beta/models on 2026-08-23 showed `gemini-3.1-pro-preview` served and bare `gemini-3.1-pro` absent. Pinning the bare id would 404 in production."
    },
    "llama-3.3-70b-versatile": {
      "provider": "meta",
      "plane": "direct-api",
      "priceIn": 0.59,
      "priceOut": 0.79,
      "contextWindow": 131072,
      "capabilities": [
        "function-calling"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "estimate"
    },
    "openai/gpt-oss-120b": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 0.15,
      "priceOut": 0.75,
      "contextWindow": 131072,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "estimate"
    },
    "deepseek-chat": {
      "provider": "deepseek",
      "plane": "direct-api",
      "priceIn": 0.27,
      "priceOut": 1.1,
      "contextWindow": 128000,
      "capabilities": [
        "function-calling"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "estimate"
    },
    "deepseek-reasoner": {
      "provider": "deepseek",
      "plane": "direct-api",
      "priceIn": 0.55,
      "priceOut": 2.19,
      "contextWindow": 128000,
      "capabilities": [
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "estimate"
    },
    "grok-code-fast-1": {
      "provider": "xai",
      "plane": "direct-api",
      "priceIn": 0.2,
      "priceOut": 1.5,
      "contextWindow": 256000,
      "capabilities": [
        "function-calling",
        "code-specialized"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "estimate"
    },
    "grok-4.6": {
      "provider": "xai",
      "plane": "direct-api",
      "priceIn": 3,
      "priceOut": 15,
      "contextWindow": 2000000,
      "capabilities": [
        "function-calling",
        "reasoning",
        "vision"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-12",
      "verifiedBy": "cf-catalog",
      "priceBasis": "estimate",
      "notes": "Replaces the registry's previous `grok-2-latest` (balanced+high) and `grok-3` (max-thinking) — both several generations stale. Sourced from the AI Gateway catalog; NOT live-probed (no xAI credential in this environment)."
    },
    "qwen2.5-coder:7b": {
      "provider": "alibaba",
      "plane": "local",
      "priceIn": 0,
      "priceOut": 0,
      "contextWindow": 32768,
      "capabilities": [
        "code-specialized"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "vendor-docs"
    },
    "qwen2.5-coder:14b": {
      "provider": "alibaba",
      "plane": "local",
      "priceIn": 0,
      "priceOut": 0,
      "contextWindow": 32768,
      "capabilities": [
        "code-specialized"
      ],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "vendor-docs"
    },
    "llama3.1:8b": {
      "provider": "meta",
      "plane": "local",
      "priceIn": 0,
      "priceOut": 0,
      "contextWindow": 131072,
      "capabilities": [],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "vendor-docs"
    },
    "local-model": {
      "provider": "lmstudio",
      "plane": "local",
      "priceIn": 0,
      "priceOut": 0,
      "contextWindow": 32768,
      "capabilities": [],
      "status": "ga",
      "verifiedAt": "2026-07-14",
      "verifiedBy": "carried",
      "priceBasis": "vendor-docs",
      "notes": "Conventional placeholder — LM Studio serves whatever the operator has loaded; the concrete id is resolved at runtime via GET /v1/models."
    }
  },
  "backends": {
    "claude": {
      "cheap": "claude-haiku-4-5",
      "balanced": "claude-sonnet-5",
      "high": "claude-opus-5",
      "max-thinking": "claude-fable-5",
      "code": "claude-sonnet-5"
    },
    "openai": {
      "cheap": "gpt-5-mini",
      "balanced": "gpt-5.4",
      "high": "gpt-5.6-sol",
      "max-thinking": "gpt-5.5-pro",
      "code": "gpt-5.3-codex"
    },
    "codex": {
      "cheap": "gpt-5.4-mini",
      "balanced": "gpt-5.3-codex",
      "high": "gpt-5.4",
      "max-thinking": "gpt-5.4",
      "code": "gpt-5.3-codex"
    },
    "cloudflare": {
      "cheap": "@cf/qwen/qwen3-30b-a3b-fp8",
      "balanced": "@cf/openai/gpt-oss-20b",
      "high": "@cf/openai/gpt-oss-120b",
      "max-thinking": "@cf/deepseek-ai/deepseek-v4-pro-0813",
      "code": "@cf/qwen/qwen2.5-coder-32b-instruct"
    },
    "gemini": {
      "cheap": "gemini-3.7-flash",
      "balanced": "gemini-3.7-flash",
      "high": "gemini-3.1-pro-preview",
      "max-thinking": "gemini-3.1-pro-preview",
      "code": "gemini-3.7-flash"
    },
    "groq": {
      "cheap": "llama-3.3-70b-versatile",
      "balanced": "llama-3.3-70b-versatile",
      "high": "openai/gpt-oss-120b",
      "max-thinking": "openai/gpt-oss-120b",
      "code": "llama-3.3-70b-versatile"
    },
    "deepseek": {
      "cheap": "deepseek-chat",
      "balanced": "deepseek-chat",
      "high": "deepseek-reasoner",
      "max-thinking": "deepseek-reasoner",
      "code": "deepseek-chat"
    },
    "xai": {
      "cheap": "grok-code-fast-1",
      "balanced": "grok-4.6",
      "high": "grok-4.6",
      "max-thinking": "grok-4.6",
      "code": "grok-code-fast-1"
    },
    "ollama": {
      "cheap": "qwen2.5-coder:7b",
      "balanced": "llama3.1:8b",
      "high": "qwen2.5-coder:14b",
      "max-thinking": "qwen2.5-coder:14b",
      "code": "qwen2.5-coder:7b"
    },
    "lmstudio": {
      "cheap": "local-model",
      "balanced": "local-model",
      "high": "local-model",
      "max-thinking": "local-model",
      "code": "local-model"
    }
  }
};
