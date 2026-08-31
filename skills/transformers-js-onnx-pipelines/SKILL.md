---
license: Apache-2.0
allowed-tools: Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch
name: transformers-js-onnx-pipelines
description: 'Use when integrating Hugging Face Transformers.js (`@huggingface/transformers`) for in-browser or in-Node inference, debugging model and dtype loading, building bi-encoder / cross-encoder / classification pipelines, configuring model cache directories, or bypassing high-level pipelines to read raw logits. Triggers: "model failed to load", cross-encoder scores all 1.0 (softmax-over-1 trap), env.allowLocalModels confusion, cacheDir overrides, ONNX runtime mismatch, ESM vs CJS pipeline imports, browser vs node feature gaps. NOT for full transformers Python (different SDK), TensorFlow.js, ONNX Runtime Web directly without Transformers.js, model training, or comparing embeddings whose space identities are missing or incompatible.'
metadata:
  category: AI & Machine Learning
  tags:
    - transformers-js
    - onnx
    - embeddings
    - cross-encoder
    - inference
    - huggingface
  provenance:
    kind: first-party
    owners: [port-daddy]
  pairs-with:
    - skill: llm-router
      reason: When a retrieval or classification cascade must decide between local ONNX inference and a hosted model call, llm-router owns that routing decision.
    - skill: cost-optimizer
      reason: Replacing hosted embedding/classification API calls with a local quantized model is a cost lever cost-optimizer tracks across a running budget.
  io-contract:
    kind: deliverable
    consumes:
      - kind: inference-requirement
        format: markdown
        description: A description of the inference need -- embeddings, reranking, classification -- with target environment (Node, browser, CI) and latency/size constraints.
      - kind: onnx-pipeline-plan
        format: json
        description: A structured plan naming the pipeline type, environment, caching and logits-access decisions, matching schemas/transformers-js-onnx-pipelines-plan.schema.json.
    produces:
      - kind: pipeline-implementation
        format: markdown
        description: The recommended pipeline wiring (bi-encoder, cross-encoder bypass, caching, corpus build) with the anti-patterns above ruled out.
      - kind: pipeline-audit-report
        format: json
        description: A deterministic pass/fail audit of the onnx-pipeline-plan against this skill's Quality Gates, as produced by scripts/transformers_js_onnx_pipelines_audit.mjs.
---

# Transformers.js ONNX Pipelines

Transformers.js runs Hugging Face models on ONNX Runtime in-browser or in-Node. The high-level `pipeline()` is convenient until it isn't — most non-trivial models need direct tokenizer + model use because the pipeline's task wrapping makes assumptions that don't hold (e.g., the cross-encoder softmax-over-1 trap).

## When to use

- Local embeddings without an API (cosine search, RAG, dedup).
- Cross-encoder reranking for retrieval cascades.
- Browser-side inference (PII redaction, classification) without a server roundtrip.
- Replacing OpenAI embedding calls with a quantized local model to control cost.
- Integrating with a Cloudflare Worker via Workers AI (different surface, but ONNX know-how transfers).

## Core capabilities

### Bi-encoder (sentence embeddings)

This complete example is a Node service or corpus-build path. Browser code
receives the approved metadata and expected `space_id` from a build manifest or
registry, then can verify the same digest with the Web Crypto lines below.

