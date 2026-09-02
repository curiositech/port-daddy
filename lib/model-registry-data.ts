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

export type EmbeddingNormalization = 'none' | 'l2';
export type EmbeddingMetric = 'cosine' | 'dot-product' | 'euclidean';
export type EmbeddingPooling = 'mean-attention-mask-v1' | 'cls-last-hidden-state-v1';
export type EmbeddingTask = 'feature-extraction' | 'sentence-similarity';
export type EmbeddingUnicodeNormalization = 'none' | 'nfc' | 'nfkc' | 'tokenizer-defined';
export type EmbeddingTruncation = 'longest-first' | 'only-first';
export type EmbeddingCoordinatePrecision = 'float16' | 'float32' | 'float64';
export type EmbeddingTransportEncoding = 'json-number-array' | 'float32-array';
export type EmbeddingQuantization = 'none';
export type EmbeddingStorageEncoding = 'json-number-array' | 'float32-le';
export type EmbeddingProfileQuality = 'degraded-fallback';
export type EmbeddingRevisionBinding = 'declared-upstream';
export type EmbeddingRuntimeBinding = 'declarative-only';

/** A declared vector-space target plus binding policy; inspect runtimeBinding before use as proof. */
export interface EmbeddingProfile {
  readonly version: 2;
  readonly servingProvider: string;
  readonly modelId: string;
  readonly runtimeFamily: string;
  readonly runtimeVersion: string;
  readonly upstreamModelId: string;
  readonly modelRevision: string;
  readonly modelArtifact: string;
  readonly modelDigest: string;
  readonly modelConfigArtifact: string;
  readonly modelConfigDigest: string;
  readonly tokenizerId: string;
  readonly tokenizerRevision: string;
  readonly tokenizerArtifact: string;
  readonly tokenizerDigest: string;
  readonly tokenizerConfigArtifact: string;
  readonly tokenizerConfigDigest: string;
  readonly task: EmbeddingTask;
  readonly queryPrefix: string;
  readonly documentPrefix: string;
  readonly unicodeNormalization: EmbeddingUnicodeNormalization;
  readonly truncation: EmbeddingTruncation;
  readonly maxTokens: number;
  readonly dimensions: number;
  readonly normalization: EmbeddingNormalization;
  readonly metric: EmbeddingMetric;
  readonly pooling: EmbeddingPooling;
  readonly coordinatePrecision: EmbeddingCoordinatePrecision;
  readonly coordinateQuantization: EmbeddingQuantization;
  readonly transportEncoding: EmbeddingTransportEncoding;
  readonly storageEncoding: EmbeddingStorageEncoding;
  readonly storageQuantization: EmbeddingQuantization;
  readonly preprocessingDigest: string;
  readonly quality: EmbeddingProfileQuality;
  readonly revisionBinding: EmbeddingRevisionBinding;
  readonly runtimeBinding: EmbeddingRuntimeBinding;
  readonly spaceId: string;
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
   * Human-typed family nicknames resolved on the `explicit` input — sonnet,
   * opus, sol, terra, luna. Every vendor with public nicknames gets a row, so
   * one vendor's CLI quirk does not read as a feature only that family has.
   */
  modelAliases: Record<string, string>;
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
  /** Declared embedding targets, separate from the text-generation capability ladder. */
  readonly embeddingProfiles: Readonly<Record<string, Readonly<EmbeddingProfile>>>;
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
  "modelAliases": {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-5",
    "opus": "claude-opus-5",
    "fable": "claude-fable-5",
    "sol": "gpt-5.6-sol",
    "terra": "gpt-5.6-terra",
    "luna": "gpt-5.6-luna"
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
      "priceIn": 4,
      "priceOut": 20,
      "priceCachedIn": 0.4,
      "contextWindow": 1050000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "defaultEffort": "low",
      "notes": "\"Frontier model for complex professional work.\" The vendor default effort is `medium`; this registry defaults to `low` deliberately, because Responses API caps count reasoning tokens against max_output_tokens and a cost-capped run should not spend its answer budget on thinking it was not asked for. Callers wanting more ask for it by name."
    },
    "gpt-5.6-terra": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 2,
      "priceOut": 12,
      "priceCachedIn": 0.2,
      "contextWindow": 1050000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "defaultEffort": "low",
      "notes": "\"GPT-5.6 model that balances intelligence and cost.\""
    },
    "gpt-5.6-luna": {
      "provider": "openai",
      "plane": "direct-api",
      "priceIn": 0.2,
      "priceOut": 1.2,
      "priceCachedIn": 0.02,
      "contextWindow": 1050000,
      "capabilities": [
        "function-calling",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs",
      "reasoningEfforts": [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ],
      "defaultEffort": "low",
      "notes": "\"GPT-5.6 model optimized for cost-sensitive workloads.\" Cheaper per token than the gpt-5-mini it replaces on the cheap rung ($0.20/$1.20 against $0.25/$2.00) with 2.6x the context, which is why that rung moved."
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
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/openai/gpt-oss-20b": {
      "provider": "openai",
      "plane": "workers-ai",
      "priceIn": 0.2,
      "priceOut": 0.3,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/openai/gpt-oss-120b": {
      "provider": "openai",
      "plane": "workers-ai",
      "priceIn": 0.35,
      "priceOut": 0.75,
      "contextWindow": 128000,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/moonshotai/kimi-k2.7-code": {
      "provider": "moonshotai",
      "plane": "workers-ai",
      "priceIn": 0.95,
      "priceOut": 4,
      "contextWindow": 262144,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/zai-org/glm-4.7-flash": {
      "provider": "zai-org",
      "plane": "workers-ai",
      "priceIn": 0.06,
      "priceOut": 0.4,
      "contextWindow": 131072,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/zai-org/glm-5.2": {
      "provider": "zai-org",
      "plane": "workers-ai",
      "priceIn": 1.4,
      "priceOut": 4.4,
      "contextWindow": 262144,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/deepseek-ai/deepseek-v4-flash-0731": {
      "provider": "deepseek-ai",
      "plane": "workers-ai",
      "priceIn": 0.44,
      "priceOut": 1.32,
      "contextWindow": 1048576,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/deepseek-ai/deepseek-v4-pro-0813": {
      "provider": "deepseek-ai",
      "plane": "workers-ai",
      "priceIn": 1.32,
      "priceOut": 3.96,
      "contextWindow": 1048576,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/google/gemma-4-26b-a4b-it": {
      "provider": "google",
      "plane": "workers-ai",
      "priceIn": 0.1,
      "priceOut": 0.3,
      "contextWindow": 256000,
      "capabilities": [
        "text-generation",
        "reasoning"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/meta/llama-3.2-11b-vision-instruct": {
      "provider": "meta",
      "plane": "workers-ai",
      "priceIn": 0.049,
      "priceOut": 0.676,
      "contextWindow": 128000,
      "capabilities": [
        "vision"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
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
      "verifiedAt": "2026-08-23",
      "verifiedBy": "live-probe",
      "priceBasis": "vendor-docs"
    },
    "@cf/baai/bge-base-en-v1.5": {
      "provider": "baai",
      "plane": "workers-ai",
      "priceIn": 0.067,
      "priceOut": 0,
      "contextWindow": 512,
      "capabilities": [
        "embedding"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-31",
      "verifiedBy": "vendor-docs",
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
    "Xenova/all-MiniLM-L6-v2": {
      "provider": "xenova",
      "plane": "local",
      "priceIn": 0,
      "priceOut": 0,
      "contextWindow": 512,
      "capabilities": [
        "embedding"
      ],
      "status": "ga",
      "verifiedAt": "2026-08-31",
      "verifiedBy": "vendor-docs",
      "priceBasis": "vendor-docs",
      "notes": "Explicit offline-minimal embedding fallback. It is reachable through the embedding profile map only and deliberately absent from every backend text-generation ladder. Its loader weight dtype is not the profile's coordinate encoding; the current JS boundary exposes JSON numbers."
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
      "cheap": "gpt-5.6-luna",
      "balanced": "gpt-5.6-terra",
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
  },
  "embeddingProfiles": {
    "@cf/baai/bge-base-en-v1.5": {
      "servingProvider": "cloudflare-workers-ai",
      "runtimeFamily": "workers-ai-binding",
      "runtimeVersion": "workers-ai-binding-unversioned",
      "upstreamModelId": "BAAI/bge-base-en-v1.5",
      "modelRevision": "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
      "modelArtifact": "model.safetensors",
      "modelDigest": "sha256:c7c1988aae201f80cf91a5dbbd5866409503b89dcaba877ca6dba7dd0a5167d7",
      "modelConfigArtifact": "config.json",
      "modelConfigDigest": "sha256:bc00af31a4a31b74040d73370aa83b62da34c90b75eb77bfa7db039d90abd591",
      "tokenizerId": "BAAI/bge-base-en-v1.5",
      "tokenizerRevision": "a5beb1e3e68b9ab74eb54cfd186867f64f240e1a",
      "tokenizerArtifact": "tokenizer.json",
      "tokenizerDigest": "sha256:d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
      "tokenizerConfigArtifact": "tokenizer_config.json",
      "tokenizerConfigDigest": "sha256:9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
      "task": "feature-extraction",
      "queryPrefix": "",
      "documentPrefix": "",
      "unicodeNormalization": "tokenizer-defined",
      "truncation": "longest-first",
      "maxTokens": 512,
      "dimensions": 768,
      "normalization": "l2",
      "metric": "cosine",
      "pooling": "mean-attention-mask-v1",
      "coordinatePrecision": "float32",
      "coordinateQuantization": "none",
      "transportEncoding": "json-number-array",
      "storageEncoding": "json-number-array",
      "storageQuantization": "none",
      "revisionBinding": "declared-upstream",
      "version": 2,
      "modelId": "@cf/baai/bge-base-en-v1.5",
      "preprocessingDigest": "sha256:2e9cef6953fac4a1789917fc2653a5ad2c5bfc008ab310f2f887cf056d5c8961",
      "quality": "degraded-fallback",
      "runtimeBinding": "declarative-only",
      "spaceId": "embed-v2:4c3eb8222853b8ab6bf24cac75ae7dca9bc5544acbdb7c48a93ffd9189b724bd"
    },
    "Xenova/all-MiniLM-L6-v2": {
      "servingProvider": "local-transformers-js",
      "runtimeFamily": "transformers.js+onnxruntime-node",
      "runtimeVersion": "transformers.js@4.1.0+onnxruntime-node@1.24.3",
      "upstreamModelId": "Xenova/all-MiniLM-L6-v2",
      "modelRevision": "751bff37182d3f1213fa05d7196b954e230abad9",
      "modelArtifact": "onnx/model.onnx",
      "modelDigest": "sha256:759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
      "modelConfigArtifact": "config.json",
      "modelConfigDigest": "sha256:7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
      "tokenizerId": "Xenova/all-MiniLM-L6-v2",
      "tokenizerRevision": "751bff37182d3f1213fa05d7196b954e230abad9",
      "tokenizerArtifact": "tokenizer.json",
      "tokenizerDigest": "sha256:da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
      "tokenizerConfigArtifact": "tokenizer_config.json",
      "tokenizerConfigDigest": "sha256:9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
      "task": "feature-extraction",
      "queryPrefix": "",
      "documentPrefix": "",
      "unicodeNormalization": "tokenizer-defined",
      "truncation": "longest-first",
      "maxTokens": 512,
      "dimensions": 384,
      "normalization": "l2",
      "metric": "cosine",
      "pooling": "mean-attention-mask-v1",
      "coordinatePrecision": "float32",
      "coordinateQuantization": "none",
      "transportEncoding": "float32-array",
      "storageEncoding": "json-number-array",
      "storageQuantization": "none",
      "revisionBinding": "declared-upstream",
      "version": 2,
      "modelId": "Xenova/all-MiniLM-L6-v2",
      "preprocessingDigest": "sha256:67fcdea190a5d862ab741c5d12df4c891a556f2c54fd7ccbb341ec692c8ff0e6",
      "quality": "degraded-fallback",
      "runtimeBinding": "declarative-only",
      "spaceId": "embed-v2:76b6025e2a87cf9fd594508baadbc38289ab36c667f6492ed905314875d44173"
    }
  }
};

for (const profile of Object.values(MODEL_REGISTRY_DATA.embeddingProfiles)) {
  Object.freeze(profile);
}
Object.freeze(MODEL_REGISTRY_DATA.embeddingProfiles);
Object.defineProperty(MODEL_REGISTRY_DATA, 'embeddingProfiles', {
  writable: false,
  configurable: false,
});
