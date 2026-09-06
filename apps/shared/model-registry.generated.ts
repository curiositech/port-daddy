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
    "input": 0.067,
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

/** Declared model-keyed profiles; inspect runtimeBinding before use as execution proof. */
const GENERATED_EMBEDDING_PROFILES: Record<string, EmbeddingProfile> = {
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
};
for (const profile of Object.values(GENERATED_EMBEDDING_PROFILES)) {
  Object.freeze(profile);
}
export const CF_EMBEDDING_PROFILES: Readonly<Record<string, Readonly<EmbeddingProfile>>> =
  Object.freeze(GENERATED_EMBEDDING_PROFILES);

/**
 * Read one declared embedding profile without exposing mutable registry state.
 *
 * @param modelId Exact model row key.
 * @returns A defensive copy, or undefined when the model has no vector profile.
 */
export function embeddingProfileForModel(modelId: string): EmbeddingProfile | undefined {
  const profile = CF_EMBEDDING_PROFILES[modelId];
  return profile ? { ...profile } : undefined;
}

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