```ts
import os from 'node:os';
import path from 'node:path';
import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;
env.cacheDir = process.env.MODEL_CACHE
  ?? path.join(os.homedir(), '.cache', 'transformers-js');

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

// Populate these fields from an approved model registry after a corpus eval.
// Never silently substitute another model when an artifact is unavailable.
const embeddingSpace = Object.freeze({
  provider: 'huggingface',
  modelId: required('EMBEDDING_MODEL_ID'),
  revision: required('EMBEDDING_MODEL_REVISION'), // immutable commit id
  dimensions: Number(required('EMBEDDING_DIMENSIONS')),
  normalization: 'l2',
  distanceMetric: 'cosine',
  dtype: 'q8',
});
// Canonical key order is part of the contract; hash it rather than relying on
// delimiters that model ids or future metadata could make ambiguous.
const canonicalSpaceMetadata = {
  provider: embeddingSpace.provider,
  modelId: embeddingSpace.modelId,
  revision: embeddingSpace.revision,
  dimensions: embeddingSpace.dimensions,
  normalization: embeddingSpace.normalization,
  distanceMetric: embeddingSpace.distanceMetric,
  dtype: embeddingSpace.dtype,
};
// Prefer computing this once in the approved model registry/build step. When
// runtime derivation is needed, Web Crypto keeps the same code runnable in a
// modern browser and in supported Node runtimes.
const canonicalBytes = new TextEncoder().encode(
  JSON.stringify(canonicalSpaceMetadata),
);
const digest = await globalThis.crypto.subtle.digest('SHA-256', canonicalBytes);
const spaceId = `embed-v1:${Array.from(new Uint8Array(digest), (byte) =>
  byte.toString(16).padStart(2, '0')).join('')}`;

const embed = await pipeline('feature-extraction', embeddingSpace.modelId, {
  revision: embeddingSpace.revision,
  dtype: embeddingSpace.dtype,
});

const out = await embed('the quick brown fox', { pooling: 'mean', normalize: true });
const vec = new Float32Array(out.data); // copy the tensor view
if (vec.length !== embeddingSpace.dimensions) {
  throw new Error(`embedding dimension mismatch for ${spaceId}`);
}
```

Choose the model by a representative retrieval eval, not familiarity or
download size alone. `Xenova/all-MiniLM-L6-v2` can still be a useful 384-dim
low-memory compatibility example, but label it `degraded-local`; it is not a
universal default. Prefer a materially stronger approved model when the
privacy boundary, device capacity, latency, and cost allow it.

The space contract is as important as the vector. Store provider, model id,
immutable revision, dimensions, normalization, distance metric, dtype, and the
canonical-metadata hash `space_id` with both corpus and query vectors. A
different model, revision, dimension, normalization, or metric is a different
space. Reject or re-embed on mismatch; never compare incompatible vectors
silently.

`pooling: 'mean'` averages token embeddings; `'cls'` uses [CLS]. `normalize: true` makes cosine == dot product:

```ts
function cosine(a: Float32Array, b: Float32Array) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
```

### Cross-encoder reranking — bypass the pipeline

The MS MARCO MiniLM rerankers publish a single regression head (num_labels=1). Transformers.js's `text-classification` pipeline applies softmax to the logits. Softmax over a single value collapses to 1.0 — every score becomes 1.0.

Skip the pipeline. Tokenize and forward manually:

```ts
import { AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';

const modelId = 'Xenova/ms-marco-MiniLM-L-6-v2'; // constrained example
const modelRevision = process.env.RERANK_MODEL_REVISION; // immutable commit id
if (!modelRevision) throw new Error('RERANK_MODEL_REVISION is required');
const [tokenizer, model] = await Promise.all([
  AutoTokenizer.from_pretrained(modelId, { revision: modelRevision }),
  AutoModelForSequenceClassification.from_pretrained(modelId, {
    revision: modelRevision,
    dtype: 'q8',
  }),
]);

async function rerank(query: string, candidates: string[]) {
  const queries = new Array(candidates.length).fill(query);
  const inputs = tokenizer(queries, {
    text_pair: candidates,
    padding: true, truncation: true, max_length: 512,
  });
  const outputs = await model(inputs);
  const logits = outputs.logits;
  const dims = logits.dims;          // [batch, num_labels]
  const numLabels = dims[1] ?? 1;
  const data = logits.data;

  return candidates.map((text, i) => {
    const score = numLabels === 1
      ? data[i]
      : data[i * numLabels + 1];     // 2-class: positive logit
    return { text, score };
  }).sort((a, b) => b.score - a.score);
}
```

The raw logit isn't bounded — calibration is the user's problem. For relative ranking it's fine.

### Lazy loading + cache strategy

Model artifacts range from tens of megabytes to multiple gigabytes; download
and initialization are often the slow path. Cache aggressively:

```ts
let _embedderPromise: Promise<any> | null = null;
function getEmbedder() {
  if (!_embedderPromise) {
    _embedderPromise = pipeline('feature-extraction', embeddingSpace.modelId, {
      revision: embeddingSpace.revision,
      dtype: embeddingSpace.dtype,
    });
  }
  return _embedderPromise;
}
```

Idempotent across concurrent calls — first call awaits the download, subsequent calls hit the in-memory model.

### Cache directory matters in CI

```ts
env.cacheDir = process.env.MODEL_CACHE
  ?? path.join(os.homedir(), '.cache', 'transformers-js');
```

In GitHub Actions, point this at a workspace-local path so `actions/cache` can persist it:

```yaml
env:
  MODEL_CACHE: ${{ github.workspace }}/.cache/transformers-js
- uses: actions/cache@v4
  with:
    path: ${{ env.MODEL_CACHE }}
    key: ${{ runner.os }}-tfjs-${{ hashFiles('embedding-space.json') }}
```

Without this, every CI run re-downloads.

### Building a corpus offline

For a static catalog (skill descriptions, doc chunks), embed once at build time and ship the vectors:

```ts
const embed = await pipeline('feature-extraction', embeddingSpace.modelId, {
  revision: embeddingSpace.revision,
  dtype: embeddingSpace.dtype,
});
const items = loadCorpus();
const dim = embeddingSpace.dimensions;
const buf = new Float32Array(items.length * dim);

for (let i = 0; i < items.length; i++) {
  const out = await embed(items[i].text, { pooling: 'mean', normalize: true });
  buf.set(out.data, i * dim);
}

fs.writeFileSync('data/embeddings.bin', Buffer.from(buf.buffer));
fs.writeFileSync('data/embeddings.meta.json', JSON.stringify({
  embeddingSpace: { ...embeddingSpace, spaceId },
  count: items.length,
  ids: items.map((x) => x.id),
}, null, 2));
```

Load at runtime with no parsing cost:

```ts
const meta = JSON.parse(fs.readFileSync('data/embeddings.meta.json', 'utf-8'));
if (meta.embeddingSpace?.spaceId !== spaceId) {
  throw new Error('incompatible embedding space; re-embed before search');
}
const buf = fs.readFileSync('data/embeddings.bin');
const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
```

Storage is `dimensions * 4` bytes per Float32 vector before index overhead.
Measure the actual corpus and index rather than assuming a 384-dim budget.

### Browser-side inference

```ts
import { pipeline, env } from '@huggingface/transformers';
env.allowRemoteModels = true;
env.remoteHost = 'https://your-cdn.example.com';   // optional

const classifier = await pipeline(
  'text-classification',
  'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  { device: 'webgpu', dtype: 'auto' },             // if available
);
```

Be honest about the download cost — show a progress bar.

## Anti-patterns

### Cross-encoder via `text-classification` pipeline

**Symptom:** Every candidate scores 1.0; ranking is degenerate.
**Diagnosis:** Pipeline softmaxes a single-logit head; softmax-over-1 = 1.
**Fix:** Use `AutoTokenizer` + `AutoModelForSequenceClassification` directly. Read `outputs.logits.data` as raw scores.

### `env.allowLocalModels = true` in CI

**Symptom:** Model downloads succeed locally, fail in CI: "model not found".
**Diagnosis:** With `allowLocalModels = true` the SDK looks for files on disk first; in CI, no disk model = fail.
**Fix:** `env.allowLocalModels = false` (default). Combine with a CI cache for the download.

### Importing the pipeline at module load

**Symptom:** Server startup blocks for 5s on first deploy.
**Diagnosis:** Top-level `await pipeline(...)` runs at import time.
**Fix:** Lazy-load inside a function. Cache the Promise so concurrent first calls share one load.

### Forgetting `normalize: true` for cosine

**Symptom:** Scores look right but order is subtly off.
**Diagnosis:** Vectors aren't unit-normalized; raw dot products bias toward longer strings.
**Fix:** Always `{ pooling: 'mean', normalize: true }`. Pre-normalize stored vectors.

### Float32Array reuse across calls

**Symptom:** Stored vectors mysteriously change; cache looks corrupted.
**Diagnosis:** Some pipeline implementations return a view into a reused tensor buffer; the next call overwrites.
**Fix:** Copy on capture: `new Float32Array(out.data)`.

### Reranker on too-long documents

**Symptom:** `RangeError: Tokenized inputs exceeded 512 tokens`.
**Diagnosis:** Cross-encoders truncate at 512 tokens jointly across (query, candidate). Long candidates lose context.
**Fix:** Truncate candidate text to ~400 tokens. Description + name only; skip body.

## Quality gates

- [ ] First-load Promise cached so concurrent calls don't double-download.
- [ ] `env.cacheDir` set to a CI-cacheable path.
- [ ] Cosine similarity uses normalized vectors.
- [ ] Cross-encoder scores read from `outputs.logits.data` directly, not via pipeline.
- [ ] Embeddings persisted as `Float32Array` for compactness.
- [ ] Model selected by a representative domain eval, with constrained MiniLM
      use explicitly labeled `degraded-local`.
- [ ] Provider, model id, immutable revision, dimensions, normalization,
      distance metric, dtype, and derived `space_id` persist with every index.
- [ ] Query/index space mismatch is rejected or re-embedded, never compared.
- [ ] Model revisions are pinned in code; never "latest" or mutable `main`.
- [ ] Transformers.js v4 uses an explicit `dtype` (`q8`, `q4`, etc.); full
      precision requires measured justification. Do not use the removed
      `quantized: true` option from older package generations.
- [ ] Smoke test runs the model on 3 known queries on every CI build.

Primary API checks: Hugging Face documents the `@huggingface/transformers`
package plus `dtype` and `revision` pipeline options in the
[pipeline API](https://huggingface.co/docs/transformers.js/en/pipelines), and
documents the replacement of the legacy `quantized` boolean in the
[dtype guide](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/dtypes).

## Deterministic Audit

Before wiring (or reviewing) a Transformers.js integration, write the decisions as a JSON
plan matching `schemas/transformers-js-onnx-pipelines-plan.schema.json` and run the
deterministic auditor:

```bash
node scripts/transformers_js_onnx_pipelines_audit.mjs --input examples/sample-input.json
```

`auditTransformersJsOnnxPipelines(plan)` (in `scripts/transformers_js_onnx_pipelines_audit.mjs`)
turns this skill's anti-patterns and Quality Gates into machine-checkable rules over
structured fields: a cross-encoder routed through the `text-classification` pipeline
instead of raw logits (the softmax-over-1 trap), un-normalized bi-encoder vectors fed to
cosine, `allowLocalModels: true` in CI, a missing CI model cache, an uncached first-load
Promise, persisted vectors that were never copied out of the reused tensor buffer,
unpinned model versions, and reranker inputs past the 512-token joint limit. It returns
`{ pass, score, findings, recommendations }`. `examples/sample-input.json` is a correctly
bypassed cross-encoder rerank plan (`pass: true`). Changes are tracked in `CHANGELOG.md`.

## NOT for

- **Python `transformers`** — different SDK; don't transfer assumptions.
- **TensorFlow.js** — different runtime, different model formats.
- **ONNX Runtime Web directly** without Transformers.js — lower-level; use only if you need custom ops.
- **Workers AI / Vertex AI** — managed inference; use the platform SDK.
- **Model training** — Transformers.js is inference-only.
